import { describe, expect, it } from "vitest";

import basicUserFixture from "./__fixtures__/success/basic-user.json";
import matchDetailsFixture from "./__fixtures__/success/match-details.json";
import { normalizeSearchResult } from "./normalize";
import type { FcOnlineBasicUserResponse, FcOnlineMatchDetailResponse } from "./types";

const basicUser = basicUserFixture as FcOnlineBasicUserResponse;
const matchDetails = matchDetailsFixture as FcOnlineMatchDetailResponse[];

describe("normalizeSearchResult", () => {
  it("fixture 성공 응답을 화면 표시용 요약으로 정리한다", () => {
    const result = normalizeSearchResult(basicUser, matchDetails);

    expect(result.user).toEqual({
      ouid: "fixture-ouid-001",
      nickname: "테스트구단주",
      level: 123,
    });
    expect(result.summary).toEqual({
      matchType: "공식 경기",
      totalMatches: 2,
      wins: 1,
      draws: 1,
      losses: 0,
      unknown: 0,
    });
  });

  it("fixture 경기 상세 응답에서 점수와 주요 지표를 읽는다", () => {
    const result = normalizeSearchResult(basicUser, matchDetails);
    const firstMatch = result.matches[0];
    const secondMatch = result.matches[1];

    expect(firstMatch).toMatchObject({
      matchId: "fixture-match-001",
      result: "승리",
      opponentNickname: "상대구단주",
      score: {
        for: 3,
        against: 1,
      },
      stats: {
        possession: 55,
        shots: 10,
        effectiveShots: 6,
        passSuccessRate: 90,
        tackleSuccessRate: 80,
        dribbles: 21,
      },
    });
    expect(secondMatch.score).toEqual({ for: 2, against: 2 });
    expect(secondMatch.stats.passSuccessRate).toBe(80);
    expect(secondMatch.stats.tackleSuccessRate).toBe(50);
  });

  it("조회 유저가 없는 경기 상세 응답은 정규화 결과에서 제외한다", () => {
    const result = normalizeSearchResult(basicUser, [
      {
        matchId: "missing-user-match",
        matchInfo: [],
      },
      ...matchDetails,
    ]);

    expect(result.summary.totalMatches).toBe(2);
    expect(result.matches.map((match) => match.matchId)).not.toContain("missing-user-match");
  });

  it("성공 횟수가 0이고 시도 횟수가 양수이면 성공률 0%를 보존한다", () => {
    const result = normalizeSearchResult(basicUser, [
      {
        matchId: "zero-success-rate",
        matchInfo: [
          {
            ouid: basicUser.ouid,
            matchDetail: { matchResult: "무" },
            pass: { passTry: 4, passSuccess: 0 },
            defence: { tackleTry: 5, tackleSuccess: 0 },
          },
          { ouid: "opponent-ouid", nickname: "상대" },
        ],
      },
    ]);

    expect(result.matches[0].stats.passSuccessRate).toBe(0);
    expect(result.matches[0].stats.tackleSuccessRate).toBe(0);
  });

  it("분모가 0 이하이거나 성공 횟수가 범위를 벗어난 비율은 제외한다", () => {
    const result = normalizeSearchResult(basicUser, [
      {
        matchId: "invalid-denominator",
        matchInfo: [
          {
            ouid: basicUser.ouid,
            pass: { passTry: 0, passSuccess: 0 },
            defence: { tackleTry: -1, tackleSuccess: 0 },
          },
        ],
      },
      {
        matchId: "invalid-success-count",
        matchInfo: [
          {
            ouid: basicUser.ouid,
            pass: { passTry: 5, passSuccess: 6 },
            defence: { tackleTry: 5, tackleSuccess: -1 },
          },
        ],
      },
    ]);

    expect(result.matches[0].stats.passSuccessRate).toBeNull();
    expect(result.matches[0].stats.tackleSuccessRate).toBeNull();
    expect(result.matches[1].stats.passSuccessRate).toBeNull();
    expect(result.matches[1].stats.tackleSuccessRate).toBeNull();
  });

  it("공백 문자열 통계를 숫자 0으로 오인하지 않는다", () => {
    const result = normalizeSearchResult(basicUser, [
      {
        matchId: "blank-stats",
        matchInfo: [
          {
            ouid: basicUser.ouid,
            matchDetail: { possession: " ", dribble: "" },
            shoot: { shootTotal: "\t", effectiveShootTotal: "\n" },
          },
        ],
      },
    ]);

    expect(result.matches[0].stats).toMatchObject({
      possession: null,
      shots: null,
      effectiveShots: null,
      dribbles: null,
    });
  });

  it("최근 경기 선수 카드와 경기 활약을 별도 구조로 보존한다", () => {
    const result = normalizeSearchResult(basicUser, [
      {
        matchId: "players",
        matchInfo: [
          {
            ouid: basicUser.ouid,
            player: [
              {
                spId: "225136606",
                spGrade: "9",
                spPosition: "13",
                status: {
                  spRating: "8.4",
                  goal: 1,
                  assist: "2",
                  shoot: 3,
                  effectiveShoot: 2,
                  passTry: 24,
                  passSuccess: 21,
                  tackleTry: 4,
                  tackle: 3,
                  intercept: 2,
                  block: 0,
                },
              },
            ],
          },
        ],
      },
    ]);

    expect(result.matches[0].players).toEqual([
      {
        spId: 225136606,
        spGrade: 9,
        spPosition: 13,
        performance: {
          rating: 8.4,
          goals: 1,
          assists: 2,
          shots: 3,
          effectiveShots: 2,
          passesAttempted: 24,
          passesCompleted: 21,
          tacklesAttempted: 4,
          tacklesCompleted: 3,
          interceptions: 2,
          blocks: 0,
        },
      },
    ]);
  });

  it("손상된 선수만 제외하고 알 수 없는 포지션과 결측 활약은 허용한다", () => {
    const details: FcOnlineMatchDetailResponse[] = [
      {
        matchId: "partial-players",
        matchInfo: [
          {
            ouid: basicUser.ouid,
            player: [
              { spId: 0, spGrade: 1, spPosition: 0 },
              { spId: "not-a-number", spGrade: 1, spPosition: 0 },
              {
                spId: 999000001,
                spGrade: 99,
                spPosition: 999,
                status: { goal: -1, spRating: "-2" },
              },
            ],
          },
        ],
      },
    ];
    const before = structuredClone(details);
    const result = normalizeSearchResult(basicUser, details);

    expect(result.matches[0].players).toHaveLength(1);
    expect(result.matches[0].players[0]).toMatchObject({
      spId: 999000001,
      spGrade: null,
      spPosition: 999,
      performance: {
        rating: null,
        goals: null,
      },
    });
    expect(details).toEqual(before);
  });

  it("알 수 없는 결과를 별도 집계하고 누락된 경기 ID에 고유 fallback을 부여한다", () => {
    const result = normalizeSearchResult(basicUser, [
      {
        matchInfo: [
          { ouid: basicUser.ouid, matchDetail: { matchResult: "기권" } },
          { ouid: "opponent-1" },
        ],
      },
      {
        matchId: "   ",
        matchInfo: [
          { ouid: basicUser.ouid },
          { ouid: "opponent-2" },
        ],
      },
    ]);

    expect(result.matches.map((match) => match.matchId)).toEqual([
      "unknown-match-1",
      "unknown-match-2",
    ]);
    expect(result.matches.map((match) => match.result)).toEqual(["알 수 없음", "알 수 없음"]);
    expect(result.summary).toMatchObject({
      totalMatches: 2,
      wins: 0,
      draws: 0,
      losses: 0,
      unknown: 2,
    });
    expect(
      result.summary.wins +
        result.summary.draws +
        result.summary.losses +
        result.summary.unknown,
    ).toBe(result.summary.totalMatches);
  });
});
