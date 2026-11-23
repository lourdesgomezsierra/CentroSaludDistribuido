# Centro de Salud Distribuido

Proyecto académico con tres bases PostgreSQL independientes (Consultorios, Laboratorio e Imágenes). La sincronización de turnos se realiza mediante outbox/eventos lógicos y un servicio Python; no es replicación física de PostgreSQL.

## Requisitos y primer inicio

Se necesita Docker Compose. Copiá `.env.example` a `.env` y reemplazá `DB_PASSWORD` por una contraseña local. `.env` está excluido de Git.

```powershell
Copy-Item .env.example .env
docker compose up -d --build
docker compose ps
```

Los scripts montados en `/docker-entrypoint-initdb.d` se ejecutan automáticamente **solo cuando PostgreSQL inicializa un directorio de datos vacío**. Incluyen la estructura de Consultorios, su trigger y, al final, los datos iniciales, de modo que esos registros también generan eventos. No borres `consultorios/data`, `laboratorio/data` ni `imagenes/data` para forzar la inicialización. Si ya contienen una base creada, conservá los datos y prepará/aplicá una migración respaldada antes de usar la nueva versión; la migración de bases existentes no se ejecuta automáticamente.

Para actualizar las bases existentes del proyecto sin borrar los volúmenes, usá `./scripts/actualizar-bases.ps1`. El script crea primero un dump personalizado de cada base dentro de `backups/` y solo entonces aplica la migración aditiva en orden. La migración conserva las filas actuales, normaliza las etiquetas conocidas, adapta eventos existentes y genera snapshots idempotentes de los turnos locales actuales para reconciliar copias faltantes. Revisá que los tres contenedores estén activos antes de ejecutarlo.

La secuencia de una instalación nueva crea las tablas compartidas, tablas de integración, el esquema de Consultorios donde corresponde, el identificador de nodo, las validaciones de turnos y finalmente los triggers. Consultorios usa el puerto host `5443`, Laboratorio `5444` e Imágenes `5445`; dentro de Compose el servicio sincronizador usa DNS de servicio y puerto `5432`.

## Turnos y propiedad

Usá `python/gestionarTurnos.py` como interfaz mínima de backend. El nodo indicado selecciona la base local; la base obtiene su identidad de `configuracion_nodo` y no acepta un creador distinto. `crear_turno` aplica la matriz de permisos en PostgreSQL y `turnos_locales` guarda los turnos originales. El responsable se deriva del área (`nodo_responsable`); el creador conserva la propiedad del registro. Las copias viven en `turnos_compartidos` y no se editan como turnos locales.

Ejemplo (requiere Python y las dependencias de `requirements.txt` instaladas):

```powershell
$env:DB_PASSWORD = 'tu-contraseña-local'
python python/gestionarTurnos.py --nodo consultorios crear --area Laboratorio --paciente Ana --fecha 2026-12-10 --hora 09:30 --tipo-estudio Hemograma --profesional 'Dra. Ejemplo'
```

Desde `laboratorio`, las áreas válidas son solo `Laboratorio`; desde `diagnostico_imagenes`, solo `Diagnóstico por Imágenes`. Las áreas se validan en trigger SQL. Modificar y cancelar operan sobre identificadores de `turnos_locales` del nodo conectado; una copia remota no es editable desde esa interfaz.

## Sincronización

Cada INSERT/UPDATE/DELETE de un turno original registra un snapshot en `eventos_sincronizacion` dentro de la misma transacción y crea un estado por nodo destino en `eventos_destinos`. El servicio Compose `sincronizador` consulta los pendientes cada diez segundos. Un nodo caído deja sus eventos en estado reintentable; los otros destinos pueden recibirlos sin esperar. El receptor inserta una clave idempotente en `eventos_recibidos` y aplica el upsert/tombstone en la misma transacción. Los triggers no actúan sobre `turnos_compartidos`, por lo que una recepción no vuelve a originar el mismo cambio.

Para revisar estado y errores, conectate al nodo origen y consultá `eventos_destinos` junto con `eventos_sincronizacion`. Para una ejecución manual de un ciclo, con dependencias instaladas y variables de conexión, ejecutá `python python/sincronizarNodos.py --once`.

## Integración de fuentes

El flujo de fuentes es:

1. `python/procesarFuentes.py` procesa Excel y TXT y escribe JSON por fuente.
2. `python/integrarFuentes.py` lee Consultorios desde `5443`, conserva solo registros válidos y produce los archivos unificados y pendientes.
3. `python/cargarIntegrados.py` carga registros válidos en `turnos_integrados` de Consultorios; la clave `(origen, turno_origen_id)` evita duplicados.

Los scripts que conectan a PostgreSQL leen `DB_PASSWORD`. Se pueden configurar `DB_HOST_CONSULTORIOS`, `DB_PORT_CONSULTORIOS` para importar desde otro entorno; por defecto apuntan a `localhost:5443`.

## Desconexión y recuperación

No detengas ni elimines volúmenes para simular una falla. Podés parar temporalmente un servicio con `docker compose stop laboratorio`, generar un turno desde un nodo disponible y luego ejecutar `docker compose start laboratorio`. Verificá que el evento del destino aparezca como pendiente/error durante la desconexión y como `entregado` tras reconectar. El estado por destino queda persistido en la base del origen.

## Pruebas

`tests/test_permisos.py` verifica automáticamente los nueve casos de la matriz en las tres bases y revierte cada transacción de prueba. Requiere los servicios activos, `DB_PASSWORD` y dependencias instaladas:

```powershell
python -m pip install -r requirements.txt
python -m unittest discover -s tests -v
```

El alta, modificación, cancelación, reentrega duplicada y desconexión/recuperación del sincronizador se probaron manualmente sobre copias aisladas. Todavía no existe una suite automatizada para esos escenarios ni para reinicios de contenedores. No ejecutes escenarios de falla contra datos reales.

## Límites actuales

- Los scripts SQL de inicialización sirven para bases nuevas. Bases persistentes ya inicializadas requieren una migración explícita y respaldada; no se alteran ni se eliminan automáticamente.
- La identidad se determina por la configuración de cada base y se confía en que el servicio que se conecta lo haga al nodo correcto; no reemplaza autenticación/roles por usuario final.
- Los datos relacionales de Consultorios existentes están conectados al trigger de eventos. Las nuevas operaciones se crean mediante `crear_turno` en `turnos_locales`; una migración de registros antiguos a ese modelo requiere decisión y validación de datos.

## Interfaz local de operaciones

El panel web usa Node.js integrado y no requiere instalar paquetes ni publicar puertos adicionales. Arrancá primero los servicios que ya tengas configurados; después, desde PowerShell en la carpeta del proyecto:

```powershell
docker compose ps
./scripts/iniciar-interfaz.ps1
```

Abrí `http://127.0.0.1:4173`. Para detener el panel, usá `Ctrl+C` en su ventana. La interfaz se enlaza únicamente a loopback, consulta los tres nodos por Docker Compose y no expone la contraseña de PostgreSQL al navegador. El dashboard resume estado y conteos; la sección Turnos consulta filas reales. Los cambios se ejecutan en el nodo propietario, con las reglas SQL existentes.

El laboratorio A–G crea solo registros marcados `DEMO_DISTRIBUIDA_`; el caso de permisos usa transacciones revertidas. Detener/iniciar Laboratorio y reintentar un evento son acciones explícitas con frase de confirmación. La detención queda bloqueada si hay entregas no sintéticas pendientes para ese nodo. El panel no ofrece borrado de turnos ni operación de volúmenes. Revisá los datos antes de ejecutar las acciones de creación, modificación o cancelación.

Pruebas locales de la interfaz (Node.js 18 o posterior; no se conectan a PostgreSQL ni a Docker):

```powershell
node --test web/test/server.test.js
```
