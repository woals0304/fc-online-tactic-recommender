import type {
  NormalizedMatch,
  PlayStyleAnalysis,
  PlayStyleLabel,
  PlayStyleResult,
} from "../fconline/types";

type AverageStats = {
  goalsFor: number | null;
  goalsAgainst: number | null;
  shots: number | null;
  effectiveShots: number | null;
  possession: number | null;
  tackleSuccessRate: number | null;
  dribbles: number | null;
  minimumSamples: number;
  commonSamples: {
    aggressive: number;
    defenseRisk: number;
    highScoring: number;
  };
};

const ANALYSIS_METRIC_READERS = [
  (match: NormalizedMatch) => match.score.for,
  (match: NormalizedMatch) => match.score.against,
  (match: NormalizedMatch) => match.stats.shots,
  (match: NormalizedMatch) => match.stats.effectiveShots,
  (match: NormalizedMatch) => match.stats.possession,
  (match: NormalizedMatch) => match.stats.tackleSuccessRate,
  (match: NormalizedMatch) => match.stats.dribbles,
] as const;

const CONFIDENCE_THRESHOLDS = {
  mediumMatchCount: 3,
  highMatchCount: 5,
  mediumCoverage: 50,
  highCoverage: 80,
} as const;
const MINIMUM_METRIC_SAMPLES = 3;

export const PLAY_STYLE_CRITERIA = {
  aggressive: {
    label: "공격적",
    shotBaseline: 4,
    shotTarget: 8,
    dribbleBaseline: 8,
    dribbleTarget: 18,
  },
  defenseRisk: {
    label: "수비 불안",
    goalAgainstBaseline: 0.8,
    goalAgainstTarget: 2,
    tackleSafeTarget: 75,
    tackleRiskTarget: 55,
  },
  highScoring: {
    label: "득점력 높음",
    goalBaseline: 0.8,
    goalTarget: 2,
    effectiveShotBaseline: 2,
    effectiveShotTarget: 5,
  },
  possessionFocused: {
    label: "점유율 지향",
    possessionBaseline: 45,
    possessionTarget: 53,
  },
  highShooting: {
    label: "슈팅 빈도 높음",
    shotBaseline: 4,
    shotTarget: 8,
  },
} as const;

export function analyzePlayStyle(
  matches: NormalizedMatch[],
  requestedMatchCount = matches.length,
): PlayStyleAnalysis {
  const normalizedRequestedMatchCount = normalizeRequestedMatchCount(
    requestedMatchCount,
    matches.length,
  );
  const averages = getAverageStats(matches, normalizedRequestedMatchCount);
  const styles = [
    analyzeAggressive(averages),
    analyzeDefenseRisk(averages),
    analyzeHighScoring(averages),
    analyzePossessionFocused(averages),
    analyzeHighShooting(averages),
  ];

  return {
    matchCount: matches.length,
    requestedMatchCount: normalizedRequestedMatchCount,
    confidence: getAnalysisConfidence(matches, normalizedRequestedMatchCount, styles),
    styles,
  };
}

function analyzeAggressive(averages: AverageStats): PlayStyleResult {
  const criteria = PLAY_STYLE_CRITERIA.aggressive;
  const shotScore = scoreHigherIsStronger(
    averages.shots,
    criteria.shotBaseline,
    criteria.shotTarget,
  );
  const dribbleScore = scoreHigherIsStronger(
    averages.dribbles,
    criteria.dribbleBaseline,
    criteria.dribbleTarget,
  );

  return {
    label: criteria.label,
    score: averageCompositeScores(
      [shotScore, dribbleScore],
      averages.commonSamples.aggressive,
      averages.minimumSamples,
    ),
    reason: `평균 슈팅 ${formatMetric(averages.shots, "회")}(기준 ${criteria.shotTarget}회), 평균 드리블 ${formatMetric(averages.dribbles, "회")}(기준 ${criteria.dribbleTarget}회)입니다.`,
  };
}

function analyzeDefenseRisk(averages: AverageStats): PlayStyleResult {
  const criteria = PLAY_STYLE_CRITERIA.defenseRisk;
  const concedingScore = scoreHigherIsStronger(
    averages.goalsAgainst,
    criteria.goalAgainstBaseline,
    criteria.goalAgainstTarget,
  );
  const tackleRiskScore = scoreLowerIsStronger(
    averages.tackleSuccessRate,
    criteria.tackleSafeTarget,
    criteria.tackleRiskTarget,
  );

  return {
    label: criteria.label,
    score: averageCompositeScores(
      [concedingScore, tackleRiskScore],
      averages.commonSamples.defenseRisk,
      averages.minimumSamples,
    ),
    reason: `평균 실점 ${formatMetric(averages.goalsAgainst, "점")}(위험 기준 ${criteria.goalAgainstTarget}점), 태클 성공률 ${formatMetric(averages.tackleSuccessRate, "%")}(위험 기준 ${criteria.tackleRiskTarget}% 이하)입니다.`,
  };
}

function analyzeHighScoring(averages: AverageStats): PlayStyleResult {
  const criteria = PLAY_STYLE_CRITERIA.highScoring;
  const goalScore = scoreHigherIsStronger(
    averages.goalsFor,
    criteria.goalBaseline,
    criteria.goalTarget,
  );
  const effectiveShotScore = scoreHigherIsStronger(
    averages.effectiveShots,
    criteria.effectiveShotBaseline,
    criteria.effectiveShotTarget,
  );

  return {
    label: criteria.label,
    score: averageCompositeScores(
      [goalScore, effectiveShotScore],
      averages.commonSamples.highScoring,
      averages.minimumSamples,
    ),
    reason: `평균 득점 ${formatMetric(averages.goalsFor, "점")}(기준 ${criteria.goalTarget}점), 평균 유효 슈팅 ${formatMetric(averages.effectiveShots, "회")}(기준 ${criteria.effectiveShotTarget}회)입니다.`,
  };
}

function analyzePossessionFocused(averages: AverageStats): PlayStyleResult {
  const criteria = PLAY_STYLE_CRITERIA.possessionFocused;

  return {
    label: criteria.label,
    score: averageScores([
      scoreHigherIsStronger(
        averages.possession,
        criteria.possessionBaseline,
        criteria.possessionTarget,
      ),
    ]),
    reason: `평균 점유율 ${formatMetric(averages.possession, "%")}(기준 ${criteria.possessionTarget}%)입니다.`,
  };
}

function analyzeHighShooting(averages: AverageStats): PlayStyleResult {
  const criteria = PLAY_STYLE_CRITERIA.highShooting;

  return {
    label: criteria.label,
    score: averageScores([
      scoreHigherIsStronger(averages.shots, criteria.shotBaseline, criteria.shotTarget),
    ]),
    reason: `평균 슈팅 ${formatMetric(averages.shots, "회")}(기준 ${criteria.shotTarget}회)입니다.`,
  };
}

function getAverageStats(
  matches: NormalizedMatch[],
  requestedMatchCount: number,
): AverageStats {
  const minimumSamples = Math.min(requestedMatchCount, MINIMUM_METRIC_SAMPLES);

  return {
    goalsFor: average(matches.map((match) => match.score.for), minimumSamples),
    goalsAgainst: average(matches.map((match) => match.score.against), minimumSamples),
    shots: average(matches.map((match) => match.stats.shots), minimumSamples),
    effectiveShots: average(
      matches.map((match) => match.stats.effectiveShots),
      minimumSamples,
    ),
    possession: average(matches.map((match) => match.stats.possession), minimumSamples),
    tackleSuccessRate: average(
      matches.map((match) => match.stats.tackleSuccessRate),
      minimumSamples,
    ),
    dribbles: average(matches.map((match) => match.stats.dribbles), minimumSamples),
    minimumSamples,
    commonSamples: {
      aggressive: countCommonSamples(matches, [
        (match) => match.stats.shots,
        (match) => match.stats.dribbles,
      ]),
      defenseRisk: countCommonSamples(matches, [
        (match) => match.score.against,
        (match) => match.stats.tackleSuccessRate,
      ]),
      highScoring: countCommonSamples(matches, [
        (match) => match.score.for,
        (match) => match.stats.effectiveShots,
      ]),
    },
  };
}

function countCommonSamples(
  matches: NormalizedMatch[],
  readMetrics: Array<(match: NormalizedMatch) => number | null>,
) {
  return matches.filter((match) =>
    readMetrics.every((readMetric) => {
      const value = readMetric(match);
      return value !== null && Number.isFinite(value);
    }),
  ).length;
}

function average(values: Array<number | null>, minimumSamples: number) {
  const availableValues = values.filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );

  if (availableValues.length === 0 || availableValues.length < minimumSamples) {
    return null;
  }

  return availableValues.reduce((sum, value) => sum + value, 0) / availableValues.length;
}

function scoreHigherIsStronger(value: number | null, baseline: number, target: number) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return clampScore(((value - baseline) / (target - baseline)) * 100);
}

function scoreLowerIsStronger(value: number | null, safeTarget: number, riskTarget: number) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return clampScore(((safeTarget - value) / (safeTarget - riskTarget)) * 100);
}

function averageScores(scores: Array<number | null>) {
  const availableScores = scores.filter((score): score is number => score !== null);

  if (availableScores.length === 0 || availableScores.length !== scores.length) {
    return null;
  }

  const rawScore = availableScores.reduce((sum, score) => sum + score, 0) / availableScores.length;
  return Math.round(rawScore);
}

function averageCompositeScores(
  scores: Array<number | null>,
  commonSampleCount: number,
  minimumSamples: number,
) {
  if (commonSampleCount < minimumSamples) {
    return null;
  }

  return averageScores(scores);
}

function clampScore(value: number) {
  return Math.min(Math.max(value, 0), 100);
}

function formatMetric(value: number | null, unit: string) {
  if (value === null) {
    return "정보 없음";
  }

  return `${formatNumber(value)}${unit}`;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getAnalysisConfidence(
  matches: NormalizedMatch[],
  requestedMatchCount: number,
  styles: PlayStyleResult[],
): PlayStyleAnalysis["confidence"] {
  const totalDataPoints = requestedMatchCount * ANALYSIS_METRIC_READERS.length;
  const availableDataPoints = matches.reduce(
    (count, match) =>
      count +
      ANALYSIS_METRIC_READERS.filter((readMetric) => {
        const value = readMetric(match);
        return value !== null && Number.isFinite(value);
      }).length,
    0,
  );
  const coverage =
    totalDataPoints === 0 ? 0 : Math.round((availableDataPoints / totalDataPoints) * 100);

  if (
    matches.length >= CONFIDENCE_THRESHOLDS.highMatchCount &&
    coverage >= CONFIDENCE_THRESHOLDS.highCoverage &&
    styles.every((style) => style.score !== null)
  ) {
    return {
      level: "high",
      coverage,
      message: `${formatMatchCoverage(matches.length, requestedMatchCount)}의 분석 지표가 충분히 확보되었습니다(커버리지 ${coverage}%).`,
    };
  }

  if (
    matches.length >= CONFIDENCE_THRESHOLDS.mediumMatchCount &&
    coverage >= CONFIDENCE_THRESHOLDS.mediumCoverage
  ) {
    return {
      level: "medium",
      coverage,
      message: `${formatMatchCoverage(matches.length, requestedMatchCount)}를 분석했지만 일부 지표가 제한적입니다(커버리지 ${coverage}%).`,
    };
  }

  if (matches.length === 0) {
    return {
      level: "low",
      coverage,
      message: "분석할 경기 데이터가 없습니다.",
    };
  }

  return {
    level: "low",
    coverage,
    message: `경기 수 또는 분석 지표가 부족해 결과 신뢰도가 낮습니다(${formatMatchCoverage(matches.length, requestedMatchCount)}, 커버리지 ${coverage}%).`,
  };
}

function normalizeRequestedMatchCount(requestedMatchCount: number, actualMatchCount: number) {
  if (!Number.isFinite(requestedMatchCount)) {
    return actualMatchCount;
  }

  return Math.max(actualMatchCount, Math.floor(requestedMatchCount));
}

function formatMatchCoverage(actualMatchCount: number, requestedMatchCount: number) {
  if (actualMatchCount === requestedMatchCount) {
    return `최근 ${actualMatchCount}경기`;
  }

  return `요청 ${requestedMatchCount}경기 중 ${actualMatchCount}경기`;
}

export function getPlayStyleLabels(): PlayStyleLabel[] {
  return [
    PLAY_STYLE_CRITERIA.aggressive.label,
    PLAY_STYLE_CRITERIA.defenseRisk.label,
    PLAY_STYLE_CRITERIA.highScoring.label,
    PLAY_STYLE_CRITERIA.possessionFocused.label,
    PLAY_STYLE_CRITERIA.highShooting.label,
  ];
}
