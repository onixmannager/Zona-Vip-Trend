// compras.js
// Módulo 2 PRO: Compras + Cloudinary directo + temporales

// 🔧 IMPORTS FIREBASE (ajusta según tu config)
import {
  serverTimestamp,
  arrayUnion,
  writeBatch,
  doc,
  collection
} from "firebase/firestore";

// ═══════════════════════════════════════════════════════════════
// ⚙️ CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════
const CLOUDINARY_CONFIG = {
  cloudName: 'TU_CLOUD_NAME',
  uploadPreset: 'TU_UPLOAD_PRESET'
};

const PRECIO_POR_CELDA = 50;
const STORAGE_KEY = 'pendingPurchaseData';
const TIEMPO_MAX = 15 * 60 * 1000; // 15 min

// ═══════════════════════════════════════════════════════════════
// 🟢 1. SUBIR IMAGEN TEMPORAL A CLOUDINARY
// ═══════════════════════════════════════════════════════════════
async function subirImagenTemporal(file) {

  if (!file) throw new Error('No hay archivo');
  if (file.size > 2 * 1024 * 1024) {
    throw new Error('Imagen demasiado grande (max 2MB)');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_CONFIG.uploadPreset);
  formData.append('folder', 'temp'); // 🔥 carpeta temporal

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CONFIG.cloudName}/image/upload`;

  const res = await fetch(url, { method: 'POST', body: formData });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error?.message || 'Error al subir imagen');
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
    link,
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
    throw new Error('Datos incompletos');
  }

  const batch = writeBatch(db);

  // zones
  const zoneRef = doc(collection(db, 'zones'));

  batch.set(zoneRef, {
    email: user.email,
    celdas,
    link: link || '',
    imgPublicId: publicId,
    r1: zonaCoords.r1,
    c1: zonaCoords.c1,
    r2: zonaCoords.r2,
    c2: zonaCoords.c2,
    n: zonaCoords.n,
    total: zonaCoords.n * PRECIO_POR_CELDA,
    fechaCompra: serverTimestamp()
  });

  // users
  const userRef = doc(db, 'users', user.uid);

  batch.set(userRef, {
    email: user.email,
    vip: true,
    celdas: arrayUnion(...celdas)
  }, { merge: true });

  await batch.commit();

  return { success: true, zoneId: zoneRef.id };
}

// ═══════════════════════════════════════════════════════════════
// 🟣 5. POST-PAGO (FLUJO FINAL)
// ═══════════════════════════════════════════════════════════════
async function ejecutarFlujoPostPago(db, auth) {

  const datos = recuperarDatosCompra();
  if (!datos) {
    console.warn('No hay datos de compra');
    return;
  }

  const { publicId, celdas, link, zonaCoords } = datos;

  const result = await procesarCompraExitosa({
    publicId,
    celdas,
    link,
    zonaCoords
  }, db, auth);

  limpiarDatosCompra();

  return result;
}

// ═══════════════════════════════════════════════════════════════
// 🧹 6. LIMPIEZA AUTOMÁTICA SI NO PAGA
// ═══════════════════════════════════════════════════════════════
async function limpiarImagenTemporalSiExpirada() {

  const data = recuperarDatosCompra();
  if (!data) return;

  const ahora = Date.now();

  if (ahora - data.timestamp > TIEMPO_MAX) {

    // ⚠️ esto debe ser backend en producción
    await borrarImagenCloudinary(data.publicId);

    limpiarDatosCompra();

    console.log('🧹 Imagen temporal eliminada');
  }
}

// ═══════════════════════════════════════════════════════════════
// 🔥 7. BORRAR IMAGEN (BACKEND NECESARIO)
// ═══════════════════════════════════════════════════════════════
async function borrarImagenCloudinary(publicId) {

  // 🔴 IMPORTANTE:
  // Esto en producción debe ir a tu backend

  try {
    await fetch('/delete-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicId })
    });
  } catch (e) {
    console.warn('No se pudo borrar imagen (backend pendiente)');
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
