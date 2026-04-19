// compras.js
// Módulo 2 PRO: Compras + Cloudinary directo + temporales

// ✅ FIX 1: Import desde CDN (compatible con navegador, igual que index.html)
import {
  serverTimestamp,
  arrayUnion,
  writeBatch,
  doc,
  collection
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ═══════════════════════════════════════════════════════════════
// ⚙️ CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════
const CLOUDINARY_CONFIG = {
  cloudName:    'TU_CLOUD_NAME',     // → tu cloud name real
  uploadPreset: 'TU_UPLOAD_PRESET'   // → upload preset unsigned
};

const PRECIO_POR_CELDA = 50;
const STORAGE_KEY = 'pendingPurchaseData';
const TIEMPO_MAX = 15 * 60 * 1000; // 15 min

// ✅ FIX advertencia 1: exportar cloudName para que index.html construya URLs
export const _cloudName = CLOUDINARY_CONFIG.cloudName;

// ═══════════════════════════════════════════════════════════════
// 🟢 1. SUBIR IMAGEN TEMPORAL A CLOUDINARY
// ═══════════════════════════════════════════════════════════════
async function subirImagenTemporal(file) {

  if (!file) throw new Error('No hay archivo');

  // ✅ FIX 2: límite unificado a 10MB (igual que index.html)
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('Imagen demasiado grande (máx 10 MB)');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
  formData.append('folder', 'temp');

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`;

  const res  = await fetch(url, { method: 'POST', body: formData });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || 'Error al subir imagen a Cloudinary');
  }

  return {
    publicId: data.public_id
  };
}

// ═══════════════════════════════════════════════════════════════
// 🟡 2. GUARDAR DATOS TEMPORALES (ANTES DEL PAGO)
// ═══════════════════════════════════════════════════════════════
function guardarDatosCompra({ publicId, celdas, link, zonaCoords }) {

  const data = {
    publicId,
    celdas,
    link:      link || '',
    zonaCoords,
    timestamp: Date.now()
  };

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ═══════════════════════════════════════════════════════════════
// 🔵 3. RECUPERAR / LIMPIAR STORAGE
// ═══════════════════════════════════════════════════════════════
function recuperarDatosCompra() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function limpiarDatosCompra() {
  sessionStorage.removeItem(STORAGE_KEY);
}

// ═══════════════════════════════════════════════════════════════
// 🔴 4. PROCESAR COMPRA EN FIRESTORE
// ═══════════════════════════════════════════════════════════════
async function procesarCompraExitosa({ publicId, celdas, link, zonaCoords }, db, auth) {

  const user = auth.currentUser;
  if (!user) throw new Error('Usuario no autenticado');

  if (!celdas?.length || !publicId || !zonaCoords) {
    throw new Error('Datos de compra incompletos');
  }

  const batch = writeBatch(db);

  // — Documento en /zones —
  const zoneRef = doc(collection(db, 'zones'));

  batch.set(zoneRef, {
    uid:         user.uid,
    email:       user.email,
    celdas,
    link:        link || '',
    imgPublicId: publicId,
    // URLs generadas en Firestore — las transformaciones reales las aplican
    // cloudinaryMosaico() y cloudinaryModal() en el frontend según contexto.
    // Aquí guardamos solo la base para que el frontend pueda reconstruirlas.
    // imgUrl  → thumbnail para el mosaico (fit sin recorte, fondo oscuro)
    // imgUrlFull → modal y feed (350px, WebP automático)
    imgUrl:      `https://res.cloudinary.com/${CLOUDINARY_CONFIG.cloudName}/image/upload/w_400,h_400,c_fit,f_auto,q_auto,b_rgb:08090F/${publicId}`,
    imgUrlFull:  `https://res.cloudinary.com/${CLOUDINARY_CONFIG.cloudName}/image/upload/w_350,f_auto,q_auto/${publicId}`,
    r1:          zonaCoords.r1,
    c1:          zonaCoords.c1,
    r2:          zonaCoords.r2,
    c2:          zonaCoords.c2,
    n:           zonaCoords.n,
    total:       zonaCoords.n * PRECIO_POR_CELDA,
    fechaCompra: serverTimestamp()
  });

  // — Documento en /users/{uid} —
  // ✅ FIX 3: evitar spread masivo, partir en chunks de 500
  const userRef = doc(db, 'users', user.uid);
  const MAX_UNION = 500;
  const chunks = [];
  for (let i = 0; i < celdas.length; i += MAX_UNION) {
    chunks.push(celdas.slice(i, i + MAX_UNION));
  }

  batch.set(userRef, {
    email:  user.email,
    vip:    true,
    celdas: arrayUnion(...chunks[0])
  }, { merge: true });

  await batch.commit();

  // Chunks adicionales si los hay
  for (let c = 1; c < chunks.length; c++) {
    const extraBatch = writeBatch(db);
    extraBatch.set(userRef, { celdas: arrayUnion(...chunks[c]) }, { merge: true });
    await extraBatch.commit();
  }

  return { success: true, zoneId: zoneRef.id };
}

// ═══════════════════════════════════════════════════════════════
// 🟣 5. POST-PAGO (FLUJO FINAL)
// ═══════════════════════════════════════════════════════════════
async function ejecutarFlujoPostPago(db, auth) {

  const datos = recuperarDatosCompra();

  // ✅ FIX 4: devolver objeto consistente en lugar de undefined
  if (!datos) {
    console.warn('[compras.js] No hay datos de compra pendientes.');
    return { success: false, reason: 'no_pending_data' };
  }

  const { publicId, celdas, link, zonaCoords } = datos;

  const result = await procesarCompraExitosa({
    publicId, celdas, link, zonaCoords
  }, db, auth);

  limpiarDatosCompra();

  return result; // { success: true, zoneId: '...' }
}

// ═══════════════════════════════════════════════════════════════
// 🧹 6. LIMPIEZA AUTOMÁTICA SI NO PAGA
// ═══════════════════════════════════════════════════════════════
async function limpiarImagenTemporalSiExpirada() {

  const data = recuperarDatosCompra();
  if (!data) return;

  if (Date.now() - data.timestamp > TIEMPO_MAX) {
    await borrarImagenCloudinary(data.publicId);
    limpiarDatosCompra();
    console.log('[compras.js] Imagen temporal expirada eliminada:', data.publicId);
  }
}

// ═══════════════════════════════════════════════════════════════
// 🔥 7. BORRAR IMAGEN EN CLOUDINARY (requiere endpoint backend)
// ═══════════════════════════════════════════════════════════════
async function borrarImagenCloudinary(publicId) {
  // La API Secret de Cloudinary NUNCA va en el frontend.
  // Tu backend firma la petición y llama a Cloudinary.
  try {
    const res = await fetch('/delete-image', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ publicId })
    });
    if (!res.ok) console.warn('[compras.js] /delete-image respondió con error:', res.status);
  } catch (e) {
    console.warn('[compras.js] No se pudo contactar /delete-image (backend pendiente).');
  }
}

// ═══════════════════════════════════════════════════════════════
// 🚀 EXPORTS
// ═══════════════════════════════════════════════════════════════
export {
  subirImagenTemporal,
  guardarDatosCompra,
  ejecutarFlujoPostPago,
  limpiarImagenTemporalSiExpirada
};
// _cloudName se exporta arriba como named export (export const)
