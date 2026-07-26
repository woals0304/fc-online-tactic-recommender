import { describe, expect, it } from "vitest";

import { analyzePlayStyle } from "../analysis/playStyleAnalyzer";
import { recommendTactic } from "../tactics/tacticRecommender";
import basicUserFixture from "./__fixtures__/success/basic-user.json";
import matchDetailsFixture from "./__fixtures__/success/match-details.json";
import { normalizeSearchResult } from "./normalize";
import { isSearchResultWithAnalysis } from "./searchResultSchema";
import { buildRecentSquadProfile } from "./squadProfile";
import type {
  FcOnlineBasicUserResponse,
  FcOnlineMatchDetailResponse,
  SearchResultWithAnalysis,
} from "./types";

const basicUser = basicUserFixture as FcOnlineBasicUserResponse;
const matchDetails = matchDetailsFixture as FcOnlineMatchDetailResponse[];

describe("isSearchResultWithAnalysis", () => {
  it("정규화·분석·추천 파이프라인이 만든 정상 응답을 승인한다", () => {
    expect(isSearchResultWithAnalysis(createValidResult())).toBe(true);
  });

  it("최근 선수 카드 프로필을 포함한 신규 응답을 승인한다", () => {
    expect(isSearchResultWithAnalysis(createValidResultWithSquad())).toBe(true);
  });

  it("구형 성공 응답의 선택적 unknown과 confidence 누락을 승인한다", () => {
    const legacyResult = structuredClone(createValidResult()) as unknown as {
      summary: { unknown?: number };
      analysis: { confidence?: unknown };
    };

    delete legacyResult.summary.unknown;
    delete legacyResult.analysis.confidence;

    expect(isSearchResultWithAnalysis(legacyResult)).toBe(true);
  });

  it("analysis가 누락된 응답을 거부한다", () => {
    const damaged = structuredClone(createValidResult()) as unknown as Record<string, unknown>;
    delete damaged.analysis;

    expect(isSearchResultWithAnalysis(damaged)).toBe(false);
  });

  it("analysis.styles 원소가 손상된 응답을 거부한다", () => {
    const damaged = structuredClone(createValidResult()) as unknown as {
      analysis: { styles: Array<Record<string, unknown>> };
    };
    damaged.analysis.styles[0].score = "100";

    expect(isSearchResultWithAnalysis(damaged)).toBe(false);
  });

  it("analysis 경기 수가 실제 경기 배열과 다른 응답을 거부한다", () => {
    const damaged = structuredClone(createValidResult());
    damaged.analysis.matchCount += 1;
    damaged.analysis.requestedMatchCount += 1;

    expect(isSearchResultWithAnalysis(damaged)).toBe(false);
  });

  it("matches 원소의 중첩 통계가 손상된 응답을 거부한다", () => {
    const damaged = structuredClone(createValidResult()) as unknown as {
      matches: Array<Record<string, unknown>>;
    };
    delete damaged.matches[0].stats;

    expect(isSearchResultWithAnalysis(damaged)).toBe(false);
  });

  it("요약 집계가 경기 배열과 다른 응답을 거부한다", () => {
    const damaged = structuredClone(createValidResult());
    damaged.summary.wins += 1;

    expect(isSearchResultWithAnalysis(damaged)).toBe(false);
  });

  it("추천 세트가 손상된 응답을 거부한다", () => {
    const damaged = structuredClone(createValidResult()) as unknown as {
      recommendation: { primary: { teamTactics: { offensiveTactics: Record<string, unknown> } } };
    };
    delete damaged.recommendation.primary.teamTactics.offensiveTactics.chanceCreation;

    expect(isSearchResultWithAnalysis(damaged)).toBe(false);
  });

  it("선수 카드 링크가 공식 출처가 아니거나 집계 경기 수가 다르면 거부한다", () => {
    const unsafeLink = createValidResultWithSquad() as unknown as {
      squadProfile: { cards: Array<{ officialDataCenterUrl: string }> };
    };
    unsafeLink.squadProfile.cards[0].officialDataCenterUrl =
      "https://example.com/player?spid=225136606";
    expect(isSearchResultWithAnalysis(unsafeLink)).toBe(false);

    const wrongGrade = createValidResultWithSquad() as unknown as {
      squadProfile: { cards: Array<{ officialDataCenterUrl: string }> };
    };
    wrongGrade.squadProfile.cards[0].officialDataCenterUrl =
      "https://fconline.nexon.com/DataCenter/PlayerInfo?spid=225136606&n1Strong=6";
    expect(isSearchResultWithAnalysis(wrongGrade)).toBe(false);

    const mismatchedCount = createValidResultWithSquad() as unknown as {
      squadProfile: { analyzedMatchCount: number };
    };
    mismatchedCount.squadProfile.analyzedMatchCount += 1;
    expect(isSearchResultWithAnalysis(mismatchedCount)).toBe(false);
  });

  it("players와 squadProfile이 없는 구형 성공 응답을 계속 승인한다", () => {
    const legacy = structuredClone(createValidResult()) as unknown as {
      matches: Array<{ players?: unknown }>;
      squadProfile?: unknown;
    };

    for (const match of legacy.matches) {
      delete match.players;
    }
    delete legacy.squadProfile;

    expect(isSearchResultWithAnalysis(legacy)).toBe(true);
  });
});

function createValidResult(): SearchResultWithAnalysis {
  const result = normalizeSearchResult(basicUser, matchDetails);
  const analysis = analyzePlayStyle(result.matches);

  return {
    ...result,
    analysis,
    recommendation: recommendTactic(analysis),
  };
}

function createValidResultWithSquad(): SearchResultWithAnalysis {
  const result = createValidResult();
  result.matches[0].players = [
    {
      spId: 225136606,
      spGrade: 5,
      spPosition: 25,
      performance: {
        rating: 8.2,
        goals: 1,
        assists: 0,
        shots: 3,
        effectiveShots: 2,
        passesAttempted: 10,
        passesCompleted: 8,
        tacklesAttempted: 0,
        tacklesCompleted: 0,
        interceptions: 0,
        blocks: 0,
      },
    },
  ];
  result.squadProfile = buildRecentSquadProfile(result.matches, result.matches.length, {
    status: "available",
    fetchedAt: "2026-07-26T00:00:00.000Z",
    getPlayerName: () => "합성 선수",
    getSeason: () => ({
      name: "합성 시즌",
      imageUrl: "https://ssl.nexon.com/season.png",
    }),
    getPositionName: () => "ST",
  });

  return result;
}
