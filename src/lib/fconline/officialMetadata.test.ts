import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OFFICIAL_METADATA_ENDPOINTS,
  OFFICIAL_METADATA_FAILURE_TTL_MS,
  OFFICIAL_METADATA_TTL_MS,
  clearOfficialMetadataCache,
  createOfficialPlayerImageUrl,
  createOfficialPlayerInfoUrl,
  loadOfficialMetadata,
} from "./officialMetadata";

const VALID_PLAYERS = [
  { id: 225136606, name: "윤정환" },
  { id: 201209331, name: "손흥민" },
];
const VALID_SEASONS = [
  {
    seasonId: 225,
    className: "TKL (TEAM K LEAGUE)",
    seasonImg: "https://ssl.nexon.com/season/tkl.png",
  },
  {
    seasonId: 201,
    className: "201 LIVE",
    seasonImg: "https://ssl.nexon.com/season/live.png",
  },
];
const VALID_POSITIONS = [
  { spposition: 0, desc: "GK" },
  { spposition: 25, desc: "ST" },
  { spposition: 28, desc: "SUB" },
];

describe("officialMetadata", () => {
  beforeEach(() => {
    clearOfficialMetadataCache();
  });

  it("세 공식 메타데이터를 병렬로 요청하고 resolver를 제공한다", async () => {
    const pendingResponses = new Map<string, (response: Response) => void>();
    const fetchMock = vi.fn(
      (input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          pendingResponses.set(String(input), resolve);
        }),
    );

    const resultPromise = loadOfficialMetadata({
      fetchImplementation: fetchMock as typeof fetch,
      now: () => Date.parse("2026-07-27T00:00:00.000Z"),
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Set(fetchMock.mock.calls.map(([input]) => String(input)))).toEqual(
      new Set(Object.values(OFFICIAL_METADATA_ENDPOINTS)),
    );

    pendingResponses.get(OFFICIAL_METADATA_ENDPOINTS.players)?.(
      Response.json(VALID_PLAYERS),
    );
    pendingResponses.get(OFFICIAL_METADATA_ENDPOINTS.seasons)?.(
      Response.json(VALID_SEASONS),
    );
    pendingResponses.get(OFFICIAL_METADATA_ENDPOINTS.positions)?.(
      Response.json(VALID_POSITIONS),
    );

    const result = await resultPromise;
    expect(result.status).toBe("available");

    if (result.status !== "available") {
      throw new Error("expected available official metadata");
    }

    expect(result.fetchedAt).toBe("2026-07-27T00:00:00.000Z");
    expect(result.expiresAt).toBe("2026-07-28T00:00:00.000Z");
    expect(result.getPlayerName(225136606)).toBe("윤정환");
    expect(result.getPlayerName(999999999)).toBeNull();
    expect(result.getSeason(225136606)).toEqual(VALID_SEASONS[0]);
    expect(result.getSeason(999136606)).toBeNull();
    expect(result.getPositionName(25)).toBe("ST");
    expect(result.getPositionName(999)).toBeNull();
    expect(result.isSubstitutePosition(28)).toBe(true);
    expect(result.isSubstitutePosition(25)).toBe(false);
  });

  it.each([
    {
      label: "spid 배열 내부 필드",
      overrides: { players: [{ id: 225136606, name: 123 }] },
    },
    {
      label: "seasonid 배열 내부 URL",
      overrides: {
        seasons: [
          {
            seasonId: 225,
            className: "TKL",
            seasonImg: "javascript:alert(1)",
          },
        ],
      },
    },
    {
      label: "spposition 배열 내부 필드",
      overrides: { positions: [{ spposition: 25 }] },
    },
  ])("$label 오류를 깊이 검증해 unavailable로 바꾼다", async ({ overrides }) => {
    const fetchMock = createFetchMock(overrides);

    await expect(
      loadOfficialMetadata({ fetchImplementation: fetchMock as typeof fetch }),
    ).resolves.toMatchObject({
      status: "unavailable",
      fetchedAt: null,
      reason: "invalid-response",
    });
  });

  it("중복 식별자가 있으면 전체 응답을 신뢰하지 않는다", async () => {
    const fetchMock = createFetchMock({
      positions: [
        { spposition: 25, desc: "ST" },
        { spposition: 25, desc: "ST duplicate" },
      ],
    });

    const result = await loadOfficialMetadata({
      fetchImplementation: fetchMock as typeof fetch,
    });

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "invalid-response",
    });
  });

  it("네트워크와 HTTP 실패를 throw하지 않고 unavailable로 반환한다", async () => {
    const networkFetch = vi.fn(async () => {
      throw new TypeError("socket detail");
    });

    await expect(
      loadOfficialMetadata({ fetchImplementation: networkFetch as typeof fetch }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "network-error",
    });

    clearOfficialMetadataCache();
    const httpFetch = vi.fn(async () => new Response(null, { status: 503 }));

    await expect(
      loadOfficialMetadata({ fetchImplementation: httpFetch as typeof fetch }),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "http-error",
    });
  });

  it("24시간 동안 module cache를 사용하고 만료 시 다시 가져온다", async () => {
    let now = Date.parse("2026-07-27T00:00:00.000Z");
    const fetchMock = createFetchMock();
    const options = {
      fetchImplementation: fetchMock as typeof fetch,
      now: () => now,
    };

    const first = await loadOfficialMetadata(options);
    const cached = await loadOfficialMetadata(options);

    expect(first.status).toBe("available");
    expect(cached).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    now += OFFICIAL_METADATA_TTL_MS - 1;
    expect(await loadOfficialMetadata(options)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    now += 1;
    const refreshed = await loadOfficialMetadata(options);
    expect(refreshed.status).toBe("available");
    expect(refreshed).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("실패 결과를 1분간 캐시해 장애 중 반복 호출을 막는다", async () => {
    let now = Date.parse("2026-07-27T00:00:00.000Z");
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    const options = {
      fetchImplementation: fetchMock as typeof fetch,
      now: () => now,
    };

    const first = await loadOfficialMetadata(options);
    const cached = await loadOfficialMetadata(options);

    expect(first.status).toBe("unavailable");
    expect(cached).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    now += OFFICIAL_METADATA_FAILURE_TTL_MS;
    await loadOfficialMetadata(options);
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("24시간 갱신이 일시 실패하면 최근 정상본을 유지하고 1분 뒤 재시도한다", async () => {
    let now = Date.parse("2026-07-27T00:00:00.000Z");
    let shouldFail = false;
    const normalFetch = createFetchMock();
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      if (shouldFail) {
        return Promise.resolve(new Response(null, { status: 503 }));
      }

      return normalFetch(input);
    });
    const options = {
      fetchImplementation: fetchMock as typeof fetch,
      now: () => now,
    };

    const first = await loadOfficialMetadata(options);
    expect(first.status).toBe("available");

    now += OFFICIAL_METADATA_TTL_MS;
    shouldFail = true;
    expect(await loadOfficialMetadata(options)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(6);

    expect(await loadOfficialMetadata(options)).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(6);

    now += OFFICIAL_METADATA_FAILURE_TTL_MS;
    shouldFail = false;
    const refreshed = await loadOfficialMetadata(options);
    expect(refreshed.status).toBe("available");
    expect(refreshed).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(9);
  });

  it("공식 이미지와 사용자 이동용 PlayerInfo 링크를 안전하게 만든다", () => {
    expect(createOfficialPlayerImageUrl(225136606)).toBe(
      "https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/players/p225136606.png",
    );
    expect(createOfficialPlayerImageUrl(225136606, "action")).toBe(
      "https://fco.dn.nexoncdn.co.kr/live/externalAssets/common/playersAction/p225136606.png",
    );
    expect(createOfficialPlayerInfoUrl(225136606, 9)).toBe(
      "https://fconline.nexon.com/DataCenter/PlayerInfo?spid=225136606&n1Strong=9",
    );

    expect(createOfficialPlayerImageUrl(Number.NaN)).toBeNull();
    expect(createOfficialPlayerInfoUrl(225136606, 0)).toBeNull();
    expect(createOfficialPlayerInfoUrl(225136606, 14)).toBeNull();
  });
});

type MetadataOverrides = {
  players?: unknown;
  seasons?: unknown;
  positions?: unknown;
};

function createFetchMock(overrides: MetadataOverrides = {}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === OFFICIAL_METADATA_ENDPOINTS.players) {
      return Response.json(overrides.players ?? VALID_PLAYERS);
    }

    if (url === OFFICIAL_METADATA_ENDPOINTS.seasons) {
      return Response.json(overrides.seasons ?? VALID_SEASONS);
    }

    if (url === OFFICIAL_METADATA_ENDPOINTS.positions) {
      return Response.json(overrides.positions ?? VALID_POSITIONS);
    }

    return new Response(null, { status: 404 });
  });
}
