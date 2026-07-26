import { createHash } from "node:crypto";

import type {
  AttackingStyle,
  DefensiveStyle,
  FormationCandidate,
  ParticipationLevel,
  PersonalTacticSetting,
  PlayerInstruction,
  PlayerPosition,
  PlayStyleAnalysis,
  PlayStyleLabel,
  Scale10,
  Scale5,
  TacticRecommendation,
  TacticRecommendationSet,
  TacticConfigHash,
  TacticTemplateId,
  TeamMentality,
  TeamTactics,
} from "../fconline/types";
import {
  assertValidTacticRecommendation,
  assertValidTacticRecommendationSet,
  FORMATION_CANDIDATES,
  GAME_PATCH_VERSION,
  TACTIC_SCHEMA_VERSION,
  TACTIC_TEMPLATE_VERSION,
} from "./tacticSchema";

type TacticRuleId = Exclude<
  TacticTemplateId,
  "balanced" | "compact-possession-alternative"
>;

type TacticRule = {
  id: TacticRuleId;
  name: string;
  matches: (scores: PlayStyleScores) => boolean;
  recommend: (scores: PlayStyleScores) => TacticPlan;
};

type PlayStyleScores = Record<PlayStyleLabel, number>;
type TacticPlan = Omit<TacticRecommendation, "metadata" | "matchedRule">;

type TacticConfiguration = Pick<
  TacticRecommendation,
  "formation" | "teamTactics" | "playerInstructions"
>;

type TeamTacticsInput = {
  teamMentality: TeamMentality;
  defensiveStyle: DefensiveStyle;
  defensiveWidth: Scale10;
  defensiveDepth: Scale10;
  buildUpPlay: AttackingStyle;
  chanceCreation: AttackingStyle;
  attackingWidth: Scale10;
  playersInBox: Scale10;
  corners: Scale5;
  freeKicks: Scale5;
};

export { FORMATION_CANDIDATES };

export const TACTIC_RULE_THRESHOLDS = {
  attackAndShoot: {
    aggressiveMin: 70,
    highShootingMin: 70,
  },
  attackPossession: {
    aggressiveMin: 70,
    possessionMin: 70,
    defenseRiskMax: 69,
  },
  possessionScoring: {
    possessionMin: 70,
    highScoringMin: 70,
  },
  possession: {
    possessionMin: 70,
  },
  riskCounter: {
    defenseRiskMin: 70,
    aggressiveMin: 70,
  },
  riskPossession: {
    defenseRiskMin: 70,
    possessionMin: 65,
  },
  defenseRisk: {
    defenseRiskMin: 70,
  },
} as const;

const DEFAULT_STYLE_SCORE = 0;

export const TACTIC_RULES: TacticRule[] = [
  {
    id: "risk-possession",
    name: "수비 보정 점유",
    matches: (scores) =>
      scores["수비 불안"] >= TACTIC_RULE_THRESHOLDS.riskPossession.defenseRiskMin &&
      scores["점유율 지향"] >= TACTIC_RULE_THRESHOLDS.riskPossession.possessionMin,
    recommend: createRiskPossessionRecommendation,
  },
  {
    id: "risk-counter",
    name: "수비 보정 역습",
    matches: (scores) =>
      scores["수비 불안"] >= TACTIC_RULE_THRESHOLDS.riskCounter.defenseRiskMin &&
      scores["공격적"] >= TACTIC_RULE_THRESHOLDS.riskCounter.aggressiveMin,
    recommend: createRiskCounterRecommendation,
  },
  {
    id: "attack-possession",
    name: "공격 점유 압박",
    matches: (scores) =>
      scores["공격적"] >= TACTIC_RULE_THRESHOLDS.attackPossession.aggressiveMin &&
      scores["점유율 지향"] >= TACTIC_RULE_THRESHOLDS.attackPossession.possessionMin &&
      scores["수비 불안"] <= TACTIC_RULE_THRESHOLDS.attackPossession.defenseRiskMax,
    recommend: createAttackPossessionRecommendation,
  },
  {
    id: "attack-and-shoot",
    name: "투톱 슈팅 강화",
    matches: (scores) =>
      scores["공격적"] >= TACTIC_RULE_THRESHOLDS.attackAndShoot.aggressiveMin &&
      scores["슈팅 빈도 높음"] >= TACTIC_RULE_THRESHOLDS.attackAndShoot.highShootingMin,
    recommend: createAttackAndShootRecommendation,
  },
  {
    id: "possession-scoring",
    name: "점유 득점 유지",
    matches: (scores) =>
      scores["점유율 지향"] >= TACTIC_RULE_THRESHOLDS.possessionScoring.possessionMin &&
      scores["득점력 높음"] >= TACTIC_RULE_THRESHOLDS.possessionScoring.highScoringMin,
    recommend: createPossessionScoringRecommendation,
  },
  {
    id: "possession-focused",
    name: "점유 전개 유지",
    matches: (scores) => scores["점유율 지향"] >= TACTIC_RULE_THRESHOLDS.possession.possessionMin,
    recommend: createPossessionRecommendation,
  },
  {
    id: "defense-risk",
    name: "수비 안정 우선",
    matches: (scores) => scores["수비 불안"] >= TACTIC_RULE_THRESHOLDS.defenseRisk.defenseRiskMin,
    recommend: createDefenseStabilityRecommendation,
  },
];

export function recommendTactic(analysis: PlayStyleAnalysis): TacticRecommendationSet {
  const scores = toScoreMap(analysis);
  const primaryRule = TACTIC_RULES.find((rule) => rule.matches(scores));
  const primary = primaryRule
    ? createRecommendationFromRule(primaryRule, scores)
    : createRecommendation("balanced", "기본 밸런스", createBalancedRecommendation(scores));
  const alternative = getAlternativeRecommendation(scores, primaryRule?.id, primary.formation);
  const recommendationSet = { primary, alternative };

  assertValidTacticRecommendationSet(recommendationSet);
  return recommendationSet;
}

function getAlternativeRecommendation(
  scores: PlayStyleScores,
  primaryRuleId: TacticRuleId | undefined,
  primaryFormation: FormationCandidate,
) {
  for (const rule of TACTIC_RULES) {
    if (rule.id === primaryRuleId || !rule.matches(scores)) {
      continue;
    }

    const candidate = createRecommendationFromRule(rule, scores);

    if (candidate.formation !== primaryFormation) {
      return candidate;
    }
  }

  if (primaryRuleId) {
    const balanced = createRecommendation(
      "balanced",
      "기본 밸런스",
      createBalancedRecommendation(scores),
    );

    if (balanced.formation !== primaryFormation) {
      return balanced;
    }
  }

  return createRecommendation(
    "compact-possession-alternative",
    "안정 점유 대안",
    createCompactPossessionAlternative(scores),
  );
}

function createRiskPossessionRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "수비 보정 점유",
    formation: "4-1-4-1",
    teamTactics: teamTactics({
      teamMentality: "수비적",
      defensiveStyle: "밸런스",
      defensiveWidth: 4,
      defensiveDepth: 4,
      buildUpPlay: "짧은 패스",
      chanceCreation: "짧은 패스",
      attackingWidth: 5,
      playersInBox: 4,
      corners: 2,
      freeKicks: 2,
    }),
    playerInstructions: [
      instruction(["ST"], "연계형 원톱", tactics(["공격 지원", "균형 잡힌 공격"], ["위치 선정", "중앙에 위치"]), 2, 2),
      instruction(["LM", "RM"], "수비 가담 윙어", tactics(["수비 지원", "수비 가담"], ["지원 움직임", "측면 대기"]), 2, 3),
      instruction(["LCM"], "전진 연결", tactics(["공격 지원", "균형 잡힌 공격"], ["박스 지원", "패스 길 열기"]), 2, 2),
      instruction(["RCM"], "박스 보호", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction(["CDM"], "전담 홀딩", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction(["LB", "RB"], "안정 풀백", tactics(["공격 지원", "공격 시 후방 대기"], ["공격 위치", "오버랩 자제"]), 1, 3),
    ],
    explanation: `수비 불안 ${scores["수비 불안"]}점과 점유율 지향 ${scores["점유율 지향"]}점이 함께 높아 4-1-4-1로 중앙을 한 겹 더 보호합니다. 수비 깊이 4와 짧은 패스 전개는 뒷공간 노출을 억제하면서 안전한 연결을 늘리도록 설계했습니다.`,
  };
}

function createRiskCounterRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "수비 보정 역습",
    formation: "5-2-3",
    teamTactics: teamTactics({
      teamMentality: "수비적",
      defensiveStyle: "후퇴",
      defensiveWidth: 4,
      defensiveDepth: 3,
      buildUpPlay: "빠른 빌드업",
      chanceCreation: "긴 패스",
      attackingWidth: 7,
      playersInBox: 5,
      corners: 2,
      freeKicks: 2,
    }),
    playerInstructions: [
      instruction(["ST"], "침투형 원톱", tactics(["공격 지원", "뒤에서 침투"], ["위치 선정", "중앙에 위치"]), 3, 2),
      instruction(["LW", "RW"], "역습 윙어", tactics(["침투 지원", "뒤에서 침투"], ["지원 움직임", "측면 대기"]), 3, 2),
      instruction(["LCM"], "수비 보호", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction(["RCM"], "전환 패서", tactics(["공격 지원", "균형 잡힌 공격"], ["수비 위치", "센터 커버"]), 2, 2),
      instruction(["LWB", "RWB"], "왕복 윙백", tactics(["공격 지원", "균형 잡힌 공격"], ["공격 위치", "오버랩"]), 2, 3),
      instruction(["LCB", "CB", "RCB"], "박스 수비", tactics(["공격 지원", "기본 위치 유지"], ["수비 위치", "중앙 유지"]), 1, 3),
    ],
    explanation: `수비 불안 ${scores["수비 불안"]}점인데 공격적 ${scores["공격적"]}점도 높아 5-2-3을 추천합니다. 수비 깊이 3으로 뒷공간을 줄이고, 빠른 빌드업과 긴 패스 기회 창출로 전방 세 명에게 빠르게 연결합니다.`,
  };
}

function createAttackPossessionRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "공격 점유 압박",
    formation: "4-3-2-1",
    teamTactics: teamTactics({
      teamMentality: "공격적",
      defensiveStyle: "공 뺏긴 직후 압박",
      defensiveWidth: 5,
      defensiveDepth: 7,
      buildUpPlay: "짧은 패스",
      chanceCreation: "짧은 패스",
      attackingWidth: 5,
      playersInBox: 6,
      corners: 3,
      freeKicks: 2,
    }),
    playerInstructions: [
      instruction(["ST"], "침투형 원톱", tactics(["공격 지원", "뒤에서 침투"], ["위치 선정", "중앙에 위치"]), 3, 2),
      instruction(["LF", "RF"], "하프스페이스 공격수", tactics(["지원 움직임", "안쪽으로 파고들기"], ["침투 지원", "뒤에서 침투"]), 3, 2),
      instruction(["LCM"], "전진 지원", tactics(["공격 지원", "공격 가담"], ["박스 지원", "패스 길 열기"]), 3, 2),
      instruction(["CM"], "균형 연결", tactics(["공격 지원", "균형 잡힌 공격"], ["수비 위치", "센터 커버"]), 2, 2),
      instruction(["RCM"], "수비 보험", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction(["LB", "RB"], "균형 풀백", tactics(["공격 지원", "균형 잡힌 공격"], ["공격 위치", "오버랩 자제"]), 2, 2),
    ],
    explanation: `공격적 ${scores["공격적"]}점과 점유율 지향 ${scores["점유율 지향"]}점이 높고 수비 불안 ${scores["수비 불안"]}점은 위험선 아래입니다. 깊이 7의 즉시 압박과 두 구간의 짧은 패스로 중앙·하프스페이스 점유를 이어갑니다.`,
  };
}

function createAttackAndShootRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "투톱 슈팅 강화",
    formation: "4-2-2-2",
    teamTactics: teamTactics({
      teamMentality: "공격적",
      defensiveStyle: "공 뺏긴 직후 압박",
      defensiveWidth: 6,
      defensiveDepth: 7,
      buildUpPlay: "빠른 빌드업",
      chanceCreation: "빠른 빌드업",
      attackingWidth: 6,
      playersInBox: 7,
      corners: 3,
      freeKicks: 3,
    }),
    playerInstructions: [
      instruction(["LS"], "침투형 공격수", tactics(["공격 지원", "뒤에서 침투"], ["위치 선정", "중앙에 위치"]), 3, 2),
      instruction(["RS"], "연계형 공격수", tactics(["공격 지원", "균형 잡힌 공격"], ["위치 선정", "중앙에 위치"]), 3, 2),
      instruction(["LAM", "RAM"], "중앙 침투 2선", tactics(["지원 움직임", "안쪽으로 파고들기"], ["침투 지원", "뒤에서 침투"]), 3, 2),
      instruction(["LDM"], "수비 보호", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction(["RDM"], "전개 지원", tactics(["공격 지원", "균형 잡힌 공격"], ["수비 위치", "센터 커버"]), 2, 2),
      instruction(["LB", "RB"], "균형 풀백", tactics(["공격 지원", "균형 잡힌 공격"], ["공격 위치", "오버랩 자제"]), 2, 2),
    ],
    explanation: `공격적 ${scores["공격적"]}점과 슈팅 빈도 높음 ${scores["슈팅 빈도 높음"]}점이 강해 4-2-2-2로 박스 주변 슈팅 루트를 늘립니다. 빠른 빌드업과 크로스 시 박스 진입 성향 7은 두 공격수와 2선의 마무리 참여를 강조합니다.`,
  };
}

function createPossessionScoringRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "점유 득점 유지",
    formation: "4-3-3 홀딩",
    teamTactics: teamTactics({
      teamMentality: "보통",
      defensiveStyle: "밸런스",
      defensiveWidth: 5,
      defensiveDepth: 5,
      buildUpPlay: "짧은 패스",
      chanceCreation: "밸런스",
      attackingWidth: 6,
      playersInBox: 5,
      corners: 2,
      freeKicks: 2,
    }),
    playerInstructions: [
      instruction(["ST"], "연계 마무리", tactics(["공격 지원", "균형 잡힌 공격"], ["위치 선정", "중앙에 위치"]), 3, 2),
      instruction(["LW", "RW"], "폭 유지 윙어", tactics(["지원 움직임", "측면 대기"], ["공격 지원", "짧은 패스 지원"]), 2, 2),
      instruction(["LCM"], "침투 미드필더", tactics(["공격 지원", "공격 가담"], ["박스 지원", "페널티 박스 안으로 침투"]), 3, 2),
      instruction(["RCM"], "전개 미드필더", tactics(["공격 지원", "균형 잡힌 공격"], ["박스 지원", "패스 길 열기"]), 2, 2),
      instruction(["CDM"], "후방 조율", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction(["LB", "RB"], "지원 풀백", tactics(["공격 지원", "균형 잡힌 공격"], ["공격 위치", "오버랩 자제"]), 2, 2),
    ],
    explanation: `점유율 지향 ${scores["점유율 지향"]}점과 득점력 높음 ${scores["득점력 높음"]}점이 함께 높습니다. 수비 지역에서는 짧은 패스로 구조를 유지하고 공격 지역에서는 밸런스로 이미 좋은 마무리 선택을 제한하지 않습니다.`,
  };
}

function createPossessionRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "점유 전개 유지",
    formation: "4-3-3 홀딩",
    teamTactics: teamTactics({
      teamMentality: "보통",
      defensiveStyle: "밸런스",
      defensiveWidth: 5,
      defensiveDepth: 5,
      buildUpPlay: "짧은 패스",
      chanceCreation: "짧은 패스",
      attackingWidth: 6,
      playersInBox: 5,
      corners: 2,
      freeKicks: 2,
    }),
    playerInstructions: [
      instruction(["ST"], "연계형 스트라이커", tactics(["공격 지원", "타겟맨"], ["위치 선정", "중앙에 위치"]), 2, 2),
      instruction(["LW", "RW"], "폭 유지 윙어", tactics(["지원 움직임", "측면 대기"], ["공격 지원", "짧은 패스 지원"]), 2, 2),
      instruction(["LCM"], "전진 패서", tactics(["공격 지원", "공격 가담"], ["박스 지원", "패스 길 열기"]), 3, 2),
      instruction(["RCM"], "밸런스 미드필더", tactics(["공격 지원", "균형 잡힌 공격"], ["수비 위치", "센터 커버"]), 2, 2),
      instruction(["CDM"], "홀딩 미드필더", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction(["LB", "RB"], "지원 풀백", tactics(["공격 지원", "균형 잡힌 공격"], ["공격 위치", "중앙 지원"]), 2, 2),
    ],
    explanation: `점유율 지향 ${scores["점유율 지향"]}점이 높아 4-3-3 홀딩을 추천합니다. 두 구간 모두 짧은 패스를 사용하고 폭 6으로 중앙 패스가 막힐 때 측면 선택지도 남깁니다.`,
  };
}

function createDefenseStabilityRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "수비 안정 우선",
    formation: "4-1-4-1",
    teamTactics: teamTactics({
      teamMentality: "수비적",
      defensiveStyle: "후퇴",
      defensiveWidth: 4,
      defensiveDepth: 3,
      buildUpPlay: "밸런스",
      chanceCreation: "밸런스",
      attackingWidth: 5,
      playersInBox: 4,
      corners: 2,
      freeKicks: 1,
    }),
    playerInstructions: [
      instruction(["ST"], "원톱", tactics(["공격 지원", "균형 잡힌 공격"], ["위치 선정", "중앙에 위치"]), 2, 2),
      instruction(["LM", "RM"], "수비 지원", tactics(["수비 지원", "수비 가담"], ["지원 움직임", "측면 대기"]), 2, 3),
      instruction(["LCM"], "연결형 미드필더", tactics(["공격 지원", "균형 잡힌 공격"], ["수비 위치", "센터 커버"]), 2, 2),
      instruction(["RCM"], "수비 보조", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction(["CDM"], "전담 홀딩", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction(["LB", "RB"], "풀백", tactics(["공격 지원", "공격 시 후방 대기"], ["공격 위치", "오버랩 자제"]), 1, 3),
    ],
    explanation: `수비 불안 ${scores["수비 불안"]}점이 단독으로 높아 중앙 보호와 라인 안정이 우선입니다. 후퇴, 깊이 3, 크로스 시 박스 진입 성향 4와 프리킥 1로 공격 전환 때도 후방에 더 많은 선수를 남깁니다.`,
  };
}

function createBalancedRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "기본 밸런스",
    formation: "4-4-2",
    teamTactics: teamTactics({
      teamMentality: "보통",
      defensiveStyle: "밸런스",
      defensiveWidth: 5,
      defensiveDepth: 5,
      buildUpPlay: "밸런스",
      chanceCreation: "밸런스",
      attackingWidth: 5,
      playersInBox: 5,
      corners: 2,
      freeKicks: 2,
    }),
    playerInstructions: [
      instruction(["LS"], "침투형 공격수", tactics(["공격 지원", "뒤에서 침투"], ["위치 선정", "중앙에 위치"]), 3, 2),
      instruction(["RS"], "연계형 공격수", tactics(["공격 지원", "균형 잡힌 공격"], ["위치 선정", "중앙에 위치"]), 2, 2),
      instruction(["LM", "RM"], "측면 미드필더", tactics(["수비 지원", "수비 가담"], ["지원 움직임", "측면 대기"]), 2, 3),
      instruction(["LCM"], "수비 지원", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction(["RCM"], "밸런스 연결", tactics(["공격 지원", "균형 잡힌 공격"], ["수비 위치", "센터 커버"]), 2, 2),
      instruction(["LB", "RB"], "균형 풀백", tactics(["공격 지원", "균형 잡힌 공격"], ["공격 위치", "오버랩 자제"]), 2, 2),
    ],
    explanation: `공격적 ${scores["공격적"]}점, 점유율 지향 ${scores["점유율 지향"]}점, 수비 불안 ${scores["수비 불안"]}점이 한쪽으로 크게 치우치지 않습니다. 모든 팀 전술 축을 중앙값에 두어 사용자 체감 검증의 기준선으로 사용합니다.`,
  };
}

function createCompactPossessionAlternative(scores: PlayStyleScores): TacticPlan {
  return {
    title: "안정 점유 대안",
    formation: "4-2-3-1",
    teamTactics: teamTactics({
      teamMentality: "보통",
      defensiveStyle: "밸런스",
      defensiveWidth: 4,
      defensiveDepth: 4,
      buildUpPlay: "짧은 패스",
      chanceCreation: "짧은 패스",
      attackingWidth: 5,
      playersInBox: 4,
      corners: 2,
      freeKicks: 2,
    }),
    playerInstructions: [
      instruction(["ST"], "연계형 원톱", tactics(["공격 지원", "균형 잡힌 공격"], ["위치 선정", "중앙에 위치"]), 2, 2),
      instruction(["CAM"], "연결형 2선", tactics(["위치 선정", "자유 역할"], ["공격 지원", "전방 대기"]), 3, 2),
      instruction(["LAM", "RAM"], "지원형 윙어", tactics(["공격 지원", "짧은 패스 지원"], ["수비 지원", "수비 가담"]), 2, 3),
      instruction(["LDM", "RDM"], "후방 보호", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction(["LB", "RB"], "안정 풀백", tactics(["공격 지원", "공격 시 후방 대기"], ["공격 위치", "오버랩 자제"]), 1, 3),
    ],
    explanation: `뚜렷한 주성향이 약할 때 사용하는 보조 전술입니다. 점유율 지향 ${scores["점유율 지향"]}점과 수비 불안 ${scores["수비 불안"]}점을 고려해 폭과 깊이를 4로 좁히고 더블 볼란치 앞에서 짧게 연결합니다.`,
  };
}

function teamTactics(input: TeamTacticsInput): TeamTactics {
  return {
    schemaVersion: TACTIC_SCHEMA_VERSION,
    teamMentality: input.teamMentality,
    defensiveTactics: {
      defensiveStyle: input.defensiveStyle,
      width: input.defensiveWidth,
      depth: input.defensiveDepth,
    },
    offensiveTactics: {
      buildUpPlay: input.buildUpPlay,
      chanceCreation: input.chanceCreation,
      width: input.attackingWidth,
      playersInBox: input.playersInBox,
      corners: input.corners,
      freeKicks: input.freeKicks,
    },
  };
}

function instruction(
  positions: readonly PlayerPosition[],
  roleDescription: string,
  uiSettings: PersonalTacticSetting[],
  attackParticipation: ParticipationLevel,
  defenseParticipation: ParticipationLevel,
): PlayerInstruction {
  return {
    positions: [...positions],
    roleDescription,
    uiSettings,
    attackParticipation: participation(attackParticipation),
    defenseParticipation: participation(defenseParticipation),
  };
}

function tactics(...items: Array<[string, string]>): PersonalTacticSetting[] {
  return items.map(([group, value]) => ({ group, value, confirmed: false }));
}

function participation(value: ParticipationLevel) {
  return { value, confirmed: false } as const;
}

function createRecommendationFromRule(
  rule: TacticRule,
  scores: PlayStyleScores,
): TacticRecommendation {
  return createRecommendation(rule.id, rule.name, rule.recommend(scores));
}

function createRecommendation(
  templateId: TacticTemplateId,
  matchedRule: string,
  plan: TacticPlan,
): TacticRecommendation {
  const configHash = calculateTacticConfigHash(plan);
  const recommendation: TacticRecommendation = {
    metadata: {
      schemaVersion: TACTIC_SCHEMA_VERSION,
      gamePatchVersion: GAME_PATCH_VERSION,
      templateId,
      templateVersion: TACTIC_TEMPLATE_VERSION,
      configHash,
      validation: {
        overall: "partial",
        teamTactics: "confirmed",
        formation: "unconfirmed",
        personalTactics: "unconfirmed",
      },
    },
    matchedRule,
    ...plan,
  };

  assertValidTacticRecommendation(recommendation);
  return recommendation;
}

export function calculateTacticConfigHash(config: TacticConfiguration): TacticConfigHash {
  const hashInput: TacticConfiguration = {
    formation: config.formation,
    teamTactics: config.teamTactics,
    playerInstructions: config.playerInstructions,
  };
  const digest = createHash("sha256").update(stableStringify(hashInput), "utf8").digest("hex");
  return `sha256:${digest}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

function toScoreMap(analysis: PlayStyleAnalysis): PlayStyleScores {
  return {
    공격적: findScore(analysis, "공격적"),
    "수비 불안": findScore(analysis, "수비 불안"),
    "득점력 높음": findScore(analysis, "득점력 높음"),
    "점유율 지향": findScore(analysis, "점유율 지향"),
    "슈팅 빈도 높음": findScore(analysis, "슈팅 빈도 높음"),
  };
}

function findScore(analysis: PlayStyleAnalysis, label: PlayStyleLabel) {
  return analysis.styles.find((style) => style.label === label)?.score ?? DEFAULT_STYLE_SCORE;
}
