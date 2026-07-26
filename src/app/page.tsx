"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

import type {
  ApiErrorResponse,
  PlayStyleAnalysis,
  SearchResultWithAnalysis,
  TacticRecommendation,
  TacticRecommendationSet,
} from "@/lib/fconline/types";

type ViewState =
  | { status: "idle" }
  | { status: "loading"; submittedNickname: string }
  | { status: "success"; submittedNickname: string; result: SearchResultWithAnalysis }
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

type AnalysisWithOptionalConfidence = PlayStyleAnalysis & {
  confidence?: AnalysisConfidence;
};

type SummaryWithOptionalUnknown = SearchResultWithAnalysis["summary"] & {
  unknown?: number;
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

      if (!isSearchResult(data)) {
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
        <p className="eyebrow">1차 MVP</p>
        <h1>FC ONLINE 전적 기반 전술 추천기</h1>
        <p className="description">
          닉네임으로 최근 공식 경기 데이터를 조회하고, 플레이 성향에 맞는 규칙 기반 전술을
          추천합니다.
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

function isSearchResult(value: unknown): value is SearchResultWithAnalysis {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isRecord(value.user) &&
    isRecord(value.summary) &&
    Array.isArray(value.matches) &&
    isRecord(value.analysis) &&
    isRecord(value.recommendation)
  );
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
  result: SearchResultWithAnalysis;
  submittedNickname: string;
}) {
  const unknownMatches = (result.summary as SummaryWithOptionalUnknown).unknown;

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

      <StyleAnalysisView analysis={result.analysis} />
      <TacticRecommendationView recommendation={result.recommendation} />

      {result.matches.length > 0 ? (
        <div className="match-list">
          {result.matches.map((match) => (
            <article key={match.matchId} className="match-card">
              <div className="match-head">
                <span className={`result-badge ${getResultClass(match.result)}`}>{match.result}</span>
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
      ) : (
        <p className="notice">최근 공식 경기 기록을 찾지 못했습니다.</p>
      )}
    </section>
  );
}

function TacticRecommendationView({
  recommendation,
}: {
  recommendation: TacticRecommendationSet;
}) {
  return (
    <section className="tactic-recommendation" aria-label="추천 전술">
      <div className="section-title">
        <p className="eyebrow">추천 전술</p>
        <h2>주전술 + 대안 전술</h2>
      </div>
      <div className="tactic-list">
        <TacticCard label="주전술" recommendation={recommendation.primary} />
        <TacticCard label="대안 전술" recommendation={recommendation.alternative} />
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
  return (
    <article className="tactic-card">
      <div className="tactic-card-head">
        <div>
          <span>{label}</span>
          <h3>{recommendation.title}</h3>
          <p className="matched-rule">선택 규칙: {recommendation.matchedRule}</p>
        </div>
        <strong>{recommendation.formation}</strong>
      </div>
      <div className="tactic-block">
        <h4>팀 전술</h4>
        <div className="setting-grid">
          <Setting label="팀 성향" value={recommendation.teamTactics.teamMentality} />
          <Setting label="수비 스타일" value={recommendation.teamTactics.defensiveTactics.defensiveStyle} />
          <Setting label="수비 폭" value={`${recommendation.teamTactics.defensiveTactics.width}`} />
          <Setting label="수비 깊이" value={`${recommendation.teamTactics.defensiveTactics.depth}`} />
          <Setting label="빌드업 플레이" value={recommendation.teamTactics.offensiveTactics.buildUpPlay} />
          <Setting label="공격 폭" value={`${recommendation.teamTactics.offensiveTactics.width}`} />
          <Setting label="박스 안쪽 선수" value={`${recommendation.teamTactics.offensiveTactics.playersInBox}`} />
          <Setting label="코너킥" value={`${recommendation.teamTactics.offensiveTactics.corners}`} />
          <Setting label="프리킥" value={`${recommendation.teamTactics.offensiveTactics.freeKicks}`} />
        </div>
      </div>
      <div className="tactic-block">
        <h4>개인 전술</h4>
        <ul className="instruction-list">
          {recommendation.playerInstructions.map((item) => (
            <li
              key={`${item.position}-${item.role}-${item.personalTactics
                .map((setting) => `${setting.menu}:${setting.value}`)
                .join(",")}`}
            >
              <div>
                <strong>{item.position}</strong>
                <span>{item.role}</span>
              </div>
              <dl className="personal-tactics">
                {item.personalTactics.map((setting) => (
                  <div key={`${item.position}-${setting.menu}-${setting.value}`}>
                    <dt>{setting.menu}</dt>
                    <dd>{setting.value}</dd>
                  </div>
                ))}
              </dl>
              <small>
                공격 참여도 {item.attackParticipation} · 수비 참여도 {item.defenseParticipation}
              </small>
            </li>
          ))}
        </ul>
      </div>
      <p className="tactic-explanation">{recommendation.explanation}</p>
    </article>
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

function StyleAnalysisView({ analysis }: { analysis: PlayStyleAnalysis }) {
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
            <span>분석 신뢰도</span>
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

function getAnalysisConfidence(analysis: PlayStyleAnalysis): AnalysisConfidence | null {
  const confidence = (analysis as AnalysisWithOptionalConfidence).confidence;

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
