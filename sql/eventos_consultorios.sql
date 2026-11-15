
-- Registro de eventos para Consultorios
CREATE OR REPLACE FUNCTION registrar_evento_consultorio()
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
        v_id := OLD.turno_id::VARCHAR;
    ELSE
        v_datos := to_jsonb(NEW);
        v_id := NEW.turno_id::VARCHAR;
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
        'turno_consultorios',
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
