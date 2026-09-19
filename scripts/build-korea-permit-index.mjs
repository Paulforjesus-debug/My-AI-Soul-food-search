import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error("Usage: node scripts/build-korea-permit-index.mjs <source.csv> <output.json>");
  process.exit(1);
}

function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]; const next = text[index + 1];
    if (char === '"' && quoted && next === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && next === "\n") index += 1; row.push(field); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const rows = parseCsv(readFileSync(resolve(input), "utf8"));
const headers = rows.shift().map((value) => value.replace(/^\uFEFF/, "").trim());
const at = (row, label) => row[headers.indexOf(label)]?.trim() ?? "";
const active = new Set(["영업", "정상"]);
const permits = rows.map((row) => ({
  name: at(row, "사업장명"), status: at(row, "영업상태명"), category: at(row, "업태구분명"), address: at(row, "도로명전체주소") || at(row, "소재지전체주소"), openedAt: at(row, "인허가일자"), managementNo: at(row, "관리번호"),
})).filter((place) => place.name && active.has(place.status));
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(resolve(output), JSON.stringify({ source: "행정안전부_식품_일반음식점", generatedAt: new Date().toISOString(), count: permits.length, places: permits }));
console.log(`Created ${permits.length.toLocaleString("ko-KR")} active permits at ${output}`);
