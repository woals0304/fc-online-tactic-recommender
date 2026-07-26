import type {
  ParticipationLevel,
  PersonalTacticSetting,
  PlayStyleAnalysis,
  PlayStyleLabel,
  TacticRecommendation,
  TacticRecommendationSet,
  TeamTactics,
} from "../fconline/types";

type TacticRuleId =
  | "risk-possession"
  | "risk-counter"
  | "attack-possession"
  | "attack-and-shoot"
  | "possession-scoring"
  | "possession-focused"
  | "defense-risk";

type TacticRule = {
  id: TacticRuleId;
  name: string;
  matches: (scores: PlayStyleScores) => boolean;
  recommend: (scores: PlayStyleScores) => TacticPlan;
};

type PlayStyleScores = Record<PlayStyleLabel, number>;
type TacticPlan = Omit<TacticRecommendation, "matchedRule">;

export const FORMATION_CANDIDATES = [
  "4-2-2-2",
  "4-3-2-1",
  "4-3-3 홀딩",
  "4-1-4-1",
  "5-2-3",
  "4-4-2",
  "4-2-3-1",
] as const;

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
    : createRecommendation("기본 밸런스", createBalancedRecommendation(scores));
  const alternative = getAlternativeRecommendation(scores, primaryRule?.id, primary.formation);

  return {
    primary,
    alternative,
  };
}

function getAlternativeRecommendation(
  scores: PlayStyleScores,
  primaryRuleId: TacticRuleId | undefined,
  primaryFormation: string,
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
    const balanced = createRecommendation("기본 밸런스", createBalancedRecommendation(scores));

    if (balanced.formation !== primaryFormation) {
      return balanced;
    }

    return createRecommendation("안정 점유 대안", createCompactPossessionAlternative(scores));
  }

  return createRecommendation("안정 점유 대안", createCompactPossessionAlternative(scores));
}

function createRiskPossessionRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "수비 보정 점유",
    formation: "4-1-4-1",
    teamTactics: teamTactics("수비적", "밸런스", 44, 43, "느린 빌드업", 52, 4, 2, 2),
    playerInstructions: [
      instruction("ST", "연계형 원톱", tactics(["공격 지원", "균형 잡힌 공격"], ["위치 선정", "중앙에 위치"]), 2, 2),
      instruction("LM/RM", "수비 가담 윙어", tactics(["수비 지원", "수비 가담"], ["지원 움직임", "측면 대기"]), 2, 3),
      instruction("CM 1", "전진 연결", tactics(["공격 지원", "균형 잡힌 공격"], ["박스 지원", "패스 길 열기"]), 2, 2),
      instruction("CM 2", "박스 보호", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction("CDM", "전담 홀딩", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction("LB/RB", "안정 풀백", tactics(["공격 지원", "공격 시 후방 대기"], ["공격 위치", "오버랩 자제"]), 1, 3),
    ],
    explanation: `수비 불안 ${scores["수비 불안"]}점과 점유율 지향 ${scores["점유율 지향"]}점이 함께 높아 무리한 압박보다 4-1-4-1로 중앙을 한 겹 더 막습니다. 수비 깊이 43과 박스 안쪽 선수 4명은 역습 공간을 줄이면서도 짧은 점유 전개를 이어가기 위한 보정값입니다.`,
  };
}

function createRiskCounterRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "수비 보정 역습",
    formation: "5-2-3",
    teamTactics: teamTactics("수비적", "후퇴", 42, 38, "빠른 빌드업", 58, 5, 2, 2),
    playerInstructions: [
      instruction("ST", "침투형 원톱", tactics(["공격 지원", "뒤에서 침투"], ["위치 선정", "중앙에 위치"]), 3, 2),
      instruction("LW/RW", "역습 윙어", tactics(["침투 지원", "뒤에서 침투"], ["지원 움직임", "측면 대기"]), 3, 2),
      instruction("CM 1", "수비 보호", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction("CM 2", "전환 패서", tactics(["공격 지원", "균형 잡힌 공격"], ["수비 위치", "센터 커버"]), 2, 2),
      instruction("LWB/RWB", "왕복 윙백", tactics(["공격 지원", "균형 잡힌 공격"], ["공격 위치", "오버랩"]), 2, 3),
      instruction("CB 3명", "박스 수비", tactics(["공격 지원", "기본 위치 유지"], ["수비 위치", "중앙 유지"]), 1, 3),
    ],
    explanation: `수비 불안 ${scores["수비 불안"]}점인데 공격적 ${scores["공격적"]}점도 높아 5-2-3을 추천합니다. 수비 깊이 38로 뒷공간을 줄이고, 빠른 빌드업으로 공을 뺏은 뒤 세 명의 전방 자원에게 빠르게 연결하는 체감에 맞춘 전술입니다.`,
  };
}

function createAttackPossessionRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "공격 점유 압박",
    formation: "4-3-2-1",
    teamTactics: teamTactics("공격적", "전방 압박", 50, 58, "밸런스", 48, 6, 3, 2),
    playerInstructions: [
      instruction("ST", "침투형 원톱", tactics(["공격 지원", "뒤에서 침투"], ["위치 선정", "중앙에 위치"]), 3, 2),
      instruction("LF/RF", "하프스페이스 공격수", tactics(["지원 움직임", "안쪽으로 파고들기"], ["침투 지원", "뒤에서 침투"]), 3, 2),
      instruction("CM 1", "전진 지원", tactics(["공격 지원", "공격 가담"], ["박스 지원", "패스 길 열기"]), 3, 2),
      instruction("CM 2", "균형 연결", tactics(["공격 지원", "균형 잡힌 공격"], ["수비 위치", "센터 커버"]), 2, 2),
      instruction("CM 3", "수비 보험", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction("LB/RB", "균형 풀백", tactics(["공격 지원", "균형 잡힌 공격"], ["공격 위치", "오버랩 자제"]), 2, 2),
    ],
    explanation: `공격적 ${scores["공격적"]}점과 점유율 지향 ${scores["점유율 지향"]}점이 높고 수비 불안 ${scores["수비 불안"]}점은 위험선 아래라 4-3-2-1을 씁니다. 중앙과 하프스페이스에 선수를 몰아 짧은 패스 후 침투 각을 만들고, 수비 깊이 58로 지나친 뒷공간 노출은 피합니다.`,
  };
}

function createAttackAndShootRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "투톱 슈팅 강화",
    formation: "4-2-2-2",
    teamTactics: teamTactics("공격적", "전방 압박", 52, 56, "빠른 빌드업", 54, 7, 3, 3),
    playerInstructions: [
      instruction("ST 1", "침투형 공격수", tactics(["공격 지원", "뒤에서 침투"], ["위치 선정", "중앙에 위치"]), 3, 2),
      instruction("ST 2", "연계형 공격수", tactics(["공격 지원", "균형 잡힌 공격"], ["위치 선정", "중앙에 위치"]), 3, 2),
      instruction("LAM/RAM", "중앙 침투 2선", tactics(["지원 움직임", "안쪽으로 파고들기"], ["침투 지원", "뒤에서 침투"]), 3, 2),
      instruction("CDM 1", "수비 보호", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction("CDM 2", "전개 지원", tactics(["공격 지원", "균형 잡힌 공격"], ["수비 위치", "센터 커버"]), 2, 2),
      instruction("LB/RB", "균형 풀백", tactics(["공격 지원", "균형 잡힌 공격"], ["공격 위치", "오버랩 자제"]), 2, 2),
    ],
    explanation: `공격적 ${scores["공격적"]}점, 슈팅 빈도 높음 ${scores["슈팅 빈도 높음"]}점이 강해 4-2-2-2로 박스 주변 슈팅 루트를 늘립니다. 박스 안쪽 선수 7명과 빠른 빌드업은 세컨볼과 컷백 각을 늘리기 위한 값이고, 수비 깊이는 56으로 과한 전방 압박을 피했습니다.`,
  };
}

function createPossessionScoringRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "점유 득점 유지",
    formation: "4-3-3 홀딩",
    teamTactics: teamTactics("보통", "밸런스", 48, 52, "느린 빌드업", 56, 5, 2, 2),
    playerInstructions: [
      instruction("ST", "연계 마무리", tactics(["공격 지원", "균형 잡힌 공격"], ["위치 선정", "중앙에 위치"]), 3, 2),
      instruction("LW/RW", "폭 유지 윙어", tactics(["지원 움직임", "측면 대기"], ["공격 지원", "짧은 패스 지원"]), 2, 2),
      instruction("CM 1", "침투 미드필더", tactics(["공격 지원", "공격 가담"], ["박스 지원", "페널티 박스 안으로 침투"]), 3, 2),
      instruction("CM 2", "전개 미드필더", tactics(["공격 지원", "균형 잡힌 공격"], ["박스 지원", "패스 길 열기"]), 2, 2),
      instruction("CDM", "후방 조율", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction("LB/RB", "지원 풀백", tactics(["공격 지원", "균형 잡힌 공격"], ["공격 위치", "오버랩 자제"]), 2, 2),
    ],
    explanation: `점유율 지향 ${scores["점유율 지향"]}점과 득점력 높음 ${scores["득점력 높음"]}점이 함께 높아 4-3-3 홀딩으로 점유 구조를 유지합니다. 느린 빌드업으로 공 소유 시간을 살리고, 박스 안쪽 선수 5명으로 이미 좋은 마무리 성향이 박스 근처에서 끊기지 않게 했습니다.`,
  };
}

function createPossessionRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "점유 전개 유지",
    formation: "4-3-3 홀딩",
    teamTactics: teamTactics("보통", "밸런스", 50, 50, "느린 빌드업", 55, 5, 2, 2),
    playerInstructions: [
      instruction("ST", "연계형 스트라이커", tactics(["공격 지원", "타겟맨"], ["위치 선정", "중앙에 위치"]), 2, 2),
      instruction("LW/RW", "폭 유지 윙어", tactics(["지원 움직임", "측면 대기"], ["공격 지원", "짧은 패스 지원"]), 2, 2),
      instruction("CM 1", "전진 패서", tactics(["공격 지원", "공격 가담"], ["박스 지원", "패스 길 열기"]), 3, 2),
      instruction("CM 2", "밸런스 미드필더", tactics(["공격 지원", "균형 잡힌 공격"], ["수비 위치", "센터 커버"]), 2, 2),
      instruction("CDM", "홀딩 미드필더", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction("LB/RB", "지원 풀백", tactics(["공격 지원", "균형 잡힌 공격"], ["공격 위치", "중앙 지원"]), 2, 2),
    ],
    explanation: `점유율 지향 ${scores["점유율 지향"]}점이 높아 공을 오래 소유하는 전개가 어울립니다. 4-3-3 홀딩은 CDM이 역습을 막고 CM 두 명이 패스 선택지를 만들어 주기 쉬워, 느린 빌드업과 보통 팀 성향의 체감이 잘 살아납니다.`,
  };
}

function createDefenseStabilityRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "수비 안정 우선",
    formation: "4-1-4-1",
    teamTactics: teamTactics("수비적", "밸런스", 44, 40, "밸런스", 50, 4, 2, 1),
    playerInstructions: [
      instruction("ST", "원톱", tactics(["공격 지원", "균형 잡힌 공격"], ["위치 선정", "중앙에 위치"]), 2, 2),
      instruction("LM/RM", "수비 지원", tactics(["수비 지원", "수비 가담"], ["지원 움직임", "측면 대기"]), 2, 3),
      instruction("CM 1", "연결형 미드필더", tactics(["공격 지원", "균형 잡힌 공격"], ["수비 위치", "센터 커버"]), 2, 2),
      instruction("CM 2", "수비 보조", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction("CDM", "전담 홀딩", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction("LB/RB", "풀백", tactics(["공격 지원", "공격 시 후방 대기"], ["공격 위치", "오버랩 자제"]), 1, 3),
    ],
    explanation: `수비 불안 ${scores["수비 불안"]}점이 단독으로 높아 중앙 보호와 라인 안정이 우선입니다. 4-1-4-1, 수비 깊이 40, 프리킥 1은 세트피스와 역습 때 남는 선수를 늘려 실점 리스크를 줄이기 위한 보수 설정입니다.`,
  };
}

function createBalancedRecommendation(scores: PlayStyleScores): TacticPlan {
  return {
    title: "기본 밸런스",
    formation: "4-4-2",
    teamTactics: teamTactics("보통", "밸런스", 50, 50, "밸런스", 50, 5, 2, 2),
    playerInstructions: [
      instruction("ST 1", "침투형 공격수", tactics(["공격 지원", "뒤에서 침투"], ["위치 선정", "중앙에 위치"]), 3, 2),
      instruction("ST 2", "연계형 공격수", tactics(["공격 지원", "균형 잡힌 공격"], ["위치 선정", "중앙에 위치"]), 2, 2),
      instruction("LM/RM", "측면 미드필더", tactics(["수비 지원", "수비 가담"], ["지원 움직임", "측면 대기"]), 2, 3),
      instruction("CM 1", "수비 지원", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction("CM 2", "밸런스 연결", tactics(["공격 지원", "균형 잡힌 공격"], ["수비 위치", "센터 커버"]), 2, 2),
      instruction("LB/RB", "균형 풀백", tactics(["공격 지원", "균형 잡힌 공격"], ["공격 위치", "오버랩 자제"]), 2, 2),
    ],
    explanation: `공격적 ${scores["공격적"]}점, 점유율 지향 ${scores["점유율 지향"]}점, 수비 불안 ${scores["수비 불안"]}점을 함께 보면 한쪽으로 크게 치우치지 않습니다. 4-4-2는 두 줄 수비와 투톱 전개가 모두 가능해 성향 데이터가 애매할 때 체감 리스크가 낮은 기본값입니다.`,
  };
}

function createCompactPossessionAlternative(scores: PlayStyleScores): TacticPlan {
  return {
    title: "안정 점유 대안",
    formation: "4-2-3-1",
    teamTactics: teamTactics("보통", "밸런스", 48, 48, "느린 빌드업", 52, 4, 2, 2),
    playerInstructions: [
      instruction("ST", "연계형 원톱", tactics(["공격 지원", "균형 잡힌 공격"], ["위치 선정", "중앙에 위치"]), 2, 2),
      instruction("CAM", "연결형 2선", tactics(["위치 선정", "자유 역할"], ["공격 지원", "전방 대기"]), 3, 2),
      instruction("LAM/RAM", "지원형 윙어", tactics(["공격 지원", "짧은 패스 지원"], ["수비 지원", "수비 가담"]), 2, 3),
      instruction("CDM 2명", "후방 보호", tactics(["공격 지원", "공격 시 후방 대기"], ["수비 위치", "센터 커버"]), 1, 3),
      instruction("LB/RB", "안정 풀백", tactics(["공격 지원", "공격 시 후방 대기"], ["공격 위치", "오버랩 자제"]), 1, 3),
    ],
    explanation: `뚜렷한 주성향이 약할 때 사용할 수 있는 보조 전술입니다. 점유율 지향 ${scores["점유율 지향"]}점과 수비 불안 ${scores["수비 불안"]}점을 고려해 4-2-3-1의 더블 볼란치로 후방 안정과 짧은 연결을 우선합니다.`,
  };
}

function teamTactics(
  teamMentality: string,
  defensiveStyle: string,
  defensiveWidth: number,
  defensiveDepth: number,
  buildUpPlay: string,
  attackingWidth: number,
  playersInBox: number,
  corners: number,
  freeKicks: number,
): TeamTactics {
  return {
    teamMentality,
    defensiveTactics: {
      defensiveStyle,
      width: defensiveWidth,
      depth: defensiveDepth,
    },
    offensiveTactics: {
      buildUpPlay,
      width: attackingWidth,
      playersInBox,
      corners,
      freeKicks,
    },
  };
}

function instruction(
  position: string,
  role: string,
  personalTactics: PersonalTacticSetting[],
  attackParticipation: ParticipationLevel,
  defenseParticipation: ParticipationLevel,
) {
  return {
    position,
    role,
    personalTactics,
    attackParticipation,
    defenseParticipation,
  };
}

function tactics(...items: Array<[string, string]>): PersonalTacticSetting[] {
  return items.map(([menu, value]) => ({ menu, value }));
}

function createRecommendationFromRule(
  rule: TacticRule,
  scores: PlayStyleScores,
): TacticRecommendation {
  return createRecommendation(rule.name, rule.recommend(scores));
}

function createRecommendation(matchedRule: string, plan: TacticPlan): TacticRecommendation {
  return {
    matchedRule,
    ...plan,
  };
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
