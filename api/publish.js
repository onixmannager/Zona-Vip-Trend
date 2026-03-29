export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { repo, zone } = req.body;
  const apiBase = `https://api.github.com/repos/${repo}/contents/zones.json`;
  const headers = {
    Authorization: `Bearer ${process.env.GH_TOKEN}`,
    'Content-Type': 'application/json',
    'User-Agent': 'mosaico-vercel'
  };

  // Leer zones.json actual (puede no existir si el repo es nuevo)
  let zones = [], sha;
  const get = await fetch(apiBase, { headers });
  if (get.ok) {
    const j = await get.json();
    sha = j.sha;
    zones = JSON.parse(Buffer.from(j.content, 'base64').toString());
  }

  // Añadir la nueva zona y guardar
  zones.push(zone);
  const put = await fetch(apiBase, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `zone ${zone.id}`,
      content: Buffer.from(JSON.stringify(zones)).toString('base64'),
      ...(sha ? { sha } : {})
    })
  });

  res.status(200).json({ ok: put.ok });
}
