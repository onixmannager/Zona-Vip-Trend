// Upload media to Cloudinary (images & videos via unsigned preset)
// Falls back to canvas-compressed base64 for images if Cloudinary is not configured.

const CLOUD_NAME = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || '';
const UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || '';
const hasCloudinary = !!CLOUD_NAME && !!UPLOAD_PRESET;

/** Upload a file to Cloudinary using an unsigned upload preset. */
async function uploadToCloudinaryDirect(file: File): Promise<{ secure_url: string; public_id: string }> {
  const resourceType = file.type.startsWith('video/') ? 'video' : 'image';
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD_NAME}/${resourceType}/upload`,
    { method: 'POST', body: formData }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `Cloudinary error ${res.status}`);
  }

  const data = await res.json();
  return { secure_url: data.secure_url as string, public_id: data.public_id as string };
}

/** Compress an image to JPEG base64 via canvas (no external service needed). */
async function compressImageToBase64(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;

        const MAX_SIZE = 400;
        if (width > height) {
          if (width > MAX_SIZE) { height = Math.round(height * MAX_SIZE / width); width = MAX_SIZE; }
        } else {
          if (height > MAX_SIZE) { width = Math.round(width * MAX_SIZE / height); height = MAX_SIZE; }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject('No canvas context');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject('Failed to load image');
      if (e.target?.result) img.src = e.target.result as string;
      else reject('No result from FileReader');
    };
    reader.onerror = () => reject('FileReader error');
    reader.readAsDataURL(file);
  });
}

/**
 * Process any media file (image or video) and return a usable URL + type.
 *
 * - Images: if Cloudinary is configured → upload there; otherwise compress to base64.
 * - Videos: REQUIRE Cloudinary. If not configured, throw a clear error.
 */
export const processMediaFile = async (
  file: File
): Promise<{ url: string; type: 'image' | 'video'; publicId?: string }> => {
  const isVideo = file.type.startsWith('video/');

  if (isVideo) {
    if (!hasCloudinary) {
      throw new Error(
        'Para subir videos necesitas configurar Cloudinary. ' +
        'Añade VITE_CLOUDINARY_CLOUD_NAME y VITE_CLOUDINARY_UPLOAD_PRESET en tu archivo .env'
      );
    }
    const { secure_url, public_id } = await uploadToCloudinaryDirect(file);
    return { url: secure_url, type: 'video', publicId: public_id };
  }

  // Image path
  if (hasCloudinary) {
    const { secure_url, public_id } = await uploadToCloudinaryDirect(file);
    return { url: secure_url, type: 'image', publicId: public_id };
  }

  // Fallback: base64 compressed
  const url = await compressImageToBase64(file);
  return { url, type: 'image' };
};

/** Convenience wrapper — returns only the URL string. */
export const uploadToCloudinary = async (file: File): Promise<string> => {
  const result = await processMediaFile(file);
  return result.url;
};
