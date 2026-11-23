# Limpieza segura de datos sintéticos

La limpieza se realiza exclusivamente en `turnos_locales`, que contiene los originales propiedad del nodo. El trigger registra `DELETE` en la outbox y los receptores eliminan la copia al recibirlo. No se borran copias, outbox ni recibos directamente: su historial permite deduplicar y auditar.

## Eliminar turnos de prueba por sus nodos propietarios

**Objetivo:** quitar únicamente turnos claramente etiquetados como datos de prueba y propagar la eliminación.

**Preparación:** inicia los tres nodos y espera a que estén saludables. Revisa primero las previsualizaciones; deben listar únicamente datos sintéticos del kit. Si aparece un dato inesperado, no ejecutes los DELETE.

**Comandos:** previsualiza en cada base:

```powershell
$filtro = "paciente LIKE 'PACIENTE_PRUEBA_SYNC%' AND profesional LIKE 'PROFESIONAL_PRUEBA_SYNC%' AND tipo_estudio LIKE 'ANALISIS_PRUEBA_SYNC%'"
foreach ($servicio in @('consultorios','laboratorio','imagenes')) {
  Write-Host "Previsualización: $servicio"
  docker compose exec -T $servicio psql -X -U salud_admin -d salud_db -c "SELECT turno_id,turno_origen_id,nodo_creador,area,paciente,tipo_estudio,profesional,estado FROM turnos_locales WHERE $filtro ORDER BY turno_id;"
}
```

Si las filas son exclusivamente de prueba, elimina en cada propietario:

```powershell
foreach ($servicio in @('consultorios','laboratorio','imagenes')) {
  Write-Host "Eliminando solo marcadores de prueba: $servicio"
  docker compose exec -T $servicio psql -X -v ON_ERROR_STOP=1 -U salud_admin -d salud_db -c "DELETE FROM turnos_locales WHERE paciente LIKE 'PACIENTE_PRUEBA_SYNC%' AND profesional LIKE 'PROFESIONAL_PRUEBA_SYNC%' AND tipo_estudio LIKE 'ANALISIS_PRUEBA_SYNC%' RETURNING turno_origen_id,paciente;"
}
Start-Sleep -Seconds 12
docker compose run --rm --no-deps sincronizador python /app/python/sincronizarNodos.py --once
```

**Verificación:**

```powershell
foreach ($servicio in @('consultorios','laboratorio','imagenes')) {
  Write-Host "Turnos locales sintéticos restantes: $servicio"
  docker compose exec -T $servicio psql -X -U salud_admin -d salud_db -c "SELECT turno_origen_id,paciente FROM turnos_locales WHERE paciente LIKE 'PACIENTE_PRUEBA_SYNC%' AND profesional LIKE 'PROFESIONAL_PRUEBA_SYNC%' AND tipo_estudio LIKE 'ANALISIS_PRUEBA_SYNC%';"
  Write-Host "Copias compartidas sintéticas restantes: $servicio"
  docker compose exec -T $servicio psql -X -U salud_admin -d salud_db -c "SELECT nodo_origen,turno_origen_id,paciente FROM turnos_compartidos WHERE paciente LIKE 'PACIENTE_PRUEBA_SYNC%' AND profesional LIKE 'PROFESIONAL_PRUEBA_SYNC%' AND tipo_estudio LIKE 'ANALISIS_PRUEBA_SYNC%';"
}
```

**Resultado esperado:** no quedan originales ni copias para esos marcadores; el outbox conserva eventos DELETE entregados y `eventos_recibidos` conserva recibos. Si un nodo receptor no está disponible, su entrega DELETE permanece pendiente/error hasta recuperarlo.

**Qué significa si falla:** si la previsualización incluye una fila no creada por el kit, no ejecutes la eliminación. Si un original se borró pero una copia persiste, revisa la entrega DELETE en outbox y vuelve a sincronizar después de restaurar el nodo receptor. No borres `turnos_compartidos`, `eventos_sincronizacion` ni `eventos_recibidos` a mano.
