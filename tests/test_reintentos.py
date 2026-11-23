"""Pruebas puras del backoff de reintentos, sin conexión a PostgreSQL."""

import unittest
from datetime import datetime, timedelta, timezone

from python.sincronizarNodos import (
    registrar_aviso_error_origen,
    reintento_vencido,
    tiempo_espera_reintento,
)


class BackoffReintentosTest(unittest.TestCase):
    def setUp(self):
        self.ahora = datetime(2026, 11, 23, 15, 0, tzinfo=timezone.utc)

    def test_espera_exponencial_y_limite(self):
        self.assertEqual(tiempo_espera_reintento(1, 10, 300), 10)
        self.assertEqual(tiempo_espera_reintento(2, 10, 300), 20)
        self.assertEqual(tiempo_espera_reintento(3, 10, 300), 40)
        self.assertEqual(tiempo_espera_reintento(6, 10, 300), 300)
        self.assertEqual(tiempo_espera_reintento(100, 10, 300), 300)

    def test_pendiente_se_intenta_inmediatamente(self):
        reciente = self.ahora - timedelta(seconds=1)
        self.assertTrue(reintento_vencido("pendiente", 0, reciente, self.ahora))

    def test_error_espera_ventana_y_luego_es_elegible(self):
        ultimo = self.ahora - timedelta(seconds=9)
        self.assertFalse(reintento_vencido("error", 1, ultimo, self.ahora))
        ultimo = self.ahora - timedelta(seconds=10)
        self.assertTrue(reintento_vencido("error", 1, ultimo, self.ahora))

    def test_siguiente_fallo_duplica_ventana(self):
        ultimo = self.ahora - timedelta(seconds=19)
        self.assertFalse(reintento_vencido("error", 2, ultimo, self.ahora))
        ultimo = self.ahora - timedelta(seconds=20)
        self.assertTrue(reintento_vencido("error", 2, ultimo, self.ahora))

    def test_error_sin_fecha_se_reintenta_y_entregado_no(self):
        self.assertTrue(reintento_vencido("error", 1, None, self.ahora))
        self.assertFalse(reintento_vencido("entregado", 1, None, self.ahora))

    def test_aviso_de_origen_caido_se_limita_por_intervalo(self):
        avisos = {}
        self.assertTrue(registrar_aviso_error_origen("laboratorio", 0, avisos, 60))
        self.assertFalse(registrar_aviso_error_origen("laboratorio", 30, avisos, 60))
        self.assertTrue(registrar_aviso_error_origen("laboratorio", 60, avisos, 60))


if __name__ == "__main__":
    unittest.main()
