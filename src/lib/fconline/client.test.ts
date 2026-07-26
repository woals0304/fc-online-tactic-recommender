import { afterEach, describe, expect, it, vi } from "vitest";

import { FcOnlineApiError, FcOnlineClient } from "./client";

describe("FcOnlineClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("API 키와 쿼리 파라미터를 서버 요청에만 넣는다", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ ouid: "fixture-ouid" }),
    );
    const client = new FcOnlineClient("server-api-key", {
      fetchImplementation: fetchMock as typeof fetch,
    });

    await expect(client.getOuidByNickname("테스트 유저")).resolves.toEqual({
      ouid: "fixture-ouid",
    });

    const [input, init] = fetchMock.mock.calls[0];
    const url = new URL(String(input));

    expect(url.pathname).toBe("/fconline/v1/id");
    expect(url.searchParams.get("nickname")).toBe("테스트 유저");
    expect(init?.headers).toEqual({ "x-nxopen-api-key": "server-api-key" });
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("성공 응답의 JSON 파싱 실패를 안전한 API 오류로 바꾼다", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("not-json", {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    const client = new FcOnlineClient("server-api-key", {
      fetchImplementation: fetchMock as typeof fetch,
    });

    await expect(client.getOuidByNickname("테스트")).rejects.toMatchObject({
      code: "INVALID_JSON",
      message: "FC ONLINE API 응답을 해석하지 못했습니다.",
      status: 502,
    });
  });

  it("외부 오류 본문을 그대로 노출하지 않고 상태와 오류 코드만 보존한다", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        { error: { name: "TooManyRequests", message: "private upstream detail" } },
        { status: 429 },
      ),
    );
    const client = new FcOnlineClient("server-api-key", {
      fetchImplementation: fetchMock as typeof fetch,
    });

    await expect(client.getOuidByNickname("테스트")).rejects.toMatchObject({
      code: "TooManyRequests",
      message: "API 호출량이 많습니다. 잠시 뒤 다시 시도해 주세요.",
      status: 429,
    });
  });

  it("제한 시간이 지나면 진행 중인 fetch를 중단하고 timeout 오류를 반환한다", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    const client = new FcOnlineClient("server-api-key", {
      fetchImplementation: fetchMock as typeof fetch,
      timeoutMs: 25,
    });
    const request = client.getOuidByNickname("테스트");
    const assertion = expect(request).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      message: "FC ONLINE API 응답 시간이 초과되었습니다.",
      status: 504,
    });

    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("네트워크 예외를 안정된 연결 오류로 변환한다", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("socket detail that must stay internal");
    });
    const client = new FcOnlineClient("server-api-key", {
      fetchImplementation: fetchMock as typeof fetch,
    });

    await expect(client.getOuidByNickname("테스트")).rejects.toEqual(
      expect.objectContaining<Partial<FcOnlineApiError>>({
        code: "NETWORK_ERROR",
        message: "FC ONLINE API에 연결하지 못했습니다.",
        status: 502,
      }),
    );
  });

  it("여러 클라이언트의 외부 요청 시작 시점을 프로세스 전체에서 분산한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T00:00:00Z"));
    const fetchMock = vi.fn(async () => Response.json({ ouid: "fixture-ouid" }));
    const firstClient = new FcOnlineClient("server-api-key", {
      fetchImplementation: fetchMock as typeof fetch,
      useGlobalThrottle: true,
    });
    const secondClient = new FcOnlineClient("server-api-key", {
      fetchImplementation: fetchMock as typeof fetch,
      useGlobalThrottle: true,
    });

    const firstRequest = firstClient.getOuidByNickname("첫 번째");
    const secondRequest = secondClient.getOuidByNickname("두 번째");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(124);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([firstRequest, secondRequest]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("전역 요청 슬롯 대기도 전체 제한 시간에 포함한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T00:00:00Z"));
    const fetchMock = vi.fn(async () => Response.json({ ouid: "fixture-ouid" }));
    const firstClient = new FcOnlineClient("server-api-key", {
      fetchImplementation: fetchMock as typeof fetch,
      timeoutMs: 1_000,
      useGlobalThrottle: true,
    });
    const waitingClient = new FcOnlineClient("server-api-key", {
      fetchImplementation: fetchMock as typeof fetch,
      timeoutMs: 50,
      useGlobalThrottle: true,
    });

    const firstRequest = firstClient.getOuidByNickname("첫 번째");
    const waitingRequest = waitingClient.getOuidByNickname("대기 중");
    const assertion = expect(waitingRequest).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      status: 504,
    });

    await vi.advanceTimersByTimeAsync(0);
    await firstRequest;
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(50);
    await assertion;
    await vi.advanceTimersByTimeAsync(75);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("429 Retry-After 동안 다음 전역 요청 시작을 미룬다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T00:00:00Z"));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: { name: "TooManyRequests" } },
          { headers: { "retry-after": "2" }, status: 429 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ ouid: "fixture-ouid" }));
    const client = new FcOnlineClient("server-api-key", {
      fetchImplementation: fetchMock as typeof fetch,
      timeoutMs: 5_000,
      useGlobalThrottle: true,
    });

    const firstRequest = client.getOuidByNickname("첫 번째");
    const firstAssertion = expect(firstRequest).rejects.toMatchObject({ status: 429 });
    await vi.advanceTimersByTimeAsync(0);
    await firstAssertion;

    const secondRequest = client.getOuidByNickname("두 번째");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(secondRequest).resolves.toEqual({ ouid: "fixture-ouid" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
