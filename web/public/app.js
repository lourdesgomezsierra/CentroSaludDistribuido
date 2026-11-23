"use strict";

const $ = (selector, root = document) => root.querySelector(selector);
const state = { page: "inicio", overview: null, turns: [], events: [], demoTurns: [], test: "A", turnNode: "all", busy: false };
const nodeNames = { consultorios: "Consultorios", laboratorio: "Laboratorio", diagnostico_imagenes: "Diagnóstico por Imágenes" };
const areas = ["Consultorios", "Laboratorio", "Diagnóstico por Imágenes"];
const pageNames = { inicio: "Resumen", turnos: "Turnos", sincronizacion: "Sincronización", pruebas: "Laboratorio de pruebas", historial: "Historial" };

function esc(value) { return String(value ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]); }
function time(value) { if (!value) return "—"; const date = new Date(value); return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }); }
function day(value) { if (!value) return "—"; const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? esc(value) : date.toLocaleDateString("es-AR"); }
function badge(text, kind = "") { return `<span class="badge ${kind}">${esc(text)}</span>`; }
function toast(message, error = false) { const item = document.createElement("div"); item.className = `toast${error ? " error" : ""}`; item.textContent = message; $("#toast-region").append(item); setTimeout(() => item.remove(), 4500); }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  let data = {}; try { data = await response.json(); } catch { /* empty response */ }
  if (!response.ok) throw new Error(data.error || `Error HTTP ${response.status}`);
  return data;
}
function saveHistory(action, detail, result = "Completado") {
  const list = JSON.parse(localStorage.getItem("centrosalud-ui-history") || "[]");
  list.unshift({ at: new Date().toISOString(), action, detail, result });
  localStorage.setItem("centrosalud-ui-history", JSON.stringify(list.slice(0, 100)));
}
function header(eyebrow, title, description, action = "") { return `<div class="page-heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div>${action}</div>`; }
function nodeStatus(node) {
  if (!node) return badge("Sin datos");
  if (node.containerState !== "running") return badge(node.containerState === "unknown" ? "No disponible" : node.containerState, "error");
  return node.connected ? badge("Operativo", "ok") : badge("PostgreSQL sin conexión", "error");
}
function nodeRows() {
  const nodes = state.overview?.nodes || [];
  return `<div class="node-list">${nodes.map(node => `<div class="node-row"><div class="node-icon">${node.id === "consultorios" ? "⌂" : node.id === "laboratorio" ? "⌬" : "▧"}</div><div><div class="node-name">${esc(node.label)}</div><div class="node-sub">${esc(node.service)} · puerto ${esc(node.port)}</div></div>${nodeStatus(node)}</div>`).join("") || `<div class="empty">Cargando estado de nodos…</div>`}</div>`;
}
function metric(label, value, foot, icon) { return `<article class="card metric"><div class="metric-top">${esc(label)}<span class="metric-icon">${icon}</span></div><div class="metric-value">${esc(value)}</div><div class="metric-foot">${esc(foot)}</div></article>`; }
function renderOverview() {
  const m = state.overview?.metrics || {};
  const nodes = state.overview?.nodes || [];
  const active = nodes.filter(n => n.connected && n.containerState === "running").length;
  return `${header("Vista general", "Estado de la red", "Operación y distribución en tiempo real de los tres nodos.", `<button class="button secondary" data-action="refresh">↻ Actualizar</button>`)}
    <section class="grid metrics">${metric("Nodos disponibles", `${active} / 3`, "PostgreSQL y contenedores", "◉")}${metric("Eventos registrados", m.events ?? "—", "Outbox de la red", "⇄")}${metric("Entregas pendientes", m.pending ?? "—", "En espera o con reintento", "◷")}${metric("Entregas con error", m.failed ?? "—", "Se reintentan automáticamente", "!")}</section>
    <section class="grid dashboard-grid"><article class="card section-card"><div class="section-head"><div><h2>Nodos de la red</h2><p>Estado de contenedores y conexión a base</p></div><a href="#sincronizacion" class="text-link">Ver sincronización →</a></div>${nodeRows()}<div class="callout"><span class="callout-icon">ⓘ</span><span>La interfaz consulta las bases reales de cada nodo. Las filas compartidas se muestran como copias de solo lectura; la autoridad de edición pertenece al nodo responsable.</span></div></article>
    <article class="card section-card"><div class="section-head"><div><h2>Actividad de sincronización</h2><p>Estado agregado del outbox por destino</p></div></div><div class="sync-summary">${["delivered", "pending", "failed"].map((key, i) => `<div class="sync-cell"><b>${Number(m[key] || 0)}</b><span>${["Entregados", "Pendientes", "Con error"][i]}</span></div>`).join("")}</div><div class="section-head" style="margin-top:22px"><div><h2>Topología</h2><p>Los originales se propagan a los otros nodos</p></div></div><div class="node-map">${nodes.map(n => `<div class="card map-node"><h3>${esc(n.label)}</h3><p>Servicio <span class="code">${esc(n.service)}</span><br>PostgreSQL · ${esc(n.port)}</p>${nodeStatus(n)}</div>`).join("")}</div></article></section>`;
}
function turnTable(rows) {
  if (!rows.length) return `<div class="empty"><b>No hay turnos para mostrar</b>Ajustá los filtros o verificá la conexión del nodo.</div>`;
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Paciente / turno</th><th>Área y estudio</th><th>Fecha</th><th>Responsable</th><th>Estado</th><th>Origen</th><th></th></tr></thead><tbody>${rows.map(t => `<tr><td><strong>${esc(t.paciente)}</strong><span class="subline">${esc(t.turno_origen_id)} · ${esc(t.record_type)}</span></td><td>${esc(t.area)}<span class="subline">${esc(t.tipo_estudio)}</span></td><td>${day(t.fecha)}<span class="subline">${esc(String(t.hora || "").slice(0, 5))}</span></td><td>${esc(nodeNames[t.nodo_responsable] || t.nodo_responsable)}</td><td>${badge(t.estado, t.estado === "Cancelado" ? "error" : t.estado === "Pendiente" ? "warn" : "ok")}</td><td>${esc(nodeNames[t.nodo_origen] || t.nodo_origen)}</td><td>${t.editable ? `<div class="test-actions"><button class="button secondary small" data-edit="${esc(t.local_id)}" data-node="${esc(t.nodo_creador)}">Editar</button>${t.estado !== "Cancelado" ? `<button class="button danger small" data-cancel="${esc(t.local_id)}" data-node="${esc(t.nodo_creador)}">Cancelar</button>` : ""}</div>` : `<span class="muted">Solo lectura</span>`}</td></tr>`).join("")}</tbody></table></div>`;
}
function renderTurns() {
  return `${header("Gestión", "Turnos", "Consulta turnos originales y compartidos. Las modificaciones se guardan en el nodo propietario.", `<button class="button primary" data-action="new-turn">＋ Crear turno</button>`)}
    <article class="card section-card"><div class="filters"><input id="turn-search" class="field search" placeholder="Buscar paciente, estudio o identificador"><select id="turn-node" class="select"><option value="all">Todos los nodos</option>${Object.entries(nodeNames).map(([id, label]) => `<option value="${id}" ${state.turnNode === id ? "selected" : ""}>${esc(label)}</option>`).join("")}</select><select id="turn-area" class="select"><option value="">Todas las áreas</option>${areas.map(a => `<option>${esc(a)}</option>`).join("")}</select><select id="turn-status" class="select"><option value="">Todos los estados</option><option>Pendiente</option><option>Confirmado</option><option>Cancelado</option></select><button class="button secondary" data-action="filter-turns">Filtrar</button></div>${turnTable(state.turns)}</article>`;
}
function eventTable(events) {
  if (!events.length) return `<div class="empty"><b>No se encontraron eventos</b>El outbox está vacío o los nodos no están disponibles.</div>`;
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Evento</th><th>Nodo origen</th><th>Turno</th><th>Operación</th><th>Fecha</th><th>Destinos</th></tr></thead><tbody>${events.map(e => `<tr><td><strong>#${esc(e.evento_id)}</strong><span class="subline">${e.sincronizado ? "Sincronizado" : "Pendiente global"}</span></td><td>${esc(nodeNames[e.nodo_origen] || e.nodo_origen)}</td><td>${esc(e.identificador_origen)}<span class="subline">${esc(e.area || "")}</span></td><td>${esc(e.operacion)}</td><td>${time(e.fecha_evento)}</td><td><div class="event-destinations">${(e.destinos || []).map(d => `<span class="dest ${esc(d.estado)}" title="Intentos: ${esc(d.intentos)}">${esc(nodeNames[d.nodo] || d.nodo)}: ${esc(d.estado)}${d.intentos ? ` · ${esc(d.intentos)}` : ""}</span>`).join("")}</div></td></tr>`).join("")}</tbody></table></div>`;
}
function renderSync() {
  return `${header("Distribución", "Sincronización", "Outbox transaccional, estado por destino y recibos idempotentes.", `<button class="button secondary" data-action="refresh-events">↻ Actualizar eventos</button>`)}
    <section class="grid metrics">${metric("Eventos consultados", state.events.length, "Hasta 100 por nodo", "⇄")}${metric("Pendientes", state.overview?.metrics?.pending ?? "—", "Incluye reintentos activos", "◷")}${metric("Entregados", state.overview?.metrics?.delivered ?? "—", "Confirmación por destino", "✓")}${metric("Errores", state.overview?.metrics?.failed ?? "—", "El sincronizador conserva y reintenta", "!")}</section>
    <article class="card section-card"><div class="section-head"><div><h2>Eventos recientes</h2><p>Los contadores de intentos pertenecen a cada destino</p></div><button class="button warning small" data-action="sync-once">Ejecutar ciclo manual</button></div>${eventTable(state.events)}</article>
    <div class="callout"><span class="callout-icon">ⓘ</span><span>La entrega se considera completa cuando todos los destinos previstos figuran como <b>entregado</b>. El receptor registra el identificador del evento y actualiza la copia compartida dentro de la misma transacción.</span></div>`;
}

const tests = {
  A: { title: "Alta y entrega normal", intro: "Crea un turno sintético en Consultorios y verifica original, outbox, copias y recibos en los otros nodos.", steps: ["Generar una fecha futura y crear un turno DEMO_DISTRIBUIDA_ en Consultorios.", "Consultar el ID original y su identificador global.", "Verificar que ambos destinos confirmen la recepción y que exista una copia por nodo."] },
  B: { title: "Modificar en nodo propietario", intro: "Actualiza campos de un turno sintético desde su propietario y comprueba la propagación.", steps: ["Seleccionar un original sintético del nodo propietario.", "Modificar fecha, hora o profesional conservando el prefijo de demostración.", "Verificar nuevo estado en originales y copias; no se edita una copia receptora."] },
  C: { title: "Cancelar con propiedad", intro: "Propaga la cancelación como actualización de estado. No borra el turno.", steps: ["Elegir un turno sintético local.", "Confirmar la operación de cancelación.", "Verificar estado Cancelado y su evento en los receptores."] },
  D: { title: "Caída de Laboratorio", intro: "Detiene únicamente el servicio Laboratorio, crea un turno sintético con receptor caído y comprueba que el outbox lo conserva.", steps: ["El panel bloquea la parada si existen entregas no sintéticas pendientes a Laboratorio.", "La operación local en Consultorios completa aunque el receptor esté apagado.", "El destino Laboratorio queda pendiente o con error/reintento; Imágenes sigue recibiendo."] },
  E: { title: "Recuperación automática", intro: "Reinicia Laboratorio y espera al ciclo automático del sincronizador. El backoff puede retrasar el siguiente intento.", steps: ["Iniciar solo el servicio Laboratorio.", "Esperar el siguiente ciclo periódico y el backoff configurado.", "Comprobar entrega, recibo único y una sola copia compartida."] },
  F: { title: "Reentrega e idempotencia", intro: "Marca para reintento un evento sintético ya entregado a Laboratorio; el receptor debe deduplicarlo.", steps: ["Seleccionar un evento sintético con destino Laboratorio entregado.", "Solicitar reentrega controlada con confirmación explícita.", "Verificar una copia, un recibo y ningún evento circular nuevo."] },
  G: { title: "Matriz de permisos", intro: "Ejecuta nueve intentos dentro de transacciones que siempre se revierten; los rechazos validan las reglas SQL.", steps: ["Probar cada combinación nodo/área de la matriz.", "Las combinaciones permitidas insertan transitoriamente y hacen ROLLBACK.", "Las prohibidas deben rechazarse por trigger, sin dejar filas persistidas."] },
};
function renderTestContent() {
  const t = tests[state.test];
  let extra = "";
  if (["A", "D"].includes(state.test)) extra = `<div class="form-grid"><div class="form-field"><label for="demo-date">Fecha futura</label><input id="demo-date" type="date"></div><div class="form-field"><label for="demo-time">Hora</label><input id="demo-time" type="time" value="10:30"></div>${state.test === "A" ? `<div class="form-field full"><label for="demo-area">Área responsable</label><select id="demo-area">${areas.map(a => `<option ${a === "Laboratorio" ? "selected" : ""}>${esc(a)}</option>`).join("")}</select></div>` : ""}</div>`;
  if (["B", "C", "E", "F"].includes(state.test)) extra = `<div class="form-field"><label for="demo-turn-select">Turno sintético existente</label><select id="demo-turn-select"><option value="">Cargando turnos sintéticos…</option></select></div><div id="demo-verification" class="callout" style="display:none"></div>`;
  if (state.test === "G") extra = `<div class="permission-grid">${[["Consultorios", "Permitido · las tres áreas"], ["Laboratorio", "Solo Laboratorio"], ["Imágenes", "Solo Diagnóstico por Imágenes"]].map(([a,b]) => `<div class="permission-card"><b>${a}</b><span>${b}</span></div>`).join("")}</div><div id="permission-results"></div>`;
  if (state.test === "D") extra += `<div class="test-actions"><button class="button danger" data-action="stop-lab">Detener Laboratorio…</button></div>`;
  if (state.test === "E") extra += `<div class="test-actions"><button class="button primary" data-action="start-lab">Iniciar Laboratorio…</button><button class="button secondary" data-action="wait-recovery">Esperar y verificar recuperación</button></div>`;
  if (state.test === "A" || state.test === "D") extra += `<div class="test-actions"><button class="button primary" data-action="create-demo">${state.test === "A" ? "Crear turno sintético" : "Crear con Laboratorio detenido"}</button></div>`;
  if (state.test === "B") extra += `<div class="test-actions"><button class="button primary" data-action="modify-demo">Modificar turno seleccionado</button></div>`;
  if (state.test === "C") extra += `<div class="test-actions"><button class="button danger" data-action="cancel-demo">Cancelar turno seleccionado…</button></div>`;
  if (state.test === "E") extra += `<div class="test-actions"><button class="button secondary" data-action="verify-demo">Consultar estado actual</button></div>`;
  if (state.test === "F") extra += `<div class="test-actions"><button class="button warning" data-action="replay-demo">Reintentar evento sintético…</button><button class="button secondary" data-action="verify-demo">Verificar idempotencia</button></div>`;
  if (state.test === "G") extra += `<div class="test-actions"><button class="button primary" data-action="run-permissions">Ejecutar matriz (ROLLBACK)</button></div>`;
  return `<div class="scenario-bar"><div><div class="eyebrow">Escenario ${state.test} de 7</div><b>${esc(t.title)}</b></div>${badge("Acciones controladas", "warn")}</div><h2>${esc(t.title)}</h2><p>${esc(t.intro)}</p><div class="step-list">${t.steps.map((s,i) => `<div class="step"><span class="step-num">${i+1}</span><div><b>Paso ${i+1}</b><small>${esc(s)}</small></div></div>`).join("")}</div>${extra}<div id="test-result"></div>`;
}
function renderTests() {
  return `${header("Validación segura", "Laboratorio de pruebas", "Escenarios A–G con datos sintéticos y límites de seguridad para acciones operativas.")}
    <section class="grid test-layout"><nav class="card test-nav" aria-label="Escenarios">${Object.entries(tests).map(([id,t]) => `<button class="test-tab ${state.test === id ? "selected" : ""}" data-test="${id}"><span>${id}</span>${esc(t.title)}</button>`).join("")}</nav><article class="card test-content">${renderTestContent()}</article></section>`;
}
function renderHistory() {
  const history = JSON.parse(localStorage.getItem("centrosalud-ui-history") || "[]");
  return `${header("Auditoría local", "Historial de acciones", "Registro del navegador para esta sesión de interfaz; no se guarda en las bases clínicas.", `<button class="button secondary" data-action="clear-history">Limpiar historial local</button>`)}<article class="card section-card">${history.length ? history.map(h => `<div class="history-item"><span class="history-time">${time(h.at)}</span><span class="history-desc"><b>${esc(h.action)}</b> · ${esc(h.detail)}</span>${badge(h.result, h.result === "Completado" ? "ok" : "warn")}</div>`).join("") : `<div class="empty"><b>Sin acciones registradas</b>Las acciones realizadas desde esta interfaz aparecerán aquí.</div>`}</article>`;
}
function updateCrumb() { $("#crumb").textContent = pageNames[state.page] || "Resumen"; document.title = `CentroSalud | ${pageNames[state.page] || "Resumen"}`; }
function render() {
  updateCrumb();
  document.querySelectorAll(".nav-link").forEach(link => link.classList.toggle("active", link.dataset.page === state.page));
  const views = { inicio: renderOverview, turnos: renderTurns, sincronizacion: renderSync, pruebas: renderTests, historial: renderHistory };
  $("#view").innerHTML = (views[state.page] || renderOverview)();
  if (state.page === "pruebas" && ["B", "C", "E", "F"].includes(state.test)) fillDemoSelect();
}
async function refreshOverview() {
  try { state.overview = await api("/api/overview"); $("#last-updated").textContent = `Actualizado ${time(state.overview.checkedAt)}`; if (state.page === "inicio") render(); }
  catch (error) { $("#last-updated").textContent = "No se pudo consultar la red"; toast(error.message, true); }
}
async function loadTurns() {
  const search = $("#turn-search")?.value || ""; const area = $("#turn-area")?.value || ""; const status = $("#turn-status")?.value || "";
  state.turnNode = $("#turn-node")?.value || state.turnNode;
  const q = new URLSearchParams({ node: state.turnNode, search, area, status, limit: "100" });
  try { const data = await api(`/api/turns?${q}`); state.turns = data.items || []; if (state.page === "turnos") render(); }
  catch (error) { toast(error.message, true); }
}
async function loadEvents() { try { const data = await api("/api/events?limit=100"); state.events = data.events || []; if (state.page === "sincronizacion") render(); } catch (error) { toast(error.message, true); } }
async function refreshAll() { await Promise.all([refreshOverview(), ...(state.page === "turnos" ? [loadTurns()] : []), ...(state.page === "sincronizacion" ? [loadEvents()] : [])]); }
async function loadDemoTurns() { try { const data = await api("/api/demo-turns?node=all"); state.demoTurns = data.turns || []; } catch { state.demoTurns = []; } }
function fillDemoSelect() {
  const select = $("#demo-turn-select"); if (!select) return;
  const previous = select.value; select.innerHTML = `<option value="">Seleccioná un turno sintético</option>${state.demoTurns.map(t => `<option value="${esc(t.nodo_creador)}|${esc(t.turno_id)}">${esc(t.paciente)} · ${esc(nodeNames[t.nodo_creador] || t.nodo_creador)} · ${esc(t.estado)}</option>`).join("")}`;
  if (previous) select.value = previous;
}
function selectedDemo() {
  const value = $("#demo-turn-select")?.value || ""; const [nodeId, id] = value.split("|");
  return state.demoTurns.find(t => t.nodo_creador === nodeId && String(t.turno_id) === id) || null;
}
function futureDate() { const date = new Date(); date.setDate(date.getDate() + 7); return date.toISOString().slice(0, 10); }
function showResult(message, ok = true) { const target = $("#test-result"); if (target) target.innerHTML = `<div class="callout ${ok ? "" : ""}" style="margin-top:14px"><span class="callout-icon">${ok ? "✓" : "!"}</span><span>${esc(message)}</span></div>`; }
function askConfirm({ title, copy, phrase, label = "Escribí la frase para continuar", danger = true }) {
  const dialog = $("#confirm-dialog"); $("#confirm-title").textContent = title; $("#confirm-copy").textContent = copy; $("#confirm-label").textContent = label; $("#confirm-input").value = ""; $("#confirm-accept").className = `button ${danger ? "danger" : "primary"}`;
  dialog.showModal();
  return new Promise(resolve => {
    const form = $("#confirm-form"); const close = () => { dialog.removeEventListener("close", finish); resolve(null); };
    const finish = () => { const confirmed = dialog.returnValue === "ok" && $("#confirm-input").value === phrase; const input = $("#confirm-input").value; dialog.removeEventListener("close", finish); resolve(confirmed ? input : null); };
    dialog.addEventListener("close", finish, { once: true });
    form.onsubmit = event => { if (event.submitter?.id === "confirm-accept" && $("#confirm-input").value !== phrase) { event.preventDefault(); toast("La frase no coincide.", true); } };
    dialog.addEventListener("cancel", close, { once: true });
  });
}
async function withBusy(callback) { if (state.busy) return; state.busy = true; try { await callback(); } catch (error) { showResult(error.message, false); toast(error.message, true); } finally { state.busy = false; } }
async function runDemoCreate() {
  const date = $("#demo-date")?.value; if (!date || date <= new Date().toISOString().slice(0,10)) return showResult("Elegí una fecha futura.", false);
  const area = $("#demo-area")?.value || "Laboratorio";
  const result = await api("/api/tests/create", { method: "POST", body: JSON.stringify({ date, fecha: date, hora: $("#demo-time")?.value || "10:30", area }) });
  saveHistory("Turno sintético creado", `${result.turn.paciente} · ${result.turn.turno_origen_id}`); await loadDemoTurns(); showResult(`Creado el turno ${result.turn.turno_origen_id} en ${nodeNames[result.turn.nodo_creador] || result.turn.nodo_creador}. Consultá su estado en Sincronización.`);
}
async function verifySelected() {
  const turn = selectedDemo(); if (!turn) return showResult("Seleccioná primero un turno sintético.", false);
  const data = await api(`/api/verification/${encodeURIComponent(turn.nodo_creador)}/${encodeURIComponent(turn.turno_origen_id)}`);
  const summary = data.recipients.map(r => `${nodeNames[r.nodeId]}: ${r.copies} copia(s), ${r.receipts} recibo(s), ${r.circularEvents} eventos de retorno`).join(" · ");
  showResult(`${turn.turno_origen_id}: ${summary}`); saveHistory("Verificación de entrega", turn.turno_origen_id); await loadEvents();
}
async function stopLab() {
  const confirmation = await askConfirm({ title: "Detener Laboratorio", copy: "Solo se detendrá el servicio laboratorio. El panel verifica que no haya entregas no sintéticas pendientes a este nodo.", phrase: "DETENER LABORATORIO" });
  if (!confirmation) return;
  await api("/api/nodes/laboratorio/stop", { method: "POST", body: JSON.stringify({ confirmation }) }); saveHistory("Laboratorio detenido", "docker compose stop laboratorio"); await refreshOverview(); showResult("Laboratorio detenido. Consultorios e Imágenes permanecen en ejecución.");
}
async function startLab() {
  const confirmation = await askConfirm({ title: "Iniciar Laboratorio", copy: "Se iniciará únicamente el servicio laboratorio mediante Docker Compose.", phrase: "INICIAR LABORATORIO", danger: false });
  if (!confirmation) return;
  await api("/api/nodes/laboratorio/start", { method: "POST", body: JSON.stringify({ confirmation }) }); saveHistory("Laboratorio iniciado", "docker compose start laboratorio"); await refreshOverview(); showResult("Laboratorio iniciado. El sincronizador volverá a intentar la entrega pendiente.");
}
async function verifyWithPolling(turn, attempts = 75) {
  for (let i = 0; i < attempts; i++) { const data = await api(`/api/verification/${turn.nodo_creador}/${encodeURIComponent(turn.turno_origen_id)}`); const lab = data.recipients.find(r => r.nodeId === "laboratorio"); if (lab?.copies === 1 && lab?.receipts >= 1) return { data, lab }; await new Promise(resolve => setTimeout(resolve, 5000)); }
  throw new Error("Aún no se confirmó la copia en Laboratorio. Revisá el outbox, los logs y el siguiente intervalo de reintento.");
}
async function replayDemo() {
  const turn = selectedDemo(); if (!turn) return showResult("Seleccioná un turno sintético.", false);
  const verification = await api(`/api/verification/${turn.nodo_creador}/${encodeURIComponent(turn.turno_origen_id)}`);
  const event = verification.events.find(e => e.destinos.some(d => d.nodo === "laboratorio" && d.estado === "entregado"));
  if (!event) return showResult("No hay evento sintético ya entregado a Laboratorio para reintentar.", false);
  const confirmation = await askConfirm({ title: "Reentregar evento de demostración", copy: `Solo se marcará para reintento el evento sintético #${event.evento_id}. El receptor debe deduplicarlo.`, phrase: "REPROCESAR EVENTO SINTÉTICO" });
  if (!confirmation) return;
  await api(`/api/tests/replay/${turn.nodo_creador}/${event.evento_id}`, { method: "POST", body: JSON.stringify({ confirmation }) }); saveHistory("Reintento sintético solicitado", `Evento #${event.evento_id}`); showResult("Evento marcado para reintento. Consultando la entrega…");
  const { lab } = await verifyWithPolling(turn); showResult(`Reintento completo: ${lab.copies} copia, ${lab.receipts} recibo(s), ${lab.circularEvents} evento(s) de retorno.`); await loadEvents();
}
async function permissionMatrix() {
  const data = await api("/api/tests/permissions", { method: "POST", body: "{}" });
  const target = $("#permission-results"); if (!target) return;
  target.innerHTML = `<div class="callout" style="margin-top:12px"><span class="callout-icon">${data.passed === data.total ? "✓" : "!"}</span><span>Resultado: ${data.passed}/${data.total} casos correctos. Cada inserción permitida se revirtió con ROLLBACK.</span></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Nodo</th><th>Área</th><th>Esperado</th><th>Resultado</th><th>Detalle</th></tr></thead><tbody>${data.cases.map(c => `<tr><td>${esc(nodeNames[c.nodeId])}</td><td>${esc(c.area)}</td><td>${c.allowed ? "Permitido" : "Denegado"}</td><td>${c.passed ? badge("Correcto", "ok") : badge("Revisar", "error")}</td><td>${esc(c.detail)}</td></tr>`).join("")}</tbody></table></div>`;
  saveHistory("Matriz de permisos", `${data.passed}/${data.total} casos`); if (data.passed !== data.total) toast("La matriz presentó resultados inesperados.", true);
}
async function doAction(action) {
  if (action === "refresh") return refreshAll();
  if (action === "refresh-events") { await loadEvents(); await refreshOverview(); return; }
  if (action === "filter-turns") return loadTurns();
  if (action === "clear-history") { localStorage.removeItem("centrosalud-ui-history"); render(); return; }
  if (action === "create-demo") return withBusy(runDemoCreate);
  if (action === "stop-lab") return withBusy(stopLab);
  if (action === "start-lab") return withBusy(startLab);
  if (action === "verify-demo") return withBusy(verifySelected);
  if (action === "wait-recovery") return withBusy(async () => { const turn = selectedDemo(); if (!turn) return showResult("Seleccioná el turno sintético que quedó pendiente.", false); showResult("Sondeando el estado cada 5 segundos; el backoff puede llevar varios minutos…"); const { lab } = await verifyWithPolling(turn); saveHistory("Recuperación automática verificada", turn.turno_origen_id); showResult(`Recuperado: ${lab.copies} copia, ${lab.receipts} recibo(s), ${lab.circularEvents} evento(s) de retorno.`); await loadEvents(); await refreshOverview(); });
  if (action === "replay-demo") return withBusy(replayDemo);
  if (action === "run-permissions") return withBusy(permissionMatrix);
  if (action === "sync-once") {
    const confirmation = await askConfirm({ title: "Ejecutar un ciclo manual", copy: "Se ejecutará el comando --once del sincronizador. Puede entregar todos los eventos pendientes existentes.", phrase: "EJECUTAR SINCRONIZACIÓN" });
    if (!confirmation) return;
    return withBusy(async () => { const result = await api("/api/sync/run-once", { method: "POST", body: JSON.stringify({ confirmation }) }); saveHistory("Ciclo de sincronización manual", result.result); toast("Ciclo manual terminado."); await refreshAll(); });
  }
  if (action === "modify-demo") {
    const turn = selectedDemo(); if (!turn) return showResult("Seleccioná un turno sintético.", false);
    return withBusy(async () => { const date = $("#demo-date")?.value || futureDate(); const changed = await api(`/api/tests/turns/${turn.nodo_creador}/${turn.turno_id}/modify`, { method: "POST", body: JSON.stringify({ fecha: date, profesional: `DEMO_DISTRIBUIDA_PROFESIONAL_ACTUALIZADO` }) }); saveHistory("Turno sintético modificado", turn.turno_origen_id); await loadDemoTurns(); showResult(`Actualizado el turno ${changed.turn.turno_origen_id} desde ${nodeNames[turn.nodo_creador]}. Revisá las copias.`); });
  }
  if (action === "cancel-demo") {
    const turn = selectedDemo(); if (!turn) return showResult("Seleccioná un turno sintético.", false);
    const confirmation = await askConfirm({ title: "Cancelar turno sintético", copy: `El turno ${turn.turno_origen_id} quedará Cancelado; no se borrará.`, phrase: "CANCELAR TURNO DE DEMOSTRACIÓN" });
    if (!confirmation) return;
    return withBusy(async () => { await api(`/api/tests/turns/${turn.nodo_creador}/${turn.turno_id}/cancel`, { method: "POST", body: JSON.stringify({ confirmation }) }); saveHistory("Turno sintético cancelado", turn.turno_origen_id); await loadDemoTurns(); showResult(`Turno ${turn.turno_origen_id} cancelado en el nodo propietario.`); });
  }
  if (action === "new-turn") return openCreateForm();
}
function openCreateForm() {
  const view = $("#view"); view.insertAdjacentHTML("beforeend", `<dialog id="turn-dialog" class="dialog"><form id="turn-form"><div class="eyebrow">Registro</div><h2>Crear turno</h2><p>Se ejecuta crear_turno() en el nodo seleccionado. Evitá ingresar datos clínicos reales en este entorno.</p><div class="form-grid"><div class="form-field"><label>Nodo creador</label><select name="nodeId">${Object.entries(nodeNames).map(([id,label]) => `<option value="${id}">${esc(label)}</option>`).join("")}</select></div><div class="form-field"><label>Área</label><select name="area">${areas.map(a => `<option>${esc(a)}</option>`).join("")}</select></div><div class="form-field"><label>Paciente</label><input name="paciente" required maxlength="120"></div><div class="form-field"><label>ID paciente (opcional)</label><input name="pacienteId" type="number" min="1"></div><div class="form-field"><label>Fecha</label><input name="fecha" type="date" required value="${futureDate()}"></div><div class="form-field"><label>Hora</label><input name="hora" type="time" required value="10:30"></div><div class="form-field"><label>Tipo de estudio</label><input name="tipoEstudio" required maxlength="120"></div><div class="form-field"><label>Profesional</label><input name="profesional" required maxlength="120"></div><div class="form-field full"><label>Estado</label><select name="estado"><option>Pendiente</option><option>Confirmado</option></select></div></div><p class="form-note">La base aplica la matriz de permisos y la propiedad del nodo. La creación escribe en la base seleccionada.</p><div class="dialog-actions"><button type="button" class="button secondary" data-action="close-turn">Cancelar</button><button class="button primary">Crear turno</button></div></form></dialog>`);
  const dialog = $("#turn-dialog"); dialog.showModal(); $("#turn-form").addEventListener("submit", submitCreateForm, { once: true });
}
async function submitCreateForm(event) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget).entries()); if (data.pacienteId === "") data.pacienteId = null; try { const result = await api("/api/turns", { method: "POST", body: JSON.stringify(data) }); $("#turn-dialog").close(); $("#turn-dialog").remove(); saveHistory("Turno creado", `${result.turn.turno_origen_id} · ${nodeNames[result.turn.nodo_creador]}`); toast(`Turno creado: ${result.turn.turno_origen_id}`); await loadTurns(); } catch (error) { toast(error.message, true); $("#turn-form").addEventListener("submit", submitCreateForm, { once: true }); } }
async function editTurn(button) {
  const row = state.turns.find(t => String(t.local_id) === button.dataset.edit && t.nodo_creador === button.dataset.node); if (!row) return;
  const date = prompt("Nueva fecha (AAAA-MM-DD):", row.fecha); if (!date) return;
  const hour = prompt("Nueva hora (HH:MM):", String(row.hora).slice(0,5)); if (!hour) return;
  try { await api(`/api/turns/${row.nodo_creador}/${row.local_id}`, { method: "PATCH", body: JSON.stringify({ fecha: date, hora: hour }) }); saveHistory("Turno modificado", row.turno_origen_id); toast("Turno actualizado."); await loadTurns(); } catch (error) { toast(error.message, true); }
}
async function cancelTurnUI(button) {
  const row = state.turns.find(t => String(t.local_id) === button.dataset.cancel && t.nodo_creador === button.dataset.node); if (!row) return;
  const confirmation = await askConfirm({ title: "Cancelar turno", copy: `El turno ${row.turno_origen_id} pasará al estado Cancelado en su nodo propietario. El registro no se elimina.`, phrase: "CANCELAR TURNO" });
  if (!confirmation) return;
  try { await api(`/api/turns/${row.nodo_creador}/${row.local_id}/cancel`, { method: "POST", body: JSON.stringify({ confirmation }) }); saveHistory("Turno cancelado", row.turno_origen_id); toast("Turno cancelado y cambio registrado para sincronización."); await loadTurns(); } catch (error) { toast(error.message, true); }
}
document.addEventListener("click", event => {
  const nav = event.target.closest("[data-page]"); if (nav) { event.preventDefault(); state.page = nav.dataset.page; location.hash = state.page; render(); if (state.page === "turnos") loadTurns(); if (state.page === "sincronizacion") loadEvents(); if (state.page === "pruebas") loadDemoTurns().then(() => state.page === "pruebas" && render()); return; }
  const test = event.target.closest("[data-test]"); if (test) { state.test = test.dataset.test; render(); loadDemoTurns().then(() => state.page === "pruebas" && render()); return; }
  const action = event.target.closest("[data-action]"); if (action) { if (action.dataset.action === "close-turn") { $("#turn-dialog")?.close(); $("#turn-dialog")?.remove(); return; } doAction(action.dataset.action); return; }
  const edit = event.target.closest("[data-edit]"); if (edit) editTurn(edit);
  const cancel = event.target.closest("[data-cancel]"); if (cancel) cancelTurnUI(cancel);
});
$("#refresh").addEventListener("click", refreshAll);
window.addEventListener("hashchange", () => { const page = location.hash.slice(1); state.page = pageNames[page] ? page : "inicio"; render(); if (state.page === "turnos") loadTurns(); if (state.page === "sincronizacion") loadEvents(); });
state.page = pageNames[location.hash.slice(1)] ? location.hash.slice(1) : "inicio";
render(); refreshOverview();
setInterval(() => { if (state.page === "inicio") refreshOverview(); if (state.page === "sincronizacion") { loadEvents(); refreshOverview(); } }, 15000);
