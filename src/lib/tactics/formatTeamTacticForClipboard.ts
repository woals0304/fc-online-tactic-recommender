import type { TacticRecommendation } from "../fconline/types";

/**
 * FC ONLINE 클라이언트에서 팀 전술을 옮겨 적기 쉬운 순서로 정리한다.
 * 검증 전인 개인 전술 후보와 내부 메타데이터는 의도적으로 제외한다.
 */
export function formatTeamTacticForClipboard(
  recommendation: TacticRecommendation,
): string {
  const { defensiveTactics, offensiveTactics, teamMentality } =
    recommendation.teamTactics;

  return [
    `[FC ONLINE 팀 전술] ${recommendation.title}`,
    `포메이션: ${recommendation.formation} (클라이언트 미확인)`,
    "",
    `팀 성향: ${teamMentality}`,
    "",
    "수비",
    `스타일: ${defensiveTactics.defensiveStyle}`,
    `폭: ${defensiveTactics.width}/10`,
    `깊이: ${defensiveTactics.depth}/10`,
    "",
    "공격",
    `빌드업: ${offensiveTactics.buildUpPlay}`,
    `기회 만들기: ${offensiveTactics.chanceCreation}`,
    `폭: ${offensiveTactics.width}/10`,
    `박스 안쪽 선수: ${offensiveTactics.playersInBox}/10`,
    `코너킥: ${offensiveTactics.corners}/5`,
    `프리킥: ${offensiveTactics.freeKicks}/5`,
    "",
    "※ 개인 전술은 FC ONLINE 클라이언트 확인 전입니다.",
  ].join("\n");
}
