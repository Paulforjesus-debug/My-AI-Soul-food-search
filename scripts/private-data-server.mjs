import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";

const root = resolve("dist");
const envFile = resolve(".env.local");

function loadLocalEnv() {
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadLocalEnv();

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function normalizeTourItem(item) {
  const title = String(item.title ?? "").replace(/<[^>]*>/g, "").trim();
  return {
    id: `kto-${item.contentid}`,
    name: title || "이름 미등록 관광 음식점",
    cuisine: item.cat3 || "관광공사 음식점",
    neighborhood: item.addr1 || "주소 정보 없음",
    distance: item.dist ? `${Number(item.dist).toLocaleString("ko-KR")}m` : "주변",
    match: "관광공사 등록",
    trust: 82 + (item.tel ? 4 : 0) + (item.firstimage ? 4 : 0),
    source: "한국관광공사 TourAPI · 실시간 조회",
    verified: item.modifiedtime ? `${item.modifiedtime.slice(0, 8)} 기준` : "방금 확인",
    description: item.tel ? `전화 ${item.tel}` : "한국관광공사 관광 음식점 정보입니다.",
    tags: ["관광공사 등록", item.tel ? "전화 정보" : "상세 확인 필요"],
    url: `https://korean.visitkorea.or.kr/detail/ms_detail.do?cotid=${item.contentid}`,
  };
}

async function tourismRestaurants(url, response) {
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return json(response, 400, { error: "유효한 위도와 경도가 필요합니다." });
  }
  const key = process.env.KTO_SERVICE_KEY;
  if (!key) return json(response, 503, { configured: false, places: [] });

  const endpoint = new URL("https://apis.data.go.kr/B551011/KorService2/locationBasedList2");
  endpoint.search = new URLSearchParams({
    serviceKey: key,
    MobileOS: "ETC",
    MobileApp: "mise",
    _type: "json",
    contentTypeId: "39",
    mapX: String(lon),
    mapY: String(lat),
    radius: "2000",
    numOfRows: "20",
  }).toString();
  try {
    const upstream = await fetch(endpoint, { headers: { Accept: "application/json" } });
    if (!upstream.ok) throw new Error(`TourAPI ${upstream.status}`);
    const payload = await upstream.json();
    const items = payload?.response?.body?.items?.item ?? [];
    const list = Array.isArray(items) ? items : [items];
    return json(response, 200, { configured: true, places: list.map(normalizeTourItem).filter((place) => place.name !== "이름 미등록 관광 음식점") });
  } catch {
    return json(response, 502, { configured: true, places: [], error: "한국관광공사 데이터 응답을 가져오지 못했습니다." });
  }
}

const contentTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/api/kto") return tourismRestaurants(url, response);
  if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "허용되지 않은 요청입니다." });
  const requested = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
  const file = normalize(join(root, requested));
  if (relative(root, file).startsWith("..") || !existsSync(file)) return json(response, 404, { error: "파일을 찾을 수 없습니다." });
  response.writeHead(200, { "Content-Type": contentTypes[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
  if (request.method === "HEAD") return response.end();
  createReadStream(file).pipe(response);
});

const port = Number(process.env.MISE_PORT ?? 4173);
server.listen(port, "127.0.0.1", () => console.log(`mise personal server: http://127.0.0.1:${port}`));
