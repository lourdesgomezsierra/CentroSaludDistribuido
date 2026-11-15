-- ORIGEN RELACIONAL: CONSULTORIOS EXTERNOS
-- Datos ficticios para pruebas academicas. Ejecutar dentro de salud_db.

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

INSERT INTO pacientes (paciente_id, nombre_completo, telefono) VALUES
(1001, 'Ana Perez', '3794000001'),
(1012, 'Lucas Romero', '3794000002'),
(1013, 'Micaela Duarte', '3794000003')
ON CONFLICT (paciente_id) DO NOTHING;

INSERT INTO profesionales (profesional_id, nombre_completo, especialidad) VALUES
(201, 'Dra. Sofia Morales', 'Clinica medica'),
(202, 'Dr. Andres Molina', 'Cardiologia')
ON CONFLICT (profesional_id) DO NOTHING;

INSERT INTO turnos_consultorios
(turno_id, paciente_id, profesional_id, fecha, hora, estado) VALUES
(3001, 1001, 201, '2026-11-18', '10:00', 'Confirmado'),
(3002, 1012, 202, '2026-11-19', '10:30', 'Pendiente'),
(3003, 1013, 201, '2026-11-20', '11:00', 'Confirmado')
ON CONFLICT (turno_id) DO NOTHING;
