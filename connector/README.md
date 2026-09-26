# CAHESA Connector v1 — solo lectura

Este conector es la primera versión operativa para enlazar un MikroTik con CAHESA sin exponer las credenciales del router al navegador ni guardarlas en Firestore.

## Flujo

1. El administrador entra a CAHESA y genera un código temporal.
2. En el equipo Windows de la red del proveedor se ejecuta el Connector.
3. Se introduce el código una sola vez.
4. El Connector guarda su token en el almacén de credenciales de Windows.
5. La contraseña del MikroTik también se guarda únicamente de forma local mediante Windows Credential Manager (a través de `keyring`).
6. Cada 30 segundos se consulta `/system/identity`, `/system/resource`, `/ppp/secret` y `/ppp/active`.
7. Se envía a CAHESA únicamente el resumen y los datos de lectura de los PPP Secrets.

## Importante

- Esta versión es **SOLO LECTURA**.
- No contiene código para `/ppp/secret/set`, `/ppp/secret/disable`, `/ppp/secret/enable` ni cambios de perfiles.
- El usuario MikroTik recomendado debe tener únicamente las políticas `read,api`.
- No se guarda la contraseña del MikroTik en Firestore.
- El código de vinculación expira en 10 minutos y solo se puede usar una vez.

## Prueba en Windows

```powershell
python -m pip install -r connector\requirements.txt
python connector\cahesa_connector.py
```

Para una sola lectura/reporte:

```powershell
python connector\cahesa_connector.py --once
```

La siguiente etapa será empaquetarlo como `CAHESA Connector.exe` y añadir inicio automático con Windows.
