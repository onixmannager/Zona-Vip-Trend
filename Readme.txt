numero de zonas 3240 




No puedo guardar memoria entre conversaciones — cada vez que empiezas una nueva sesión parto de cero y no recuerdo nada de lo que hemos hablado hoy.

Lo que sí puedes hacer tú es guardar el contexto para la próxima vez. Te recomiendo copiar esto y guardarlo en un archivo de texto o Notion:

---

**Contexto proyecto ZonaVIP Mosaico**

App de mosaico de pixels donde se compran zonas con PayPal o Stripe. Stack: HTML estático + Vercel serverless functions + GitHub como base de datos de imágenes y zonas.

**Archivos api/ y su estado:**
- `create-order.js` — crea orden PayPal ✅
- `verify-paypal.js` — verifica pago PayPal, emite token HMAC ✅ (actualizado hoy)
- `verify-stripe.js` — crea PaymentIntent + verifica pago Stripe, emite token HMAC ✅ (nuevo hoy)
- `publish.js` — valida token HMAC de ambos métodos, guarda zona en GitHub ✅ (actualizado hoy)
- `upload.js` — sube imagen a GitHub con Sharp ✅
- `check-sorteo.js` — cron cada hora, avisa al admin por email si hay bote ✅
- `sorteo-accion.js` — panel admin para repartir/reservar premios ✅

**Pendiente antes de producción:**
- Poner `STRIPE_SK` y `STRIPE_PK` reales (live)
- Generar `UPLOAD_SECRET` y ponerlo en Vercel
- Variables PayPal en live
- `GH_TOKEN` y cambiar `TU_USUARIO` en el HTML
- `SORTEO_STATE_REPO`, `CRON_SECRET`, `ADMIN_EMAIL`, `RESEND_API_KEY`
- Verificar dominio en resend.com
- Cambiar `PAYPAL_MODE` a `live` en HTML y Vercel
- Añadir `"stripe": "^14.0.0"` al `package.json`

---

Con esto en el primer mensaje de la próxima sesión me pones al día en segundos.

