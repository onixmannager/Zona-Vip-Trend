// api/chek-sorteo.js
// ──────────────────────────────────────────────────────────────────────────────
//  Vercel Serverless Function — Stripe Payment Intent
//
//  Maneja DOS acciones según el campo `action` del body:
//
//  1) action === undefined  →  CREAR PaymentIntent
//     POST /api/chek-sorteo  { zone, email }
//     → { ok: true, clientSecret }
//
//  2) action === 'verify'   →  VERIFICAR pago y emitir uploadToken
//     POST /api/chek-sorteo  { zone, email, paymentIntentId, action: 'verify' }
//     → { ok: true, uploadToken }
//
//  Variables de entorno necesarias en Vercel:
//    STRIPE_SK   → sk_live_XXX  (o sk_test_XXX en sandbox)
//    UPLOAD_SECRET → string aleatorio para firmar el uploadToken
// ──────────────────────────────────────────────────────────────────────────────

import Stripe from 'stripe';
import crypto  from 'crypto';

const stripe = new Stripe(process.env.STRIPE_SK, { apiVersion: '2024-04-10' });

// Precio por cuadrito en céntimos (50 € = 5000 cts)
const PRECIO_CENT = 5000;

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok(res, data) {
  res.setHeader('Content-Type', 'application/json');
  res.status(200).json({ ok: true, ...data });
}

function err(res, msg, status = 400) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json({ ok: false, error: msg });
}

/**
 * Genera un token de un solo uso para autorizar la subida de imagen.
 * Firmado con HMAC-SHA256 para evitar falsificaciones.
 */
function generarUploadToken(zone) {
  const payload = JSON.stringify({
    r1: zone.r1, c1: zone.c1, r2: zone.r2, c2: zone.c2,
    ts: Date.now()
  });
  const sig = crypto
    .createHmac('sha256', process.env.UPLOAD_SECRET || 'dev-secret')
    .update(payload)
    .digest('hex');
  return Buffer.from(JSON.stringify({ payload, sig })).toString('base64url');
}

// ── Handler principal ─────────────────────────────────────────────────────────

export default async function handler(req, res) {

  // Solo POST
  if (req.method !== 'POST') return err(res, 'Método no permitido', 405);

  const { zone, email, paymentIntentId, action } = req.body || {};

  // Validaciones básicas
  if (!zone || typeof zone.n !== 'number' || zone.n < 1) {
    return err(res, 'Zona inválida');
  }
  if (!email || !email.includes('@')) {
    return err(res, 'Email inválido');
  }

  const amountCents = zone.n * PRECIO_CENT;

  // ── ACCIÓN: VERIFICAR pago existente ──────────────────────────────────────
  if (action === 'verify') {
    if (!paymentIntentId) return err(res, 'paymentIntentId requerido');

    try {
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId);

      // Seguridad: comprobar que el importe coincide y el pago está completado
      if (intent.status !== 'succeeded') {
        return err(res, 'El pago no está completado (status: ' + intent.status + ')');
      }
      if (intent.amount !== amountCents) {
        return err(res, 'El importe del pago no coincide con la zona seleccionada');
      }
      // Opcional: comprobar metadata si se guardó en la creación
      if (intent.metadata?.email && intent.metadata.email !== email) {
        return err(res, 'El email no coincide con el del pago');
      }

      const uploadToken = generarUploadToken(zone);
      return ok(res, { uploadToken });

    } catch (e) {
      console.error('[chek-sorteo] verify error:', e.message);
      return err(res, 'Error al verificar el pago con Stripe', 500);
    }
  }

  // ── ACCIÓN: CREAR PaymentIntent ───────────────────────────────────────────
  try {
    const intent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'eur',
      // Guardar metadatos para auditoría y verificación posterior
      metadata: {
        email,
        zona:   `F${zone.r1 + 1}-${zone.r2 + 1}_C${zone.c1 + 1}-${zone.c2 + 1}`,
        n:      String(zone.n),
        total:  String(zone.total),
      },
      receipt_email:       email,
      description:         `ZonaVIP Mosaico — ${zone.n} cuadrito(s)`,
      // Confirmar automáticamente con el SDK del navegador
      automatic_payment_methods: { enabled: true },
    });

    return ok(res, { clientSecret: intent.client_secret });

  } catch (e) {
    console.error('[chek-sorteo] create error:', e.message);
    return err(res, 'Error al crear el pago con Stripe: ' + e.message, 500);
  }
}
