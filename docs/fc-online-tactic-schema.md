# FC ONLINE 전술 스키마와 호환성 기준

> 마지막 확인: 2026-07-26
>
> 대상: PC 라이브 서버, 2026-03-26 반영 12th Next Field 기준
>
> 상태: 구현 계약과 검증 기준. 팀 전술 자동 검증은 구현됐고, 포메이션·개인 전술은 수동 확인 전이라 전체 상태는 `부분 검증`입니다.

## 1. 결론

추천 엔진의 팀 전술은 공식 열거형, `1~10`·`1~5` 범위와 12th Next Field의 `기회 만들기`를 포함하도록 재설계됐습니다. 타입과 런타임 검증기가 9개 템플릿 및 주전술·대안 쌍을 검사합니다.

포메이션 프리셋명과 개인 전술·참여도는 공식 전체 목록이 없어 `unconfirmed`로 유지합니다. 따라서 현재 결과는 **팀 전술 입력 계약은 통과하지만 전체 인게임 호환은 부분 검증**입니다. 이 문서는 구현 계약과 남은 수동 검증 경계를 함께 정의합니다.

## 2. 근거와 확정 수준

전술 스키마는 다음 공식 자료를 우선합니다.

1. [FC ONLINE 신규 전술 공식 가이드](https://fco.vod.nexoncdn.co.kr/list/2023/9/note_FCO_202307_sdkfjcv3423.html)
2. [New Tactic 업데이트 공식 소개](https://events.fconline.nexon.com/230727/update)
3. [2026년 12th Next Field 공식 변경 내용](https://fco.vod.nexoncdn.co.kr/list/2026/3/note_FCO_260326_v3hp6S2pq.html)

이 문서에서는 다음 용어를 사용합니다.

- **확정**: 공식 자료에 필드, 선택지 또는 숫자 범위가 직접 명시되어 있습니다.
- **부분 확정**: 필드나 일부 선택지는 확인됐지만 전체 목록이 공식 자료에 열거되지 않았습니다.
- **클라이언트 확인 필요**: 공식 문서만으로 정확한 현행 표기나 포지션별 제공 여부를 확정할 수 없습니다.

커뮤니티 글과 영상은 후보를 발견하는 참고 자료로만 사용할 수 있으며, 공식 입력 계약의 근거로 사용하지 않습니다.

## 3. 현행 팀 전술 스키마

| 프로젝트 필드 | 현행 UI 값 또는 범위 | 상태 | 비고 |
| --- | --- | --- | --- |
| `schemaVersion` | `fc-online-12nf-2026-03-26` | 프로젝트 필수 | 게임 패치별 의미 변경을 추적하기 위한 프로젝트 필드 |
| `formation` | 공식 문서에 전체 프리셋 목록이 없음 | 클라이언트 확인 필요 | 현재 7개 후보는 전체 전술 공간이 아닌 프로젝트의 부분집합 |
| `teamMentality` | `전원 수비`, `매우 수비적`, `수비적`, `보통`, `공격적`, `매우 공격적`, `전원 공격` | 확정 | 공식 New Tactic 소개 기준 |
| `defensiveStyle` | `후퇴`, `밸런스`, `볼 터치 실수 시 압박`, `공 뺏긴 직후 압박`, `지속적인 압박` | 확정 | 이 목록 외의 설명용 명칭을 설정값으로 사용하지 않음 |
| `defensiveWidth` | 정수 `1~10` | 확정 | 낮을수록 좁고 높을수록 넓음 |
| `defensiveDepth` | 정수 `1~10` | 확정 | 낮을수록 깊고 높을수록 높은 수비 라인 |
| `buildUpPlay` | `짧은 패스`, `밸런스`, `긴 패스`, `빠른 빌드업` | 확정 | 12th Next Field 현행 표기 기준 |
| `chanceCreation` | `짧은 패스`, `밸런스`, `긴 패스`, `빠른 빌드업` | 확정 | 12th Next Field에서 별도 필드로 추가 |
| `attackingWidth` | 정수 `1~10` | 확정 | 공격 시 측면 폭 |
| `playersInBox` | 정수 `1~10` | 확정 | 크로스 상황에서 박스 안으로 진입하는 선수 수 성향 |
| `corners` | 정수 `1~5` | 확정 | 세트피스 공격 가담 정도 |
| `freeKicks` | 정수 `1~5` | 확정 | 세트피스 공격 가담 정도 |

### 3.1 12th Next Field의 공격 전술 의미

12th Next Field부터 공격 전술은 하나의 선택값이 아니라 다음 두 단계로 분리됩니다.

- `buildUpPlay`: 수비 지역에서 적용됩니다.
- `chanceCreation`: 공격 지역에서 적용됩니다.
- 중원 지역: 현재 적용 중인 전술을 유지하다가 다음 전술 적용 영역에 진입할 때 전환합니다.

현재 코드는 `offensiveTactics.buildUpPlay`와 `chanceCreation`을 별도 필드로 저장하고 UI에서도 수비 지역·공격 지역 설정으로 나눠 표시합니다.

### 3.2 빠른 전술

공식 가이드에서 확인되는 빠른 전술은 다음과 같습니다.

| 구분 | 선택지 |
| --- | --- |
| 빠른 수비 전술 | `오프사이드 트랩`, `팀 압박`, `스트라이커 자기 진영 복귀`, `공 쪽으로 밀집` |
| 빠른 공격 전술 | `박스 안 침투`, `공격형 풀백`, `사이드라인 따라가기`, `스트라이커 추가` |

현재 추천 엔진은 빠른 전술을 출력하지 않습니다. 이는 입력 오류가 아니라 **현재 제품 범위에서 제외된 기능**입니다. 공식 자료는 빠른 전술을 F1~F8로 즉시 발동하는 명령으로 설명하므로, 지원할 때에는 저장형 팀 전술 필드로 단정하지 않고 `quickTacticAdvice` 같은 상황별 활성화 안내로 모델링합니다. 현행 클라이언트에서 별도로 저장할 수 있는지는 추가 확인합니다.

## 4. 개인 전술의 확정 경계

공식 문서에서 직접 확인되는 개인 전술의 일부는 다음과 같습니다. 공식 문서가 모든 기존 선택지를 포지션별로 열거하지 않으므로 이 표를 전체 목록으로 간주하지 않습니다.

| 적용 포지션·그룹 | 공식 확인 선택지 | 현재 구현 판단 |
| --- | --- | --- |
| RB/LB/RWB/LWB 지원 움직임 | `균형 잡힌 침투 지원`, `중앙 지원`, `오버랩` | `오버랩 자제`는 실제 선택지명이 아님 |
| CM/CDM 수비 위치 | `사이드 커버`, `센터 커버` | `센터 커버`는 일치 |
| CM/CDM 공격 지원 | `공격 시 후방 대기`, `수비수 사이에 위치`가 공식 설명에 등장 | 전체 그룹 선택지는 추가 확인 필요 |
| CAM 위치 선정 | `넓은 지역으로` | 현재 미사용 |
| LW/RW 기회 만들기 | `자유 역할` | 다른 포지션과 혼용하지 않음 |
| LW/RW 지원 움직임 | `타겟 스트라이커` | 현재 ST 설정값 위치의 `타겟맨`은 공식 두 문서에서 확인되지 않았으므로 별도 미확정 값으로 취급 |
| 개인 참여도 | 공격·수비 참여도 설정이 존재하며 팀 성향과 독립적으로 유지됨 | 숫자 범위는 현행 클라이언트에서 최종 확인 필요 |

구형 팀 수비 스타일 `전방 압박`은 현행 공식 선택지가 아니며 `공 뺏긴 직후 압박`과 같은 뜻이라고 추정해 변환하지 않습니다. 현재 런타임 검증기는 이 구형 값을 거부합니다.

다음 개인 전술 문자열은 공식 두 문서에서 실제 UI 선택지로 확인되지 않았습니다.

- `오버랩 자제`
- `패스 길 열기`
- `기본 위치 유지`
- `중앙 유지`
- `짧은 패스 지원`
- `박스 지원`
- `공격 위치`
- `타겟맨`

일부는 과거 또는 현행 게임에 실제 존재할 수 있지만, 확인 전까지는 `confirmed: false`로 취급합니다.

### 4.1 설명용 역할과 입력값 분리

`연계형 원톱`, `수비 보험`, `지원형 윙어` 같은 역할명은 추천 의도를 전달하는 프로젝트 문구이므로 유지할 수 있습니다. 다만 사용자가 인게임 메뉴에서 찾는 설정값처럼 표시하면 안 됩니다.

권장 구조는 다음과 같습니다.

```ts
type PlayerPosition =
  | "ST" | "LS" | "RS"
  | "LW" | "RW" | "LF" | "RF"
  | "LM" | "RM" | "LAM" | "RAM" | "CAM"
  | "LCM" | "CM" | "RCM" | "CDM" | "LDM" | "RDM"
  | "LWB" | "RWB" | "LB" | "RB"
  | "LCB" | "CB" | "RCB";

type PlayerInstruction = {
  positions: PlayerPosition[];
  roleDescription: string;
  uiSettings: Array<{
    group: string;
    value: string;
    confirmed: false;
  }>;
  attackParticipation: {
    value: number;
    confirmed: false;
  };
  defenseParticipation: {
    value: number;
    confirmed: false;
  };
};
```

`positions`는 `LM/RM`처럼 합쳐 쓰던 값을 `['LM', 'RM']`으로 정규화합니다. `CM 1`, `ST 2` 같은 임의 숫자 슬롯은 사용하지 않고 포메이션 문맥에 따라 `LCM/CM/RCM`, `LS/RS`, `LDM/RDM`처럼 명시해 수동 검증 대상을 추적합니다. 다만 그 슬롯 배치 자체는 PC 클라이언트 확인 전이므로 포메이션 상태를 계속 `unconfirmed`로 둡니다. 참여도 숫자 범위와 개인 메뉴값을 현행 클라이언트에서 확정하기 전에는 모든 `confirmed`를 `false`로 유지합니다. 범위를 확인한 뒤 `number`를 실제 값의 제한 유니언 타입으로 교체하고 런타임 검증에도 같은 범위를 사용합니다.

## 5. 구현 상태

현재 구현: [`src/lib/tactics/tacticRecommender.ts`](../src/lib/tactics/tacticRecommender.ts), [`src/lib/tactics/tacticSchema.ts`](../src/lib/tactics/tacticSchema.ts), [`src/lib/fconline/types.ts`](../src/lib/fconline/types.ts)

| 항목 | 상태 | 현재 구현 | 남은 조치 |
| --- | --- | --- | --- |
| 폭·깊이·박스·세트피스 범위 | 해결 | `Scale10`, `Scale5`와 런타임 정수 범위 검증 | PC 클라이언트에서 전술 의도별 체감 확인 |
| 수비 스타일 | 해결 | 공식 5개 선택지만 허용 | 패치 변경 시 재검증 |
| `buildUpPlay`·`chanceCreation` | 해결 | 별도 타입·저장·UI 표시 | 패치 변경 시 영역 의미 재검증 |
| 공격 전술 명칭 | 해결 | 현행 4개 선택지만 허용 | 패치 변경 시 재검증 |
| 버전·식별자 | 해결 | 스키마·패치·템플릿 ID/버전과 설정 SHA-256 저장 | 설정 변경 시 버전 갱신 |
| 포지션 식별자 | 해결 | 제한 `PlayerPosition`과 템플릿 내 중복 검증 | 포메이션별 실제 슬롯 배치 수동 확인 |
| 역할과 실제 설정 분리 | 해결 | `roleDescription`과 `uiSettings` 분리 | 없음 |
| 개인 전술·참여도 | 부분 | 모든 후보를 `confirmed: false`로 명시 | 포지션별 클라이언트 확인 후 카탈로그와 제한 타입 작성 |
| 포메이션 | 부분 | 7개 후보를 제한 타입으로 관리하되 `unconfirmed` | 현행 프리셋명과 슬롯 배치 수동 확인 |
| 빠른 전술 | 범위 제외 | 출력하지 않음 | 필요 시 상황별 `quickTacticAdvice`로 별도 설계 |

### 5.1 숫자 변환 주의

구형 코드의 `38~58` 값이 어떤 공식 스키마에서 유래했는지는 확인되지 않았고 공식 의미 보존 변환식도 없습니다. 현재 9개 템플릿은 그 숫자를 환산하지 않고 폐기한 뒤, 공식 `1~10` 범위 안에서 수비 안정·점유·역습 등 각 의도에 맞게 새로 설계했습니다. 남은 단계는 현행 클라이언트 체감 검증입니다.

## 6. 구현된 타입 계약

아래 코드는 현재 런타임 응답의 핵심 계약을 요약한 예시입니다. 정확한 단일 원천은 코드의 타입과 검증기입니다.

```ts
import type {
  FormationCandidate,
  PlayerInstruction,
  TacticTemplateId,
} from "../src/lib/fconline/types";

type Scale10 = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
type Scale5 = 1 | 2 | 3 | 4 | 5;

type TeamMentality =
  | "전원 수비"
  | "매우 수비적"
  | "수비적"
  | "보통"
  | "공격적"
  | "매우 공격적"
  | "전원 공격";

type DefensiveStyle =
  | "후퇴"
  | "밸런스"
  | "볼 터치 실수 시 압박"
  | "공 뺏긴 직후 압박"
  | "지속적인 압박";

type AttackingStyle =
  | "짧은 패스"
  | "밸런스"
  | "긴 패스"
  | "빠른 빌드업";

type TeamTactics = {
  schemaVersion: "fc-online-12nf-2026-03-26";
  teamMentality: TeamMentality;
  defensiveTactics: {
    defensiveStyle: DefensiveStyle;
    width: Scale10;
    depth: Scale10;
  };
  offensiveTactics: {
    buildUpPlay: AttackingStyle;
    chanceCreation: AttackingStyle;
    width: Scale10;
    playersInBox: Scale10;
    corners: Scale5;
    freeKicks: Scale5;
  };
};

type TacticCompatibility = {
  overall: "partial";
  teamTactics: "confirmed";
  formation: "unconfirmed";
  personalTactics: "unconfirmed";
};

type TacticRecommendation = {
  metadata: {
    schemaVersion: "fc-online-12nf-2026-03-26";
    gamePatchVersion: "12th-next-field-2026-03-26";
    templateId: TacticTemplateId;
    templateVersion: "1.0.0";
    configHash: `sha256:${string}`;
    validation: TacticCompatibility;
  };
  matchedRule: string;
  title: string;
  formation: FormationCandidate;
  teamTactics: TeamTactics;
  playerInstructions: PlayerInstruction[];
  explanation: string;
};
```

### 6.1 기존 응답 소비자 마이그레이션

이번 계약은 초기 MVP 응답에서 다음과 같이 변경됐습니다.

| 기존 필드 | 현재 필드 |
| --- | --- |
| `position: string` | `positions: PlayerPosition[]` |
| `role` | `roleDescription` |
| `personalTactics[].menu` | `uiSettings[].group` |
| `personalTactics[].value` | `uiSettings[].value`와 `confirmed` |
| `attackParticipation: number` | `attackParticipation: { value, confirmed }` |
| `defenseParticipation: number` | `defenseParticipation: { value, confirmed }` |
| 없음 | `teamTactics.offensiveTactics.chanceCreation` |
| 없음 | `metadata`, `metadata.configHash`와 `teamTactics.schemaVersion` |

API 소비자는 구형 필드와 새 필드를 섞지 말고 새 스키마 버전을 기준으로 한 번에 전환합니다. 서버 응답과 현재 웹 UI는 같은 공유 런타임 검증기를 사용합니다.

## 7. 구현 완료 조건

인게임 호환 완료를 선언하려면 다음 조건을 모두 만족해야 합니다.

현재 자동 타입·런타임·템플릿 테스트 조건은 충족했습니다. 아래 목록 중 포메이션과 개인 전술의 수동 입력 증거가 남아 있으므로 전체 상태는 계속 `부분 검증`입니다.

- 팀 전술의 모든 열거형이 공식 선택지에 포함됩니다.
- 모든 숫자가 정수이며 공식 범위 안에 있습니다.
- `buildUpPlay`와 `chanceCreation`을 별도로 저장하고 표시합니다.
- 개인 전술은 해당 포지션에서 실제 제공되는 메뉴와 값만 사용합니다.
- 역할 설명과 실제 입력값이 데이터 구조와 UI에서 구분됩니다.
- 모든 전술 템플릿에 고유 ID, 템플릿 버전, 게임 패치 버전과 설정 SHA-256이 있습니다.
- 타입 검사와 런타임 검증이 모두 존재합니다.
- 모든 템플릿에 대한 자동 테스트가 범위와 열거형을 검증합니다.
- 모든 고유 `formation × position × group × value` 조합과 `formation × position × attackParticipation × defenseParticipation` 조합을 현행 PC 클라이언트에서 확인한 수동 입력 기록이 있습니다. 같은 조합의 중복 템플릿만 대표 표본으로 줄일 수 있습니다.
- 모든 개인 전술 값과 공격·수비 참여도에 `confirmed: true` 근거와 입력 성공 기록이 있습니다.
- 공식 개인 전술 카탈로그가 불완전하거나 미확인 조합이 하나라도 남으면 상태를 `부분 검증`으로 표시하고 전체 인게임 호환 완료를 선언하지 않습니다.
- FC ONLINE 패치가 바뀌면 기존 검증 상태를 자동으로 신뢰하지 않습니다.

## 8. 현재 포메이션 후보의 위치

현재 코드는 다음 7개 후보를 사용합니다.

`4-2-2-2`, `4-3-2-1`, `4-3-3 홀딩`, `4-1-4-1`, `5-2-3`, `4-4-2`, `4-2-3-1`

이들은 추천 탐색 공간을 제한하기 위한 프로젝트 후보입니다. FC ONLINE에서 가능한 모든 포메이션 목록도 아니고, 각 명칭이 현행 프리셋에 그대로 표시된다는 공식 보증도 아닙니다. 구현 수정 시 현행 클라이언트 또는 공식 트렌드 센터에서 정확한 프리셋명과 포지션 배치를 대조합니다.

## 9. 변경 관리

전술 관련 코드나 문서를 변경할 때 다음을 함께 갱신합니다.

- 게임 패치 기준 날짜
- 전술 스키마 버전
- 전술 템플릿 버전
- 설정 해시 산출 계약
- 공식 근거 링크
- 자동 검증 결과
- 수동 인게임 검증 기록
- 기존 로그와 새 로그의 호환 여부

공식 문서와 실제 클라이언트가 다르면 실제 화면을 캡처해 차이를 기록하되, 개인 정보나 계정 식별 정보가 포함된 이미지는 공개 저장소에 올리지 않습니다.
