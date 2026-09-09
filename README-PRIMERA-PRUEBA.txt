CAHESA · CONTROL DE PAGOS — PRIMERA CONFIGURACIÓN

1. Firebase Console
   - Crea un proyecto nuevo.
   - Agrega una aplicación Web.
   - Copia la configuración del SDK.
   - Abre firebase-config.js y sustituye los valores de ejemplo.

2. Authentication
   - Firebase Console > Authentication > Sign-in method.
   - Habilita "Email/Password".
   - Para la primera prueba NO necesitas Google ni otros proveedores.

3. Firestore
   - Crea una base de datos Firestore.
   - Para producción usa reglas como las incluidas en firestore.rules.
   - La app guarda:
       users/{uid}
       users/{uid}/clients/{clientId}
       users/{uid}/payments/{paymentId}

4. Storage
   - Crea Firebase Storage.
   - Usa las reglas de storage.rules.
   - La app sube:
       users/{uid}/profile/avatar
       users/{uid}/clients/{clientId}/profile

5. Ejecutar correctamente
   IMPORTANTE: Firebase y las PWAs no deben probarse abriendo index.html con doble clic.
   Usa un servidor local.

   Si tienes VS Code:
     - instala "Live Server"
     - abre la carpeta
     - clic derecho en index.html > Open with Live Server

   O con Python:
     py -m http.server 5500

   Después abre:
     http://localhost:5500

6. Prueba completa
   - Crear cuenta
   - Cerrar sesión
   - Iniciar sesión
   - "¿Olvidaste tu contraseña?" y comprobar que llegue el correo
   - Crear cliente
   - Subir foto de cliente
   - Registrar pago
   - Ver dashboard
   - Ver historial
   - Cambiar foto del perfil

7. Antes de publicar
   - Configura el dominio autorizado en Authentication.
   - Publica con HTTPS.
   - Revisa las Rules.
   - Cambia el nombre/iconos si quieres una identidad definitiva.

NOTA:
La configuración Web de Firebase NO contiene secretos privados. La seguridad se consigue con Authentication y Rules.
