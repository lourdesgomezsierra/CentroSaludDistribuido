
from pathlib import Path
import json
import psycopg2

BASE_DIR = Path(__file__).resolve().parent.parent
ARCHIVO_JSON = BASE_DIR / "json" / "turnos_unificados.json"


def cargar_turnos():
    with open(ARCHIVO_JSON, "r", encoding="utf-8") as archivo:
        turnos = json.load(archivo)

    conexion = psycopg2.connect(
        host="localhost",
        port=5443,
        database="salud_db",
        user="salud_admin",
        password="salud2026"
    )

    cursor = conexion.cursor()

    try:
        cargados = 0

        for turno in turnos:
            cursor.execute("""
                INSERT INTO turnos_integrados (
                    origen,
                    turno_origen_id,
                    paciente_id_origen,
                    paciente,
                    fecha,
                    hora,
                    area,
                    tipo_estudio,
                    profesional,
                    estado
                )
                SELECT %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM turnos_integrados
                    WHERE origen = %s
                    AND turno_origen_id = %s
                );
            """, (
                turno["origen"],
                turno.get("turno_id"),
                turno["paciente_id"],
                turno["paciente"],
                turno["fecha"],
                turno["hora"],
                turno["area"],
                turno["tipo_estudio"],
                turno["profesional"],
                turno["estado"],
                turno["origen"],
                turno.get("turno_id")
            ))

            cargados += cursor.rowcount

        conexion.commit()
        print(f"Registros nuevos cargados: {cargados}")

    except Exception as error:
        conexion.rollback()
        print("Error durante la carga:", error)

    finally:
        cursor.close()
        conexion.close()


if __name__ == "__main__":
    cargar_turnos()
