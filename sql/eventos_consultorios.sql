-- El esquema de origen ya fue creado antes de este archivo de inicialización.
DROP TRIGGER IF EXISTS trg_evento_consultorios ON turnos_consultorios;
DROP TRIGGER IF EXISTS trg_registrar_evento_consultorio ON turnos_consultorios;
CREATE TRIGGER trg_registrar_evento_consultorio
AFTER INSERT OR UPDATE OR DELETE ON turnos_consultorios
FOR EACH ROW EXECUTE FUNCTION registrar_evento_turno();
