const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'dtk3o4xcz';
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'zmzuruzm';

export const uploadToCloudinary = async (file: File): Promise<string> => {
  if (!CLOUD_NAME || !UPLOAD_PRESET) {
    throw new Error(
      'Cloudinary no configurado. Falta el Cloud Name de Cloudinary.'
    );
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/auto/upload`,
    { method: 'POST', body: formData }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Error subiendo a Cloudinary');
  }

  const data = await res.json();
  return data.secure_url as string;
};

export const processMediaFile = async (
  file: File
): Promise<{ url: string; type: 'image' | 'video' }> => {
  const isVideo = file.type.startsWith('video/');

  if (isVideo) {
    try {
      const res = await fetch('/api/mux/upload', {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error initializing Mux upload');
      }
      
      const { url, uploadId } = await res.json();
      
      const uploadRes = await fetch(url, {
        method: 'PUT',
        body: file,
        headers: {
            'Content-Type': file.type,
        }
      });
      
      if (!uploadRes.ok) throw new Error('Error uploading direct to Mux');
      
      // Poll for readiness
      return new Promise((resolve, reject) => {
        let attempts = 0;
        const interval = setInterval(async () => {
          attempts++;
          if (attempts > 30) {
              clearInterval(interval);
              reject(new Error('Timeout processing video in Mux'));
          }
          try {
              const pollRes = await fetch(`/api/mux/asset/${uploadId}`);
              if (pollRes.ok) {
                const data = await pollRes.json();
                if (data.url) {
                  clearInterval(interval);
                  resolve({ url: data.url, type: 'video' });
                }
              }
          } catch(e) {
              // ignore fetch errors on poll and try again
          }
        }, 3000);
      });
    } catch (e: any) {
        console.error("Mux error:", e);
        throw new Error("Error subiendo video con Mux. " + (e.message || String(e)));
    }
  }

  // Img
  const url = await uploadToCloudinary(file);
  return { url, type: 'image' };
};
