export const processMediaFile = async (file: File): Promise<{url: string, type: 'image'|'video'}> => {
  if (file.type.startsWith('video/')) {
    // 1. Get direct upload URL from server
    const muxRes = await fetch('/api/mux/upload', { method: 'POST' });
    const { uploadId, url: uploadUrl } = await muxRes.json();
    if (!uploadUrl) throw new Error("Failed to get Mux upload URL");

    // 2. Upload file to Mux Direct Upload URL
    await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type
      },
      body: file
    });

    // 3. Poll for the asset to be ready and get the stream URL (MP4)
    return new Promise((resolve, reject) => {
      let attempts = 0;
      const interval = setInterval(async () => {
        try {
          attempts++;
          if (attempts > 60) { // Timeout after 2 minutes
             clearInterval(interval);
             reject(new Error("Mux processing timeout"));
             return;
          }
          const pollRes = await fetch(`/api/mux/asset/${uploadId}`);
          const assetData = await pollRes.json();
          if (assetData.status === 'ready' && assetData.url) {
            clearInterval(interval);
            resolve({
              url: assetData.url,
              type: 'video'
            });
          } else if (assetData.status === 'errored') {
            clearInterval(interval);
            reject(new Error("Mux processing failed"));
          }
        } catch (e) {
            console.error("Polling error", e);
        }
      }, 2000);
    });
  }

  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // Max dimensions to avoid Firestore 1MB document limit
        const MAX_SIZE = 400;
        if (width > height) {
          if (width > MAX_SIZE) {
            height *= MAX_SIZE / width;
            width = MAX_SIZE;
          }
        } else {
          if (height > MAX_SIZE) {
            width *= MAX_SIZE / height;
            height = MAX_SIZE;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject('No canvas context');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Compress to JPEG standard quality
        const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
        resolve(dataUrl);
      };
      img.onerror = () => reject('Failed to load image');
      if (e.target?.result) {
        img.src = e.target.result as string;
      } else {
        reject('No result from FileReader');
      }
    };
    reader.onerror = () => reject('FileReader error');
    reader.readAsDataURL(file);
  });

  return { url, type: 'image' };
};

export const uploadToCloudinary = async (file: File): Promise<string> => {
  const result = await processMediaFile(file);
  return result.url;
};
