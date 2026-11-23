"""Prueba de integración de los nueve permisos; requiere los tres nodos activos."""

import os
import unittest

import psycopg


AREAS = (
    "Consultorios",
    "Laboratorio",
    "Diagnóstico por Imágenes",
)
PERMISOS = {
    "consultorios": {"Consultorios", "Laboratorio", "Diagnóstico por Imágenes"},
    "laboratorio": {"Laboratorio"},
    "diagnostico_imagenes": {"Diagnóstico por Imágenes"},
}
PUERTOS = {
    "consultorios": 5443,
    "laboratorio": 5444,
    "diagnostico_imagenes": 5445,
}


class PermisosCreacionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.password = os.environ.get("TEST_DB_PASSWORD") or os.environ.get("DB_PASSWORD")
        if not cls.password:
            raise unittest.SkipTest("Definí TEST_DB_PASSWORD para usar bases de prueba")
        cls.conexiones = {}
        for nodo, puerto in PUERTOS.items():
            cls.conexiones[nodo] = psycopg.connect(
                host=os.environ.get(
                    f"TEST_DB_HOST_{nodo.upper()}",
                    os.environ.get(f"DB_HOST_{nodo.upper()}", "localhost"),
                ),
                port=int(os.environ.get(
                    f"TEST_DB_PORT_{nodo.upper()}",
                    os.environ.get(f"DB_PORT_{nodo.upper()}", puerto),
                )),
                dbname="salud_db",
                user="salud_admin",
                password=cls.password,
                connect_timeout=3,
            )

    @classmethod
    def tearDownClass(cls):
        for conexion in getattr(cls, "conexiones", {}).values():
            conexion.close()

    def test_matriz_completa(self):
        for nodo, conexion in self.conexiones.items():
            for area in AREAS:
                with self.subTest(nodo=nodo, area=area):
                    cursor = conexion.cursor()
                    aceptado = area in PERMISOS[nodo]
                    try:
                        cursor.execute(
                            "SELECT crear_turno(%s, %s, %s, %s, %s, %s, %s, %s)",
                            (area, 1, "Paciente de prueba", "2099-01-01",
                             "09:00", "Prueba", "Profesional de prueba", "Pendiente"),
                        )
                        if not aceptado:
                            self.fail(f"{nodo} pudo crear un turno de {area}")
                    except psycopg.Error:
                        if aceptado:
                            self.fail(f"{nodo} rechazó un turno permitido de {area}")
                    finally:
                        conexion.rollback()
                        cursor.close()


if __name__ == "__main__":
    unittest.main()
