// api/verify-paypal.js
// 1. Captura el pago en PayPal (CAPTURE) — lo cobra de verdad
// 2. Verifica que el importe es correcto
// 3. Genera un token de un solo uso y lo guarda en memoria (válido 15 min)
// 4. Devuelve el token al frontend — sin token no se puede publicar
//
// Variables de entorno necesarias en Vercel:
//   PAYPAL_CLIENT_ID     → tu Client ID de PayPal Developer
//   PAYPAL_CLIENT_SECRET → tu Client Secret de PayPal Developer
//   PAYPAL_MODE          → "sandbox" o "live"
//   PRECIO_CELDA         → precio por celda en EUR (debe coincidir con CFG.PRECIO del HTML)

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

// ── Store en memoria de tokens válidos ───────────────────────────
// Formato: { token → { zoneRef, expiresAt } }
// En Vercel cada función puede tener varias instancias, pero para
// un mosaico con pocos pagos simultáneos esto es suficiente.
// Si necesitas escalar usa KV de Vercel o Redis.
const validTokens = new Map();
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutos

// Limpieza periódica de tokens expirados
function purgeExpired() {
  const now = Date.now();
  for (const [k, v] of validTokens) {
    if (v.expiresAt < now) validTokens.delete(k);
  }
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
    // zone = { r1, c1, r2, c2, n, total }

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
    const paidAmount = parseFloat(order.purchase_units?.[0]?.amount?.value || '0');
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
      const err = await captureRes.text();
      console.error('[verify-paypal] Error al capturar:', err);
      return res.status(502).json({ ok: false, error: 'Error al capturar el pago' });
    }

    const capture = await captureRes.json();
    if (capture.status !== 'COMPLETED') {
      return res.status(402).json({ ok: false, error: `Captura no completada. Estado: ${capture.status}` });
    }

    // 5) Generar token de un solo uso (válido 15 min)
    purgeExpired();
    const uploadToken = `ut_${Date.now()}_${Math.random().toString(36).slice(2,10)}`;
    const zoneRef     = `r${zone.r1}_c${zone.c1}_r${zone.r2}_c${zone.c2}`;
    validTokens.set(uploadToken, {
      zoneRef,
      zone,
      orderID,
      expiresAt: Date.now() + TOKEN_TTL_MS,
    });

    return res.status(200).json({ ok: true, uploadToken });

  } catch (err) {
    console.error('[verify-paypal] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ── Exportar validTokens para que publish.js pueda validar ───────
// Nota: esto funciona dentro del mismo proceso de Vercel.
// Si Vercel escala a múltiples instancias, migrar a Vercel KV.
export { validTokens };
