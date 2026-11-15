
-- ==========================================================
-- CENTRO DE SALUD DISTRIBUIDO
-- Infraestructura para sincronizacion asincrona
-- ==========================================================

-- Registro de cambios generados en cada nodo.
CREATE TABLE IF NOT EXISTS eventos_sincronizacion (
    evento_id BIGSERIAL PRIMARY KEY,
    nodo_origen VARCHAR(40) NOT NULL,
    entidad VARCHAR(50) NOT NULL,
    identificador_origen VARCHAR(50) NOT NULL,
    operacion VARCHAR(20) NOT NULL,
    datos JSONB NOT NULL,
    fecha_evento TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sincronizado BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (nodo_origen, entidad, identificador_origen, operacion)
);

-- Registro de eventos recibidos de otros nodos.
CREATE TABLE IF NOT EXISTS eventos_recibidos (
    evento_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nodo_origen VARCHAR(40) NOT NULL,
    identificador_evento BIGINT NOT NULL,
    entidad VARCHAR(50) NOT NULL,
    fecha_recepcion TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (nodo_origen, identificador_evento)
);

CREATE INDEX IF NOT EXISTS idx_eventos_pendientes
ON eventos_sincronizacion (sincronizado, fecha_evento);

CREATE INDEX IF NOT EXISTS idx_eventos_recibidos_origen
ON eventos_recibidos (nodo_origen, identificador_evento);
