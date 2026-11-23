# Docker y estado de los nodos

## Diagnosticar DNS, TCP y autenticación

**Objetivo:** comprobar desde el contenedor del sincronizador que resuelve los tres servicios, abre TCP a PostgreSQL y autentica con las credenciales efectivas configuradas, sin mostrarlas.

**Preparación:** los tres nodos deben estar iniciados y el servicio `sincronizador` activo.

**Comandos:**

```powershell
docker compose exec -T sincronizador python /app/python/verificarConectividadNodos.py
```

**Verificación:** observa las tres líneas `DNS OK`, `TCP OK` y `AUTH OK` para cada nodo. El script lee los mismos `DB_HOST_*`, `DB_PORT_*` y `DB_PASSWORD` que usa el proceso real; no requiere pasar una IP ni escribir una contraseña.

**Resultado esperado:** para Consultorios, Laboratorio e Imágenes aparecen DNS, TCP y autenticación correctos; el proceso termina con código 0.

**Qué significa si falla:** `DNS ERROR` apunta a alias/red Docker o a un nodo detenido; `TCP ERROR` apunta a PostgreSQL aún iniciando o puerto/red; `AUTH/SQL ERROR` tras DNS y TCP correctos apunta a credencial/base/usuario. La salida nunca incluye el valor de la contraseña.

## Comprobar estado, puertos y sincronizador

**Objetivo:** verificar que los tres PostgreSQL y el sincronizador estén activos y escuchar en los puertos esperados.

**Preparación:** PowerShell abierto en la raíz del repositorio; Docker Desktop activo.

**Comandos:**

```powershell
docker compose ps --all
docker ps --filter "name=salud_" --format "table {{.Names}}`t{{.Status}}`t{{.Ports}}"
docker compose port consultorios 5432
docker compose port laboratorio 5432
docker compose port imagenes 5432
docker compose exec -T consultorios pg_isready -U salud_admin -d salud_db
docker compose exec -T laboratorio pg_isready -U salud_admin -d salud_db
docker compose exec -T imagenes pg_isready -U salud_admin -d salud_db
```

**Verificación:** para las identidades, ejecutá:

```powershell
foreach ($servicio in @('consultorios','laboratorio','imagenes')) {
  docker compose exec -T $servicio psql -X -U salud_admin -d salud_db -c "SELECT singleton, nodo_id FROM configuracion_nodo;"
}
```

**Resultado esperado:** Consultorios, Laboratorio, Imágenes y `sincronizador` aparecen `Up`; los puertos host son `5443`, `5444` y `5445`; cada `pg_isready` informa `accepting connections`. Compose define healthchecks para bases nuevas, pero contenedores existentes que no tengan el campo Health no deben recrearse solo para esta prueba. Las identidades son `consultorios`, `laboratorio` y `diagnostico_imagenes`.

**Qué significa si falla:** `Exited` o `no response` indica que PostgreSQL no está disponible; puerto ausente suele indicar que el servicio no está publicado; una identidad vacía apunta a inicialización/migración incompleta.

## Revisar logs y eventos pendientes

**Objetivo:** comprobar errores de conexión, reintentos y entrega por destino.

**Preparación:** los contenedores deben estar iniciados.

**Comandos:**

```powershell
docker compose logs --tail 50 consultorios
docker compose logs --tail 50 laboratorio
docker compose logs --tail 50 imagenes
docker compose logs --tail 100 sincronizador
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT e.evento_id, e.nodo_origen, e.entidad, e.identificador_origen, d.nodo_destino, d.estado AS estado_destino, d.intentos, d.ultimo_intento, d.ultimo_error, e.sincronizado AS sincronizado_global FROM eventos_sincronizacion e JOIN eventos_destinos d USING (evento_id) WHERE d.estado <> 'entregado' ORDER BY e.evento_id, d.nodo_destino;"
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT nodo_destino, estado, count(*) AS eventos FROM eventos_destinos GROUP BY nodo_destino, estado ORDER BY nodo_destino, estado;"
```

**Verificación:** el primer SELECT lista fallas/pending; el segundo agrega los estados de entrega del outbox de Consultorios.

**Resultado esperado:** sin desconexiones, no hay filas pendientes/error y los destinos aparecen con entregas. El total no tiene que ser igual entre nodos, porque cada base conserva su propio outbox.

**Qué significa si falla:** `error` junto a `ultimo_error` identifica el destino; `pendiente` significa que aún no se ha intentado o que falta reprocesarlo; un outbox vacío después de crear un turno apunta al trigger o al mecanismo de creación.

## Detener únicamente Laboratorio

**Objetivo:** simular la caída de un solo receptor sin borrar ni recrear bases.

**Preparación:** Consultorios, Imágenes y el sincronizador activos.

**Comandos:**

```powershell
docker compose stop laboratorio
docker compose ps --all
docker inspect --format '{{.State.Status}}' salud_laboratorio
docker compose ps consultorios imagenes sincronizador
```

**Verificación:** `salud_laboratorio` debe figurar `exited`; Consultorios, Imágenes y sincronizador deben continuar `Up`.

**Resultado esperado:** solo se detiene el servicio Laboratorio. No se elimina el contenedor ni sus datos.

**Qué significa si falla:** si se detienen otros servicios, revisá el nombre usado en `docker compose stop`; no uses `docker compose down` para esta prueba.

## Recuperar Laboratorio

**Objetivo:** volver a iniciar el mismo nodo y permitir la entrega automática de pendientes.

**Preparación:** Laboratorio detenido con `docker compose stop laboratorio`.

**Comandos:**

```powershell
docker compose start laboratorio
docker compose ps --all
$listo = $false
for ($intento = 0; $intento -lt 60 -and -not $listo; $intento++) { Start-Sleep -Seconds 2; docker compose exec -T laboratorio pg_isready -U salud_admin -d salud_db *> $null; $listo = ($LASTEXITCODE -eq 0) }
if (-not $listo) { throw 'Laboratorio no aceptó conexiones tras 120 segundos.' }
docker compose logs --since 2m sincronizador
```

**Verificación:** el bucle termina cuando `pg_isready` responde correctamente; luego consulta el outbox de Consultorios con el comando de la prueba “Revisar logs y eventos pendientes”.

**Resultado esperado:** el sincronizador revisa cada **10 segundos** (`SYNC_INTERVAL_SECONDS=10`). Los errores esperan backoff exponencial: 10, 20, 40, 80, 160 y hasta 300 segundos, según `intentos`; al volver el nodo, la entrega ocurre cuando vence la espera restante y corre el ciclo siguiente.

**Qué significa si falla:** si el evento no avanza a `entregado`, revisá `ultimo_error`, logs de sincronizador, conectividad y que `pg_isready` informe `accepting connections`.

## Ejecutar un ciclo manual

**Objetivo:** pedir al proceso real del proyecto un solo ciclo de reintento.

**Preparación:** bases activas y `pg_isready` responde en cada nodo. Detén temporalmente el worker continuo para evitar que dos procesos compitan. Revisa antes las consultas de pendientes: el ciclo manual procesa todos los eventos pendientes y errores cuyo backoff ya venció, no solo un evento.

**Comandos:**

```powershell
docker compose stop sincronizador
docker compose run --rm --no-deps sincronizador python /app/python/sincronizarNodos.py --once
docker compose start sincronizador
```

**Verificación:** el resultado del comando y la consulta SQL de eventos pendientes muestran entregas; `docker compose ps sincronizador` vuelve a mostrar el worker continuo activo.

**Resultado esperado:** los eventos elegibles se entregan; el indicador global queda `TRUE` cuando todos los destinos recibieron el evento. Un evento `error` cuyo backoff no venció espera el próximo ciclo elegible.

**Qué significa si falla:** el mensaje del script y `ultimo_error` indican si falló autenticación, red, esquema o datos del evento. Si el servicio manual falla antes de `start sincronizador`, vuelve a iniciarlo; no recrees turnos para reintentar.
