import { describe, expect, it } from "vitest";

import basicUserFixture from "../fconline/__fixtures__/success/basic-user.json";
import matchDetailsFixture from "../fconline/__fixtures__/success/match-details.json";
import { normalizeSearchResult } from "../fconline/normalize";
import type {
  FcOnlineBasicUserResponse,
  FcOnlineMatchDetailResponse,
  NormalizedMatch,
} from "../fconline/types";
import { recommendTactic } from "../tactics/tacticRecommender";
import { analyzePlayStyle, getPlayStyleLabels, PLAY_STYLE_CRITERIA } from "./playStyleAnalyzer";

const basicUser = basicUserFixture as FcOnlineBasicUserResponse;
const matchDetails = matchDetailsFixture as FcOnlineMatchDetailResponse[];
const normalizedMatches = normalizeSearchResult(basicUser, matchDetails).matches;

describe("analyzePlayStyle", () => {
  it("정규화된 최근 경기 목록만 입력으로 받아 5개 성향을 계산한다", () => {
    const analysis = analyzePlayStyle(normalizedMatches);

    expect(analysis.matchCount).toBe(2);
    expect(analysis.requestedMatchCount).toBe(2);
    expect(analysis.styles.map((style) => style.label)).toEqual(getPlayStyleLabels());
    expect(analysis.styles).toHaveLength(5);
  });

  it("fixture 경기 평균값을 기준으로 성향 점수를 계산한다", () => {
    const analysis = analyzePlayStyle(normalizedMatches);

    expect(getStyleScore(analysis, PLAY_STYLE_CRITERIA.aggressive.label)).toBe(100);
    expect(getStyleScore(analysis, PLAY_STYLE_CRITERIA.defenseRisk.label)).toBe(54);
    expect(getStyleScore(analysis, PLAY_STYLE_CRITERIA.highScoring.label)).toBe(100);
    expect(getStyleScore(analysis, PLAY_STYLE_CRITERIA.possessionFocused.label)).toBe(88);
    expect(getStyleScore(analysis, PLAY_STYLE_CRITERIA.highShooting.label)).toBe(100);
  });

  it("각 성향 결과에 label, score, reason을 포함한다", () => {
    const analysis = analyzePlayStyle(normalizedMatches);

    for (const style of analysis.styles) {
      expect(style.label).toBeTruthy();
      expect(style.score).toBeGreaterThanOrEqual(0);
      expect(style.score).toBeLessThanOrEqual(100);
      expect(style.reason).toContain("기준");
    }
  });

  it("기준값과 목표값에서 각각 0점과 100점을 계산한다", () => {
    const baselineAnalysis = analyzePlayStyle([
      createNormalizedMatch({
        score: { for: 0.8, against: 0.8 },
        stats: {
          shots: 4,
          effectiveShots: 2,
          possession: 45,
          tackleSuccessRate: 75,
          dribbles: 8,
        },
      }),
    ]);
    const targetAnalysis = analyzePlayStyle([
      createNormalizedMatch({
        score: { for: 2, against: 2 },
        stats: {
          shots: 8,
          effectiveShots: 5,
          possession: 53,
          tackleSuccessRate: 55,
          dribbles: 18,
        },
      }),
    ]);

    expect(baselineAnalysis.styles.map((style) => style.score)).toEqual([0, 0, 0, 0, 0]);
    expect(targetAnalysis.styles.map((style) => style.score)).toEqual([
      100,
      100,
      100,
      100,
      100,
    ]);
  });

  it("복합 성향의 구성 지표가 하나라도 없으면 점수를 계산하지 않는다", () => {
    const analysis = analyzePlayStyle([
      createNormalizedMatch({
        stats: { shots: PLAY_STYLE_CRITERIA.aggressive.shotTarget },
      }),
    ]);

    expect(getStyleScore(analysis, PLAY_STYLE_CRITERIA.aggressive.label)).toBeNull();
    expect(getStyleScore(analysis, PLAY_STYLE_CRITERIA.highShooting.label)).toBe(100);
    expect(
      analysis.styles.find((style) => style.label === PLAY_STYLE_CRITERIA.aggressive.label)?.reason,
    ).toContain("평균 드리블 정보 없음(기준");
    expect(analysis.styles.map((style) => style.reason).join(" ")).not.toMatch(
      /정보 없음(?:회|점|%)/,
    );
    expect(analysis.confidence).toMatchObject({ level: "low", coverage: 14 });
  });

  it("경기가 없으면 모든 점수를 null로 두고 커버리지 0의 낮은 신뢰도를 반환한다", () => {
    const analysis = analyzePlayStyle([]);

    expect(analysis.matchCount).toBe(0);
    expect(analysis.styles.every((style) => style.score === null)).toBe(true);
    expect(analysis.confidence).toEqual({
      level: "low",
      coverage: 0,
      message: "분석할 경기 데이터가 없습니다.",
    });
  });

  it("경기 수와 지표 커버리지에 따라 신뢰도 단계를 구분한다", () => {
    const createFixtureMatches = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...normalizedMatches[index % normalizedMatches.length],
        matchId: `confidence-match-${index + 1}`,
      }));

    expect(analyzePlayStyle(createFixtureMatches(2)).confidence).toMatchObject({
      level: "low",
      coverage: 100,
    });
    expect(analyzePlayStyle(createFixtureMatches(3)).confidence).toMatchObject({
      level: "medium",
      coverage: 100,
    });
    expect(analyzePlayStyle(createFixtureMatches(5)).confidence).toMatchObject({
      level: "high",
      coverage: 100,
    });
  });

  it("요청한 경기 중 일부만 정규화되면 누락 경기를 커버리지에 반영한다", () => {
    const analysis = analyzePlayStyle(
      Array.from({ length: 5 }, (_, index) => ({
        ...normalizedMatches[index % normalizedMatches.length],
        matchId: `partial-match-${index + 1}`,
      })),
      10,
    );

    expect(analysis.requestedMatchCount).toBe(10);
    expect(analysis.confidence).toMatchObject({ level: "medium", coverage: 50 });
    expect(analysis.confidence.message).toContain("요청 10경기 중 5경기");
  });

  it("요청한 세 경기 중 한 경기만 확보되면 점수를 계산하지 않고 기본 전술을 추천한다", () => {
    const analysis = analyzePlayStyle(
      [
        createNormalizedMatch({
          score: { for: 2, against: 0 },
          stats: {
            shots: 8,
            effectiveShots: 5,
            possession: 53,
            tackleSuccessRate: 80,
            dribbles: 18,
          },
        }),
      ],
      3,
    );
    const recommendation = recommendTactic(analysis);

    expect(analysis.requestedMatchCount).toBe(3);
    expect(analysis.styles.every((style) => style.score === null)).toBe(true);
    expect(analysis.confidence).toMatchObject({ level: "low", coverage: 33 });
    expect(recommendation.primary.title).toBe("기본 밸런스");
    expect(recommendation.alternative.title).toBe("안정 점유 대안");
  });

  it("복합 성향 지표가 서로 다른 경기에서만 표본을 채우면 점수를 계산하지 않는다", () => {
    const matches = Array.from({ length: 5 }, (_, index) =>
      createNormalizedMatch({
        score: { for: 0.8, against: 0.8 },
        stats: {
          shots: index < 3 ? 8 : null,
          effectiveShots: 2,
          possession: 45,
          tackleSuccessRate: 75,
          dribbles: index >= 2 ? 18 : null,
        },
      }),
    );
    const analysis = analyzePlayStyle(matches);
    const recommendation = recommendTactic(analysis);

    expect(getStyleScore(analysis, PLAY_STYLE_CRITERIA.aggressive.label)).toBeNull();
    expect(getStyleScore(analysis, PLAY_STYLE_CRITERIA.highShooting.label)).toBe(100);
    expect(analysis.confidence).toMatchObject({ level: "medium", coverage: 89 });
    expect(recommendation.primary.title).toBe("기본 밸런스");
  });

  it("필수 지표 표본이 세 경기보다 적으면 전체 커버리지가 높아도 해당 성향을 계산하지 않는다", () => {
    const matches = Array.from({ length: 5 }, (_, index) =>
      createNormalizedMatch({
        score: { for: 2, against: 1 },
        stats: {
          shots: 8,
          effectiveShots: 5,
          possession: 53,
          tackleSuccessRate: 70,
          dribbles: index === 0 ? 18 : null,
        },
      }),
    );
    const analysis = analyzePlayStyle(matches);

    expect(getStyleScore(analysis, PLAY_STYLE_CRITERIA.aggressive.label)).toBeNull();
    expect(getStyleScore(analysis, PLAY_STYLE_CRITERIA.highShooting.label)).toBe(100);
    expect(analysis.confidence).toMatchObject({ level: "medium", coverage: 89 });
  });
});

function getStyleScore(analysis: ReturnType<typeof analyzePlayStyle>, label: string) {
  const style = analysis.styles.find((item) => item.label === label);

  if (!style) {
    throw new Error(`${label} 성향을 찾지 못했습니다.`);
  }

  return style.score;
}

function createNormalizedMatch({
  score,
  stats,
}: {
  score?: Partial<NormalizedMatch["score"]>;
  stats?: Partial<NormalizedMatch["stats"]>;
} = {}): NormalizedMatch {
  return {
    matchId: "analysis-test-match",
    playedAt: null,
    matchType: 50,
    result: "알 수 없음",
    opponentNickname: "테스트 상대",
    score: {
      for: null,
      against: null,
      ...score,
    },
    stats: {
      possession: null,
      shots: null,
      effectiveShots: null,
      passSuccessRate: null,
      tackleSuccessRate: null,
      dribbles: null,
      ...stats,
    },
  };
}
