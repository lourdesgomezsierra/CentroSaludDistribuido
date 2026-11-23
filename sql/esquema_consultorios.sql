-- Estructura del nodo de Consultorios, separada de la carga de datos inicial.
CREATE TABLE IF NOT EXISTS pacientes (
    paciente_id INTEGER PRIMARY KEY,
    nombre_completo VARCHAR(120) NOT NULL,
    telefono VARCHAR(30)
);

CREATE TABLE IF NOT EXISTS profesionales (
    profesional_id INTEGER PRIMARY KEY,
    nombre_completo VARCHAR(120) NOT NULL,
    especialidad VARCHAR(100) NOT NULL
);

CREATE TABLE IF NOT EXISTS turnos_consultorios (
    turno_id INTEGER PRIMARY KEY,
    paciente_id INTEGER NOT NULL REFERENCES pacientes(paciente_id),
    profesional_id INTEGER NOT NULL REFERENCES profesionales(profesional_id),
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    estado VARCHAR(20) NOT NULL
        CHECK (estado IN ('Confirmado', 'Pendiente', 'Cancelado'))
);
