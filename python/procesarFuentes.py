
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

    equivalencias = {
        "turno_externo": "turno_externo",
        "paciente_id": "paciente_id",
        "paciente": "paciente",
        "fecha": "fecha",
        "hora": "hora",
        "analisis": "tipo_estudio",
        "profesional": "profesional",
        "estado": "estado"
    }

    for registro in registros:
        fecha = registro.get("fecha")
        hora = registro.get("hora")

        # Normalización de la fecha.
        if pd.notna(fecha) and str(fecha).strip() != "":
            fecha_normalizada = pd.to_datetime(
                fecha,
                dayfirst=True,
                errors="coerce"
            )

            fecha = (
                fecha_normalizada.strftime("%Y-%m-%d")
                if pd.notna(fecha_normalizada)
                else None
            )
        else:
            fecha = None

        # Normalización de la hora.
        if pd.notna(hora) and str(hora).strip() != "":
            if hasattr(hora, "strftime"):
                hora = hora.strftime("%H:%M:%S")
            else:
                hora = str(hora).strip()
        else:
            hora = None

        paciente_id = registro.get("paciente_id")

        turno = {
            "origen": "laboratorio",
            "turno_externo": (
                str(registro["turno_externo"]).strip()
                if pd.notna(registro.get("turno_externo"))
                else None
            ),
            "paciente_id": (
                int(paciente_id)
                if pd.notna(paciente_id)
                else None
            ),
            "paciente": (
                str(registro["paciente"]).strip()
                if pd.notna(registro.get("paciente"))
                else None
            ),
            "fecha": fecha,
            "hora": hora,
            "area": "Laboratorio",
            "tipo_estudio": (
                str(registro["analisis"]).strip()
                if pd.notna(registro.get("analisis"))
                else None
            ),
            "profesional": (
                str(registro["profesional"]).strip()
                if pd.notna(registro.get("profesional"))
                else None
            ),
            "estado": (
                str(registro["estado"]).strip().capitalize()
                if pd.notna(registro.get("estado"))
                else None
            )
        }

        faltantes = []

        for campo_origen, campo_turno in equivalencias.items():
            valor = turno.get(campo_turno)

            if (
                valor is None
                or str(valor).strip().lower() in ("", "nan", "none")
            ):
                faltantes.append(campo_origen)

        turno["valido"] = len(faltantes) == 0
        turno["campos_faltantes"] = faltantes

        turnos.append(turno)

    guardar_json("turnos_laboratorio.json", turnos)

    validos = sum(1 for t in turnos if t["valido"])
    pendientes = len(turnos) - validos

    print(f"Turnos procesados: {len(turnos)}")
    print(f"Registros completos: {validos}")
    print(f"Registros pendientes de revisión: {pendientes}")


def extraer_patron(texto, patron):
    coincidencia = re.search(patron, texto, re.IGNORECASE)
    return coincidencia.group(1).strip() if coincidencia else None


def procesar_txt():
    print("\nProcesando fuente TXT...")

    contenido = ARCHIVO_TXT.read_text(encoding="utf-8")

    # Se separa el contenido utilizando los encabezados de cada reporte.
    bloques = re.findall(
        r"\[REPORTE[^\]]*\](.*?)(?=\[REPORTE|\Z)",
        contenido,
        re.IGNORECASE | re.DOTALL
    )

    turnos = []

    for bloque in bloques:

        paciente_id = extraer_patron(
            bloque,
            r"paciente\s+(?:N[°ºo]\s*)?(\d+)"
        )

        paciente = extraer_patron(
            bloque,
            r"paciente\s+(?:N[°ºo]\s*)?\d+\s*,\s*"
            r"([A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+)"
        )

        if not paciente:
            paciente = extraer_patron(
                bloque,
                r"\(\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+)\s*\)"
            )

        fecha = extraer_patron(
            bloque,
            r"(\d{2}/\d{2}/\d{4}|\d{2}-\d{2}-\d{4})"
        )

        # Se toma la última hora para contemplar cambios de horario.
        horas = re.findall(
            r"(\d{1,2}:\d{2})",
            bloque
        )
        hora = horas[-1] if horas else None

        estudio = extraer_patron(
            bloque,
            r"(?:Estudio:\s*|turno de\s+|tiene una\s+)"
            r"([A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+?)"
            r"(?=\s+(?:agendada|para paciente|del paciente)|[,.])"
        )

        profesional = extraer_patron(
            bloque,
            r"(?:Profesional(?: asignado)?:\s*|"
            r"Atiende\s+(?:la|el)\s+)"
            r"((?:Dr\.?|Dra\.?|Doctor|Doctora)\s+"
            r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ ]+)"
        )

        if profesional:
            profesional = profesional.strip().rstrip(".").strip()

        if re.search(r"cancelad", bloque, re.IGNORECASE):
            estado = "Cancelado"
        elif re.search(r"pendiente", bloque, re.IGNORECASE):
            estado = "Pendiente"
        elif re.search(r"confirmado", bloque, re.IGNORECASE):
            estado = "Confirmado"
        else:
            estado = None

        if fecha:
            separador = "/" if "/" in fecha else "-"
            dia, mes, anio = fecha.split(separador)
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
            if (
                turno[campo] is None
                or str(turno[campo]).strip().lower() in ("", "nan", "none")
            )
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
