
import re
import unicodedata
from collections import Counter

# Leer archivo de reportes
ruta = "fuentes/txt/reportes_imagenes.txt"

with open(ruta, "r", encoding="utf-8") as archivo:
    texto = archivo.read()

# Separar los reportes y evitar incluir el encabezado
texto_reportes = texto[texto.find("[REPORTE 1]"):]
reportes = re.split(r"\[REPORTE \d+.*?\]", texto_reportes)
reportes = [r.strip() for r in reportes if r.strip()]

# Palabras que no aportan información al análisis
stopwords = {
    "para", "del", "con", "por", "una", "el", "la", "de",
    "se", "un", "en", "al", "y", "a", "hs", "tiene",
    "paciente", "turno", "turnos", "profesional", "asignado",
    "dra", "dr", "fecha", "horario", "estudio", "nuevo",
    "informa", "previsto", "pasa", "atiende", "registro",
    "las", "los", "fue", "no", "ni", "estado", "n",
    "agendada", "cambio", "completar"
}

# Normalizar texto para facilitar la comparación
def normalizar(texto):
    texto = unicodedata.normalize("NFD", texto.lower())
    return "".join(c for c in texto if unicodedata.category(c) != "Mn")

# Extraer palabras relevantes
frecuencia = Counter()

print("\n--- PALABRAS RELEVANTES POR REPORTE ---")

for numero, reporte in enumerate(reportes, start=1):
    palabras = re.findall(r"\b[a-záéíóúñ]+\b", reporte.lower())

    relevantes = [
        palabra for palabra in palabras
        if normalizar(palabra) not in stopwords
    ]

    frecuencia.update(relevantes)

    print(f"\nReporte {numero}")
    print("Palabras relevantes:", relevantes)

# Frecuencia de términos
print("\n--- FRECUENCIA DE TÉRMINOS ---")

for palabra, cantidad in frecuencia.most_common():
    print(f"{palabra}: {cantidad}")

# Análisis de estados
print("\n--- ANALISIS POR ESTADO ---")

estados = Counter()

for reporte in reportes:
    texto_normalizado = normalizar(reporte)

    if "cancelado" in texto_normalizado:
        estados["Cancelado"] += 1
    elif "confirmado" in texto_normalizado:
        estados["Confirmado"] += 1
    elif "pendiente" in texto_normalizado:
        estados["Pendiente"] += 1

for estado, cantidad in estados.items():
    print(f"{estado}: {cantidad}")

# Análisis por tipo de estudio
print("\n--- ANALISIS POR TIPO DE ESTUDIO ---")

tipos_estudio = [
    "radiografia de torax",
    "ecografia abdominal",
    "mamografia",
    "resonancia magnetica",
    "ecografia renal"
]

conteo_estudios = Counter()
texto_completo = normalizar(texto)

for estudio in tipos_estudio:
    if normalizar(estudio) in texto_completo:
        conteo_estudios[estudio] += 1

for estudio, cantidad in conteo_estudios.items():
    print(f"{estudio}: {cantidad}")

# Control de reportes incompletos
print("\n--- CONTROL DE REPORTES ---")

for numero, reporte in enumerate(reportes, start=1):
    tiene_horario = bool(re.search(r"\b\d{1,2}:\d{2}\b", reporte))
    tiene_profesional = bool(
        re.search(r"Profesional:|Atiende|Profesional asignado:", reporte, re.I)
    )

    if not tiene_horario or not tiene_profesional:
        print(f"Reporte {numero}: Información incompleta")
    else:
        print(f"Reporte {numero}: Información completa")
