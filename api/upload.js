// api/upload.js
// Recibe la imagen del usuario, genera 2 versiones WebP con Sharp,
// y sube ambas a GitHub.
//
// · thumb  → 500×557 WebP ≈ 0.4 KB  (va en la celda del mosaico)
// · full   → 500×557 WebP ≈ 200 KB  (abre en el modal al hacer clic)

import sharp from 'sharp';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '12mb',   // la imagen original puede llegar en base64
    },
  },
};

// ── Parámetros de imagen ──────────────────────────────────────────
const W = 500;
const H = 557;

// Calidad thumb: WebP con calidad muy baja + sin metadatos
// Sharp en quality:1 + effort:6 consigue ≈ 0.4 KB para 500×557
const THUMB_QUALITY   = 2;   // 1-100 (muy bajo a propósito)
const THUMB_EFFORT    = 6;   // 0-6 (mayor = más compresión)

// Calidad full: WebP equilibrado ≈ 200 KB
const FULL_QUALITY    = 72;
const FULL_EFFORT     = 4;

// ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Method not allowed' });

  try {
    const { repo, filename, content } = req.body;

    if (!repo || !filename || !content) {
      return res.status(400).json({ ok: false, error: 'Faltan campos: repo, filename, content' });
    }
    if (!process.env.GH_TOKEN) {
      return res.status(500).json({ ok: false, error: 'GH_TOKEN no configurado en Vercel' });
    }

    // 1) Decodificar base64 → Buffer
    const inputBuffer = Buffer.from(content, 'base64');

    // 2) Generar versión THUMB (≈ 0.4 KB)
    const thumbBuffer = await sharp(inputBuffer)
      .resize(W, H, { fit: 'cover', position: 'centre' })
      .webp({ quality: THUMB_QUALITY, effort: THUMB_EFFORT, smartSubsample: true })
      .toBuffer();

    // 3) Generar versión FULL (≈ 200 KB)
    const fullBuffer = await sharp(inputBuffer)
      .resize(W, H, { fit: 'cover', position: 'centre' })
      .webp({ quality: FULL_QUALITY, effort: FULL_EFFORT })
      .toBuffer();

    // 4) Construir nombres de archivo
    //    El frontend envía p.ej. "img_17XXXX_abc4.jpg"
    //    Nosotros guardamos "img_17XXXX_abc4_thumb.webp" y "img_17XXXX_abc4_full.webp"
    const baseName = filename.replace(/\.[^.]+$/, ''); // quitar extensión original
    const thumbFilename = `${baseName}_thumb.webp`;
    const fullFilename  = `${baseName}_full.webp`;

    // 5) Subir ambos ficheros a GitHub en paralelo
    const [thumbRes, fullRes] = await Promise.all([
      uploadToGitHub(repo, thumbFilename, thumbBuffer.toString('base64')),
      uploadToGitHub(repo, fullFilename,  fullBuffer.toString('base64')),
    ]);

    if (!thumbRes.ok || !fullRes.ok) {
      return res.status(502).json({ ok: false, error: 'Error al subir a GitHub' });
    }

    // 6) Devolver las URLs de jsDelivr para cada versión
    const cdnBase    = `https://cdn.jsdelivr.net/gh/${repo}@main`;
    const thumbUrl   = `${cdnBase}/${thumbFilename}`;
    const fullUrl    = `${cdnBase}/${fullFilename}`;

    return res.status(200).json({ ok: true, thumbUrl, fullUrl });

  } catch (err) {
    console.error('[upload] Error:', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

// ── Helper: sube un buffer a GitHub como fichero nuevo ────────────
async function uploadToGitHub(repo, filename, base64Content) {
  const url = `https://api.github.com/repos/${repo}/contents/${filename}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization:  `Bearer ${process.env.GH_TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent':   'mosaico-vercel',
    },
    body: JSON.stringify({
      message: `add ${filename}`,
      content: base64Content,
    }),
  });
  return r;
}
