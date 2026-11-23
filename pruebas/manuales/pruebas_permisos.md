# Pruebas manuales de permisos

Cada caso usa `crear_turno`, el mecanismo oficial SQL. Un error aborta la sentencia y no deja fila local. Ejecuta desde PowerShell en la raíz del repositorio.

## Matriz de altas permitidas y denegadas

**Objetivo:** comprobar los nueve pares nodo/área definidos por la matriz de permisos.

**Preparación:** los tres nodos saludables; utiliza etiquetas sintéticas nuevas. Áreas exactas: `Consultorios`, `Laboratorio`, `Diagnóstico por Imágenes`.

**Comandos:** copia cada sentencia individualmente. Las tres primeras están permitidas:

```powershell
$fecha = (Get-Date).AddDays(35).ToString('yyyy-MM-dd')
docker compose exec -T consultorios psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "SELECT crear_turno('Consultorios',NULL,'PACIENTE_PRUEBA_SYNC_PERM_C1',DATE '$fecha',TIME '12:00','ANALISIS_PRUEBA_SYNC_PERM_C1','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
docker compose exec -T consultorios psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "SELECT crear_turno('Laboratorio',NULL,'PACIENTE_PRUEBA_SYNC_PERM_C2',DATE '$fecha',TIME '12:15','ANALISIS_PRUEBA_SYNC_PERM_C2','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
docker compose exec -T consultorios psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "SELECT crear_turno('Diagnóstico por Imágenes',NULL,'PACIENTE_PRUEBA_SYNC_PERM_C3',DATE '$fecha',TIME '12:30','ANALISIS_PRUEBA_SYNC_PERM_C3','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
docker compose exec -T laboratorio psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "SELECT crear_turno('Laboratorio',NULL,'PACIENTE_PRUEBA_SYNC_PERM_L1',DATE '$fecha',TIME '12:45','ANALISIS_PRUEBA_SYNC_PERM_L1','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
docker compose exec -T imagenes psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "SELECT crear_turno('Diagnóstico por Imágenes',NULL,'PACIENTE_PRUEBA_SYNC_PERM_I1',DATE '$fecha',TIME '13:00','ANALISIS_PRUEBA_SYNC_PERM_I1','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
```

Las restantes deben ser rechazadas. Ejecuta una por vez para poder observar el error de PostgreSQL:

```powershell
docker compose exec -T laboratorio psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "SELECT crear_turno('Consultorios',NULL,'PACIENTE_PRUEBA_SYNC_PERM_L2',DATE '$fecha',TIME '13:15','ANALISIS_PRUEBA_SYNC_PERM_L2','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
docker compose exec -T laboratorio psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "SELECT crear_turno('Diagnóstico por Imágenes',NULL,'PACIENTE_PRUEBA_SYNC_PERM_L3',DATE '$fecha',TIME '13:30','ANALISIS_PRUEBA_SYNC_PERM_L3','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
docker compose exec -T imagenes psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "SELECT crear_turno('Consultorios',NULL,'PACIENTE_PRUEBA_SYNC_PERM_I2',DATE '$fecha',TIME '13:45','ANALISIS_PRUEBA_SYNC_PERM_I2','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
docker compose exec -T imagenes psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "SELECT crear_turno('Laboratorio',NULL,'PACIENTE_PRUEBA_SYNC_PERM_I3',DATE '$fecha',TIME '14:00','ANALISIS_PRUEBA_SYNC_PERM_I3','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
```

**Verificación:**

```powershell
docker compose exec -T consultorios psql -X -U salud_admin -d salud_db -c "SELECT paciente,area,nodo_creador FROM turnos_locales WHERE paciente LIKE 'PACIENTE_PRUEBA_SYNC_PERM_C%';"
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT paciente,area,nodo_creador FROM turnos_locales WHERE paciente LIKE 'PACIENTE_PRUEBA_SYNC_PERM_L%';"
docker compose exec -T imagenes psql -X -U salud_admin -d salud_db -c "SELECT paciente,area,nodo_creador FROM turnos_locales WHERE paciente LIKE 'PACIENTE_PRUEBA_SYNC_PERM_I%';"
```

**Resultado esperado:** los cinco permitidos producen una fila local. Los casos Laboratorio→Consultorios y Laboratorio→Imágenes informan `Laboratorio solo puede crear turnos de Laboratorio`. Imágenes→Consultorios e Imágenes→Laboratorio informan `Diagnóstico por Imágenes solo puede crear turnos de su área`. Esos cuatro marcadores no aparecen en `turnos_locales`. Consultorios acepta las tres áreas.

**Qué significa si falla:** si una operación prohibida se inserta, la validación de `trg_validar_turno_local` o la identidad `configuracion_nodo` no corresponde al nodo; si una permitida se rechaza, comprueba área exacta, identidad y que el esquema/función estén aplicados.

## Modificación por un nodo que no es propietario

**Objetivo:** confirmar que Laboratorio no puede insertar localmente un turno cuyo propietario declarado sea Consultorios.

**Preparación:** crea un turno de Laboratorio desde Consultorios y espera a que aparezca en `turnos_compartidos` de Laboratorio.

**Comandos:** inserta un intento con un ID reservado para esta comprobación; la regla BEFORE INSERT debe rechazarlo antes de guardar:

```powershell
docker compose exec -T laboratorio psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "INSERT INTO turnos_locales (turno_origen_id,nodo_creador,area,paciente,fecha,hora,tipo_estudio,profesional,estado) VALUES ('consultorios-PRUEBA-PERMISO','consultorios','Laboratorio','PACIENTE_PRUEBA_SYNC_PERM_OWNER',CURRENT_DATE + 1,TIME '15:00','ANALISIS_PRUEBA_SYNC_PERM_OWNER','PROFESIONAL_PRUEBA_SYNC','Pendiente');"
```

**Verificación:**

```powershell
docker compose exec -T laboratorio psql -X -U salud_admin -d salud_db -c "SELECT count(*) AS filas_invalidas FROM turnos_locales WHERE paciente='PACIENTE_PRUEBA_SYNC_PERM_OWNER' OR turno_origen_id='consultorios-PRUEBA-PERMISO';"
```

**Resultado esperado:** PostgreSQL muestra `El turno debe ser creado por el nodo local (laboratorio)` y la consulta devuelve `filas_invalidas = 0`. La fila se rechaza en el trigger y no se genera evento.

**Qué significa si falla:** si aparece una fila, la validación de propiedad no se aplicó; si el intento se rechaza con error de otra columna, revisa el SQL y el esquema antes de interpretar el resultado.
