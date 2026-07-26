import { describe, expect, it } from "vitest";

import { buildRecentSquadProfile, type SquadMetadataLookup } from "./squadProfile";
import type { NormalizedMatch, NormalizedMatchPlayer } from "./types";

const metadata: SquadMetadataLookup = {
  status: "available",
  fetchedAt: "2026-07-26T00:00:00.000Z",
  getPlayerName: (spId) => ({ 225136606: "합성 선수 A", 999000001: "합성 선수 B" })[spId] ?? null,
  getSeason: (spId) =>
    spId === 225136606
      ? { name: "합성 시즌", imageUrl: "https://ssl.nexon.com/season.png" }
      : null,
  getPositionName: (positionCode) => ({ 13: "CM", 25: "ST", 28: "SUB" })[positionCode] ?? null,
};

describe("buildRecentSquadProfile", () => {
  it("spId와 강화 등급별로 최근 사용 카드와 경기 활약을 집계한다", () => {
    const matches = [
      createMatch("newer", "2026-07-26T10:00:00Z", [
        createPlayer(225136606, 5, 25, { rating: 8, goals: 1, assists: 0 }),
        createPlayer(225136606, 5, 25, { rating: 1, goals: 9, assists: 9 }),
        createPlayer(999000001, 1, 28, { rating: null, goals: 0, assists: 1 }),
      ]),
      createMatch("older", "2026-07-25T10:00:00Z", [
        createPlayer(225136606, 5, 28, { rating: 6, goals: 0, assists: 2 }),
        createPlayer(225136606, 6, 13, { rating: 7, goals: 0, assists: 0 }),
      ]),
    ];

    const result = buildRecentSquadProfile(matches, 3, metadata);

    expect(result).toMatchObject({
      source: "recent-official-matches",
      requestedMatchCount: 3,
      analyzedMatchCount: 2,
      matchesWithPlayerData: 2,
      metadataStatus: "available",
      recommendationImpact: { applied: false },
    });
    expect(result.cards).toHaveLength(3);
    expect(result.cards[0]).toMatchObject({
      spId: 225136606,
      spGrade: 5,
      name: "합성 선수 A",
      seasonName: "합성 시즌",
      positionCode: 25,
      positionName: "ST",
      listedMatches: 2,
      starterMatches: 1,
      substituteListings: 1,
      averageRating: 7,
      goals: 1,
      assists: 2,
      lastUsedAt: "2026-07-26T10:00:00Z",
    });
    expect(result.cards[0].officialDataCenterUrl).toContain(
      "spid=225136606&n1Strong=5",
    );
    expect(result.cards[0].playerImageUrl).toBe(
      "https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p225136606.png",
    );
    expect(result.cards[0].playerFallbackImageUrl).toBe(
      "https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/players/p225136606.png",
    );
    expect(result.cards.map((card) => [card.spId, card.spGrade])).toEqual([
      [225136606, 5],
      [225136606, 6],
      [999000001, 1],
    ]);
  });

  it("메타데이터와 선수 배열이 없어도 기존 추천용 응답을 만들 수 있다", () => {
    const unavailableMetadata: SquadMetadataLookup = {
      status: "unavailable",
      fetchedAt: null,
      getPlayerName: () => null,
      getSeason: () => null,
      getPositionName: () => null,
    };

    const result = buildRecentSquadProfile(
      [createMatch("without-players", null, [])],
      1,
      unavailableMetadata,
    );

    expect(result).toMatchObject({
      analyzedMatchCount: 1,
      matchesWithPlayerData: 0,
      metadataStatus: "unavailable",
      metadataFetchedAt: null,
      cards: [],
      recommendationImpact: {
        applied: false,
        reason: expect.stringContaining("경기 성향"),
      },
    });
  });

  it("동률 포지션은 더 최근 경기의 포지션을 대표값으로 선택한다", () => {
    const result = buildRecentSquadProfile(
      [
        createMatch("newer", "2026-07-26T10:00:00Z", [
          createPlayer(225136606, 5, 13),
        ]),
        createMatch("older", "2026-07-25T10:00:00Z", [
          createPlayer(225136606, 5, 25),
        ]),
      ],
      2,
      metadata,
    );

    expect(result.cards[0]).toMatchObject({ positionCode: 13, positionName: "CM" });
  });
});

function createMatch(
  matchId: string,
  playedAt: string | null,
  players: NormalizedMatchPlayer[],
): NormalizedMatch {
  return {
    matchId,
    playedAt,
    matchType: 50,
    result: "알 수 없음",
    opponentNickname: "합성 상대",
    score: { for: null, against: null },
    stats: {
      possession: null,
      shots: null,
      effectiveShots: null,
      passSuccessRate: null,
      tackleSuccessRate: null,
      dribbles: null,
    },
    players,
  };
}

function createPlayer(
  spId: number,
  spGrade: number,
  spPosition: number,
  performance: Partial<NormalizedMatchPlayer["performance"]> = {},
): NormalizedMatchPlayer {
  return {
    spId,
    spGrade,
    spPosition,
    performance: {
      rating: null,
      goals: null,
      assists: null,
      shots: null,
      effectiveShots: null,
      passesAttempted: null,
      passesCompleted: null,
      tacklesAttempted: null,
      tacklesCompleted: null,
      interceptions: null,
      blocks: null,
      ...performance,
    },
  };
}
