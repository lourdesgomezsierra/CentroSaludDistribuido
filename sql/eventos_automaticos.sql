-- Instalar luego de sincronizacion.sql y de los esquemas locales.
CREATE OR REPLACE FUNCTION registrar_evento_turno()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_nodo VARCHAR(40);
    v_datos JSONB;
    v_id VARCHAR(100);
    v_evento BIGINT;
    v_paciente TEXT;
    v_profesional TEXT;
BEGIN
    SELECT nodo_id INTO STRICT v_nodo FROM configuracion_nodo;
    IF TG_OP = 'DELETE' THEN
        v_datos := to_jsonb(OLD);
        v_id := COALESCE(to_jsonb(OLD)->>'turno_origen_id', to_jsonb(OLD)->>'turno_id');
    ELSE
        v_datos := to_jsonb(NEW);
        v_id := COALESCE(to_jsonb(NEW)->>'turno_origen_id', to_jsonb(NEW)->>'turno_id');
    END IF;
    IF v_id IS NULL THEN
        RAISE EXCEPTION 'El turno debe tener un identificador de origen';
    END IF;

    IF TG_TABLE_NAME = 'turnos_consultorios' THEN
        v_id := 'CONS-' || v_id;
        v_datos := v_datos || jsonb_build_object('turno_origen_id', v_id);
        SELECT p.nombre_completo, pr.nombre_completo
        INTO v_paciente, v_profesional
        FROM pacientes p
        JOIN profesionales pr ON pr.profesional_id =
            COALESCE((v_datos->>'profesional_id')::INTEGER, -1)
        WHERE p.paciente_id = COALESCE((v_datos->>'paciente_id')::INTEGER, -1);
        v_datos := v_datos || jsonb_build_object(
            'turno_origen_id', v_id,
            'nodo_creador', v_nodo,
            'area', 'Consultorios',
            'paciente', v_paciente,
            'profesional', v_profesional,
            'tipo_estudio', 'Consulta médica'
        );
    END IF;

    INSERT INTO eventos_sincronizacion(nodo_origen, entidad, identificador_origen, operacion, datos)
    VALUES (v_nodo, TG_TABLE_NAME, v_id, TG_OP, v_datos)
    RETURNING evento_id INTO v_evento;

    INSERT INTO eventos_destinos(evento_id, nodo_destino)
    SELECT v_evento, nodos.nodo_id
    FROM (VALUES ('consultorios'), ('laboratorio'), ('diagnostico_imagenes')) AS nodos(nodo_id)
    WHERE nodos.nodo_id <> v_nodo;

    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_registrar_evento_turno ON turnos_locales;
CREATE TRIGGER trg_registrar_evento_turno
AFTER INSERT OR UPDATE OR DELETE ON turnos_locales
FOR EACH ROW EXECUTE FUNCTION registrar_evento_turno();
