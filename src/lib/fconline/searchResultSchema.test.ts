import { describe, expect, it } from "vitest";

import { analyzePlayStyle } from "../analysis/playStyleAnalyzer";
import { recommendTactic } from "../tactics/tacticRecommender";
import basicUserFixture from "./__fixtures__/success/basic-user.json";
import matchDetailsFixture from "./__fixtures__/success/match-details.json";
import { normalizeSearchResult } from "./normalize";
import { isSearchResultWithAnalysis } from "./searchResultSchema";
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
