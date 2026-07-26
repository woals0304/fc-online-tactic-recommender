import { describe, expect, it } from "vitest";

import type { TacticRecommendation } from "../fconline/types";
import { formatTeamTacticForClipboard } from "./formatTeamTacticForClipboard";

describe("formatTeamTacticForClipboard", () => {
  it("FC ONLINE 입력 순서와 숫자 분모를 갖춘 복사문을 만든다", () => {
    expect(formatTeamTacticForClipboard(createRecommendation())).toBe(
      [
        "[FC ONLINE 팀 전술] 공격 점유 압박",
        "포메이션: 4-3-2-1 (클라이언트 미확인)",
        "",
        "팀 성향: 공격적",
        "",
        "수비",
        "스타일: 공 뺏긴 직후 압박",
        "폭: 6/10",
        "깊이: 7/10",
        "",
        "공격",
        "빌드업: 짧은 패스",
        "기회 만들기: 밸런스",
        "폭: 8/10",
        "박스 안쪽 선수: 7/10",
        "코너킥: 3/5",
        "프리킥: 2/5",
        "",
        "※ 개인 전술은 FC ONLINE 클라이언트 확인 전입니다.",
      ].join("\n"),
    );
  });

  it("미확인 개인 전술 후보와 역할 설명 및 내부 메타데이터를 노출하지 않는다", () => {
    const output = formatTeamTacticForClipboard(createRecommendation());

    expect(output).not.toContain("내부-개인전술-후보");
    expect(output).not.toContain("내부-역할-설명");
    expect(output).not.toContain("fc-online-12nf-2026-03-26");
    expect(output).not.toContain("12th-next-field-2026-03-26");
    expect(output).not.toContain(
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(output).not.toContain("attack-possession");
    expect(output).toContain("개인 전술은 FC ONLINE 클라이언트 확인 전입니다.");
  });

  it("같은 추천을 항상 같은 문자열로 만들며 입력을 변경하지 않는다", () => {
    const recommendation = createRecommendation();
    const snapshot = structuredClone(recommendation);

    const first = formatTeamTacticForClipboard(recommendation);
    const second = formatTeamTacticForClipboard(recommendation);

    expect(second).toBe(first);
    expect(recommendation).toEqual(snapshot);
  });
});

function createRecommendation(): TacticRecommendation {
  return {
    metadata: {
      schemaVersion: "fc-online-12nf-2026-03-26",
      gamePatchVersion: "12th-next-field-2026-03-26",
      templateId: "attack-possession",
      templateVersion: "1.0.0",
      configHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      validation: {
        overall: "partial",
        teamTactics: "confirmed",
        formation: "unconfirmed",
        personalTactics: "unconfirmed",
      },
    },
    matchedRule: "내부-규칙",
    title: "공격 점유 압박",
    formation: "4-3-2-1",
    teamTactics: {
      schemaVersion: "fc-online-12nf-2026-03-26",
      teamMentality: "공격적",
      defensiveTactics: {
        defensiveStyle: "공 뺏긴 직후 압박",
        width: 6,
        depth: 7,
      },
      offensiveTactics: {
        buildUpPlay: "짧은 패스",
        chanceCreation: "밸런스",
        width: 8,
        playersInBox: 7,
        corners: 3,
        freeKicks: 2,
      },
    },
    playerInstructions: [
      {
        positions: ["ST"],
        roleDescription: "내부-역할-설명",
        uiSettings: [
          {
            group: "공격 지원",
            value: "내부-개인전술-후보",
            confirmed: false,
          },
        ],
        attackParticipation: { value: 3, confirmed: false },
        defenseParticipation: { value: 1, confirmed: false },
      },
    ],
    explanation: "테스트 추천 설명",
  };
}
