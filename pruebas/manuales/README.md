# Kit manual de pruebas — CentroSaludDistribuido

Estos procedimientos usan los tres servicios Compose existentes y la función SQL `crear_turno`. Las altas se escriben en `turnos_locales`; el trigger genera outbox en la misma transacción. El sincronizador copia los turnos a `turnos_compartidos` en los otros dos nodos.

## Antes de empezar

- Abrí PowerShell en la raíz del repositorio.
- Docker Desktop debe estar activo y `.env` debe contener `DB_PASSWORD` para las bases actuales.
- Para aplicar cambios del sincronizador o de su diagnóstico, ejecutá `docker compose build sincronizador` y luego `docker compose up -d --no-deps sincronizador`. Se recrea únicamente el servicio de sincronización; las bases no se reinician ni modifican.
- Los comandos SQL se ejecutan dentro del contenedor PostgreSQL como `salud_admin`; Compose resuelve la contraseña desde `.env`.
- El sincronizador repite cada 10 segundos los pendientes y aplica backoff para errores: 10, 20, 40, 80, 160 y hasta 300 segundos, persistido mediante `intentos` y `ultimo_intento` sin migrar el esquema.
- Si una base origen no responde, el sincronizador la vuelve a comprobar en el ciclo siguiente y limita el aviso de conexión a uno por minuto por nodo.
- Los ejemplos usan únicamente etiquetas sintéticas que comienzan con `PACIENTE_PRUEBA_SYNC` y `ANALISIS_PRUEBA_SYNC`.

## Archivos

- [comandos_docker.md](comandos_docker.md): estado, puertos, logs, parada y recuperación de Laboratorio.
- [pruebas_sincronizacion.md](pruebas_sincronizacion.md): crear, propagar, desconectar, recuperar, deduplicar, modificar y cancelar.
- [pruebas_permisos.md](pruebas_permisos.md): los nueve casos de la matriz.
- [consultas_verificacion.sql](consultas_verificacion.sql): consultas listas para validar datos, outbox, recepciones y duplicados.
- [limpieza_pruebas.md](limpieza_pruebas.md): eliminación segura de turnos sintéticos desde sus nodos propietarios.

## Propiedad y alcance de copias

`nodo_creador` identifica al propietario original. `nodo_responsable` se calcula a partir del área. La sincronización distribuye cada turno a los otros dos nodos, donde aparece en `turnos_compartidos`. La función de gestión solo modifica filas de `turnos_locales` del nodo creador; no existe un flujo de solicitud de cambios desde una copia compartida. Por ejemplo, si Consultorios creó un turno de Laboratorio, Laboratorio puede verlo como responsable y receptor, pero solo Consultorios puede modificar o cancelar el original. Un turno creado en Laboratorio sí puede modificarse allí porque creador y responsable coinciden.

## Qué no está cubierto por el kit

La prueba automatizada de permisos está en `tests/test_permisos.py`. La desconexión y recuperación se demuestran manualmente; no hay una suite automatizada de reinicios o fallos de red. La tabla `turnos_integrados` es staging de importaciones, no la tabla operativa de turnos.
