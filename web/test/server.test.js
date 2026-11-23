"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AREAS, DEMO_PREFIX, NODES, PERMISSION_CASES,
  buildAppointmentsSql, isLocalOrigin, isLoopback,
  sqlDate, sqlInteger, sqlLiteral, sqlTime, serviceFor,
  validateCreate, validateUpdate,
} = require("../server");

test("SQL literals escape input while preserving the literal value", () => {
  assert.equal(sqlLiteral("O'Connor"), "E'O''Connor'");
  assert.equal(sqlLiteral("linea\\ruta\ntexto"), "E'linea\\\\ruta\\ntexto'");
  assert.equal(sqlLiteral(null), "NULL");
  assert.throws(() => sqlLiteral("x\0y"), /no v.lido/i);
});

test("date, time and integer validators reject malformed values", () => {
  assert.equal(sqlDate("2027-01-05"), "E'2027-01-05'::date");
  assert.equal(sqlTime("09:45"), "E'09:45'::time");
  assert.equal(sqlInteger("17", "id", 1), "17");
  assert.throws(() => sqlDate("2027-02-30"));
  assert.throws(() => sqlTime("24:00"));
  assert.throws(() => sqlInteger("1; DROP TABLE x", "id", 1));
});

test("service routing is limited to the three configured nodes", () => {
  assert.deepEqual(Object.keys(NODES), ["consultorios", "laboratorio", "diagnostico_imagenes"]);
  assert.equal(serviceFor("laboratorio").service, "laboratorio");
  assert.throws(() => serviceFor("postgres"));
});

test("demo create requires the synthetic prefix and valid area", () => {
  const valid = validateCreate({ nodeId: "consultorios", area: "Laboratorio", paciente: `${DEMO_PREFIX}PACIENTE`, fecha: "2027-01-05", hora: "09:45", tipoEstudio: `${DEMO_PREFIX}ESTUDIO`, profesional: `${DEMO_PREFIX}PROFESIONAL`, estado: "Pendiente" }, { demoOnly: true });
  assert.equal(valid.area, "Laboratorio");
  assert.throws(() => validateCreate({ nodeId: "consultorios", area: "Laboratorio", paciente: "PACIENTE_REAL", fecha: "2027-01-05", hora: "09:45", tipoEstudio: `${DEMO_PREFIX}ESTUDIO`, profesional: `${DEMO_PREFIX}PROFESIONAL` }, { demoOnly: true }), /comenzar/);
  // Valid area labels pass input validation; PostgreSQL's owner trigger rejects
  // a Lab/Imaging node attempting to create another service's area.
  assert.equal(validateCreate({ nodeId: "laboratorio", area: AREAS[0], paciente: `${DEMO_PREFIX}P`, fecha: "2027-01-05", hora: "09:45", tipoEstudio: `${DEMO_PREFIX}E`, profesional: `${DEMO_PREFIX}PR` }, { demoOnly: true }).area, AREAS[0]);
});

test("updates accept only known local fields", () => {
  assert.deepEqual(validateUpdate({ fecha: "2027-01-05", estado: "Cancelado" }), ["fecha = E'2027-01-05'::date", "estado = E'Cancelado'"]);
  assert.throws(() => validateUpdate({ estado: "Borrado" }));
  assert.throws(() => validateUpdate({}));
});

test("manual appointment SQL reads actual original, shared and legacy tables", () => {
  const sql = buildAppointmentsSql("consultorios", { search: "DEMO%", date: "2027-01-05", area: "Laboratorio", status: "Pendiente", limit: "50" });
  assert.match(sql, /FROM turnos_locales/);
  assert.match(sql, /FROM turnos_compartidos/);
  assert.match(sql, /FROM turnos_consultorios/);
  assert.match(sql, /paciente ILIKE/);
  assert.match(sql, /fecha = .*::date/);
  assert.match(sql, /LIMIT 50/);
});

test("permission matrix covers all nine node and area combinations", () => {
  assert.equal(PERMISSION_CASES.length, 9);
  for (const id of Object.keys(NODES)) assert.equal(PERMISSION_CASES.filter(([node]) => node === id).length, 3);
});

test("backend origin and socket checks are local-only", () => {
  assert.equal(isLoopback("127.0.0.1"), true);
  assert.equal(isLoopback("::ffff:127.0.0.1"), true);
  assert.equal(isLoopback("10.0.0.4"), false);
  assert.equal(isLocalOrigin(undefined), true);
  assert.equal(isLocalOrigin("http://localhost:4173"), true);
  assert.equal(isLocalOrigin("https://example.org"), false);
});

test("static UI endpoints return content without querying or mutating databases", async () => {
  const { createServer } = require("../server");
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    for (const route of ["/", "/app.css", "/app.js", "/favicon.svg"]) {
      const response = await fetch(`http://127.0.0.1:${address.port}${route}`);
      assert.equal(response.status, 200, route);
      assert.ok(Number(response.headers.get("content-length")) > 0, route);
    }
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/server.js`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
