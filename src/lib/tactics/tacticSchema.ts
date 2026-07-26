import type {
  AttackingStyle,
  DefensiveStyle,
  FormationCandidate,
  GamePatchVersion,
  PlayerPosition,
  Scale10,
  Scale5,
  TacticRecommendation,
  TacticRecommendationSet,
  TacticSchemaVersion,
  TacticTemplateId,
  TacticTemplateVersion,
  TeamMentality,
  TeamTactics,
} from "../fconline/types";

export const TACTIC_SCHEMA_VERSION: TacticSchemaVersion = "fc-online-12nf-2026-03-26";
export const GAME_PATCH_VERSION: GamePatchVersion = "12th-next-field-2026-03-26";
export const TACTIC_TEMPLATE_VERSION: TacticTemplateVersion = "1.0.0";

export const TEAM_MENTALITIES = [
  "전원 수비",
  "매우 수비적",
  "수비적",
  "보통",
  "공격적",
  "매우 공격적",
  "전원 공격",
] as const satisfies readonly TeamMentality[];

export const DEFENSIVE_STYLES = [
  "후퇴",
  "밸런스",
  "볼 터치 실수 시 압박",
  "공 뺏긴 직후 압박",
  "지속적인 압박",
] as const satisfies readonly DefensiveStyle[];

export const ATTACKING_STYLES = [
  "짧은 패스",
  "밸런스",
  "긴 패스",
  "빠른 빌드업",
] as const satisfies readonly AttackingStyle[];

export const FORMATION_CANDIDATES = [
  "4-2-2-2",
  "4-3-2-1",
  "4-3-3 홀딩",
  "4-1-4-1",
  "5-2-3",
  "4-4-2",
  "4-2-3-1",
] as const satisfies readonly FormationCandidate[];

export const TACTIC_TEMPLATE_IDS = [
  "risk-possession",
  "risk-counter",
  "attack-possession",
  "attack-and-shoot",
  "possession-scoring",
  "possession-focused",
  "defense-risk",
  "balanced",
  "compact-possession-alternative",
] as const satisfies readonly TacticTemplateId[];

export const PLAYER_POSITIONS = [
  "ST",
  "LS",
  "RS",
  "LW",
  "RW",
  "LF",
  "RF",
  "LM",
  "RM",
  "LAM",
  "RAM",
  "CAM",
  "LCM",
  "CM",
  "RCM",
  "CDM",
  "LDM",
  "RDM",
  "LWB",
  "RWB",
  "LB",
  "RB",
  "LCB",
  "CB",
  "RCB",
] as const satisfies readonly PlayerPosition[];

const SHA256_CONFIG_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;

export type TacticValidationError = {
  path: string;
  message: string;
};

export type TacticValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: TacticValidationError[] };

type MutableValidationContext = {
  errors: TacticValidationError[];
};

export function validateTeamTactics(value: unknown): TacticValidationResult {
  const context: MutableValidationContext = { errors: [] };
  validateTeamTacticsInto(value, "teamTactics", context);
  return toResult(context);
}

export function isTeamTactics(value: unknown): value is TeamTactics {
  return validateTeamTactics(value).valid;
}

export function validateTacticRecommendation(value: unknown): TacticValidationResult {
  const context: MutableValidationContext = { errors: [] };

  if (!isRecord(value)) {
    addError(context, "$", "추천 전술은 객체여야 합니다.");
    return toResult(context);
  }

  validateMetadata(value.metadata, "metadata", context);
  validateNonEmptyString(value.matchedRule, "matchedRule", context);
  validateNonEmptyString(value.title, "title", context);
  validateEnum(value.formation, FORMATION_CANDIDATES, "formation", context);
  validateTeamTacticsInto(value.teamTactics, "teamTactics", context);
  validatePlayerInstructions(value.playerInstructions, "playerInstructions", context);
  validateNonEmptyString(value.explanation, "explanation", context);

  return toResult(context);
}

export function isTacticRecommendation(value: unknown): value is TacticRecommendation {
  return validateTacticRecommendation(value).valid;
}

export function validateTacticRecommendationSet(value: unknown): TacticValidationResult {
  const context: MutableValidationContext = { errors: [] };

  if (!isRecord(value)) {
    addError(context, "$", "추천 전술 세트는 객체여야 합니다.");
    return toResult(context);
  }

  appendNestedResult(context, "primary", validateTacticRecommendation(value.primary));
  appendNestedResult(context, "alternative", validateTacticRecommendation(value.alternative));

  if (isRecord(value.primary) && isRecord(value.alternative)) {
    const primaryMetadata = value.primary.metadata;
    const alternativeMetadata = value.alternative.metadata;

    if (
      isRecord(primaryMetadata) &&
      isRecord(alternativeMetadata) &&
      primaryMetadata.templateId === alternativeMetadata.templateId
    ) {
      addError(context, "alternative.metadata.templateId", "주전술과 다른 템플릿이어야 합니다.");
    }

    if (value.primary.formation === value.alternative.formation) {
      addError(context, "alternative.formation", "주전술과 다른 포메이션이어야 합니다.");
    }
  }

  return toResult(context);
}

export function isTacticRecommendationSet(value: unknown): value is TacticRecommendationSet {
  return validateTacticRecommendationSet(value).valid;
}

export function assertValidTacticRecommendationSet(
  value: unknown,
): asserts value is TacticRecommendationSet {
  const result = validateTacticRecommendationSet(value);

  if (!result.valid) {
    const details = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
    throw new Error(`유효하지 않은 추천 전술 세트입니다. ${details}`);
  }
}

export function assertValidTacticRecommendation(
  value: unknown,
): asserts value is TacticRecommendation {
  const result = validateTacticRecommendation(value);

  if (!result.valid) {
    const details = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
    throw new Error(`유효하지 않은 전술 템플릿입니다. ${details}`);
  }
}

function validateMetadata(
  value: unknown,
  path: string,
  context: MutableValidationContext,
) {
  if (!isRecord(value)) {
    addError(context, path, "메타데이터는 객체여야 합니다.");
    return;
  }

  validateLiteral(value.schemaVersion, TACTIC_SCHEMA_VERSION, `${path}.schemaVersion`, context);
  validateLiteral(value.gamePatchVersion, GAME_PATCH_VERSION, `${path}.gamePatchVersion`, context);
  validateEnum(value.templateId, TACTIC_TEMPLATE_IDS, `${path}.templateId`, context);
  validateLiteral(
    value.templateVersion,
    TACTIC_TEMPLATE_VERSION,
    `${path}.templateVersion`,
    context,
  );
  validateConfigHash(value.configHash, `${path}.configHash`, context);

  if (!isRecord(value.validation)) {
    addError(context, `${path}.validation`, "검증 상태는 객체여야 합니다.");
    return;
  }

  validateLiteral(value.validation.overall, "partial", `${path}.validation.overall`, context);
  validateLiteral(
    value.validation.teamTactics,
    "confirmed",
    `${path}.validation.teamTactics`,
    context,
  );
  validateLiteral(
    value.validation.formation,
    "unconfirmed",
    `${path}.validation.formation`,
    context,
  );
  validateLiteral(
    value.validation.personalTactics,
    "unconfirmed",
    `${path}.validation.personalTactics`,
    context,
  );
}

function validateTeamTacticsInto(
  value: unknown,
  path: string,
  context: MutableValidationContext,
) {
  if (!isRecord(value)) {
    addError(context, path, "팀 전술은 객체여야 합니다.");
    return;
  }

  validateLiteral(value.schemaVersion, TACTIC_SCHEMA_VERSION, `${path}.schemaVersion`, context);
  validateEnum(value.teamMentality, TEAM_MENTALITIES, `${path}.teamMentality`, context);

  if (!isRecord(value.defensiveTactics)) {
    addError(context, `${path}.defensiveTactics`, "수비 전술은 객체여야 합니다.");
  } else {
    validateEnum(
      value.defensiveTactics.defensiveStyle,
      DEFENSIVE_STYLES,
      `${path}.defensiveTactics.defensiveStyle`,
      context,
    );
    validateIntegerRange(
      value.defensiveTactics.width,
      1,
      10,
      `${path}.defensiveTactics.width`,
      context,
    );
    validateIntegerRange(
      value.defensiveTactics.depth,
      1,
      10,
      `${path}.defensiveTactics.depth`,
      context,
    );
  }

  if (!isRecord(value.offensiveTactics)) {
    addError(context, `${path}.offensiveTactics`, "공격 전술은 객체여야 합니다.");
  } else {
    validateEnum(
      value.offensiveTactics.buildUpPlay,
      ATTACKING_STYLES,
      `${path}.offensiveTactics.buildUpPlay`,
      context,
    );
    validateEnum(
      value.offensiveTactics.chanceCreation,
      ATTACKING_STYLES,
      `${path}.offensiveTactics.chanceCreation`,
      context,
    );
    validateIntegerRange(
      value.offensiveTactics.width,
      1,
      10,
      `${path}.offensiveTactics.width`,
      context,
    );
    validateIntegerRange(
      value.offensiveTactics.playersInBox,
      1,
      10,
      `${path}.offensiveTactics.playersInBox`,
      context,
    );
    validateIntegerRange(
      value.offensiveTactics.corners,
      1,
      5,
      `${path}.offensiveTactics.corners`,
      context,
    );
    validateIntegerRange(
      value.offensiveTactics.freeKicks,
      1,
      5,
      `${path}.offensiveTactics.freeKicks`,
      context,
    );
  }
}

function validatePlayerInstructions(
  value: unknown,
  path: string,
  context: MutableValidationContext,
) {
  if (!Array.isArray(value) || value.length === 0) {
    addError(context, path, "개인 전술은 하나 이상의 항목을 가진 배열이어야 합니다.");
    return;
  }

  const assignedPositions = new Set<PlayerPosition>();

  value.forEach((instruction, index) => {
    const instructionPath = `${path}[${index}]`;

    if (!isRecord(instruction)) {
      addError(context, instructionPath, "개인 전술 항목은 객체여야 합니다.");
      return;
    }

    validatePositions(
      instruction.positions,
      `${instructionPath}.positions`,
      assignedPositions,
      context,
    );
    validateNonEmptyString(
      instruction.roleDescription,
      `${instructionPath}.roleDescription`,
      context,
    );

    if (!Array.isArray(instruction.uiSettings) || instruction.uiSettings.length === 0) {
      addError(
        context,
        `${instructionPath}.uiSettings`,
        "UI 설정 후보는 하나 이상의 항목을 가진 배열이어야 합니다.",
      );
    } else {
      instruction.uiSettings.forEach((setting, settingIndex) => {
        const settingPath = `${instructionPath}.uiSettings[${settingIndex}]`;

        if (!isRecord(setting)) {
          addError(context, settingPath, "UI 설정은 객체여야 합니다.");
          return;
        }

        validateNonEmptyString(setting.group, `${settingPath}.group`, context);
        validateNonEmptyString(setting.value, `${settingPath}.value`, context);
        validateLiteral(setting.confirmed, false, `${settingPath}.confirmed`, context);
      });
    }

    validateParticipation(
      instruction.attackParticipation,
      `${instructionPath}.attackParticipation`,
      context,
    );
    validateParticipation(
      instruction.defenseParticipation,
      `${instructionPath}.defenseParticipation`,
      context,
    );
  });
}

function validateParticipation(
  value: unknown,
  path: string,
  context: MutableValidationContext,
) {
  if (!isRecord(value)) {
    addError(context, path, "참여도는 값과 확인 상태를 가진 객체여야 합니다.");
    return;
  }

  validateInteger(value.value, `${path}.value`, context);
  validateLiteral(value.confirmed, false, `${path}.confirmed`, context);
}

function validatePositions(
  value: unknown,
  path: string,
  assignedPositions: Set<PlayerPosition>,
  context: MutableValidationContext,
) {
  if (!Array.isArray(value) || value.length === 0) {
    addError(context, path, "포지션은 하나 이상의 항목을 가진 배열이어야 합니다.");
    return;
  }

  value.forEach((position, index) => {
    const positionPath = `${path}[${index}]`;
    validateEnum(position, PLAYER_POSITIONS, positionPath, context);

    if (typeof position === "string" && PLAYER_POSITIONS.includes(position as PlayerPosition)) {
      if (assignedPositions.has(position as PlayerPosition)) {
        addError(context, positionPath, "한 템플릿에서 이미 지정된 포지션입니다.");
      } else {
        assignedPositions.add(position as PlayerPosition);
      }
    }
  });

  if (value.every((position) => typeof position === "string")) {
    const uniquePositions = new Set(value);
    if (uniquePositions.size !== value.length) {
      addError(context, path, "포지션 배열에는 중복 값이 없어야 합니다.");
    }
  }
}

function validateConfigHash(
  value: unknown,
  path: string,
  context: MutableValidationContext,
) {
  if (typeof value !== "string" || !SHA256_CONFIG_HASH_PATTERN.test(value)) {
    addError(context, path, "sha256: 접두사와 64자리 소문자 16진수여야 합니다.");
  }
}

function validateInteger(value: unknown, path: string, context: MutableValidationContext) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    addError(context, path, "유한한 정수여야 합니다.");
  }
}

function validateEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  context: MutableValidationContext,
) {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    addError(context, path, `허용값: ${allowed.join(", ")}`);
  }
}

function validateLiteral(
  value: unknown,
  expected: string | boolean,
  path: string,
  context: MutableValidationContext,
) {
  if (value !== expected) {
    addError(context, path, `값은 ${String(expected)}이어야 합니다.`);
  }
}

function validateIntegerRange(
  value: unknown,
  min: Scale10 | Scale5 | 1,
  max: Scale10 | Scale5 | 10,
  path: string,
  context: MutableValidationContext,
) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    addError(context, path, `${min}~${max} 사이의 정수여야 합니다.`);
  }
}

function validateNonEmptyString(
  value: unknown,
  path: string,
  context: MutableValidationContext,
) {
  if (typeof value !== "string" || value.trim().length === 0) {
    addError(context, path, "비어 있지 않은 문자열이어야 합니다.");
  }
}

function addError(context: MutableValidationContext, path: string, message: string) {
  context.errors.push({ path, message });
}

function appendNestedResult(
  context: MutableValidationContext,
  prefix: string,
  result: TacticValidationResult,
) {
  if (result.valid) {
    return;
  }

  for (const error of result.errors) {
    const nestedPath = error.path === "$" ? prefix : `${prefix}.${error.path}`;
    addError(context, nestedPath, error.message);
  }
}

function toResult(context: MutableValidationContext): TacticValidationResult {
  return context.errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors: context.errors };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
