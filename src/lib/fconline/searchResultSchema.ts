import type {
  AnalysisConfidence,
  NormalizedMatch,
  PlayerPosition,
  PlayStyleAnalysis,
  PlayStyleLabel,
  RecentSquadCard,
  RecentSquadProfile,
  SearchResult,
  SearchResultWithAnalysis,
  TacticApplicationGuide,
  TacticApplicationGuideSet,
  TacticInstructionAssignment,
  TacticRecommendation,
  TacticRecommendationSet,
} from "./types";
import { getPositionAssignmentMatchKind } from "../tactics/tacticApplicationGuide";
import {
  isTacticRecommendationSet,
  PLAYER_POSITIONS,
} from "../tactics/tacticSchema";

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
    !isTacticRecommendationSet(value.recommendation) ||
    (value.squadProfile !== undefined &&
      !isRecentSquadProfile(value.squadProfile, value.matches)) ||
    (value.tacticApplicationGuides !== undefined &&
      !isTacticApplicationGuideSet(
        value.tacticApplicationGuides,
        value.recommendation,
        value.matches,
      ))
  ) {
    return false;
  }

  return (
    value.analysis.matchCount === value.matches.length &&
    isSummary(value.summary, value.matches)
  );
}

function isTacticApplicationGuideSet(
  value: unknown,
  recommendation: TacticRecommendationSet,
  matches: NormalizedMatch[],
): value is TacticApplicationGuideSet {
  if (
    !isRecord(value) ||
    !isTacticApplicationGuide(value.primary, recommendation.primary, matches) ||
    !isTacticApplicationGuide(value.alternative, recommendation.alternative, matches)
  ) {
    return false;
  }

  return (
    value.primary.referenceMatchId === value.alternative.referenceMatchId &&
    value.primary.referencePlayedAt === value.alternative.referencePlayedAt
  );
}

function isTacticApplicationGuide(
  value: unknown,
  recommendation: TacticRecommendation,
  matches: NormalizedMatch[],
): value is TacticApplicationGuide {
  if (
    !isRecord(value) ||
    value.recommendationConfigHash !== recommendation.metadata.configHash ||
    value.templateId !== recommendation.metadata.templateId ||
    !isStringOrNull(value.referenceMatchId) ||
    !isStringOrNull(value.referencePlayedAt) ||
    !isNonNegativeInteger(value.assignedSlots) ||
    !isNonNegativeInteger(value.totalSlots) ||
    !isRecord(value.validation) ||
    value.validation.formation !== "unconfirmed" ||
    value.validation.personalTactics !== "unconfirmed" ||
    !Array.isArray(value.assignments)
  ) {
    return false;
  }

  const expectedSlots = recommendation.playerInstructions.flatMap(
    (instruction, instructionIndex) =>
      instruction.positions.map((position) => ({ instructionIndex, position })),
  );

  if (
    value.totalSlots !== expectedSlots.length ||
    value.assignments.length !== expectedSlots.length ||
    value.assignedSlots > value.totalSlots
  ) {
    return false;
  }

  const referenceMatch =
    value.referenceMatchId === null
      ? null
      : matches.find((match) => match.matchId === value.referenceMatchId) ?? null;

  if (
    (value.referenceMatchId === null && value.referencePlayedAt !== null) ||
    (value.referenceMatchId !== null && referenceMatch === null) ||
    (referenceMatch !== null && referenceMatch.playedAt !== value.referencePlayedAt)
  ) {
    return false;
  }

  const assignedCardKeys = new Set<string>();
  let actualAssignedSlots = 0;

  for (let index = 0; index < value.assignments.length; index += 1) {
    const assignment = value.assignments[index];
    const expectedSlot = expectedSlots[index];

    if (
      !isTacticInstructionAssignment(
        assignment,
        expectedSlot.instructionIndex,
        expectedSlot.position,
        referenceMatch,
      )
    ) {
      return false;
    }

    if (assignment.card !== null) {
      actualAssignedSlots += 1;
      const cardKey = `${assignment.card.spId}:${assignment.card.spGrade ?? "unknown"}`;

      if (assignedCardKeys.has(cardKey)) {
        return false;
      }

      assignedCardKeys.add(cardKey);
    }
  }

  return actualAssignedSlots === value.assignedSlots;
}

function isTacticInstructionAssignment(
  value: unknown,
  expectedInstructionIndex: number,
  expectedPosition: PlayerPosition,
  referenceMatch: NormalizedMatch | null,
): value is TacticInstructionAssignment {
  if (
    !isRecord(value) ||
    value.instructionIndex !== expectedInstructionIndex ||
    value.position !== expectedPosition ||
    !isEnumValue(value.matchKind, [
      "exact-recent-position",
      "compatible-position",
      "unassigned",
    ] as const) ||
    !(value.observedPosition === null || isPlayerPosition(value.observedPosition)) ||
    !(value.observedPositionCode === null || isNonNegativeInteger(value.observedPositionCode))
  ) {
    return false;
  }

  if (value.matchKind === "unassigned") {
    return (
      value.card === null &&
      value.observedPosition === null &&
      value.observedPositionCode === null
    );
  }

  if (
    !isRecord(value.card) ||
    !isPositiveSafeInteger(value.card.spId) ||
    !(value.card.spGrade === null || isIntegerInRange(value.card.spGrade, 1, 13)) ||
    !isPlayerPosition(value.observedPosition) ||
    !isNonNegativeInteger(value.observedPositionCode) ||
    referenceMatch === null ||
    getPositionAssignmentMatchKind(value.observedPosition, expectedPosition) !== value.matchKind
  ) {
    return false;
  }

  const card = value.card;
  const observedPositionCode = value.observedPositionCode;
  const referencePlayers = (referenceMatch as unknown as { players?: unknown }).players;

  // The browser parser cannot refetch the official code-to-name metadata. It can still bind
  // the declared position to the exact raw player row that the server used for this guide.
  return (
    Array.isArray(referencePlayers) &&
    referencePlayers.some(
      (player) =>
        isRecord(player) &&
        player.spId === card.spId &&
        player.spGrade === card.spGrade &&
        player.spPosition === observedPositionCode,
    )
  );
}

function isPlayerPosition(value: unknown): value is PlayerPosition {
  return typeof value === "string" && PLAYER_POSITIONS.includes(value as PlayerPosition);
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
    !isRecord(value.stats) ||
    (value.players !== undefined && !isNormalizedMatchPlayers(value.players))
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

function isNormalizedMatchPlayers(value: unknown) {
  return Array.isArray(value) && value.every(isNormalizedMatchPlayer);
}

function isNormalizedMatchPlayer(value: unknown) {
  if (
    !isRecord(value) ||
    !isPositiveSafeInteger(value.spId) ||
    !(value.spGrade === null || isIntegerInRange(value.spGrade, 1, 13)) ||
    !(value.spPosition === null || isNonNegativeInteger(value.spPosition)) ||
    !isRecord(value.performance)
  ) {
    return false;
  }

  const performance = value.performance;

  return [
    "rating",
    "goals",
    "assists",
    "shots",
    "effectiveShots",
    "passesAttempted",
    "passesCompleted",
    "tacklesAttempted",
    "tacklesCompleted",
    "interceptions",
    "blocks",
  ].every((key) => isNonNegativeFiniteNumberOrNull(performance[key]));
}

function isRecentSquadProfile(
  value: unknown,
  matches: NormalizedMatch[],
): value is RecentSquadProfile {
  if (
    !isRecord(value) ||
    value.source !== "recent-official-matches" ||
    !isNonNegativeInteger(value.requestedMatchCount) ||
    !isNonNegativeInteger(value.analyzedMatchCount) ||
    value.analyzedMatchCount !== matches.length ||
    value.requestedMatchCount < value.analyzedMatchCount ||
    !isNonNegativeInteger(value.matchesWithPlayerData) ||
    value.matchesWithPlayerData > value.analyzedMatchCount ||
    !isEnumValue(value.metadataStatus, ["available", "unavailable"] as const) ||
    !isStringOrNull(value.metadataFetchedAt) ||
    !Array.isArray(value.cards) ||
    !isRecord(value.recommendationImpact) ||
    value.recommendationImpact.applied !== false ||
    typeof value.recommendationImpact.reason !== "string"
  ) {
    return false;
  }

  const matchesWithPlayerData = value.matchesWithPlayerData;

  if (!value.cards.every((card) => isRecentSquadCard(card, matchesWithPlayerData))) {
    return false;
  }

  const actualMatchesWithPlayerData = matches.filter((match) => {
    const players = (match as unknown as { players?: unknown }).players;
    return Array.isArray(players) && players.length > 0;
  }).length;

  if (matchesWithPlayerData !== actualMatchesWithPlayerData) {
    return false;
  }

  const cardKeys = value.cards.map((card) => `${card.spId}:${card.spGrade ?? "unknown"}`);
  return new Set(cardKeys).size === cardKeys.length;
}

function isRecentSquadCard(
  value: unknown,
  matchesWithPlayerData: number,
): value is RecentSquadCard {
  if (
    !isRecord(value) ||
    !isPositiveSafeInteger(value.spId) ||
    !(value.spGrade === null || isIntegerInRange(value.spGrade, 1, 13)) ||
    !isStringOrNull(value.name) ||
    !isStringOrNull(value.seasonName) ||
    !isStringOrNull(value.seasonImageUrl) ||
    !(value.positionCode === null || isNonNegativeInteger(value.positionCode)) ||
    !isStringOrNull(value.positionName) ||
    !isPositiveSafeInteger(value.listedMatches) ||
    value.listedMatches > matchesWithPlayerData ||
    !isNonNegativeInteger(value.starterMatches) ||
    !isNonNegativeInteger(value.substituteListings) ||
    !isNonNegativeInteger(value.unclassifiedListings) ||
    value.starterMatches + value.substituteListings + value.unclassifiedListings !==
      value.listedMatches ||
    !isFiniteNumberOrNull(value.averageRating) ||
    !isNonNegativeFiniteNumber(value.goals) ||
    !isNonNegativeFiniteNumber(value.assists) ||
    !isStringOrNull(value.lastUsedAt) ||
    typeof value.playerImageUrl !== "string" ||
    typeof value.playerFallbackImageUrl !== "string" ||
    !isStringOrNull(value.officialDataCenterUrl)
  ) {
    return false;
  }

  const spId = value.spId;
  const spGrade = value.spGrade;
  const officialDataCenterUrl = value.officialDataCenterUrl;

  return (
    (value.seasonImageUrl === null || isAllowedNexonAssetUrl(value.seasonImageUrl)) &&
    isExpectedPlayerImageUrl(value.playerImageUrl, spId, "playersAction") &&
    isExpectedPlayerImageUrl(value.playerFallbackImageUrl, spId, "players") &&
    (officialDataCenterUrl === null ||
      (spGrade !== null &&
        isExpectedDataCenterUrl(officialDataCenterUrl, spId, spGrade)))
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

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || isNonNegativeFiniteNumber(value);
}

function isNumberInRange(value: unknown, minimum: number, maximum: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isAllowedNexonAssetUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["fco.dn.nexoncdn.co.kr", "ssl.nexon.com"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function isExpectedPlayerImageUrl(
  value: string,
  spId: number,
  directory: "players" | "playersAction",
) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "fco.dn.nexoncdn.co.kr" &&
      url.pathname === `/live/externalAssets/common/${directory}/p${spId}.png`
    );
  } catch {
    return false;
  }
}

function isExpectedDataCenterUrl(value: string, spId: number, spGrade: number) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "fconline.nexon.com" &&
      url.pathname.toLowerCase() === "/datacenter/playerinfo" &&
      url.searchParams.get("spid") === String(spId) &&
      url.searchParams.get("n1Strong") === String(spGrade)
    );
  } catch {
    return false;
  }
}
