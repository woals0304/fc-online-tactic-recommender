import { describe, expect, it } from "vitest";

import type { PlayStyleAnalysis } from "../fconline/types";
import { recommendTactic } from "./tacticRecommender";
import {
  ATTACKING_STYLES,
  DEFENSIVE_STYLES,
  isTacticRecommendation,
  isTacticRecommendationSet,
  PLAYER_POSITIONS,
  TEAM_MENTALITIES,
  validateTacticRecommendation,
  validateTacticRecommendationSet,
  validateTeamTactics,
} from "./tacticSchema";

const analysis: PlayStyleAnalysis = {
  matchCount: 5,
  requestedMatchCount: 5,
  confidence: { level: "high", coverage: 100, message: "test" },
  styles: [],
};

describe("tactic schema runtime validation", () => {
  it("공식 팀 전술 enum을 누락과 중복 없이 고정한다", () => {
    expect(TEAM_MENTALITIES).toEqual([
      "전원 수비",
      "매우 수비적",
      "수비적",
      "보통",
      "공격적",
      "매우 공격적",
      "전원 공격",
    ]);
    expect(DEFENSIVE_STYLES).toEqual([
      "후퇴",
      "밸런스",
      "볼 터치 실수 시 압박",
      "공 뺏긴 직후 압박",
      "지속적인 압박",
    ]);
    expect(ATTACKING_STYLES).toEqual(["짧은 패스", "밸런스", "긴 패스", "빠른 빌드업"]);

    for (const values of [TEAM_MENTALITIES, DEFENSIVE_STYLES, ATTACKING_STYLES]) {
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("개인 전술 포지션 후보를 중복 없는 실제 슬롯 코드로 제한한다", () => {
    expect(new Set(PLAYER_POSITIONS).size).toBe(PLAYER_POSITIONS.length);
    expect(PLAYER_POSITIONS).toEqual([
      "ST", "LS", "RS", "LW", "RW", "LF", "RF", "LM", "RM", "LAM", "RAM", "CAM",
      "LCM", "CM", "RCM", "CDM", "LDM", "RDM", "LWB", "RWB", "LB", "RB", "LCB",
      "CB", "RCB",
    ]);
    expect(PLAYER_POSITIONS.every((position) => !/[\s/]|\d/.test(position))).toBe(true);
  });

  it("추천기가 만든 팀 전술과 추천 세트를 승인한다", () => {
    const recommendation = recommendTactic(analysis);

    expect(validateTeamTactics(recommendation.primary.teamTactics)).toEqual({
      valid: true,
      errors: [],
    });
    expect(isTacticRecommendation(recommendation.primary)).toBe(true);
    expect(isTacticRecommendationSet(recommendation)).toBe(true);
  });

  it.each([
    ["1~10 하한 미달", ["teamTactics", "defensiveTactics", "width"], 0],
    ["1~10 범위 초과", ["teamTactics", "defensiveTactics", "width"], 11],
    ["1~10 정수 위반", ["teamTactics", "offensiveTactics", "width"], 5.5],
    ["1~5 하한 미달", ["teamTactics", "offensiveTactics", "corners"], 0],
    ["1~5 범위 초과", ["teamTactics", "offensiveTactics", "corners"], 6],
  ])("%s를 거부한다", (_name, path, invalidValue) => {
    const recommendation = structuredClone(recommendTactic(analysis).primary) as unknown;
    setNestedValue(recommendation, path as string[], invalidValue);

    const result = validateTacticRecommendation(recommendation);
    expect(result.valid).toBe(false);
  });

  it("구형 수비 스타일과 누락된 chanceCreation을 거부한다", () => {
    const recommendation = structuredClone(recommendTactic(analysis).primary) as Record<
      string,
      unknown
    >;
    const teamTactics = recommendation.teamTactics as Record<string, unknown>;
    const defensive = teamTactics.defensiveTactics as Record<string, unknown>;
    const offensive = teamTactics.offensiveTactics as Record<string, unknown>;

    defensive.defensiveStyle = "전방 압박";
    delete offensive.chanceCreation;

    const result = validateTacticRecommendation(recommendation);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.path)).toEqual(
        expect.arrayContaining([
          "teamTactics.defensiveTactics.defensiveStyle",
          "teamTactics.offensiveTactics.chanceCreation",
        ]),
      );
    }
  });

  it("구형 공격 전술명과 알 수 없는 enum을 거부한다", () => {
    const recommendation = structuredClone(recommendTactic(analysis).primary) as unknown;
    setNestedValue(
      recommendation,
      ["teamTactics", "offensiveTactics", "buildUpPlay"],
      "느린 빌드업",
    );
    setNestedValue(recommendation, ["teamTactics", "teamMentality"], "초공격");

    expect(validateTacticRecommendation(recommendation).valid).toBe(false);
  });

  it("개인 전술 confirmed:true와 중복 포지션을 거부한다", () => {
    const recommendation = structuredClone(recommendTactic(analysis).primary);
    const instruction = recommendation.playerInstructions[0];

    instruction.uiSettings[0].confirmed = true as false;
    instruction.positions.push(instruction.positions[0]);

    const result = validateTacticRecommendation(recommendation);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.map((error) => error.path)).toEqual(
        expect.arrayContaining([
          "playerInstructions[0].uiSettings[0].confirmed",
          "playerInstructions[0].positions",
        ]),
      );
    }
  });

  it.each(["CM 1", "ST 2", "CDM 1", "LM/RM", "UNKNOWN"])(
    "허용 목록에 없는 포지션 %s을 거부한다",
    (invalidPosition) => {
      const recommendation = structuredClone(recommendTactic(analysis).primary) as unknown;
      setNestedValue(
        recommendation,
        ["playerInstructions", "0", "positions", "0"],
        invalidPosition,
      );

      expect(validateTacticRecommendation(recommendation).valid).toBe(false);
    },
  );

  it("서로 다른 개인 전술 항목에 같은 포지션을 중복 지정하면 거부한다", () => {
    const recommendation = structuredClone(recommendTactic(analysis).primary);
    recommendation.playerInstructions[1].positions[0] =
      recommendation.playerInstructions[0].positions[0];

    expect(validateTacticRecommendation(recommendation).valid).toBe(false);
  });

  it("메타데이터가 완전 호환을 주장하면 거부한다", () => {
    const recommendation = structuredClone(recommendTactic(analysis).primary) as unknown as {
      metadata: { validation: { overall: string } };
    };
    recommendation.metadata.validation.overall = "confirmed";

    expect(validateTacticRecommendation(recommendation).valid).toBe(false);
  });

  it.each([
    ["schemaVersion", "fc-online-future"],
    ["gamePatchVersion", "future-patch"],
    ["templateVersion", "2.0.0"],
  ])("오염된 metadata.%s을 거부한다", (field, invalidValue) => {
    const recommendation = structuredClone(recommendTactic(analysis).primary) as unknown;
    setNestedValue(recommendation, ["metadata", field], invalidValue);

    expect(validateTacticRecommendation(recommendation).valid).toBe(false);
  });

  it.each([
    ["접두사 누락", "0".repeat(64)],
    ["길이 부족", "sha256:abcd"],
    ["대문자 16진수", `sha256:${"A".repeat(64)}`],
    ["16진수 외 문자", `sha256:${"z".repeat(64)}`],
  ])("잘못된 configHash 형식(%s)을 거부한다", (_name, invalidHash) => {
    const recommendation = structuredClone(recommendTactic(analysis).primary) as unknown;
    setNestedValue(recommendation, ["metadata", "configHash"], invalidHash);

    expect(validateTacticRecommendation(recommendation).valid).toBe(false);
  });

  it("주전술과 대안의 templateId 또는 포메이션이 같으면 세트 검증에서 거부한다", () => {
    const sameTemplate = structuredClone(recommendTactic(analysis));
    sameTemplate.alternative.metadata.templateId = sameTemplate.primary.metadata.templateId;
    const sameFormation = structuredClone(recommendTactic(analysis));
    sameFormation.alternative.formation = sameFormation.primary.formation;

    expect(validateTacticRecommendationSet(sameTemplate).valid).toBe(false);
    expect(validateTacticRecommendationSet(sameFormation).valid).toBe(false);
  });

  it("구형 개인 전술 필드만 있는 객체를 거부한다", () => {
    const recommendation = structuredClone(recommendTactic(analysis).primary) as unknown as {
      playerInstructions: unknown[];
    };
    recommendation.playerInstructions = [
      {
        position: "ST",
        role: "침투형",
        personalTactics: [{ menu: "공격 지원", value: "뒤에서 침투" }],
        attackParticipation: 3,
        defenseParticipation: 2,
      },
    ];

    expect(validateTacticRecommendation(recommendation).valid).toBe(false);
  });
});

function setNestedValue(value: unknown, path: string[], nextValue: unknown) {
  let current = value as Record<string, unknown>;

  for (const segment of path.slice(0, -1)) {
    current = current[segment] as Record<string, unknown>;
  }

  current[path[path.length - 1]] = nextValue;
}
