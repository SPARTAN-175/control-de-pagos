import getpass
import json
import os
import platform
import socket
import time
from pathlib import Path

import keyring
import requests
import routeros_api

APP_NAME = "CAHESA Connector"
FUNCTIONS_BASE = "https://us-central1-cahesa-control-de-pagos.cloudfunctions.net"
CONFIG_DIR = Path(os.environ.get("APPDATA", Path.home())) / "CAHESA Connector"
CONFIG_FILE = CONFIG_DIR / "config.json"
KEYRING_SERVICE = "CAHESA-Connector"


def load_config():
    if not CONFIG_FILE.exists():
        return {}
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_config(data):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def error_message(response):
    try:
        data = response.json()
        return str(data.get("error") or "error_desconocido")
    except Exception:
        return f"HTTP {response.status_code}"


def pair():
    print("\n=== VINCULACIÓN CAHESA CONNECTOR ===")
    print("Este proceso no envía la contraseña del MikroTik a CAHESA.\n")
    code = input("Código temporal de CAHESA: ").strip().upper()
    connector_name = input("Nombre de este equipo [CAHESA Connector]: ").strip() or "CAHESA Connector"

    response = requests.post(
        f"{FUNCTIONS_BASE}/pairConnector",
        json={"code": code, "connectorName": connector_name},
        timeout=20,
    )
    if not response.ok:
        raise RuntimeError(f"No se pudo vincular el equipo: {error_message(response)}")

    data = response.json()
    token = data.get("token")
    connector_id = data.get("connectorId")
    if not token or not connector_id:
        raise RuntimeError("El servidor no devolvió las credenciales de vinculación esperadas.")

    config = load_config()
    config.update({
        "connector_id": connector_id,
        "connector_name": connector_name,
        "functions_base": FUNCTIONS_BASE,
    })
    save_config(config)
    keyring.set_password(KEYRING_SERVICE, connector_id, token)
    print("Vinculación completada correctamente.")


def setup_mikrotik():
    config = load_config()
    print("\n=== CONFIGURACIÓN LOCAL DEL MIKROTIK ===")
    host = input(f"IP / host del MikroTik [{config.get('mikrotik_host', '192.168.0.1')}]: ").strip() or config.get("mikrotik_host", "192.168.0.1")
    port = int(input(f"Puerto API [8728]: ").strip() or "8728")
    username = input(f"Usuario de solo lectura [{config.get('mikrotik_user', 'cahesa_monitor')}]: ").strip() or config.get("mikrotik_user", "cahesa_monitor")
    password = getpass.getpass("Contraseña del usuario MikroTik: ")

    config.update({
        "mikrotik_host": host,
        "mikrotik_port": port,
        "mikrotik_user": username,
    })
    save_config(config)
    keyring.set_password(KEYRING_SERVICE, f"mikrotik:{host}:{username}", password)
    print("Configuración local guardada. La contraseña queda en el almacén de credenciales de Windows.\n")


def get_password(config):
    return keyring.get_password(KEYRING_SERVICE, f"mikrotik:{config['mikrotik_host']}:{config['mikrotik_user']}")


def read_mikrotik(config):
    password = get_password(config)
    if not password:
        raise RuntimeError("No existe la contraseña local del MikroTik. Ejecuta setup nuevamente.")

    pool = routeros_api.RouterOsApiPool(
        config["mikrotik_host"],
        username=config["mikrotik_user"],
        password=password,
        port=int(config.get("mikrotik_port", 8728)),
        use_ssl=False,
        plaintext_login=True,
    )
    try:
        api = pool.get_api()
        identity_rows = api.get_resource("/system/identity").get()
        resource_rows = api.get_resource("/system/resource").get()
        secrets = api.get_resource("/ppp/secret").get()
        active = api.get_resource("/ppp/active").get()

        identity = identity_rows[0].get("name", "MikroTik") if identity_rows else "MikroTik"
        resource = resource_rows[0] if resource_rows else {}
        active_names = {str(row.get("name", "")) for row in active}

        clients = []
        enabled = 0
        disabled = 0
        for row in secrets:
            name = str(row.get("name", ""))
            is_disabled = str(row.get("disabled", "false")).lower() == "true"
            if is_disabled:
                disabled += 1
            else:
                enabled += 1
            clients.append({
                "secret": name,
                "name": name,
                "comment": str(row.get("comment", "")),
                "profile": str(row.get("profile", "")),
                "status": "DISABLED" if is_disabled else ("ONLINE" if name in active_names else "OFFLINE"),
                "address": str(next((a.get("address", "") for a in active if str(a.get("name", "")) == name), "")),
            })

        return {
            "identity": identity,
            "routerOS": str(resource.get("version", "")),
            "board": str(resource.get("board-name", "")),
            "model": str(resource.get("platform", "")),
            "pppSecrets": len(secrets),
            "enabled": enabled,
            "disabled": disabled,
            "active": len(active),
            "clients": clients,
        }
    finally:
        pool.disconnect()


def send_snapshot(config, snapshot):
    token = keyring.get_password(KEYRING_SERVICE, config.get("connector_id", ""))
    if not token:
        raise RuntimeError("No existe el token del Connector. Vuelve a vincular este equipo.")

    response = requests.post(
        f"{config.get('functions_base', FUNCTIONS_BASE)}/connectorSnapshot",
        headers={"Authorization": f"Bearer {token}"},
        json=snapshot,
        timeout=20,
    )
    if not response.ok:
        raise RuntimeError(f"CAHESA rechazó el reporte: {error_message(response)}")


def run_once(config):
    snapshot = read_mikrotik(config)
    send_snapshot(config, snapshot)
    print(
        f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] OK · "
        f"{snapshot['pppSecrets']} secrets · "
        f"{snapshot['enabled']} habilitados · "
        f"{snapshot['disabled']} suspendidos · "
        f"{snapshot['active']} activos"
    )


def main():
    print("=" * 58)
    print("              CAHESA CONNECTOR v1")
    print("              MODO SOLO LECTURA")
    print("=" * 58)

    config = load_config()
    if not config.get("connector_id"):
        pair()
        config = load_config()
    if not config.get("mikrotik_host") or not get_password(config):
        setup_mikrotik()
        config = load_config()

    once = "--once" in os.sys.argv
    interval = 30
    print(f"Conector: {config.get('connector_name', 'CAHESA Connector')}")
    print(f"MikroTik: {config.get('mikrotik_host')}:{config.get('mikrotik_port', 8728)}")
    print("No se ejecutan comandos de escritura en el MikroTik.\n")

    while True:
        try:
            run_once(config)
        except KeyboardInterrupt:
            print("\nConnector detenido.")
            return
        except Exception as exc:
            print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] ERROR · {exc}")
        if once:
            return
        time.sleep(interval)


if __name__ == "__main__":
    main()
