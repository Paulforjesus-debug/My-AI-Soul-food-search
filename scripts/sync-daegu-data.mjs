import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const outputPath = resolve("dist/data/daegu-restaurants.json");
const districts = ["중구", "동구", "서구", "남구", "북구", "수성구", "달서구", "달성군", "군위군"];

function plainText(value, max = 500) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " · ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalize(item, district, index) {
  const reservation = String(item.BKN_YN || "").includes("가능");
  const website = String(item.HP || "").trim();
  return {
    id: `daegu-${String(item.OPENDATA_ID || `${district}-${index}`)}`,
    name: plainText(item.BZ_NM, 160) || "대구시 등록 음식점",
    cuisine: plainText(item.FD_CS, 80) || "음식점",
    where: plainText(item.GNG_CS, 300) || `대구광역시 ${district}`,
    district,
    distance: `대구 ${district}`,
    match: "대구시 공식 맛집",
    trust: 90 + (item.TLNO ? 3 : 0) + (item.MBZ_HR ? 3 : 0),
    source: "대구광역시 대구푸드 · 공식 지역 데이터",
    sources: ["대구광역시 대구푸드"],
    verified: "공식 자료 동기화",
    desc: plainText(item.SMPL_DESC, 360) || plainText(item.MNU, 360) || "대구광역시 공식 맛집 정보입니다.",
    tags: [plainText(item.FD_CS, 40) || "음식점", reservation ? "예약 가능" : null, item.MBZ_HR ? "영업시간 제공" : null].filter(Boolean),
    url: /^https?:\/\//i.test(website) ? website : null,
    phone: plainText(item.TLNO, 40) || null,
    latitude: null,
    longitude: null,
  };
}

async function existingSnapshot() {
  try { return JSON.parse(await readFile(outputPath, "utf8")); } catch { return { districts: {} }; }
}

async function fetchDistrict(district) {
  const endpoint = new URL("https://www.daegufood.go.kr/kor/api/tasty.html");
  endpoint.search = new URLSearchParams({ mode: "json", addr: district }).toString();
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", "User-Agent": "mise-personal-food-finder/1.0" },
    signal: AbortSignal.timeout(35_000),
  });
  if (!response.ok) throw new Error(`${district}: HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.status !== "DONE" || !Array.isArray(payload.data)) throw new Error(`${district}: invalid response`);
  return payload.data.map((item, index) => normalize(item, district, index));
}

const previous = await existingSnapshot();
const results = await Promise.allSettled(districts.map(fetchDistrict));
const byDistrict = {};
for (let index = 0; index < districts.length; index += 1) {
  const district = districts[index];
  const result = results[index];
  if (result.status === "fulfilled") byDistrict[district] = result.value;
  else if (Array.isArray(previous.districts?.[district])) {
    console.warn(`${district} 갱신 실패, 기존 스냅샷 유지: ${result.reason?.message || result.reason}`);
    byDistrict[district] = previous.districts[district];
  } else throw result.reason;
}

const snapshot = {
  source: "대구광역시 대구푸드",
  sourceUrl: "https://www.daegufood.go.kr/kor/api/tasty.html",
  fetchedAt: new Date().toISOString(),
  count: Object.values(byDistrict).reduce((total, places) => total + places.length, 0),
  districts: byDistrict,
};
await mkdir(dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.tmp`;
await writeFile(temporaryPath, `${JSON.stringify(snapshot)}\n`, "utf8");
await rename(temporaryPath, outputPath);
console.log(`대구시 공식 맛집 ${snapshot.count}곳 동기화 완료`);
