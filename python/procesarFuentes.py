
from pathlib import Path
import pandas as pd
import json
import re

BASE_DIR = Path(__file__).resolve().parent.parent

ARCHIVO_EXCEL = BASE_DIR / "fuentes" / "excel" / "turnos_laboratorio.xlsx"
ARCHIVO_TXT = BASE_DIR / "fuentes" / "txt" / "reportes_imagenes.txt"

CARPETA_JSON = BASE_DIR / "json"


def procesar_excel():
    print("\nProcesando fuente Excel...")

    datos = pd.read_excel(ARCHIVO_EXCEL)
    registros = datos.to_dict(orient="records")

    turnos = []

    for registro in registros:
        turno = {
            "origen": "laboratorio",
            "turno_externo": str(registro["turno_externo"]),
            "paciente_id": int(registro["paciente_id"]),
            "paciente": str(registro["paciente"]),
            "fecha": str(registro["fecha"])[:10],
            "hora": str(registro["hora"]),
            "area": "Laboratorio",
            "tipo_estudio": str(registro["analisis"]),
            "profesional": str(registro["profesional"]),
            "estado": str(registro["estado"]).strip().capitalize()
        }

        turnos.append(turno)

    guardar_json("turnos_laboratorio.json", turnos)

    print(f"Se procesaron {len(turnos)} turnos del laboratorio.")


def extraer_patron(texto, patron):
    coincidencia = re.search(patron, texto, re.IGNORECASE)
    return coincidencia.group(1).strip() if coincidencia else None


def procesar_txt():
    print("\nProcesando fuente TXT...")

    contenido = ARCHIVO_TXT.read_text(encoding="utf-8")

    bloques = re.findall(
        r"\[REPORTE.*?\](.*?)(?=\[REPORTE|\Z)",
        contenido,
        re.IGNORECASE | re.DOTALL
    )

    turnos = []

    for bloque in bloques:

        paciente_id = extraer_patron(
            bloque,
            r"paciente\s*(?:N[°ºo]\s*)?(\d+)"
        )

        paciente = extraer_patron(
            bloque,
            r"paciente\s*(?:N[°ºo]\s*)?\d+\s*(?:,|\()\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+)"
        )

        fecha = extraer_patron(
            bloque,
            r"(\d{2}/\d{2}/\d{4})"
        )

        # Se toma la última hora para contemplar cambios de horario.
        horas = re.findall(
            r"(\d{1,2}:\d{2})",
            bloque
        )
        hora = horas[-1] if horas else None

        estudio = extraer_patron(
            bloque,
            r"(?:Estudio:\s*|turno de\s+|tiene una\s+)([A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+?)(?=\s+(?:agendada|para paciente|del paciente)|[,.])"
        )

        profesional = extraer_patron(
            bloque,
            r"(?:Profesional(?: asignado)?:\s*|Atiende\s+(?:la|el)\s+)([^.\n]+)"
        )

        if re.search(r"cancelad", bloque, re.IGNORECASE):
            estado = "Cancelado"
        elif re.search(r"pendiente", bloque, re.IGNORECASE):
            estado = "Pendiente"
        elif re.search(r"confirmado", bloque, re.IGNORECASE):
            estado = "Confirmado"
        else:
            estado = None

        if fecha:
            dia, mes, anio = fecha.split("/")
            fecha = f"{anio}-{mes}-{dia}"

        turno = {
            "origen": "diagnostico_imagenes",
            "paciente_id": int(paciente_id) if paciente_id else None,
            "paciente": paciente,
            "fecha": fecha,
            "hora": hora,
            "area": "Diagnóstico por imágenes",
            "tipo_estudio": estudio,
            "profesional": profesional,
            "estado": estado
        }

        campos_obligatorios = [
            "paciente_id",
            "paciente",
            "fecha",
            "hora",
            "tipo_estudio",
            "profesional",
            "estado"
        ]

        faltantes = [
            campo for campo in campos_obligatorios
            if not turno[campo]
        ]

        turno["valido"] = len(faltantes) == 0
        turno["campos_faltantes"] = faltantes

        turnos.append(turno)

    guardar_json("turnos_imagenes.json", turnos)

    validos = sum(1 for t in turnos if t["valido"])
    pendientes = len(turnos) - validos

    print(f"Reportes procesados: {len(turnos)}")
    print(f"Registros completos: {validos}")
    print(f"Registros pendientes de revisión: {pendientes}")


def guardar_json(nombre_archivo, datos):
    CARPETA_JSON.mkdir(parents=True, exist_ok=True)

    ruta = CARPETA_JSON / nombre_archivo

    with open(ruta, "w", encoding="utf-8") as archivo:
        json.dump(datos, archivo, ensure_ascii=False, indent=4)

    print(f"Archivo generado: {ruta}")


if __name__ == "__main__":
    print("INICIANDO PROCESAMIENTO DE FUENTES")

    procesar_excel()
    procesar_txt()

    print("\nProcesamiento finalizado.")
