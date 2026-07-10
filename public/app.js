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
    const result = await checkDirect(leg.from_id, leg.to_id);
    leg._valid = result !== "no";
    if (result === "yes") { vBox.className = "validate ok"; vBox.textContent = "✓ Direct train confirmed"; }
    else if (result === "unknown") { vBox.className = "validate checking"; vBox.textContent = "Couldn't confirm a direct train right now — you can still save, and it'll check again live."; }
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

// Returns "yes" | "no" | "unknown". The previous version only had a boolean, which
// meant two real bugs collapsed into a false "not direct": (1) the D1 timetable table
// exists but was never actually populated by an ingest run, so every query came back
// "empty" and was trusted as proof of no direct train; (2) if the live-board fallback
// request itself failed (network blip, RDM downtime — the LAST line of defence), that
// was silently read the same as "checked and found nothing". Both are now surfaced as
// "unknown" instead, which the UI treats as inconclusive rather than a hard no.
async function checkDirect(from, to) {
  let timetableHasData = false;
  try {
    for (const day of ["MO", "SA"]) for (const when of ["07:30", "12:00", "17:30"]) {
      const r = await fetch(`/api/rail/timetable?from=${from}&to=${to}&when=${when}&day=${day}&span=240`);
      if (!r.ok) continue;
      const d = await r.json();
      if (d.dataAvailable === false) continue; // table not populated — don't trust "empty" from it
      timetableHasData = true;
      if (d.services && d.services.length) return "yes";
    }
  } catch (e) {}
  // The timetable genuinely has data and searched every sampled window without a hit —
  // trust that as a real "no".
  if (timetableHasData) return "no";

  // Timetable unavailable — fall back to the live board.
  try {
    const r = await fetch(`/api/rail/validate?from=${from}&to=${to}`);
    if (!r.ok) return "unknown";
    const d = await r.json();
    if (d.direct === true) return "yes";
    // stationHasServices means Darwin found real trains running from `from` right now,
    // just none calling at `to` — solid evidence either way. If the board had nothing
    // in view at all (e.g. the middle of the night), that's inconclusive, not a "no".
    if (d.stationHasServices) return "no";
    return "unknown";
  } catch (e) { return "unknown"; }
}

let boards = {};                // legId -> board data

// Direction (inbound/outbound + onward stations) and step-free accessibility both
// depend only on line+from+to, which never change for a saved leg — so resolve them
// once, at save time, and store on the leg. Nothing at runtime calls /api/tube/direction
// or /api/tube/accessibility; fetchBoard and the card just read what's already there.
function fetchDirection(line, from, to) {
  return fetch(`/api/tube/direction?line=${encodeURIComponent(line)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
    .then((r) => (r.ok ? r.json() : { direction: null, onward: [], onwardIds: [] }))
    .catch(() => ({ direction: null, onward: [], onwardIds: [] }));
}
function fetchAccessibility(stop) {
  return fetch(`/api/tube/accessibility?stop=${encodeURIComponent(stop)}`)
    .then((r) => (r.ok ? r.json() : { stepFree: null }))
    .catch(() => ({ stepFree: null }));
}
async function resolveTubeDirections(legs) {
  await Promise.all(legs.filter((l) => l.mode === "tube" && l.line && l.from_id && l.to_id).map(async (leg) => {
    const [fwd, rev, accFrom, accTo] = await Promise.all([
      fetchDirection(leg.line, leg.from_id, leg.to_id),
      fetchDirection(leg.line, leg.to_id, leg.from_id),
      fetchAccessibility(leg.from_id),
      fetchAccessibility(leg.to_id),
    ]);
    leg.tubeDir = fwd.direction || null;
    leg.tubeOnward = fwd.onward || [];
    leg.tubeOnwardIds = fwd.onwardIds || [];
    leg.tubeDirRev = rev.direction || null;
    leg.tubeOnwardRev = rev.onward || [];
    leg.tubeOnwardIdsRev = rev.onwardIds || [];
    // Step-free only if BOTH ends are confirmed step-free; false if either end is
    // confirmed not; null (shown as no icon) if either end couldn't be determined.
    leg.stepFree = (accFrom.stepFree === true && accTo.stepFree === true) ? true
      : (accFrom.stepFree === false || accTo.stepFree === false) ? false
      : null;
  }));
}

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
  await resolveTubeDirections(commute.legs);   // one-off pull, persisted below — never looked up live again
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
    // Tube: swap in the direction/onward pair resolved for this direction at save
    // time — no lookup here, ever. stepFree isn't direction-specific so it carries
    // over automatically via the ...leg spread above.
    tubeDir: leg.tubeDirRev, tubeOnward: leg.tubeOnwardRev, tubeOnwardIds: leg.tubeOnwardIdsRev,
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
  const stepIcon = leg.mode === "tube" && leg.stepFree != null
    ? `<span class="step-badge ${leg.stepFree ? "yes" : "no"}" title="${leg.stepFree ? "Step-free access at both ends" : "Not step-free at one or both ends"}">♿</span>`
    : "";
  return `<div class="leg" style="--segCol:${col};--nodeCol:${col};transition-delay:${i * 60}ms">
    <div class="leg-spine"><div class="leg-node">${MODE_ICON[leg.mode]}</div>${isLast ? "" : '<div class="leg-connector"></div>'}</div>
    <button class="leg-card" data-leg="${leg.id}" style="--segCol:${col}">
      <div class="leg-top">
        <div class="leg-line-name"><span class="leg-swatch" style="background:${col}"></span>${esc(titleFor(leg))}${stepIcon}</div>
        <span class="leg-badge checking" data-badge>…</span>
      </div>
      <div class="leg-route">${esc(leg.from_name)} → ${esc(leg.to_name)}</div>
      <div class="times" data-times><span class="times-empty">Checking…</span></div>
    </button></div>`;
}

// Patch one card's content in place — badge + times, and the problem/problem-amber card
// state — without touching the surrounding DOM nodes. This is what makes board refreshes
// (initial load, 20s auto-refresh) silent instead of flashy. The full delay reason is
// deliberately NOT shown here — it lives in the digest at the top only, so a single
// disrupted leg doesn't blow the card up to take over the screen.
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
}
function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, "\\$&"); }

function legStatus(leg, board) {
  if (!board) return { card: "", badge: "checking", label: "…", reason: null };
  if (board._error) return { card: "problem", badge: "bad", label: "Couldn't load", reason: board._error };
  if (leg.mode === "tube") {
    // Status from line status severity if present. Card badge stays a plain
    // good/bad/delay summary — the specific reason (signal failure, etc.) only shows
    // in the top digest, via the `reason` field below.
    const sev = board.lineStatusLevel;
    if (sev != null && sev < 10) {
      // Best-effort branch check: if TfL told us exactly which stops the disruption's
      // affected route section covers, and none of them are on this leg's actual path
      // (boarding stop, alighting stop, or anything onward between them), it's a
      // different branch of the same line — don't flag it here. If TfL didn't give us
      // that structured detail (disruptionStopIds is null), we can't tell, so we fall
      // through to flagging it as today, rather than risk hiding a real problem.
      if (board.disruptionStopIds?.length) {
        const mine = new Set([leg.from_id, leg.to_id, ...(leg.tubeOnwardIds || [])]);
        const affectsMe = board.disruptionStopIds.some((id) => mine.has(id));
        if (!affectsMe) return { card: "", badge: "good", label: "Good service", reason: null };
      }
      if (sev < 6) return { card: "problem", badge: "bad", label: "Bad service", reason: board.lineReason };
      return { card: "problem-amber", badge: "delay", label: "Minor delay", reason: board.lineReason };
    }
    return { card: "", badge: "good", label: "Good service", reason: null };
  }
  if (leg.mode === "bus") {
    if (board.disruption) return { card: "problem-amber", badge: "delay", label: "Diversion", reason: board.disruption };
    return { card: "", badge: "good", label: "Running", reason: null };
  }
  // rail
  const svcs = board.services || [];
  if (svcs.some((s) => s.status === "cancelled")) return { card: "problem", badge: "bad", label: "Bad service", reason: svcs.find((s) => s.cancelReason)?.cancelReason || null };
  if (svcs.some((s) => s.status === "delayed")) return { card: "problem-amber", badge: "delay", label: "Minor delay", reason: svcs.find((s) => s.delayReason)?.delayReason || null };
  if (!svcs.length) return { card: "", badge: "checking", label: "No live info", reason: null };
  return { card: "", badge: "good", label: "On time", reason: null };
}

function renderTimes(leg, board) {
  if (board?._error) return `<span class="times-empty">Couldn't load: ${esc(board._error)}</span>`;
  if (!board || !board.services || !board.services.length) return '<span class="times-empty">No live times right now</span>';
  const svcs = board.services.slice(0, 4);
  const isRail = leg.mode === "rail";
  // Destination is deliberately left off here — it's only useful once you've actually
  // decided to look, which is what the leg detail view (openLegDetail) is for.
  const fmt = (s) => isRail
    ? (s.status === "cancelled" ? "Canc" : (s.std || s.estimated || "—"))
    : (s.countdown != null ? (s.countdown <= 1 ? "Due" : String(s.countdown)) : (s.etd || "—"));
  const next = svcs[0];
  const cls = next.status === "cancelled" ? "bad" : next.status === "delayed" ? "delay" : "";
  const nextLabel = fmt(next);
  const showUnit = !isRail && next.countdown != null && next.countdown > 1;
  const rest = svcs.slice(1).map(fmt);
  const restLabel = rest.length ? rest.join(" · ") + (isRail ? "" : " min") : "";
  return `<div class="times-row"><div class="time-next ${cls}">${esc(nextLabel)}${showUnit ? '<span>min</span>' : ""}</div>${restLabel ? `<div class="time-rest">${esc(restLabel)}</div>` : ""}</div>`;
}

// TfL's disruption reason text can be a full paragraph. The digest at the top is meant
// to be a quick summary, not the whole notice, so cut it down to roughly one sentence
// (or a hard character cap if even the first sentence runs long). The full, un-cut text
// still shows in the leg detail view — this only shortens what's on the home screen.
function shortReason(reason, maxLen = 70) {
  if (!reason) return "";
  const cut = reason.search(/[.!?](\s|$)/);
  let s = cut > 0 && cut < maxLen ? reason.slice(0, cut + 1) : reason;
  if (s.length > maxLen) s = s.slice(0, maxLen - 1).trimEnd() + "…";
  return s;
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
  const lines = issues.map((x) => `<span class="summary-sub">${esc(titleFor(x.leg))} — ${esc(x.st.label)}${x.st.reason ? ": " + esc(shortReason(x.st.reason)) : ""}</span>`).join("");
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
      if (controller.signal.aborted || e.name === "AbortError") return;   // cancelled by a newer toggle/refresh — not a real failure
      boards[leg.id] = { services: [], _error: e.message || "network error" };
    }
    if (!controller.signal.aborted && !el("screen-home").hidden) renderHome();
  }));
}

// Reads the board endpoint's own error body (board.js returns { error, status } on a
// non-2xx) so a real failure — e.g. TfL rate-limiting an unauthenticated request —
// shows up as "Couldn't load: HTTP 502 (upstream 429)" instead of silently rendering
// exactly like "no trains due right now". If this keeps happening, that string is the
// thing to look at: 429 specifically means TfL's rate limit, which TFL_APP_KEY fixes.
async function describeFailure(r) {
  let detail = null;
  try { detail = await r.json(); } catch (e) {}
  return `HTTP ${r.status}${detail?.status ? ` (upstream ${detail.status})` : ""}`;
}

async function fetchBoard(leg, signal) {
  if (leg.mode === "tube") {
    // Direction was resolved once at save time and is stored on the leg (tubeDir/
    // tubeOnward) — no lookup happens here. Pass it to board.js so TfL's own
    // `direction` field filters server-side; fall back to matching destination names
    // against the resolved "onward" list client-side, since TfL doesn't always set
    // `direction` on every arrival.
    let url = `/api/tube/board?stop=${encodeURIComponent(leg.from_id)}&line=${encodeURIComponent(leg.line)}`;
    if (leg.tubeDir) url += `&direction=${leg.tubeDir}`;
    // Crowding changes live, unlike direction, so it's fetched here rather than at
    // save time — but run alongside the board request rather than after it.
    const crowdPromise = fetch(`/api/tube/crowding?stop=${encodeURIComponent(leg.from_id)}`, { signal }).catch(() => null);
    const r = await fetch(url, { signal });
    if (!r.ok) return { services: [], _error: await describeFailure(r) };
    const board = await r.json();
    if (leg.tubeOnward?.length && board.services?.length && !board.services.some((s) => s.direction)) {
      const onward = new Set(leg.tubeOnward.map((n) => n.toLowerCase()));
      const filt = board.services.filter((s) => s.destination && onward.has(s.destination.toLowerCase().replace(/ underground station$/, "").replace(/ station$/, "")));
      if (filt.length) board.services = filt;
    }
    try {
      const cr = await crowdPromise;
      board.crowding = (cr && cr.ok) ? (await cr.json()).percentage : null;
    } catch (e) { board.crowding = null; }
    return board;
  }
  if (leg.mode === "bus") {
    const stop = leg._reversed ? (leg.rev_from_id || leg.from_id) : leg.from_id;
    const r = await fetch(`/api/bus/board?stop=${encodeURIComponent(stop)}&line=${encodeURIComponent(leg.route || leg.line)}`, { signal });
    if (!r.ok) return { services: [], _error: await describeFailure(r) };
    const board = await r.json();
    try {
      const dr = await fetch(`/api/bus/disruption?lines=${encodeURIComponent(leg.route || leg.line)}`, { signal });
      const dd = await dr.json();
      if (dd.hasDisruption) board.disruption = dd.disruptions[0]?.description || "Diversion";
    } catch (e) {}
    return board;
  }
  const r = await fetch(`/api/rail/board?from=${encodeURIComponent(leg.from_id)}&to=${encodeURIComponent(leg.to_id)}`, { signal });
  if (!r.ok) return { services: [], _error: await describeFailure(r) };
  return await r.json();
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
  // Mobile browsers (especially iOS Safari, and this as an installed PWA) commonly
  // suspend timers and in-flight network activity while backgrounded, then resume them
  // in an inconsistent state — a fetch that was "in progress" when the screen locked can
  // sit stalled for the rest of its natural life. Skipping refreshes while hidden avoids
  // starting fetches that are likely to end up in that state, and refreshing immediately
  // on return to foreground means you're not waiting up to 20s for the next tick — and
  // aren't looking at whatever got stuck while the tab was away.
  refreshTimer = setInterval(() => {
    if (!el("screen-home").hidden && document.visibilityState === "visible") loadBoards();
  }, 20000);
  tick = setInterval(tickCountdowns, 1000);
}
function stopAutoRefresh() { clearInterval(refreshTimer); clearInterval(tick); }
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && !el("screen-home").hidden) loadBoards();
});

// live countdown decrement between fetches (visual only) — currently a no-op;
// countdowns are simply refetched every 20s instead.
function tickCountdowns() {
  if (el("screen-home").hidden) return;
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
  const st = legStatus(leg, board);
  const isRail = leg.mode === "rail";
  // Full disruption text lives here rather than on the home card — the home screen
  // just gets the short badge + one-line digest summary.
  const disruptionBlock = leg.mode === "tube" && st.reason
    ? `<div class="detail-alert ${st.badge === "bad" ? "bad" : "delay"}">${esc(st.reason)}</div>`
    : "";
  const crowdLine = leg.mode === "tube" && board.crowding != null
    ? `<p class="hint" style="margin-bottom:18px">Station busyness: ${board.crowding}% of its typical peak right now</p>`
    : "";
  el("leg-detail-body").innerHTML = `
    <h2 style="margin-bottom:4px">${esc(leg.from_name)} → ${esc(leg.to_name)}</h2>
    <p class="hint" style="margin-bottom:18px">${esc(titleFor(leg))}</p>
    ${disruptionBlock}
    ${crowdLine}
    ${svcs.length ? svcs.map((s) => {
      const big = isRail ? (s.std || s.estimated || "") : (s.countdown != null ? (s.countdown <= 1 ? "Due" : s.countdown + " min") : "");
      const live = leg.mode === "tube" && s.currentLocation ? `<div class="detail-live">${esc(s.currentLocation)}</div>` : "";
      const svcId = isRail ? (s.serviceID || "") : "";
      return `<div class="detail-row${svcId ? " clickable" : ""}" ${svcId ? `data-svc-id="${esc(svcId)}"` : ""}>
        <div class="detail-row-top"><span class="detail-time">${esc(big)}</span><span class="detail-dest">${esc(s.destination || "")}</span><span class="leg-badge ${s.status === "cancelled" ? "bad" : s.status === "delayed" ? "delay" : "good"}">${esc(s.status === "cancelled" ? "Cancelled" : s.status === "delayed" ? (s.estimated ? "exp " + s.estimated : "Delayed") : (s.platform ? "Pl " + s.platform : "On time"))}</span></div>
        ${live}
        ${svcId ? '<div class="detail-expand" data-expand hidden></div>' : ""}
      </div>`;
    }).join("") : '<p class="hint">No live services right now.</p>'}`;

  if (isRail) {
    el("leg-detail-body").querySelectorAll(".detail-row[data-svc-id]").forEach((row) => {
      row.onclick = (e) => { if (!e.target.closest(".detail-expand")) toggleServiceDetail(row); };
    });
  }
}

// Tap a rail service row to load and show its full calling-point progress — live
// position (which stops it's already called at) and, where we can work it out, the
// earlier working that likely forms it. Lazy: nothing is fetched until you tap.
async function toggleServiceDetail(row) {
  const panel = row.querySelector("[data-expand]");
  if (!panel) return;
  if (!panel.hidden) { panel.hidden = true; return; }
  row.parentElement.querySelectorAll(".detail-expand:not([hidden])").forEach((p) => { if (p !== panel) p.hidden = true; });
  panel.hidden = false;
  if (panel.dataset.loaded) return;
  panel.innerHTML = '<p class="hint" style="padding:6px 0">Loading live position…</p>';
  try {
    const r = await fetch(`/api/rail/service?id=${encodeURIComponent(row.dataset.svcId)}`);
    const d = await r.json();
    if (!r.ok || d.error) { panel.innerHTML = '<p class="hint" style="padding:6px 0">Couldn\'t load live position right now.</p>'; return; }
    panel.innerHTML = renderServicePanel(d);
    panel.dataset.loaded = "1";
  } catch (e) {
    panel.innerHTML = '<p class="hint" style="padding:6px 0">Couldn\'t load live position right now.</p>';
  }
}

function renderServicePanel(d) {
  const stopsHtml = (d.stops || []).map((s) => {
    const cls = s.current ? "current" : s.passed ? "passed" : "";
    const time = s.atd || s.etd || s.std || "";
    return `<div class="svc-stop ${cls}"><span class="svc-stop-time">${esc(time)}</span><span class="svc-stop-name">${esc(s.name)}</span>${s.cancelled ? '<span class="leg-badge bad">Cancelled</span>' : ""}</div>`;
  }).join("");
  // "Formed by" is a best-effort platform/timing guess when it isn't a confirmed link
  // (see functions/api/rail/service.js) — worded as "likely" rather than stated as fact.
  const inbound = d.inbound
    ? `<div class="svc-inbound"><p class="hint" style="margin-bottom:0">Formed by the ${esc(d.inbound.origin)} → ${esc(d.inbound.destination)} working${d.inbound.inferred ? " (likely)" : ""}${d.inbound.platform ? `, due platform ${esc(d.inbound.platform)}` : ""}${d.inbound.expectedArr ? `, expected ${esc(d.inbound.expectedArr)}` : ""}</p></div>`
    : "";
  return `<p class="hint" style="margin:2px 0 8px;font-weight:600;color:var(--ink)">${esc(d.caption || "")}</p>
    <div class="svc-stops">${stopsHtml}</div>
    ${inbound}`;
}

async function bootHome() {
  const saved = await apiGet();
  if (saved && saved.legs && saved.legs.length) {
    commute = saved; await loadTubeLines();
    // One-off backfill for legs saved before direction persistence existed (e.g. your
    // current commute). Only runs for legs actually missing it, and only once ever —
    // after this, they're saved with it and this does nothing on future boots.
    const legacy = commute.legs.filter((l) => l.mode === "tube" && l.line && l.from_id && l.to_id && (l.tubeDir === undefined || l.stepFree === undefined));
    if (legacy.length) { await resolveTubeDirections(legacy); await apiSave(commute); }
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
