const express = require('express');
const path = require('path');

async function createMuxClient() {
  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;

  if (!tokenId || !tokenSecret) {
    return null;
  }

  const muxModule = await import('@mux/mux-node');
  const Mux = muxModule.default;
  return new Mux({tokenId, tokenSecret});
}

async function startServer() {
  const app = express();
  const port = Number(process.env.PORT || 3000);
  const mux = await createMuxClient();
  const isProduction = process.env.NODE_ENV === 'production' || path.basename(__dirname) === 'dist';

  app.use(express.json({limit: '10mb'}));

  app.post('/api/mux/upload', async (_req, res) => {
    if (!mux) {
      return res.status(503).json({error: 'Mux is not configured'});
    }

    try {
      const upload = await mux.video.uploads.create({
        new_asset_settings: {
          playback_policy: ['public'],
        },
        cors_origin: '*',
      });

      res.json({uploadId: upload.id, url: upload.url});
    } catch (error) {
      console.error('Mux upload error:', error);
      res.status(500).json({error: error instanceof Error ? error.message : 'Mux upload failed'});
    }
  });

  app.get('/api/mux/asset/:uploadId', async (req, res) => {
    if (!mux) {
      return res.status(503).json({error: 'Mux is not configured'});
    }

    try {
      const upload = await mux.video.uploads.retrieve(req.params.uploadId);
      if (upload.asset_id) {
        const asset = await mux.video.assets.retrieve(upload.asset_id);
        const playbackId = asset.playback_ids?.[0]?.id;

        if (playbackId) {
          return res.json({
            status: asset.status,
            url: `https://stream.mux.com/${playbackId}.m3u8`,
            playbackId,
            assetId: asset.id,
          });
        }

        return res.json({status: asset.status, assetId: asset.id});
      }

      res.json({status: upload.status});
    } catch (error) {
      console.error('Mux asset poll error:', error);
      res.status(500).json({error: error instanceof Error ? error.message : 'Mux asset lookup failed'});
    }
  });

  app.delete('/api/mux/asset/:assetId', async (req, res) => {
    if (!mux) {
      return res.status(503).json({error: 'Mux is not configured'});
    }
    try {
      await mux.video.assets.delete(req.params.assetId);
      res.json({success: true});
    } catch (error) {
      console.error('Mux asset delete error:', error);
      res.status(500).json({error: error instanceof Error ? error.message : 'Mux asset delete failed'});
    }
  });

  app.post('/api/rent', (req, res) => {
    const {profileId, slotId} = req.body;

    if (!profileId || !slotId) {
      return res.status(400).json({error: 'Missing params'});
    }

    setTimeout(() => {
      res.json({success: true, profileId, slotId});
    }, 1500);
  });

  if (!isProduction) {
    const {createServer: createViteServer} = await import('vite');
    const vite = await createViteServer({
      configLoader: 'runner',
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname);
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
