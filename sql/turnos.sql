-- La autoridad de cada turno es el nodo donde existe en turnos_locales.
CREATE OR REPLACE FUNCTION validar_turno_local()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_nodo VARCHAR(40);
BEGIN
    SELECT nodo_id INTO STRICT v_nodo FROM configuracion_nodo;
    IF TG_OP = 'INSERT' THEN
        IF NEW.nodo_creador <> v_nodo THEN
            RAISE EXCEPTION 'El turno debe ser creado por el nodo local (%)', v_nodo;
        END IF;
        IF v_nodo = 'laboratorio' AND NEW.area <> 'Laboratorio' THEN
            RAISE EXCEPTION 'Laboratorio solo puede crear turnos de Laboratorio';
        ELSIF v_nodo = 'diagnostico_imagenes' AND NEW.area <> 'Diagnóstico por Imágenes' THEN
            RAISE EXCEPTION 'Diagnóstico por Imágenes solo puede crear turnos de su área';
        END IF;
    ELSE
        IF NEW.nodo_creador <> OLD.nodo_creador OR NEW.turno_origen_id <> OLD.turno_origen_id THEN
            RAISE EXCEPTION 'No se puede cambiar la propiedad o el identificador original del turno';
        END IF;
        IF v_nodo <> OLD.nodo_creador THEN
            RAISE EXCEPTION 'Este nodo no es propietario del turno';
        END IF;
        IF NEW.area <> OLD.area THEN
            RAISE EXCEPTION 'El área del turno no se puede cambiar';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_turno_local ON turnos_locales;
CREATE TRIGGER trg_validar_turno_local
BEFORE INSERT OR UPDATE ON turnos_locales
FOR EACH ROW EXECUTE FUNCTION validar_turno_local();

CREATE OR REPLACE FUNCTION crear_turno(
    p_area VARCHAR(80), p_paciente_id INTEGER, p_paciente VARCHAR(120),
    p_fecha DATE, p_hora TIME, p_tipo_estudio VARCHAR(120),
    p_profesional VARCHAR(120), p_estado VARCHAR(20) DEFAULT 'Pendiente'
) RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
    v_nodo VARCHAR(40);
    v_turno_id BIGINT;
BEGIN
    SELECT nodo_id INTO STRICT v_nodo FROM configuracion_nodo;
    INSERT INTO turnos_locales (
        turno_origen_id, nodo_creador, area, paciente_id, paciente,
        fecha, hora, tipo_estudio, profesional, estado
    ) VALUES (
        v_nodo || '-' || gen_random_uuid()::text, v_nodo, p_area, p_paciente_id,
        p_paciente, p_fecha, p_hora, p_tipo_estudio, p_profesional, p_estado
    ) RETURNING turno_id INTO v_turno_id;
    RETURN v_turno_id;
END;
$$;
