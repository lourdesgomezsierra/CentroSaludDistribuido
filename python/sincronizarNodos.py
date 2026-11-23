"""Entrega idempotente de eventos del outbox entre los tres nodos."""

import argparse
import logging
import os
import time
from datetime import timedelta

import psycopg


NODOS = ("consultorios", "laboratorio", "diagnostico_imagenes")
PASSWORD = os.environ.get("DB_PASSWORD")
if not PASSWORD:
    raise RuntimeError("Definí DB_PASSWORD para conectar a PostgreSQL")

DB_CONFIG = {
    nodo: {
        "host": os.environ.get(f"DB_HOST_{nodo.upper()}", "localhost"),
        "port": int(os.environ.get(f"DB_PORT_{nodo.upper()}", default_port)),
        "dbname": os.environ.get(f"DB_NAME_{nodo.upper()}", "salud_db"),
        "user": "salud_admin",
    }
    for nodo, default_port in zip(NODOS, (5443, 5444, 5445))
}
RETRY_BASE_SECONDS = max(float(os.environ.get("SYNC_RETRY_BASE_SECONDS", "10")), 1.0)
RETRY_MAX_SECONDS = max(
    float(os.environ.get("SYNC_RETRY_MAX_SECONDS", "300")), RETRY_BASE_SECONDS
)
SOURCE_ERROR_LOG_SECONDS = max(
    float(os.environ.get("SYNC_SOURCE_ERROR_LOG_SECONDS", "60")), 1.0
)
ULTIMO_AVISO_ERROR_ORIGEN = {}


def tiempo_espera_reintento(intentos, base=RETRY_BASE_SECONDS, maximo=RETRY_MAX_SECONDS):
    """Espera exponencial acotada; intentos incluye el último intento registrado."""
    espera = max(float(base), 1.0)
    limite = max(float(maximo), espera)
    exponentes = min(max(int(intentos or 1) - 1, 0), 64)
    for _ in range(exponentes):
        if espera >= limite:
            break
        espera = min(limite, espera * 2)
    return espera


def reintento_vencido(estado, intentos, ultimo_intento, ahora,
                      base=RETRY_BASE_SECONDS, maximo=RETRY_MAX_SECONDS):
    """Los pendientes se prueban enseguida; errores esperan su ventana de backoff."""
    if estado == "pendiente":
        return True
    if estado != "error":
        return False
    if ultimo_intento is None:
        return True
    espera = tiempo_espera_reintento(intentos, base, maximo)
    return ahora - ultimo_intento >= timedelta(seconds=espera)


def registrar_aviso_error_origen(origen, ahora_monotonico, avisos,
                                 intervalo=SOURCE_ERROR_LOG_SECONDS):
    """Limita stacktraces repetidas; el sondeo de conexión sigue en cada ciclo."""
    ultimo = avisos.get(origen)
    if ultimo is not None and ahora_monotonico - ultimo < intervalo:
        return False
    avisos[origen] = ahora_monotonico
    return True


def conectar(nodo):
    config = DB_CONFIG[nodo]
    return psycopg.connect(
        **config, password=PASSWORD, connect_timeout=3
    )


def convertir_evento(nodo_origen, entidad, datos):
    """Normaliza el snapshot capturado por el trigger, sin leer estado vivo."""
    if entidad == "turnos_consultorios":
        turno_id = datos.get("turno_origen_id") or datos.get("turno_id")
        return {
            "nodo_creador": nodo_origen,
            "turno_origen_id": str(turno_id),
            "area": "Consultorios",
            "paciente_id": datos["paciente_id"],
            "paciente": datos["paciente"],
            "fecha": datos["fecha"],
            "hora": datos["hora"],
            "tipo_estudio": datos.get("tipo_estudio", "Consulta médica"),
            "profesional": datos["profesional"],
            "estado": datos["estado"],
        }
    if entidad != "turnos_locales":
        raise ValueError(f"Entidad de sincronización no soportada: {entidad}")

    required = (
        "turno_origen_id", "nodo_creador", "area", "paciente", "fecha",
        "hora", "tipo_estudio", "profesional", "estado",
    )
    missing = [key for key in required if datos.get(key) is None]
    if missing:
        raise ValueError(f"Snapshot incompleto: {', '.join(missing)}")
    if datos["nodo_creador"] != nodo_origen:
        raise ValueError("El nodo creador no coincide con el origen del evento")
    return {key: datos.get(key) for key in (*required, "paciente_id")}


def aplicar_evento(destino, nodo_origen, evento_id, entidad, operacion, turno):
    """Deduplica y aplica el snapshot/tombstone en una sola transacción."""
    with conectar(destino) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO eventos_recibidos
                       (nodo_origen, identificador_evento, entidad)
                   VALUES (%s, %s, %s)
                   ON CONFLICT (nodo_origen, identificador_evento) DO NOTHING
                   RETURNING identificador_evento""",
                (nodo_origen, evento_id, entidad),
            )
            if cur.fetchone() is None:
                return False

            if operacion == "DELETE":
                cur.execute(
                    """DELETE FROM turnos_compartidos
                       WHERE nodo_origen = %s AND turno_origen_id = %s""",
                    (nodo_origen, turno["turno_origen_id"]),
                )
            else:
                cur.execute(
                    """INSERT INTO turnos_compartidos (
                           nodo_origen, turno_origen_id, nodo_creador, area,
                           paciente_id, paciente, fecha, hora, tipo_estudio,
                           profesional, estado, fecha_actualizacion
                       ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                                 clock_timestamp())
                       ON CONFLICT (nodo_origen, turno_origen_id) DO UPDATE SET
                           nodo_creador = EXCLUDED.nodo_creador,
                           area = EXCLUDED.area,
                           paciente_id = EXCLUDED.paciente_id,
                           paciente = EXCLUDED.paciente,
                           fecha = EXCLUDED.fecha,
                           hora = EXCLUDED.hora,
                           tipo_estudio = EXCLUDED.tipo_estudio,
                           profesional = EXCLUDED.profesional,
                           estado = EXCLUDED.estado,
                           fecha_actualizacion = clock_timestamp()""",
                    (
                        nodo_origen, turno["turno_origen_id"],
                        turno["nodo_creador"], turno["area"],
                        turno.get("paciente_id"), turno["paciente"],
                        turno["fecha"], turno["hora"], turno["tipo_estudio"],
                        turno["profesional"], turno["estado"],
                    ),
                )
    return True


def marcar_entrega(origen, evento_id, destino, estado, error=None):
    with conectar(origen) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """UPDATE eventos_destinos
                   SET estado = %s, intentos = intentos + 1,
                       ultimo_intento = clock_timestamp(), ultimo_error = %s
                   WHERE evento_id = %s AND nodo_destino = %s""",
                (estado, error, evento_id, destino),
            )
            cur.execute(
                """UPDATE eventos_sincronizacion e
                   SET sincronizado = NOT EXISTS (
                       SELECT 1 FROM eventos_destinos d
                       WHERE d.evento_id = e.evento_id
                         AND d.estado <> 'entregado'
                   )
                   WHERE e.evento_id = %s""",
                (evento_id,),
            )


def sincronizar():
    """Procesa eventos por destino, en orden, dejando errores reintentables."""
    for origen in NODOS:
        try:
            with conectar(origen) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """SELECT e.evento_id, e.nodo_origen, e.entidad,
                                  e.operacion, e.datos, d.nodo_destino,
                                  d.estado, d.intentos, d.ultimo_intento,
                                  clock_timestamp()
                           FROM eventos_sincronizacion e
                           JOIN eventos_destinos d USING (evento_id)
                           WHERE d.estado IN ('pendiente', 'error')
                           ORDER BY d.nodo_destino, e.evento_id"""
                    )
                    eventos = cur.fetchall()
            ULTIMO_AVISO_ERROR_ORIGEN.pop(origen, None)
        except Exception as error:
            ahora_monotonico = time.monotonic()
            if registrar_aviso_error_origen(
                    origen, ahora_monotonico, ULTIMO_AVISO_ERROR_ORIGEN):
                logging.warning("No se pudo leer la outbox de %s: %s", origen, error)
            continue

        detenido = set()
        for (evento_id, nodo_origen, entidad, operacion, datos, destino,
             estado, intentos, ultimo_intento, ahora) in eventos:
            if not reintento_vencido(estado, intentos, ultimo_intento, ahora):
                continue
            if destino in detenido:
                continue
            try:
                turno = convertir_evento(nodo_origen, entidad, datos)
                aplicar_evento(
                    destino, nodo_origen, evento_id, entidad, operacion, turno
                )
                marcar_entrega(origen, evento_id, destino, "entregado")
                logging.info("Evento %s entregado a %s", evento_id, destino)
            except Exception as error:
                try:
                    marcar_entrega(origen, evento_id, destino, "error", str(error))
                except Exception:
                    logging.exception("No se pudo registrar el error del evento %s", evento_id)
                logging.exception("Falló evento %s hacia %s", evento_id, destino)
                detenido.add(destino)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Ejecuta un solo ciclo")
    parser.add_argument(
        "--interval", type=float,
        default=float(os.environ.get("SYNC_INTERVAL_SECONDS", "10")),
    )
    args = parser.parse_args()
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )
    while True:
        sincronizar()
        if args.once:
            break
        time.sleep(max(args.interval, 1.0))


if __name__ == "__main__":
    main()
