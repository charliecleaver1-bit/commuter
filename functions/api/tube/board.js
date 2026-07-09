// GET /api/tube/board?stop=940GZZLUWLO&line=waterloo-city&direction=inbound&rows=6
//
// Proxies the TfL Unified API and returns the SAME JSON shape as /api/rail/board,
// so the frontend treats every leg identically. No key required for this volume;
// set TFL_APP_KEY if you want higher rate limits.
//
// stop      = TfL StopPoint id (Naptan). Waterloo Underground = 940GZZLUWLO
// line      = line id, e.g. 'waterloo-city', 'jubilee', 'northern'
// direction = 'inbound' | 'outbound' (optional filter)
//
// Countdown is real: TfL gives timeToStation in seconds, so "5 min / 8 min" is exact.

const TFL = "https://api.tfl.gov.uk";

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", ...extra },
  });
}

const hhmm = (iso) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function auth(env) {
  return env.TFL_APP_KEY ? `?app_key=${env.TFL_APP_KEY}` : "";
}

// Arrivals need a concrete tube StopPoint id (940GZZLU…). Journey Planner sometimes
// hands us a hub (HUB…) or platform-level id; resolve those to the parent StopPoint.
async function canonicalStop(env, id) {
  if (/^940GZZ/.test(id)) return id;
  try {
    const r = await fetch(`${TFL}/StopPoint/${encodeURIComponent(id)}${auth(env)}`, { headers: { Accept: "application/json" } });
    if (!r.ok) return id;
    const sp = await r.json();
    if (/^940GZZ/.test(sp.id)) return sp.id;
    if (sp.topMostParentId && /^940GZZ/.test(sp.topMostParentId)) return sp.topMostParentId;
    const kid = (sp.children || []).find((c) => /^940GZZ/.test(c.id));
    return kid ? kid.id : id;
  } catch (e) { return id; }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const stop = url.searchParams.get("stop");
  const line = url.searchParams.get("line");
  const direction = url.searchParams.get("direction"); // optional
  const rows = Math.min(Number(url.searchParams.get("rows")) || 6, 12);

  if (!stop) return json({ error: "Missing 'stop' StopPoint id, e.g. ?stop=940GZZLUWLO" }, 400);

  try {
    const stopId = await canonicalStop(env, stop);
    // 1) Live arrivals at the stop (optionally scoped to one line for fewer results).
    const arrivalsUrl = line
      ? `${TFL}/Line/${line}/Arrivals/${stopId}${auth(env)}`
      : `${TFL}/StopPoint/${stopId}/Arrivals${auth(env)}`;
    const aResp = await fetch(arrivalsUrl, { headers: { Accept: "application/json" } });
    if (!aResp.ok) return json({ error: "TfL arrivals error", status: aResp.status }, 502);
    let arrivals = await aResp.json();

    if (direction) arrivals = arrivals.filter((a) => a.direction === direction);

    // Soonest first, capped to rows.
    arrivals.sort((a, b) => a.timeToStation - b.timeToStation);
    arrivals = arrivals.slice(0, rows);

    // 2) Line status → a human disruption reason if the line isn't in Good Service.
    let disruptionReason = null;
    let severity = "on_time";
    if (line) {
      const sResp = await fetch(`${TFL}/Line/${line}/Status${auth(env)}`, { headers: { Accept: "application/json" } });
      if (sResp.ok) {
        const status = await sResp.json();
        const ls = status?.[0]?.lineStatuses?.[0];
        if (ls && ls.statusSeverity !== 10) {
          // 10 = Good Service. Anything else carries a reason.
          disruptionReason = ls.reason || ls.statusSeverityDescription || null;
          severity = /part|minor/i.test(ls.statusSeverityDescription || "") ? "delayed" : "delayed";
        }
      }
    }

    const services = arrivals.map((a) => {
      const mins = Math.max(0, Math.round(a.timeToStation / 60));
      return {
        serviceID: a.id,
        std: hhmm(a.expectedArrival),      // for tube, scheduled≈expected; keep field for shape parity
        etd: `${mins} min`,
        status: severity,                   // per-arrival status follows line status for tube
        estimated: hhmm(a.expectedArrival),
        countdown: mins,                    // exact minutes — the "5 min / 8 min" value
        platform: a.platformName || null,
        operator: "TfL",
        delayReason: disruptionReason,
        cancelReason: null,
        destination: a.destinationName || a.towards || null,
        origin: null,
        lineId: a.lineId || null,
        lineName: a.lineName || null,
        direction: a.direction || null,
      };
    });

    return json(
      {
        from: stop,
        line: line || null,
        direction: direction || null,
        generatedAt: new Date().toISOString(),
        locationName: arrivals[0]?.stationName || stop,
        nrccMessages: disruptionReason ? [disruptionReason] : [],
        services,
      },
      200,
      { "Cache-Control": "public, max-age=15" }
    );
  } catch (e) {
    return json({ error: "Could not reach TfL", detail: String(e) }, 502);
  }
}
