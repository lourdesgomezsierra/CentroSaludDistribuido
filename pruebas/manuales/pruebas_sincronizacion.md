# Pruebas manuales de sincronización

Ejecuta PowerShell desde la raíz del repositorio. Las altas de prueba usan exclusivamente identificadores sintéticos `PACIENTE_PRUEBA_SYNC_*`.

## Crear desde Consultorios y comprobar la entrega

**Objetivo:** crear un turno de Laboratorio en Consultorios y verificar original, outbox y copias remotas.

**Preparación:** tres PostgreSQL saludables; `.env` configurado. No reutilices un marcador que ya exista.

**Comandos:**

```powershell
$fecha = (Get-Date).AddDays(30).ToString('yyyy-MM-dd')
$sql = "SELECT crear_turno('Laboratorio', NULL, 'PACIENTE_PRUEBA_SYNC_CONS', DATE '$fecha', TIME '09:45', 'ANALISIS_PRUEBA_SYNC_CONS', 'PROFESIONAL_PRUEBA_SYNC', 'Pendiente');"
docker compose exec -T consultorios psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c $sql
```

**Verificación:**

```powershell
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT turno_id, turno_origen_id, nodo_creador, nodo_responsable, area, paciente, fecha, hora, tipo_estudio, profesional, estado FROM turnos_locales WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS';"
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT e.evento_id, e.nodo_origen, e.identificador_origen, e.operacion, d.nodo_destino, d.estado, d.intentos, d.ultimo_error, e.sincronizado FROM eventos_sincronizacion e JOIN eventos_destinos d USING(evento_id) WHERE e.datos->>'paciente'='PACIENTE_PRUEBA_SYNC_CONS' ORDER BY e.evento_id,d.nodo_destino;"
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen, turno_origen_id, nodo_creador, nodo_responsable, area, paciente, fecha, hora, tipo_estudio, profesional, estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS';"
docker compose exec -T imagenes psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen, turno_origen_id, nodo_creador, nodo_responsable, area, paciente, fecha, hora, tipo_estudio, profesional, estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS';"
```

**Resultado esperado:** la función devuelve `turno_id` local y genera `turno_origen_id` `consultorios-UUID`. Outbox tiene dos filas de destino; ambas quedan `entregado`, el evento `sincronizado = t`, y ambas copias muestran creador `consultorios`, área `Laboratorio` y responsable `laboratorio`.

**Qué significa si falla:** si no existe original, revisa error SQL/configuración; si falta outbox, el trigger no está instalado; `error`/`pendiente` apunta a conectividad o sincronizador. No vuelvas a crear el turno para reintentar.

## Verificar el turno sintético con Laboratorio detenido

**Objetivo:** comprobar que el turno ya creado permanece en Consultorios, que el outbox retiene la entrega fallida y que Imágenes puede recibirla de manera independiente.

**Preparación:** Laboratorio permanece detenido. No vuelvas a ejecutar `crear_turno()` para `PACIENTE_PRUEBA_SYNC_CAIDA`: el ID local 5 ya existe. Consultorios, Imágenes y el sincronizador están activos.

**Comandos:** son solo SELECT; puedes repetirlos sin modificar el turno:

```powershell
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT turno_id,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,fecha,hora,tipo_estudio,profesional,estado FROM turnos_locales WHERE paciente='PACIENTE_PRUEBA_SYNC_CAIDA';"
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT e.evento_id,e.sincronizado AS sincronizado_global,d.nodo_destino,d.estado AS estado_destino,d.intentos,d.ultimo_intento,d.ultimo_error FROM eventos_sincronizacion e JOIN eventos_destinos d USING(evento_id) WHERE e.datos->>'paciente'='PACIENTE_PRUEBA_SYNC_CAIDA' ORDER BY d.nodo_destino;"
docker compose exec -T imagenes psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,fecha,hora,tipo_estudio,profesional,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_CAIDA';"
docker compose exec -T imagenes psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,identificador_evento,entidad,fecha_recepcion FROM eventos_recibidos WHERE nodo_origen='consultorios' AND identificador_evento=14;"
```

**Verificación:** compara la fila de turnos local, los dos estados del outbox y la copia/recibo de Imágenes.

**Resultado esperado:** antes de recuperar el nodo, `turnos_locales` contenía el ID 5 y el evento 14 tenía Imágenes `entregado`, Laboratorio `error`, y `sincronizado_global = false`. Esa lectura registró 15 intentos; el error era DNS (`laboratorio` no resolvía). Tras recuperar Laboratorio, una comprobación posterior confirmó ambos destinos `entregado`, una copia y un recibo en Laboratorio, y `sincronizado_global = true`. `estado`, `intentos`, `ultimo_intento` y `ultimo_error` pertenecen a `eventos_destinos`; `sincronizado` pertenece a `eventos_sincronizacion`.

**Qué significa si falla:** si falta el original o la fila del destino, no borres ni recrees nada: detén la prueba y revisa el trigger/outbox. `pendiente` es el estado antes del primer intento; luego el sincronizador registra `error` y conserva el mismo evento para reintentar.

## Crear un turno local mientras el receptor está detenido

**Objetivo:** reproducir en otra ocasión que un fallo remoto no bloquea la escritura local.

**Preparación:** Laboratorio detenido; Consultorios e Imágenes saludables. Usa un marcador nuevo que no exista.

**Comandos:** este bloque crea una única fila sintética nueva:

```powershell
$fecha = (Get-Date).AddDays(31).ToString('yyyy-MM-dd')
$sql = "SELECT crear_turno('Laboratorio', NULL, 'PACIENTE_PRUEBA_SYNC_OFFLINE_NUEVO', DATE '$fecha', TIME '10:15', 'ANALISIS_PRUEBA_SYNC_OFFLINE_NUEVO', 'PROFESIONAL_PRUEBA_SYNC', 'Pendiente');"
docker compose exec -T consultorios psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c $sql
```

**Verificación:**

```powershell
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT turno_id,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,fecha,hora,estado FROM turnos_locales WHERE paciente='PACIENTE_PRUEBA_SYNC_OFFLINE_NUEVO';"
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT e.evento_id,e.sincronizado AS sincronizado_global,d.nodo_destino,d.estado AS estado_destino,d.intentos,d.ultimo_error FROM eventos_sincronizacion e JOIN eventos_destinos d USING(evento_id) WHERE e.datos->>'paciente'='PACIENTE_PRUEBA_SYNC_OFFLINE_NUEVO' ORDER BY d.nodo_destino;"
docker compose exec -T imagenes psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,fecha,hora,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_OFFLINE_NUEVO';"
```

**Resultado esperado:** el turno y dos destinos quedan registrados localmente sin esperar respuesta del receptor. El destino Laboratorio estará primero `pendiente` y después `error`; `sincronizado_global` permanece falso mientras falte la entrega. Imágenes recibe su copia.

**Qué significa si falla:** si la llamada local falla por indisponibilidad de Laboratorio, el alta depende indebidamente del receptor. Si el marcador ya existe, no repitas la creación.

## Controlar los reintentos durante una prueba offline

**Objetivo:** pausar temporalmente el worker para que `intentos` y logs no cambien cada ciclo mientras inspeccionas el caso.

**Preparación:** el turno sintético está creado y se verificó al menos un destino Laboratorio con estado `error`. Esta pausa detiene solo el sincronizador; no detiene PostgreSQL ni modifica turnos/outbox.

**Comandos:** pausa el worker y verifica el servicio:

```powershell
docker compose stop sincronizador
docker compose ps --all
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT e.evento_id,e.sincronizado AS sincronizado_global,d.nodo_destino,d.estado AS estado_destino,d.intentos,d.ultimo_intento,d.ultimo_error FROM eventos_sincronizacion e JOIN eventos_destinos d USING(evento_id) WHERE e.datos->>'paciente'='PACIENTE_PRUEBA_SYNC_CAIDA' ORDER BY d.nodo_destino;"
```

Después de completar la inspección, inicia primero Laboratorio y espera `healthy`; luego reanuda el proceso:

```powershell
docker compose start laboratorio
$listo = $false
for ($intento = 0; $intento -lt 60 -and -not $listo; $intento++) { Start-Sleep -Seconds 2; docker compose exec -T laboratorio pg_isready -U salud_admin -d salud_db *> $null; $listo = ($LASTEXITCODE -eq 0) }
if (-not $listo) { throw 'Laboratorio no aceptó conexiones tras 120 segundos.' }
docker compose start sincronizador
Start-Sleep -Seconds 12
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT e.evento_id,e.sincronizado AS sincronizado_global,d.nodo_destino,d.estado AS estado_destino,d.intentos,d.ultimo_error FROM eventos_sincronizacion e JOIN eventos_destinos d USING(evento_id) WHERE e.datos->>'paciente'='PACIENTE_PRUEBA_SYNC_CAIDA' ORDER BY d.nodo_destino;"
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,fecha,hora,tipo_estudio,profesional,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_CAIDA';"
```

**Verificación:** mientras el worker está detenido, consulta outbox tantas veces como quieras; esos SELECT no cambian el estado. Tras reanudarlo, contrasta entrega y copia con las consultas incluidas.

**Resultado esperado:** el worker revisa cada ciclo (`SYNC_INTERVAL_SECONDS=10`); ante error registra `error`, `ultimo_error` e incrementa `intentos`. Ahora espera 10, 20, 40, 80, 160 y como máximo 300 segundos antes de reintentar, en función del intento. Reintenta indefinidamente con esa espera máxima; al volver Laboratorio, entrega el mismo evento y el receptor aplica el upsert idempotente.

**Qué significa si falla:** no ejecutes `--once` mientras el worker continuo está activo para perseguir solo este evento: ese comando recorre toda la outbox pendiente/error y puede competir con el worker. Si se requiere una pasada manual, primero detén el servicio y verifica que sea aceptable procesar todos los eventos pendientes/error; la aplicación actual no ofrece un selector de evento individual.

## Recuperar Laboratorio y entregar el pendiente

**Objetivo:** confirmar recuperación automática y demostrar el reintento manual disponible.

**Preparación:** el escenario offline anterior está creado; Consultorios no se reinició. El ciclo es de 10 s; la próxima entrega espera el backoff restante (hasta 300 s), además del ciclo y el arranque de PostgreSQL.

**Comandos:**

```powershell
docker compose start laboratorio
$listo = $false
for ($intento = 0; $intento -lt 60 -and -not $listo; $intento++) { Start-Sleep -Seconds 2; docker compose exec -T laboratorio pg_isready -U salud_admin -d salud_db *> $null; $listo = ($LASTEXITCODE -eq 0) }
if (-not $listo) { throw 'Laboratorio no aceptó conexiones tras 120 segundos.' }
Start-Sleep -Seconds 12
docker compose logs --since 2m sincronizador
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT e.evento_id,e.sincronizado AS sincronizado_global,d.nodo_destino,d.estado AS estado_destino,d.intentos,d.ultimo_error FROM eventos_sincronizacion e JOIN eventos_destinos d USING(evento_id) WHERE e.datos->>'paciente'='PACIENTE_PRUEBA_SYNC_CAIDA' ORDER BY d.nodo_destino;"
```

**Verificación:** consulta el original y el estado de ambos destinos; los conteos deben ser uno:

```powershell
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT e.evento_id,e.sincronizado AS sincronizado_global,d.nodo_destino,d.estado AS estado_destino,d.intentos,d.ultimo_error FROM eventos_sincronizacion e JOIN eventos_destinos d USING(evento_id) WHERE e.evento_id=14 ORDER BY d.nodo_destino;"
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,fecha,hora,tipo_estudio,profesional,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_CAIDA';"
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT count(*) AS copias FROM turnos_compartidos WHERE nodo_origen='consultorios' AND turno_origen_id='consultorios-5a6da01b-8a48-4642-a211-ad4ab54cbde7';"
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT count(*) AS recibos FROM eventos_recibidos WHERE nodo_origen='consultorios' AND identificador_evento=14;"
```

**Resultado esperado:** `pg_isready` responde `accepting connections`; al vencer el backoff restante (hasta 300 segundos) y correr un ciclo automático, ambos destinos quedan `entregado`, el indicador global `t`, y los conteos en Laboratorio son una copia y un recibo. El original continúa con una sola fila en Consultorios. Si se necesita forzar una pasada manual, sigue la prueba “Ejecutar un ciclo manual” en `comandos_docker.md`; no la ejecutes en paralelo con el worker continuo.

**Qué significa si falla:** revisa `ultimo_error`, logs del sincronizador, host/puertos configurados y `pg_isready`. No repitas la inserción para intentar reparar entrega.

## Comprobar recepción, deduplicación y ausencia de ciclos

**Objetivo:** verificar una copia operativa, una recepción por evento y que la copia no vuelva al outbox como evento nuevo.

**Preparación:** el turno sintético está entregado a Laboratorio. Usa el valor `turno_origen_id` de Consultorios.

**Comandos:**

```powershell
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT turno_origen_id FROM turnos_locales WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS';"
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,fecha,hora,tipo_estudio,profesional,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS';"
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT evento_id,nodo_origen,identificador_origen,operacion FROM eventos_sincronizacion WHERE datos->>'paciente'='PACIENTE_PRUEBA_SYNC_CONS' ORDER BY evento_id;"
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,count(*) AS copias FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS' GROUP BY nodo_origen,turno_origen_id;"
```

**Verificación:** copia un `evento_id` del resultado anterior y consulta recibos en cada receptor (sustituye `123` por ese número):

```powershell
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,identificador_evento,entidad,fecha_recepcion FROM eventos_recibidos WHERE nodo_origen='consultorios' AND identificador_evento=123;"
docker compose exec -T imagenes psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,identificador_evento,entidad,fecha_recepcion FROM eventos_recibidos WHERE nodo_origen='consultorios' AND identificador_evento=123;"
```

Para probar una redelivery real sin crear otro turno, restablece solo la entrega del evento sintético al destino Laboratorio y luego vuelve a ejecutar el ciclo. Hazlo únicamente si la consulta previa confirma que hay una sola fila para este marcador:

```powershell
docker compose exec -T consultorios psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "BEGIN; UPDATE eventos_destinos d SET estado='error',ultimo_error='Reintento manual de prueba' FROM eventos_sincronizacion e WHERE e.evento_id=d.evento_id AND e.datos->>'paciente'='PACIENTE_PRUEBA_SYNC_CONS' AND d.nodo_destino='laboratorio' AND d.estado='entregado'; UPDATE eventos_sincronizacion e SET sincronizado=FALSE WHERE e.datos->>'paciente'='PACIENTE_PRUEBA_SYNC_CONS' AND EXISTS (SELECT 1 FROM eventos_destinos d WHERE d.evento_id=e.evento_id AND d.nodo_destino='laboratorio' AND d.estado='error'); COMMIT;"
docker compose run --rm --no-deps sincronizador python /app/python/sincronizarNodos.py --once
```

Luego repite las consultas de copia y recepción:

```powershell
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,count(*) AS copias FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS' GROUP BY nodo_origen,turno_origen_id;"
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,identificador_evento,count(*) AS recepciones FROM eventos_recibidos WHERE nodo_origen='consultorios' AND identificador_evento=123 GROUP BY nodo_origen,identificador_evento;"
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT e.evento_id,d.estado,d.intentos,e.sincronizado FROM eventos_sincronizacion e JOIN eventos_destinos d USING(evento_id) WHERE e.datos->>'paciente'='PACIENTE_PRUEBA_SYNC_CONS' AND d.nodo_destino='laboratorio';"
```

```powershell
docker compose run --rm --no-deps sincronizador python /app/python/sincronizarNodos.py --once
```

**Resultado esperado:** la nueva pasada incrementa intentos, deja destino `entregado`, y mantiene una sola copia y una sola recepción para el mismo evento. El reintento controlado no crea filas en el outbox receptor porque la copia compartida no tiene trigger de sincronización. `123` debe ser el mismo `evento_id` usado en la consulta de recibos.

**Qué significa si falla:** duplicados visibles sugieren una alteración manual del esquema; una recepción ausente junto a copia indica revisar transacciones/identificador del evento. La pasada normal no fuerza redelivery de destinos ya `entregado`.

## Modificar y cancelar respetando propiedad

**Objetivo:** probar propagación de UPDATE y cancelación desde el nodo propietario.

**Preparación:** el turno sintético de la primera prueba fue creado en Consultorios y sincronizado. Laboratorio es responsable por el área, pero Consultorios es propietario y autoritativo.

**Comandos:** el comando obtiene automáticamente el `turno_id` local único del marcador sintético:

```powershell
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT turno_id,turno_origen_id,paciente FROM turnos_locales WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS';"
$turnoId = [int](docker compose exec -T consultorios psql -X -A -t -U salud_admin -d salud_db -c "SELECT turno_id FROM turnos_locales WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS';")
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "UPDATE turnos_locales SET profesional='PROFESIONAL_PRUEBA_SYNC_MOD' WHERE turno_id=$turnoId AND paciente='PACIENTE_PRUEBA_SYNC_CONS';"
Start-Sleep -Seconds 12
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT paciente,profesional,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS';"
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "UPDATE turnos_locales SET estado='Cancelado' WHERE turno_id=$turnoId AND paciente='PACIENTE_PRUEBA_SYNC_CONS';"
Start-Sleep -Seconds 12
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT paciente,profesional,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS';"
```

**Verificación:** compara la fila local y compartida; para una alta originada en Laboratorio, las modificaciones deben hacerse allí sobre `turnos_locales` y se verifican en Consultorios e Imágenes.

**Resultado esperado:** el profesional modificado y luego `Cancelado` se propagan a ambas copias. Una copia de turno de Consultorios no se puede editar desde Laboratorio: el nodo creador mantiene propiedad aunque el área asigne otro responsable.

**Qué significa si falla:** compara outbox/destinos; si el UPDATE no devuelve fila puede ser ID o marcador incorrecto. No modifiques directamente `turnos_compartidos`.

## Crear desde los tres nodos

**Objetivo:** verificar propietario y dos receptores en cada origen.

**Preparación:** los tres nodos saludables; utiliza marcadores únicos. El destino de Imágenes se llama `diagnostico_imagenes` en configuración, mientras el servicio Compose se llama `imagenes`.

**Comandos:**

```powershell
$fecha = (Get-Date).AddDays(32).ToString('yyyy-MM-dd')
docker compose exec -T consultorios psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "SELECT crear_turno('Consultorios',NULL,'PACIENTE_PRUEBA_SYNC_CONS_LOCAL',DATE '$fecha',TIME '11:00','ANALISIS_PRUEBA_SYNC_CONS_LOCAL','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
docker compose exec -T laboratorio psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "SELECT crear_turno('Laboratorio',NULL,'PACIENTE_PRUEBA_SYNC_LAB',DATE '$fecha',TIME '11:15','ANALISIS_PRUEBA_SYNC_LAB','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
docker compose exec -T imagenes psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "SELECT crear_turno('Diagnóstico por Imágenes',NULL,'PACIENTE_PRUEBA_SYNC_IMG',DATE '$fecha',TIME '11:30','ANALISIS_PRUEBA_SYNC_IMG','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
Start-Sleep -Seconds 12
```

**Verificación:** ejecuta las consultas exactas para los originales y receptores:

```powershell
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT turno_origen_id,nodo_creador,nodo_responsable,area,paciente,estado FROM turnos_locales WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS_LOCAL';"
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS_LOCAL';"
docker compose exec -T imagenes psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_CONS_LOCAL';"
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT turno_origen_id,nodo_creador,nodo_responsable,area,paciente,estado FROM turnos_locales WHERE paciente='PACIENTE_PRUEBA_SYNC_LAB';"
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_LAB';"
docker compose exec -T imagenes psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_LAB';"
docker compose exec -T imagenes psql -X -U salud_admin -d salud_db -c "SELECT turno_origen_id,nodo_creador,nodo_responsable,area,paciente,estado FROM turnos_locales WHERE paciente='PACIENTE_PRUEBA_SYNC_IMG';"
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_IMG';"
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,nodo_creador,nodo_responsable,area,paciente,estado FROM turnos_compartidos WHERE paciente='PACIENTE_PRUEBA_SYNC_IMG';"
```

**Resultado esperado:** Consultorios es dueño del primero y Laboratorio e Imágenes receptores; Laboratorio es dueño del segundo y Consultorios e Imágenes receptores; `diagnostico_imagenes` es dueño del tercero y Consultorios/Laboratorio receptores. Responsable coincide con el área; cada outbox registra dos destinos entregados.

**Qué significa si falla:** revisa configuración de nodo, área exacta, identidad del propietario y estados de destino; no insertes manualmente en la tabla compartida.
