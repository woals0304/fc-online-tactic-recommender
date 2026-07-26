import { describe, expect, it } from "vitest";

import { analyzePlayStyle } from "../analysis/playStyleAnalyzer";
import basicUserFixture from "../fconline/__fixtures__/success/basic-user.json";
import matchDetailsFixture from "../fconline/__fixtures__/success/match-details.json";
import { normalizeSearchResult } from "../fconline/normalize";
import type {
  FcOnlineBasicUserResponse,
  FcOnlineMatchDetailResponse,
  PlayStyleAnalysis,
  PlayStyleLabel,
  TacticRecommendation,
} from "../fconline/types";
import {
  FORMATION_CANDIDATES,
  recommendTactic,
  TACTIC_RULE_THRESHOLDS,
} from "./tacticRecommender";

const basicUser = basicUserFixture as FcOnlineBasicUserResponse;
const matchDetails = matchDetailsFixture as FcOnlineMatchDetailResponse[];
const normalizedMatches = normalizeSearchResult(basicUser, matchDetails).matches;
const fixtureAnalysis = analyzePlayStyle(normalizedMatches);

describe("recommendTactic", () => {
  it("최소 5개 이상의 포메이션 후보를 가진다", () => {
    expect(FORMATION_CANDIDATES.length).toBeGreaterThanOrEqual(5);
    expect(FORMATION_CANDIDATES).toEqual(
      expect.arrayContaining(["4-2-2-2", "4-3-2-1", "4-3-3 홀딩", "4-1-4-1", "5-2-3"]),
    );
  });

  it("fixture 분석 결과에서 공격과 점유가 높으면 4-3-2-1 주전술과 4-2-2-2 대안을 반환한다", () => {
    const recommendation = recommendTactic(fixtureAnalysis);

    expect(recommendation.primary.title).toBe("공격 점유 압박");
    expect(recommendation.primary.matchedRule).toBe("공격 점유 압박");
    expect(recommendation.primary.formation).toBe("4-3-2-1");
    expect(recommendation.primary.teamTactics.teamMentality).toBe("공격적");
    expect(recommendation.primary.teamTactics.offensiveTactics.buildUpPlay).toBe("밸런스");
    expect(recommendation.primary.explanation).toContain("공격적");
    expect(recommendation.primary.explanation).toContain("점유율 지향");
    expect(recommendation.alternative.title).toBe("투톱 슈팅 강화");
    expect(recommendation.alternative.matchedRule).toBe("투톱 슈팅 강화");
    expect(recommendation.alternative.formation).toBe("4-2-2-2");
  });

  it("확장된 개인 전술 구조를 반환한다", () => {
    const recommendation = recommendTactic(fixtureAnalysis);
    const striker = recommendation.primary.playerInstructions[0];

    expect(striker).toEqual({
      position: "ST",
      role: "침투형 원톱",
      personalTactics: [
        { menu: "공격 지원", value: "뒤에서 침투" },
        { menu: "위치 선정", value: "중앙에 위치" },
      ],
      attackParticipation: 3,
      defenseParticipation: 2,
    });
    expectEveryInstructionIsPortable(recommendation.primary);
    expectEveryInstructionIsPortable(recommendation.alternative);
  });

  it("수비 불안과 점유율 지향이 함께 높으면 4-1-4-1로 중앙 보호를 우선한다", () => {
    const recommendation = recommendTactic(
      createAnalysis({
        "수비 불안": TACTIC_RULE_THRESHOLDS.riskPossession.defenseRiskMin,
        "점유율 지향": TACTIC_RULE_THRESHOLDS.possession.possessionMin,
      }),
    );

    expect(recommendation.primary.title).toBe("수비 보정 점유");
    expect(recommendation.primary.formation).toBe("4-1-4-1");
    expect(recommendation.primary.teamTactics.defensiveTactics.depth).toBe(43);
    expect(recommendation.primary.teamTactics.offensiveTactics.buildUpPlay).toBe("느린 빌드업");
    expect(recommendation.primary.explanation).toContain("수비 불안");
    expect(recommendation.primary.explanation).toContain("점유율 지향");
    expect(recommendation.alternative.title).toBe("점유 전개 유지");
  });

  it("수비 보정 점유의 65점 경계를 포함하고 바로 아래에서는 단독 수비 보정을 선택한다", () => {
    const atThreshold = recommendTactic(
      createAnalysis({
        "수비 불안": TACTIC_RULE_THRESHOLDS.riskPossession.defenseRiskMin,
        "점유율 지향": TACTIC_RULE_THRESHOLDS.riskPossession.possessionMin,
      }),
    );
    const belowThreshold = recommendTactic(
      createAnalysis({
        "수비 불안": TACTIC_RULE_THRESHOLDS.riskPossession.defenseRiskMin,
        "점유율 지향": TACTIC_RULE_THRESHOLDS.riskPossession.possessionMin - 1,
      }),
    );

    expect(atThreshold.primary.title).toBe("수비 보정 점유");
    expect(belowThreshold.primary.title).toBe("수비 안정 우선");
  });

  it("수비 불안과 공격 성향이 함께 높으면 5-2-3 역습 전술을 우선한다", () => {
    const recommendation = recommendTactic(
      createAnalysis({
        "공격적": 100,
        "슈팅 빈도 높음": 100,
        "수비 불안": TACTIC_RULE_THRESHOLDS.riskCounter.defenseRiskMin,
      }),
    );

    expect(recommendation.primary.title).toBe("수비 보정 역습");
    expect(recommendation.primary.formation).toBe("5-2-3");
    expect(recommendation.primary.teamTactics.defensiveTactics.depth).toBe(38);
    expect(recommendation.primary.teamTactics.offensiveTactics.buildUpPlay).toBe("빠른 빌드업");
    expect(recommendation.alternative.title).toBe("투톱 슈팅 강화");
  });

  it("공격 성향과 슈팅 빈도만 높으면 4-2-2-2 투톱 전술을 추천한다", () => {
    const recommendation = recommendTactic(
      createAnalysis({
        "공격적": TACTIC_RULE_THRESHOLDS.attackAndShoot.aggressiveMin,
        "슈팅 빈도 높음": TACTIC_RULE_THRESHOLDS.attackAndShoot.highShootingMin,
      }),
    );

    expect(recommendation.primary.title).toBe("투톱 슈팅 강화");
    expect(recommendation.primary.formation).toBe("4-2-2-2");
    expect(recommendation.primary.teamTactics.offensiveTactics.playersInBox).toBe(7);
    expect(recommendation.alternative.title).toBe("기본 밸런스");
  });

  it("점유율 지향과 득점력이 함께 높으면 4-3-3 홀딩으로 점유 득점을 유지한다", () => {
    const recommendation = recommendTactic(
      createAnalysis({
        "점유율 지향": TACTIC_RULE_THRESHOLDS.possessionScoring.possessionMin,
        "득점력 높음": TACTIC_RULE_THRESHOLDS.possessionScoring.highScoringMin,
      }),
    );

    expect(recommendation.primary.title).toBe("점유 득점 유지");
    expect(recommendation.primary.matchedRule).toBe("점유 득점 유지");
    expect(recommendation.primary.formation).toBe("4-3-3 홀딩");
    expect(recommendation.primary.teamTactics.offensiveTactics.buildUpPlay).toBe("느린 빌드업");
    expect(recommendation.alternative.title).toBe("기본 밸런스");
    expect(recommendation.alternative.formation).not.toBe(recommendation.primary.formation);
  });

  it("대안 전술은 주전술과 같은 포메이션 후보를 건너뛴다", () => {
    const recommendation = recommendTactic(
      createAnalysis({
        "점유율 지향": 100,
        "득점력 높음": 100,
      }),
    );

    expect(recommendation.primary.formation).toBe("4-3-3 홀딩");
    expect(recommendation.alternative.formation).toBe("4-4-2");
    expect(recommendation.alternative.matchedRule).toBe("기본 밸런스");
  });

  it("점유율 지향만 높으면 점유 전개 유지 전술을 주전술로 추천한다", () => {
    const recommendation = recommendTactic(
      createAnalysis({
        "점유율 지향": TACTIC_RULE_THRESHOLDS.possession.possessionMin,
      }),
    );

    expect(recommendation.primary.title).toBe("점유 전개 유지");
    expect(recommendation.primary.formation).toBe("4-3-3 홀딩");
    expect(recommendation.primary.teamTactics.teamMentality).toBe("보통");
    expect(recommendation.primary.teamTactics.offensiveTactics.buildUpPlay).toBe("느린 빌드업");
    expect(recommendation.alternative.title).toBe("기본 밸런스");
  });

  it("뚜렷한 성향이 없으면 기본 밸런스를 주전술로, 안정 점유를 대안으로 추천한다", () => {
    const recommendation = recommendTactic(createAnalysis({}));

    expect(recommendation.primary.title).toBe("기본 밸런스");
    expect(recommendation.primary.matchedRule).toBe("기본 밸런스");
    expect(recommendation.primary.formation).toBe("4-4-2");
    expect(recommendation.primary.teamTactics.offensiveTactics.buildUpPlay).toBe("밸런스");
    expect(recommendation.alternative.title).toBe("안정 점유 대안");
    expect(recommendation.alternative.matchedRule).toBe("안정 점유 대안");
    expect(recommendation.alternative.formation).toBe("4-2-3-1");
  });

  it("분석 점수가 null이면 0점으로 취급해 안전한 기본 전술을 선택한다", () => {
    const recommendation = recommendTactic(
      createAnalysis({
        공격적: null,
        "수비 불안": null,
        "득점력 높음": null,
        "점유율 지향": null,
        "슈팅 빈도 높음": null,
      }),
    );

    expect(recommendation.primary.title).toBe("기본 밸런스");
    expect(recommendation.primary.formation).toBe("4-4-2");
    expect(recommendation.alternative.title).toBe("안정 점유 대안");
  });
});

function createAnalysis(
  scores: Partial<Record<PlayStyleLabel, number | null>>,
): PlayStyleAnalysis {
  const labels: PlayStyleLabel[] = [
    "공격적",
    "수비 불안",
    "득점력 높음",
    "점유율 지향",
    "슈팅 빈도 높음",
  ];

  return {
    matchCount: 5,
    requestedMatchCount: 5,
    confidence: {
      level: "high",
      coverage: 100,
      message: "테스트용 신뢰도입니다.",
    },
    styles: labels.map((label) => ({
      label,
      score: scores[label] === undefined ? 0 : scores[label],
      reason: "테스트용 분석 결과입니다.",
    })),
  };
}

function expectEveryInstructionIsPortable(recommendation: TacticRecommendation) {
  for (const instruction of recommendation.playerInstructions) {
    expect(instruction.position).toBeTruthy();
    expect(instruction.role).toBeTruthy();
    expect(instruction.personalTactics.length).toBeGreaterThan(0);
    expect([1, 2, 3]).toContain(instruction.attackParticipation);
    expect([1, 2, 3]).toContain(instruction.defenseParticipation);
  }
}
