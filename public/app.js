"use strict";

/* ============================================================
   Commuter — Pass 1: boot, routing, setup flow
   Model: one commute, built as ordered legs (tube / train / bus).
   Tube = pick a line then two stops on it. Train = two stations,
   validated direct. Bus = pick a route then board/alight stops.
   ============================================================ */

/* ---- device identity (anonymous) ---- */
function deviceId() {
  let id = localStorage.getItem("commuter_device");
  if (!id) { id = (crypto.randomUUID?.() || "d" + Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem("commuter_device", id); }
  return id;
}
const DEVICE = deviceId();

/* ---- helpers ---- */
const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MODE_ICON = {
  tube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/></svg>',
  rail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="3" width="12" height="14" rx="3"/><path d="M6 11h12M9 21l-2-3m10 3l-2-3"/><circle cx="9" cy="14" r=".8" fill="currentColor"/><circle cx="15" cy="14" r=".8" fill="currentColor"/></svg>',
  bus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="13" rx="2.5"/><path d="M4 11h16M8 21v-2m8 2v-2"/><circle cx="8" cy="14" r=".8" fill="currentColor"/><circle cx="16" cy="14" r=".8" fill="currentColor"/></svg>',
};
const MODE_LABEL = { tube: "Tube", rail: "Train", bus: "Bus" };

/* ---- API ---- */
async function apiGet() {
  try { const r = await fetch("/api/profiles", { headers: { "X-Device-Id": DEVICE } }); const d = await r.json(); return (d.profiles || [])[0] || null; }
  catch (e) { return null; }
}
async function apiSave(c) {
  try { await fetch("/api/profiles", { method: "PUT", headers: { "X-Device-Id": DEVICE, "Content-Type": "application/json" }, body: JSON.stringify({ profiles: [c] }) }); } catch (e) {}
}
async function apiDelete() { try { await fetch("/api/profiles", { method: "DELETE", headers: { "X-Device-Id": DEVICE } }); } catch (e) {} }

/* ---- station dataset (rail) ---- */
let RAIL = null, railByCrs = {};
async function loadRail() {
  if (RAIL) return;
  try { const r = await fetch("/api/stations"); const d = await r.json(); RAIL = d.stations || []; }
  catch (e) { const r = await fetch("/stations.fallback.json"); RAIL = await r.json(); }
  RAIL.forEach((s) => { railByCrs[s.c] = s.n; });
}
function searchRail(q) {
  if (!RAIL || q.length < 2) return [];
  const ql = q.toLowerCase();
  return RAIL.filter((s) => s.n.toLowerCase().includes(ql) || s.c.toLowerCase() === ql).slice(0, 8);
}

/* ---- tube lines (cached) ---- */
let TUBE_LINES = null;
async function loadTubeLines() {
  if (TUBE_LINES) return TUBE_LINES;
  try { const r = await fetch("/api/tube/lines"); TUBE_LINES = (await r.json()).lines || []; }
  catch (e) { TUBE_LINES = []; }
  return TUBE_LINES;
}
function lineColour(id) { return (TUBE_LINES || []).find((l) => l.id === id)?.colour || "#2456E6"; }
function lineName(id) { return (TUBE_LINES || []).find((l) => l.id === id)?.name || id; }

/* ---- state ---- */
let commute = { legs: [], alerts: [] };

/* ============================================================
   Routing
   ============================================================ */
function show(screen) {
  ["home", "create", "setup", "leg"].forEach((s) => { el("screen-" + s).hidden = s !== screen; });
  window.scrollTo(0, 0);
}

/* ============================================================
   SETUP
   ============================================================ */
function newLeg() { return { id: "leg" + Date.now() + Math.random().toString(36).slice(2, 5), mode: "tube", line: "", from_id: "", from_name: "", to_id: "", to_name: "", _valid: null }; }

function renderSetup() {
  show("setup");
  renderSetupLegs();
}

function renderSetupLegs() {
  const host = el("setup-legs");
  host.innerHTML = "";
  commute.legs.forEach((leg, i) => {
    const div = document.createElement("div");
    div.className = "setup-leg";
    div.innerHTML = `
      <div class="setup-leg-head">
        <span class="setup-leg-num">${i + 1}</span>
        <span class="sp"></span>
        <button class="mini-btn" data-up ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="mini-btn" data-down ${i === commute.legs.length - 1 ? "disabled" : ""}>↓</button>
        <button class="mini-btn" data-del>✕</button>
      </div>
      <div class="mode-toggle">
        ${["tube", "rail", "bus"].map((m) => `<button class="mode-btn ${leg.mode === m ? "active" : ""}" data-mode="${m}">${MODE_ICON[m]}${MODE_LABEL[m]}</button>`).join("")}
      </div>
      <div data-body></div>`;
    div.querySelectorAll("[data-mode]").forEach((b) => b.onclick = () => { resetLeg(leg, b.dataset.mode); renderSetupLegs(); });
    div.querySelector("[data-del]").onclick = () => { commute.legs.splice(i, 1); renderSetupLegs(); };
    const up = div.querySelector("[data-up]"); if (i > 0) up.onclick = () => { [commute.legs[i - 1], commute.legs[i]] = [commute.legs[i], commute.legs[i - 1]]; renderSetupLegs(); };
    const down = div.querySelector("[data-down]"); if (i < commute.legs.length - 1) down.onclick = () => { [commute.legs[i + 1], commute.legs[i]] = [commute.legs[i], commute.legs[i + 1]]; renderSetupLegs(); };
    renderLegBody(div.querySelector("[data-body]"), leg);
    host.appendChild(div);
  });
}

function resetLeg(leg, mode) {
  leg.mode = mode; leg.line = ""; leg.from_id = ""; leg.from_name = ""; leg.to_id = ""; leg.to_name = "";
  leg.route = ""; leg._valid = null; leg._lineStops = null; leg._routeStops = null;
}

function renderLegBody(host, leg) {
  if (leg.mode === "tube") return renderTubeBody(host, leg);
  if (leg.mode === "rail") return renderRailBody(host, leg);
  return renderBusBody(host, leg);
}

/* ---- TUBE: line first, then two stops on it ---- */
async function renderTubeBody(host, leg) {
  await loadTubeLines();
  host.innerHTML = `
    <label class="field-label">Line <span class="req">*</span></label>
    <div class="line-grid" data-lines></div>
    <div data-stops></div>`;
  const grid = host.querySelector("[data-lines]");
  grid.innerHTML = TUBE_LINES.map((l) => `<button class="line-pill ${leg.line === l.id ? "on" : ""}" data-line="${l.id}"><span class="sw" style="background:${l.colour}"></span>${esc(l.name)}</button>`).join("");
  grid.querySelectorAll("[data-line]").forEach((b) => b.onclick = async () => {
    leg.line = b.dataset.line; leg.from_id = leg.to_id = ""; leg.from_name = leg.to_name = ""; leg._lineStops = null;
    renderSetupLegs();
  });
  if (leg.line) await renderTubeStops(host.querySelector("[data-stops]"), leg);
}

async function renderTubeStops(host, leg) {
  host.innerHTML = `<p class="hint" style="padding:8px 0">Loading ${esc(lineName(leg.line))} stations…</p>`;
  if (!leg._lineStops) {
    try { const r = await fetch(`/api/tube/line-stops?line=${encodeURIComponent(leg.line)}`); leg._lineStops = (await r.json()).stops || []; }
    catch (e) { leg._lineStops = []; }
  }
  const opts = leg._lineStops.map((s) => `<option value="${esc(s.id)}" ${leg.from_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  const optsTo = leg._lineStops.map((s) => `<option value="${esc(s.id)}" ${leg.to_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  host.innerHTML = `
    <div class="field"><label class="field-label">From <span class="req">*</span></label>
      <select data-from><option value="">Choose a station…</option>${opts}</select></div>
    <div class="field"><label class="field-label">To <span class="req">*</span></label>
      <select data-to><option value="">Choose a station…</option>${optsTo}</select></div>`;
  const setName = (id) => leg._lineStops.find((s) => s.id === id)?.name || "";
  host.querySelector("[data-from]").onchange = (e) => { leg.from_id = e.target.value; leg.from_name = setName(e.target.value); leg._valid = leg.from_id && leg.to_id ? true : null; };
  host.querySelector("[data-to]").onchange = (e) => { leg.to_id = e.target.value; leg.to_name = setName(e.target.value); leg._valid = leg.from_id && leg.to_id ? true : null; };
}

/* ---- RAIL: two stations, validate direct ---- */
function renderRailBody(host, leg) {
  host.innerHTML =
    stationField("From station", leg.from_name, "from") +
    stationField("To station", leg.to_name, "to") +
    `<div class="validate" data-validate hidden></div>`;
  const vBox = host.querySelector("[data-validate]");
  const validate = async () => {
    if (!leg.from_id || !leg.to_id) { vBox.hidden = true; leg._valid = null; return; }
    vBox.hidden = false; vBox.className = "validate checking"; vBox.textContent = "Checking for a direct train…";
    const ok = await checkDirect(leg.from_id, leg.to_id);
    leg._valid = ok;
    if (ok) { vBox.className = "validate ok"; vBox.textContent = "✓ Direct train confirmed"; }
    else { vBox.className = "validate bad"; vBox.innerHTML = "No direct train found. If you change trains, add one leg each — you can still save."; }
  };
  ["from", "to"].forEach((which) => {
    const pick = host.querySelector(`[data-picker="${which}"]`);
    const inp = pick.querySelector("input");
    const res = pick.querySelector(".results");
    inp.oninput = () => {
      const matches = searchRail(inp.value.trim());
      if (!matches.length) { res.hidden = true; return; }
      res.hidden = false;
      res.innerHTML = matches.map((s) => `<button class="result-opt" data-crs="${s.c}" data-name="${esc(s.n)}"><span class="r-dot">◉</span><span class="r-name">${esc(s.n)}</span><span class="r-meta">${s.c}</span></button>`).join("");
      res.querySelectorAll(".result-opt").forEach((b) => b.onmousedown = (ev) => {
        ev.preventDefault();
        if (which === "from") { leg.from_id = b.dataset.crs; leg.from_name = b.dataset.name; } else { leg.to_id = b.dataset.crs; leg.to_name = b.dataset.name; }
        inp.value = b.dataset.name; inp.classList.add("picked"); res.hidden = true; validate();
      });
    };
    inp.onblur = () => setTimeout(() => (res.hidden = true), 150);
  });
  if (leg.from_id && leg.to_id) validate();
}

/* ---- BUS: route first, then board/alight from route stops ---- */
function renderBusBody(host, leg) {
  host.innerHTML = `
    <div class="field"><label class="field-label">Bus route <span class="req">*</span></label>
      <input type="text" inputmode="numeric" placeholder="e.g. 213" data-route value="${esc(leg.route || "")}"></div>
    <div data-dir></div>
    <div data-stops></div>
    <div class="validate" data-validate hidden></div>`;
  const routeInp = host.querySelector("[data-route]");
  let t = null;
  routeInp.oninput = () => {
    clearTimeout(t); leg.route = routeInp.value.trim(); leg._routeStops = null;
    t = setTimeout(() => loadRoute(host, leg), 500);
  };
  if (leg.route && leg._routeStops) renderRouteStops(host, leg);
  else if (leg.route) loadRoute(host, leg);
}

async function loadRoute(host, leg) {
  const dirBox = host.querySelector("[data-dir]");
  if (!leg.route) { dirBox.innerHTML = ""; return; }
  dirBox.innerHTML = `<p class="hint" style="padding:6px 0">Finding route ${esc(leg.route)}…</p>`;
  try {
    const r = await fetch(`/api/bus/route-stops?route=${encodeURIComponent(leg.route)}`);
    const d = await r.json();
    leg._routeDirs = d.directions || [];
    if (!leg._routeDirs.length) { dirBox.innerHTML = `<div class="validate bad">Couldn't find route ${esc(leg.route)}. Check the number.</div>`; return; }
    renderRouteStops(host, leg);
  } catch (e) { dirBox.innerHTML = `<div class="validate bad">Couldn't load that route just now.</div>`; }
}

function renderRouteStops(host, leg) {
  const dirBox = host.querySelector("[data-dir]");
  const dirs = leg._routeDirs || [];
  if (leg._dirIdx == null) leg._dirIdx = 0;
  const dir = dirs[leg._dirIdx];
  dirBox.innerHTML = dirs.length > 1
    ? `<div class="field"><label class="field-label">Direction</label><select data-dsel>${dirs.map((d, i) => `<option value="${i}" ${i === leg._dirIdx ? "selected" : ""}>${esc(d.name)}</option>`).join("")}</select></div>`
    : `<p class="hint" style="padding:2px 0 10px">${esc(dir?.name || "")}</p>`;
  const dsel = dirBox.querySelector("[data-dsel]");
  if (dsel) dsel.onchange = (e) => { leg._dirIdx = +e.target.value; leg.from_id = leg.to_id = ""; leg.from_name = leg.to_name = ""; renderRouteStops(host, leg); };

  const stops = dir?.stops || [];
  const stopsBox = host.querySelector("[data-stops]");
  stopsBox.innerHTML = `
    <div class="field"><label class="field-label">Board at <span class="req">*</span></label>
      <select data-from><option value="">Choose a stop…</option>${stops.map((s) => `<option value="${esc(s.id)}" ${leg.from_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>
    <div class="field"><label class="field-label">Get off at <span class="req">*</span></label>
      <select data-to><option value="">Choose a stop…</option>${stops.map((s) => `<option value="${esc(s.id)}" ${leg.to_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>`;
  const vBox = host.querySelector("[data-validate]");
  const nameOf = (id) => stops.find((s) => s.id === id)?.name || "";
  const idxOf = (id) => stops.findIndex((s) => s.id === id);
  const validate = () => {
    if (!leg.from_id || !leg.to_id) { vBox.hidden = true; leg._valid = null; return; }
    vBox.hidden = false;
    if (idxOf(leg.to_id) > idxOf(leg.from_id)) { leg._valid = true; leg.line = leg.route; leg.direction = dir.dir; vBox.className = "validate ok"; vBox.textContent = `✓ Route ${esc(leg.route)} runs this way`; }
    else { leg._valid = false; vBox.className = "validate bad"; vBox.textContent = "Your stop comes before your boarding stop on this route — check the direction."; }
  };
  stopsBox.querySelector("[data-from]").onchange = (e) => { leg.from_id = e.target.value; leg.from_name = nameOf(e.target.value); validate(); };
  stopsBox.querySelector("[data-to]").onchange = (e) => { leg.to_id = e.target.value; leg.to_name = nameOf(e.target.value); validate(); };
  if (leg.from_id && leg.to_id) validate();
}

function stationField(label, val, which) {
  return `<div class="field"><label class="field-label">${label} <span class="req">*</span></label>
    <div class="picker" data-picker="${which}">
      <input type="text" placeholder="Search a station…" value="${esc(val || "")}" autocomplete="off" ${val ? 'class="picked"' : ""}>
      <div class="results" hidden></div>
    </div></div>`;
}

async function checkDirect(from, to) {
  try {
    for (const day of ["MO", "SA"]) for (const when of ["08:00", "12:00", "17:00"]) {
      const r = await fetch(`/api/rail/timetable?from=${from}&to=${to}&when=${when}&day=${day}&span=240`);
      if (!r.ok) continue;
      const d = await r.json();
      if (d.services && d.services.length) return true;
    }
  } catch (e) {}
  try { const r = await fetch(`/api/rail/validate?from=${from}&to=${to}`); const d = await r.json(); if (d.direct || d.windowEmpty) return true; } catch (e) {}
  return false;
}

/* ---- save ---- */
async function saveCommute() {
  const incomplete = commute.legs.filter((l) => !l.from_id || !l.to_id || (l.mode === "tube" && !l.line));
  if (!commute.legs.length) { alert("Add at least one leg first."); return; }
  if (incomplete.length) { alert("Some legs are missing their stops — finish those first."); return; }
  await apiSave(commute);
  await bootHome();
}

/* ============================================================
   HOME (placeholder for Pass 1 — Pass 2 builds live cards)
   ============================================================ */
function renderHome() {
  show("home");
  const wrap = el("commute");
  el("dir-toggle").hidden = false;
  wrap.innerHTML = commute.legs.map((leg, i) => {
    const isLast = i === commute.legs.length - 1;
    const col = leg.mode === "tube" ? lineColour(leg.line) : (leg.mode === "rail" ? "#2456E6" : "#C15F3C");
    const title = leg.mode === "tube" ? lineName(leg.line) : (leg.mode === "rail" ? "Train" : `Bus ${esc(leg.route || leg.line)}`);
    return `<div class="leg" style="--segCol:${col};--nodeCol:${col};transition-delay:${i * 70}ms">
      <div class="leg-spine"><div class="leg-node">${MODE_ICON[leg.mode]}</div>${isLast ? "" : '<div class="leg-connector"></div>'}</div>
      <div class="leg-card" style="--segCol:${col}">
        <div class="leg-top"><div class="leg-line-name"><span class="leg-swatch" style="background:${col}"></span>${esc(title)}</div>
        <span class="leg-badge checking">Live soon</span></div>
        <div class="leg-route">${esc(leg.from_name)} → ${esc(leg.to_name)}</div>
      </div></div>`;
  }).join("");
  revealOnScroll();
}

// Cards rise-and-fade as they enter the viewport.
function revealOnScroll() {
  const items = document.querySelectorAll(".leg:not(.in)");
  if (!("IntersectionObserver" in window)) { items.forEach((n) => n.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  items.forEach((n) => io.observe(n));
}

async function bootHome() {
  const saved = await apiGet();
  if (saved && saved.legs && saved.legs.length) { commute = saved; await loadTubeLines(); renderHome(); }
  else { show("create"); }
}

/* ============================================================
   Nav wiring
   ============================================================ */
el("btn-create").onclick = () => { if (!commute.legs.length) commute.legs.push(newLeg()); renderSetup(); };
el("btn-edit").onclick = () => renderSetup();
el("btn-setup-back").onclick = () => bootHome();
el("btn-add-leg").onclick = () => { commute.legs.push(newLeg()); renderSetupLegs(); };
el("btn-save").onclick = () => saveCommute();
el("btn-delete-all").onclick = async () => { if (!confirm("Delete your whole commute? This can't be undone.")) return; await apiDelete(); commute = { legs: [], alerts: [] }; show("create"); };
el("btn-leg-back").onclick = () => renderHome();
el("dir-am").onclick = () => renderHome();
el("dir-pm").onclick = () => renderHome();

/* ---- boot ---- */
(async function () {
  await loadRail();
  await bootHome();
})();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
