"use strict";

const http = require("node:http");
const { execFile, spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, "..");
const STATIC = path.join(__dirname, "public");
const PORT = Number(process.env.UI_PORT || 4173);
const BODY_LIMIT = 32 * 1024;
const DEMO_PREFIX = "DEMO_DISTRIBUIDA_";

const NODES = Object.freeze({
  consultorios: Object.freeze({
    id: "consultorios",
    service: "consultorios",
    container: "salud_consultorios",
    label: "Consultorios",
    port: 5443,
  }),
  laboratorio: Object.freeze({
    id: "laboratorio",
    service: "laboratorio",
    container: "salud_laboratorio",
    label: "Laboratorio",
    port: 5444,
  }),
  diagnostico_imagenes: Object.freeze({
    id: "diagnostico_imagenes",
    service: "imagenes",
    container: "salud_imagenes",
    label: "Diagnóstico por Imágenes",
    port: 5445,
  }),
});

const AREAS = Object.freeze([
  "Consultorios",
  "Laboratorio",
  "Diagnóstico por Imágenes",
]);
const ESTADOS_TURNO = Object.freeze(["Confirmado", "Pendiente", "Cancelado"]);
const DESTINOS = Object.freeze(Object.keys(NODES));
const ALLOWED_STATIC = Object.freeze({
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/app.css": ["app.css", "text/css; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/favicon.svg": ["favicon.svg", "image/svg+xml"],
});

class HttpError extends Error {
  constructor(status, message, extra = undefined) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

class PsqlError extends Error {
  constructor(exitCode, stderr) {
    super("La consulta PostgreSQL no se pudo completar.");
    this.exitCode = exitCode;
    this.detail = String(stderr || "");
  }
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  const source = String(value);
  if (source.includes("\0")) throw new HttpError(400, "El texto contiene un carácter no válido.");
  const escaped = source
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "''")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t");
  return `E'${escaped}'`;
}

function sqlInteger(value, name, min = 0, max = 2_147_483_647) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError(400, `${name} debe ser un número válido.`);
  }
  return String(parsed);
}

function sqlDate(value, name = "La fecha") {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${name} debe tener formato AAAA-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${name} no es válida.`);
  }
  return `${sqlLiteral(value)}::date`;
}

function sqlTime(value) {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new HttpError(400, "La hora debe tener formato HH:MM.");
  }
  return `${sqlLiteral(value)}::time`;
}

function checkedText(value, name, maxLength, { required = true, prefix = null } = {}) {
  if (value === undefined || value === null || value === "") {
    if (!required) return null;
    throw new HttpError(400, `Completá el campo ${name}.`);
  }
  if (typeof value !== "string" || value.length > maxLength || value.trim() !== value) {
    throw new HttpError(400, `El campo ${name} no tiene un valor válido.`);
  }
  if (prefix && !value.startsWith(prefix)) {
    throw new HttpError(400, `${name} debe comenzar con ${prefix}.`);
  }
  return value;
}

function serviceFor(nodeId) {
  const node = NODES[nodeId];
  if (!node) throw new HttpError(400, "Nodo no permitido.");
  return node;
}

function isLoopback(remoteAddress = "") {
  return remoteAddress === "127.0.0.1" ||
    remoteAddress === "::1" ||
    remoteAddress === "::ffff:127.0.0.1";
}

function isLocalOrigin(origin) {
  return origin === undefined || origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`;
}

function runPsql(nodeId, sql, { timeout = 15_000 } = {}) {
  const node = serviceFor(nodeId);
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "compose", "exec", "-T", node.service,
      "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
      "-U", "salud_admin", "-d", "salud_db",
    ], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdout = [];
    const stderr = [];
    let size = 0;
    let completed = false;
    const timer = setTimeout(() => {
      if (completed) return;
      completed = true;
      child.kill();
      reject(new HttpError(504, `Se agotó el tiempo consultando ${node.label}.`));
    }, timeout);

    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        child.kill();
        if (!completed) {
          completed = true;
          clearTimeout(timer);
          reject(new HttpError(502, "La consulta devolvió demasiados datos."));
        }
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      reject(new HttpError(503, `No se pudo ejecutar Docker (${error.code || "error de inicio"}).`));
    });
    child.on("close", (code) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      const output = Buffer.concat(stdout).toString("utf8").trim();
      const errorOutput = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) {
        reject(new PsqlError(code, errorOutput));
      } else {
        resolve(output);
      }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(`${sql}\n`);
  });
}

async function psqlJson(nodeId, sql) {
  const output = await runPsql(nodeId, sql);
  if (!output) return null;
  try {
    return JSON.parse(output);
  } catch {
    throw new HttpError(502, "PostgreSQL devolvió una respuesta no interpretable.");
  }
}

async function psqlRows(nodeId, selectSql) {
  const sql = `SELECT COALESCE(json_agg(row_to_json(q)), '[]'::json)::text FROM (${selectSql}) AS q;`;
  return (await psqlJson(nodeId, sql)) || [];
}

async function psqlOne(nodeId, selectSql) {
  const sql = `SELECT row_to_json(q)::text FROM (${selectSql}) AS q LIMIT 1;`;
  return psqlJson(nodeId, sql);
}

async function dockerInspect(nodeId) {
  const node = serviceFor(nodeId);
  try {
    const { stdout } = await execFileAsync(
      "docker",
      ["inspect", "--format", "{{.State.Status}}", node.container],
      { cwd: ROOT, windowsHide: true, timeout: 6_000, maxBuffer: 16 * 1024 },
    );
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

function nodeOverviewSql() {
  return `SELECT json_build_object(
    'nodeId', (SELECT nodo_id FROM configuracion_nodo LIMIT 1),
    'localTurns', (SELECT count(*) FROM turnos_locales),
    'sharedCopies', (SELECT count(*) FROM turnos_compartidos),
    'totalEvents', (SELECT count(*) FROM eventos_sincronizacion),
    'lastEvent', (SELECT max(fecha_evento) FROM eventos_sincronizacion),
    'destinations', COALESCE((
      SELECT json_agg(json_build_object(
        'node', nodo_destino,
        'delivered', delivered,
        'pending', pending,
        'failed', failed
      ) ORDER BY nodo_destino)
      FROM (
        SELECT nodo_destino,
          count(*) FILTER (WHERE estado = 'entregado') AS delivered,
          count(*) FILTER (WHERE estado IN ('pendiente','procesando')) AS pending,
          count(*) FILTER (WHERE estado = 'error') AS failed
        FROM eventos_destinos GROUP BY nodo_destino
      ) AS delivery_counts
    ), '[]'::json)
  )::text;`;
}

async function getOverview() {
  const nodeResults = await Promise.all(Object.values(NODES).map(async (node) => {
    const [containerState, stats] = await Promise.all([
      dockerInspect(node.id),
      psqlJson(node.id, nodeOverviewSql()).catch(() => null),
    ]);
    return {
      id: node.id,
      label: node.label,
      service: node.service,
      port: node.port,
      containerState,
      connected: Boolean(stats),
      lastChecked: new Date().toISOString(),
      localTurns: Number(stats?.localTurns || 0),
      sharedCopies: Number(stats?.sharedCopies || 0),
      totalEvents: Number(stats?.totalEvents || 0),
      lastEvent: stats?.lastEvent || null,
      destinations: stats?.destinations || [],
      error: stats ? null : "No se pudo consultar PostgreSQL en este nodo.",
    };
  }));

  const totals = nodeResults.reduce((acc, node) => {
    acc.events += node.totalEvents;
    acc.copies += node.sharedCopies;
    for (const destination of node.destinations) {
      acc.delivered += Number(destination.delivered || 0);
      acc.pending += Number(destination.pending || 0);
      acc.failed += Number(destination.failed || 0);
    }
    if (node.lastEvent && (!acc.lastEvent || node.lastEvent > acc.lastEvent)) {
      acc.lastEvent = node.lastEvent;
    }
    return acc;
  }, { events: 0, delivered: 0, pending: 0, failed: 0, copies: 0, lastEvent: null });

  return { nodes: nodeResults, metrics: totals, checkedAt: new Date().toISOString() };
}

function buildAppointmentsSql(nodeId, filters) {
  const branches = [`
    SELECT 'original'::text AS record_type, turno_id::text AS local_id,
      turno_origen_id, nodo_creador, nodo_creador AS nodo_origen,
      nodo_responsable, area, paciente_id, paciente, fecha, hora,
      tipo_estudio, profesional, estado, fecha_registro AS updated_at,
      TRUE AS editable
    FROM turnos_locales`];

  branches.push(`
    SELECT 'copia'::text AS record_type, NULL::text AS local_id,
      turno_origen_id, nodo_creador, nodo_origen, nodo_responsable, area,
      paciente_id, paciente, fecha, hora, tipo_estudio, profesional, estado,
      fecha_actualizacion AS updated_at, FALSE AS editable
    FROM turnos_compartidos`);

  if (nodeId === "consultorios") {
    branches.push(`
      SELECT 'heredado'::text AS record_type, t.turno_id::text AS local_id,
        'CONS-' || t.turno_id::text AS turno_origen_id,
        'consultorios'::varchar AS nodo_creador,
        'consultorios'::varchar AS nodo_origen,
        'consultorios'::varchar AS nodo_responsable,
        'Consultorios'::varchar AS area,
        t.paciente_id, p.nombre_completo AS paciente, t.fecha, t.hora,
        'Consulta médica'::varchar AS tipo_estudio,
        pr.nombre_completo AS profesional, t.estado,
        NULL::timestamptz AS updated_at, FALSE AS editable
      FROM turnos_consultorios t
      JOIN pacientes p ON p.paciente_id = t.paciente_id
      JOIN profesionales pr ON pr.profesional_id = t.profesional_id`);
  }

  const conditions = [];
  if (filters.search) {
    const search = sqlLiteral(`%${filters.search}%`);
    conditions.push(`(paciente ILIKE ${search} OR tipo_estudio ILIKE ${search} OR turno_origen_id ILIKE ${search})`);
  }
  if (filters.date) conditions.push(`fecha = ${sqlDate(filters.date)}`);
  if (filters.area) conditions.push(`area = ${sqlLiteral(filters.area)}`);
  if (filters.status) conditions.push(`estado = ${sqlLiteral(filters.status)}`);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = sqlInteger(filters.limit || 100, "El límite", 1, 200);

  return `SELECT record_type, local_id, turno_origen_id, nodo_creador, nodo_origen,
      nodo_responsable, area, paciente_id, paciente, fecha, hora, tipo_estudio,
      profesional, estado, updated_at, editable
    FROM (${branches.join(" UNION ALL ")}) AS appointments
    ${where}
    ORDER BY fecha DESC, hora DESC, turno_origen_id
    LIMIT ${limit}`;
}

async function listAppointments(filters) {
  const nodes = filters.node === "all" ? Object.keys(NODES) : [serviceFor(filters.node).id];
  const results = await Promise.all(nodes.map(async (nodeId) => {
    try {
      const items = await psqlRows(nodeId, buildAppointmentsSql(nodeId, filters));
      for (const item of items) item.nodo_almacenamiento = nodeId;
      return { nodeId, items, error: null };
    } catch {
      return { nodeId, items: [], error: "Nodo no disponible o consulta fallida." };
    }
  }));
  return {
    items: results.flatMap((result) => result.items),
    unavailable: results.filter((result) => result.error).map((result) => result.nodeId),
  };
}

function eventsSql(limit) {
  const safeLimit = sqlInteger(limit || 100, "El límite", 1, 200);
  return `SELECT e.evento_id, e.nodo_origen, e.entidad, e.identificador_origen,
      e.operacion, e.fecha_evento, e.sincronizado,
      e.datos->>'area' AS area,
      COALESCE((
        SELECT json_agg(json_build_object(
          'nodo', d.nodo_destino, 'estado', d.estado, 'intentos', d.intentos,
          'ultimo_intento', d.ultimo_intento, 'ultimo_error', d.ultimo_error
        ) ORDER BY d.nodo_destino)
        FROM eventos_destinos d WHERE d.evento_id = e.evento_id
      ), '[]'::json) AS destinos
    FROM eventos_sincronizacion e
    ORDER BY e.fecha_evento DESC, e.evento_id DESC
    LIMIT ${safeLimit}`;
}

async function listEvents(limit = 100) {
  const results = await Promise.all(Object.keys(NODES).map(async (nodeId) => {
    try {
      return (await psqlRows(nodeId, eventsSql(limit))).map((event) => ({ ...event, sourceNode: nodeId }));
    } catch {
      return [];
    }
  }));
  return results.flat().sort((a, b) => String(b.fecha_evento).localeCompare(String(a.fecha_evento)));
}

function validateCreate(body, { demoOnly = false } = {}) {
  const nodeId = body.nodeId;
  serviceFor(nodeId);
  const area = checkedText(body.area, "área", 80);
  if (!AREAS.includes(area)) throw new HttpError(400, "El área no coincide con las permitidas por el sistema.");
  const paciente = checkedText(body.paciente, "paciente", 120, {
    prefix: demoOnly ? DEMO_PREFIX : null,
  });
  const tipoEstudio = checkedText(body.tipoEstudio, "tipo de estudio", 120, {
    prefix: demoOnly ? DEMO_PREFIX : null,
  });
  const profesional = checkedText(body.profesional, "profesional", 120);
  if (demoOnly && !profesional.startsWith(DEMO_PREFIX)) {
    throw new HttpError(400, `El profesional de prueba debe comenzar con ${DEMO_PREFIX}.`);
  }
  const pacienteId = body.pacienteId === "" || body.pacienteId === null || body.pacienteId === undefined
    ? "NULL::integer"
    : `${sqlInteger(body.pacienteId, "El identificador del paciente", 1)}::integer`;
  const estado = body.estado || "Pendiente";
  if (!ESTADOS_TURNO.includes(estado)) throw new HttpError(400, "El estado de turno no es válido.");
  return {
    nodeId,
    area,
    paciente,
    pacienteId,
    fecha: sqlDate(body.fecha),
    hora: sqlTime(body.hora),
    tipoEstudio,
    profesional,
    estado,
  };
}

async function createTurn(body, options = {}) {
  const input = validateCreate(body, options);
  const sql = `SELECT json_build_object('turno_id', crear_turno(
      ${sqlLiteral(input.area)}, ${input.pacienteId}, ${sqlLiteral(input.paciente)},
      ${input.fecha}, ${input.hora}, ${sqlLiteral(input.tipoEstudio)},
      ${sqlLiteral(input.profesional)}, ${sqlLiteral(input.estado)}
    ))::text;`;
  const created = await psqlJson(input.nodeId, sql);
  if (!created || !Number.isSafeInteger(Number(created.turno_id))) {
    throw new HttpError(502, "La base no devolvió el identificador local del turno.");
  }
  const row = await getLocalTurn(input.nodeId, Number(created.turno_id));
  return row;
}

async function getLocalTurn(nodeId, turnoId) {
  serviceFor(nodeId);
  const id = sqlInteger(turnoId, "El identificador del turno", 1);
  return psqlOne(nodeId, `SELECT turno_id, turno_origen_id, nodo_creador,
      nodo_responsable, area, paciente_id, paciente, fecha, hora,
      tipo_estudio, profesional, estado, fecha_registro
    FROM turnos_locales WHERE turno_id = ${id}`);
}

function validateUpdate(body, { demoOnly = false } = {}) {
  const updates = [];
  const values = [];
  const add = (column, expression) => {
    values.push(expression);
    updates.push(`${column} = ${expression}`);
  };
  if (body.paciente !== undefined) {
    const value = checkedText(body.paciente, "paciente", 120, { prefix: demoOnly ? DEMO_PREFIX : null });
    add("paciente", sqlLiteral(value));
  }
  if (body.fecha !== undefined) add("fecha", sqlDate(body.fecha));
  if (body.hora !== undefined) add("hora", sqlTime(body.hora));
  if (body.tipoEstudio !== undefined) {
    const value = checkedText(body.tipoEstudio, "tipo de estudio", 120, { prefix: demoOnly ? DEMO_PREFIX : null });
    add("tipo_estudio", sqlLiteral(value));
  }
  if (body.profesional !== undefined) {
    const value = checkedText(body.profesional, "profesional", 120, { prefix: demoOnly ? DEMO_PREFIX : null });
    add("profesional", sqlLiteral(value));
  }
  if (body.estado !== undefined) {
    if (!ESTADOS_TURNO.includes(body.estado)) throw new HttpError(400, "El estado de turno no es válido.");
    add("estado", sqlLiteral(body.estado));
  }
  if (!updates.length) throw new HttpError(400, "Indicá al menos un campo para modificar.");
  return updates;
}

async function updateTurn(nodeId, turnoId, body, { demoOnly = false } = {}) {
  serviceFor(nodeId);
  const id = sqlInteger(turnoId, "El identificador del turno", 1);
  const updates = validateUpdate(body, { demoOnly });
  const demoGuard = demoOnly ? ` AND paciente LIKE ${sqlLiteral(`${DEMO_PREFIX}%`)}` : "";
  const row = await psqlOne(nodeId, `UPDATE turnos_locales
    SET ${updates.join(", ")}
    WHERE turno_id = ${id}${demoGuard}
    RETURNING turno_id, turno_origen_id, nodo_creador, nodo_responsable,
      area, paciente_id, paciente, fecha, hora, tipo_estudio,
      profesional, estado, fecha_registro`);
  if (!row) throw new HttpError(404, "No existe ese turno local en el nodo propietario.");
  return row;
}

async function cancelTurn(nodeId, turnoId, { demoOnly = false } = {}) {
  serviceFor(nodeId);
  const id = sqlInteger(turnoId, "El identificador del turno", 1);
  const demoGuard = demoOnly ? ` AND paciente LIKE ${sqlLiteral(`${DEMO_PREFIX}%`)}` : "";
  const row = await psqlOne(nodeId, `UPDATE turnos_locales
    SET estado = 'Cancelado'
    WHERE turno_id = ${id}${demoGuard}
    RETURNING turno_id, turno_origen_id, nodo_creador, nodo_responsable,
      area, paciente, fecha, hora, tipo_estudio, profesional, estado`);
  if (!row) throw new HttpError(404, "No existe ese turno local en el nodo propietario.");
  return row;
}

function validateDemoTurnoOrigen(value) {
  if (typeof value !== "string" || !/^[-a-zA-Z0-9_]{8,100}$/.test(value)) {
    throw new HttpError(400, "El identificador de turno no es válido.");
  }
  return value;
}

async function getDemoVerification(nodeId, turnoOrigenId) {
  serviceFor(nodeId);
  const safeId = validateDemoTurnoOrigen(turnoOrigenId);
  const origin = await psqlOne(nodeId, `SELECT turno_id, turno_origen_id,
      nodo_creador, nodo_responsable, area, paciente, fecha, hora,
      tipo_estudio, profesional, estado
    FROM turnos_locales
    WHERE turno_origen_id = ${sqlLiteral(safeId)}
      AND paciente LIKE ${sqlLiteral(`${DEMO_PREFIX}%`)}`);
  if (!origin) throw new HttpError(404, "No se encontró el turno sintético en su nodo propietario.");

  const events = await psqlRows(nodeId, `SELECT e.evento_id, e.operacion,
      e.fecha_evento, e.sincronizado AS sincronizado_global,
      COALESCE((SELECT json_agg(json_build_object(
        'nodo', d.nodo_destino, 'estado', d.estado, 'intentos', d.intentos,
        'ultimo_error', d.ultimo_error
      ) ORDER BY d.nodo_destino) FROM eventos_destinos d WHERE d.evento_id=e.evento_id), '[]'::json) AS destinos
    FROM eventos_sincronizacion e
    WHERE e.nodo_origen = ${sqlLiteral(nodeId)}
      AND e.identificador_origen = ${sqlLiteral(safeId)}
      AND e.datos->>'paciente' = ${sqlLiteral(origin.paciente)}
    ORDER BY e.evento_id`);

  const eventIds = events.map((event) => Number(event.evento_id)).filter(Number.isSafeInteger);
  const eventList = eventIds.length ? eventIds.map(String).join(",") : "NULL";
  const recipients = await Promise.all(DESTINOS.filter((id) => id !== nodeId).map(async (receiverId) => {
    const [copyCount, receiptCount, cycleCount] = await Promise.all([
      psqlJson(receiverId, `SELECT json_build_object('count',count(*))::text
        FROM turnos_compartidos WHERE nodo_origen=${sqlLiteral(nodeId)}
          AND turno_origen_id=${sqlLiteral(safeId)}
          AND paciente=${sqlLiteral(origin.paciente)};`),
      psqlJson(receiverId, `SELECT json_build_object('count',count(*))::text
        FROM eventos_recibidos WHERE nodo_origen=${sqlLiteral(nodeId)}
          AND identificador_evento IN (${eventList});`),
      psqlJson(receiverId, `SELECT json_build_object('count',count(*))::text
        FROM eventos_sincronizacion WHERE nodo_origen=${sqlLiteral(nodeId)}
          AND identificador_origen=${sqlLiteral(safeId)};`),
    ]);
    return {
      nodeId: receiverId,
      copies: Number(copyCount?.count || 0),
      receipts: Number(receiptCount?.count || 0),
      circularEvents: Number(cycleCount?.count || 0),
    };
  }));
  return { origin, events, recipients };
}

async function listDemoTurns(nodeId = "all") {
  const nodes = nodeId === "all" ? Object.keys(NODES) : [serviceFor(nodeId).id];
  const result = await Promise.all(nodes.map(async (id) => {
    try {
      return await psqlRows(id, `SELECT turno_id, turno_origen_id, nodo_creador,
        nodo_responsable, area, paciente, fecha, hora, tipo_estudio,
        profesional, estado FROM turnos_locales
        WHERE paciente LIKE ${sqlLiteral(`${DEMO_PREFIX}%`)}
        ORDER BY fecha_registro DESC LIMIT 100`);
    } catch {
      return [];
    }
  }));
  return result.flat();
}

const PERMISSION_CASES = Object.freeze([
  ["consultorios", "Consultorios", true],
  ["consultorios", "Laboratorio", true],
  ["consultorios", "Diagnóstico por Imágenes", true],
  ["laboratorio", "Consultorios", false],
  ["laboratorio", "Laboratorio", true],
  ["laboratorio", "Diagnóstico por Imágenes", false],
  ["diagnostico_imagenes", "Consultorios", false],
  ["diagnostico_imagenes", "Laboratorio", false],
  ["diagnostico_imagenes", "Diagnóstico por Imágenes", true],
]);

function expectedPermissionError(nodeId) {
  if (nodeId === "laboratorio") return "Laboratorio solo puede crear turnos de Laboratorio";
  if (nodeId === "diagnostico_imagenes") return "Diagnóstico por Imágenes solo puede crear turnos de su área";
  return null;
}

async function verifyNoDemoRow(nodeId, paciente) {
  const row = await psqlJson(nodeId, `SELECT json_build_object('count', count(*))::text
    FROM turnos_locales WHERE paciente=${sqlLiteral(paciente)};`);
  return Number(row?.count || 0) === 0;
}

async function runPermissionMatrix() {
  const timestamp = Date.now().toString(36).toUpperCase();
  const results = [];
  for (let index = 0; index < PERMISSION_CASES.length; index += 1) {
    const [nodeId, area, allowed] = PERMISSION_CASES[index];
    const suffix = `${timestamp}_${index + 1}`;
    const patient = `${DEMO_PREFIX}PERMISOS_${suffix}`;
    const study = `${DEMO_PREFIX}ESTUDIO_${suffix}`;
    const sql = `BEGIN;
      SELECT crear_turno(${sqlLiteral(area)}, NULL::integer, ${sqlLiteral(patient)},
        (CURRENT_DATE + 1)::date, TIME '09:00', ${sqlLiteral(study)},
        ${sqlLiteral(`${DEMO_PREFIX}PROFESIONAL`)}, 'Pendiente');
      ROLLBACK;`;
    let operationSucceeded = true;
    let detail = "";
    try {
      await runPsql(nodeId, sql);
    } catch (error) {
      operationSucceeded = false;
      detail = error instanceof PsqlError ? error.detail : error.message;
    }
    const absent = await verifyNoDemoRow(nodeId, patient);
    const errorExpected = expectedPermissionError(nodeId);
    const rejectedForPermission = Boolean(errorExpected && detail.includes(errorExpected));
    const passed = allowed ? operationSucceeded && absent : !operationSucceeded && rejectedForPermission && absent;
    results.push({ nodeId, area, allowed, passed, detail: passed ? (allowed ? "Permitido y rollback verificado." : "Rechazado por la regla de permisos; sin fila persistida.") : "El resultado no coincide con la matriz." });
  }
  return { passed: results.filter((item) => item.passed).length, total: results.length, cases: results };
}

async function pendingNonDemoDeliveriesTo(nodeId) {
  const counts = await Promise.all(Object.keys(NODES).map(async (originId) => {
    const result = await psqlJson(originId, `SELECT json_build_object('count',count(*))::text
      FROM eventos_sincronizacion e JOIN eventos_destinos d USING(evento_id)
      WHERE d.nodo_destino=${sqlLiteral(nodeId)}
        AND d.estado <> 'entregado'
        AND COALESCE(e.datos->>'paciente','') NOT LIKE ${sqlLiteral(`${DEMO_PREFIX}%`)};`);
    return Number(result?.count || 0);
  }));
  return counts.reduce((sum, count) => sum + count, 0);
}

async function pendingNonDemoDeliveriesFrom(nodeId) {
  const result = await psqlJson(nodeId, `SELECT json_build_object('count',count(*))::text
    FROM eventos_sincronizacion e JOIN eventos_destinos d USING(evento_id)
    WHERE e.nodo_origen=${sqlLiteral(nodeId)}
      AND d.estado <> 'entregado'
      AND COALESCE(e.datos->>'paciente','') NOT LIKE ${sqlLiteral(`${DEMO_PREFIX}%`)};`);
  return Number(result?.count || 0);
}

async function runDockerAction(nodeId, action, confirmation) {
  const node = serviceFor(nodeId);
  const label = node.label.toLocaleUpperCase("es-AR");
  const phrases = { stop: `DETENER ${label}`, start: `INICIAR ${label}` };
  if (!Object.hasOwn(phrases, action)) throw new HttpError(400, "Acción Docker no permitida.");
  if (confirmation !== phrases[action]) throw new HttpError(400, "La confirmación visual no coincide.");
  if (action === "stop") {
    const [inbound, outbound] = await Promise.all([
      pendingNonDemoDeliveriesTo(nodeId),
      pendingNonDemoDeliveriesFrom(nodeId),
    ]);
    if (inbound > 0 || outbound > 0) {
      throw new HttpError(409, `No se detuvo ${node.label}: hay eventos reales pendientes que involucran este nodo.`, { inboundPending: inbound, outboundPending: outbound });
    }
  }
  try {
    const { stdout } = await execFileAsync("docker", ["compose", action, node.service], {
      cwd: ROOT,
      windowsHide: true,
      timeout: 20_000,
      maxBuffer: 128 * 1024,
    });
    return { nodeId, action, service: node.service, result: stdout.trim() || "Acción completada." };
  } catch {
    throw new HttpError(503, "Docker no pudo completar la acción permitida. Revisá el estado del servicio.");
  }
}

async function runSyncOnce(confirmation) {
  if (confirmation !== "EJECUTAR SINCRONIZACIÓN") {
    throw new HttpError(400, "La confirmación visual no coincide.");
  }
  try {
    const { stdout } = await execFileAsync("docker", [
      "compose", "run", "--rm", "--no-deps", "sincronizador",
      "python", "/app/python/sincronizarNodos.py", "--once",
    ], { cwd: ROOT, windowsHide: true, timeout: 60_000, maxBuffer: 256 * 1024 });
    return { result: stdout.trim() || "Ciclo manual terminado." };
  } catch {
    throw new HttpError(503, "El ciclo manual no terminó correctamente. Consultá los estados y errores del outbox.");
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(413, "La solicitud es demasiado grande."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new HttpError(400, "El cuerpo de la solicitud no es JSON válido."));
      }
    });
    request.on("error", () => reject(new HttpError(400, "No se pudo leer la solicitud.")));
  });
}

function sendJson(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
}

async function handleApi(request, response, url) {
  const method = request.method || "GET";
  const route = url.pathname;

  if (method === "GET" && route === "/api/overview") return sendJson(response, 200, await getOverview());
  if (method === "GET" && route === "/api/turns") {
    const node = url.searchParams.get("node") || "all";
    const area = url.searchParams.get("area") || "";
    const status = url.searchParams.get("status") || "";
    if (area && !AREAS.includes(area)) throw new HttpError(400, "Filtro de área no permitido.");
    if (status && !ESTADOS_TURNO.includes(status)) throw new HttpError(400, "Filtro de estado no permitido.");
    const result = await listAppointments({
      node,
      search: (url.searchParams.get("search") || "").slice(0, 100),
      date: url.searchParams.get("date") || "",
      area,
      status,
      limit: url.searchParams.get("limit") || 100,
    });
    return sendJson(response, 200, result);
  }
  if (method === "GET" && route === "/api/events") {
    return sendJson(response, 200, { events: await listEvents(url.searchParams.get("limit") || 100) });
  }
  if (method === "GET" && route === "/api/demo-turns") {
    return sendJson(response, 200, { turns: await listDemoTurns(url.searchParams.get("node") || "all") });
  }

  const verifyMatch = route.match(/^\/api\/verification\/([a-z_]+)\/([^/]+)$/);
  if (method === "GET" && verifyMatch) {
    return sendJson(response, 200, await getDemoVerification(verifyMatch[1], decodeURIComponent(verifyMatch[2])));
  }

  if (method !== "GET") {
    if (!isLoopback(request.socket.remoteAddress)) throw new HttpError(403, "El backend solo acepta conexiones locales.");
    if (!isLocalOrigin(request.headers.origin)) throw new HttpError(403, "Origen del navegador no permitido.");
  }

  if (method === "POST" && route === "/api/turns") {
    const body = await readBody(request);
    return sendJson(response, 201, { turn: await createTurn(body) });
  }
  const updateMatch = route.match(/^\/api\/turns\/([a-z_]+)\/(\d+)$/);
  if (method === "PATCH" && updateMatch) {
    const body = await readBody(request);
    return sendJson(response, 200, { turn: await updateTurn(updateMatch[1], updateMatch[2], body) });
  }
  const cancelMatch = route.match(/^\/api\/turns\/([a-z_]+)\/(\d+)\/cancel$/);
  if (method === "POST" && cancelMatch) {
    const body = await readBody(request);
    if (body.confirmation !== "CANCELAR TURNO") throw new HttpError(400, "La confirmación para cancelar no coincide.");
    return sendJson(response, 200, { turn: await cancelTurn(cancelMatch[1], cancelMatch[2]) });
  }

  if (method === "POST" && route === "/api/tests/create") {
    const body = await readBody(request);
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const random = require("node:crypto").randomBytes(3).toString("hex").toUpperCase();
    const marker = `${DEMO_PREFIX}${stamp}_${random}`;
    const turn = await createTurn({
      nodeId: "consultorios",
      area: body.area || "Laboratorio",
      paciente: marker,
      pacienteId: null,
      fecha: body.fecha,
      hora: body.hora,
      tipoEstudio: `${DEMO_PREFIX}ESTUDIO`,
      profesional: `${DEMO_PREFIX}PROFESIONAL`,
      estado: "Pendiente",
    }, { demoOnly: true });
    return sendJson(response, 201, { turn });
  }
  if (method === "POST" && route === "/api/tests/permissions") {
    return sendJson(response, 200, await runPermissionMatrix());
  }
  const testTurnMatch = route.match(/^\/api\/tests\/turns\/([a-z_]+)\/(\d+)\/(modify|cancel)$/);
  if (method === "POST" && testTurnMatch) {
    const [, nodeId, turnoId, operation] = testTurnMatch;
    const body = await readBody(request);
    if (operation === "cancel") {
      if (body.confirmation !== "CANCELAR TURNO DE DEMOSTRACIÓN") {
        throw new HttpError(400, "La confirmación para cancelar no coincide.");
      }
      return sendJson(response, 200, { turn: await cancelTurn(nodeId, turnoId, { demoOnly: true }) });
    }
    return sendJson(response, 200, { turn: await updateTurn(nodeId, turnoId, body, { demoOnly: true }) });
  }
  const nodeAction = route.match(/^\/api\/nodes\/([a-z_]+)\/(stop|start)$/);
  if (method === "POST" && nodeAction) {
    const body = await readBody(request);
    return sendJson(response, 200, await runDockerAction(nodeAction[1], nodeAction[2], body.confirmation));
  }
  if (method === "POST" && route === "/api/sync/run-once") {
    const body = await readBody(request);
    return sendJson(response, 200, await runSyncOnce(body.confirmation));
  }
  const replayMatch = route.match(/^\/api\/tests\/replay\/([a-z_]+)\/(\d+)$/);
  if (method === "POST" && replayMatch) {
    const [, originId, eventIdText] = replayMatch;
    const body = await readBody(request);
    if (body.confirmation !== "REPROCESAR EVENTO SINTÉTICO") throw new HttpError(400, "La confirmación para reprocesar no coincide.");
    serviceFor(originId);
    const eventId = sqlInteger(eventIdText, "El identificador del evento", 1);
    const guard = `EXISTS (
      SELECT 1 FROM eventos_sincronizacion e
      WHERE e.evento_id=${eventId}
        AND e.datos->>'paciente' LIKE ${sqlLiteral(`${DEMO_PREFIX}%`)}
        AND e.datos->>'tipo_estudio' LIKE ${sqlLiteral(`${DEMO_PREFIX}%`)}
        AND e.nodo_origen=${sqlLiteral(originId)}
    )`;
    const sql = `BEGIN;
      UPDATE eventos_destinos SET estado='error', ultimo_error='Reentrega controlada desde el laboratorio de pruebas'
      WHERE evento_id=${eventId} AND nodo_destino='laboratorio'
        AND estado='entregado' AND ${guard};
      UPDATE eventos_sincronizacion SET sincronizado=FALSE
      WHERE evento_id=${eventId} AND ${guard};
      COMMIT;
      SELECT json_build_object('evento_id',${eventId})::text;`;
    await runPsql(originId, sql);
    const event = await psqlOne(originId, `SELECT e.evento_id, d.estado, d.intentos, d.ultimo_intento
      FROM eventos_sincronizacion e JOIN eventos_destinos d USING(evento_id)
      WHERE e.evento_id=${eventId} AND d.nodo_destino='laboratorio'
        AND e.datos->>'paciente' LIKE ${sqlLiteral(`${DEMO_PREFIX}%`)}
        AND e.datos->>'tipo_estudio' LIKE ${sqlLiteral(`${DEMO_PREFIX}%`)}`);
    if (!event || event.estado !== "error") throw new HttpError(404, "No se encontró un evento de demostración entregado a Laboratorio.");
    return sendJson(response, 200, { event });
  }

  throw new HttpError(404, "Ruta no encontrada.");
}

function serveStatic(request, response, url) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    throw new HttpError(405, "Método no permitido.");
  }
  const entry = ALLOWED_STATIC[url.pathname];
  if (!entry) throw new HttpError(404, "Recurso no encontrado.");
  const file = path.join(STATIC, entry[0]);
  const data = fs.readFileSync(file);
  response.writeHead(200, {
    "Content-Type": entry[1],
    "Content-Length": data.length,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(request.method === "HEAD" ? undefined : data);
}

function createServer() {
  return http.createServer(async (request, response) => {
    setSecurityHeaders(response);
    if (!isLoopback(request.socket.remoteAddress)) {
      return sendJson(response, 403, { error: "El panel solo está disponible en este equipo." });
    }
    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url);
      } else {
        serveStatic(request, response, url);
      }
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const message = error instanceof HttpError ? error.message : "Ocurrió un error interno al procesar la solicitud.";
      if (error instanceof PsqlError && error.detail) {
        const knownPermission = error.detail.match(/(Laboratorio solo puede crear turnos de Laboratorio|Diagnóstico por Imágenes solo puede crear turnos de su área|Este nodo no es propietario del turno|El turno debe ser creado por el nodo local \([^)]+\))/);
        if (knownPermission) {
          return sendJson(response, 422, { error: knownPermission[1] });
        }
      }
      if (!(error instanceof HttpError)) {
        console.error(`Error HTTP ${request.method} ${url?.pathname || "?"}: ${error?.constructor?.name || "Error"}`);
      }
      sendJson(response, status, { error: message, ...(error.extra || {}) });
    }
  });
}

if (require.main === module) {
  if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) {
    throw new Error("UI_PORT debe estar entre 1024 y 65535.");
  }
  const server = createServer();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`CentroSaludDistribuido disponible en http://127.0.0.1:${PORT}`);
  });
}

module.exports = {
  AREAS,
  DEMO_PREFIX,
  NODES,
  PERMISSION_CASES,
  buildAppointmentsSql,
  createServer,
  isLocalOrigin,
  isLoopback,
  runPermissionMatrix,
  sqlDate,
  sqlInteger,
  sqlLiteral,
  sqlTime,
  serviceFor,
  validateCreate,
  validateUpdate,
};
