"""Interfaz backend mínima para crear, modificar y cancelar turnos locales."""

import argparse
import os

import psycopg2


NODOS = {
    "consultorios": 5443,
    "laboratorio": 5444,
    "diagnostico_imagenes": 5445,
}


def conectar(nodo):
    password = os.environ.get("DB_PASSWORD")
    if not password:
        raise RuntimeError("Definí DB_PASSWORD en el entorno o en .env")
    return psycopg2.connect(
        host=os.environ.get(f"DB_HOST_{nodo.upper()}", "localhost"),
        port=int(os.environ.get(f"DB_PORT_{nodo.upper()}", NODOS[nodo])),
        dbname="salud_db", user="salud_admin", password=password,
        connect_timeout=3,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nodo", required=True, choices=NODOS)
    sub = parser.add_subparsers(dest="operacion", required=True)

    crear = sub.add_parser("crear")
    crear.add_argument("--area", required=True)
    crear.add_argument("--paciente-id", type=int)
    crear.add_argument("--paciente", required=True)
    crear.add_argument("--fecha", required=True, help="AAAA-MM-DD")
    crear.add_argument("--hora", required=True, help="HH:MM")
    crear.add_argument("--tipo-estudio", required=True)
    crear.add_argument("--profesional", required=True)
    crear.add_argument(
        "--estado", choices=("Confirmado", "Pendiente", "Cancelado"),
        default="Pendiente",
    )

    for nombre in ("modificar", "cancelar"):
        comando = sub.add_parser(nombre)
        comando.add_argument("--turno-id", required=True, type=int)
        if nombre == "modificar":
            comando.add_argument("--paciente")
            comando.add_argument("--fecha")
            comando.add_argument("--hora")
            comando.add_argument("--tipo-estudio")
            comando.add_argument("--profesional")
            comando.add_argument("--estado", choices=("Confirmado", "Pendiente", "Cancelado"))

    args = parser.parse_args()
    with conectar(args.nodo) as conn:
        with conn.cursor() as cur:
            if args.operacion == "crear":
                cur.execute(
                    "SELECT crear_turno(%s, %s, %s, %s, %s, %s, %s, %s)",
                    (args.area, args.paciente_id, args.paciente, args.fecha,
                     args.hora, args.tipo_estudio, args.profesional, args.estado),
                )
                print(f"Turno local creado: {cur.fetchone()[0]}")
            elif args.operacion == "cancelar":
                cur.execute(
                    "UPDATE turnos_locales SET estado = 'Cancelado' WHERE turno_id = %s",
                    (args.turno_id,),
                )
                if cur.rowcount != 1:
                    raise ValueError("No existe un turno local con ese identificador")
                print("Turno cancelado; el trigger registró el evento")
            else:
                campos = {
                    "paciente": args.paciente,
                    "fecha": args.fecha,
                    "hora": args.hora,
                    "tipo_estudio": args.tipo_estudio,
                    "profesional": args.profesional,
                    "estado": args.estado,
                }
                asignaciones = [f"{campo} = %s" for campo, valor in campos.items() if valor is not None]
                valores = [valor for valor in campos.values() if valor is not None]
                if not asignaciones:
                    parser.error("modificar requiere al menos un campo")
                cur.execute(
                    f"UPDATE turnos_locales SET {', '.join(asignaciones)} WHERE turno_id = %s",
                    (*valores, args.turno_id),
                )
                if cur.rowcount != 1:
                    raise ValueError("No existe un turno local con ese identificador")
                print("Turno actualizado; el trigger registró el evento")


if __name__ == "__main__":
    main()
