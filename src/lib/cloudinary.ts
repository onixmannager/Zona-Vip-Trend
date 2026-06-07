// Upload media to Cloudinary (images & videos via unsigned preset)

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

/**
 * Process any media file (image or video) and return a usable URL + type.
 *
 * Both images and videos REQUIRE Cloudinary. If not configured, throws a clear error.
 */
export const processMediaFile = async (
  file: File
): Promise<{ url: string; type: 'image' | 'video'; publicId?: string }> => {
  if (!hasCloudinary) {
    throw new Error(
      'Para subir imágenes y videos necesitas configurar Cloudinary. ' +
      'Añade VITE_CLOUDINARY_CLOUD_NAME y VITE_CLOUDINARY_UPLOAD_PRESET en tu archivo .env'
    );
  }

  const isVideo = file.type.startsWith('video/');
  const { secure_url, public_id } = await uploadToCloudinaryDirect(file);
  return { url: secure_url, type: isVideo ? 'video' : 'image', publicId: public_id };
};

/** Convenience wrapper — returns only the URL string. */
export const uploadToCloudinary = async (file: File): Promise<string> => {
  const result = await processMediaFile(file);
  return result.url;
};
