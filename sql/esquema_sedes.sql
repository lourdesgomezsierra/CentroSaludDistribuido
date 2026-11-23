-- Catálogos locales para Laboratorio e Imágenes y staging de importaciones.
CREATE TABLE IF NOT EXISTS pacientes_locales (
    paciente_id INTEGER PRIMARY KEY,
    nombre_completo VARCHAR(120) NOT NULL
);

CREATE TABLE IF NOT EXISTS profesionales_locales (
    profesional_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre_completo VARCHAR(120) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS turnos_integrados (
    turno_integrado_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    origen VARCHAR(40) NOT NULL CHECK (origen IN ('consultorios', 'laboratorio', 'diagnostico_imagenes')),
    turno_origen_id VARCHAR(100) NOT NULL,
    paciente_id_origen INTEGER,
    paciente VARCHAR(120) NOT NULL,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    area VARCHAR(80) NOT NULL,
    tipo_estudio VARCHAR(120) NOT NULL,
    profesional VARCHAR(120) NOT NULL,
    estado VARCHAR(20) NOT NULL CHECK (estado IN ('Confirmado', 'Pendiente', 'Cancelado')),
    UNIQUE (origen, turno_origen_id)
);
