// api/check-sorteo.js
// Cron job de Vercel — se ejecuta cada hora automáticamente.
// Calcula el bote acumulado, compara con los premios pendientes
// y envía un email SOLO AL ADMIN cuando hay bote suficiente para un premio.
//
// Variables de entorno necesarias en Vercel:
//   GH_TOKEN          → token de GitHub (para leer zones.json)
//   ADMIN_EMAIL       → tu email donde recibirás los avisos
//   RESEND_API_KEY    → API key de Resend (resend.com — gratis hasta 3000 emails/mes)
//   SORTEO_STATE_REPO → repo donde guardar el estado (ej: 'tuusuario/mosaico-imgs-1')

export const config = { maxDuration: 30 };

// ── Configuración del mosaico (debe coincidir con el HTML) ────────
const MOSAICO_CFG = {
  PRECIO:          50,       // € por celda
  TOTAL_CELDAS:    13040,    // total de celdas
  PCT_PREMIOS:     0.35,     // 35% de la recaudación va a premios

  // Lista completa de premios { valor, cantidad }
  // Puedes modificar estos valores antes del lanzamiento
  PREMIOS: [
    { valor: 100,    cantidad: 600 },
    { valor: 250,    cantidad: 100 },
    { valor: 500,    cantidad: 50  },
    { valor: 1000,   cantidad: 10  },
    { valor: 3000,   cantidad: 10  },
    { valor: 10000,  cantidad: 1   },
    { valor: 20000,  cantidad: 1   },
    { valor: 50000,  cantidad: 1   },
  ],
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
  await fetch(`https://api.github.com/repos/${repo}/contents/${file}`, {
    method: 'PUT',
    headers: GH_HEADERS(),
    body: JSON.stringify({
      message,
      content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'),
      ...(sha ? { sha } : {}),
    }),
  });
}

// ── Leer zones.json de todos los repos ───────────────────────────
async function loadAllZones(repos) {
  let zones = [];
  for (const repo of repos) {
    const result = await ghGet(repo, 'zones.json');
    if (result && Array.isArray(result.data)) zones = zones.concat(result.data);
  }
  return zones;
}

// ── Enviar email via Resend ───────────────────────────────────────
async function sendEmail(subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from:    'ZonaVIP Sorteos <sorteos@tudominio.com>',  // cambia por tu dominio verificado en Resend
      to:      [process.env.ADMIN_EMAIL],
      subject,
      html,
    }),
  });
  return r.ok;
}

// ── Generar HTML del email ────────────────────────────────────────
function emailHtml({ bote, premiosDisponibles, totalVendidas, totalRecaudado, boterReservado }) {
  const filas = premiosDisponibles.map(p => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid #1a2040;font-family:monospace;color:#EDD780;font-size:1rem;font-weight:700">
        ${p.valor.toLocaleString('es-ES')} €
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #1a2040;color:#8A99BB;font-size:.85rem">
        ${p.cantidad} disponible${p.cantidad > 1 ? 's' : ''}
      </td>
      <td style="padding:10px 14px;border-bottom:1px solid #1a2040;color:#48c778;font-size:.85rem">
        ✓ Bote suficiente
      </td>
    </tr>
  `).join('');

  return `
  <!DOCTYPE html>
  <html>
  <body style="margin:0;padding:0;background:#06080F;font-family:'DM Sans',Arial,sans-serif;color:#EEF2FF">
    <div style="max-width:540px;margin:32px auto;background:#0C1022;border:1px solid rgba(201,168,76,0.2);border-radius:14px;overflow:hidden">
      
      <div style="background:linear-gradient(135deg,#7A6020,#C9A84C);padding:24px 28px">
        <div style="font-size:1.4rem;font-weight:700;letter-spacing:.06em;color:#000">🏆 ZonaVIP Trends</div>
        <div style="font-size:.8rem;color:rgba(0,0,0,0.65);margin-top:4px;letter-spacing:.1em;text-transform:uppercase">Aviso de Sorteo</div>
      </div>

      <div style="padding:28px">
        <div style="font-size:1rem;color:#EEF2FF;margin-bottom:20px;line-height:1.6">
          El bote de premios ha alcanzado un umbral. Puedes realizar un sorteo ahora o seguir acumulando.
        </div>

        <div style="display:grid;gap:10px;margin-bottom:24px">
          <div style="background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.75rem;color:#8A99BB;text-transform:uppercase;letter-spacing:.1em">Bote disponible</span>
            <span style="font-size:1.4rem;font-weight:700;color:#EDD780;font-family:monospace">${bote.toLocaleString('es-ES')} €</span>
          </div>
          <div style="background:rgba(0,229,255,0.06);border:1px solid rgba(0,229,255,0.15);border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.75rem;color:#8A99BB;text-transform:uppercase;letter-spacing:.1em">Celdas vendidas</span>
            <span style="font-size:1.1rem;font-weight:700;color:#00E5FF;font-family:monospace">${totalVendidas.toLocaleString('es-ES')}</span>
          </div>
          <div style="background:rgba(72,199,120,0.06);border:1px solid rgba(72,199,120,0.15);border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.75rem;color:#8A99BB;text-transform:uppercase;letter-spacing:.1em">Total recaudado</span>
            <span style="font-size:1.1rem;font-weight:700;color:#48c778;font-family:monospace">${totalRecaudado.toLocaleString('es-ES')} €</span>
          </div>
          ${boterReservado > 0 ? `
          <div style="background:rgba(180,130,255,0.06);border:1px solid rgba(180,130,255,0.15);border-radius:10px;padding:14px 18px;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:.75rem;color:#8A99BB;text-transform:uppercase;letter-spacing:.1em">Reservado (sin usar)</span>
            <span style="font-size:1.1rem;font-weight:700;color:#b482ff;font-family:monospace">${boterReservado.toLocaleString('es-ES')} €</span>
          </div>` : ''}
        </div>

        <div style="font-size:.75rem;color:#8A99BB;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px">Premios que puedes repartir ahora:</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #1a2040;border-radius:8px;overflow:hidden;margin-bottom:24px">
          <thead>
            <tr style="background:rgba(255,255,255,0.03)">
              <th style="padding:8px 14px;text-align:left;font-size:.65rem;color:#4A5878;text-transform:uppercase;letter-spacing:.1em">Premio</th>
              <th style="padding:8px 14px;text-align:left;font-size:.65rem;color:#4A5878;text-transform:uppercase;letter-spacing:.1em">Stock</th>
              <th style="padding:8px 14px;text-align:left;font-size:.65rem;color:#4A5878;text-transform:uppercase;letter-spacing:.1em">Estado</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>

        <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:14px 18px;font-size:.75rem;color:#8A99BB;line-height:1.7">
          💡 <strong style="color:#EEF2FF">Recuerda:</strong> Si decides no hacer el sorteo ahora, 
          el bote seguirá acumulando y recibirás otro aviso cuando puedas repartir un premio mayor.
          Puedes marcar premios como "reservados" desde el panel de control.
        </div>
      </div>

      <div style="padding:16px 28px;border-top:1px solid rgba(255,255,255,0.06);font-size:.65rem;color:#4A5878;text-align:center">
        ZonaVIP Trends · Panel de Control · Este email es solo para el administrador
      </div>
    </div>
  </body>
  </html>`;
}

// ── Handler principal ─────────────────────────────────────────────
export default async function handler(req, res) {

  // Vercel Cron envía GET con el header de autenticación
  // También permitimos POST manual desde el panel
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).end();
  }

  // Protección: solo Vercel Cron o llamadas con el token correcto
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ ok: false, error: 'No autorizado' });
  }

  try {
    const repo  = process.env.SORTEO_STATE_REPO;
    const repos = process.env.GH_REPOS?.split(',') || [repo];

    // 1) Cargar zonas vendidas
    const zones        = await loadAllZones(repos);
    const totalVendidas = zones.reduce((a, z) => a + (z.n || 0), 0);
    const totalRecaudado = totalVendidas * MOSAICO_CFG.PRECIO;
    const boteTotal     = totalRecaudado * MOSAICO_CFG.PCT_PREMIOS;

    // 2) Cargar estado del sorteo (premios ya otorgados y bote gastado)
    let estadoSha;
    let estado = {
      premiosOtorgados: [],   // [{ valor, fecha }]
      boteGastado:      0,    // € ya repartidos en premios
      ultimoAviso:      {},   // { valorPremio: timestampUltimoEmail }
    };

    const estadoResult = await ghGet(repo, 'sorteo-estado.json');
    if (estadoResult) {
      estado    = estadoResult.data;
      estadoSha = estadoResult.sha;
    }

    // 3) Calcular bote disponible real (descontando lo ya repartido)
    const boteDisponible = boteTotal - (estado.boteGastado || 0);

    // 4) Calcular stock restante de cada premio
    const stockRestante = {};
    MOSAICO_CFG.PREMIOS.forEach(p => { stockRestante[p.valor] = p.cantidad; });
    (estado.premiosOtorgados || []).forEach(o => {
      if (stockRestante[o.valor] !== undefined) stockRestante[o.valor]--;
    });

    // 5) Ver qué premios podemos repartir ahora
    const premiosDisponibles = MOSAICO_CFG.PREMIOS.filter(p => {
      const stock = stockRestante[p.valor] || 0;
      return stock > 0 && boteDisponible >= p.valor;
    });

    if (premiosDisponibles.length === 0) {
      return res.status(200).json({
        ok: true,
        mensaje: 'Sin umbrales alcanzados aún',
        boteDisponible,
        totalVendidas,
      });
    }

    // 6) Comprobar si ya avisamos recientemente (no spamear)
    //    Solo avisamos una vez por premio cada 24h
    const ahora    = Date.now();
    const COOLDOWN = 24 * 60 * 60 * 1000; // 24 horas
    const premiosNuevos = premiosDisponibles.filter(p => {
      const ultimoTs = estado.ultimoAviso?.[p.valor] || 0;
      return (ahora - ultimoTs) > COOLDOWN;
    });

    if (premiosNuevos.length === 0) {
      return res.status(200).json({
        ok: true,
        mensaje: 'Ya se avisó recientemente, cooldown activo',
        boteDisponible,
      });
    }

    // 7) Enviar email
    const premioMax = Math.max(...premiosNuevos.map(p => p.valor));
    const subject   = `🏆 ZonaVIP — Bote suficiente para sorteo (hasta ${premioMax.toLocaleString('es-ES')} €)`;

    await sendEmail(subject, emailHtml({
      bote:              boteDisponible,
      premiosDisponibles: premiosNuevos,
      totalVendidas,
      totalRecaudado,
      boterReservado:    estado.boteGastado || 0,
    }));

    // 8) Actualizar timestamps de último aviso en GitHub
    premiosNuevos.forEach(p => {
      if (!estado.ultimoAviso) estado.ultimoAviso = {};
      estado.ultimoAviso[p.valor] = ahora;
    });

    await ghPut(repo, 'sorteo-estado.json', estado, estadoSha, 'update sorteo estado');

    return res.status(200).json({
      ok: true,
      emailEnviado: true,
      premiosDisponibles: premiosNuevos.map(p => p.valor),
      boteDisponible,
    });

  } catch (err) {
    console.error('[check-sorteo]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
