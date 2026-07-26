import { isIP } from "node:net";

import { NextResponse } from "next/server";

import { analyzePlayStyle } from "../../../lib/analysis/playStyleAnalyzer";
import { FcOnlineApiError, FcOnlineClient } from "../../../lib/fconline/client";
import {
  DEFAULT_MATCH_TYPE,
  DEFAULT_MATCH_TYPE_LABEL,
  normalizeSearchResult,
} from "../../../lib/fconline/normalize";
import type {
  ApiErrorType,
  FcOnlineMatchDetailResponse,
} from "../../../lib/fconline/types";
import { recommendTactic } from "../../../lib/tactics/tacticRecommender";

const MAX_LIMIT = 10;
const MAX_NICKNAME_LENGTH = 30;
const DEFAULT_LIMIT = readDefaultLimit();
const REQUEST_DELAY_MS = 220;

const CACHE_TTL_MS = 15_000;
const MAX_CACHE_ENTRIES = 100;
const MAX_IN_FLIGHT_ENTRIES = 100;

const RATE_LIMIT_WINDOW_MS = 60_000;
const GLOBAL_UPSTREAM_CALL_BUDGET = 120;
const IP_RATE_LIMIT = 10;
const MAX_RATE_LIMIT_ENTRIES = 1_000;
const GLOBAL_RATE_LIMIT_KEY = "global";

type SearchPayload = Awaited<ReturnType<typeof fetchSearchPayload>>["payload"];

type SearchOutcome =
  | {
      ok: true;
      payload: SearchPayload;
      cacheable: boolean;
    }
  | {
      ok: false;
      type: ApiErrorType;
      message: string;
      status: number;
      retryAfter?: number;
    };

type CacheEntry = {
  expiresAt: number;
  payload: SearchPayload;
};

type RateLimitEntry = {
  count: number;
  windowStartedAt: number;
};

const responseCache = new Map<string, CacheEntry>();
const inFlightSearches = new Map<string, Promise<SearchOutcome>>();
const rateLimitEntries = new Map<string, RateLimitEntry>();

class SearchRouteError extends Error {
  readonly type: ApiErrorType;
  readonly status: number;

  constructor(type: ApiErrorType, message: string, status: number) {
    super(message);
    this.name = "SearchRouteError";
    this.type = type;
    this.status = status;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const nickname = (searchParams.get("nickname") || "").trim();
  const limit = clampLimit(searchParams.get("limit"));

  if (!nickname) {
    return createErrorResponse("validation", "FC ONLINE 닉네임을 입력해 주세요.", 400);
  }

  if (Array.from(nickname).length > MAX_NICKNAME_LENGTH) {
    return createErrorResponse(
      "validation",
      `FC ONLINE 닉네임은 ${MAX_NICKNAME_LENGTH}자 이하로 입력해 주세요.`,
      400,
    );
  }

  const now = Date.now();
  const ipRetryAfter = consumeIpRequestBudget(request, now);

  if (ipRetryAfter !== null) {
    return createErrorResponse(
      "external-api",
      "요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.",
      429,
      { "Retry-After": String(ipRetryAfter) },
    );
  }

  const apiKey = process.env.NEXON_OPEN_API_KEY;

  if (!apiKey) {
    console.error("[api/search] NEXON Open API key is not configured.");
    return createErrorResponse(
      "configuration",
      "서버 설정이 완료되지 않았습니다. 잠시 뒤 다시 시도해 주세요.",
      500,
    );
  }

  const cacheKey = JSON.stringify([nickname, limit]);
  const outcome = await getSearchOutcome(cacheKey, nickname, limit, apiKey, now);

  if (!outcome.ok) {
    return createErrorResponse(
      outcome.type,
      outcome.message,
      outcome.status,
      outcome.retryAfter === undefined
        ? undefined
        : { "Retry-After": String(outcome.retryAfter) },
    );
  }

  return NextResponse.json(outcome.payload);
}

async function getSearchOutcome(
  cacheKey: string,
  nickname: string,
  limit: number,
  apiKey: string,
  now: number,
): Promise<SearchOutcome> {
  const cached = readCache(cacheKey, now);

  if (cached) {
    return { ok: true, payload: cached, cacheable: true };
  }

  const existingSearch = inFlightSearches.get(cacheKey);

  if (existingSearch) {
    return existingSearch;
  }

  if (inFlightSearches.size >= MAX_IN_FLIGHT_ENTRIES) {
    return {
      ok: false,
      type: "external-api",
      message: "현재 조회 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.",
      status: 503,
    };
  }

  const retryAfter = reserveUpstreamCallBudget(now, estimateUpstreamCallCost(limit));

  if (retryAfter !== null) {
    return {
      ok: false,
      type: "external-api",
      message: "요청이 너무 많습니다. 잠시 뒤 다시 시도해 주세요.",
      status: 429,
      retryAfter,
    };
  }

  const search = runSearch(nickname, limit, apiKey);
  inFlightSearches.set(cacheKey, search);

  try {
    const outcome = await search;

    if (outcome.ok && outcome.cacheable) {
      writeCache(cacheKey, outcome.payload, Date.now());
    }

    return outcome;
  } finally {
    if (inFlightSearches.get(cacheKey) === search) {
      inFlightSearches.delete(cacheKey);
    }
  }
}

async function runSearch(nickname: string, limit: number, apiKey: string): Promise<SearchOutcome> {
  try {
    const result = await fetchSearchPayload(nickname, limit, apiKey);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof SearchRouteError) {
      return {
        ok: false,
        type: error.type,
        message: error.message,
        status: error.status,
      };
    }

    logSearchFailure(error, limit);
    return normalizeExternalFailure(error);
  }
}

async function fetchSearchPayload(nickname: string, limit: number, apiKey: string) {
  const client = new FcOnlineClient(apiKey);
  const identity = await client.getOuidByNickname(nickname);

  if (
    !identity ||
    typeof identity.ouid !== "string" ||
    !identity.ouid ||
    identity.ouid !== identity.ouid.trim()
  ) {
    throw new FcOnlineApiError(
      "FC ONLINE API 사용자 식별 응답이 올바르지 않습니다.",
      502,
      "INVALID_RESPONSE",
    );
  }

  const ouid = identity.ouid;
  const [user, rawMatchIds] = await Promise.all([
    client.getBasicUser(ouid),
    client.getRecentMatchIds(ouid, DEFAULT_MATCH_TYPE, limit),
  ]);

  if (!Array.isArray(rawMatchIds)) {
    throw new FcOnlineApiError(
      "FC ONLINE API 경기 목록 응답이 올바르지 않습니다.",
      502,
      "INVALID_RESPONSE",
    );
  }

  if (
    !user ||
    typeof user !== "object" ||
    typeof user.ouid !== "string" ||
    user.ouid !== ouid ||
    typeof user.nickname !== "string" ||
    !user.nickname.trim()
  ) {
    throw new FcOnlineApiError(
      "FC ONLINE API 사용자 정보 응답이 올바르지 않습니다.",
      502,
      "INVALID_RESPONSE",
    );
  }

  const validMatchIds = Array.from(
    new Set(
      rawMatchIds
        .filter((matchId): matchId is string => typeof matchId === "string")
        .map((matchId) => matchId.trim())
        .filter(Boolean),
    ),
  );

  if (rawMatchIds.length > 0 && validMatchIds.length === 0) {
    throw new FcOnlineApiError(
      "FC ONLINE API 경기 목록 응답이 올바르지 않습니다.",
      502,
      "INVALID_RESPONSE",
    );
  }

  const matchIds = validMatchIds.slice(0, limit);

  if (matchIds.length === 0) {
    throw new SearchRouteError(
      "empty-result",
      `최근 ${DEFAULT_MATCH_TYPE_LABEL} 기록을 찾지 못했습니다.`,
      404,
    );
  }

  const detailResult = await collectMatchDetails(client, matchIds, ouid);
  const result = normalizeSearchResult(
    {
      ...user,
      ouid,
      nickname: user.nickname.trim(),
    },
    detailResult.details,
  );

  if (result.matches.length === 0) {
    throw new SearchRouteError(
      "empty-result",
      `최근 ${DEFAULT_MATCH_TYPE_LABEL} 상세 정보를 정리할 수 없습니다.`,
      404,
    );
  }

  const analysis = analyzePlayStyle(result.matches, matchIds.length);

  return {
    payload: {
      ...result,
      analysis,
      recommendation: recommendTactic(analysis),
    },
    cacheable:
      detailResult.complete &&
      matchIds.length === rawMatchIds.length &&
      result.matches.length === matchIds.length,
  };
}

async function collectMatchDetails(client: FcOnlineClient, matchIds: string[], ouid: string) {
  const details: FcOnlineMatchDetailResponse[] = [];
  let complete = true;
  let firstError: unknown;
  let terminalError: unknown;

  for (let index = 0; index < matchIds.length; index += 1) {
    try {
      const detail = await client.getMatchDetail(matchIds[index]);

      if (
        !detail ||
        typeof detail !== "object" ||
        Array.isArray(detail) ||
        !Array.isArray(detail.matchInfo) ||
        detail.matchInfo.length === 0 ||
        !detail.matchInfo.every(
          (info) => info && typeof info === "object" && typeof info.ouid === "string",
        )
      ) {
        throw new FcOnlineApiError(
          "FC ONLINE API 경기 상세 응답이 올바르지 않습니다.",
          502,
          "INVALID_RESPONSE",
        );
      }

      const expectedMatchId = matchIds[index];
      const responseMatchId =
        typeof detail.matchId === "string" ? detail.matchId.trim() : "";

      if (responseMatchId && responseMatchId !== expectedMatchId) {
        throw new FcOnlineApiError(
          "FC ONLINE API 경기 상세 식별자가 요청과 일치하지 않습니다.",
          502,
          "MISMATCHED_MATCH_ID",
        );
      }

      if (!detail.matchInfo.some((info) => info.ouid === ouid)) {
        throw new FcOnlineApiError(
          "FC ONLINE API 경기 상세에 조회 사용자가 없습니다.",
          502,
          "MISSING_SEARCHED_USER",
        );
      }

      details.push({ ...detail, matchId: expectedMatchId });
    } catch (error) {
      complete = false;
      firstError ??= error;
      logDetailFailure(error, index);

      if (shouldStopDetailRequests(error)) {
        terminalError = error;
        break;
      }
    }

    if (index < matchIds.length - 1) {
      await wait(REQUEST_DELAY_MS);
    }
  }

  if (details.length === 0 && firstError) {
    throw normalizeMatchDetailFailure(terminalError || firstError);
  }

  return { details, complete };
}

function normalizeMatchDetailFailure(error: unknown) {
  if (
    error instanceof FcOnlineApiError &&
    (error.status === 400 || error.status === 404)
  ) {
    return new FcOnlineApiError(
      "FC ONLINE API 경기 상세 정보를 불러오지 못했습니다.",
      502,
      "MATCH_DETAIL_UNAVAILABLE",
    );
  }

  return error;
}

function shouldStopDetailRequests(error: unknown) {
  return (
    error instanceof FcOnlineApiError &&
    (error.status === 429 ||
      error.status === 503 ||
      error.status === 504 ||
      error.code === "REQUEST_TIMEOUT")
  );
}

function normalizeExternalFailure(error: unknown): SearchOutcome {
  if (!(error instanceof FcOnlineApiError)) {
    return {
      ok: false,
      type: "external-api",
      message: `${DEFAULT_MATCH_TYPE_LABEL} 정보를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.`,
      status: 502,
    };
  }

  if (error.code === "REQUEST_TIMEOUT" || error.status === 504) {
    return {
      ok: false,
      type: "external-api",
      message: "FC ONLINE 응답이 지연되고 있습니다. 잠시 뒤 다시 시도해 주세요.",
      status: 504,
    };
  }

  if (error.status === 400) {
    return {
      ok: false,
      type: "external-api",
      message: "닉네임 또는 요청 값이 올바르지 않습니다.",
      status: 400,
    };
  }

  if (error.status === 404) {
    return {
      ok: false,
      type: "external-api",
      message: "FC ONLINE 사용자를 찾지 못했습니다.",
      status: 404,
    };
  }

  if (error.status === 429) {
    return {
      ok: false,
      type: "external-api",
      message: "FC ONLINE 조회 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.",
      status: 429,
    };
  }

  if (error.status === 503) {
    return {
      ok: false,
      type: "external-api",
      message: "현재 FC ONLINE 서비스를 이용하기 어렵습니다. 잠시 뒤 다시 시도해 주세요.",
      status: 503,
    };
  }

  return {
    ok: false,
    type: "external-api",
    message: `${DEFAULT_MATCH_TYPE_LABEL} 정보를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.`,
    status: 502,
  };
}

function logSearchFailure(error: unknown, limit: number) {
  if (error instanceof FcOnlineApiError) {
    console.error("[api/search] FC ONLINE request failed.", {
      code: error.code,
      limit,
      message: error.message,
      status: error.status,
    });
    return;
  }

  console.error("[api/search] Unexpected search failure.", {
    limit,
    message: error instanceof Error ? error.message : "Unknown error",
  });
}

function logDetailFailure(error: unknown, matchIndex: number) {
  console.warn("[api/search] Skipping an unavailable match detail.", {
    code: error instanceof FcOnlineApiError ? error.code : undefined,
    matchIndex,
    message: error instanceof Error ? error.message : "Unknown error",
    status: error instanceof FcOnlineApiError ? error.status : undefined,
  });
}

function readCache(cacheKey: string, now: number) {
  cleanupCache(now);
  const entry = responseCache.get(cacheKey);

  if (!entry) {
    return null;
  }

  responseCache.delete(cacheKey);
  responseCache.set(cacheKey, entry);
  return entry.payload;
}

function writeCache(cacheKey: string, payload: SearchPayload, now: number) {
  cleanupCache(now);
  responseCache.delete(cacheKey);

  while (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value as string | undefined;

    if (oldestKey === undefined) {
      break;
    }

    responseCache.delete(oldestKey);
  }

  responseCache.set(cacheKey, { expiresAt: now + CACHE_TTL_MS, payload });
}

function cleanupCache(now: number) {
  for (const [key, entry] of responseCache) {
    if (entry.expiresAt <= now) {
      responseCache.delete(key);
    }
  }
}

function consumeIpRequestBudget(request: Request, now: number) {
  const clientIp = readTrustedClientIp(request);

  if (!clientIp) {
    return null;
  }

  return consumeRateLimit(`ip:${clientIp}`, IP_RATE_LIMIT, now);
}

function reserveUpstreamCallBudget(now: number, upstreamCallCost: number) {
  return consumeRateLimit(
    GLOBAL_RATE_LIMIT_KEY,
    GLOBAL_UPSTREAM_CALL_BUDGET,
    now,
    upstreamCallCost,
  );
}

function consumeRateLimit(key: string, maximum: number, now: number, cost = 1) {
  cleanupRateLimits(now);
  const entry = rateLimitEntries.get(key);

  if (!entry || now - entry.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    ensureRateLimitCapacity();
    rateLimitEntries.set(key, { count: cost, windowStartedAt: now });
    return null;
  }

  rateLimitEntries.delete(key);
  rateLimitEntries.set(key, entry);

  if (entry.count + cost > maximum) {
    return Math.max(
      1,
      Math.ceil((entry.windowStartedAt + RATE_LIMIT_WINDOW_MS - now) / 1_000),
    );
  }

  entry.count += cost;
  return null;
}

function estimateUpstreamCallCost(limit: number) {
  return 3 + limit;
}

function cleanupRateLimits(now: number) {
  for (const [key, entry] of rateLimitEntries) {
    if (now - entry.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
      rateLimitEntries.delete(key);
    }
  }
}

function ensureRateLimitCapacity() {
  while (rateLimitEntries.size >= MAX_RATE_LIMIT_ENTRIES) {
    const oldestKey = Array.from(rateLimitEntries.keys()).find(
      (key) => key !== GLOBAL_RATE_LIMIT_KEY,
    );

    if (!oldestKey) {
      break;
    }

    rateLimitEntries.delete(oldestKey);
  }
}

function readTrustedClientIp(request: Request) {
  // Forwarded IP headers are attacker-controlled unless the deployment proxy overwrites them.
  // They are only used after an explicit deployment opt-in.
  if (process.env.FC_ONLINE_TRUST_PROXY_HEADERS !== "true") {
    return null;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const candidates = [forwardedFor?.split(",")[0], request.headers.get("x-real-ip")];

  for (const rawCandidate of candidates) {
    const candidate = rawCandidate?.trim();

    if (candidate && isIP(candidate) !== 0) {
      return candidate;
    }
  }

  return null;
}

function clampLimit(value: string | null) {
  const parsed = Number(value || DEFAULT_LIMIT);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), MAX_LIMIT);
}

function readDefaultLimit() {
  const parsed = Number(process.env.FC_ONLINE_DEFAULT_LIMIT || "5");

  if (!Number.isFinite(parsed)) {
    return 5;
  }

  return Math.min(Math.max(Math.floor(parsed), 1), MAX_LIMIT);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createErrorResponse(
  type: ApiErrorType,
  message: string,
  status: number,
  headers?: HeadersInit,
) {
  return NextResponse.json({ type, message, status }, { status, headers });
}
