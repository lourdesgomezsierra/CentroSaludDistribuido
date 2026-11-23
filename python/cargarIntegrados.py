from pathlib import Path
import json
import os

import psycopg2


BASE_DIR = Path(__file__).resolve().parent.parent
ARCHIVO_JSON = BASE_DIR / "json" / "turnos_unificados.json"


def cargar_turnos():
    password = os.environ.get("DB_PASSWORD")
    if not password:
        raise RuntimeError("Definí DB_PASSWORD en el entorno o en .env")

    with open(ARCHIVO_JSON, "r", encoding="utf-8") as archivo:
        turnos = json.load(archivo)

    cargados = 0
    with psycopg2.connect(
        host=os.environ.get("DB_HOST_CONSULTORIOS", "localhost"),
        port=int(os.environ.get("DB_PORT_CONSULTORIOS", "5443")),
        database="salud_db",
        user="salud_admin",
        password=password,
        connect_timeout=3,
    ) as conexion:
        with conexion.cursor() as cursor:
            for turno in turnos:
                if not turno.get("valido", True):
                    continue
                identificador = turno.get("turno_id")
                if not identificador:
                    raise ValueError(
                        f"Turno sin identificador original: {turno!r}"
                    )
                cursor.execute(
                    """INSERT INTO turnos_integrados (
                           origen, turno_origen_id, paciente_id_origen,
                           paciente, fecha, hora, area, tipo_estudio,
                           profesional, estado
                       ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                       ON CONFLICT (origen, turno_origen_id) DO NOTHING""",
                    (
                        turno["origen"], str(identificador),
                        turno.get("paciente_id"), turno["paciente"],
                        turno["fecha"], turno["hora"], turno["area"],
                        turno["tipo_estudio"], turno["profesional"],
                        turno["estado"],
                    ),
                )
                cargados += cursor.rowcount

    print(f"Registros nuevos cargados: {cargados}")


if __name__ == "__main__":
    cargar_turnos()
