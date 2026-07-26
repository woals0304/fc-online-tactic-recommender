const OFFICIAL_STATIC_BASE_URL =
  "https://open.api.nexon.com/static/fconline";
const OFFICIAL_IMAGE_BASE_URL = "https://fco.dn.nexoncdn.co.kr";
const OFFICIAL_DATA_CENTER_BASE_URL = "https://fconline.nexon.com";
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const MAX_PLAYER_METADATA_ENTRIES = 200_000;
const MAX_SEASON_METADATA_ENTRIES = 10_000;
const MAX_POSITION_METADATA_ENTRIES = 1_000;

export const OFFICIAL_METADATA_TTL_MS = 24 * 60 * 60 * 1_000;
export const OFFICIAL_METADATA_FAILURE_TTL_MS = 60 * 1_000;
export const OFFICIAL_METADATA_STALE_IF_ERROR_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export const OFFICIAL_METADATA_ENDPOINTS = Object.freeze({
  players: `${OFFICIAL_STATIC_BASE_URL}/meta/spid.json`,
  seasons: `${OFFICIAL_STATIC_BASE_URL}/meta/seasonid.json`,
  positions: `${OFFICIAL_STATIC_BASE_URL}/meta/spposition.json`,
});

export type OfficialPlayerMetadata = Readonly<{
  id: number;
  name: string;
}>;

export type OfficialSeasonMetadata = Readonly<{
  seasonId: number;
  className: string;
  seasonImg: string;
}>;

export type OfficialPositionMetadata = Readonly<{
  spposition: number;
  desc: string;
}>;

export type OfficialMetadataCatalog = Readonly<{
  status: "available";
  fetchedAt: string;
  expiresAt: string;
  players: readonly OfficialPlayerMetadata[];
  seasons: readonly OfficialSeasonMetadata[];
  positions: readonly OfficialPositionMetadata[];
  getPlayerName: (spId: number) => string | null;
  getSeason: (spId: number) => OfficialSeasonMetadata | null;
  getPositionName: (code: number) => string | null;
  isSubstitutePosition: (code: number) => boolean;
}>;

export type OfficialMetadataUnavailableReason =
  | "http-error"
  | "invalid-json"
  | "invalid-response"
  | "network-error"
  | "timeout";

export type OfficialMetadataUnavailable = Readonly<{
  status: "unavailable";
  fetchedAt: null;
  reason: OfficialMetadataUnavailableReason;
  message: string;
}>;

export type OfficialMetadataResult =
  | OfficialMetadataCatalog
  | OfficialMetadataUnavailable;

export type OfficialPlayerImageVariant = "player" | "action";

type LoadOfficialMetadataOptions = {
  fetchImplementation?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
};

type CacheEntry = {
  expiresAtMs: number;
  staleUntilMs: number;
  result: OfficialMetadataCatalog;
};

let cachedCatalog: CacheEntry | null = null;
let cachedFailure: { expiresAtMs: number; result: OfficialMetadataUnavailable } | null = null;
let inFlightLoad: Promise<OfficialMetadataResult> | null = null;

/**
 * Loads only the three static metadata resources documented by NEXON Open API.
 *
 * Deliberately do not add requests to PlayerInfo or /datacenter/PlayerAbility
 * here. Those DataCenter pages are for user navigation, not a documented API,
 * and must not be fetched, scraped, or crawled automatically.
 */
export async function loadOfficialMetadata(
  options: LoadOfficialMetadataOptions = {},
): Promise<OfficialMetadataResult> {
  const now = options.now ?? Date.now;
  const nowMs = readNow(now);

  if (cachedCatalog && nowMs < cachedCatalog.expiresAtMs) {
    return cachedCatalog.result;
  }

  if (cachedFailure && nowMs < cachedFailure.expiresAtMs) {
    return cachedFailure.result;
  }

  const staleCatalog =
    cachedCatalog && nowMs < cachedCatalog.staleUntilMs ? cachedCatalog : null;
  cachedCatalog = null;
  cachedFailure = null;

  if (inFlightLoad) {
    return inFlightLoad;
  }

  const pendingLoad = loadFreshOfficialMetadata({
    fetchImplementation: options.fetchImplementation ?? fetch,
    now,
    staleCatalog,
    timeoutMs: normalizeTimeout(options.timeoutMs),
  });
  inFlightLoad = pendingLoad;

  try {
    return await pendingLoad;
  } finally {
    if (inFlightLoad === pendingLoad) {
      inFlightLoad = null;
    }
  }
}

export function clearOfficialMetadataCache() {
  cachedCatalog = null;
  cachedFailure = null;
  inFlightLoad = null;
}

export function createOfficialPlayerImageUrl(
  spId: number,
  variant: OfficialPlayerImageVariant = "player",
): string | null {
  if (!isValidSpId(spId) || (variant !== "player" && variant !== "action")) {
    return null;
  }

  const directory = variant === "action" ? "playersAction" : "players";

  return `${OFFICIAL_IMAGE_BASE_URL}/live/externalAssets/common/${directory}/p${spId}.png`;
}

/**
 * Creates a user-facing navigation link only. The returned DataCenter URL must
 * never be used as an automated metadata or ability-stat fetch endpoint.
 */
export function createOfficialPlayerInfoUrl(
  spId: number,
  spGrade: number,
): string | null {
  if (!isValidSpId(spId) || !isValidSpGrade(spGrade)) {
    return null;
  }

  const url = new URL("/DataCenter/PlayerInfo", OFFICIAL_DATA_CENTER_BASE_URL);
  url.searchParams.set("spid", String(spId));
  url.searchParams.set("n1Strong", String(spGrade));

  return url.toString();
}

async function loadFreshOfficialMetadata({
  fetchImplementation,
  now,
  staleCatalog,
  timeoutMs,
}: Required<LoadOfficialMetadataOptions> & {
  staleCatalog: CacheEntry | null;
}): Promise<OfficialMetadataResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const [playersPayload, seasonsPayload, positionsPayload] = await Promise.all([
      fetchMetadataJson(
        OFFICIAL_METADATA_ENDPOINTS.players,
        fetchImplementation,
        controller.signal,
      ),
      fetchMetadataJson(
        OFFICIAL_METADATA_ENDPOINTS.seasons,
        fetchImplementation,
        controller.signal,
      ),
      fetchMetadataJson(
        OFFICIAL_METADATA_ENDPOINTS.positions,
        fetchImplementation,
        controller.signal,
      ),
    ]);

    const players = parsePlayerMetadata(playersPayload);
    const seasons = parseSeasonMetadata(seasonsPayload);
    const positions = parsePositionMetadata(positionsPayload);

    if (!players || !seasons || !positions) {
      throw new MetadataLoadError("invalid-response");
    }

    const fetchedAtMs = readNow(now);
    const expiresAtMs = fetchedAtMs + OFFICIAL_METADATA_TTL_MS;
    const result = createCatalog(
      players,
      seasons,
      positions,
      fetchedAtMs,
      expiresAtMs,
    );

    cachedCatalog = {
      expiresAtMs,
      staleUntilMs: expiresAtMs + OFFICIAL_METADATA_STALE_IF_ERROR_TTL_MS,
      result,
    };
    return result;
  } catch (error) {
    if (staleCatalog) {
      return cacheStaleCatalog(staleCatalog, now);
    }

    if (error instanceof MetadataLoadError) {
      return cacheUnavailableResult(error.reason, now);
    }

    if (controller.signal.aborted || isAbortError(error)) {
      return cacheUnavailableResult("timeout", now);
    }

    return cacheUnavailableResult("network-error", now);
  } finally {
    // Also cancel sibling requests when Promise.all exits early on one failure.
    controller.abort();
    clearTimeout(timeout);
  }
}

async function fetchMetadataJson(
  url: string,
  fetchImplementation: typeof fetch,
  signal: AbortSignal,
): Promise<unknown> {
  let response: Response;

  try {
    response = await fetchImplementation(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (signal.aborted || isAbortError(error)) {
      throw error;
    }

    throw new MetadataLoadError("network-error");
  }

  if (!response.ok) {
    throw new MetadataLoadError("http-error");
  }

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new MetadataLoadError("invalid-json");
  }
}

function createCatalog(
  players: readonly OfficialPlayerMetadata[],
  seasons: readonly OfficialSeasonMetadata[],
  positions: readonly OfficialPositionMetadata[],
  fetchedAtMs: number,
  expiresAtMs: number,
): OfficialMetadataCatalog {
  const playerNamesBySpId = new Map(players.map((player) => [player.id, player.name]));
  const seasonsById = new Map(seasons.map((season) => [season.seasonId, season]));
  const positionNamesByCode = new Map(
    positions.map((position) => [position.spposition, position.desc]),
  );

  const getPlayerName = (spId: number) => {
    if (!isValidSpId(spId)) {
      return null;
    }

    return playerNamesBySpId.get(spId) ?? null;
  };

  const getSeason = (spId: number) => {
    if (!isValidSpId(spId)) {
      return null;
    }

    // FC ONLINE spId currently encodes seasonId in the digits above the
    // six-digit player id. Resolve conservatively against official season data.
    const encodedSeasonId = Math.trunc(spId / 1_000_000);
    return seasonsById.get(encodedSeasonId) ?? null;
  };

  const getPositionName = (code: number) => {
    if (!isNonNegativeSafeInteger(code)) {
      return null;
    }

    return positionNamesByCode.get(code) ?? null;
  };

  const isSubstitutePosition = (code: number) =>
    getPositionName(code)?.trim().toUpperCase() === "SUB";

  return Object.freeze({
    status: "available" as const,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
    players,
    seasons,
    positions,
    getPlayerName,
    getSeason,
    getPositionName,
    isSubstitutePosition,
  });
}

function parsePlayerMetadata(value: unknown): readonly OfficialPlayerMetadata[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_PLAYER_METADATA_ENTRIES
  ) {
    return null;
  }

  const seenIds = new Set<number>();
  const players: OfficialPlayerMetadata[] = [];

  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !isValidSpId(entry.id) ||
      !isNonEmptyString(entry.name) ||
      seenIds.has(entry.id)
    ) {
      return null;
    }

    seenIds.add(entry.id);
    players.push(Object.freeze({ id: entry.id, name: entry.name }));
  }

  return Object.freeze(players);
}

function parseSeasonMetadata(value: unknown): readonly OfficialSeasonMetadata[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_SEASON_METADATA_ENTRIES
  ) {
    return null;
  }

  const seenIds = new Set<number>();
  const seasons: OfficialSeasonMetadata[] = [];

  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !isPositiveSafeInteger(entry.seasonId) ||
      !isNonEmptyString(entry.className) ||
      !isHttpsUrl(entry.seasonImg) ||
      seenIds.has(entry.seasonId)
    ) {
      return null;
    }

    seenIds.add(entry.seasonId);
    seasons.push(
      Object.freeze({
        seasonId: entry.seasonId,
        className: entry.className,
        seasonImg: entry.seasonImg,
      }),
    );
  }

  return Object.freeze(seasons);
}

function parsePositionMetadata(
  value: unknown,
): readonly OfficialPositionMetadata[] | null {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > MAX_POSITION_METADATA_ENTRIES
  ) {
    return null;
  }

  const seenCodes = new Set<number>();
  const positions: OfficialPositionMetadata[] = [];

  for (const entry of value) {
    if (
      !isRecord(entry) ||
      !isNonNegativeSafeInteger(entry.spposition) ||
      !isNonEmptyString(entry.desc) ||
      seenCodes.has(entry.spposition)
    ) {
      return null;
    }

    seenCodes.add(entry.spposition);
    positions.push(
      Object.freeze({ spposition: entry.spposition, desc: entry.desc }),
    );
  }

  return Object.freeze(positions);
}

function createUnavailableResult(
  reason: OfficialMetadataUnavailableReason,
): OfficialMetadataUnavailable {
  const messages: Record<OfficialMetadataUnavailableReason, string> = {
    "http-error": "공식 메타데이터 서버가 정상 응답하지 않았습니다.",
    "invalid-json": "공식 메타데이터 응답을 해석할 수 없습니다.",
    "invalid-response": "공식 메타데이터 응답 형식이 올바르지 않습니다.",
    "network-error": "공식 메타데이터 서버에 연결할 수 없습니다.",
    timeout: "공식 메타데이터 요청 시간이 초과되었습니다.",
  };

  return Object.freeze({
    status: "unavailable" as const,
    fetchedAt: null,
    reason,
    message: messages[reason],
  });
}

function cacheUnavailableResult(
  reason: OfficialMetadataUnavailableReason,
  now: () => number,
) {
  const result = createUnavailableResult(reason);
  cachedFailure = {
    expiresAtMs: readNow(now) + OFFICIAL_METADATA_FAILURE_TTL_MS,
    result,
  };
  return result;
}

function cacheStaleCatalog(staleCatalog: CacheEntry, now: () => number) {
  const nowMs = readNow(now);
  cachedCatalog = {
    expiresAtMs: Math.min(
      staleCatalog.staleUntilMs,
      nowMs + OFFICIAL_METADATA_FAILURE_TTL_MS,
    ),
    staleUntilMs: staleCatalog.staleUntilMs,
    result: staleCatalog.result,
  };
  return staleCatalog.result;
}

class MetadataLoadError extends Error {
  constructor(readonly reason: OfficialMetadataUnavailableReason) {
    super(reason);
    this.name = "MetadataLoadError";
  }
}

function normalizeTimeout(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  return Math.floor(value);
}

function readNow(now: () => number) {
  const value = now();

  return Number.isFinite(value) ? Math.floor(value) : Date.now();
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  );
}

function isValidSpId(value: unknown): value is number {
  return isPositiveSafeInteger(value);
}

function isValidSpGrade(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 13
  );
}

function isHttpsUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}
