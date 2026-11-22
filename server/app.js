import { HOUR, SOURCES } from "../shared/weather.js";
import { OPEN_METEO_ORIGIN } from "../shared/open-meteo.js";
import { findLocations, getForecast, ProviderError } from "./providers.js";

const SOURCE_IDS = new Set(SOURCES.map(({ id }) => id).filter((id) => id !== "open-meteo"));
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self'",
    "font-src 'self'", `connect-src 'self' ${OPEN_METEO_ORIGIN}`, "base-uri 'none'", "object-src 'none'",
    "frame-ancestors 'none'", "form-action 'self'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function respond(body, status, headers) {
  return new Response(body, { status, headers: { ...SECURITY_HEADERS, ...headers } });
}

function json(body, status = 200, headers = {}) {
  return respond(JSON.stringify(body), status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
}

function providerFailure(source, error) {
  const detail = error instanceof ProviderError ? error.message : error?.name ?? "Unknown error";
  const status = error instanceof ProviderError ? error.status : undefined;
  console.warn("Skylens provider failure", source, detail, status ?? "");
}

function coordinate(value, limit) {
  if (!/^-?\d{1,3}(?:\.\d{1,8})?$/.test(value ?? "")) return null;
  const number = Number(value);
  return Math.abs(number) <= limit ? Number(number.toFixed(4)) : null;
}

function setBounded(map, key, value, size) {
  map.delete(key);
  map.set(key, value);
  if (map.size > size) map.delete(map.keys().next().value);
}

function makeCache({ capacity, staleFor = 0 }) {
  const entries = new Map();
  const inFlight = new Map();
  return async function get(key, now, load) {
    const entry = entries.get(key);
    if (entry) {
      setBounded(entries, key, entry, capacity);
      if (entry.expiresAt > now) return { data: entry.data, stale: false };
      if (entry.retryAt > now) return { data: entry.data, stale: true };
    }
    if (inFlight.has(key)) return inFlight.get(key);
    const canUseStale = entry && now < entry.expiresAt + staleFor;
    if (inFlight.size >= 32) {
      if (canUseStale) return { data: entry.data, stale: true };
      throw new Error("Provider capacity reached");
    }
    const pending = Promise.resolve().then(load).then(({ data, expiresAt }) => {
      setBounded(entries, key, { data, expiresAt }, capacity);
      return { data, stale: false };
    }).catch((error) => {
      if (canUseStale) {
        entry.retryAt = Math.min(now + 30_000, entry.expiresAt + staleFor);
        return { data: entry.data, stale: true };
      }
      throw error;
    }).finally(() => inFlight.delete(key));
    inFlight.set(key, pending);
    return pending;
  };
}

function makeRateLimiter(limit) {
  const clients = new Map();
  return (key, now) => {
    const previous = clients.get(key);
    const elapsed = previous ? Math.max(0, now - previous.at) : 60_000;
    const tokens = Math.min(limit, (previous?.tokens ?? 0) + elapsed * limit / 60_000);
    const allowed = tokens >= 1;
    setBounded(clients, key, { tokens: tokens - Number(allowed), at: now }, 1500);
    return allowed;
  };
}

export function createApp({
  assets = new Map(),
  fetcher = (url, options) => fetch(url, options),
  clock = Date.now,
  rateLimit = 90,
} = {}) {
  const forecastCache = makeCache({ capacity: 180, staleFor: HOUR });
  const searchCache = makeCache({ capacity: 200 });
  const allowRequest = makeRateLimiter(rateLimit);

  return async function app(request, { ip = "local", contact } = {}) {
    const url = new URL(request.url);
    const route = url.pathname;
    const api = route.startsWith("/api/");
    const allow = api ? "GET" : "GET, HEAD";
    if (request.method !== "GET" && (api || request.method !== "HEAD")) {
      const headers = { Allow: allow };
      return api
        ? json({ error: "Method not allowed" }, 405, headers)
        : respond("Method not allowed", 405, headers);
    }

    if (!api) {
      const asset = assets.get(route);
      if (!asset) {
        return respond(request.method === "HEAD" ? null : "Page not found", 404, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        });
      }
      const headers = {
        "Content-Type": asset.type,
        "Cache-Control": route === "/" ? "no-cache" : "public, max-age=3600",
        ETag: asset.etag,
      };
      const matches = request.headers.get("If-None-Match")?.split(",")
        .some((value) => ["*", asset.etag].includes(value.trim().replace(/^W\//, "")));
      if (matches) return respond(null, 304, headers);
      return respond(request.method === "HEAD" ? null : asset.body(), 200, headers);
    }

    if (url.href.length > 1800) return json({ error: "Request URL is too long" }, 414);
    if (route !== "/api/weather" && route !== "/api/locations") return json({ error: "Route not found" }, 404);
    const now = clock();
    if (!allowRequest(ip, now)) return json({ error: "Too many requests" }, 429, { "Retry-After": "1" });

    const params = url.searchParams;
    if (route === "/api/locations") {
      const raw = params.get("q") ?? "";
      const query = raw.trim().replace(/\s+/g, " ");
      if (params.size !== 1 || query.length < 2 || query.length > 80 || /\p{C}/u.test(raw)) {
        return json({ error: "Enter a city name between 2 and 80 characters" }, 400);
      }
      try {
        const { data } = await searchCache(query.toLowerCase(), now, async () => ({
          data: await findLocations(query, { fetcher, contact }),
          expiresAt: now + HOUR,
        }));
        return json({ locations: data });
      } catch (error) {
        providerFailure("location search", error);
        return json({ error: "Location search is temporarily unavailable" }, 503);
      }
    }

    const source = params.get("source");
    const latitude = coordinate(params.get("lat"), 90);
    const longitude = coordinate(params.get("lon"), 180);
    if (params.size !== 3 || !SOURCE_IDS.has(source) || latitude === null || longitude === null) {
      return json({ error: "A supported source and valid coordinates are required" }, 400);
    }

    try {
      const { data, stale } = await forecastCache(`${source}:${latitude},${longitude}`, now, async () => {
        const { status, rows, expiresAt } = await getForecast(source, { latitude, longitude }, { fetcher, now, contact });
        return { data: { source, status, rows, retrievedAt: clock() }, expiresAt };
      });
      return json({ ...data, stale });
    } catch (error) {
      providerFailure(source, error);
      return json({ source, status: "unavailable", error: "Forecast is temporarily unavailable" }, 503);
    }
  };
}
