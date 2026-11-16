
import os
import json
import psycopg

# Configuración de los tres nodos PostgreSQL.
DB_CONFIG = {
    "consultorios": {
        "host": "localhost",
        "port": 5443,
        "dbname": "salud_db",
        "user": "salud_admin"
    },
    "laboratorio": {
        "host": "localhost",
        "port": 5444,
        "dbname": "salud_db",
        "user": "salud_admin"
    },
    "diagnostico_imagenes": {
        "host": "localhost",
        "port": 5445,
        "dbname": "salud_db",
        "user": "salud_admin"
    }
}

PASSWORD = os.getenv("DB_PASSWORD", "salud2026")


def conectar(nodo):
    """Establece conexión con el nodo indicado."""
    config = DB_CONFIG[nodo]

    return psycopg.connect(
        host=config["host"],
        port=config["port"],
        dbname=config["dbname"],
        user=config["user"],
        password=PASSWORD,
        connect_timeout=3
    )


def convertir_evento(nodo, evento, datos):
    """Convierte los eventos de cada sede al formato compartido."""

    if isinstance(datos, str):
        datos = json.loads(datos)

    if nodo == "consultorios":
        turno_id = datos["turno_id"]

        # Recuperamos los nombres mediante las relaciones locales.
        with conectar("consultorios") as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT p.nombre_completo,
                           pr.nombre_completo
                    FROM turnos_consultorios t
                    JOIN pacientes p
                      ON p.paciente_id = t.paciente_id
                    JOIN profesionales pr
                      ON pr.profesional_id = t.profesional_id
                    WHERE t.turno_id = %s
                """, (turno_id,))

                nombres = cur.fetchone()

                if nombres:
                    paciente, profesional = nombres
                else:
                    # Para bajas, recuperamos los nombres
                    # usando los identificadores del evento.
                    cur.execute("""
                        SELECT nombre_completo
                        FROM pacientes
                        WHERE paciente_id = %s
                    """, (datos["paciente_id"],))

                    fila = cur.fetchone()
                    paciente = (
                        fila[0] if fila
                        else "Paciente no disponible"
                    )

                    cur.execute("""
                        SELECT nombre_completo
                        FROM profesionales
                        WHERE profesional_id = %s
                    """, (datos["profesional_id"],))

                    fila = cur.fetchone()
                    profesional = (
                        fila[0] if fila
                        else "Profesional no disponible"
                    )

        return {
            "nodo_origen": "consultorios",
            "turno_origen_id": f"CONS-{turno_id}",
            "paciente_id": datos["paciente_id"],
            "paciente": paciente,
            "fecha": datos["fecha"],
            "hora": datos["hora"],
            "area": "Consultorios externos",
            "tipo_estudio": "Consulta médica",
            "profesional": profesional,
            "estado": datos["estado"]
        }

    # Laboratorio e Imágenes ya almacenan los datos completos.
    origen = (
        "laboratorio"
        if nodo == "laboratorio"
        else "diagnostico_imagenes"
    )

    return {
        "nodo_origen": origen,
        "turno_origen_id": (
            datos.get("turno_origen_id")
            or str(datos.get("turno_id"))
        ),
        "paciente_id": datos.get("paciente_id"),
        "paciente": datos["paciente"],
        "fecha": datos["fecha"],
        "hora": datos["hora"],
        "area": datos["area"],
        "tipo_estudio": datos["tipo_estudio"],
        "profesional": datos["profesional"],
        "estado": datos["estado"]
    }


def aplicar_evento(destino, nodo_origen, evento_id,
                   entidad, operacion, turno):
    """Registra la recepción y aplica el cambio en el nodo destino."""

    with conectar(destino) as conn:
        with conn.cursor() as cur:

            # Evita aplicar dos veces el mismo evento.
            cur.execute("""
                INSERT INTO eventos_recibidos
                    (nodo_origen, identificador_evento, entidad)
                VALUES (%s, %s, %s)
                ON CONFLICT (nodo_origen, identificador_evento)
                DO NOTHING
                RETURNING evento_id
            """, (nodo_origen, str(evento_id), entidad))

            recibido = cur.fetchone()

            # Si ya se recibió anteriormente, no lo duplicamos.
            if recibido is None:
                return

            if operacion == "DELETE":
                cur.execute("""
                    DELETE FROM turnos_compartidos
                    WHERE nodo_origen = %s
                      AND turno_origen_id = %s
                """, (
                    turno["nodo_origen"],
                    turno["turno_origen_id"]
                ))

            else:
                cur.execute("""
                    INSERT INTO turnos_compartidos (
                        nodo_origen,
                        turno_origen_id,
                        paciente_id,
                        paciente,
                        fecha,
                        hora,
                        area,
                        tipo_estudio,
                        profesional,
                        estado,
                        fecha_actualizacion
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s,
                        %s, %s, %s, %s, CURRENT_TIMESTAMP
                    )
                    ON CONFLICT (nodo_origen, turno_origen_id)
                    DO UPDATE SET
                        paciente_id = EXCLUDED.paciente_id,
                        paciente = EXCLUDED.paciente,
                        fecha = EXCLUDED.fecha,
                        hora = EXCLUDED.hora,
                        area = EXCLUDED.area,
                        tipo_estudio = EXCLUDED.tipo_estudio,
                        profesional = EXCLUDED.profesional,
                        estado = EXCLUDED.estado,
                        fecha_actualizacion = CURRENT_TIMESTAMP
                """, (
                    turno["nodo_origen"],
                    turno["turno_origen_id"],
                    turno["paciente_id"],
                    turno["paciente"],
                    turno["fecha"],
                    turno["hora"],
                    turno["area"],
                    turno["tipo_estudio"],
                    turno["profesional"],
                    turno["estado"]
                ))


def sincronizar():
    """Envía los eventos pendientes a los otros dos nodos."""

    for origen in DB_CONFIG:

        try:
            # Leemos los eventos pendientes del nodo de origen.
            with conectar(origen) as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT evento_id, entidad,
                               identificador_origen,
                               operacion, datos
                        FROM eventos_sincronizacion
                        WHERE sincronizado = FALSE
                        ORDER BY evento_id
                    """)

                    eventos = cur.fetchall()

            for evento_id, entidad, identificador, operacion, datos in eventos:

                destinos = [
                    nodo for nodo in DB_CONFIG
                    if nodo != origen
                ]

                try:
                    # Convertimos el evento al formato compartido.
                    turno = convertir_evento(
                        origen, evento_id, datos
                    )

                    errores = []

                    # Intentamos entregar a cada destino
                    # de manera independiente.
                    for destino in destinos:
                        try:
                            aplicar_evento(
                                destino,
                                origen,
                                evento_id,
                                entidad,
                                operacion,
                                turno
                            )

                            print(
                                f"Evento {evento_id}: "
                                f"recibido por {destino}."
                            )

                        except Exception as error:
                            errores.append(destino)

                            print(
                                f"No se pudo entregar el evento "
                                f"{evento_id} a {destino}: {error}"
                            )

                    # Solo se marca como sincronizado cuando
                    # los dos destinos recibieron el evento.
                    if not errores:
                        with conectar(origen) as conn:
                            with conn.cursor() as cur:
                                cur.execute("""
                                    UPDATE eventos_sincronizacion
                                    SET sincronizado = TRUE
                                    WHERE evento_id = %s
                                """, (evento_id,))

                        print(
                            f"Evento {evento_id} de {origen}: "
                            "sincronizado correctamente."
                        )

                    else:
                        print(
                            f"Evento {evento_id} de {origen}: "
                            "queda pendiente de entrega."
                        )

                except Exception as error:
                    print(
                        f"Error procesando evento {evento_id} "
                        f"de {origen}: {error}"
                    )

        except Exception as error:
            print(
                f"No se pudo procesar el nodo {origen}: {error}"
            )


if __name__ == "__main__":
    sincronizar()
