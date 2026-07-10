// GET /api/rail/service?id=<serviceID or serviceIdPercentEncoded>
//
// Darwin (via RDM) GetServiceDetails — the full calling-point list for one service,
// each with scheduled/expected/actual times and platform. Powers the leg detail
// view's live-position timeline: which stops it's already called at, and roughly
// where it is right now. Ported from the equivalent feature in the RTT-based
// maldenTrains app, adapted to Darwin's schema and generalised to any station pair
// (the original was New Malden/Waterloo-specific).
//
// "Formed by" — which earlier working turns around and becomes this train at its
// origin — isn't published directly by Darwin the way RTT exposes a FORM_FROM
// association. So, same as maldenTrains did as ITS fallback (RTT doesn't publish
// this for gb-nr schedules either, in practice): infer it by checking the arrivals
// board at the origin terminus in the few minutes before this train departs, for a
// service that terminated there on the same platform. This is a plausible-turnaround
// guess, not a confirmed link — returned with inferred:true, and omitted entirely
// (not an error) if it can't be determined or the arrivals product isn't available.

const RDM_BASE = "https://api1.raildata.org.uk";
const PRODUCT = "1010-live-departure-board-dep1_2";
const VERSION = "20220120";

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...extra },
  });
}

async function rdmGet(env, path) {
  const endpoint = `${RDM_BASE}/${env.DARWIN_PRODUCT || PRODUCT}/LDBWS/api/${env.DARWIN_VERSION || VERSION}${path}`;
  let resp;
  try {
    resp = await fetch(endpoint, { headers: { "x-apikey": env.DARWIN_APIKEY, Accept: "application/json" } });
  } catch (e) {
    return { ok: false, status: 502, detail: String(e) };
  }
  const text = await resp.text();
  if (!resp.ok) return { ok: false, status: resp.status, endpoint, detail: text.slice(0, 200) };
  try { return { ok: true, data: JSON.parse(text) }; } catch (e) { return { ok: false, status: 502, detail: "Bad JSON from RDM" }; }
}

// Darwin's calling-point times are plain "HH:MM" (or "HH:MM:SS") strings already —
// no ISO parsing needed, unlike the tube/board.js TfL times.
function hhmm(t) {
  return typeof t === "string" && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : null;
}
function toMinutes(hhmmStr) {
  const m = typeof hhmmStr === "string" && hhmmStr.match(/^(\d{2}):(\d{2})/);
  return m ? (+m[1]) * 60 + (+m[2]) : null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  if (!id) return json({ error: "Missing 'id' (serviceID)" }, 400);
  if (!env.DARWIN_APIKEY) return json({ error: "DARWIN_APIKEY not configured" }, 500);

  const svcResp = await rdmGet(env, `/GetServiceDetails/${encodeURIComponent(id)}`);
  if (!svcResp.ok) return json({ error: "RDM error", status: svcResp.status, detail: svcResp.detail }, 502);
  const svc = svcResp.data;

  const result = buildProgress(svc);

  try {
    const inbound = await inferInbound(env, svc);
    if (inbound) result.inbound = inbound;
  } catch (e) { /* bonus feature — omit rather than fail the whole request */ }

  return json(result, 200, { "Cache-Control": "public, max-age=20" });
}

/* Turn GetServiceDetails' previous/here/subsequent calling points into a flat stop
   list with a "current position" caption, the same shape as maldenTrains' buildProgress
   but driven by Darwin's std/etd/atd fields instead of RTT's temporalData. */
function buildProgress(svc) {
  const prev = (svc.previousCallingPoints && svc.previousCallingPoints[0] && svc.previousCallingPoints[0].callingPoint) || [];
  const subs = (svc.subsequentCallingPoints && svc.subsequentCallingPoints[0] && svc.subsequentCallingPoints[0].callingPoint) || [];
  const here = {
    locationName: svc.locationName, crs: svc.crs,
    st: svc.std || svc.sta, et: svc.etd || svc.eta, at: svc.atd || svc.ata,
    isCancelled: svc.isCancelled, platform: svc.platform,
  };
  const allPoints = [...prev, here, ...subs];

  const stops = allPoints.map((p) => ({
    name: p.locationName || "—",
    crs: p.crs || "",
    std: hhmm(p.st),
    etd: p.et === "On time" ? hhmm(p.st) : hhmm(p.et),
    atd: hhmm(p.at),
    platform: p.platform || null,
    cancelled: p.isCancelled === true,
    departed: !!hhmm(p.at),
  }));

  let lastDeparted = -1;
  stops.forEach((s, i) => { if (s.departed) lastDeparted = i; });
  const currentIdx = lastDeparted >= 0 ? Math.min(lastDeparted + 1, stops.length - 1) : 0;
  stops.forEach((s, i) => { s.passed = i < currentIdx; s.current = i === currentIdx; });

  let caption = "No live information.";
  if (stops.length) {
    if (lastDeparted < 0) caption = `Not yet departed ${stops[0].name}`;
    else if (currentIdx >= stops.length - 1 && stops[stops.length - 1].departed) caption = `Arrived at ${stops[stops.length - 1].name}`;
    else caption = `Departed ${stops[lastDeparted].name}, next ${stops[currentIdx].name}`;
  }

  return {
    origin: stops.length ? stops[0].name : "—",
    destination: stops.length ? stops[stops.length - 1].name : "—",
    operator: svc.operator || "",
    stops,
    caption,
  };
}

async function inferInbound(env, svc) {
  const prevAll = (svc.previousCallingPoints && svc.previousCallingPoints[0] && svc.previousCallingPoints[0].callingPoint) || [];
  const origin = prevAll.length ? prevAll[0] : { locationName: svc.locationName, crs: svc.crs, st: svc.std, platform: svc.platform };
  if (!origin.crs || !origin.st || !origin.platform) return null; // need a platform to make a plausible guess at all

  const depMin = toMinutes(origin.st);
  if (depMin == null) return null;

  const arrResp = await rdmGet(env, `/GetArrBoardWithDetails/${origin.crs}?numRows=15&timeWindow=45`);
  if (!arrResp.ok) return null; // arrivals product not entitled, or no data — silently omit
  const arrivals = Array.isArray(arrResp.data.trainServices) ? arrResp.data.trainServices : [];

  let best = null, bestMin = -Infinity;
  for (const a of arrivals) {
    const plat = a.platform;
    if (!plat || String(plat) !== String(origin.platform)) continue;   // same platform — turnarounds almost always reuse it
    const arrTime = a.ata || a.eta || a.sta;
    const arrMin = toMinutes(arrTime);
    if (arrMin == null) continue;
    let gap = depMin - arrMin;
    if (gap < 0) gap += 1440; // midnight wrap
    if (gap < 2 || gap > 35) continue;   // plausible turnaround window
    if (arrMin > bestMin) { bestMin = arrMin; best = a; }
  }
  if (!best) return null;
  const inId = best.serviceIdPercentEncoded || best.serviceID;
  if (!inId) return null;

  const inResp = await rdmGet(env, `/GetServiceDetails/${encodeURIComponent(inId)}`);
  if (!inResp.ok) return null;
  const p = buildProgress(inResp.data);
  return {
    origin: p.origin, destination: p.destination, operator: p.operator, stops: p.stops,
    platform: origin.platform,
    dueArr: hhmm(best.sta), expectedArr: hhmm(best.eta) || hhmm(best.ata),
    inferred: true,
  };
}
