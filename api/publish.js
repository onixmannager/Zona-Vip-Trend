// api/publish.js
// Guarda la zona en zones.json (GitHub).
// REQUIERE un uploadToken válido emitido por verify-paypal.js
// Si el token no existe o expiró → rechaza la petición.

import { validTokens } from './verify-paypal.js';

export const config = {
  api: { bodyParser: { sizeLimit: '1mb' } },
};

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

    // 1) Validar token de un solo uso
    const tokenData = validTokens.get(uploadToken);
    if (!tokenData) {
      return res.status(403).json({ ok: false, error: 'Token inválido o expirado. Vuelve a pagar.' });
    }
    if (tokenData.expiresAt < Date.now()) {
      validTokens.delete(uploadToken);
      return res.status(403).json({ ok: false, error: 'Token expirado. Vuelve a pagar.' });
    }

    // 2) Verificar que la zona del token coincide con la zona enviada
    const expectedRef = `r${zone.r1}_c${zone.c1}_r${zone.r2}_c${zone.c2}`;
    if (tokenData.zoneRef !== expectedRef) {
      return res.status(403).json({ ok: false, error: 'La zona no coincide con el pago.' });
    }

    // 3) Invalidar el token (un solo uso)
    validTokens.delete(uploadToken);

    // 4) Leer zones.json actual de GitHub
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

    // 5) Añadir la nueva zona
    zones.push(zone);

    // 6) Guardar zones.json actualizado
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
