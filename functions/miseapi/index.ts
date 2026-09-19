import { attachDatabasePool } from "@neon/functions";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { Pool } from "pg";

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

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request) });
    const path = new URL(request.url).pathname.replace(/\/$/, "") || "/";
    if (request.method === "GET" && (path === "/" || path === "/health")) return json(request, { ok: true, service: "mise-api" });
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
    if (request.method === "GET" && path === "/kto-nearby") return json(request, { places: [], message: "한국관광공사 API 키를 연결하면 공식 관광 데이터를 함께 검색합니다." }, 503);
    return json(request, { error: "요청한 경로를 찾을 수 없습니다." }, 404);
  },
};
