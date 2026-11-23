"""Diagnóstico de DNS, TCP y autenticación con la configuración del sincronizador."""

import socket
import sys

from sincronizarNodos import DB_CONFIG, NODOS, conectar


def main():
    fallos = 0
    for nodo in NODOS:
        config = DB_CONFIG[nodo]
        host, puerto = config["host"], config["port"]

        try:
            direcciones = sorted({
                resultado[4][0]
                for resultado in socket.getaddrinfo(
                    host, puerto, type=socket.SOCK_STREAM
                )
            })
            print(f"{nodo}: DNS OK ({', '.join(direcciones)})")
        except OSError as error:
            print(f"{nodo}: DNS ERROR ({type(error).__name__})")
            fallos += 1
            continue

        try:
            with socket.create_connection((host, puerto), timeout=3):
                print(f"{nodo}: TCP OK ({host}:{puerto})")
        except OSError as error:
            print(f"{nodo}: TCP ERROR ({type(error).__name__})")
            fallos += 1
            continue

        try:
            with conectar(nodo) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT current_database(), current_user, "
                        "inet_server_addr(), inet_server_port()"
                    )
                    base, usuario, servidor, puerto_servidor = cur.fetchone()
            print(
                f"{nodo}: AUTH OK (base={base}, usuario={usuario}, "
                f"servidor={servidor}:{puerto_servidor})"
            )
        except Exception as error:
            # No se imprime el DSN ni ninguna variable de entorno sensible.
            print(f"{nodo}: AUTH/SQL ERROR ({type(error).__name__})")
            fallos += 1

    if fallos:
        print(f"Diagnóstico incompleto: {fallos} comprobación(es) fallaron.")
        return 1
    print("DNS, TCP y autenticación correctos en los tres nodos.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
