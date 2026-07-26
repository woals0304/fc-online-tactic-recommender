import { describe, expect, it } from "vitest";

import type { SquadMetadataLookup } from "../fconline/squadProfile";
import type {
  NormalizedMatch,
  NormalizedMatchPlayer,
  PlayStyleAnalysis,
} from "../fconline/types";
import { recommendTactic } from "./tacticRecommender";
import {
  buildTacticApplicationGuideSet,
  getPositionAssignmentMatchKind,
} from "./tacticApplicationGuide";

const balancedAnalysis: PlayStyleAnalysis = {
  matchCount: 1,
  requestedMatchCount: 1,
  confidence: { level: "low", coverage: 100, message: "합성 분석" },
  styles: [
    { label: "공격적", score: 0, reason: "합성" },
    { label: "수비 불안", score: 0, reason: "합성" },
    { label: "득점력 높음", score: 0, reason: "합성" },
    { label: "점유율 지향", score: 0, reason: "합성" },
    { label: "슈팅 빈도 높음", score: 0, reason: "합성" },
  ],
};

const positionNames = new Map<number, string>([
  [1, "LS"],
  [2, "RS"],
  [3, "ST"],
  [4, "LM"],
  [5, "RM"],
  [6, "LCM"],
  [7, "RCM"],
  [8, "LB"],
  [9, "RB"],
  [10, "SUB"],
  [11, "GK"],
]);

const metadata: Pick<SquadMetadataLookup, "getPositionName"> = {
  getPositionName: (code) => positionNames.get(code) ?? null,
};

describe("buildTacticApplicationGuideSet", () => {
  it("그룹형 개인전술을 슬롯별로 펼치고 최근 명단의 정확한 포지션을 연결한다", () => {
    const recommendation = recommendTactic(balancedAnalysis);
    const match = createMatch(
      "latest-lineup",
      "2026-07-27T00:00:00Z",
      [
        [101, 1],
        [102, 2],
        [103, 4],
        [104, 5],
        [105, 6],
        [106, 7],
        [107, 8],
        [108, 9],
      ].map(([spId, spPosition]) => createPlayer(spId, 5, spPosition)),
    );

    const guides = buildTacticApplicationGuideSet(recommendation, [match], metadata);
    const primary = guides.primary;

    expect(primary).toMatchObject({
      recommendationConfigHash: recommendation.primary.metadata.configHash,
      templateId: recommendation.primary.metadata.templateId,
      referenceMatchId: "latest-lineup",
      referencePlayedAt: "2026-07-27T00:00:00Z",
      assignedSlots: 8,
      totalSlots: 8,
      validation: { formation: "unconfirmed", personalTactics: "unconfirmed" },
    });
    expect(primary.assignments.map((assignment) => assignment.position)).toEqual([
      "LS",
      "RS",
      "LM",
      "RM",
      "LCM",
      "RCM",
      "LB",
      "RB",
    ]);
    expect(primary.assignments.filter((assignment) => assignment.instructionIndex === 2))
      .toMatchObject([
        { position: "LM", matchKind: "exact-recent-position" },
        { position: "RM", matchKind: "exact-recent-position" },
      ]);
    expect(primary.assignments.every((assignment) => assignment.matchKind === "exact-recent-position"))
      .toBe(true);
  });

  it("전체 정확 일치를 우선하는 1:1 매칭으로 한 카드를 중복 배치하지 않는다", () => {
    const recommendation = recommendTactic(balancedAnalysis);
    const match = createMatch("matching", "2026-07-27T00:00:00Z", [
      createPlayer(201, 5, 1),
      createPlayer(202, 5, 3),
    ]);

    const primary = buildTacticApplicationGuideSet(recommendation, [match], metadata).primary;
    const [leftStriker, rightStriker] = primary.assignments;

    expect(leftStriker).toMatchObject({
      position: "LS",
      card: { spId: 201, spGrade: 5 },
      observedPosition: "LS",
      observedPositionCode: 1,
      matchKind: "exact-recent-position",
    });
    expect(rightStriker).toMatchObject({
      position: "RS",
      card: { spId: 202, spGrade: 5 },
      observedPosition: "ST",
      observedPositionCode: 3,
      matchKind: "compatible-position",
    });
    expect(
      new Set(
        primary.assignments
          .filter((assignment) => assignment.card !== null)
          .map((assignment) => `${assignment.card?.spId}:${assignment.card?.spGrade}`),
      ).size,
    ).toBe(primary.assignedSlots);
  });

  it("SUB뿐인 최신 경기는 건너뛰고 가장 최근 해석 가능한 경기만 기준으로 삼는다", () => {
    const recommendation = recommendTactic(balancedAnalysis);
    const guides = buildTacticApplicationGuideSet(
      recommendation,
      [
        createMatch("sub-only", "2026-07-27T02:00:00Z", [createPlayer(301, 5, 10)]),
        createMatch("reference", "2026-07-27T01:00:00Z", [createPlayer(302, 5, 3)]),
        createMatch("older", "2026-07-27T00:00:00Z", [createPlayer(303, 5, 1)]),
      ],
      metadata,
    );

    expect(guides.primary.referenceMatchId).toBe("reference");
    expect(guides.primary.assignments.filter((assignment) => assignment.card !== null))
      .toHaveLength(1);
    expect(guides.primary.assignments.find((assignment) => assignment.card)?.card?.spId)
      .toBe(302);
  });

  it("메타데이터로 해석할 수 없는 명단은 임의 배치하지 않고 모든 슬롯을 미배정한다", () => {
    const recommendation = recommendTactic(balancedAnalysis);
    const guides = buildTacticApplicationGuideSet(
      recommendation,
      [createMatch("unknown", "2026-07-27T00:00:00Z", [createPlayer(401, 5, 99)])],
      { getPositionName: () => null },
    );

    expect(guides.primary).toMatchObject({
      referenceMatchId: null,
      referencePlayedAt: null,
      assignedSlots: 0,
      totalSlots: 8,
    });
    expect(guides.primary.assignments.every((assignment) => assignment.matchKind === "unassigned"))
      .toBe(true);
    expect(guides.primary.assignments.every((assignment) => assignment.card === null))
      .toBe(true);
    expect(
      guides.primary.assignments.every(
        (assignment) => assignment.observedPositionCode === null,
      ),
    ).toBe(true);
  });

  it("중앙과 좌우 슬롯 사이만 호환하고 좌우를 서로 바꾸지 않는다", () => {
    expect(getPositionAssignmentMatchKind("ST", "LS")).toBe("compatible-position");
    expect(getPositionAssignmentMatchKind("LS", "ST")).toBe("compatible-position");
    expect(getPositionAssignmentMatchKind("LS", "RS")).toBeNull();
    expect(getPositionAssignmentMatchKind("LCM", "RCM")).toBeNull();
    expect(getPositionAssignmentMatchKind("LB", "RB")).toBeNull();
  });

  it("입력 배열 순서와 무관하게 playedAt이 가장 최신인 해석 가능 경기를 고른다", () => {
    const recommendation = recommendTactic(balancedAnalysis);
    const guides = buildTacticApplicationGuideSet(
      recommendation,
      [
        createMatch("oldest", "2026-07-25T00:00:00Z", [createPlayer(501, 5, 3)]),
        createMatch("latest", "2026-07-27T00:00:00Z", [createPlayer(502, 5, 3)]),
        createMatch("middle", "2026-07-26T00:00:00Z", [createPlayer(503, 5, 3)]),
      ],
      metadata,
    );

    expect(guides.primary.referenceMatchId).toBe("latest");
    expect(guides.primary.assignments.find((assignment) => assignment.card)?.card?.spId)
      .toBe(502);
  });

  it("기준 경기의 동일 카드 중복 행을 한 슬롯에만 배정한다", () => {
    const recommendation = recommendTactic(balancedAnalysis);
    const duplicate = createPlayer(601, 5, 3);
    const primary = buildTacticApplicationGuideSet(
      recommendation,
      [createMatch("duplicate-card", "2026-07-27T00:00:00Z", [duplicate, duplicate])],
      metadata,
    ).primary;

    expect(primary.assignedSlots).toBe(1);
    expect(
      primary.assignments.filter((assignment) => assignment.card?.spId === 601),
    ).toHaveLength(1);
  });
});

function createMatch(
  matchId: string,
  playedAt: string | null,
  players: NormalizedMatchPlayer[],
): NormalizedMatch {
  return {
    matchId,
    playedAt,
    matchType: 50,
    result: "알 수 없음",
    opponentNickname: "합성 상대",
    score: { for: null, against: null },
    stats: {
      possession: null,
      shots: null,
      effectiveShots: null,
      passSuccessRate: null,
      tackleSuccessRate: null,
      dribbles: null,
    },
    players,
  };
}

function createPlayer(
  spId: number,
  spGrade: number,
  spPosition: number,
): NormalizedMatchPlayer {
  return {
    spId,
    spGrade,
    spPosition,
    performance: {
      rating: null,
      goals: null,
      assists: null,
      shots: null,
      effectiveShots: null,
      passesAttempted: null,
      passesCompleted: null,
      tacklesAttempted: null,
      tacklesCompleted: null,
      interceptions: null,
      blocks: null,
    },
  };
}
