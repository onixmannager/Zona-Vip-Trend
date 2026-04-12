// api/verify-paypal.js
// 1. Captura el pago en PayPal (CAPTURE) — lo cobra de verdad
// 2. Verifica que el importe es correcto
// 3. Genera un uploadToken firmado con HMAC-SHA256 (válido 30 min)
// 4. Devuelve el token al frontend — sin token no se puede publicar
//
// El token está firmado con HMAC y no necesita Map en memoria,
// por lo que funciona correctamente aunque Vercel use múltiples instancias.
//
// Variables de entorno necesarias en Vercel:
//   PAYPAL_CLIENT_ID     → tu Client ID de PayPal Developer
//   PAYPAL_CLIENT_SECRET → tu Client Secret de PayPal Developer
//   PAYPAL_MODE          → "sandbox" o "live"
//   PRECIO_CELDA         → precio por celda en EUR (debe coincidir con CFG.PRECIO del HTML)
//   UPLOAD_SECRET        → mismo string secreto usado en verify-stripe.js y publish.js

import crypto from 'crypto';

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

const PAYPAL_BASE = {
  sandbox: 'https://api-m.sandbox.paypal.com',
  live:    'https://api-m.paypal.com',
};

function getBase() {
  return PAYPAL_BASE[process.env.PAYPAL_MODE || 'sandbox'];
}

// ── Generar uploadToken firmado con HMAC-SHA256 ───────────────────
// Mismo formato que verify-stripe.js — publish.js los valida igual
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

// ── Obtener token de acceso de PayPal ────────────────────────────
async function getAccessToken() {
  const base  = getBase();
  const creds = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString('base64');

  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!res.ok) throw new Error('No se pudo obtener token de PayPal');
  const data = await res.json();
  return data.access_token;
}

// ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false });

  try {
    const { orderID, zone } = req.body;

    if (!orderID || !zone) {
      return res.status(400).json({ ok: false, error: 'Faltan orderID o zone' });
    }

    const accessToken = await getAccessToken();
    const base        = getBase();

    // 1) Obtener detalles de la orden antes de capturar
    const orderRes = await fetch(`${base}/v2/checkout/orders/${orderID}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!orderRes.ok) {
      return res.status(502).json({ ok: false, error: 'No se pudo obtener la orden de PayPal' });
    }

    const order = await orderRes.json();

    // 2) Verificar que la orden está aprobada (el usuario pagó)
    if (order.status !== 'APPROVED') {
      return res.status(402).json({ ok: false, error: `Orden no aprobada. Estado: ${order.status}` });
    }

    // 3) Verificar importe — debe coincidir con lo que el frontend calculó
    const paidAmount     = parseFloat(order.purchase_units?.[0]?.amount?.value || '0');
    const expectedAmount = zone.n * parseFloat(process.env.PRECIO_CELDA || '50');

    if (Math.abs(paidAmount - expectedAmount) > 0.01) {
      console.error(`[verify-paypal] Importe incorrecto: pagado=${paidAmount} esperado=${expectedAmount}`);
      return res.status(402).json({ ok: false, error: 'El importe pagado no coincide' });
    }

    // 4) Capturar el pago (cobrar de verdad)
    const captureRes = await fetch(`${base}/v2/checkout/orders/${orderID}/capture`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!captureRes.ok) {
      const errText = await captureRes.text();
      console.error('[verify-paypal] Error al capturar:', errText);
      return res.status(502).json({ ok: false, error: 'Error al capturar el pago' });
    }

    const capture = await captureRes.json();
    if (capture.status !== 'COMPLETED') {
      return res.status(402).json({ ok: false, error: `Captura no completada. Estado: ${capture.status}` });
    }

    // 5) Generar uploadToken firmado con HMAC (compatible con publish.js)
    const uploadToken = generarUploadToken(zone);

    return res.status(200).json({ ok: true, uploadToken });

  } catch (err) {
    console.error('[verify-paypal] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
