-- Consultas de solo lectura. Ejecutar en cada salud_db indicada desde PowerShell:
-- docker compose exec -T <servicio> psql -X -U salud_admin -d salud_db -c "<consulta>"
-- Sustituir marcador por uno de los valores sintéticos del manual.

-- Identidad del nodo (cada base).
SELECT singleton, nodo_id FROM configuracion_nodo;

-- Turnos originales y operativos del nodo propietario.
SELECT turno_id, turno_origen_id, nodo_creador, nodo_responsable, area,
       paciente_id, paciente, fecha, hora, tipo_estudio, profesional, estado
FROM turnos_locales
WHERE paciente = 'PACIENTE_PRUEBA_SYNC_CONS';

-- Copia recibida en un nodo receptor: esta es la tabla operativa para turnos remotos.
SELECT nodo_origen, turno_origen_id, nodo_creador, nodo_responsable, area,
       paciente_id, paciente, fecha, hora, tipo_estudio, profesional, estado,
       fecha_actualizacion
FROM turnos_compartidos
WHERE paciente = 'PACIENTE_PRUEBA_SYNC_CONS';

-- Outbox del nodo propietario y estado de entrega por destino.
SELECT e.evento_id, e.nodo_origen, e.entidad, e.identificador_origen,
       e.operacion, e.fecha_evento, e.sincronizado,
       d.nodo_destino, d.estado, d.intentos, d.ultimo_intento, d.ultimo_error
FROM eventos_sincronizacion AS e
JOIN eventos_destinos AS d USING (evento_id)
WHERE e.datos->>'paciente' = 'PACIENTE_PRUEBA_SYNC_CONS'
ORDER BY e.evento_id, d.nodo_destino;

-- Eventos que aún requieren atención en el nodo cuya outbox se consulta.
SELECT e.evento_id, e.nodo_origen, e.identificador_origen, e.operacion,
       d.nodo_destino, d.estado, d.intentos, d.ultimo_error
FROM eventos_sincronizacion AS e
JOIN eventos_destinos AS d USING (evento_id)
WHERE d.estado <> 'entregado'
ORDER BY e.evento_id, d.nodo_destino;

-- Recepción del evento: primero obtén evento_id de la outbox del origen,
-- luego reemplaza 123 por ese valor en cada base receptora.
SELECT nodo_origen, identificador_evento, entidad, fecha_recepcion
FROM eventos_recibidos
WHERE nodo_origen = 'consultorios' AND identificador_evento = 123;

-- Conteo de copias del marcador en el nodo receptor; esperado: una fila.
SELECT nodo_origen, turno_origen_id, count(*) AS cantidad
FROM turnos_compartidos
WHERE paciente = 'PACIENTE_PRUEBA_SYNC_CONS'
GROUP BY nodo_origen, turno_origen_id;

-- Cualquier grupo devuelto aquí indicaría más de una copia por clave.
SELECT nodo_origen, turno_origen_id, count(*) AS copias
FROM turnos_compartidos
WHERE paciente LIKE 'PACIENTE_PRUEBA_SYNC%'
GROUP BY nodo_origen, turno_origen_id
HAVING count(*) > 1;

-- La clave primaria de recepciones es (nodo_origen, identificador_evento);
-- esta comprobación global debe devolver cero filas.
SELECT nodo_origen, identificador_evento, count(*) AS recepciones
FROM eventos_recibidos
GROUP BY nodo_origen, identificador_evento
HAVING count(*) > 1;

-- Ejecutar en el nodo receptor (laboratorio o imagenes): las copias compartidas
-- no deben originar eventos locales nuevos; se esperan cero filas del marcador.
SELECT evento_id, nodo_origen, entidad, identificador_origen, operacion
FROM eventos_sincronizacion
WHERE datos->>'paciente' = 'PACIENTE_PRUEBA_SYNC_CONS'
ORDER BY evento_id;

-- Conteo de destinos por estado para la outbox local del nodo.
SELECT nodo_destino, estado, count(*) AS eventos
FROM eventos_destinos
GROUP BY nodo_destino, estado
ORDER BY nodo_destino, estado;
