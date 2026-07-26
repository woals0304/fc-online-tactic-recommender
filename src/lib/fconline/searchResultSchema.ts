import type {
  AnalysisConfidence,
  NormalizedMatch,
  PlayStyleAnalysis,
  PlayStyleLabel,
  SearchResult,
  SearchResultWithAnalysis,
} from "./types";
import { isTacticRecommendationSet } from "../tactics/tacticSchema";

type CompatibleSearchSummary = Omit<SearchResult["summary"], "unknown"> & {
  unknown?: number;
};

export type CompatiblePlayStyleAnalysis = Omit<PlayStyleAnalysis, "confidence"> & {
  confidence?: AnalysisConfidence;
};

export type SearchResultWithAnalysisPayload = Omit<
  SearchResultWithAnalysis,
  "summary" | "analysis"
> & {
  summary: CompatibleSearchSummary;
  analysis: CompatiblePlayStyleAnalysis;
};

const MATCH_RESULTS = ["승리", "무승부", "패배", "알 수 없음"] as const;
const PLAY_STYLE_LABELS = [
  "공격적",
  "수비 불안",
  "득점력 높음",
  "점유율 지향",
  "슈팅 빈도 높음",
] as const satisfies readonly PlayStyleLabel[];
const CONFIDENCE_LEVELS = ["low", "medium", "high"] as const;

export function isSearchResultWithAnalysis(
  value: unknown,
): value is SearchResultWithAnalysisPayload {
  if (
    !isRecord(value) ||
    !isUser(value.user) ||
    !isNormalizedMatches(value.matches) ||
    !isPlayStyleAnalysis(value.analysis) ||
    !isTacticRecommendationSet(value.recommendation)
  ) {
    return false;
  }

  return (
    value.analysis.matchCount === value.matches.length &&
    isSummary(value.summary, value.matches)
  );
}

function isUser(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.ouid === "string" &&
    typeof value.nickname === "string" &&
    isFiniteNumberOrNull(value.level)
  );
}

function isSummary(value: unknown, matches: NormalizedMatch[]) {
  if (
    !isRecord(value) ||
    typeof value.matchType !== "string" ||
    !isNonNegativeInteger(value.totalMatches) ||
    !isNonNegativeInteger(value.wins) ||
    !isNonNegativeInteger(value.draws) ||
    !isNonNegativeInteger(value.losses) ||
    (value.unknown !== undefined && !isNonNegativeInteger(value.unknown))
  ) {
    return false;
  }

  const expectedWins = matches.filter((match) => match.result === "승리").length;
  const expectedDraws = matches.filter((match) => match.result === "무승부").length;
  const expectedLosses = matches.filter((match) => match.result === "패배").length;
  const expectedUnknown = matches.filter((match) => match.result === "알 수 없음").length;

  return (
    value.totalMatches === matches.length &&
    value.wins === expectedWins &&
    value.draws === expectedDraws &&
    value.losses === expectedLosses &&
    (value.unknown === undefined || value.unknown === expectedUnknown)
  );
}

function isNormalizedMatches(value: unknown): value is NormalizedMatch[] {
  return Array.isArray(value) && value.every(isNormalizedMatch);
}

function isNormalizedMatch(value: unknown): value is NormalizedMatch {
  if (
    !isRecord(value) ||
    typeof value.matchId !== "string" ||
    !isStringOrNull(value.playedAt) ||
    !isFiniteNumberOrNull(value.matchType) ||
    !isEnumValue(value.result, MATCH_RESULTS) ||
    typeof value.opponentNickname !== "string" ||
    !isRecord(value.score) ||
    !isRecord(value.stats)
  ) {
    return false;
  }

  return (
    isFiniteNumberOrNull(value.score.for) &&
    isFiniteNumberOrNull(value.score.against) &&
    isFiniteNumberOrNull(value.stats.possession) &&
    isFiniteNumberOrNull(value.stats.shots) &&
    isFiniteNumberOrNull(value.stats.effectiveShots) &&
    isFiniteNumberOrNull(value.stats.passSuccessRate) &&
    isFiniteNumberOrNull(value.stats.tackleSuccessRate) &&
    isFiniteNumberOrNull(value.stats.dribbles)
  );
}

function isPlayStyleAnalysis(value: unknown): value is CompatiblePlayStyleAnalysis {
  if (
    !isRecord(value) ||
    !isNonNegativeInteger(value.matchCount) ||
    !isNonNegativeInteger(value.requestedMatchCount) ||
    value.requestedMatchCount < value.matchCount ||
    !Array.isArray(value.styles) ||
    !value.styles.every(isPlayStyleResult)
  ) {
    return false;
  }

  return value.confidence === undefined || isAnalysisConfidence(value.confidence);
}

function isPlayStyleResult(value: unknown) {
  return (
    isRecord(value) &&
    isEnumValue(value.label, PLAY_STYLE_LABELS) &&
    (value.score === null || isNumberInRange(value.score, 0, 100)) &&
    typeof value.reason === "string"
  );
}

function isAnalysisConfidence(value: unknown): value is AnalysisConfidence {
  return (
    isRecord(value) &&
    isEnumValue(value.level, CONFIDENCE_LEVELS) &&
    isNumberInRange(value.coverage, 0, 100) &&
    typeof value.message === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNumberInRange(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}
