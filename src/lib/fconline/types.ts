export type FcOnlineIdResponse = {
  ouid: string;
};

export type FcOnlineBasicUserResponse = {
  ouid: string;
  nickname: string;
  level: number;
};

export type FcOnlineMatchPlayer = {
  spId?: unknown;
  spPosition?: unknown;
  spGrade?: unknown;
  status?: Record<string, unknown>;
};

export type FcOnlineMatchInfo = {
  ouid: string;
  nickname?: string;
  matchDetail?: Record<string, unknown>;
  shoot?: Record<string, unknown>;
  pass?: Record<string, unknown>;
  defence?: Record<string, unknown>;
  player?: FcOnlineMatchPlayer[];
};

export type FcOnlineMatchDetailResponse = {
  matchId?: string;
  matchDate?: string;
  matchType?: number;
  matchInfo?: FcOnlineMatchInfo[];
};

export type NormalizedMatch = {
  matchId: string;
  playedAt: string | null;
  matchType: number | null;
  result: "승리" | "무승부" | "패배" | "알 수 없음";
  opponentNickname: string;
  score: {
    for: number | null;
    against: number | null;
  };
  stats: {
    possession: number | null;
    shots: number | null;
    effectiveShots: number | null;
    passSuccessRate: number | null;
    tackleSuccessRate: number | null;
    dribbles: number | null;
  };
  players: NormalizedMatchPlayer[];
};

export type NormalizedMatchPlayer = {
  spId: number;
  spGrade: number | null;
  spPosition: number | null;
  performance: {
    rating: number | null;
    goals: number | null;
    assists: number | null;
    shots: number | null;
    effectiveShots: number | null;
    passesAttempted: number | null;
    passesCompleted: number | null;
    tacklesAttempted: number | null;
    tacklesCompleted: number | null;
    interceptions: number | null;
    blocks: number | null;
  };
};

export type RecentSquadCard = {
  spId: number;
  spGrade: number | null;
  name: string | null;
  seasonName: string | null;
  seasonImageUrl: string | null;
  positionCode: number | null;
  positionName: string | null;
  listedMatches: number;
  starterMatches: number;
  substituteListings: number;
  unclassifiedListings: number;
  averageRating: number | null;
  goals: number;
  assists: number;
  lastUsedAt: string | null;
  playerImageUrl: string;
  playerFallbackImageUrl: string;
  officialDataCenterUrl: string | null;
};

export type RecentSquadProfile = {
  source: "recent-official-matches";
  requestedMatchCount: number;
  analyzedMatchCount: number;
  matchesWithPlayerData: number;
  metadataStatus: "available" | "unavailable";
  metadataFetchedAt: string | null;
  cards: RecentSquadCard[];
  recommendationImpact: {
    applied: false;
    reason: string;
  };
};

export type PlayStyleLabel =
  | "공격적"
  | "수비 불안"
  | "득점력 높음"
  | "점유율 지향"
  | "슈팅 빈도 높음";

export type PlayStyleResult = {
  label: PlayStyleLabel;
  score: number | null;
  reason: string;
};

export type AnalysisConfidence = {
  level: "low" | "medium" | "high";
  coverage: number;
  message: string;
};

export type PlayStyleAnalysis = {
  matchCount: number;
  requestedMatchCount: number;
  styles: PlayStyleResult[];
  confidence: AnalysisConfidence;
};

export type Scale10 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export type Scale5 = 1 | 2 | 3 | 4 | 5;

export type TeamMentality =
  | "전원 수비"
  | "매우 수비적"
  | "수비적"
  | "보통"
  | "공격적"
  | "매우 공격적"
  | "전원 공격";

export type DefensiveStyle =
  | "후퇴"
  | "밸런스"
  | "볼 터치 실수 시 압박"
  | "공 뺏긴 직후 압박"
  | "지속적인 압박";

export type AttackingStyle = "짧은 패스" | "밸런스" | "긴 패스" | "빠른 빌드업";

export type TacticSchemaVersion = "fc-online-12nf-2026-03-26";

export type GamePatchVersion = "12th-next-field-2026-03-26";

export type TacticTemplateVersion = "1.0.0";

export type TacticTemplateId =
  | "risk-possession"
  | "risk-counter"
  | "attack-possession"
  | "attack-and-shoot"
  | "possession-scoring"
  | "possession-focused"
  | "defense-risk"
  | "balanced"
  | "compact-possession-alternative";

export type FormationCandidate =
  | "4-2-2-2"
  | "4-3-2-1"
  | "4-3-3 홀딩"
  | "4-1-4-1"
  | "5-2-3"
  | "4-4-2"
  | "4-2-3-1";

export type PlayerPosition =
  | "ST"
  | "LS"
  | "RS"
  | "LW"
  | "RW"
  | "LF"
  | "RF"
  | "LM"
  | "RM"
  | "LAM"
  | "RAM"
  | "CAM"
  | "LCM"
  | "CM"
  | "RCM"
  | "CDM"
  | "LDM"
  | "RDM"
  | "LWB"
  | "RWB"
  | "LB"
  | "RB"
  | "LCB"
  | "CB"
  | "RCB";

export type TacticConfigHash = `sha256:${string}`;

export type TeamTactics = {
  schemaVersion: TacticSchemaVersion;
  teamMentality: TeamMentality;
  defensiveTactics: {
    defensiveStyle: DefensiveStyle;
    width: Scale10;
    depth: Scale10;
  };
  offensiveTactics: {
    buildUpPlay: AttackingStyle;
    chanceCreation: AttackingStyle;
    width: Scale10;
    playersInBox: Scale10;
    corners: Scale5;
    freeKicks: Scale5;
  };
};

// 현행 클라이언트의 참여도 범위는 아직 수동 검증 전이므로 숫자 범위를 확정하지 않는다.
export type ParticipationLevel = number;

export type PersonalTacticSetting = {
  group: string;
  value: string;
  confirmed: false;
};

export type PlayerInstruction = {
  positions: PlayerPosition[];
  roleDescription: string;
  uiSettings: PersonalTacticSetting[];
  attackParticipation: {
    value: ParticipationLevel;
    confirmed: false;
  };
  defenseParticipation: {
    value: ParticipationLevel;
    confirmed: false;
  };
};

export type TacticCompatibility = {
  overall: "partial";
  teamTactics: "confirmed";
  formation: "unconfirmed";
  personalTactics: "unconfirmed";
};

export type TacticRecommendationMetadata = {
  schemaVersion: TacticSchemaVersion;
  gamePatchVersion: GamePatchVersion;
  templateId: TacticTemplateId;
  templateVersion: TacticTemplateVersion;
  configHash: TacticConfigHash;
  validation: TacticCompatibility;
};

export type TacticRecommendation = {
  metadata: TacticRecommendationMetadata;
  matchedRule: string;
  title: string;
  formation: FormationCandidate;
  teamTactics: TeamTactics;
  playerInstructions: PlayerInstruction[];
  explanation: string;
};

export type TacticRecommendationSet = {
  primary: TacticRecommendation;
  alternative: TacticRecommendation;
};

export type TacticAssignmentMatchKind =
  | "exact-recent-position"
  | "compatible-position"
  | "unassigned";

export type TacticInstructionAssignment = {
  instructionIndex: number;
  position: PlayerPosition;
  card: {
    spId: number;
    spGrade: number | null;
  } | null;
  observedPosition: PlayerPosition | null;
  observedPositionCode: number | null;
  matchKind: TacticAssignmentMatchKind;
};

export type TacticApplicationGuide = {
  recommendationConfigHash: TacticConfigHash;
  templateId: TacticTemplateId;
  referenceMatchId: string | null;
  referencePlayedAt: string | null;
  assignedSlots: number;
  totalSlots: number;
  validation: {
    formation: "unconfirmed";
    personalTactics: "unconfirmed";
  };
  assignments: TacticInstructionAssignment[];
};

export type TacticApplicationGuideSet = {
  primary: TacticApplicationGuide;
  alternative: TacticApplicationGuide;
};

export type ApiErrorType = "validation" | "configuration" | "external-api" | "empty-result";

export type ApiErrorResponse = {
  type: ApiErrorType;
  message: string;
  status: number;
};

export type SearchResult = {
  user: {
    ouid: string;
    nickname: string;
    level: number | null;
  };
  summary: {
    matchType: string;
    totalMatches: number;
    wins: number;
    draws: number;
    losses: number;
    unknown: number;
  };
  matches: NormalizedMatch[];
  squadProfile?: RecentSquadProfile;
};

export type SearchResultWithAnalysis = SearchResult & {
  analysis: PlayStyleAnalysis;
  recommendation: TacticRecommendationSet;
  tacticApplicationGuides?: TacticApplicationGuideSet;
};
