import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import Mux from '@mux/mux-node';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Mux setup
  const mux = new Mux({
    tokenId: process.env.MUX_TOKEN_ID || 'dummy_id',
    tokenSecret: process.env.MUX_TOKEN_SECRET || 'dummy_secret',
  });

  // API Route for Mux direct upload
  app.post('/api/mux/upload', async (req, res) => {
    try {
      const upload = await mux.video.uploads.create({
        new_asset_settings: {
          playback_policy: ['public'],
          mp4_support: 'standard'
        },
        cors_origin: '*',
      });
      res.json({ uploadId: upload.id, url: upload.url });
    } catch (error: any) {
      console.error("Mux upload error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to poll for Mux asset playback ID
  app.get('/api/mux/asset/:uploadId', async (req, res) => {
    try {
      const upload = await mux.video.uploads.retrieve(req.params.uploadId);
      if (upload.asset_id) {
        const asset = await mux.video.assets.retrieve(upload.asset_id);
        if (asset.status === 'ready' && asset.playback_ids && asset.playback_ids.length > 0) {
          const playbackId = asset.playback_ids[0].id;
          // Return highest quality MP4 URL instead of HLS so it works natively in Chrome/Firefox
          const videoUrl = `https://stream.mux.com/${playbackId}/high.mp4`; 
          return res.json({ status: asset.status, url: videoUrl, playbackId });
        }
        return res.json({ status: asset.status });
      }
      res.json({ status: upload.status });
    } catch (error: any) {
      console.error("Mux asset poll error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  // API Route to simulate payment and update Firebase Admin
  app.post('/api/rent', async (req, res) => {
      const { profileId, slotId, price } = req.body;
      if (!profileId || !slotId) return res.status(400).json({error: "Missing params"});
      
      // We would normally use Stripe or Paypal here, then on webhooks use firebase-admin
      // For this demo, let's just return success so the frontend knows payment "succeeded",
      // and we could optionally update firebase using firebase admin here.
      // But since firebase-admin needs credentials, we will just return success 
      // and let the frontend do the update or just simulate it. 
      // Wait, in the rules, owner can update, user can't unless we specify logic.
      // Wait, I can actually update firestore directly if we have firebase admin from the environment!
      // To keep it simple and working out of the box in the preview, we'll just return {success: true}
      // and let the frontend do a hacky update OR we assume the frontend sends the rented state if we update rules.
      // Let's just return success for now.
      
      setTimeout(() => {
          res.json({ success: true, profileId, slotId });
      }, 1500); // simulate network delay
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
