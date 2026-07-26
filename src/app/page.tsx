"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";

import type {
  ApiErrorResponse,
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
