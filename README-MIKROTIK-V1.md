# CAHESA + MikroTik · V1 de producción de prueba (solo lectura)

Esta versión incorpora la primera integración formal entre CAHESA y un MikroTik mediante un **CAHESA Connector** instalado dentro de la red del proveedor.

## Qué hace esta V1

- El administrador de CAHESA genera un código temporal de vinculación.
- El código dura 10 minutos y solo se puede utilizar una vez.
- El Connector de Windows se vincula mediante HTTPS.
- Las credenciales del MikroTik permanecen en el equipo local.
- El navegador nunca recibe la contraseña del MikroTik.
- El backend nunca guarda la contraseña del MikroTik.
- El Connector consulta únicamente información de lectura:
  - `/system/identity`
  - `/system/resource`
  - `/ppp/secret`
  - `/ppp/active`
- CAHESA muestra los PPP Secrets reales, perfil, comentario, estado ONLINE/OFFLINE/DISABLED e IP activa cuando existe.
- No hay ninguna función de escritura sobre el MikroTik.

## Arquitectura

```text
CAHESA PWA
   │
   │ cuenta CAHESA real
   ▼
Cloud Functions
   │                    HTTPS
   │◄─────────────────────────────► CAHESA Connector (Windows)
   │                                  │
   ▼                                  ▼
Firestore                         MikroTik
                                   API 8728
                                   SOLO read + api
```

## Antes de probar con el equipo real

1. Cambiar la contraseña del usuario `cahesa_monitor` si la contraseña utilizada durante las pruebas anteriores sigue vigente. Esa contraseña se consideró expuesta durante una prueba y no debe reutilizarse.
2. Mantener el usuario del MikroTik con únicamente `read,api`.
3. Mantener el API del MikroTik accesible solo desde la red local necesaria. No publicar el puerto 8728 en Internet.
4. No activar todavía ninguna función de escritura.

## Despliegue del backend

Desde la carpeta raíz del proyecto, con Firebase CLI autenticado:

```powershell
firebase login
firebase use cahesa-control-de-pagos
cd functions
npm install
cd ..
firebase deploy --only functions,firestore:rules
```

Si Firebase solicita habilitar facturación para Cloud Functions, no continúes hasta confirmar el costo y la configuración de facturación del proyecto.

## Prueba del Connector

En Windows:

```powershell
python -m pip install -r connector\requirements.txt
python connector\cahesa_connector.py
```

Primero genera el código desde CAHESA → **MikroTik** → **Generar código de vinculación**.

Después introduce el código en el Connector.

El Connector pedirá:

- IP/host del MikroTik.
- Puerto API (por defecto 8728).
- Usuario de lectura.
- Contraseña del usuario de lectura.

La contraseña se guarda localmente mediante Windows Credential Manager usando `keyring`.

## Prueba de una sola lectura

```powershell
python connector\cahesa_connector.py --once
```

## Estado de esta versión

**LECTURA:** habilitada.

**ESCRITURA:** deshabilitada deliberadamente.

No se implementan todavía:

- suspender PPP Secret;
- reactivar PPP Secret;
- cambiar perfil/velocidad;
- crear o eliminar PPP Secret;
- modificar configuración del router.

La escritura se implementará únicamente después de validar la lectura con datos reales y acordar con el administrador del MikroTik qué operaciones se autorizarán y bajo qué confirmaciones.
