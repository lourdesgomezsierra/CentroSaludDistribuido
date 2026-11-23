-- Esquema compartido por los tres nodos. Ejecutar una vez en cada salud_db.
CREATE TABLE IF NOT EXISTS configuracion_nodo (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    nodo_id VARCHAR(40) NOT NULL UNIQUE CHECK (nodo_id IN ('consultorios', 'laboratorio', 'diagnostico_imagenes'))
);

CREATE TABLE IF NOT EXISTS eventos_sincronizacion (
    evento_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nodo_origen VARCHAR(40) NOT NULL,
    entidad VARCHAR(50) NOT NULL,
    identificador_origen VARCHAR(100) NOT NULL,
    operacion VARCHAR(20) NOT NULL CHECK (operacion IN ('INSERT', 'UPDATE', 'DELETE')),
    datos JSONB NOT NULL,
    fecha_evento TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    sincronizado BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_eventos_pendientes
    ON eventos_sincronizacion (evento_id);

CREATE TABLE IF NOT EXISTS eventos_destinos (
    evento_id BIGINT NOT NULL REFERENCES eventos_sincronizacion(evento_id) ON DELETE CASCADE,
    nodo_destino VARCHAR(40) NOT NULL CHECK (nodo_destino IN ('consultorios', 'laboratorio', 'diagnostico_imagenes')),
    estado VARCHAR(16) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'procesando', 'entregado', 'error')),
    intentos INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
    ultimo_intento TIMESTAMPTZ,
    ultimo_error TEXT,
    PRIMARY KEY (evento_id, nodo_destino)
);
CREATE INDEX IF NOT EXISTS idx_eventos_destinos_pendientes
    ON eventos_destinos (estado, nodo_destino, evento_id);

CREATE TABLE IF NOT EXISTS eventos_recibidos (
    nodo_origen VARCHAR(40) NOT NULL,
    identificador_evento BIGINT NOT NULL,
    entidad VARCHAR(50) NOT NULL,
    fecha_recepcion TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (nodo_origen, identificador_evento)
);

CREATE TABLE IF NOT EXISTS turnos_compartidos (
    nodo_origen VARCHAR(40) NOT NULL CHECK (nodo_origen IN ('consultorios', 'laboratorio', 'diagnostico_imagenes')),
    turno_origen_id VARCHAR(100) NOT NULL,
    nodo_creador VARCHAR(40) NOT NULL CHECK (nodo_creador IN ('consultorios', 'laboratorio', 'diagnostico_imagenes')),
    area VARCHAR(80) NOT NULL CHECK (area IN ('Consultorios', 'Laboratorio', 'Diagnóstico por Imágenes')),
    nodo_responsable VARCHAR(40) GENERATED ALWAYS AS (
        CASE area WHEN 'Consultorios' THEN 'consultorios'
                  WHEN 'Laboratorio' THEN 'laboratorio'
                  ELSE 'diagnostico_imagenes' END
    ) STORED,
    paciente_id INTEGER,
    paciente VARCHAR(120) NOT NULL,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    tipo_estudio VARCHAR(120) NOT NULL,
    profesional VARCHAR(120) NOT NULL,
    estado VARCHAR(20) NOT NULL CHECK (estado IN ('Confirmado', 'Pendiente', 'Cancelado')),
    fecha_actualizacion TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (nodo_origen, turno_origen_id)
);

-- Tabla local para turnos cuya autoridad reside en este nodo.
CREATE TABLE IF NOT EXISTS turnos_locales (
    turno_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    turno_origen_id VARCHAR(100) NOT NULL,
    nodo_creador VARCHAR(40) NOT NULL CHECK (nodo_creador IN ('consultorios', 'laboratorio', 'diagnostico_imagenes')),
    area VARCHAR(80) NOT NULL CHECK (area IN ('Consultorios', 'Laboratorio', 'Diagnóstico por Imágenes')),
    nodo_responsable VARCHAR(40) GENERATED ALWAYS AS (
        CASE area WHEN 'Consultorios' THEN 'consultorios'
                  WHEN 'Laboratorio' THEN 'laboratorio'
                  ELSE 'diagnostico_imagenes' END
    ) STORED,
    paciente_id INTEGER,
    paciente VARCHAR(120) NOT NULL,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    tipo_estudio VARCHAR(120) NOT NULL,
    profesional VARCHAR(120) NOT NULL,
    estado VARCHAR(20) NOT NULL CHECK (estado IN ('Confirmado', 'Pendiente', 'Cancelado')),
    fecha_registro TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (nodo_creador, turno_origen_id)
);
CREATE INDEX IF NOT EXISTS idx_turnos_locales_fecha ON turnos_locales(fecha);
CREATE INDEX IF NOT EXISTS idx_turnos_locales_paciente ON turnos_locales(paciente_id);
