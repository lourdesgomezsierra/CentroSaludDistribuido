
import re
from collections import Counter

ruta = "fuentes/txt/reportes_imagenes.txt"

with open(ruta, "r", encoding="utf-8") as archivo:
    texto = archivo.read()

# Separar los reportes individuales, incluido el quinto incompleto
reportes = re.findall(
    r"\[REPORTE\s+\d+.*?(?=\[REPORTE\s+\d+|\Z)",
    texto,
    flags=re.IGNORECASE | re.DOTALL
)

estados = Counter()
estudios = Counter()
completos = 0
incompletos = 0

tipos_estudio = [
    "radiografia de torax",
    "ecografia abdominal",
    "mamografia",
    "resonancia magnetica",
    "ecografia renal"
]

for reporte in reportes:
    texto_min = reporte.lower()

    # Clasificar por estado
    for estado in ["confirmado", "cancelado", "pendiente"]:
        if estado in texto_min:
            estados[estado.capitalize()] += 1
            break

    # Clasificar por tipo de estudio
    for estudio in tipos_estudio:
        if estudio in texto_min:
            estudios[estudio.capitalize()] += 1
            break

    # Controlar los datos disponibles
    tiene_paciente = "paciente" in texto_min
    tiene_estudio = any(estudio in texto_min for estudio in tipos_estudio)
    tiene_fecha = bool(re.search(r"\d{2}/\d{2}/\d{4}", texto_min))
    tiene_hora = bool(re.search(r"\d{1,2}:\d{2}", texto_min))
    tiene_profesional = (
        "profesional" in texto_min or "atiende" in texto_min
    )

    if all([
        tiene_paciente,
        tiene_estudio,
        tiene_fecha,
        tiene_hora,
        tiene_profesional
    ]):
        completos += 1
    else:
        incompletos += 1

print("\n========== MINERÍA DE TEXTO ==========")

print("\nANÁLISIS POR ESTADO")
for estado, cantidad in estados.items():
    print(f"{estado}: {cantidad}")

print("\nANÁLISIS POR TIPO DE ESTUDIO")
for estudio, cantidad in estudios.items():
    print(f"{estudio}: {cantidad}")

print("\nCONTROL DE CALIDAD")
print(f"Reportes completos: {completos}")
print(f"Reportes incompletos: {incompletos}")
print(f"Total procesado: {len(reportes)}")

print("\n======================================")
