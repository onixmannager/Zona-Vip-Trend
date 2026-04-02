// api/create-order.js
// Crea una orden de pago en PayPal y devuelve la URL de aprobación.
// El frontend redirige al usuario a esa URL para que pague.
//
// Variables de entorno necesarias en Vercel:
//   PAYPAL_CLIENT_ID     → tu Client ID de PayPal Developer
//   PAYPAL_CLIENT_SECRET → tu Client Secret de PayPal Developer
//   PAYPAL_MODE          → "sandbox" (pruebas) o "live" (producción)

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
    const { zone } = req.body;
    // zone = { r1, c1, r2, c2, n, total, email }

    if (!zone || !zone.total) {
      return res.status(400).json({ ok: false, error: 'Faltan datos de la zona' });
    }

    const token   = await getAccessToken();
    const base    = getBase();
    const returnUrl = `${process.env.NEXT_PUBLIC_SITE_URL || req.headers.origin}/?payment=success`;
    const cancelUrl = `${process.env.NEXT_PUBLIC_SITE_URL || req.headers.origin}/?payment=cancel`;

    // Referencia interna para identificar la zona tras el pago
    const zoneRef = `r${zone.r1}_c${zone.c1}_r${zone.r2}_c${zone.c2}`;

    const orderRes = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `mosaico-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          reference_id:  zoneRef,
          custom_id:     zoneRef,
          description:   `ZonaVIP Mosaico — ${zone.n} celdas (${zoneRef})`,
          amount: {
            currency_code: 'EUR',
            value:         zone.total.toFixed(2),
          },
        }],
        application_context: {
          brand_name:          'ZonaVIP Trends',
          locale:              'es-ES',
          landing_page:        'NO_PREFERENCE',
          user_action:         'PAY_NOW',
          return_url:          returnUrl,
          cancel_url:          cancelUrl,
          shipping_preference: 'NO_SHIPPING',
        },
      }),
    });

    if (!orderRes.ok) {
      const err = await orderRes.text();
      console.error('[create-order] PayPal error:', err);
      return res.status(502).json({ ok: false, error: 'Error creando orden en PayPal' });
    }

    const order    = await orderRes.json();
    const approveLink = order.links?.find(l => l.rel === 'approve')?.href;

    if (!approveLink) {
      return res.status(502).json({ ok: false, error: 'PayPal no devolvió URL de aprobación' });
    }

    // Guardar zona en sessionStorage desde el cliente, aquí solo devolvemos
    // el orderID y la URL de redirección
    return res.status(200).json({
      ok:        true,
      orderID:   order.id,
      approveUrl: approveLink,
    });

  } catch (err) {
    console.error('[create-order] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
