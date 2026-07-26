import type {
  FcOnlineBasicUserResponse,
  FcOnlineIdResponse,
  FcOnlineMatchDetailResponse,
} from "./types";

const API_BASE_URL = "https://open.api.nexon.com/fconline/v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 8_000;
const GLOBAL_REQUEST_START_INTERVAL_MS = 125;
const MAX_QUEUED_REQUEST_STARTS = 200;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 1_000;
const MAX_RATE_LIMIT_COOLDOWN_MS = 60_000;

let nextRequestStartAt = 0;
let requestStartQueue = Promise.resolve();
let queuedRequestStarts = 0;

type FcOnlineClientOptions = {
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
  useGlobalThrottle?: boolean;
};

export class FcOnlineApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "FcOnlineApiError";
    this.status = status;
    this.code = code;
  }
}

type NexonErrorBody = {
  error?: {
    name?: string;
    message?: string;
  };
};

export class FcOnlineClient {
  private readonly apiKey: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;
  private readonly useGlobalThrottle: boolean;

  constructor(apiKey: string, options: FcOnlineClientOptions = {}) {
    this.apiKey = apiKey;
    this.fetchImplementation = options.fetchImplementation || fetch;
    this.timeoutMs = normalizeTimeout(options.timeoutMs);
    this.useGlobalThrottle =
      options.useGlobalThrottle ?? options.fetchImplementation === undefined;
  }

  async getOuidByNickname(nickname: string) {
    return this.request<FcOnlineIdResponse>("/id", { nickname });
  }

  async getBasicUser(ouid: string) {
    return this.request<FcOnlineBasicUserResponse>("/user/basic", { ouid });
  }

  async getRecentMatchIds(ouid: string, matchType: number, limit: number) {
    return this.request<string[]>("/user/match", {
      ouid,
      matchtype: String(matchType),
      offset: "0",
      limit: String(limit),
    });
  }

  async getMatchDetail(matchId: string) {
    return this.request<FcOnlineMatchDetailResponse>("/match-detail", {
      matchid: matchId,
    });
  }

  private async request<T>(path: string, params: Record<string, string>) {
    const url = new URL(`${API_BASE_URL}${path}`);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      if (this.useGlobalThrottle) {
        await waitForGlobalRequestSlot(controller.signal);
      }

      const response = await this.fetchImplementation(url, {
        headers: {
          "x-nxopen-api-key": this.apiKey,
        },
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await safeReadError(response);

        if (controller.signal.aborted) {
          throw createRequestTimeoutError();
        }

        if (this.useGlobalThrottle && response.status === 429) {
          applyGlobalRateLimitCooldown(response.headers.get("retry-after"));
        }

        throw new FcOnlineApiError(
          getReadableErrorMessage(response.status),
          response.status,
          body.error?.name,
        );
      }

      try {
        return (await response.json()) as T;
      } catch {
        if (controller.signal.aborted) {
          throw createRequestTimeoutError();
        }

        throw new FcOnlineApiError(
          "FC ONLINE API 응답을 해석하지 못했습니다.",
          502,
          "INVALID_JSON",
        );
      }
    } catch (error) {
      if (error instanceof FcOnlineApiError) {
        throw error;
      }

      if (controller.signal.aborted || isAbortError(error)) {
        throw createRequestTimeoutError();
      }

      throw new FcOnlineApiError(
        "FC ONLINE API에 연결하지 못했습니다.",
        502,
        "NETWORK_ERROR",
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

function createRequestTimeoutError() {
  return new FcOnlineApiError(
    "FC ONLINE API 응답 시간이 초과되었습니다.",
    504,
    "REQUEST_TIMEOUT",
  );
}

function normalizeTimeout(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_REQUEST_TIMEOUT_MS;
  }

  return Math.floor(value);
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function waitForGlobalRequestSlot(signal: AbortSignal) {
  if (queuedRequestStarts >= MAX_QUEUED_REQUEST_STARTS) {
    throw new FcOnlineApiError(
      "FC ONLINE API 요청 대기열이 가득 찼습니다.",
      503,
      "UPSTREAM_QUEUE_FULL",
    );
  }

  queuedRequestStarts += 1;
  const previousRequestStart = requestStartQueue;
  let resolveSlot!: () => void;
  let rejectSlot!: (error: unknown) => void;
  let slotSettled = false;
  const slotResult = new Promise<void>((resolve, reject) => {
    resolveSlot = () => {
      if (!slotSettled) {
        slotSettled = true;
        resolve();
      }
    };
    rejectSlot = (error) => {
      if (!slotSettled) {
        slotSettled = true;
        reject(error);
      }
    };
  });
  const handleAbort = () => rejectSlot(createAbortError());
  signal.addEventListener("abort", handleAbort, { once: true });

  if (signal.aborted) {
    handleAbort();
  }

  const queuedWork = previousRequestStart.then(async () => {
    try {
      throwIfAborted(signal);

      while (nextRequestStartAt > Date.now()) {
        await wait(nextRequestStartAt - Date.now(), signal);
      }

      throwIfAborted(signal);
      nextRequestStartAt = Date.now() + GLOBAL_REQUEST_START_INTERVAL_MS;
      resolveSlot();
    } catch (error) {
      rejectSlot(error);
    } finally {
      queuedRequestStarts -= 1;
      signal.removeEventListener("abort", handleAbort);
    }
  });
  requestStartQueue = queuedWork.then(
    () => undefined,
    () => undefined,
  );

  await slotResult;
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, ms);
    const handleAbort = () => {
      clearTimeout(timeout);
      reject(createAbortError());
    };

    signal.addEventListener("abort", handleAbort, { once: true });

    if (signal.aborted) {
      handleAbort();
    }
  });
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw createAbortError();
  }
}

function createAbortError() {
  return new DOMException("Request aborted.", "AbortError");
}

function applyGlobalRateLimitCooldown(retryAfterHeader: string | null) {
  nextRequestStartAt = Math.max(
    nextRequestStartAt,
    Date.now() + readRetryAfterMs(retryAfterHeader),
  );
}

function readRetryAfterMs(retryAfterHeader: string | null) {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);

    if (Number.isFinite(seconds) && seconds >= 0) {
      return clampCooldown(Math.ceil(seconds * 1_000));
    }

    const retryAt = Date.parse(retryAfterHeader);

    if (Number.isFinite(retryAt)) {
      return clampCooldown(retryAt - Date.now());
    }
  }

  return DEFAULT_RATE_LIMIT_COOLDOWN_MS;
}

function clampCooldown(value: number) {
  return Math.min(
    MAX_RATE_LIMIT_COOLDOWN_MS,
    Math.max(GLOBAL_REQUEST_START_INTERVAL_MS, value),
  );
}

async function safeReadError(response: Response): Promise<NexonErrorBody> {
  try {
    return (await response.json()) as NexonErrorBody;
  } catch {
    return {};
  }
}

function getReadableErrorMessage(status: number) {
  if (status === 400) {
    return "닉네임 또는 요청 값이 올바르지 않습니다.";
  }

  if (status === 403) {
    return "API 키 권한을 확인해 주세요.";
  }

  if (status === 429) {
    return "API 호출량이 많습니다. 잠시 뒤 다시 시도해 주세요.";
  }

  if (status === 503) {
    return "현재 FC ONLINE API가 점검 중입니다.";
  }

  return "FC ONLINE API 호출 중 문제가 발생했습니다.";
}
