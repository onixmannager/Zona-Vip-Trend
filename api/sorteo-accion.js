// api/sorteo-accion.js
// Llamado desde el panel de control cuando el admin decide:
//   · "Repartir" → descuenta el premio del bote y lo registra como otorgado
//   · "Reservar" → marca que ya lo vio pero no lo reparte todavía
//                  (silencia el aviso 7 días para ese premio)
//
// Variables de entorno:
//   GH_TOKEN          → token GitHub
//   SORTEO_STATE_REPO → repo donde está sorteo-estado.json
//   CRON_SECRET       → mismo secret que usa check-sorteo.js

export const config = {
  api: { bodyParser: { sizeLimit: '64kb' } },
};

// ── Helpers GitHub ────────────────────────────────────────────────
const GH_HEADERS = () => ({
  Authorization:  `Bearer ${process.env.GH_TOKEN}`,
  'Content-Type': 'application/json',
  'User-Agent':   'mosaico-sorteo',
});

async function ghGet(repo, file) {
  const r = await fetch(
    `https://api.github.com/repos/${repo}/contents/${file}`,
    { headers: GH_HEADERS() }
  );
  if (!r.ok) return null;
  const j = await r.json();
  return { data: JSON.parse(Buffer.from(j.content, 'base64').toString('utf-8')), sha: j.sha };
}

async function ghPut(repo, file, data, sha, message) {
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/${file}`, {
    method: 'PUT',
    headers: GH_HEADERS(),
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
  return r.ok;
}

// ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  // Autenticación con el mismo CRON_SECRET
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  try {
    const { accion, valorPremio, ganador } = req.body;
    // accion      → 'repartir' | 'reservar'
    // valorPremio → número (ej: 100, 500, 50000)
    // ganador     → string opcional (nombre/email del ganador, solo si accion='repartir')

    if (!accion || !valorPremio) {
      return res.status(400).json({ ok: false, error: 'Faltan accion y valorPremio' });
    }

    const repo         = process.env.SORTEO_STATE_REPO;
    const estadoResult = await ghGet(repo, 'sorteo-estado.json');

    let estado = {
      premiosOtorgados: [],
      boteGastado:      0,
      ultimoAviso:      {},
      reservas:         {},
    };
    let sha;

    if (estadoResult) {
      estado = estadoResult.data;
      sha    = estadoResult.sha;
    }

    if (accion === 'repartir') {
      // Registrar el premio como otorgado
      if (!estado.premiosOtorgados) estado.premiosOtorgados = [];
      estado.premiosOtorgados.push({
        valor:   valorPremio,
        fecha:   new Date().toISOString(),
        ganador: ganador || 'Sin registrar',
      });
      // Descontar del bote
      estado.boteGastado = (estado.boteGastado || 0) + valorPremio;
      // Limpiar cooldown para este premio (ya se repartió, no hace falta avisar)
      if (estado.ultimoAviso) delete estado.ultimoAviso[valorPremio];

    } else if (accion === 'reservar') {
      // Silenciar el aviso 7 días para este premio
      const SIETE_DIAS = 7 * 24 * 60 * 60 * 1000;
      if (!estado.ultimoAviso) estado.ultimoAviso = {};
      estado.ultimoAviso[valorPremio] = Date.now() + SIETE_DIAS - (24 * 60 * 60 * 1000);
      // Nota: check-sorteo comprueba si han pasado 24h desde ultimoAviso,
      // así que poner ultimoAviso = ahora+6días hace que no avise 7 días más.

      if (!estado.reservas) estado.reservas = {};
      estado.reservas[valorPremio] = {
        fecha:  new Date().toISOString(),
        motivo: 'Reservado manualmente desde el panel',
      };
    } else {
      return res.status(400).json({ ok: false, error: 'accion debe ser repartir o reservar' });
    }

    // Guardar estado actualizado
    const ok = await ghPut(
      repo,
      'sorteo-estado.json',
      estado,
      sha,
      `sorteo: ${accion} premio ${valorPremio}€`
    );

    return res.status(200).json({ ok, estado });

  } catch (err) {
    console.error('[sorteo-accion]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
