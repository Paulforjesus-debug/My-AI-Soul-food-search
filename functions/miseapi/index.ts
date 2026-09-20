import { attachDatabasePool } from "@neon/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Pool } from "pg";
import daeguSnapshot from "../../dist/data/daegu-restaurants.json" with { type: "json" };

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
attachDatabasePool(pool);
const jwks = createRemoteJWKSet(new URL(process.env.NEON_AUTH_JWKS_URL!));
const issuer = new URL(process.env.NEON_AUTH_BASE_URL!).origin;
const allowedOrigins = new Set([
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "https://paulforjesus-debug.github.io",
  ...(process.env.PUBLIC_APP_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean),
]);
const visitorHits = new Map<string, number[]>();
const geocodeCache = new Map<string, { expiresAt: number; location: Record<string, unknown> }>();
let lastGeocodeRequestAt = 0;

type PlaceInput = { name?: unknown; category?: unknown; country_code?: unknown; address?: unknown; latitude?: unknown; longitude?: unknown; website_url?: unknown; note?: unknown };

function cors(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) return { Vary: "Origin" };
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "86400", Vary: "Origin" };
}
function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(request) } });
}
function stringValue(value: unknown, max: number) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : null;
}
function coordinate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
async function identity(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;
  try {
    const { payload } = await jwtVerify(authorization.slice(7), jwks, { issuer });
    if (typeof payload.sub !== "string") return null;
    return { id: payload.sub, email: typeof payload.email === "string" ? payload.email : null };
  } catch { return null; }
}
function validWebsite(url: string | null) {
  if (!url) return true;
  try { return ["http:", "https:"].includes(new URL(url).protocol); } catch { return false; }
}
function serviceKeyForQuery(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
function nearbySearchAllowed(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") || request.headers.get("cf-connecting-ip") || "unknown";
  const visitor = forwarded.split(",")[0].trim();
  const now = Date.now();
  const recent = (visitorHits.get(visitor) || []).filter((at) => now - at < 60_000);
  if (recent.length >= 20) return false;
  recent.push(now);
  visitorHits.set(visitor, recent);
  return true;
}
function tourismPlaces(items: unknown) {
  const list = Array.isArray(items) ? items : items ? [items] : [];
  return list.map((item: any, index) => ({
    id: `kto-${String(item.contentid || index)}`,
    name: String(item.title || "관광공사 등록 음식점"),
    cuisine: "관광 음식점",
    where: String(item.addr1 || item.addr2 || "대한민국"),
    distance: item.dist ? `${Number(item.dist).toLocaleString("ko-KR")}m` : "주변",
    match: "관광공사 등록",
    trust: 82 + (item.tel ? 4 : 0) + (item.firstimage || item.firstimage2 ? 4 : 0),
    source: "한국관광공사 TourAPI · 실시간 조회",
    sources: ["한국관광공사 TourAPI"],
    verified: item.modifiedtime ? `${String(item.modifiedtime).slice(0, 8)} 기준` : "방금 확인",
    desc: item.tel ? `전화 ${item.tel}` : "한국관광공사 관광 음식점 정보입니다.",
    tags: ["관광공사 등록", item.tel ? "전화 정보" : "상세 확인 필요"],
    url: null,
    phone: item.tel ? String(item.tel).trim() : null,
    latitude: Number.isFinite(Number(item.mapy)) ? Number(item.mapy) : null,
    longitude: Number.isFinite(Number(item.mapx)) ? Number(item.mapx) : null,
  })).filter((item) => item.name.length > 0);
}

function cleanLocationQuery(value: string) {
  return value.replace(/\s*(주변|근처|맛집)\s*$/g, "").replace(/\s+/g, " ").trim();
}
async function geocodeLocation(request: Request) {
  if (!nearbySearchAllowed(request)) return json(request, { error: "잠시 후 다시 검색해 주세요." }, 429);
  const url = new URL(request.url);
  const query = cleanLocationQuery(String(url.searchParams.get("q") || ""));
  if (query.length < 2 || query.length > 120) return json(request, { error: "지역이나 동네를 2~120자로 입력해 주세요." }, 400);
  const cacheKey = query.toLocaleLowerCase("ko-KR");
  const cached = geocodeCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return json(request, { location: cached.location, cached: true });

  const wait = Math.max(0, 1_050 - (Date.now() - lastGeocodeRequestAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastGeocodeRequestAt = Date.now();
  const upstreamUrl = new URL("https://nominatim.openstreetmap.org/search");
  upstreamUrl.search = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", addressdetails: "1", "accept-language": "ko,en" }).toString();
  try {
    const upstream = await fetch(upstreamUrl, {
      headers: {
        Accept: "application/json",
        "Accept-Language": "ko,en;q=0.8",
        "User-Agent": "mise-personal-food-finder/1.0 (https://github.com/Paulforjesus-debug/My-AI-Soul-food-search)",
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!upstream.ok) return json(request, { error: "지역 검색 서비스가 일시적으로 응답하지 않습니다." }, 502);
    const results = await upstream.json() as any[];
    const result = results[0];
    const latitude = Number(result?.lat);
    const longitude = Number(result?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return json(request, { error: `“${query}” 위치를 찾지 못했습니다. 도시·구·동 이름을 조금 더 자세히 입력해 주세요.` }, 404);
    const address = result.address || {};
    const location = {
      query,
      latitude,
      longitude,
      name: String(result.display_name || query),
      shortName: String(address.neighbourhood || address.suburb || address.borough || address.city_district || address.city || address.town || address.village || result.name || query),
      countryCode: typeof address.country_code === "string" ? address.country_code.toUpperCase() : null,
      attribution: "© OpenStreetMap contributors",
    };
    geocodeCache.set(cacheKey, { expiresAt: Date.now() + 24 * 60 * 60 * 1_000, location });
    return json(request, { location, cached: false });
  } catch {
    return json(request, { error: "지역 검색 서비스에 일시적으로 연결할 수 없습니다." }, 502);
  }
}

const daeguDistricts = [
  { name: "중구", latitude: 35.8694, longitude: 128.6062 },
  { name: "동구", latitude: 35.8867, longitude: 128.6356 },
  { name: "서구", latitude: 35.8718, longitude: 128.5592 },
  { name: "남구", latitude: 35.8460, longitude: 128.5977 },
  { name: "북구", latitude: 35.8859, longitude: 128.5828 },
  { name: "수성구", latitude: 35.8582, longitude: 128.6307 },
  { name: "달서구", latitude: 35.8299, longitude: 128.5327 },
  { name: "달성군", latitude: 35.7747, longitude: 128.4313 },
  { name: "군위군", latitude: 36.2429, longitude: 128.5729 },
];

function isInDaegu(latitude: number, longitude: number) {
  return latitude >= 35.60 && latitude <= 36.35 && longitude >= 128.30 && longitude <= 128.85;
}
function nearestDaeguDistrict(latitude: number, longitude: number) {
  return daeguDistricts.reduce((nearest, district) => {
    const distance = Math.hypot((district.latitude - latitude) * 111, (district.longitude - longitude) * 90);
    return distance < nearest.distance ? { name: district.name, distance } : nearest;
  }, { name: "중구", distance: Number.POSITIVE_INFINITY }).name;
}
async function nearbyTourism(request: Request) {
  if (!nearbySearchAllowed(request)) return json(request, { error: "잠시 후 다시 검색해 주세요." }, 429);
  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return json(request, { error: "유효한 위치 정보가 필요합니다." }, 400);
  if (!process.env.KTO_SERVICE_KEY) return json(request, { error: "관광공사 API가 아직 설정되지 않았습니다." }, 503);
  const upstreamUrl = new URL("https://apis.data.go.kr/B551011/KorService2/locationBasedList2");
  upstreamUrl.search = new URLSearchParams({
    serviceKey: serviceKeyForQuery(process.env.KTO_SERVICE_KEY),
    MobileOS: "ETC",
    MobileApp: "mise",
    _type: "json",
    mapX: String(longitude),
    mapY: String(latitude),
    radius: "1600",
    contentTypeId: "39",
    arrange: "P",
    numOfRows: "20",
    pageNo: "1",
  }).toString();
  try {
    const upstream = await fetch(upstreamUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    if (!upstream.ok) return json(request, { error: "관광공사 조회 서비스가 일시적으로 응답하지 않습니다." }, 502);
    const payload = await upstream.json() as any;
    const header = payload?.response?.header;
    if (header?.resultCode && header.resultCode !== "0000") return json(request, { error: "관광공사 API 요청이 거절되었습니다.", code: header.resultCode }, 502);
    return json(request, { places: tourismPlaces(payload?.response?.body?.items?.item) });
  } catch {
    return json(request, { error: "관광공사 검색에 일시적으로 연결할 수 없습니다." }, 502);
  }
}

async function nearbyRegional(request: Request) {
  if (!nearbySearchAllowed(request)) return json(request, { error: "잠시 후 다시 검색해 주세요." }, 429);
  const url = new URL(request.url);
  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return json(request, { error: "유효한 위치 정보가 필요합니다." }, 400);
  if (!isInDaegu(latitude, longitude)) return json(request, { places: [], providers: [] });
  const district = nearestDaeguDistrict(latitude, longitude);
  try {
    const places = Array.isArray(daeguSnapshot.districts?.[district as keyof typeof daeguSnapshot.districts]) ? daeguSnapshot.districts[district as keyof typeof daeguSnapshot.districts].slice(0, 30) : [];
    return json(request, { places, providers: ["대구광역시 대구푸드"], region: `대구광역시 ${district}`, fetchedAt: daeguSnapshot.fetchedAt || null });
  } catch {
    return json(request, { error: "지역 맛집 검색에 일시적으로 연결할 수 없습니다." }, 502);
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    const path = new URL(request.url).pathname.replace(/\/$/, "") || "/";
    if (request.method === "GET" && (path === "/" || path === "/health")) return json(request, { ok: true, service: "mise-api" });
    if (request.method === "GET" && path === "/geocode") return geocodeLocation(request);
    if (request.method === "GET" && path === "/kto-nearby") return nearbyTourism(request);
    if (request.method === "GET" && path === "/regional-nearby") return nearbyRegional(request);
    const user = await identity(request);
    if (!user) return json(request, { error: "로그인이 필요하거나 로그인 상태가 만료되었습니다." }, 401);
    if (request.method === "GET" && path === "/session") return json(request, { session: { user } });
    if (request.method === "GET" && path === "/place-submissions") {
      const { rows } = await pool.query("select id, name, category, country_code, address, latitude, longitude, website_url, note, status, created_at from place_submissions where owner_id = $1 order by created_at desc limit 100", [user.id]);
      return json(request, { submissions: rows });
    }
    if (request.method === "POST" && path === "/place-submissions") {
      let input: PlaceInput;
      try { input = await request.json() as PlaceInput; } catch { return json(request, { error: "JSON 형식의 등록 정보를 보내 주세요." }, 400); }
      const name = stringValue(input.name, 160);
      const category = stringValue(input.category, 80);
      const countryCode = (stringValue(input.country_code, 2) || "KR").toUpperCase();
      const address = stringValue(input.address, 500);
      const websiteUrl = stringValue(input.website_url, 500);
      const note = stringValue(input.note, 1200);
      const latitude = coordinate(input.latitude);
      const longitude = coordinate(input.longitude);
      if (!name || name.length < 2) return json(request, { error: "맛집 이름은 2~160자로 입력해 주세요." }, 400);
      if (!/^[A-Z]{2}$/.test(countryCode)) return json(request, { error: "국가 코드는 ISO 2자리 코드여야 합니다." }, 400);
      if (latitude === undefined || longitude === undefined || (latitude !== null && (latitude < -90 || latitude > 90)) || (longitude !== null && (longitude < -180 || longitude > 180))) return json(request, { error: "좌표 값을 확인해 주세요." }, 400);
      if (!validWebsite(websiteUrl)) return json(request, { error: "웹사이트는 http 또는 https 주소여야 합니다." }, 400);
      const { rows } = await pool.query(`insert into place_submissions (owner_id, name, category, country_code, address, latitude, longitude, website_url, note) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id, status, created_at`, [user.id, name, category, countryCode, address, latitude, longitude, websiteUrl, note]);
      return json(request, { submission: rows[0] }, 201);
    }
    return json(request, { error: "요청한 경로를 찾을 수 없습니다." }, 404);
  },
};
