
-- Esquema local para Laboratorio e Imagenes

CREATE TABLE IF NOT EXISTS pacientes_locales (
    paciente_id INTEGER PRIMARY KEY,
    nombre_completo VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS profesionales_locales (
    profesional_id BIGSERIAL PRIMARY KEY,
    nombre_completo VARCHAR(120) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS turnos_locales (
    turno_id BIGSERIAL PRIMARY KEY,
    turno_origen_id VARCHAR(50),
    origen VARCHAR(40) NOT NULL,
    paciente_id INTEGER,
    paciente VARCHAR(120) NOT NULL,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    area VARCHAR(80) NOT NULL,
    tipo_estudio VARCHAR(120) NOT NULL,
    profesional VARCHAR(120) NOT NULL,
    estado VARCHAR(20) NOT NULL,
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (origen, turno_origen_id)
);

CREATE INDEX IF NOT EXISTS idx_turnos_fecha
ON turnos_locales(fecha);

CREATE INDEX IF NOT EXISTS idx_turnos_paciente
ON turnos_locales(paciente_id);
