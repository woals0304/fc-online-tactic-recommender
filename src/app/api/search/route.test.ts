import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isTacticRecommendationSet } from "../../../lib/tactics/tacticSchema";

const clientMocks = vi.hoisted(() => ({
  getBasicUser: vi.fn(),
  getMatchDetail: vi.fn(),
  getOuidByNickname: vi.fn(),
  getRecentMatchIds: vi.fn(),
}));

vi.mock("../../../lib/fconline/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/fconline/client")>();

  return {
    ...actual,
    FcOnlineClient: class MockFcOnlineClient {
      getBasicUser = clientMocks.getBasicUser;
      getMatchDetail = clientMocks.getMatchDetail;
      getOuidByNickname = clientMocks.getOuidByNickname;
      getRecentMatchIds = clientMocks.getRecentMatchIds;
    },
  };
});

type GetHandler = typeof import("./route").GET;
type ApiErrorConstructor = typeof import("../../../lib/fconline/client").FcOnlineApiError;

let GET: GetHandler;
let FcOnlineApiError: ApiErrorConstructor;

const originalApiKey = process.env.NEXON_OPEN_API_KEY;
const originalTrustProxyHeaders = process.env.FC_ONLINE_TRUST_PROXY_HEADERS;

describe("GET /api/search", () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    vi.useRealTimers();
    process.env.NEXON_OPEN_API_KEY = "test-api-key";
    delete process.env.FC_ONLINE_TRUST_PROXY_HEADERS;

    clientMocks.getOuidByNickname.mockResolvedValue({ ouid: "fixture-ouid" });
    clientMocks.getBasicUser.mockResolvedValue({
      level: 123,
      nickname: "테스트구단주",
      ouid: "fixture-ouid",
    });
    clientMocks.getRecentMatchIds.mockResolvedValue(["match-1"]);
    clientMocks.getMatchDetail.mockImplementation(async (matchId: string) =>
      createMatchDetail(matchId),
    );

    ({ GET } = await import("./route"));
    ({ FcOnlineApiError } = await import("../../../lib/fconline/client"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterAll(() => {
    restoreEnvironment("NEXON_OPEN_API_KEY", originalApiKey);
    restoreEnvironment("FC_ONLINE_TRUST_PROXY_HEADERS", originalTrustProxyHeaders);
  });

  it("닉네임 최대 길이를 외부 API 호출 전에 검증한다", async () => {
    const response = await GET(createRequest("가".repeat(31)));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      message: "FC ONLINE 닉네임은 30자 이하로 입력해 주세요.",
      status: 400,
      type: "validation",
    });
    expect(clientMocks.getOuidByNickname).not.toHaveBeenCalled();
  });

  it("검증 실패 요청은 외부 API용 전역 요청 예산을 소모하지 않는다", async () => {
    for (let index = 0; index < 65; index += 1) {
      const invalidResponse = await GET(createRequest(""));
      expect(invalidResponse.status).toBe(400);
    }

    const validResponse = await GET(createRequest("테스트"));
    expect(validResponse.status).toBe(200);
    expect(clientMocks.getOuidByNickname).toHaveBeenCalledOnce();
  });

  it("설정 오류에서 환경변수 이름을 공개하지 않고 서버에 기록한다", async () => {
    delete process.env.NEXON_OPEN_API_KEY;

    const response = await GET(createRequest("테스트"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      message: "서버 설정이 완료되지 않았습니다. 잠시 뒤 다시 시도해 주세요.",
      status: 500,
      type: "configuration",
    });
    expect(body.message).not.toContain("NEXON_OPEN_API_KEY");
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("ouid 조회 뒤 기본 정보와 경기 ID를 병렬로 요청하고 마지막 상세 뒤에는 기다리지 않는다", async () => {
    vi.useFakeTimers();
    const basicUser = deferred<{
      level: number;
      nickname: string;
      ouid: string;
    }>();
    const matchIds = deferred<string[]>();
    clientMocks.getBasicUser.mockReturnValue(basicUser.promise);
    clientMocks.getRecentMatchIds.mockReturnValue(matchIds.promise);

    const responsePromise = GET(createRequest("테스트"));
    await vi.advanceTimersByTimeAsync(0);

    expect(clientMocks.getBasicUser).toHaveBeenCalledOnce();
    expect(clientMocks.getRecentMatchIds).toHaveBeenCalledOnce();
    expect(clientMocks.getMatchDetail).not.toHaveBeenCalled();

    basicUser.resolve({ level: 123, nickname: "테스트구단주", ouid: "fixture-ouid" });
    matchIds.resolve(["match-1"]);
    await vi.advanceTimersByTimeAsync(0);

    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(clientMocks.getMatchDetail).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("추천 전술의 현행 스키마를 JSON 응답에 손실 없이 직렬화한다", async () => {
    const response = await GET(createRequest("테스트"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(isTacticRecommendationSet(body.recommendation)).toBe(true);

    const { primary, alternative } = body.recommendation;

    expect(primary.metadata).toMatchObject({
      schemaVersion: "fc-online-12nf-2026-03-26",
      gamePatchVersion: "12th-next-field-2026-03-26",
      templateVersion: "1.0.0",
      configHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      validation: {
        overall: "partial",
        teamTactics: "confirmed",
        formation: "unconfirmed",
        personalTactics: "unconfirmed",
      },
    });
    expect(primary.teamTactics.schemaVersion).toBe(primary.metadata.schemaVersion);
    expect(primary.teamTactics.offensiveTactics.chanceCreation).toEqual(expect.any(String));
    expect(alternative.teamTactics.offensiveTactics.chanceCreation).toEqual(expect.any(String));
    expect(primary.metadata.templateId).not.toBe(alternative.metadata.templateId);
    expect(primary.formation).not.toBe(alternative.formation);

    for (const recommendation of [primary, alternative]) {
      for (const instruction of recommendation.playerInstructions) {
        expect(instruction.positions).toEqual(expect.arrayContaining([expect.any(String)]));
        expect(instruction).not.toHaveProperty("position");
        expect(instruction.uiSettings.length).toBeGreaterThan(0);
        expect(
          instruction.uiSettings.every(
            (setting: { confirmed: boolean }) => setting.confirmed === false,
          ),
        ).toBe(true);
        expect(instruction.attackParticipation).toMatchObject({ confirmed: false });
        expect(instruction.defenseParticipation).toMatchObject({ confirmed: false });
        expect(Number.isInteger(instruction.attackParticipation.value)).toBe(true);
        expect(Number.isInteger(instruction.defenseParticipation.value)).toBe(true);
      }
    }
  });

  it("사용자 기본 응답의 식별자가 조회 결과와 다르면 안전한 502로 거부한다", async () => {
    clientMocks.getBasicUser.mockResolvedValue({
      level: 123,
      nickname: "테스트구단주",
      ouid: "unexpected-ouid",
    });

    const response = await GET(createRequest("테스트"));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ status: 502, type: "external-api" });
    expect(clientMocks.getMatchDetail).not.toHaveBeenCalled();
  });

  it("공백이 섞인 경기 상세 OUID를 정규화 단계에서 같은 사용자로 오인하지 않는다", async () => {
    const detail = createMatchDetail("match-1");
    detail.matchInfo[0].ouid = " fixture-ouid ";
    clientMocks.getMatchDetail.mockResolvedValue(detail);

    const response = await GET(createRequest("테스트"));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ status: 502, type: "external-api" });
    expect(body.message).not.toContain("상세 정보를 정리할 수 없습니다");
  });

  it("경기 ID의 공백과 중복을 제거한 뒤 상세 조회한다", async () => {
    clientMocks.getRecentMatchIds.mockResolvedValue([
      " match-1 ",
      "match-1",
      "",
      "   ",
    ]);

    const response = await GET(createRequest("테스트", 4));

    expect(response.status).toBe(200);
    expect(clientMocks.getMatchDetail).toHaveBeenCalledOnce();
    expect(clientMocks.getMatchDetail).toHaveBeenCalledWith("match-1");
  });

  it("동일 닉네임과 limit의 동시 요청을 합치고 성공 결과를 짧게 캐시한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
    const identity = deferred<{ ouid: string }>();
    clientMocks.getOuidByNickname.mockReturnValue(identity.promise);

    const firstResponse = GET(createRequest("테스트", 1));
    const secondResponse = GET(createRequest("테스트", 1));
    await vi.advanceTimersByTimeAsync(0);

    expect(clientMocks.getOuidByNickname).toHaveBeenCalledOnce();
    identity.resolve({ ouid: "fixture-ouid" });
    await vi.advanceTimersByTimeAsync(0);

    const [first, second] = await Promise.all([firstResponse, secondResponse]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    const cached = await GET(createRequest("테스트", 1));
    expect(cached.status).toBe(200);
    expect(clientMocks.getOuidByNickname).toHaveBeenCalledOnce();

    vi.setSystemTime(new Date("2026-07-26T00:00:16Z"));
    await GET(createRequest("테스트", 1));
    expect(clientMocks.getOuidByNickname).toHaveBeenCalledTimes(2);
  });

  it("일부 상세 조회가 성공한 뒤 429가 오면 추가 호출을 중단하고 부분 결과를 반환한다", async () => {
    vi.useFakeTimers();
    clientMocks.getRecentMatchIds.mockResolvedValue(["match-1", "match-2", "match-3"]);
    clientMocks.getMatchDetail
      .mockResolvedValueOnce(createMatchDetail("match-1"))
      .mockRejectedValueOnce(new FcOnlineApiError("private quota detail", 429, "RATE_LIMIT"))
      .mockResolvedValueOnce(createMatchDetail("match-3"));

    const responsePromise = GET(createRequest("테스트", 3));
    await vi.advanceTimersByTimeAsync(1_000);
    const response = await responsePromise;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.summary.totalMatches).toBe(1);
    expect(clientMocks.getMatchDetail).toHaveBeenCalledTimes(2);
    expect(clientMocks.getMatchDetail).not.toHaveBeenCalledWith("match-3");
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it("조회 사용자가 빠진 상세은 제외하고 누락 경기까지 신뢰도에 반영하며 캐시하지 않는다", async () => {
    vi.useFakeTimers();
    clientMocks.getRecentMatchIds.mockResolvedValue(["match-1", "match-2"]);
    clientMocks.getMatchDetail.mockImplementation(async (matchId: string) => {
      if (matchId === "match-2") {
        return {
          matchId,
          matchInfo: [{ nickname: "다른 사용자", ouid: "different-ouid" }],
        };
      }

      return createMatchDetail(matchId);
    });

    const firstResponsePromise = GET(createRequest("테스트", 2));
    await vi.advanceTimersByTimeAsync(1_000);
    const firstResponse = await firstResponsePromise;
    const firstBody = await firstResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(firstBody.summary.totalMatches).toBe(1);
    expect(firstBody.analysis).toMatchObject({
      matchCount: 1,
      requestedMatchCount: 2,
      confidence: { level: "low", coverage: 50 },
    });

    const secondResponsePromise = GET(createRequest("테스트", 2));
    await vi.advanceTimersByTimeAsync(1_000);
    await secondResponsePromise;
    expect(clientMocks.getOuidByNickname).toHaveBeenCalledTimes(2);
  });

  it("경기 상세의 배열 구조와 요청한 경기 ID를 검증한다", async () => {
    clientMocks.getMatchDetail.mockResolvedValue({
      matchId: "different-match",
      matchInfo: {},
    });

    const malformedResponse = await GET(createRequest("테스트"));
    expect(malformedResponse.status).toBe(502);

    clientMocks.getMatchDetail.mockResolvedValue({
      ...createMatchDetail("different-match"),
      matchId: "different-match",
    });
    const mismatchedResponse = await GET(createRequest("다른테스트"));
    expect(mismatchedResponse.status).toBe(502);
  });

  it("경기 상세 응답 ID가 없으면 요청 ID로 안전하게 보완한다", async () => {
    clientMocks.getMatchDetail.mockResolvedValue({
      ...createMatchDetail("match-1"),
      matchId: undefined,
    });

    const response = await GET(createRequest("테스트"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.matches[0].matchId).toBe("match-1");
  });

  it("경기 상세 404를 사용자 검색 실패로 오인하지 않는다", async () => {
    clientMocks.getMatchDetail.mockRejectedValue(
      new FcOnlineApiError("private detail not found", 404, "DETAIL_NOT_FOUND"),
    );

    const response = await GET(createRequest("테스트"));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.message).not.toContain("사용자를 찾지 못했습니다");
    expect(body.message).not.toContain("private");
  });

  it("상세 조회가 하나도 성공하지 못한 timeout은 504로 정규화하고 후속 호출을 중단한다", async () => {
    clientMocks.getRecentMatchIds.mockResolvedValue(["match-1", "match-2"]);
    clientMocks.getMatchDetail.mockRejectedValueOnce(
      new FcOnlineApiError("private timeout detail", 504, "REQUEST_TIMEOUT"),
    );

    const response = await GET(createRequest("테스트", 2));
    const body = await response.json();

    expect(response.status).toBe(504);
    expect(body).toEqual({
      message: "FC ONLINE 응답이 지연되고 있습니다. 잠시 뒤 다시 시도해 주세요.",
      status: 504,
      type: "external-api",
    });
    expect(JSON.stringify(body)).not.toContain("private timeout detail");
    expect(clientMocks.getMatchDetail).toHaveBeenCalledOnce();
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("외부 인증 오류를 공개 502 메시지로 정규화하고 서버에만 상세를 기록한다", async () => {
    clientMocks.getOuidByNickname.mockRejectedValue(
      new FcOnlineApiError("private API key detail", 403, "INVALID_KEY"),
    );

    const response = await GET(createRequest("테스트"));
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.type).toBe("external-api");
    expect(body.message).not.toContain("private");
    expect(body.message).not.toContain("API key");
    expect(console.error).toHaveBeenCalledWith(
      "[api/search] FC ONLINE request failed.",
      expect.objectContaining({ code: "INVALID_KEY", status: 403 }),
    );
  });

  it("캐시와 진행 중 병합을 포함한 모든 유효 요청에 신뢰 프록시 IP 제한을 적용한다", async () => {
    process.env.FC_ONLINE_TRUST_PROXY_HEADERS = "true";
    const identity = deferred<{ ouid: string }>();
    clientMocks.getOuidByNickname.mockReturnValueOnce(identity.promise);
    const requests = Array.from({ length: 11 }, () =>
      GET(
        createRequest("테스트", 1, { "x-forwarded-for": "203.0.113.10, 10.0.0.1" }),
      ),
    );

    expect(clientMocks.getOuidByNickname).toHaveBeenCalledOnce();
    identity.resolve({ ouid: "fixture-ouid" });
    const responses = await Promise.all(requests);
    const statuses = responses.map((response) => response.status);

    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
    expect(clientMocks.getOuidByNickname).toHaveBeenCalledOnce();

    const limited = await GET(
      createRequest("테스트", 1, { "x-forwarded-for": "203.0.113.10" }),
    );
    expect(limited.headers.get("retry-after")).toBe("60");
  });

  it("IP 제한으로 거절된 반복 요청은 다른 사용자의 전역 요청 예산을 소모하지 않는다", async () => {
    process.env.FC_ONLINE_TRUST_PROXY_HEADERS = "true";
    const noisyClientHeaders = { "x-forwarded-for": "203.0.113.20" };

    for (let index = 0; index < 10; index += 1) {
      const response = await GET(createRequest("테스트", 1, noisyClientHeaders));
      expect(response.status).toBe(200);
    }

    for (let index = 0; index < 60; index += 1) {
      const response = await GET(createRequest("테스트", 1, noisyClientHeaders));
      expect(response.status).toBe(429);
    }

    const otherClient = await GET(
      createRequest("테스트", 1, { "x-forwarded-for": "203.0.113.21" }),
    );
    expect(otherClient.status).toBe(200);
  });

  it("캐시 적중은 전역 상류 호출 예산을 추가로 차감하지 않는다", async () => {
    const statuses: number[] = [];

    for (let index = 0; index < 10; index += 1) {
      const response = await GET(createRequest("테스트", 10));
      statuses.push(response.status);
    }

    expect(statuses).toEqual(Array(10).fill(200));
    expect(clientMocks.getOuidByNickname).toHaveBeenCalledOnce();
  });

  it("진행 중 요청 병합은 전역 예산을 추가 차감하지 않고 새 검색만 예상 비용을 예약한다", async () => {
    const identity = deferred<{ ouid: string }>();
    clientMocks.getOuidByNickname.mockReturnValueOnce(identity.promise);

    const firstResponse = GET(createRequest("동시조회", 10));
    const secondResponse = GET(createRequest("동시조회", 10));

    expect(clientMocks.getOuidByNickname).toHaveBeenCalledOnce();
    identity.resolve({ ouid: "fixture-ouid" });
    const mergedResponses = await Promise.all([firstResponse, secondResponse]);
    expect(mergedResponses.map((response) => response.status)).toEqual([200, 200]);

    for (let index = 0; index < 8; index += 1) {
      const response = await GET(createRequest(`새조회-${index}`, 10));
      expect(response.status).toBe(200);
    }

    const exhausted = await GET(createRequest("예산초과", 10));
    expect(exhausted.status).toBe(429);
    expect(exhausted.headers.get("retry-after")).toBe("60");
    expect(clientMocks.getOuidByNickname).toHaveBeenCalledTimes(9);
  });

  it("실제 새 검색은 예상 외부 호출 수만큼 전역 예산을 예약한다", async () => {
    const statuses: number[] = [];

    for (let index = 0; index < 10; index += 1) {
      const response = await GET(createRequest(`테스트-${index}`, 10));
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 9)).toEqual(Array(9).fill(200));
    expect(statuses[9]).toBe(429);
  });

  it("프록시 신뢰 설정이 없으면 전달 IP 헤더를 개별 버킷으로 사용하지 않는다", async () => {
    const statuses: number[] = [];

    for (let index = 0; index < 11; index += 1) {
      const response = await GET(
        createRequest("테스트", 1, { "x-forwarded-for": "198.51.100.20" }),
      );
      statuses.push(response.status);
    }

    expect(statuses).toEqual(Array(11).fill(200));
    expect(clientMocks.getOuidByNickname).toHaveBeenCalledOnce();
  });
});

function createRequest(nickname: string, limit?: number, headers?: HeadersInit) {
  const url = new URL("http://localhost/api/search");
  url.searchParams.set("nickname", nickname);

  if (limit !== undefined) {
    url.searchParams.set("limit", String(limit));
  }

  return new Request(url, { headers });
}

function createMatchDetail(matchId: string) {
  return {
    matchDate: "2026-07-26T10:00:00",
    matchId,
    matchInfo: [
      {
        defence: { tackleSuccess: 3, tackleTry: 4 },
        matchDetail: { dribble: 12, matchResult: "승", possession: 52 },
        nickname: "테스트구단주",
        ouid: "fixture-ouid",
        pass: { passSuccess: 80, passTry: 100 },
        shoot: { effectiveShootTotal: 4, goalTotalDisplay: 2, shootTotal: 7 },
      },
      {
        nickname: "상대구단주",
        ouid: "opponent-ouid",
        shoot: { goalTotalDisplay: 1 },
      },
    ],
    matchType: 50,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }

  process.env[name] = value;
}
