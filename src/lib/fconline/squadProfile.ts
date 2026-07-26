import type {
  NormalizedMatch,
  RecentSquadCard,
  RecentSquadProfile,
} from "./types";
import {
  createOfficialPlayerImageUrl,
  createOfficialPlayerInfoUrl,
} from "./officialMetadata";

export type SquadMetadataLookup = {
  status: "available" | "unavailable";
  fetchedAt: string | null;
  getPlayerName(spId: number): string | null;
  getSeason(spId: number): { name: string; imageUrl: string | null } | null;
  getPositionName(positionCode: number): string | null;
};

type CardAccumulator = {
  spId: number;
  spGrade: number | null;
  listedMatches: number;
  starterMatches: number;
  substituteListings: number;
  unclassifiedListings: number;
  goals: number;
  assists: number;
  ratingTotal: number;
  ratingSamples: number;
  lastUsedAt: string | null;
  lastUsedOrder: number;
  positions: Map<number, { count: number; lastUsedOrder: number }>;
};

export function buildRecentSquadProfile(
  matches: NormalizedMatch[],
  requestedMatchCount: number,
  metadata: SquadMetadataLookup,
): RecentSquadProfile {
  const cards = new Map<string, CardAccumulator>();
  let matchesWithPlayerData = 0;

  matches.forEach((match, matchIndex) => {
    if (match.players.length === 0) {
      return;
    }

    matchesWithPlayerData += 1;
    const cardsSeenInMatch = new Set<string>();

    for (const player of match.players) {
      const key = createCardKey(player.spId, player.spGrade);

      if (cardsSeenInMatch.has(key)) {
        continue;
      }

      cardsSeenInMatch.add(key);
      const accumulator = cards.get(key) || createAccumulator(player.spId, player.spGrade);
      const lastUsedOrder = getLastUsedOrder(match.playedAt, matchIndex);

      accumulator.listedMatches += 1;
      accumulator.goals += player.performance.goals ?? 0;
      accumulator.assists += player.performance.assists ?? 0;

      if (player.performance.rating !== null) {
        accumulator.ratingTotal += player.performance.rating;
        accumulator.ratingSamples += 1;
      }

      if (lastUsedOrder >= accumulator.lastUsedOrder) {
        accumulator.lastUsedOrder = lastUsedOrder;
        accumulator.lastUsedAt = match.playedAt;
      }

      if (player.spPosition === null) {
        accumulator.unclassifiedListings += 1;
      } else {
        const positionName = metadata.getPositionName(player.spPosition);

        if (positionName === null) {
          accumulator.unclassifiedListings += 1;
        } else if (positionName.toUpperCase() === "SUB") {
          accumulator.substituteListings += 1;
        } else {
          accumulator.starterMatches += 1;
        }

        const position = accumulator.positions.get(player.spPosition) || {
          count: 0,
          lastUsedOrder: Number.NEGATIVE_INFINITY,
        };
        position.count += 1;
        position.lastUsedOrder = Math.max(position.lastUsedOrder, lastUsedOrder);
        accumulator.positions.set(player.spPosition, position);
      }

      cards.set(key, accumulator);
    }
  });

  const normalizedCards = Array.from(cards.values())
    .map((card) => toRecentSquadCard(card, metadata))
    .sort(compareCards);

  return {
    source: "recent-official-matches",
    requestedMatchCount: normalizeRequestedMatchCount(requestedMatchCount),
    analyzedMatchCount: matches.length,
    matchesWithPlayerData,
    metadataStatus: metadata.status,
    metadataFetchedAt: metadata.fetchedAt,
    cards: normalizedCards,
    recommendationImpact: {
      applied: false,
      reason:
        normalizedCards.length === 0
          ? "최근 경기 응답에 선수 명단이 없어 기존 경기 성향만 추천에 사용했습니다."
          : "정식 Open API가 카드 고유 능력치를 제공하지 않아 선수 카드는 확인용으로만 표시하고, 추천은 기존 경기 성향만 사용했습니다.",
    },
  };
}

function createAccumulator(spId: number, spGrade: number | null): CardAccumulator {
  return {
    spId,
    spGrade,
    listedMatches: 0,
    starterMatches: 0,
    substituteListings: 0,
    unclassifiedListings: 0,
    goals: 0,
    assists: 0,
    ratingTotal: 0,
    ratingSamples: 0,
    lastUsedAt: null,
    lastUsedOrder: Number.NEGATIVE_INFINITY,
    positions: new Map(),
  };
}

function toRecentSquadCard(
  accumulator: CardAccumulator,
  metadata: SquadMetadataLookup,
): RecentSquadCard {
  const positionCode = getPrimaryPositionCode(accumulator.positions);
  const season = metadata.getSeason(accumulator.spId);

  return {
    spId: accumulator.spId,
    spGrade: accumulator.spGrade,
    name: metadata.getPlayerName(accumulator.spId),
    seasonName: season?.name ?? null,
    seasonImageUrl: season?.imageUrl ?? null,
    positionCode,
    positionName:
      positionCode === null ? null : metadata.getPositionName(positionCode),
    listedMatches: accumulator.listedMatches,
    starterMatches: accumulator.starterMatches,
    substituteListings: accumulator.substituteListings,
    unclassifiedListings: accumulator.unclassifiedListings,
    averageRating:
      accumulator.ratingSamples === 0
        ? null
        : roundToOneDecimal(accumulator.ratingTotal / accumulator.ratingSamples),
    goals: accumulator.goals,
    assists: accumulator.assists,
    lastUsedAt: accumulator.lastUsedAt,
    playerImageUrl: getOfficialPlayerImageUrl(accumulator.spId, "action"),
    playerFallbackImageUrl: getOfficialPlayerImageUrl(accumulator.spId, "player"),
    officialDataCenterUrl: getOfficialDataCenterUrl(accumulator.spId, accumulator.spGrade),
  };
}

function getOfficialPlayerImageUrl(spId: number, variant: "player" | "action") {
  const url = createOfficialPlayerImageUrl(spId, variant);

  if (!url) {
    throw new Error("정규화된 선수 ID로 공식 이미지 URL을 만들 수 없습니다.");
  }

  return url;
}

function getOfficialDataCenterUrl(spId: number, spGrade: number | null) {
  if (spGrade === null) {
    return null;
  }

  const url = createOfficialPlayerInfoUrl(spId, spGrade);

  if (!url) {
    throw new Error("정규화된 선수 카드로 공식 데이터센터 URL을 만들 수 없습니다.");
  }

  return url;
}

function getPrimaryPositionCode(positions: CardAccumulator["positions"]) {
  let selected: { code: number; count: number; lastUsedOrder: number } | null = null;

  for (const [code, usage] of positions) {
    if (
      selected === null ||
      usage.count > selected.count ||
      (usage.count === selected.count && usage.lastUsedOrder > selected.lastUsedOrder) ||
      (usage.count === selected.count &&
        usage.lastUsedOrder === selected.lastUsedOrder &&
        code < selected.code)
    ) {
      selected = { code, ...usage };
    }
  }

  return selected?.code ?? null;
}

function compareCards(left: RecentSquadCard, right: RecentSquadCard) {
  return (
    right.starterMatches - left.starterMatches ||
    right.listedMatches - left.listedMatches ||
    compareNullableDates(right.lastUsedAt, left.lastUsedAt) ||
    left.spId - right.spId ||
    (left.spGrade ?? 0) - (right.spGrade ?? 0)
  );
}

function compareNullableDates(left: string | null, right: string | null) {
  return normalizeDate(left) - normalizeDate(right);
}

function getLastUsedOrder(playedAt: string | null, matchIndex: number) {
  const parsed = normalizeDate(playedAt);
  return parsed === Number.NEGATIVE_INFINITY ? -matchIndex : parsed;
}

function normalizeDate(value: string | null) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function createCardKey(spId: number, spGrade: number | null) {
  return `${spId}:${spGrade ?? "unknown"}`;
}

function normalizeRequestedMatchCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function roundToOneDecimal(value: number) {
  return Math.round(value * 10) / 10;
}
