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
function newLeg() { return { id: "leg" + Date.now() + Math.random().toString(36).slice(2, 5), mode: "tube", line: "", from_id: "", from_name: "", to_id: "", to_name: "", _valid: null, _collapsed: false, _lineCollapsed: false }; }

function renderSetup() {
  show("setup");
  renderSetupLegs();
}

function legComplete(leg) {
  return leg.from_id && leg.to_id && (leg.mode !== "tube" || leg.line);
}

function renderSetupLegs() {
  const host = el("setup-legs");
  host.innerHTML = "";
  commute.legs.forEach((leg, i) => {
    const div = document.createElement("div");
    div.className = "setup-leg" + (leg._collapsed && legComplete(leg) ? " collapsed" : "");

    if (leg._collapsed && legComplete(leg)) {
      // Collapsed summary row — tap to reopen.
      const col = leg.mode === "tube" ? lineColour(leg.line) : (leg.mode === "rail" ? "#2456E6" : "#C15F3C");
      const title = leg.mode === "tube" ? lineName(leg.line) : (leg.mode === "rail" ? "Train" : `Bus ${esc(leg.route || "")}`);
      div.innerHTML = `
        <button class="leg-summary" data-open>
          <span class="setup-leg-num">${i + 1}</span>
          <span class="sum-sw" style="background:${col}"></span>
          <span class="sum-main"><span class="sum-title">${esc(title)}</span><span class="sum-route">${esc(leg.from_name)} → ${esc(leg.to_name)}</span></span>
          <span class="sum-edit">Edit</span>
        </button>`;
      div.querySelector("[data-open]").onclick = () => { leg._collapsed = false; renderSetupLegs(); };
      host.appendChild(div);
      return;
    }

    div.innerHTML = `
      <div class="setup-leg-head">
        <span class="setup-leg-num">${i + 1}</span>
        <span class="sp"></span>
        ${legComplete(leg) ? '<button class="mini-btn" data-collapse title="Collapse">▲</button>' : ""}
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
    const collapseBtn = div.querySelector("[data-collapse]");
    if (collapseBtn) collapseBtn.onclick = () => { leg._collapsed = true; renderSetupLegs(); };
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
  if (leg.line && leg._lineCollapsed) {
    // Collapsed: show the chosen line as a compact bar with "Change".
    host.innerHTML = `
      <label class="field-label">Line <span class="req">*</span></label>
      <button class="line-chosen" data-change>
        <span class="sw" style="background:${lineColour(leg.line)}"></span>
        <span class="line-chosen-name">${esc(lineName(leg.line))}</span>
        <span class="line-chosen-change">Change</span>
      </button>
      <div data-stops></div>`;
    host.querySelector("[data-change]").onclick = () => { leg._lineCollapsed = false; renderSetupLegs(); };
    await renderTubeStops(host.querySelector("[data-stops]"), leg);
    return;
  }
  host.innerHTML = `
    <label class="field-label">Line <span class="req">*</span></label>
    <div class="line-grid" data-lines></div>
    <div data-stops></div>`;
  const grid = host.querySelector("[data-lines]");
  grid.innerHTML = TUBE_LINES.map((l) => `<button class="line-pill ${leg.line === l.id ? "on" : ""}" data-line="${l.id}"><span class="sw" style="background:${l.colour}"></span>${esc(l.name)}</button>`).join("");
  grid.querySelectorAll("[data-line]").forEach((b) => b.onclick = async () => {
    const changed = leg.line !== b.dataset.line;
    leg.line = b.dataset.line;
    if (changed) { leg.from_id = leg.to_id = ""; leg.from_name = leg.to_name = ""; leg._lineStops = null; }
    leg._lineCollapsed = true;               // auto-collapse the grid after choosing
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
  // The timetable is authoritative (national, all-day). Sample weekday + Saturday across
  // several times; if any returns a direct service, it's direct.
  let timetableWorked = false;
  try {
    for (const day of ["MO", "SA"]) for (const when of ["07:30", "12:00", "17:30"]) {
      const r = await fetch(`/api/rail/timetable?from=${from}&to=${to}&when=${when}&day=${day}&span=240`);
      if (!r.ok) continue;
      timetableWorked = true;
      const d = await r.json();
      if (d.services && d.services.length) return true;
    }
  } catch (e) {}
  // If the timetable answered (even if empty), trust it: no direct train.
  if (timetableWorked) return false;
  // Only if the timetable was unreachable do we fall back to the live board, and only a
  // POSITIVE result counts — an empty board is NOT proof of a direct train.
  try { const r = await fetch(`/api/rail/validate?from=${from}&to=${to}`); const d = await r.json(); if (d.direct === true) return true; } catch (e) {}
  return false;
}

let boards = {};                // legId -> board data

/* ---- save ---- */
async function saveCommute() {
  const incomplete = commute.legs.filter((l) => !l.from_id || !l.to_id || (l.mode === "tube" && !l.line));
  if (!commute.legs.length) { alert("Add at least one leg first."); return; }
  if (incomplete.length) { alert("Some legs are missing their stops — finish those first."); return; }
  // For bus legs, resolve the opposite-direction stops so the evening (reverse) journey
  // boards at the right stop. Uses the route's other direction sequence.
  for (const leg of commute.legs) {
    if (leg.mode === "bus" && leg._routeDirs && leg._routeDirs.length > 1 && leg._dirIdx != null) {
      const other = leg._routeDirs[leg._dirIdx === 0 ? 1 : 0];
      // On the return we board near our AM destination and alight near our AM origin.
      const byName = (nm) => other.stops.find((s) => s.name === nm)?.id || null;
      leg.rev_from_id = byName(leg.to_name) || null;
      leg.rev_to_id = byName(leg.from_name) || null;
    }
    // strip transient fields before saving
    delete leg._routeDirs; delete leg._lineStops; delete leg._collapsed; delete leg._lineCollapsed;
  }
  await apiSave(commute);
  await bootHome();
}

/* ============================================================
   HOME — live
   ============================================================ */
let direction = "am";           // "am" (as set up) | "pm" (reversed)
let refreshTimer = null;
let tick = null;

function autoDirection() { return new Date().getHours() < 12 ? "am" : "pm"; }

// Reverse a leg for the PM journey (swap endpoints; tube/rail reverse cleanly).
function reverseLeg(leg) {
  return {
    ...leg, id: leg.id + "-r",
    from_id: leg.to_id, to_id: leg.from_id,
    from_name: leg.to_name, to_name: leg.from_name,
    _reversed: true,
    // bus: opposite-direction stops resolved lazily; keep route + flip dir token
    direction: leg.direction === "inbound" ? "outbound" : leg.direction === "outbound" ? "inbound" : leg.direction,
  };
}
function activeLegs() {
  return direction === "pm" ? commute.legs.slice().reverse().map(reverseLeg) : commute.legs;
}

function colourFor(leg) {
  return leg.mode === "tube" ? lineColour(leg.line) : (leg.mode === "rail" ? "#2456E6" : "#C15F3C");
}
function titleFor(leg) {
  return leg.mode === "tube" ? lineName(leg.line) : (leg.mode === "rail" ? "Train" : `Bus ${esc(leg.route || leg.line || "")}`);
}

// Tracks which set of leg ids (in order) is currently mounted in #commute, so
// renderHome() can tell a genuine leg-set change (direction toggle, edit) — which
// needs a fresh skeleton — apart from a board simply arriving, which should only
// patch the one card in place. Rebuilding the whole list on every board arrival
// was what caused the flashing: it destroyed and recreated every card, restarting
// the reveal-on-scroll fade for cards that were already on screen.
let renderedLegIds = null;

function renderHome() {
  show("home");
  const legs = activeLegs();
  el("dir-toggle").hidden = legs.length === 0;
  el("dir-am").classList.toggle("active", direction === "am");
  el("dir-pm").classList.toggle("active", direction === "pm");
  el("home-title").textContent = direction === "pm" ? "Heading home" : "Your commute";

  renderDigest(legs);

  const wrap = el("commute");
  const idKey = legs.map((l) => l.id).join(",");
  if (idKey !== renderedLegIds) {
    wrap.innerHTML = legs.map((leg, i) => legSkeleton(leg, i, legs.length)).join("");
    wrap.querySelectorAll("[data-leg]").forEach((b) => b.onclick = () => {
      const leg = legs.find((l) => l.id === b.dataset.leg); if (leg) openLegDetail(leg);
    });
    renderedLegIds = idKey;
    revealOnScroll();
  }
  legs.forEach((leg) => updateLegCard(leg));
}

function legSkeleton(leg, i, total) {
  const isLast = i === total - 1;
  const col = colourFor(leg);
  return `<div class="leg" style="--segCol:${col};--nodeCol:${col};transition-delay:${i * 60}ms">
    <div class="leg-spine"><div class="leg-node">${MODE_ICON[leg.mode]}</div>${isLast ? "" : '<div class="leg-connector"></div>'}</div>
    <button class="leg-card" data-leg="${leg.id}" style="--segCol:${col}">
      <div class="leg-top">
        <div class="leg-line-name"><span class="leg-swatch" style="background:${col}"></span>${esc(titleFor(leg))}</div>
        <span class="leg-badge checking" data-badge>…</span>
      </div>
      <div class="leg-route">${esc(leg.from_name)} → ${esc(leg.to_name)}</div>
      <div class="times" data-times><span class="times-empty">Checking…</span></div>
      <div class="leg-reason" data-reason hidden></div>
    </button></div>`;
}

// Patch one card's content in place — badge, times, reason, and the problem/problem-amber
// state class — without touching the surrounding DOM nodes. This is what makes board
// refreshes (initial load, direction resolution, 20s auto-refresh) silent instead of flashy.
function updateLegCard(leg) {
  const card = document.querySelector(`.leg-card[data-leg="${cssEsc(leg.id)}"]`);
  if (!card) return;
  const board = boards[leg.id];
  const st = legStatus(leg, board);
  card.className = `leg-card ${st.card}`;
  const badge = card.querySelector("[data-badge]");
  badge.className = `leg-badge ${st.badge}`;
  badge.textContent = st.label;
  card.querySelector("[data-times]").innerHTML = renderTimes(leg, board);
  const reasonEl = card.querySelector("[data-reason]");
  if (st.reason) { reasonEl.hidden = false; reasonEl.textContent = st.reason; }
  else { reasonEl.hidden = true; reasonEl.textContent = ""; }
}
function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"); }

function legStatus(leg, board) {
  if (!board) return { card: "", badge: "checking", label: "…", reason: null };
  if (leg.mode === "tube") {
    // status from line status severity if present
    const sev = board.lineStatusLevel;
    if (sev != null && sev < 6) return { card: "problem", badge: "bad", label: board.lineStatus || "Disrupted", reason: board.lineReason };
    if (sev != null && sev < 10) return { card: "problem-amber", badge: "delay", label: board.lineStatus || "Delays", reason: board.lineReason };
    return { card: "", badge: "good", label: "Good service", reason: null };
  }
  if (leg.mode === "bus") {
    if (board.disruption) return { card: "problem-amber", badge: "delay", label: "Diversion", reason: board.disruption };
    return { card: "", badge: "good", label: "Running", reason: null };
  }
  // rail
  const svcs = board.services || [];
  if (svcs.some((s) => s.status === "cancelled")) return { card: "problem", badge: "bad", label: "Cancellations", reason: svcs.find((s) => s.cancelReason)?.cancelReason || null };
  if (svcs.some((s) => s.status === "delayed")) return { card: "problem-amber", badge: "delay", label: "Delays", reason: svcs.find((s) => s.delayReason)?.delayReason || null };
  if (!svcs.length) return { card: "", badge: "checking", label: "No live info", reason: null };
  return { card: "", badge: "good", label: "On time", reason: null };
}

function renderTimes(leg, board) {
  if (!board || !board.services || !board.services.length) return '<span class="times-empty">No live times right now</span>';
  const svcs = board.services.slice(0, 4);
  return svcs.map((s, i) => {
    const isNext = i === 0;
    const cls = s.status === "cancelled" ? "bad" : s.status === "delayed" ? "delay" : "";
    let big, sub;
    if (leg.mode === "rail") {
      big = s.status === "cancelled" ? "Canc" : (s.std || s.estimated || "—");
      sub = s.status === "delayed" && s.estimated ? "exp " + s.estimated : (s.platform ? "Pl " + s.platform : (s.destination || ""));
    } else {
      big = s.countdown != null ? (s.countdown <= 1 ? "Due" : s.countdown + " min") : (s.etd || "—");
      sub = isNext && s.destination ? "to " + s.destination : "";
    }
    return `<div class="time-chip ${isNext ? "next " + cls : ""}"><div class="time-big">${esc(big)}</div>${sub ? `<div class="time-sub">${esc(sub)}</div>` : ""}</div>`;
  }).join("");
}

function renderDigest(legs) {
  const host = el("summary");
  const issues = legs.map((leg) => ({ leg, st: legStatus(leg, boards[leg.id]) }))
    .filter((x) => x.st.badge === "bad" || x.st.badge === "delay");
  const anyLoaded = legs.some((l) => boards[l.id]);
  if (!anyLoaded) { host.innerHTML = `<div class="summary checking"><span class="dot"></span>Checking your ${direction === "pm" ? "route home" : "commute"}…</div>`; return; }
  if (!issues.length) {
    host.innerHTML = `<div class="summary good"><span class="dot"></span><div class="summary-lines"><span class="summary-head">${direction === "pm" ? "Your way home looks clear" : "Your commute looks clear"}</span><span class="summary-sub">Good service on all ${legs.length} leg${legs.length > 1 ? "s" : ""}</span></div></div>`;
    return;
  }
  const lines = issues.map((x) => `<span class="summary-sub">${esc(titleFor(x.leg))} — ${esc(x.st.label)}${x.st.reason ? ": " + esc(x.st.reason) : ""}</span>`).join("");
  host.innerHTML = `<div class="summary bad"><span class="dot"></span><div class="summary-lines"><span class="summary-head">${issues.length} issue${issues.length > 1 ? "s" : ""} on your ${direction === "pm" ? "way home" : "commute"}</span>${lines}</div></div>`;
}

/* ---- fetching boards ---- */
// Every load cycle (initial boot, manual refresh, 20s auto-refresh, direction toggle)
// aborts whatever the previous cycle still had in flight. Just ignoring stale *results*
// (via a generation counter) wasn't enough — the old requests kept running in the
// background, competing for the browser's connection limit and for the TfL/Darwin
// backends with the request you're actually waiting on. Rapid work→home→work clicking
// could leave 2-3 old fetches per leg still in flight, starving the current one — that
// was the "fails to load for ages" behaviour. Aborting the previous cycle up front fixes
// that at the source.
let currentLoad = null; // AbortController for the in-flight loadBoards() cycle, if any

async function loadBoards() {
  currentLoad?.abort();
  const controller = new AbortController();
  currentLoad = controller;
  const legs = activeLegs();
  // Render each card as its board arrives, rather than blocking on the slowest.
  await Promise.all(legs.map(async (leg) => {
    try {
      const b = await fetchBoard(leg, controller.signal);
      if (controller.signal.aborted) return;
      boards[leg.id] = b;
    } catch (e) {
      if (controller.signal.aborted) return;   // cancelled by a newer toggle/refresh — not a real failure
      boards[leg.id] = { services: [] };
    }
    if (!controller.signal.aborted && !el("screen-home").hidden) renderHome();
  }));
}

async function fetchBoard(leg, signal) {
  if (leg.mode === "tube") {
    // Direction filtering removed for now — this shows all arrivals on the line at
    // this stop, both directions, unfiltered. Being revisited later.
    const r = await fetch(`/api/tube/board?stop=${encodeURIComponent(leg.from_id)}&line=${encodeURIComponent(leg.line)}`, { signal });
    return r.ok ? await r.json() : { services: [] };
  }
  if (leg.mode === "bus") {
    const stop = leg._reversed ? (leg.rev_from_id || leg.from_id) : leg.from_id;
    const r = await fetch(`/api/bus/board?stop=${encodeURIComponent(stop)}&line=${encodeURIComponent(leg.route || leg.line)}`, { signal });
    const board = r.ok ? await r.json() : { services: [] };
    try {
      const dr = await fetch(`/api/bus/disruption?lines=${encodeURIComponent(leg.route || leg.line)}`, { signal });
      const dd = await dr.json();
      if (dd.hasDisruption) board.disruption = dd.disruptions[0]?.description || "Diversion";
    } catch (e) {}
    return board;
  }
  const r = await fetch(`/api/rail/board?from=${encodeURIComponent(leg.from_id)}&to=${encodeURIComponent(leg.to_id)}`, { signal });
  return r.ok ? await r.json() : { services: [] };
}

/* ---- refresh: button (flashes green), pull-to-refresh, auto 20s ---- */
async function doRefresh(fromButton) {
  const btn = el("btn-refresh");
  btn.classList.remove("ok"); btn.classList.add("spinning");
  await loadBoards();
  btn.classList.remove("spinning");
  btn.classList.add("ok");
  setTimeout(() => btn.classList.remove("ok"), 1400);
}
function startAutoRefresh() {
  stopAutoRefresh();
  refreshTimer = setInterval(() => { if (!el("screen-home").hidden) loadBoards(); }, 20000);
  tick = setInterval(tickCountdowns, 1000);
}
function stopAutoRefresh() { clearInterval(refreshTimer); clearInterval(tick); }

// live countdown decrement between fetches (visual only)
function tickCountdowns() {
  if (el("screen-home").hidden) return;
  document.querySelectorAll(".time-chip .time-big").forEach(() => {}); // countdowns refetched every 20s; keep simple
}

/* pull-to-refresh */
let touchY = 0, pulling = false;
function initPull() {
  const s = el("screen-home");
  s.addEventListener("touchstart", (e) => { if (window.scrollY <= 0) { touchY = e.touches[0].clientY; pulling = true; } }, { passive: true });
  s.addEventListener("touchmove", (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - touchY;
    if (dy > 70) { pulling = false; doRefresh(); }
  }, { passive: true });
  s.addEventListener("touchend", () => { pulling = false; });
}

/* ---- leg detail (Pass 3 fills rail; basic for now) ---- */
function openLegDetail(leg) {
  show("leg");
  el("leg-detail-mode").textContent = MODE_LABEL[leg.mode] + " · " + titleFor(leg);
  const board = boards[leg.id] || { services: [] };
  const svcs = board.services || [];
  el("leg-detail-body").innerHTML = `
    <h2 style="margin-bottom:4px">${esc(leg.from_name)} → ${esc(leg.to_name)}</h2>
    <p class="hint" style="margin-bottom:18px">${esc(titleFor(leg))}</p>
    ${svcs.length ? svcs.map((s) => {
      const big = leg.mode === "rail" ? (s.std || s.estimated || "") : (s.countdown != null ? (s.countdown <= 1 ? "Due" : s.countdown + " min") : "");
      return `<div class="detail-row"><span class="detail-time">${esc(big)}</span><span class="detail-dest">${esc(s.destination || "")}</span><span class="leg-badge ${s.status === "cancelled" ? "bad" : s.status === "delayed" ? "delay" : "good"}">${esc(s.status === "cancelled" ? "Cancelled" : s.status === "delayed" ? (s.estimated ? "exp " + s.estimated : "Delayed") : (s.platform ? "Pl " + s.platform : "On time"))}</span></div>`;
    }).join("") : '<p class="hint">No live services right now.</p>'}
    ${leg.mode === "rail" ? '<p class="hint" style="margin-top:16px">Full live detail — position, formed-by, fastest train — coming next.</p>' : ""}`;
}

async function bootHome() {
  const saved = await apiGet();
  if (saved && saved.legs && saved.legs.length) {
    commute = saved; await loadTubeLines();
    direction = autoDirection();
    renderHome();
    loadBoards();
    startAutoRefresh();
  } else { stopAutoRefresh(); show("create"); }
}

// Cards rise-and-fade as they enter the viewport.
function revealOnScroll() {
  const items = document.querySelectorAll(".leg:not(.in)");
  if (!("IntersectionObserver" in window)) { items.forEach((n) => n.classList.add("in")); return; }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: "0px 0px -30px 0px" });
  items.forEach((n) => io.observe(n));
}

/* ============================================================
   Nav wiring
   ============================================================ */
el("btn-create").onclick = () => { if (!commute.legs.length) commute.legs.push(newLeg()); renderSetup(); };
el("btn-edit").onclick = () => renderSetup();
el("btn-setup-back").onclick = () => bootHome();
el("btn-add-leg").onclick = () => { commute.legs.forEach((l) => { if (legComplete(l)) l._collapsed = true; }); commute.legs.push(newLeg()); renderSetupLegs(); };
el("btn-save").onclick = () => saveCommute();
el("btn-delete-all").onclick = async () => { if (!confirm("Delete your whole commute? This can't be undone.")) return; await apiDelete(); commute = { legs: [], alerts: [] }; show("create"); };
el("btn-leg-back").onclick = () => renderHome();
el("btn-refresh").onclick = () => doRefresh(true);
// Boards are keyed by leg id, and AM/PM legs already have distinct ids (reverseLeg
// suffixes reversed legs with "-r"), so AM and PM each have their own slot in `boards`.
// We used to wipe the whole cache on every toggle, which meant flicking back to a
// direction you'd already loaded threw away perfectly good data and forced every card
// back through a "Checking…" flash. Now the cached board renders immediately and is
// simply refreshed underneath — a background loadBoards() call still gets the latest
// live times, but the card itself doesn't disappear and reappear to show it.
el("dir-am").onclick = () => { direction = "am"; renderHome(); loadBoards(); };
el("dir-pm").onclick = () => { direction = "pm"; renderHome(); loadBoards(); };
initPull();

/* ---- boot ---- */
(async function () {
  await loadRail();
  await bootHome();
})();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
