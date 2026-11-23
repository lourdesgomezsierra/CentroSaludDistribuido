-- Actualización aditiva para las bases del proyecto ya creadas.
-- No elimina registros. Ejecutar en cada salud_db luego de sincronizacion.sql,
-- esquema_sedes.sql y antes de los scripts de funciones/triggers.
BEGIN;

-- Las versiones anteriores usaban nodo_id como única columna. singleton fija
-- exactamente una identidad por base y conserva el identificador existente.
ALTER TABLE configuracion_nodo
    ADD COLUMN IF NOT EXISTS singleton BOOLEAN NOT NULL DEFAULT TRUE;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='configuracion_nodo'::regclass AND conname='configuracion_nodo_singleton_key') THEN
        ALTER TABLE configuracion_nodo ADD CONSTRAINT configuracion_nodo_singleton_key UNIQUE (singleton);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='configuracion_nodo'::regclass AND conname='configuracion_nodo_singleton_check') THEN
        ALTER TABLE configuracion_nodo ADD CONSTRAINT configuracion_nodo_singleton_check CHECK (singleton);
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='configuracion_nodo'::regclass AND conname='configuracion_nodo_nodo_id_check') THEN
        ALTER TABLE configuracion_nodo ADD CONSTRAINT configuracion_nodo_nodo_id_check
            CHECK (nodo_id IN ('consultorios','laboratorio','diagnostico_imagenes')) NOT VALID;
    END IF;
END $$;
ALTER TABLE configuracion_nodo VALIDATE CONSTRAINT configuracion_nodo_nodo_id_check;

-- turnos_locales antiguas llamaban "origen" al creador. Renombrar conserva
-- valores, índices, claves y relaciones existentes.
DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='turnos_locales' AND column_name='origen'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='turnos_locales' AND column_name='nodo_creador'
    ) THEN
        ALTER TABLE turnos_locales RENAME COLUMN origen TO nodo_creador;
    END IF;
END $$;
ALTER TABLE turnos_locales ADD COLUMN IF NOT EXISTS nodo_creador VARCHAR(40);
UPDATE turnos_locales
SET nodo_creador = (SELECT nodo_id FROM configuracion_nodo LIMIT 1)
WHERE nodo_creador IS NULL;
UPDATE turnos_locales SET area = CASE
    WHEN lower(area) LIKE 'consultorio%' THEN 'Consultorios'
    WHEN lower(area) = 'laboratorio' THEN 'Laboratorio'
    WHEN lower(area) LIKE 'diagn%' THEN 'Diagnóstico por Imágenes'
    ELSE area END
WHERE area NOT IN ('Consultorios','Laboratorio','Diagnóstico por Imágenes');
ALTER TABLE turnos_locales ALTER COLUMN nodo_creador SET NOT NULL;
ALTER TABLE turnos_locales ALTER COLUMN turno_origen_id SET NOT NULL;
ALTER TABLE turnos_locales ALTER COLUMN turno_origen_id TYPE VARCHAR(100);
ALTER TABLE turnos_locales ADD COLUMN IF NOT EXISTS nodo_responsable VARCHAR(40)
    GENERATED ALWAYS AS (
        CASE area WHEN 'Consultorios' THEN 'consultorios'
                  WHEN 'Laboratorio' THEN 'laboratorio'
                  ELSE 'diagnostico_imagenes' END
    ) STORED;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='turnos_locales'::regclass AND conname='turnos_locales_nodo_creador_check') THEN
        ALTER TABLE turnos_locales ADD CONSTRAINT turnos_locales_nodo_creador_check
            CHECK (nodo_creador IN ('consultorios','laboratorio','diagnostico_imagenes')) NOT VALID;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='turnos_locales'::regclass AND conname='turnos_locales_area_check') THEN
        ALTER TABLE turnos_locales ADD CONSTRAINT turnos_locales_area_check
            CHECK (area IN ('Consultorios','Laboratorio','Diagnóstico por Imágenes')) NOT VALID;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='turnos_locales'::regclass AND conname='turnos_locales_estado_check') THEN
        ALTER TABLE turnos_locales ADD CONSTRAINT turnos_locales_estado_check
            CHECK (estado IN ('Confirmado','Pendiente','Cancelado')) NOT VALID;
    END IF;
END $$;
ALTER TABLE turnos_locales VALIDATE CONSTRAINT turnos_locales_nodo_creador_check;
ALTER TABLE turnos_locales VALIDATE CONSTRAINT turnos_locales_area_check;
ALTER TABLE turnos_locales VALIDATE CONSTRAINT turnos_locales_estado_check;

ALTER TABLE turnos_compartidos ADD COLUMN IF NOT EXISTS nodo_creador VARCHAR(40);
UPDATE turnos_compartidos SET nodo_creador = COALESCE(nodo_creador, nodo_origen);
UPDATE turnos_compartidos SET area = CASE
    WHEN lower(area) LIKE 'consultorio%' THEN 'Consultorios'
    WHEN lower(area) = 'laboratorio' THEN 'Laboratorio'
    WHEN lower(area) LIKE 'diagn%' THEN 'Diagnóstico por Imágenes'
    ELSE area END
WHERE area NOT IN ('Consultorios','Laboratorio','Diagnóstico por Imágenes');
ALTER TABLE turnos_compartidos ALTER COLUMN nodo_creador SET NOT NULL;
ALTER TABLE turnos_compartidos ALTER COLUMN turno_origen_id TYPE VARCHAR(100);
ALTER TABLE turnos_compartidos ADD COLUMN IF NOT EXISTS nodo_responsable VARCHAR(40)
    GENERATED ALWAYS AS (
        CASE area WHEN 'Consultorios' THEN 'consultorios'
                  WHEN 'Laboratorio' THEN 'laboratorio'
                  ELSE 'diagnostico_imagenes' END
    ) STORED;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='turnos_compartidos'::regclass AND conname='turnos_compartidos_nodo_creador_check') THEN
        ALTER TABLE turnos_compartidos ADD CONSTRAINT turnos_compartidos_nodo_creador_check
            CHECK (nodo_creador IN ('consultorios','laboratorio','diagnostico_imagenes')) NOT VALID;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='turnos_compartidos'::regclass AND conname='turnos_compartidos_area_check') THEN
        ALTER TABLE turnos_compartidos ADD CONSTRAINT turnos_compartidos_area_check
            CHECK (area IN ('Consultorios','Laboratorio','Diagnóstico por Imágenes')) NOT VALID;
    END IF;
END $$;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='turnos_compartidos'::regclass AND conname='turnos_compartidos_estado_check') THEN
        ALTER TABLE turnos_compartidos ADD CONSTRAINT turnos_compartidos_estado_check
            CHECK (estado IN ('Confirmado','Pendiente','Cancelado')) NOT VALID;
    END IF;
END $$;
ALTER TABLE turnos_compartidos VALIDATE CONSTRAINT turnos_compartidos_nodo_creador_check;
ALTER TABLE turnos_compartidos VALIDATE CONSTRAINT turnos_compartidos_area_check;
ALTER TABLE turnos_compartidos VALIDATE CONSTRAINT turnos_compartidos_estado_check;
ALTER TABLE eventos_sincronizacion ALTER COLUMN identificador_origen TYPE VARCHAR(100);
ALTER TABLE eventos_sincronizacion
    DROP CONSTRAINT IF EXISTS eventos_sincronizacion_nodo_origen_entidad_identificador_origen_operacion_key;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='turnos_integrados'::regclass AND conname='turnos_integrados_origen_id_key') THEN
        ALTER TABLE turnos_integrados ADD CONSTRAINT turnos_integrados_origen_id_key
            UNIQUE (origen, turno_origen_id);
    END IF;
END $$;

-- Actualizar los snapshots antiguos a la estructura que consume el sincronizador.
UPDATE eventos_sincronizacion e
SET entidad = 'turnos_locales',
    datos = e.datos || jsonb_build_object(
        'nodo_creador', e.nodo_origen,
        'turno_origen_id', COALESCE(e.datos->>'turno_origen_id', e.identificador_origen),
        'area', CASE
            WHEN lower(COALESCE(e.datos->>'area','')) LIKE 'consultorio%' THEN 'Consultorios'
            WHEN lower(COALESCE(e.datos->>'area','')) = 'laboratorio' THEN 'Laboratorio'
            WHEN lower(COALESCE(e.datos->>'area','')) LIKE 'diagn%' THEN 'Diagnóstico por Imágenes'
            ELSE e.datos->>'area' END
    )
WHERE e.entidad = 'turno';

-- Eventos antiguos de Consultorios solo guardaban IDs foráneos. Completar su
-- snapshot desde los catálogos antes de que el sincronizador vuelva a intentar.
DO $$ BEGIN
    IF to_regclass('public.turnos_consultorios') IS NOT NULL THEN
        UPDATE eventos_sincronizacion e
        SET entidad = 'turnos_consultorios',
            identificador_origen = 'CONS-' || t.turno_id::text,
            datos = to_jsonb(t) || jsonb_build_object(
                'turno_origen_id', 'CONS-' || t.turno_id::text,
                'nodo_creador', 'consultorios',
                'area', 'Consultorios',
                'paciente', p.nombre_completo,
                'profesional', pr.nombre_completo,
                'tipo_estudio', 'Consulta médica'
            )
        FROM turnos_consultorios t
        JOIN pacientes p ON p.paciente_id = t.paciente_id
        JOIN profesionales pr ON pr.profesional_id = t.profesional_id
        WHERE (
            e.entidad = 'turno_consultorios'
            OR (e.entidad = 'turnos_consultorios' AND e.datos->>'nodo_creador' IS NULL)
        )
          AND t.turno_id::text = COALESCE(e.datos->>'turno_id', e.identificador_origen);
    END IF;
END $$;

-- Reconciliar el estado actual completo como snapshots idempotentes. Esto
-- recupera turnos locales que existían antes de que el outbox estuviera activo.
INSERT INTO eventos_sincronizacion (
    nodo_origen, entidad, identificador_origen, operacion, datos
)
SELECT t.nodo_creador, 'turnos_locales', t.turno_origen_id, 'UPDATE',
       to_jsonb(t) || jsonb_build_object('_snapshot_version', '1')
FROM turnos_locales t
WHERE NOT EXISTS (
    SELECT 1 FROM eventos_sincronizacion e
    WHERE e.entidad = 'turnos_locales'
      AND e.identificador_origen = t.turno_origen_id
      AND e.operacion = 'UPDATE'
      AND e.datos->>'_snapshot_version' = '1'
);

DO $$ BEGIN
    IF to_regclass('public.turnos_consultorios') IS NOT NULL THEN
        INSERT INTO eventos_sincronizacion (
            nodo_origen, entidad, identificador_origen, operacion, datos
        )
        SELECT 'consultorios', 'turnos_consultorios', 'CONS-' || t.turno_id::text,
               'UPDATE', to_jsonb(t) || jsonb_build_object(
                   'turno_origen_id', 'CONS-' || t.turno_id::text,
                   'nodo_creador', 'consultorios',
                   'area', 'Consultorios',
                   'paciente', p.nombre_completo,
                   'profesional', pr.nombre_completo,
                   'tipo_estudio', 'Consulta médica',
                   '_snapshot_version', '1'
               )
        FROM turnos_consultorios t
        JOIN pacientes p ON p.paciente_id = t.paciente_id
        JOIN profesionales pr ON pr.profesional_id = t.profesional_id
        WHERE NOT EXISTS (
            SELECT 1 FROM eventos_sincronizacion e
            WHERE e.entidad = 'turnos_consultorios'
              AND e.identificador_origen = 'CONS-' || t.turno_id::text
              AND e.operacion = 'UPDATE'
              AND e.datos->>'_snapshot_version' = '1'
        );
    END IF;
END $$;

-- Reconstruir entrega por destino desde el estado antiguo y la deduplicación
-- existente. Un evento previamente sincronizado queda entregado; los demás se
-- envían solo a destinos que aún no lo registraron.
INSERT INTO eventos_destinos(evento_id, nodo_destino)
SELECT e.evento_id, n.nodo_id
FROM eventos_sincronizacion e
CROSS JOIN (VALUES ('consultorios'), ('laboratorio'), ('diagnostico_imagenes')) AS n(nodo_id)
WHERE n.nodo_id <> e.nodo_origen
ON CONFLICT (evento_id, nodo_destino) DO NOTHING;
UPDATE eventos_destinos d
SET estado = CASE
        WHEN e.sincronizado OR EXISTS (
            SELECT 1 FROM eventos_recibidos r
            WHERE r.nodo_origen = e.nodo_origen
              AND r.identificador_evento = e.evento_id
        ) THEN 'entregado'
        ELSE 'pendiente' END,
    ultimo_error = NULL
FROM eventos_sincronizacion e
WHERE e.evento_id = d.evento_id;

COMMIT;
