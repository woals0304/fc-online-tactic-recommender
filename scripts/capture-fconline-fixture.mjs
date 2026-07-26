import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const API_BASE_URL = "https://open.api.nexon.com/fconline/v1";
const DEFAULT_OUTPUT_DIR = "src/lib/fconline/__fixtures__/captured";
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MATCH_TYPE = 50;
const REQUEST_DELAY_MS = 220;

await loadLocalEnv();

const nickname = process.argv[2]?.trim();
const outputDir = process.argv[3] || path.join(DEFAULT_OUTPUT_DIR, createCaptureId());
const apiKey = process.env.NEXON_OPEN_API_KEY;
const limit = readLimit(process.env.FC_ONLINE_DEFAULT_LIMIT);

if (!nickname) {
  throw new Error('사용법: npm run capture:fixture -- "FC_ONLINE_닉네임"');
}

if (!apiKey) {
  throw new Error("NEXON_OPEN_API_KEY 환경변수가 필요합니다.");
}

await mkdir(outputDir, { recursive: true });

const id = await request("/id", { nickname });
const basicUser = await request("/user/basic", { ouid: id.ouid });
const matchIds = await request("/user/match", {
  ouid: id.ouid,
  matchtype: String(MATCH_TYPE),
  offset: "0",
  limit: String(limit),
});
const matchDetails = [];

for (let index = 0; index < matchIds.length; index += 1) {
  matchDetails.push(await request("/match-detail", { matchid: matchIds[index] }));

  if (index < matchIds.length - 1) {
    await wait(REQUEST_DELAY_MS);
  }
}

await writeJson("id.json", id);
await writeJson("basic-user.json", basicUser);
await writeJson("match-ids.json", matchIds);
await writeJson("match-details.json", matchDetails);

console.log(`Fixture saved to ${outputDir}`);

async function request(endpoint, params) {
  const url = new URL(`${API_BASE_URL}${endpoint}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      "x-nxopen-api-key": apiKey,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${endpoint} failed: ${response.status} ${body}`);
  }

  return response.json();
}

async function writeJson(filename, value) {
  const target = path.join(outputDir, filename);
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadLocalEnv() {
  for (const filename of [".env.local", ".env"]) {
    try {
      const content = await readFile(filename, "utf8");

      for (const line of content.split(/\r?\n/)) {
        const trimmedLine = line.trim();

        if (!trimmedLine || trimmedLine.startsWith("#")) {
          continue;
        }

        const separatorIndex = trimmedLine.indexOf("=");

        if (separatorIndex === -1) {
          continue;
        }

        const key = trimmedLine.slice(0, separatorIndex).trim();
        const value = trimmedLine.slice(separatorIndex + 1).trim();
        process.env[key] ||= value.replace(/^["']|["']$/g, "");
      }
    } catch {
      // 환경변수 파일이 없으면 이미 등록된 process.env 값을 사용합니다.
    }
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readLimit(value) {
  const parsed = Number(value || DEFAULT_LIMIT);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), MAX_LIMIT);
}

function createCaptureId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
