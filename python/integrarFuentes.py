
from pathlib import Path
import json
import os
import psycopg2

BASE_DIR = Path(__file__).resolve().parent.parent
CARPETA_JSON = BASE_DIR / "json"


def leer_consultorios():
    print("Leyendo origen PostgreSQL...")

    password = os.environ.get("DB_PASSWORD")
    if not password:
        raise RuntimeError("Definí DB_PASSWORD en el entorno o en .env")

    with psycopg2.connect(
        host=os.environ.get("DB_HOST_CONSULTORIOS", "localhost"),
        port=int(os.environ.get("DB_PORT_CONSULTORIOS", "5443")),
        database="salud_db",
        user="salud_admin",
        password=password,
        connect_timeout=3,
    ) as conexion:
        with conexion.cursor() as cursor:
            cursor.execute("""
                SELECT t.turno_id, p.paciente_id, p.nombre_completo,
                       t.fecha, t.hora, pr.nombre_completo, t.estado
                FROM turnos_consultorios t
                JOIN pacientes p ON t.paciente_id = p.paciente_id
                JOIN profesionales pr ON t.profesional_id = pr.profesional_id
                ORDER BY t.turno_id;
            """)
            registros = cursor.fetchall()

    turnos = []

    for r in registros:
        turnos.append({
            "origen": "consultorios",
            "turno_id": f"CONS-{r[0]}",
            "paciente_id": r[1],
            "paciente": r[2],
            "fecha": r[3].isoformat(),
            "hora": r[4].strftime("%H:%M"),
            "area": "Consultorios",
            "tipo_estudio": "Consulta médica",
            "profesional": r[5],
            "estado": r[6]
        })

    print(f"Consultorios: {len(turnos)} registros.")
    return turnos


def leer_json(nombre_archivo):
    ruta = CARPETA_JSON / nombre_archivo

    with open(ruta, "r", encoding="utf-8") as archivo:
        return json.load(archivo)


def normalizar_laboratorio():
    print("Leyendo origen Excel procesado...")

    registros = [r for r in leer_json("turnos_laboratorio.json") if r.get("valido")]
    turnos = []

    for r in registros:
        turnos.append({
            "origen": "laboratorio",
            "turno_id": r["turno_externo"],
            "paciente_id": r["paciente_id"],
            "paciente": r["paciente"],
            "fecha": r["fecha"],
            "hora": r["hora"],
            "area": "Laboratorio",
            "tipo_estudio": r["tipo_estudio"],
            "profesional": r["profesional"],
            "estado": r["estado"]
        })

    print(f"Laboratorio: {len(turnos)} registros.")
    return turnos


def normalizar_imagenes():
    print("Leyendo origen TXT procesado...")

    registros = [r for r in leer_json("turnos_imagenes.json") if r.get("valido")]
    turnos = []

    for indice, r in enumerate(registros, start=1):
        turnos.append({
            "origen": "diagnostico_imagenes",
            "turno_id": r.get("turno_id") or f"IMG-{indice}",
            "paciente_id": r["paciente_id"],
            "paciente": r["paciente"],
            "fecha": r["fecha"],
            "hora": r["hora"],
            "area": "Diagnóstico por Imágenes",
            "tipo_estudio": r["tipo_estudio"],
            "profesional": r["profesional"],
            "estado": r["estado"],
            "valido": r["valido"],
            "campos_faltantes": r["campos_faltantes"]
        })

    print(f"Diagnóstico por imágenes: {len(turnos)} registros.")
    return turnos


def validar_turno(turno):
    campos = [
        "turno_id",
        "paciente_id",
        "paciente",
        "fecha",
        "hora",
        "area",
        "tipo_estudio",
        "profesional",
        "estado"
    ]

    faltantes = [
        campo for campo in campos
        if turno.get(campo) in (None, "")
    ]

    return faltantes


def main():
    print("\nINICIANDO INTEGRACIÓN DE FUENTES\n")

    todos = (
        leer_consultorios()
        + normalizar_laboratorio()
        + normalizar_imagenes()
    )

    validos = []
    pendientes = []

    for turno in todos:
        faltantes = validar_turno(turno)

        if faltantes:
            turno["valido"] = False
            turno["campos_faltantes"] = faltantes
            pendientes.append(turno)
        else:
            turno["valido"] = True
            turno["campos_faltantes"] = []
            validos.append(turno)

    with open(CARPETA_JSON / "turnos_unificados.json",
              "w", encoding="utf-8") as archivo:
        json.dump(validos, archivo, ensure_ascii=False, indent=4)

    with open(CARPETA_JSON / "turnos_pendientes.json",
              "w", encoding="utf-8") as archivo:
        json.dump(pendientes, archivo, ensure_ascii=False, indent=4)

    print("\nINTEGRACIÓN FINALIZADA")
    print(f"Total de registros: {len(todos)}")
    print(f"Registros válidos: {len(validos)}")
    print(f"Registros pendientes: {len(pendientes)}")
    print("Archivos JSON generados correctamente.")


if __name__ == "__main__":
    main()
