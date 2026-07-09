// GET /api/rail/validate?from=NEM&to=WAT
//
// Returns { direct: true|false, count, sample:[{std,destination}] }.
//
// Uses the departure board with filterType=to. IMPORTANT LIMIT: Darwin's board only
// shows trains currently scheduled, and BOTH its timeWindow and timeOffset are capped
// at ~120 minutes — so the board can never see more than ~2 hours ahead of now, by any
// parameter. That means at quiet hours (e.g. overnight) an empty result does NOT prove
// a route is non-direct; there simply are no services in view. The frontend messages
// this honestly rather than claiming "never direct". A fully time-independent check
// would require the scheduled timetable feed (a separate integration), not this board.

const RDM_BASE = "https://api1.raildata.org.uk";
const PRODUCT = "1010-live-departure-board-dep1_2";
const VERSION = "20220120";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  if (!from || !to) return json({ error: "Need both 'from' and 'to' CRS codes" }, 400);
  if (from === to) return json({ error: "from and to are the same station", direct: false }, 400);
  if (!env.DARWIN_APIKEY) return json({ error: "DARWIN_APIKEY not configured" }, 500);

  const params = new URLSearchParams({ numRows: "10", filterCrs: to, filterType: "to", timeWindow: "120" });
  const endpoint =
    `${RDM_BASE}/${env.DARWIN_PRODUCT || PRODUCT}/LDBWS/api/${env.DARWIN_VERSION || VERSION}` +
    `/GetDepBoardWithDetails/${from}?${params.toString()}`;

  try {
    const resp = await fetch(endpoint, { headers: { "x-apikey": env.DARWIN_APIKEY, Accept: "application/json" } });
    const text = await resp.text();
    if (!resp.ok) return json({ error: "RDM error", status: resp.status, endpoint, detail: text.slice(0, 200) }, 502);
    const data = JSON.parse(text);
    const services = Array.isArray(data.trainServices) ? data.trainServices : [];
    return json({
      direct: services.length > 0,
      count: services.length,
      windowEmpty: services.length === 0, // may be a quiet-hours false negative, not proof of non-direct
      from,
      to,
      sample: services.slice(0, 3).map((s) => ({
        std: s.std,
        destination: Array.isArray(s.destination) && s.destination[0] ? s.destination[0].locationName : null,
      })),
    });
  } catch (e) {
    return json({ error: "Could not reach RDM", detail: String(e) }, 502);
  }
}
