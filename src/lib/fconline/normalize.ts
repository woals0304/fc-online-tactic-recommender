import type {
  FcOnlineBasicUserResponse,
  FcOnlineMatchDetailResponse,
  FcOnlineMatchInfo,
  NormalizedMatch,
  SearchResult,
} from "./types";

export const DEFAULT_MATCH_TYPE = 50;
export const DEFAULT_MATCH_TYPE_LABEL = "공식 경기";
const UNKNOWN_MATCH_ID_PREFIX = "unknown-match";

export function normalizeSearchResult(
  user: FcOnlineBasicUserResponse,
  details: FcOnlineMatchDetailResponse[],
): SearchResult {
  const matches = details
    .map((detail, index) => normalizeMatch(user.ouid, detail, index))
    .filter((match): match is NormalizedMatch => Boolean(match));

  return {
    user: {
      ouid: user.ouid,
      nickname: user.nickname,
      level: Number.isFinite(user.level) ? user.level : null,
    },
    summary: {
      matchType: DEFAULT_MATCH_TYPE_LABEL,
      totalMatches: matches.length,
      wins: matches.filter((match) => match.result === "승리").length,
      draws: matches.filter((match) => match.result === "무승부").length,
      losses: matches.filter((match) => match.result === "패배").length,
      unknown: matches.filter((match) => match.result === "알 수 없음").length,
    },
    matches,
  };
}

function normalizeMatch(ouid: string, detail: FcOnlineMatchDetailResponse, detailIndex: number) {
  const matchInfo = detail.matchInfo || [];
  const me = matchInfo.find((info) => info.ouid === ouid);

  if (!me) {
    return null;
  }

  const opponent = matchInfo.find((info) => info.ouid !== ouid);
  const myShoot = me.shoot || {};
  const opponentShoot = opponent?.shoot || {};
  const myPass = me.pass || {};
  const myDefence = me.defence || {};
  const matchDetail = me.matchDetail || {};

  return {
    matchId: normalizeMatchId(detail.matchId, detailIndex),
    playedAt: detail.matchDate || null,
    matchType: typeof detail.matchType === "number" ? detail.matchType : null,
    result: normalizeResult(readString(matchDetail, "matchResult")),
    opponentNickname: opponent?.nickname || "상대 정보 없음",
    score: {
      for: readNumber(myShoot, "goalTotalDisplay") ?? readNumber(myShoot, "goalTotal"),
      against:
        readNumber(opponentShoot, "goalTotalDisplay") ??
        readNumber(opponentShoot, "goalTotal"),
    },
    stats: {
      possession: readNumber(matchDetail, "possession"),
      shots: readNumber(myShoot, "shootTotal"),
      effectiveShots: readNumber(myShoot, "effectiveShootTotal"),
      passSuccessRate: getRate(readNumber(myPass, "passSuccess"), readNumber(myPass, "passTry")),
      tackleSuccessRate: getRate(
        readNumber(myDefence, "tackleSuccess"),
        readNumber(myDefence, "tackleTry"),
      ),
      dribbles: readNumber(matchDetail, "dribble"),
    },
  };
}

function normalizeResult(value: string | null): NormalizedMatch["result"] {
  if (value === "승") {
    return "승리";
  }

  if (value === "무") {
    return "무승부";
  }

  if (value === "패") {
    return "패배";
  }

  return "알 수 없음";
}

function readString(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string) {
  const value = source[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim();

    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function normalizeMatchId(value: string | undefined, detailIndex: number) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  return `${UNKNOWN_MATCH_ID_PREFIX}-${detailIndex + 1}`;
}

function getRate(success: number | null, total: number | null) {
  if (
    success === null ||
    total === null ||
    total <= 0 ||
    success < 0 ||
    success > total
  ) {
    return null;
  }

  return Math.round((success / total) * 1000) / 10;
}
