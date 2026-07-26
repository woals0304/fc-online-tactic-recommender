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
  TacticTemplateId,
} from "../fconline/types";
import {
  calculateTacticConfigHash,
  FORMATION_CANDIDATES,
  recommendTactic,
  TACTIC_RULES,
  TACTIC_RULE_THRESHOLDS,
} from "./tacticRecommender";
import {
  ATTACKING_STYLES,
  DEFENSIVE_STYLES,
  GAME_PATCH_VERSION,
  PLAYER_POSITIONS,
  TACTIC_SCHEMA_VERSION,
  TACTIC_TEMPLATE_IDS,
  TACTIC_TEMPLATE_VERSION,
  TEAM_MENTALITIES,
  validateTacticRecommendation,
} from "./tacticSchema";

const basicUser = basicUserFixture as FcOnlineBasicUserResponse;
const matchDetails = matchDetailsFixture as FcOnlineMatchDetailResponse[];
const normalizedMatches = normalizeSearchResult(basicUser, matchDetails).matches;
const fixtureAnalysis = analyzePlayStyle(normalizedMatches);

describe("recommendTactic", () => {
  it("7개 프로젝트 포메이션 후보를 중복 없이 유지한다", () => {
    expect(FORMATION_CANDIDATES).toHaveLength(7);
    expect(new Set(FORMATION_CANDIDATES).size).toBe(FORMATION_CANDIDATES.length);
    expect(FORMATION_CANDIDATES).toEqual([
      "4-2-2-2",
      "4-3-2-1",
      "4-3-3 홀딩",
      "4-1-4-1",
      "5-2-3",
      "4-4-2",
      "4-2-3-1",
    ]);
  });

  it("fixture 분석 결과에서 공격 점유 주전술과 투톱 슈팅 대안을 반환한다", () => {
    const recommendation = recommendTactic(fixtureAnalysis);

    expect(recommendation.primary.title).toBe("공격 점유 압박");
    expect(recommendation.primary.metadata.templateId).toBe("attack-possession");
    expect(recommendation.primary.formation).toBe("4-3-2-1");
    expect(recommendation.primary.teamTactics.teamMentality).toBe("공격적");
    expect(recommendation.primary.teamTactics.offensiveTactics.buildUpPlay).toBe("짧은 패스");
    expect(recommendation.primary.teamTactics.offensiveTactics.chanceCreation).toBe("짧은 패스");
    expect(recommendation.alternative.metadata.templateId).toBe("attack-and-shoot");
    expect(recommendation.alternative.formation).toBe("4-2-2-2");
  });

  it("9개 템플릿을 각각 정확히 한 번 생성하고 모두 현행 팀 전술 계약을 만족한다", () => {
    const templates = createEveryTemplate();
    const ids = templates.map((template) => template.metadata.templateId);
    const hashes = templates.map((template) => template.metadata.configHash);

    expect(TACTIC_TEMPLATE_IDS).toHaveLength(9);
    expect(new Set(TACTIC_TEMPLATE_IDS).size).toBe(TACTIC_TEMPLATE_IDS.length);
    expect(new Set(ids).size).toBe(9);
    expect([...ids].sort()).toEqual([...TACTIC_TEMPLATE_IDS].sort());
    expect(new Set(hashes).size).toBe(9);

    for (const template of templates) {
      expect(validateTacticRecommendation(template)).toEqual({ valid: true, errors: [] });
      expect(template.metadata).toEqual({
        schemaVersion: TACTIC_SCHEMA_VERSION,
        gamePatchVersion: GAME_PATCH_VERSION,
        templateId: template.metadata.templateId,
        templateVersion: TACTIC_TEMPLATE_VERSION,
        configHash: template.metadata.configHash,
        validation: {
          overall: "partial",
          teamTactics: "confirmed",
          formation: "unconfirmed",
          personalTactics: "unconfirmed",
        },
      });
      expect(template.teamTactics.schemaVersion).toBe(TACTIC_SCHEMA_VERSION);
      expect(template.metadata.configHash).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(template.metadata.configHash).toBe(calculateTacticConfigHash(template));
      expect(TEAM_MENTALITIES).toContain(template.teamTactics.teamMentality);
      expect(DEFENSIVE_STYLES).toContain(template.teamTactics.defensiveTactics.defensiveStyle);
      expect(ATTACKING_STYLES).toContain(template.teamTactics.offensiveTactics.buildUpPlay);
      expect(ATTACKING_STYLES).toContain(template.teamTactics.offensiveTactics.chanceCreation);
      expectScale(template.teamTactics.defensiveTactics.width, 10);
      expectScale(template.teamTactics.defensiveTactics.depth, 10);
      expectScale(template.teamTactics.offensiveTactics.width, 10);
      expectScale(template.teamTactics.offensiveTactics.playersInBox, 10);
      expectScale(template.teamTactics.offensiveTactics.corners, 5);
      expectScale(template.teamTactics.offensiveTactics.freeKicks, 5);
    }
  });

  it("규칙 순서와 생성된 templateId를 하나의 ID 원천으로 결합한다", () => {
    const ruleTemplates = createEveryTemplate().slice(0, TACTIC_RULES.length);

    expect(ruleTemplates.map((template) => template.metadata.templateId)).toEqual(
      TACTIC_RULES.map((rule) => rule.id),
    );
    expect(TACTIC_RULES.map((rule) => rule.id)).toEqual([
      "risk-possession",
      "risk-counter",
      "attack-possession",
      "attack-and-shoot",
      "possession-scoring",
      "possession-focused",
      "defense-risk",
    ]);
  });

  it("configHash는 같은 설정과 키 순서 변경에 결정적이고 설정 변경에는 민감하다", () => {
    const template = createEveryTemplate()[0];
    const sameConfigWithDifferentKeyOrder = {
      playerInstructions: structuredClone(template.playerInstructions),
      teamTactics: structuredClone(template.teamTactics),
      formation: template.formation,
    };
    const changedConfig = structuredClone(sameConfigWithDifferentKeyOrder);
    changedConfig.teamTactics.defensiveTactics.width = 5;

    expect(calculateTacticConfigHash(template)).toBe(
      calculateTacticConfigHash(sameConfigWithDifferentKeyOrder),
    );
    expect(calculateTacticConfigHash(changedConfig)).not.toBe(template.metadata.configHash);
    expect(createEveryTemplate().map((item) => item.metadata.configHash)).toEqual(
      createEveryTemplate().map((item) => item.metadata.configHash),
    );
  });

  it("개인 전술을 설명과 미확인 UI 후보로 분리하고 포지션을 정규화한다", () => {
    for (const recommendation of createEveryTemplate()) {
      for (const instruction of recommendation.playerInstructions) {
        expect(instruction.positions.length).toBeGreaterThan(0);
        expect(new Set(instruction.positions).size).toBe(instruction.positions.length);
        expect(instruction.positions.every((position) => PLAYER_POSITIONS.includes(position))).toBe(
          true,
        );
        expect(instruction.positions.every((position) => !/[\s/]|\d/.test(position))).toBe(true);
        expect(instruction.roleDescription).toBeTruthy();
        expect(instruction.uiSettings.length).toBeGreaterThan(0);
        expect(instruction.uiSettings.every((setting) => setting.confirmed === false)).toBe(true);
        expect(instruction.attackParticipation.confirmed).toBe(false);
        expect(instruction.defenseParticipation.confirmed).toBe(false);
      }
    }

    const fixtureRecommendation = recommendTactic(fixtureAnalysis);
    const forwards = fixtureRecommendation.primary.playerInstructions[1];
    expect(forwards.positions).toEqual(["LF", "RF"]);
    expect(forwards).not.toHaveProperty("position");
    expect(forwards).not.toHaveProperty("role");
    expect(forwards).not.toHaveProperty("personalTactics");
  });

  it("9개 템플릿의 포지션을 모호하지 않은 명시적 슬롯으로 고정한다", () => {
    const positionsByTemplate = Object.fromEntries(
      createEveryTemplate().map((template) => [
        template.metadata.templateId,
        template.playerInstructions.flatMap((instruction) => instruction.positions),
      ]),
    ) as Record<TacticTemplateId, string[]>;

    expect(positionsByTemplate).toEqual({
      "risk-possession": ["ST", "LM", "RM", "LCM", "RCM", "CDM", "LB", "RB"],
      "risk-counter": ["ST", "LW", "RW", "LCM", "RCM", "LWB", "RWB", "LCB", "CB", "RCB"],
      "attack-possession": ["ST", "LF", "RF", "LCM", "CM", "RCM", "LB", "RB"],
      "attack-and-shoot": ["LS", "RS", "LAM", "RAM", "LDM", "RDM", "LB", "RB"],
      "possession-scoring": ["ST", "LW", "RW", "LCM", "RCM", "CDM", "LB", "RB"],
      "possession-focused": ["ST", "LW", "RW", "LCM", "RCM", "CDM", "LB", "RB"],
      "defense-risk": ["ST", "LM", "RM", "LCM", "RCM", "CDM", "LB", "RB"],
      balanced: ["LS", "RS", "LM", "RM", "LCM", "RCM", "LB", "RB"],
      "compact-possession-alternative": ["ST", "CAM", "LAM", "RAM", "LDM", "RDM", "LB", "RB"],
    });
  });

  it("구형 전술명과 범위가 어떤 템플릿에도 남지 않는다", () => {
    const serialized = JSON.stringify(createEveryTemplate());

    expect(serialized).not.toContain("전방 압박");
    expect(serialized).not.toContain("느린 빌드업");
    expect(serialized).toContain("chanceCreation");
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

    expect(atThreshold.primary.metadata.templateId).toBe("risk-possession");
    expect(belowThreshold.primary.metadata.templateId).toBe("defense-risk");
  });

  it("다중 일치 시 수비 보정 점유를 수비 보정 역습보다 먼저 선택한다", () => {
    const recommendation = recommendTactic(
      createAnalysis({
        "수비 불안": 100,
        "점유율 지향": 100,
        공격적: 100,
      }),
    );

    expect(recommendation.primary.metadata.templateId).toBe("risk-possession");
    expect(recommendation.alternative.metadata.templateId).toBe("risk-counter");
  });

  it("다중 일치 시 공격 점유를 투톱 슈팅보다 먼저 선택한다", () => {
    const recommendation = recommendTactic(
      createAnalysis({
        공격적: 100,
        "점유율 지향": 100,
        "슈팅 빈도 높음": 100,
      }),
    );

    expect(recommendation.primary.metadata.templateId).toBe("attack-possession");
    expect(recommendation.alternative.metadata.templateId).toBe("attack-and-shoot");
  });

  it("수비 보정 역습의 대안으로 투톱 슈팅을 선택한다", () => {
    const recommendation = recommendTactic(
      createAnalysis({ 공격적: 100, "슈팅 빈도 높음": 100, "수비 불안": 100 }),
    );

    expect(recommendation.primary.metadata.templateId).toBe("risk-counter");
    expect(recommendation.alternative.metadata.templateId).toBe("attack-and-shoot");
  });

  it("점유 득점과 같은 포메이션인 점유 전개를 건너뛰고 기본 밸런스를 대안으로 선택한다", () => {
    const recommendation = recommendTactic(
      createAnalysis({ "점유율 지향": 100, "득점력 높음": 100 }),
    );

    expect(recommendation.primary.metadata.templateId).toBe("possession-scoring");
    expect(recommendation.alternative.metadata.templateId).toBe("balanced");
  });

  it("대안은 주전술과 templateId와 포메이션이 모두 다르다", () => {
    const analyses = [
      fixtureAnalysis,
      createAnalysis({}),
      createAnalysis({ "수비 불안": 100, 공격적: 100 }),
      createAnalysis({ "점유율 지향": 100, "득점력 높음": 100 }),
    ];

    for (const analysis of analyses) {
      const recommendation = recommendTactic(analysis);
      expect(recommendation.alternative.metadata.templateId).not.toBe(
        recommendation.primary.metadata.templateId,
      );
      expect(recommendation.alternative.formation).not.toBe(recommendation.primary.formation);
    }
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

    expect(recommendation.primary.metadata.templateId).toBe("balanced");
    expect(recommendation.alternative.metadata.templateId).toBe(
      "compact-possession-alternative",
    );
  });
});

function createEveryTemplate(): TacticRecommendation[] {
  return [
    recommendTactic(createAnalysis({ "수비 불안": 70, "점유율 지향": 65 })).primary,
    recommendTactic(createAnalysis({ "수비 불안": 70, 공격적: 70 })).primary,
    recommendTactic(createAnalysis({ 공격적: 70, "점유율 지향": 70 })).primary,
    recommendTactic(createAnalysis({ 공격적: 70, "슈팅 빈도 높음": 70 })).primary,
    recommendTactic(createAnalysis({ "점유율 지향": 70, "득점력 높음": 70 })).primary,
    recommendTactic(createAnalysis({ "점유율 지향": 70 })).primary,
    recommendTactic(createAnalysis({ "수비 불안": 70 })).primary,
    recommendTactic(createAnalysis({})).primary,
    recommendTactic(createAnalysis({})).alternative,
  ];
}

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
      message: "테스트용 데이터 충분도입니다.",
    },
    styles: labels.map((label) => ({
      label,
      score: scores[label] === undefined ? 0 : scores[label],
      reason: "테스트용 분석 결과입니다.",
    })),
  };
}

function expectScale(value: number, max: number) {
  expect(Number.isInteger(value)).toBe(true);
  expect(value).toBeGreaterThanOrEqual(1);
  expect(value).toBeLessThanOrEqual(max);
}
