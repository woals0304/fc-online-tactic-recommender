"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CSSProperties, FormEvent, SyntheticEvent } from "react";

import type {
  ApiErrorResponse,
  NormalizedMatch,
  NormalizedMatchPlayer,
  PlayerInstruction,
  PlayerPosition,
  RecentSquadCard,
  RecentSquadProfile,
  TacticApplicationGuide,
  TacticApplicationGuideSet,
  TacticInstructionAssignment,
  TacticRecommendation,
  TacticRecommendationSet,
} from "@/lib/fconline/types";
import {
  isSearchResultWithAnalysis,
  type CompatiblePlayStyleAnalysis,
  type SearchResultWithAnalysisPayload,
} from "@/lib/fconline/searchResultSchema";
import { formatTeamTacticForClipboard } from "@/lib/tactics/formatTeamTacticForClipboard";

type ViewState =
  | { status: "idle" }
  | { status: "loading"; submittedNickname: string }
  | { status: "success"; submittedNickname: string; result: SearchResultWithAnalysisPayload }
  | {
      status: "error";
      submittedNickname: string;
      message: string;
      source: "validation" | "request";
    };

type AnalysisConfidence = {
  level: string;
  coverage: number;
  message: string;
};

const initialState: ViewState = { status: "idle" };
const GENERIC_ERROR_MESSAGE = "조회 중 문제가 발생했습니다. 잠시 뒤 다시 시도해 주세요.";

export default function Home() {
  const [nickname, setNickname] = useState("");
  const [state, setState] = useState<ViewState>(initialState);
  const activeRequest = useRef<AbortController | null>(null);
  const latestRequestId = useRef(0);

  useEffect(() => {
    return () => activeRequest.current?.abort();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedNickname = nickname.trim();
    const requestId = latestRequestId.current + 1;

    latestRequestId.current = requestId;
    activeRequest.current?.abort();
    activeRequest.current = null;

    if (!trimmedNickname) {
      setState({
        status: "error",
        submittedNickname: "",
        message: "닉네임을 입력해 주세요.",
        source: "validation",
      });
      return;
    }

    const controller = new AbortController();

    activeRequest.current = controller;
    setState({ status: "loading", submittedNickname: trimmedNickname });

    try {
      const response = await fetch(`/api/search?nickname=${encodeURIComponent(trimmedNickname)}`, {
        signal: controller.signal,
      });
      const data = await readJsonResponse(response);

      if (requestId !== latestRequestId.current) {
        return;
      }

      if (!response.ok) {
        setState({
          status: "error",
          submittedNickname: trimmedNickname,
          message: getErrorMessage(data, response.status),
          source: "request",
        });
        return;
      }

      if (!isSearchResultWithAnalysis(data)) {
        setState({
          status: "error",
          submittedNickname: trimmedNickname,
          message: GENERIC_ERROR_MESSAGE,
          source: "request",
        });
        return;
      }

      setState({
        status: "success",
        submittedNickname: trimmedNickname,
        result: data,
      });
    } catch (error) {
      if (isAbortError(error) || requestId !== latestRequestId.current) {
        return;
      }

      setState({
        status: "error",
        submittedNickname: trimmedNickname,
        message: GENERIC_ERROR_MESSAGE,
        source: "request",
      });
    } finally {
      if (requestId === latestRequestId.current) {
        activeRequest.current = null;
      }
    }
  }

  const isLoading = state.status === "loading";
  const isValidationError = state.status === "error" && state.source === "validation";

  return (
    <main className="page">
      <section className="intro">
        <p className="eyebrow">간편 전술 추천</p>
        <h1>내 전적에 맞는 팀 전술을 바로 확인하세요</h1>
        <p className="description">
          닉네임만 입력하면 최근 공식 경기를 분석해 주전술을 먼저 보여드립니다. 팀 전술은
          한 번에 복사할 수 있습니다.
        </p>
      </section>

      <section className="search-panel" aria-label="닉네임 조회">
        <form onSubmit={handleSubmit} className="search-form" aria-busy={isLoading}>
          <label htmlFor="nickname">FC ONLINE 닉네임</label>
          <div className="search-row">
            <input
              id="nickname"
              name="nickname"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="예: 구단주명"
              autoComplete="off"
              maxLength={30}
              aria-describedby="nickname-help"
              aria-invalid={isValidationError}
            />
            <button type="submit" disabled={isLoading}>
              {isLoading ? "조회 중" : "조회"}
            </button>
          </div>
          <p id="nickname-help" className="input-help">
            공백을 제외한 구단주 닉네임을 입력해 주세요. 최대 30자까지 입력할 수 있습니다.
          </p>
        </form>

        <div className="status-region">
          {state.status === "loading" ? (
            <p className="notice" role="status">
              ‘{state.submittedNickname}’의 최근 경기 데이터를 불러오는 중입니다.
            </p>
          ) : null}
          {state.status === "error" ? (
            <p className="error" role="alert">
              {state.submittedNickname ? `‘${state.submittedNickname}’ 조회 실패: ` : null}
              {state.message}
            </p>
          ) : null}
          {state.status === "success" ? (
            <p className="visually-hidden" role="status">
              ‘{state.submittedNickname}’ 조회가 완료되었습니다.
            </p>
          ) : null}
        </div>
      </section>

      {state.status === "idle" ? <EmptyState /> : null}
      {state.status === "success" ? (
        <ResultView result={state.result} submittedNickname={state.submittedNickname} />
      ) : null}

      <footer>Data based on NEXON Open API</footer>
    </main>
  );
}

async function readJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function getErrorMessage(data: unknown, status: number) {
  const error = isRecord(data) ? (data as Partial<ApiErrorResponse>) : null;

  if (typeof error?.message === "string" && error.message.trim()) {
    return error.message;
  }

  if (status === 404) {
    return "최근 경기 기록을 찾지 못했습니다.";
  }

  if (status === 429) {
    return "조회 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.";
  }

  return GENERIC_ERROR_MESSAGE;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown) {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (isRecord(error) && error.name === "AbortError")
  );
}

function ResultView({
  result,
  submittedNickname,
}: {
  result: SearchResultWithAnalysisPayload;
  submittedNickname: string;
}) {
  const unknownMatches = result.summary.unknown;

  return (
    <section className="result" aria-label={`‘${submittedNickname}’ 조회 결과`}>
      <div className="user-summary">
        <div>
          <p className="eyebrow">조회 유저</p>
          <h2>{result.user.nickname}</h2>
          <p>레벨 {result.user.level ?? "정보 없음"}</p>
        </div>
        <div className="summary-grid">
          <Stat label="경기 유형" value={result.summary.matchType} />
          <Stat label="조회 경기" value={`${result.summary.totalMatches}경기`} />
          <Stat label="승/무/패" value={`${result.summary.wins}/${result.summary.draws}/${result.summary.losses}`} />
          {typeof unknownMatches === "number" && unknownMatches > 0 ? (
            <Stat label="기타" value={`${unknownMatches}경기`} />
          ) : null}
        </div>
      </div>

      <TacticRecommendationView recommendation={result.recommendation} />
      {result.squadProfile ? (
        <RecentSquadView
          key={`${result.user.ouid}:${result.matches[0]?.matchId ?? "no-match"}`}
          profile={result.squadProfile}
          matches={result.matches}
          recommendations={result.recommendation}
          applicationGuides={result.tacticApplicationGuides}
        />
      ) : null}
      <details className="result-details">
        <summary>플레이 성향과 추천 근거 보기</summary>
        <StyleAnalysisView analysis={result.analysis} />
      </details>

      {result.matches.length > 0 ? (
        <details className="result-details">
          <summary>최근 경기 {result.matches.length}개 보기</summary>
          <div className="match-list">
            {result.matches.map((match) => (
              <article key={match.matchId} className="match-card">
                <div className="match-head">
                  <span className={`result-badge ${getResultClass(match.result)}`}>
                    {match.result}
                  </span>
                  <span>{formatDate(match.playedAt)}</span>
                </div>
                <h3>
                  vs {match.opponentNickname}
                  <span>
                    {formatScore(match.score.for)} : {formatScore(match.score.against)}
                  </span>
                </h3>
                <div className="detail-grid">
                  <Stat label="점유율" value={formatPercent(match.stats.possession)} />
                  <Stat label="슈팅" value={formatCount(match.stats.shots)} />
                  <Stat label="유효 슈팅" value={formatCount(match.stats.effectiveShots)} />
                  <Stat label="패스 성공률" value={formatPercent(match.stats.passSuccessRate)} />
                  <Stat label="태클 성공률" value={formatPercent(match.stats.tackleSuccessRate)} />
                  <Stat label="드리블" value={formatCount(match.stats.dribbles)} />
                </div>
              </article>
            ))}
          </div>
        </details>
      ) : (
        <p className="notice">최근 공식 경기 기록을 찾지 못했습니다.</p>
      )}
    </section>
  );
}

type SquadViewMode = "pitch" | "list";
type RecommendationKind = "primary" | "alternative";

type PitchPosition = {
  code: number;
  label: string;
  left: number;
  top: number;
};

type MatchRosterItem = {
  key: string;
  player: NormalizedMatchPlayer;
  card: RecentSquadCard | null;
  position: PitchPosition | null;
};

type PitchPlacement<T> = {
  item: T;
  left: number;
  top: number;
};

const PITCH_POSITIONS: Readonly<Record<number, PitchPosition>> = {
  0: { code: 0, label: "GK", left: 50, top: 91 },
  1: { code: 1, label: "SW", left: 50, top: 82 },
  2: { code: 2, label: "RWB", left: 88, top: 67 },
  3: { code: 3, label: "RB", left: 86, top: 76 },
  4: { code: 4, label: "RCB", left: 68, top: 78 },
  5: { code: 5, label: "CB", left: 50, top: 79 },
  6: { code: 6, label: "LCB", left: 32, top: 78 },
  7: { code: 7, label: "LB", left: 14, top: 76 },
  8: { code: 8, label: "LWB", left: 12, top: 67 },
  9: { code: 9, label: "RDM", left: 68, top: 60 },
  10: { code: 10, label: "CDM", left: 50, top: 61 },
  11: { code: 11, label: "LDM", left: 32, top: 60 },
  12: { code: 12, label: "RM", left: 86, top: 48 },
  13: { code: 13, label: "RCM", left: 70, top: 48 },
  14: { code: 14, label: "CM", left: 50, top: 47 },
  15: { code: 15, label: "LCM", left: 30, top: 48 },
  16: { code: 16, label: "LM", left: 14, top: 48 },
  17: { code: 17, label: "RAM", left: 70, top: 35 },
  18: { code: 18, label: "CAM", left: 50, top: 34 },
  19: { code: 19, label: "LAM", left: 30, top: 35 },
  20: { code: 20, label: "RF", left: 68, top: 22 },
  21: { code: 21, label: "CF", left: 50, top: 22 },
  22: { code: 22, label: "LF", left: 32, top: 22 },
  23: { code: 23, label: "RW", left: 85, top: 20 },
  24: { code: 24, label: "RS", left: 65, top: 12 },
  25: { code: 25, label: "ST", left: 50, top: 10 },
  26: { code: 26, label: "LS", left: 35, top: 12 },
  27: { code: 27, label: "LW", left: 15, top: 20 },
  28: { code: 28, label: "SUB", left: 50, top: 105 },
};

const POSITION_CODES_BY_NAME = Object.fromEntries(
  Object.values(PITCH_POSITIONS).map((position) => [position.label, position.code]),
) as Readonly<Record<string, number>>;

function RecentSquadView({
  profile,
  matches,
  recommendations,
  applicationGuides,
}: {
  profile: RecentSquadProfile;
  matches: NormalizedMatch[];
  recommendations: TacticRecommendationSet;
  applicationGuides?: TacticApplicationGuideSet;
}) {
  if (profile.cards.length === 0) {
    return (
      <aside className="squad-unavailable" role="note">
        <strong>최근 사용 선수단 정보 없음</strong>
        <span>{profile.recommendationImpact.reason}</span>
      </aside>
    );
  }

  const matchesWithPlayers = matches.filter((match) => match.players.length > 0);

  return (
    <RecentSquadWorkspace
      profile={profile}
      matches={matchesWithPlayers}
      recommendations={recommendations}
      applicationGuides={applicationGuides}
    />
  );
}

function RecentSquadWorkspace({
  profile,
  matches,
  recommendations,
  applicationGuides,
}: {
  profile: RecentSquadProfile;
  matches: NormalizedMatch[];
  recommendations: TacticRecommendationSet;
  applicationGuides?: TacticApplicationGuideSet;
}) {
  const [selectedMatchId, setSelectedMatchId] = useState(matches[0]?.matchId ?? "");
  const [viewMode, setViewMode] = useState<SquadViewMode>("pitch");
  const [selectedPlayerKey, setSelectedPlayerKey] = useState("");
  const selectedMatch =
    matches.find((match) => match.matchId === selectedMatchId) ?? matches[0] ?? null;
  const roster = selectedMatch ? createMatchRoster(selectedMatch, profile.cards) : [];
  const selectedPlayer =
    roster.find((item) => item.key === selectedPlayerKey) ??
    roster.find((item) => item.position?.code !== 28) ??
    roster[0] ??
    null;

  function handleMatchChange(matchId: string) {
    setSelectedMatchId(matchId);
    setSelectedPlayerKey("");
  }

  return (
    <details className="result-details squad-details">
      <summary>
        최근 경기 선수 배치 보기 ({profile.cards.length}종 · 선수 정보 {profile.matchesWithPlayerData}/
        {profile.requestedMatchCount}경기)
      </summary>
      <div className="squad-content">
        <div className="squad-notes" role="note">
          <p>
            최근 공식 경기 명단이며 현재 보유·저장 스쿼드가 아닙니다. 등록 포지션을 정해진
            위치에 표시할 뿐, 정확한 인게임 좌표나 포메이션 프리셋을 뜻하지 않습니다.
          </p>
          <p>{profile.recommendationImpact.reason}</p>
        </div>
        {profile.metadataStatus === "unavailable" ? (
          <p className="metadata-warning">
            공식 선수 메타데이터를 불러오지 못해 이름·시즌·포지션 일부를 ID로 표시합니다.
          </p>
        ) : null}

        {selectedMatch ? (
          <>
            <div className="squad-workspace-toolbar">
              <label>
                <span>표시할 최근 경기</span>
                <select
                  value={selectedMatch.matchId}
                  onChange={(event) => handleMatchChange(event.target.value)}
                >
                  {matches.map((match) => (
                    <option key={match.matchId} value={match.matchId}>
                      {formatMatchOption(match)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="squad-view-switch" aria-label="선수 배치 보기 방식">
                <button
                  type="button"
                  aria-pressed={viewMode === "pitch"}
                  onClick={() => setViewMode("pitch")}
                >
                  피치
                </button>
                <button
                  type="button"
                  aria-pressed={viewMode === "list"}
                  onClick={() => setViewMode("list")}
                >
                  목록
                </button>
              </div>
            </div>

            <div className="selected-match-heading">
              <div>
                <span className={`result-badge ${getResultClass(selectedMatch.result)}`}>
                  {selectedMatch.result}
                </span>
                <strong>vs {selectedMatch.opponentNickname}</strong>
              </div>
              <span>
                {formatDate(selectedMatch.playedAt)} · {formatScore(selectedMatch.score.for)} : {formatScore(selectedMatch.score.against)}
              </span>
            </div>

            <div className="squad-workspace">
              <div className="match-roster-view">
                {viewMode === "pitch" ? (
                  <MatchPitch
                    roster={roster}
                    selectedPlayerKey={selectedPlayer?.key ?? ""}
                    onSelectPlayer={setSelectedPlayerKey}
                  />
                ) : (
                  <MatchRosterList
                    roster={roster.filter((item) => item.position?.code !== 28)}
                    selectedPlayerKey={selectedPlayer?.key ?? ""}
                    onSelectPlayer={setSelectedPlayerKey}
                  />
                )}
                <SubstituteRail
                  roster={roster.filter((item) => item.position?.code === 28)}
                  selectedPlayerKey={selectedPlayer?.key ?? ""}
                  onSelectPlayer={setSelectedPlayerKey}
                />
              </div>
              <SelectedMatchPlayerPanel item={selectedPlayer} />
            </div>
          </>
        ) : (
          <p className="squad-empty-match" role="note">
            선수 명단이 포함된 최근 경기를 찾지 못해 피치 배치를 표시할 수 없습니다.
          </p>
        )}

        <ApplicationGuideSection
          guides={applicationGuides}
          recommendations={recommendations}
          cards={profile.cards}
        />

        <details className="squad-history-details">
          <summary>최근 {profile.analyzedMatchCount}경기 사용 카드 전체 보기</summary>
          <div className="squad-grid">
            {profile.cards.map((card) => (
              <RecentSquadCardView
                key={`${card.spId}:${card.spGrade ?? "unknown"}`}
                card={card}
              />
            ))}
          </div>
        </details>
        <p className="ability-boundary">
          정확한 강화 능력치는 각 카드의 공식 데이터센터 링크에서 확인하세요. 링크의 수치는
          카드·강화 기준이며 팀컬러·적응도·훈련코치 등 실제 인게임 보정은 별도입니다.
        </p>
      </div>
    </details>
  );
}

function MatchPitch({
  roster,
  selectedPlayerKey,
  onSelectPlayer,
}: {
  roster: MatchRosterItem[];
  selectedPlayerKey: string;
  onSelectPlayer: (key: string) => void;
}) {
  const pitchRoster = roster.filter(
    (item): item is MatchRosterItem & { position: PitchPosition } =>
      item.position !== null && item.position.code !== 28,
  );
  const unplacedRoster = roster.filter((item) => item.position === null);
  const placements = createPitchPlacements(pitchRoster, (item) => item.position);

  return (
    <>
      <div className="squad-pitch" role="group" aria-label="선택 경기 등록 포지션 피치">
        <div className="pitch-markings" aria-hidden="true" />
        <ol className="pitch-player-list">
          {placements.map(({ item, left, top }) => (
            <li
              key={item.key}
              style={{ left: `${left}%`, top: `${top}%` } as CSSProperties}
            >
              <PitchPlayerButton
                item={item}
                selected={item.key === selectedPlayerKey}
                onSelect={() => onSelectPlayer(item.key)}
              />
            </li>
          ))}
        </ol>
      </div>
      {unplacedRoster.length > 0 ? (
        <div className="unplaced-roster" role="group" aria-label="위치를 확인할 수 없는 선수">
          <strong>위치 확인 불가</strong>
          <MatchRosterList
            roster={unplacedRoster}
            selectedPlayerKey={selectedPlayerKey}
            onSelectPlayer={onSelectPlayer}
          />
        </div>
      ) : null}
    </>
  );
}

function PitchPlayerButton({
  item,
  selected,
  onSelect,
}: {
  item: MatchRosterItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const name = getCardName(item);
  const positionName = item.position?.label ?? "위치 미상";

  return (
    <button
      type="button"
      className="pitch-player-button"
      aria-pressed={selected}
      aria-label={`${name}, 강화 ${item.player.spGrade ?? "정보 없음"}, ${positionName}, 이 경기 평점 ${item.player.performance.rating ?? "정보 없음"}`}
      onClick={onSelect}
    >
      <span className="pitch-player-season">{item.card?.seasonName ?? "FC"}</span>
      <span className="pitch-player-photo" aria-hidden="true">
        {item.card ? (
          <img
            src={item.card.playerImageUrl}
            data-fallback-src={item.card.playerFallbackImageUrl}
            alt=""
            loading="lazy"
            onError={handlePlayerImageError}
          />
        ) : (
          <span>FC</span>
        )}
      </span>
      <strong title={name}>{name}</strong>
      <span>
        +{item.player.spGrade ?? "?"} · {positionName}
      </span>
      {item.player.performance.rating !== null ? (
        <small>평점 {item.player.performance.rating}</small>
      ) : null}
    </button>
  );
}

function MatchRosterList({
  roster,
  selectedPlayerKey,
  onSelectPlayer,
}: {
  roster: MatchRosterItem[];
  selectedPlayerKey: string;
  onSelectPlayer: (key: string) => void;
}) {
  return (
    <ul className="match-roster-list">
      {roster.map((item) => {
        const name = getCardName(item);

        return (
          <li key={item.key}>
            <button
              type="button"
              aria-pressed={item.key === selectedPlayerKey}
              onClick={() => onSelectPlayer(item.key)}
            >
              <span className="roster-list-photo" aria-hidden="true">
                {item.card ? (
                  <img
                    src={item.card.playerImageUrl}
                    data-fallback-src={item.card.playerFallbackImageUrl}
                    alt=""
                    loading="lazy"
                    onError={handlePlayerImageError}
                  />
                ) : (
                  "FC"
                )}
              </span>
              <span className="roster-list-identity">
                <strong>{name}</strong>
                <small>
                  {item.card?.seasonName ?? "시즌 정보 없음"} · +{item.player.spGrade ?? "?"} · {item.position?.label ?? "위치 미상"}
                </small>
              </span>
              <span className="roster-list-performance">
                평점 {item.player.performance.rating ?? "-"} · 골 {item.player.performance.goals ?? "-"} · 도움 {item.player.performance.assists ?? "-"}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function SubstituteRail({
  roster,
  selectedPlayerKey,
  onSelectPlayer,
}: {
  roster: MatchRosterItem[];
  selectedPlayerKey: string;
  onSelectPlayer: (key: string) => void;
}) {
  if (roster.length === 0) {
    return null;
  }

  return (
    <section className="substitute-section" aria-labelledby="substitute-heading">
      <div className="substitute-heading">
        <strong id="substitute-heading">후보 등록(SUB)</strong>
        <span>후보 명단만 확인되며 실제 교체 출전을 확정하지 않습니다.</span>
      </div>
      <div className="substitute-rail">
        {roster.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={item.key === selectedPlayerKey}
            onClick={() => onSelectPlayer(item.key)}
          >
            <strong>{getCardName(item)}</strong>
            <span>+{item.player.spGrade ?? "?"} · SUB</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function SelectedMatchPlayerPanel({ item }: { item: MatchRosterItem | null }) {
  if (!item) {
    return (
      <aside className="selected-player-panel is-empty" role="note">
        피치나 목록에서 선수를 선택하면 해당 경기 기록을 확인할 수 있습니다.
      </aside>
    );
  }

  const name = getCardName(item);
  const performance = item.player.performance;
  const isSubstitute = item.position?.code === 28;

  return (
    <aside className="selected-player-panel" aria-live="polite" aria-atomic="true">
      <div className="selected-player-identity">
        <span className="squad-player-image" aria-hidden="true">
          <span>FC</span>
          {item.card ? (
            <img
              src={item.card.playerImageUrl}
              data-fallback-src={item.card.playerFallbackImageUrl}
              alt=""
              width="72"
              height="72"
              loading="lazy"
              onError={handlePlayerImageError}
            />
          ) : null}
        </span>
        <div>
          <span className="squad-season">{item.card?.seasonName ?? "시즌 정보 없음"}</span>
          <h3>{name}</h3>
          <p>
            <strong>+{item.player.spGrade ?? "?"}</strong> · {item.position?.label ?? "위치 미상"}
          </p>
        </div>
      </div>
      <div className="performance-heading">
        <strong>{isSubstitute ? "경기 응답 기록" : "이 경기 활약"}</strong>
        <span>player.status</span>
      </div>
      <dl className="selected-player-stats">
        <div><dt>평점</dt><dd>{performance.rating ?? "-"}</dd></div>
        <div><dt>골</dt><dd>{performance.goals ?? "-"}</dd></div>
        <div><dt>도움</dt><dd>{performance.assists ?? "-"}</dd></div>
        <div><dt>슈팅</dt><dd>{performance.shots ?? "-"}</dd></div>
      </dl>
      <p className="performance-boundary">
        {isSubstitute
          ? "SUB는 후보 등록을 뜻하며 이 기록만으로 실제 교체 출전을 확정하지 않습니다."
          : "이 수치는 해당 경기 활약이며 카드 고유 능력치가 아닙니다."}
      </p>
      {item.card?.officialDataCenterUrl ? (
        <a
          className="ability-link"
          href={item.card.officialDataCenterUrl}
          target="_blank"
          rel="noreferrer"
        >
          {name} 공식 능력치 보기
          <span className="visually-hidden"> — 새 창</span>
        </a>
      ) : (
        <span className="ability-link is-unavailable">공식 능력치 링크 없음</span>
      )}
    </aside>
  );
}

function ApplicationGuideSection({
  guides,
  recommendations,
  cards,
}: {
  guides?: TacticApplicationGuideSet;
  recommendations: TacticRecommendationSet;
  cards: RecentSquadCard[];
}) {
  const [selectedKind, setSelectedKind] = useState<RecommendationKind>("primary");
  const options = guides
    ? (["primary", "alternative"] as const)
        .map((kind) => ({
          kind,
          guide: guides[kind],
          recommendation: recommendations[kind],
        }))
        .filter(({ guide, recommendation }) =>
          isGuideForRecommendation(guide, recommendation),
        )
    : [];
  const selectedOption =
    options.find((option) => option.kind === selectedKind) ?? options[0] ?? null;

  if (!selectedOption) {
    return null;
  }

  return (
    <details className="application-guide-details">
      <summary>추천 배치 후보와 개인전술 연결 보기 · 미확인</summary>
      <div className="application-guide-content">
        <div className="application-guide-warning" role="note">
          <strong>추천 배치 후보</strong>
          <p>
            실제 경기에서 사용한 포메이션이나 개인전술이 아닙니다. 최근 카드의 등록 위치를
            추천 슬롯에 연결한 참고 화면이며, 포메이션과 개인전술은 PC 클라이언트 검증 전까지
            복사에서 제외됩니다.
          </p>
        </div>

        {options.length > 1 ? (
          <div className="application-guide-switch" aria-label="표시할 추천 전술">
            {options.map((option) => (
              <button
                key={option.kind}
                type="button"
                aria-pressed={option.kind === selectedOption.kind}
                onClick={() => setSelectedKind(option.kind)}
              >
                {option.kind === "primary" ? "주전술" : "대안 전술"}
              </button>
            ))}
          </div>
        ) : null}

        <ApplicationGuidePitch
          key={`${selectedOption.kind}:${selectedOption.guide.recommendationConfigHash}`}
          kind={selectedOption.kind}
          guide={selectedOption.guide}
          recommendation={selectedOption.recommendation}
          cards={cards}
        />
      </div>
    </details>
  );
}

function ApplicationGuidePitch({
  kind,
  guide,
  recommendation,
  cards,
}: {
  kind: RecommendationKind;
  guide: TacticApplicationGuide;
  recommendation: TacticRecommendation;
  cards: RecentSquadCard[];
}) {
  const guideRoster = createGuideRoster(guide.assignments, recommendation, cards);
  const [selectedAssignmentKey, setSelectedAssignmentKey] = useState(
    guideRoster[0]?.key ?? "",
  );
  const selectedAssignment =
    guideRoster.find((item) => item.key === selectedAssignmentKey) ?? guideRoster[0] ?? null;
  const placements = createPitchPlacements(guideRoster, (item) => item.position);

  return (
    <section className="application-guide" aria-label={`${kind === "primary" ? "주전술" : "대안 전술"} 추천 배치 후보`}>
      <div className="application-guide-heading">
        <div>
          <span className="tactic-label">{kind === "primary" ? "주전술" : "대안 전술"}</span>
          <h3>{recommendation.title}</h3>
        </div>
        <div className="application-guide-status">
          <strong>{recommendation.formation}</strong>
          <ValidationBadge status={guide.validation.formation} />
          <span>{guide.assignedSlots}/{guide.totalSlots}자리 연결</span>
        </div>
      </div>
      <p className="application-guide-reference">
        카드 연결 기준: {guide.referencePlayedAt ? formatDate(guide.referencePlayedAt) : "최근 경기 정보 없음"}
      </p>
      <p className="application-guide-scope">
        개인전술 지시가 있는 {guide.totalSlots}자리만 표시하며, 전체 11명 포메이션 배치가 아닙니다.
      </p>

      <div className="application-guide-workspace">
        <div className="squad-pitch application-pitch" role="group" aria-label="추천 포메이션 위치 후보">
          <div className="pitch-markings" aria-hidden="true" />
          <ol className="pitch-player-list">
            {placements.map(({ item, left, top }) => (
              <li
                key={item.key}
                style={{ left: `${left}%`, top: `${top}%` } as CSSProperties}
              >
                <GuideSlotButton
                  item={item}
                  selected={item.key === selectedAssignment?.key}
                  onSelect={() => setSelectedAssignmentKey(item.key)}
                />
              </li>
            ))}
          </ol>
        </div>
        <ApplicationAssignmentPanel item={selectedAssignment} />
      </div>
    </section>
  );
}

type GuideRosterItem = {
  key: string;
  assignment: TacticInstructionAssignment;
  instruction: PlayerInstruction | null;
  card: RecentSquadCard | null;
  position: PitchPosition;
};

function GuideSlotButton({
  item,
  selected,
  onSelect,
}: {
  item: GuideRosterItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const cardName = item.card?.name ??
    (item.assignment.card ? `선수 ID ${item.assignment.card.spId}` : "선수 미배정");
  const matchKindLabel = formatAssignmentMatchKind(item.assignment.matchKind);

  return (
    <button
      type="button"
      className={`guide-slot-button is-${item.assignment.matchKind}`}
      aria-pressed={selected}
      aria-label={`${item.assignment.position} 자리, ${cardName}, ${matchKindLabel}, 추천 역할 보기`}
      onClick={onSelect}
    >
      <span className="guide-slot-position">{item.assignment.position}</span>
      {item.card ? (
        <span className="guide-slot-photo" aria-hidden="true">
          <img
            src={item.card.playerImageUrl}
            data-fallback-src={item.card.playerFallbackImageUrl}
            alt=""
            loading="lazy"
            onError={handlePlayerImageError}
          />
        </span>
      ) : (
        <span className="guide-slot-empty" aria-hidden="true">＋</span>
      )}
      <strong title={cardName}>{cardName}</strong>
      <small>{matchKindLabel}</small>
    </button>
  );
}

function ApplicationAssignmentPanel({ item }: { item: GuideRosterItem | null }) {
  if (!item) {
    return (
      <aside className="application-assignment-panel is-empty" role="note">
        표시할 추천 포지션이 없습니다.
      </aside>
    );
  }

  const { assignment, instruction, card } = item;
  const cardName = card?.name ??
    (assignment.card ? `선수 ID ${assignment.card.spId}` : "선수 미배정");

  return (
    <aside className="application-assignment-panel" aria-live="polite" aria-atomic="true">
      <div className="assignment-heading">
        <div>
          <span>{assignment.position} 자리</span>
          <h4>{cardName}</h4>
        </div>
        <span className={`assignment-match-badge is-${assignment.matchKind}`}>
          {formatAssignmentMatchKind(assignment.matchKind)}
        </span>
      </div>
      {assignment.card ? (
        <p className="assignment-card-meta">
          강화 +{assignment.card.spGrade ?? "?"}
          {assignment.observedPosition ? ` · 최근 등록 위치 ${assignment.observedPosition}` : ""}
        </p>
      ) : (
        <p className="assignment-card-meta">최근 카드에서 이 자리에 연결할 선수를 찾지 못했습니다.</p>
      )}

      <div className="assignment-role">
        <span>추천 역할(설명)</span>
        <strong>{instruction?.roleDescription ?? "역할 정보 없음"}</strong>
      </div>

      {card?.officialDataCenterUrl ? (
        <a
          className="ability-link"
          href={card.officialDataCenterUrl}
          target="_blank"
          rel="noreferrer"
        >
          {cardName} 공식 능력치 보기
          <span className="visually-hidden"> — 새 창</span>
        </a>
      ) : null}

      {instruction ? (
        <details className="assignment-personal-details">
          <summary>개인전술 후보 보기 · 미확인</summary>
          <div>
            <p className="unconfirmed-instruction-note" role="note">
              API에서 실제 사용 여부를 확인한 값이 아닙니다. 현행 PC 클라이언트 검증 전 후보이며
              복사 대상이 아닙니다.
            </p>
            <dl className="personal-tactics">
              {instruction.uiSettings.map((setting, index) => (
                <div key={`${index}-${setting.group}-${setting.value}`}>
                  <dt>{setting.group}</dt>
                  <dd>
                    <span>{setting.value}</span>
                    <ConfirmationBadge confirmed={setting.confirmed} />
                  </dd>
                </div>
              ))}
            </dl>
            <div className="participation-settings">
              <ParticipationSetting label="공격 참여도" setting={instruction.attackParticipation} />
              <ParticipationSetting label="수비 참여도" setting={instruction.defenseParticipation} />
            </div>
          </div>
        </details>
      ) : null}
    </aside>
  );
}

function createMatchRoster(
  match: NormalizedMatch,
  cards: RecentSquadCard[],
): MatchRosterItem[] {
  return match.players
    .map((player, index) => ({
      key: `${player.spId}:${player.spGrade ?? "unknown"}:${player.spPosition ?? "unknown"}:${index}`,
      player,
      card: findSquadCard(cards, player.spId, player.spGrade),
      position:
        player.spPosition === null ? null : PITCH_POSITIONS[player.spPosition] ?? null,
    }))
    .sort((left, right) => {
      const positionDifference =
        (left.position?.code ?? Number.MAX_SAFE_INTEGER) -
        (right.position?.code ?? Number.MAX_SAFE_INTEGER);

      return positionDifference || left.player.spId - right.player.spId;
    });
}

function createGuideRoster(
  assignments: TacticInstructionAssignment[],
  recommendation: TacticRecommendation,
  cards: RecentSquadCard[],
): GuideRosterItem[] {
  return assignments
    .map<GuideRosterItem | null>((assignment) => {
      const positionCode = POSITION_CODES_BY_NAME[assignment.position];
      const position = PITCH_POSITIONS[positionCode];

      if (!position || position.code === 28) {
        return null;
      }

      return {
        key: `${assignment.instructionIndex}:${assignment.position}`,
        assignment,
        instruction: recommendation.playerInstructions[assignment.instructionIndex] ?? null,
        card: assignment.card
          ? findSquadCard(cards, assignment.card.spId, assignment.card.spGrade)
          : null,
        position,
      };
    })
    .filter((item): item is GuideRosterItem => item !== null)
    .sort((left, right) =>
      left.position.code - right.position.code ||
      left.assignment.instructionIndex - right.assignment.instructionIndex,
    );
}

function createPitchPlacements<T>(
  items: T[],
  readPosition: (item: T) => PitchPosition,
): PitchPlacement<T>[] {
  const positionCounts = new Map<number, number>();
  const positionIndexes = new Map<number, number>();

  for (const item of items) {
    const code = readPosition(item).code;
    positionCounts.set(code, (positionCounts.get(code) ?? 0) + 1);
  }

  return items.map((item) => {
    const position = readPosition(item);
    const index = positionIndexes.get(position.code) ?? 0;
    const count = positionCounts.get(position.code) ?? 1;
    const horizontalOffset = (index - (count - 1) / 2) * 9;

    positionIndexes.set(position.code, index + 1);

    return {
      item,
      left: clampPitchCoordinate(position.left + horizontalOffset),
      top: clampPitchCoordinate(position.top),
    };
  });
}

function findSquadCard(
  cards: RecentSquadCard[],
  spId: number,
  spGrade: number | null,
) {
  return cards.find((card) => card.spId === spId && card.spGrade === spGrade) ?? null;
}

function getCardName(item: MatchRosterItem) {
  return item.card?.name ?? `선수 ID ${item.player.spId}`;
}

function formatMatchOption(match: NormalizedMatch) {
  return `${formatDate(match.playedAt)} · vs ${match.opponentNickname} · ${formatScore(match.score.for)}:${formatScore(match.score.against)}`;
}

function formatAssignmentMatchKind(kind: TacticInstructionAssignment["matchKind"]) {
  if (kind === "exact-recent-position") {
    return "최근 동일 위치";
  }

  if (kind === "compatible-position") {
    return "호환 위치 후보";
  }

  return "선수 미배정";
}

function isGuideForRecommendation(
  guide: TacticApplicationGuide,
  recommendation: TacticRecommendation,
) {
  return (
    guide.recommendationConfigHash === recommendation.metadata.configHash &&
    guide.templateId === recommendation.metadata.templateId
  );
}

function clampPitchCoordinate(value: number) {
  return Math.min(Math.max(value, 12), 88);
}

function RecentSquadCardView({ card }: { card: RecentSquadCard }) {
  const displayName = card.name ?? `선수 ID ${card.spId}`;
  const position = card.positionName ??
    (card.positionCode === null ? "포지션 정보 없음" : `포지션 ${card.positionCode}`);

  return (
    <article className="squad-card">
      <div className="squad-card-identity">
        <div className="squad-player-image" aria-hidden="true">
          <span>FC</span>
          <img
            src={card.playerImageUrl}
            data-fallback-src={card.playerFallbackImageUrl}
            alt=""
            width="72"
            height="72"
            loading="lazy"
            onError={handlePlayerImageError}
          />
        </div>
        <div>
          <span className="squad-season">{card.seasonName ?? "시즌 정보 없음"}</span>
          <h3>{displayName}</h3>
          <p>
            <strong>+{card.spGrade ?? "?"}</strong> · {position}
          </p>
        </div>
      </div>
      <dl className="squad-card-stats">
        <div>
          <dt>최근 명단</dt>
          <dd>{card.listedMatches}경기</dd>
        </div>
        <div>
          <dt>선발 위치</dt>
          <dd>{card.positionName === null ? "-" : `${card.starterMatches}경기`}</dd>
        </div>
        <div>
          <dt>평균 평점</dt>
          <dd>{card.averageRating ?? "-"}</dd>
        </div>
        <div>
          <dt>골/도움</dt>
          <dd>
            {card.goals}/{card.assists}
          </dd>
        </div>
      </dl>
      {card.officialDataCenterUrl ? (
        <a
          className="ability-link"
          href={card.officialDataCenterUrl}
          target="_blank"
          rel="noreferrer"
        >
          공식 능력치 보기
          <span className="visually-hidden"> — 새 창</span>
        </a>
      ) : (
        <span className="ability-link is-unavailable">강화 단계 확인 불가</span>
      )}
    </article>
  );
}

function handlePlayerImageError(event: SyntheticEvent<HTMLImageElement>) {
  const image = event.currentTarget;
  const fallback = image.dataset.fallbackSrc;

  if (fallback) {
    delete image.dataset.fallbackSrc;
    image.src = fallback;
    return;
  }

  image.hidden = true;
}

function TacticRecommendationView({
  recommendation,
}: {
  recommendation: TacticRecommendationSet;
}) {
  return (
    <section className="tactic-recommendation" aria-label="추천 전술">
      <div className="section-title">
        <p className="eyebrow">바로 적용할 전술</p>
        <h2>주전술</h2>
      </div>
      <div className="tactic-list">
        <TacticCard label="주전술" recommendation={recommendation.primary} />
        <details className="alternative-tactic">
          <summary>
            <span>대안 전술 보기</span>
            <span className="alternative-tactic-detail">
              <strong>
                {recommendation.alternative.title} · {recommendation.alternative.formation}
              </strong>
              <ValidationBadge
                status={recommendation.alternative.metadata.validation.formation}
              />
            </span>
          </summary>
          <div className="alternative-tactic-content">
            <TacticCard label="대안 전술" recommendation={recommendation.alternative} />
          </div>
        </details>
      </div>
    </section>
  );
}

function TacticCard({
  label,
  recommendation,
}: {
  label: string;
  recommendation: TacticRecommendation;
}) {
  const { metadata } = recommendation;
  const [copyStatus, setCopyStatus] = useState<"idle" | "success" | "error">("idle");
  const copyStatusId = useId();
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyResetTimer.current) {
        clearTimeout(copyResetTimer.current);
      }
    };
  }, []);

  async function handleCopy() {
    if (copyResetTimer.current) {
      clearTimeout(copyResetTimer.current);
    }

    try {
      await copyTextToClipboard(formatTeamTacticForClipboard(recommendation));
      setCopyStatus("success");
    } catch {
      setCopyStatus("error");
    }

    copyResetTimer.current = setTimeout(() => setCopyStatus("idle"), 4000);
  }

  return (
    <article className="tactic-card">
      <div className="tactic-card-head">
        <div>
          <span className="tactic-label">{label}</span>
          <h3>{recommendation.title}</h3>
        </div>
        <div className="tactic-card-actions">
          <div className="formation">
            <strong>{recommendation.formation}</strong>
            <ValidationBadge status={metadata.validation.formation} />
          </div>
          <button
            type="button"
            className="copy-button"
            onClick={handleCopy}
            aria-describedby={copyStatusId}
          >
            {copyStatus === "success" ? "복사 완료" : "팀 전술 복사"}
          </button>
          <span
            id={copyStatusId}
            className={`copy-status${copyStatus === "error" ? " is-error" : ""}`}
            role="status"
            aria-live="polite"
          >
            {copyStatus === "success"
              ? "팀 전술이 클립보드에 복사되었습니다."
              : copyStatus === "error"
                ? "복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요."
                : ""}
          </span>
        </div>
      </div>
      <p className="tactic-explanation">{recommendation.explanation}</p>
      <div className="compatibility-summary" role="note" aria-label="전술 적용 가능 범위">
        <div>
          <span>전체</span>
          <ValidationBadge status={metadata.validation.overall} />
        </div>
        <div>
          <span>팀 전술</span>
          <ValidationBadge status={metadata.validation.teamTactics} />
        </div>
        <p>포메이션은 미확인 참고값이며, 개인 전술은 복사에서 제외됩니다.</p>
      </div>
      <div className="tactic-block">
        <h4>팀 전술</h4>
        <div className="setting-grid">
          <Setting label="팀 성향" value={recommendation.teamTactics.teamMentality} />
          <Setting
            label="수비 스타일"
            value={recommendation.teamTactics.defensiveTactics.defensiveStyle}
          />
          <Setting
            label="수비 폭"
            value={`${recommendation.teamTactics.defensiveTactics.width} / 10`}
          />
          <Setting
            label="수비 깊이"
            value={`${recommendation.teamTactics.defensiveTactics.depth} / 10`}
          />
          <Setting
            label="빌드업 · 수비 진영"
            value={recommendation.teamTactics.offensiveTactics.buildUpPlay}
          />
          <Setting
            label="기회 만들기 · 공격 진영"
            value={recommendation.teamTactics.offensiveTactics.chanceCreation}
          />
          <Setting
            label="공격 폭"
            value={`${recommendation.teamTactics.offensiveTactics.width} / 10`}
          />
          <Setting
            label="박스 안쪽 선수"
            value={`${recommendation.teamTactics.offensiveTactics.playersInBox} / 10`}
          />
          <Setting
            label="코너킥"
            value={`${recommendation.teamTactics.offensiveTactics.corners} / 5`}
          />
          <Setting
            label="프리킥"
            value={`${recommendation.teamTactics.offensiveTactics.freeKicks} / 5`}
          />
        </div>
      </div>
      <details className="tactic-details">
        <summary>추천 근거와 버전 정보</summary>
        <div className="tactic-details-content">
          <p className="matched-rule">선택 규칙: {recommendation.matchedRule}</p>
          <dl className="tactic-metadata" aria-label={`${label} 버전 정보`}>
            <MetadataItem label="스키마" value={metadata.schemaVersion} />
            <MetadataItem label="게임 패치" value={metadata.gamePatchVersion} />
            <MetadataItem
              label="템플릿"
              value={`${metadata.templateId} · v${metadata.templateVersion}`}
            />
            <MetadataItem label="설정 해시" value={metadata.configHash} />
          </dl>
        </div>
      </details>
      <details className="tactic-details">
        <summary>검증 상태 자세히 보기</summary>
        <div className="tactic-details-content">
          <div className="validation-summary" role="note" aria-label="전술 검증 범위">
            <div>
              <span>전체</span>
              <ValidationBadge status={metadata.validation.overall} />
            </div>
            <div>
              <span>팀 전술</span>
              <ValidationBadge status={metadata.validation.teamTactics} />
            </div>
            <div>
              <span>포메이션</span>
              <ValidationBadge status={metadata.validation.formation} />
            </div>
            <div>
              <span>개인 전술</span>
              <ValidationBadge status={metadata.validation.personalTactics} />
            </div>
            {metadata.validation.overall === "partial" ? (
              <p>
                팀 전술만 현행 공식 입력 범위에 맞췄습니다. 포메이션과 개인 전술은 실제
                클라이언트 확인 전까지 참고용입니다.
              </p>
            ) : null}
          </div>
        </div>
      </details>
      <details className="tactic-details personal-instructions-details">
        <summary>미확인 개인 전술 후보 보기</summary>
        <div className="tactic-details-content tactic-block">
          <div className="tactic-block-heading">
            <h4>개인 전술</h4>
            <span>추천 역할 설명과 UI 메뉴값 후보를 구분해 확인하세요</span>
          </div>
          <p className="unconfirmed-instruction-note" role="note">
            아래 개인 전술과 참여도는 모두 미확인 상태입니다. 실제 클라이언트에서 메뉴와
            값을 확인하기 전에는 적용하지 마세요.
          </p>
          <ul className="instruction-list">
            {recommendation.playerInstructions.map((item, instructionIndex) => (
              <li
                key={`${item.positions.join("/")}-${item.roleDescription}-${item.uiSettings
                  .map((setting) => `${setting.group}:${setting.value}`)
                  .join(",")}`}
              >
                <div className="instruction-heading">
                  <strong>{item.positions.join(" / ")}</strong>
                  <span>
                    <small>추천 역할(설명)</small>
                    {item.roleDescription}
                  </span>
                </div>
                <p className="setting-kind">UI 메뉴 / 값 후보</p>
                <dl className="personal-tactics">
                  {item.uiSettings.map((setting, settingIndex) => (
                    <div
                      key={`${instructionIndex}-${settingIndex}-${setting.group}-${setting.value}`}
                    >
                      <dt>{setting.group}</dt>
                      <dd>
                        <span>{setting.value}</span>
                        <ConfirmationBadge confirmed={setting.confirmed} />
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="participation-settings">
                  <ParticipationSetting label="공격 참여도" setting={item.attackParticipation} />
                  <ParticipationSetting label="수비 참여도" setting={item.defenseParticipation} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </article>
  );
}

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // 권한이 거절된 브라우저에서도 사용자 클릭 안에서 동기 복사를 한 번 더 시도한다.
    }
  }

  const previouslyFocused =
    document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Clipboard copy command failed");
    }
  } finally {
    textarea.remove();
    previouslyFocused?.focus();
  }
}

function MetadataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="metadata-item">
      <dt>{label}</dt>
      <dd>
        <code>{value}</code>
      </dd>
    </div>
  );
}

function ValidationBadge({ status }: { status: "confirmed" | "unconfirmed" | "partial" }) {
  const labels = {
    confirmed: "확인됨",
    unconfirmed: "미확인",
    partial: "부분 검증",
  } as const;

  return <span className={`validation-badge is-${status}`}>{labels[status]}</span>;
}

function ConfirmationBadge({ confirmed }: { confirmed: boolean }) {
  return (
    <span className={`confirmation-badge ${confirmed ? "is-confirmed" : "is-unconfirmed"}`}>
      {confirmed ? "확인됨" : "미확인"}
    </span>
  );
}

function ParticipationSetting({
  label,
  setting,
}: {
  label: string;
  setting: { value: number; confirmed: boolean };
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{setting.value}</strong>
      <ConfirmationBadge confirmed={setting.confirmed} />
    </div>
  );
}

function Setting({ label, value }: { label: string; value: string }) {
  return (
    <div className="setting-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StyleAnalysisView({ analysis }: { analysis: CompatiblePlayStyleAnalysis }) {
  const confidence = getAnalysisConfidence(analysis);
  const hasUnavailableScore = analysis.styles.some((style) => style.score === null);
  const matchCountLabel =
    analysis.matchCount === analysis.requestedMatchCount
      ? `최근 ${analysis.matchCount}경기 기준`
      : `요청 ${analysis.requestedMatchCount}경기 중 ${analysis.matchCount}경기 기준`;

  return (
    <section className="style-analysis" aria-label="플레이 성향 분석">
      <div className="section-title">
        <p className="eyebrow">플레이 성향</p>
        <h2>{matchCountLabel}</h2>
      </div>
      {confidence ? (
        <div className={`confidence-note ${getConfidenceClass(confidence.level)}`}>
          <div className="confidence-summary">
            <span>데이터 충분도</span>
            <strong>{formatConfidenceLevel(confidence.level)}</strong>
            <span>데이터 충족률 {formatCoverage(confidence.coverage)}</span>
          </div>
          <p>{confidence.message}</p>
        </div>
      ) : hasUnavailableScore ? (
        <p className="confidence-note is-insufficient">
          일부 경기 지표가 없어 계산하지 못한 성향이 있습니다. 정보가 충분한 항목만 참고해
          주세요.
        </p>
      ) : null}
      <div className="style-grid">
        {analysis.styles.map((style) => (
          <article
            key={style.label}
            className={`style-card${style.score === null ? " is-unavailable" : ""}`}
          >
            <div>
              <h3>{style.label}</h3>
              <strong>{style.score === null ? "정보 부족" : `${style.score}점`}</strong>
            </div>
            <p>{style.reason}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function getAnalysisConfidence(analysis: CompatiblePlayStyleAnalysis): AnalysisConfidence | null {
  const confidence = analysis.confidence;

  if (
    !confidence ||
    typeof confidence.level !== "string" ||
    typeof confidence.coverage !== "number" ||
    typeof confidence.message !== "string"
  ) {
    return null;
  }

  return confidence;
}

function formatConfidenceLevel(level: string) {
  const labels: Record<string, string> = {
    high: "높음",
    medium: "보통",
    low: "낮음",
    insufficient: "정보 부족",
  };

  return labels[level.toLowerCase()] ?? level;
}

function getConfidenceClass(level: string) {
  const normalizedLevel = level.toLowerCase();

  if (normalizedLevel === "high" || level === "높음") {
    return "is-high";
  }

  if (normalizedLevel === "medium" || level === "보통") {
    return "is-medium";
  }

  return "is-insufficient";
}

function formatCoverage(coverage: number) {
  if (!Number.isFinite(coverage)) {
    return "정보 없음";
  }

  const percentage = coverage >= 0 && coverage <= 1 ? coverage * 100 : coverage;
  const boundedPercentage = Math.min(Math.max(percentage, 0), 100);

  return `${Math.round(boundedPercentage)}%`;
}

function EmptyState() {
  return (
    <section className="empty">
      <h2>닉네임을 입력하면 최근 공식 경기 결과가 여기에 표시됩니다.</h2>
      <p>DB 저장 없이 Open API 응답을 바로 정리해서 보여줍니다.</p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function getResultClass(result: string) {
  if (result === "승리") {
    return "win";
  }

  if (result === "패배") {
    return "loss";
  }

  if (result === "무승부") {
    return "draw";
  }

  return "unknown";
}

function formatDate(value: string | null) {
  if (!value) {
    return "일시 정보 없음";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatScore(value: number | null) {
  return value ?? "-";
}

function formatCount(value: number | null) {
  return value === null ? "-" : `${value}`;
}

function formatPercent(value: number | null) {
  return value === null ? "-" : `${value}%`;
}
