INSERT INTO configuracion_nodo(singleton, nodo_id) VALUES (TRUE, 'diagnostico_imagenes')
ON CONFLICT (singleton) DO UPDATE SET nodo_id = EXCLUDED.nodo_id;
