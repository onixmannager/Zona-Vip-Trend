export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { repo, filename, content } = req.body;

  const r = await fetch(
    `https://api.github.com/repos/${repo}/contents/${filename}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        'Content-Type': 'application/json',
        'User-Agent': 'mosaico-vercel'
      },
      body: JSON.stringify({ message: `add ${filename}`, content })
    }
  );

  res.status(200).json({ ok: r.ok });
}
