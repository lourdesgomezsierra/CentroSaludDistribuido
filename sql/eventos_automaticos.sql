
-- =====================================================
-- CENTRO DE SALUD DISTRIBUIDO
-- Registro automatico de cambios (Outbox)
-- =====================================================

-- Identificacion del nodo
CREATE TABLE IF NOT EXISTS configuracion_nodo (
    nodo_id VARCHAR(40) PRIMARY KEY
);

-- Tabla donde cada nodo almacena los turnos
-- recibidos de las otras sedes.
CREATE TABLE IF NOT EXISTS turnos_compartidos (
    nodo_origen VARCHAR(40) NOT NULL,
    turno_origen_id VARCHAR(50) NOT NULL,
    paciente_id INTEGER,
    paciente VARCHAR(120) NOT NULL,
    fecha DATE NOT NULL,
    hora TIME NOT NULL,
    area VARCHAR(80) NOT NULL,
    tipo_estudio VARCHAR(120) NOT NULL,
    profesional VARCHAR(120) NOT NULL,
    estado VARCHAR(20) NOT NULL,
    fecha_actualizacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (nodo_origen, turno_origen_id)
);

-- Permitir registrar varias modificaciones
-- del mismo turno a lo largo del tiempo.
ALTER TABLE eventos_sincronizacion
DROP CONSTRAINT IF EXISTS eventos_sincronizacion_nodo_origen_entidad_identificador_origen_operacion_key;

-- Funcion que registra automaticamente los cambios.
CREATE OR REPLACE FUNCTION registrar_evento_turno()
RETURNS TRIGGER AS $$
DECLARE
    v_nodo VARCHAR(40);
    v_datos JSONB;
    v_id VARCHAR(50);
BEGIN
    SELECT nodo_id INTO v_nodo
    FROM configuracion_nodo
    LIMIT 1;

    IF v_nodo IS NULL THEN
        RAISE EXCEPTION 'No se configuro el identificador del nodo';
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_datos := to_jsonb(OLD);
        v_id := OLD.turno_origen_id;
    ELSE
        v_datos := to_jsonb(NEW);
        v_id := NEW.turno_origen_id;
    END IF;

    INSERT INTO eventos_sincronizacion (
        nodo_origen,
        entidad,
        identificador_origen,
        operacion,
        datos
    )
    VALUES (
        v_nodo,
        'turno',
        v_id,
        TG_OP,
        v_datos
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Activar el registro automatico.
DROP TRIGGER IF EXISTS trg_registrar_evento_turno
ON turnos_locales;

CREATE TRIGGER trg_registrar_evento_turno
AFTER INSERT OR UPDATE OR DELETE
ON turnos_locales
FOR EACH ROW
EXECUTE FUNCTION registrar_evento_turno();
