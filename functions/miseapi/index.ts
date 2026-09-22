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
const deviceRegistrationHits = new Map<string, number[]>();
const geocodeCache = new Map<string, { expiresAt: number; location: Record<string, unknown> }>();
const tourismDetailsCache = new Map<string, { expiresAt: number; details: Record<string, unknown> }>();
const placeInsightsCache = new Map<string, { expiresAt: number; insights: Record<string, unknown> }>();
let lastGeocodeRequestAt = 0;

type PlaceInput = { name?: unknown; category?: unknown; country_code?: unknown; address?: unknown; latitude?: unknown; longitude?: unknown; website_url?: unknown; note?: unknown; broadcast_program?: unknown; broadcast_episode?: unknown; broadcast_aired_on?: unknown; broadcast_source_url?: unknown };
type TourismApiResponse = { response?: { header?: { resultCode?: string }; body?: { items?: { item?: unknown } } } };
type TourismApiItem = Record<string, unknown>;
type NominatimResult = { lat?: string; lon?: string; display_name?: string; name?: string; address?: Record<string, unknown>; boundingbox?: string[]; category?: string; type?: string; addresstype?: string };
type GoogleReview = { rating?: number; text?: { text?: string }; relativePublishTimeDescription?: string; authorAttribution?: { displayName?: string; uri?: string }; googleMapsUri?: string };
type GooglePlace = { id?: string; rating?: number; userRatingCount?: number; reviews?: GoogleReview[]; googleMapsLinks?: { placeUri?: string; reviewsUri?: string } };
type GoogleTextSearchResponse = { places?: GooglePlace[] };
type KakaoPlace = { id?: string; place_name?: string; place_url?: string; x?: string; y?: string };
type KakaoSearchResponse = { documents?: KakaoPlace[] };
type YouTubeSearchResponse = { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; publishedAt?: string; thumbnails?: { medium?: { url?: string } } } }> };

function cors(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins.has(origin)) return { Vary: "Origin" };
  return { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Mise-Device-Id", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "86400", Vary: "Origin" };
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
function deviceIdentity(request: Request) {
  const deviceId = request.headers.get("x-mise-device-id") || "";
  return /^[a-f0-9]{32}$/.test(deviceId) ? { id: `device:${deviceId}`, email: null } : null;
}
function deviceRegistrationAllowed(ownerId: string) {
  const now = Date.now();
  const recent = (deviceRegistrationHits.get(ownerId) || []).filter((at) => now - at < 3_600_000);
  if (recent.length >= 20) return false;
  recent.push(now);
  deviceRegistrationHits.set(ownerId, recent);
  return true;
}
function validWebsite(url: string | null) {
  if (!url) return true;
  try { return ["http:", "https:"].includes(new URL(url).protocol); } catch { return false; }
}
function validDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return !value;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
function serviceKeyForQuery(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}
function plainText(value: unknown, max = 500) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " | ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
function menuList(...values: unknown[]) {
  return [...new Set(values.flatMap((value) => plainText(value, 800).split(/\s*\|\s*|\r?\n/)).map((value) => value.trim()).filter(Boolean))].slice(0, 8);
}
function normalizedText(value: string) {
  return value.toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]/gu, "");
}
function coordinatesFromUrl(url: URL) {
  const latitude = Number(url.searchParams.get("lat"));
  const longitude = Number(url.searchParams.get("lon"));
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
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
  const list = (Array.isArray(items) ? items : items ? [items] : []).filter((item): item is TourismApiItem => Boolean(item) && typeof item === "object");
  return list.map((item, index) => ({
    id: `kto-${String(item.contentid || index)}`,
    contentId: item.contentid ? String(item.contentid) : null,
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
    menus: [],
    rating: null,
    reviewCount: null,
    url: null,
    phone: item.tel ? String(item.tel).trim() : null,
    latitude: Number.isFinite(Number(item.mapy)) ? Number(item.mapy) : null,
    longitude: Number.isFinite(Number(item.mapx)) ? Number(item.mapx) : null,
  })).filter((item) => item.name.length > 0);
}

function cleanLocationQuery(value: string) {
  return value.replace(/\s*(주변|근처|맛집)\s*$/g, "").replace(/\s+/g, " ").trim();
}
function locationBounds(value: unknown) {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const [south, north, west, east] = value.map(Number);
  if (![south, north, west, east].every(Number.isFinite) || south >= north || west >= east || south < -90 || north > 90 || west < -180 || east > 180) return null;
  return { south, north, west, east };
}
function isAdministrativeResult(result: NominatimResult) {
  const type = String(result.type || result.addresstype || "").toLowerCase();
  return result.category === "boundary" || type === "administrative" || ["country", "state", "province", "region", "county", "city", "municipality", "district", "city_district", "borough", "suburb", "quarter", "neighbourhood", "village", "town", "hamlet"].includes(type);
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
  upstreamUrl.search = new URLSearchParams({ q: query, format: "jsonv2", limit: "10", addressdetails: "1", "accept-language": "ko,en" }).toString();
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
    const results = await upstream.json() as NominatimResult[];
    const result = results.find(isAdministrativeResult) || results[0];
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
      bounds: isAdministrativeResult(result) ? locationBounds(result.boundingbox) : null,
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
  const requestedRadius = Number(url.searchParams.get("radius"));
  const radius = Number.isFinite(requestedRadius) ? Math.min(20_000, Math.max(1_600, Math.round(requestedRadius))) : 1_600;
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
    radius: String(radius),
    contentTypeId: "39",
    arrange: "P",
    numOfRows: "20",
    pageNo: "1",
  }).toString();
  try {
    const upstream = await fetch(upstreamUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    if (!upstream.ok) return json(request, { error: "관광공사 조회 서비스가 일시적으로 응답하지 않습니다." }, 502);
    const payload = await upstream.json() as TourismApiResponse;
    const header = payload?.response?.header;
    if (header?.resultCode && header.resultCode !== "0000") return json(request, { error: "관광공사 API 요청이 거절되었습니다.", code: header.resultCode }, 502);
    return json(request, { places: tourismPlaces(payload?.response?.body?.items?.item) });
  } catch {
    return json(request, { error: "관광공사 검색에 일시적으로 연결할 수 없습니다." }, 502);
  }
}

async function tourismDetails(request: Request) {
  if (!nearbySearchAllowed(request)) return json(request, { error: "잠시 후 다시 확인해 주세요." }, 429);
  const contentId = String(new URL(request.url).searchParams.get("contentId") || "").trim();
  if (!/^\d{1,30}$/.test(contentId)) return json(request, { error: "유효한 관광공사 콘텐츠 ID가 필요합니다." }, 400);
  if (!process.env.KTO_SERVICE_KEY) return json(request, { error: "관광공사 API가 아직 설정되지 않았습니다." }, 503);
  const cached = tourismDetailsCache.get(contentId);
  if (cached && cached.expiresAt > Date.now()) return json(request, { details: cached.details, cached: true });
  const upstreamUrl = new URL("https://apis.data.go.kr/B551011/KorService2/detailIntro2");
  upstreamUrl.search = new URLSearchParams({
    serviceKey: serviceKeyForQuery(process.env.KTO_SERVICE_KEY),
    MobileOS: "ETC",
    MobileApp: "mise",
    _type: "json",
    contentId,
    contentTypeId: "39",
  }).toString();
  try {
    const upstream = await fetch(upstreamUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    if (!upstream.ok) return json(request, { error: "관광공사 상세 정보가 일시적으로 응답하지 않습니다." }, 502);
    const payload = await upstream.json() as TourismApiResponse;
    const header = payload?.response?.header;
    if (header?.resultCode && header.resultCode !== "0000") return json(request, { error: "관광공사 상세 정보 요청이 거절되었습니다.", code: header.resultCode }, 502);
    const raw = payload?.response?.body?.items?.item;
    const item = Array.isArray(raw) ? raw[0] : raw;
    const details = {
      menus: menuList(item?.firstmenu, item?.treatmenu),
      openingHours: plainText(item?.opentimefood, 300) || null,
      restDays: plainText(item?.restdatefood, 200) || null,
      detailsSource: "한국관광공사 TourAPI",
    };
    tourismDetailsCache.set(contentId, { expiresAt: Date.now() + 24 * 60 * 60 * 1_000, details });
    return json(request, { details, cached: false });
  } catch {
    return json(request, { error: "관광공사 상세 정보에 일시적으로 연결할 수 없습니다." }, 502);
  }
}

async function googlePlaceInsight(name: string, address: string, coordinates: { latitude: number; longitude: number } | null) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { configured: false };
  const searchBody: Record<string, unknown> = { textQuery: `${name} ${address}`.trim(), languageCode: "ko", regionCode: "KR", maxResultCount: 1 };
  if (coordinates) searchBody.locationBias = { circle: { center: coordinates, radius: 3000 } };
  const search = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": "places.id" },
    body: JSON.stringify(searchBody),
    signal: AbortSignal.timeout(8_000),
  });
  if (!search.ok) throw new Error(`Google Places ${search.status}`);
  const searchPayload = await search.json() as GoogleTextSearchResponse;
  const placeId = searchPayload.places?.[0]?.id;
  if (!placeId) return { configured: true, found: false };
  const details = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "rating,userRatingCount,reviews,googleMapsLinks.placeUri,googleMapsLinks.reviewsUri",
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (!details.ok) throw new Error(`Google Place Details ${details.status}`);
  const place = await details.json() as GooglePlace;
  return {
    configured: true,
    found: true,
    rating: Number.isFinite(Number(place.rating)) ? Number(place.rating) : null,
    reviewCount: Number.isFinite(Number(place.userRatingCount)) ? Number(place.userRatingCount) : null,
    placeUrl: place.googleMapsLinks?.placeUri || null,
    reviewsUrl: place.googleMapsLinks?.reviewsUri || null,
    reviews: (place.reviews || []).slice(0, 3).map((review) => ({
      rating: Number.isFinite(Number(review.rating)) ? Number(review.rating) : null,
      text: String(review.text?.text || "").trim().slice(0, 500),
      relativeTime: String(review.relativePublishTimeDescription || "").trim() || null,
      author: String(review.authorAttribution?.displayName || "Google 사용자").trim(),
      authorUrl: review.authorAttribution?.uri || null,
      url: review.googleMapsUri || null,
    })).filter((review) => review.text),
  };
}

async function kakaoPlaceInsight(name: string, address: string) {
  const apiKey = process.env.KAKAO_REST_API_KEY;
  if (!apiKey) return { configured: false };
  const upstreamUrl = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
  upstreamUrl.search = new URLSearchParams({ query: `${name} ${address}`.trim(), size: "1" }).toString();
  const response = await fetch(upstreamUrl, { headers: { Authorization: `KakaoAK ${apiKey}` }, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`Kakao Local ${response.status}`);
  const payload = await response.json() as KakaoSearchResponse;
  const place = payload.documents?.[0];
  if (!place?.id) return { configured: true, found: false };
  return {
    configured: true,
    found: true,
    placeId: place.id,
    name: place.place_name || name,
    placeUrl: place.place_url || null,
    latitude: Number.isFinite(Number(place.y)) ? Number(place.y) : null,
    longitude: Number.isFinite(Number(place.x)) ? Number(place.x) : null,
  };
}

async function youtubeReviewVideos(name: string, address: string) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return { configured: false, videos: [] };
  const upstreamUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  upstreamUrl.search = new URLSearchParams({ part: "snippet", type: "video", maxResults: "3", order: "relevance", q: `${name} ${address} 맛집 리뷰`, key: apiKey }).toString();
  const response = await fetch(upstreamUrl, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) throw new Error(`YouTube Data API ${response.status}`);
  const payload = await response.json() as YouTubeSearchResponse;
  return {
    configured: true,
    videos: (payload.items || []).flatMap((item) => {
      const videoId = item.id?.videoId;
      if (!videoId) return [];
      return [{
        id: videoId,
        title: String(item.snippet?.title || "YouTube 영상").trim(),
        channel: String(item.snippet?.channelTitle || "YouTube").trim(),
        publishedAt: item.snippet?.publishedAt || null,
        thumbnail: item.snippet?.thumbnails?.medium?.url || null,
        url: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
      }];
    }),
  };
}

async function placeInsights(request: Request) {
  if (!nearbySearchAllowed(request)) return json(request, { error: "잠시 후 다시 확인해 주세요." }, 429);
  const url = new URL(request.url);
  const name = String(url.searchParams.get("name") || "").trim();
  const address = String(url.searchParams.get("address") || "").trim();
  if (name.length < 2 || name.length > 160 || address.length > 500) return json(request, { error: "업체 이름 또는 주소를 확인해 주세요." }, 400);
  const cacheKey = `${normalizedText(name)}:${normalizedText(address)}`;
  const cached = placeInsightsCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return json(request, { insights: cached.insights, cached: true });
  const coordinates = coordinatesFromUrl(url);
  const [google, kakao, youtube] = await Promise.allSettled([
    googlePlaceInsight(name, address, coordinates),
    kakaoPlaceInsight(name, address),
    youtubeReviewVideos(name, address),
  ]);
  const insight = {
    google: google.status === "fulfilled" ? google.value : { configured: Boolean(process.env.GOOGLE_MAPS_API_KEY), available: false },
    kakao: kakao.status === "fulfilled" ? kakao.value : { configured: Boolean(process.env.KAKAO_REST_API_KEY), available: false },
    youtube: youtube.status === "fulfilled" ? youtube.value : { configured: Boolean(process.env.YOUTUBE_API_KEY), videos: [] },
  };
  placeInsightsCache.set(cacheKey, { expiresAt: Date.now() + 60 * 60 * 1_000, insights: insight });
  return json(request, { insights: insight, cached: false });
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

const miseApi = {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    const path = new URL(request.url).pathname.replace(/\/$/, "") || "/";
    if (request.method === "GET" && (path === "/" || path === "/health")) return json(request, { ok: true, service: "mise-api" });
    if (request.method === "GET" && path === "/geocode") return geocodeLocation(request);
    if (request.method === "GET" && path === "/kto-nearby") return nearbyTourism(request);
    if (request.method === "GET" && path === "/kto-details") return tourismDetails(request);
    if (request.method === "GET" && path === "/place-insights") return placeInsights(request);
    if (request.method === "GET" && path === "/regional-nearby") return nearbyRegional(request);
    const user = await identity(request) || deviceIdentity(request);
    if (!user) return json(request, { error: "이 기기의 등록 정보를 확인할 수 없습니다. 브라우저 저장 공간을 허용한 뒤 다시 시도해 주세요." }, 401);
    if (request.method === "GET" && path === "/session") return json(request, { session: { user } });
    if (request.method === "GET" && path === "/place-submissions") {
      const { rows } = await pool.query("select id, name, category, country_code, address, latitude, longitude, website_url, note, broadcast_program, broadcast_episode, broadcast_aired_on, broadcast_source_url, status, created_at from place_submissions where owner_id = $1 order by created_at desc limit 100", [user.id]);
      return json(request, { submissions: rows });
    }
    if (request.method === "POST" && path === "/place-submissions") {
      if (user.id.startsWith("device:") && !deviceRegistrationAllowed(user.id)) return json(request, { error: "이 기기에서는 한 시간에 20곳까지 등록할 수 있습니다." }, 429);
      let input: PlaceInput;
      try { input = await request.json() as PlaceInput; } catch { return json(request, { error: "JSON 형식의 등록 정보를 보내 주세요." }, 400); }
      const name = stringValue(input.name, 160);
      const category = stringValue(input.category, 80);
      const countryCode = (stringValue(input.country_code, 2) || "KR").toUpperCase();
      const address = stringValue(input.address, 500);
      const websiteUrl = stringValue(input.website_url, 500);
      const note = stringValue(input.note, 1200);
      const broadcastProgram = stringValue(input.broadcast_program, 120);
      const broadcastEpisode = stringValue(input.broadcast_episode, 120);
      const broadcastAiredOn = stringValue(input.broadcast_aired_on, 10);
      const broadcastSourceUrl = stringValue(input.broadcast_source_url, 500);
      const latitude = coordinate(input.latitude);
      const longitude = coordinate(input.longitude);
      if (!name || name.length < 2) return json(request, { error: "맛집 이름은 2~160자로 입력해 주세요." }, 400);
      if (!address) return json(request, { error: "지역 검색에 반영하려면 주소를 입력해 주세요." }, 400);
      if (!/^[A-Z]{2}$/.test(countryCode)) return json(request, { error: "국가 코드는 ISO 2자리 코드여야 합니다." }, 400);
      if (latitude === undefined || longitude === undefined || (latitude !== null && (latitude < -90 || latitude > 90)) || (longitude !== null && (longitude < -180 || longitude > 180))) return json(request, { error: "좌표 값을 확인해 주세요." }, 400);
      if (!validWebsite(websiteUrl)) return json(request, { error: "웹사이트는 http 또는 https 주소여야 합니다." }, 400);
      if ((broadcastEpisode || broadcastAiredOn || broadcastSourceUrl) && !broadcastProgram) return json(request, { error: "방송 출연 정보를 넣을 때는 프로그램명을 입력해 주세요." }, 400);
      if (broadcastProgram && !broadcastSourceUrl) return json(request, { error: "방송 출연 정보에는 공식 방송 또는 공식 영상 링크가 필요합니다." }, 400);
      if (!validDate(broadcastAiredOn)) return json(request, { error: "방송일은 YYYY-MM-DD 형식으로 입력해 주세요." }, 400);
      if (!validWebsite(broadcastSourceUrl)) return json(request, { error: "공식 방송 링크는 http 또는 https 주소여야 합니다." }, 400);
      const { rows } = await pool.query(`insert into place_submissions (owner_id, name, category, country_code, address, latitude, longitude, website_url, note, broadcast_program, broadcast_episode, broadcast_aired_on, broadcast_source_url, status) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'approved') returning id, status, created_at`, [user.id, name, category, countryCode, address, latitude, longitude, websiteUrl, note, broadcastProgram, broadcastEpisode, broadcastAiredOn, broadcastSourceUrl]);
      return json(request, { submission: rows[0] }, 201);
    }
    return json(request, { error: "요청한 경로를 찾을 수 없습니다." }, 404);
  },
};

export default miseApi;
