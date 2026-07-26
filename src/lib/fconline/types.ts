export type FcOnlineIdResponse = {
  ouid: string;
};

export type FcOnlineBasicUserResponse = {
  ouid: string;
  nickname: string;
  level: number;
};

export type FcOnlineMatchInfo = {
  ouid: string;
  nickname?: string;
  matchDetail?: Record<string, unknown>;
  shoot?: Record<string, unknown>;
  pass?: Record<string, unknown>;
  defence?: Record<string, unknown>;
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

export type TeamTactics = {
  teamMentality: string;
  defensiveTactics: {
    defensiveStyle: string;
    width: number;
    depth: number;
  };
  offensiveTactics: {
    buildUpPlay: string;
    width: number;
    playersInBox: number;
    corners: number;
    freeKicks: number;
  };
};

export type ParticipationLevel = 1 | 2 | 3;

export type PersonalTacticSetting = {
  menu: string;
  value: string;
};

export type PlayerInstruction = {
  position: string;
  role: string;
  personalTactics: PersonalTacticSetting[];
  attackParticipation: ParticipationLevel;
  defenseParticipation: ParticipationLevel;
};

export type TacticRecommendation = {
  matchedRule: string;
  title: string;
  formation: string;
  teamTactics: TeamTactics;
  playerInstructions: PlayerInstruction[];
  explanation: string;
};

export type TacticRecommendationSet = {
  primary: TacticRecommendation;
  alternative: TacticRecommendation;
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
};

export type SearchResultWithAnalysis = SearchResult & {
  analysis: PlayStyleAnalysis;
  recommendation: TacticRecommendationSet;
};
