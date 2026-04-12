// api/publish.js
// Guarda la zona en zones.json (GitHub).
// REQUIERE un uploadToken válido emitido por verify-paypal.js o verify-stripe.js.
// El token está firmado con HMAC-SHA256 — no necesita Map en memoria,
// funciona correctamente en Vercel aunque cada función corra en instancias distintas.
//
// Variables de entorno necesarias en Vercel:
//   GH_TOKEN       → token de GitHub con permisos de escritura en el repo
//   UPLOAD_SECRET  → mismo string secreto usado en verify-paypal.js y verify-stripe.js

import crypto from 'crypto';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

// ── Validar uploadToken firmado con HMAC ──────────────────────────────────────
// El token es un base64url de JSON { payload, sig }
// payload es un JSON con { r1, c1, r2, c2, ts }
// Expira a los 30 minutos desde su emisión
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutos

function verificarUploadToken(token, zone) {
  try {
    const decoded  = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
    const { payload, sig } = decoded;

    // 1) Verificar firma HMAC
    const expectedSig = crypto
      .createHmac('sha256', process.env.UPLOAD_SECRET || 'dev-secret')
      .update(payload)
      .digest('hex');

    if (sig !== expectedSig) return { ok: false, error: 'Token inválido.' };

    // 2) Verificar expiración
    const data = JSON.parse(payload);
    if (Date.now() - data.ts > TOKEN_TTL_MS) {
      return { ok: false, error: 'Token expirado. Vuelve a pagar.' };
    }

    // 3) Verificar que la zona del token coincide con la zona enviada
    if (
      data.r1 !== zone.r1 || data.c1 !== zone.c1 ||
      data.r2 !== zone.r2 || data.c2 !== zone.c2
    ) {
      return { ok: false, error: 'La zona no coincide con el pago.' };
    }

    return { ok: true };

  } catch (e) {
    return { ok: false, error: 'Token malformado.' };
  }
}

// ── Handler principal ─────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false });

  if (!process.env.GH_TOKEN) {
    return res.status(500).json({ ok: false, error: 'GH_TOKEN no configurado' });
  }

  try {
    const { repo, zone, uploadToken } = req.body;

    if (!repo || !zone || !uploadToken) {
      return res.status(400).json({ ok: false, error: 'Faltan campos: repo, zone, uploadToken' });
    }

    // 1) Validar token (funciona para tokens de PayPal y de Stripe)
    const validacion = verificarUploadToken(uploadToken, zone);
    if (!validacion.ok) {
      return res.status(403).json({ ok: false, error: validacion.error });
    }

    // 2) Leer zones.json actual de GitHub
    const apiBase = `https://api.github.com/repos/${repo}/contents/zones.json`;
    const headers = {
      Authorization:  `Bearer ${process.env.GH_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent':   'mosaico-vercel',
    };

    let zones = [], sha;
    const getRes = await fetch(apiBase, { headers });
    if (getRes.ok) {
      const j = await getRes.json();
      sha   = j.sha;
      zones = JSON.parse(Buffer.from(j.content, 'base64').toString('utf-8'));
    }

    // 3) Añadir la nueva zona
    zones.push(zone);

    // 4) Guardar zones.json actualizado
    const putRes = await fetch(apiBase, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `zone ${zone.id}`,
        content: Buffer.from(JSON.stringify(zones, null, 2)).toString('base64'),
        ...(sha ? { sha } : {}),
      }),
    });

    if (!putRes.ok) {
      const text = await putRes.text();
      console.error('[publish] GitHub error:', text);
      return res.status(502).json({ ok: false, error: 'Error al guardar zones.json' });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[publish] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
