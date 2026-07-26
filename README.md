# FC ONLINE 전적 기반 전술 추천기

FC ONLINE 닉네임을 입력하면 NEXON Open API로 최근 공식 경기 데이터를 조회하고, 화면 표시용 데이터와 규칙 기반 추천 전술로 정리해 보여주는 Next.js MVP입니다.

이번 단계는 조회, 정규화, 성향 분석, 규칙 기반 전술 추천 흐름 검증용입니다. DB, 로그인, 랭커 분석, AI 모델 기반 추천은 포함하지 않았습니다.

## 기술 스택

- Next.js 16.2.12
- TypeScript 6.0.3
- App Router
- 기본 CSS
- NEXON Open API
- Vitest

## 실행 준비

1. Node.js 22.23.1과 npm 10.9.8을 준비합니다. 버전 관리 도구를 쓴다면 `.nvmrc`를 사용할 수 있습니다.

2. 잠금 파일 기준으로 의존성을 설치합니다.

```bash
npm ci
```

3. 환경변수 파일을 만듭니다.

```bash
cp .env.example .env.local
```

4. `.env.local`에 NEXON Open API 키를 입력합니다.

```env
NEXON_OPEN_API_KEY=발급받은_API_KEY
FC_ONLINE_DEFAULT_LIMIT=5
FC_ONLINE_TRUST_PROXY_HEADERS=false
```

NEXON Open API는 요청 헤더의 `x-nxopen-api-key` 값으로 API 키를 받습니다. 키는 브라우저로 보내지지 않고 서버 API 라우트에서만 사용합니다.

`FC_ONLINE_TRUST_PROXY_HEADERS`는 배포 프록시가 `x-forwarded-for`와 `x-real-ip`를 신뢰할 수 있게 덮어쓰는 환경에서만 `true`로 설정합니다. 로컬이나 직접 노출 서버에서는 기본값 `false`를 유지합니다.

## 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:3000`을 열고 FC ONLINE 닉네임을 입력하면 최근 공식 경기 결과가 표시됩니다.

## 프로덕션 실행과 배포

```bash
npm ci
npm run verify
npm start
```

`npm run verify`가 성공한 뒤 생성된 프로덕션 빌드를 `npm start`로 실행합니다. 배포 환경에는 `.env.local` 파일을 올리지 말고 호스팅 서비스의 비밀 환경변수로 `NEXON_OPEN_API_KEY`를 설정합니다. 배포 전에는 GitHub Actions의 CI가 통과했는지, 저장소 추적 파일에 API 키나 캡처 응답이 없는지 확인합니다.

## 실제 성공 케이스 검증 절차

1. `.env.local`에 실제 `NEXON_OPEN_API_KEY`를 넣습니다.
2. 개발 서버를 실행합니다.

```bash
npm run dev
```

3. 브라우저에서 `http://localhost:3000`을 열고 실제 FC ONLINE 닉네임을 입력합니다.
4. 결과 카드에 조회 유저, 승/무/패 요약, 최근 공식 경기 목록, 점수와 주요 지표가 표시되는지 확인합니다.
5. 서버 API만 직접 확인하려면 아래처럼 호출합니다.

```bash
curl "http://localhost:3000/api/search?nickname=닉네임"
curl "http://localhost:3000/api/search?nickname=닉네임&limit=5"
```

`limit`은 1~10 범위로 보정되며 생략하면 `FC_ONLINE_DEFAULT_LIMIT` 값을 사용합니다.

6. 실제 성공 응답을 fixture로 보관하려면 아래 명령을 실행합니다.

```bash
npm run capture:fixture -- "닉네임"
```

이 명령은 `src/lib/fconline/__fixtures__/captured/<캡처시각>`에 원본 응답을 새 폴더로 저장합니다. `FC_ONLINE_DEFAULT_LIMIT`도 앱과 동일하게 1~10 범위로 적용합니다. 캡처 폴더는 실제 닉네임과 경기 데이터가 들어갈 수 있으므로 Git 추적에서 제외했습니다.

## Fixture 구조

```text
src/lib/fconline/__fixtures__
├─ success
│  ├─ id.json
│  ├─ basic-user.json
│  ├─ match-ids.json
│  └─ match-details.json
└─ captured
   └─ <캡처시각>
      └─ 실제 API 키로 캡처한 로컬 검증용 JSON
```

- `success` 폴더는 단위 테스트에서 사용하는 개발용 성공 응답 예시입니다.
- `captured` 폴더는 실제 API 성공 응답을 저장하는 로컬 전용 공간입니다.
- 실제 응답을 테스트 fixture로 반영할 때는 개인정보나 민감한 닉네임을 제거하거나 익명화한 뒤 `success` 폴더의 JSON을 갱신합니다.

## 데이터 흐름

```text
닉네임 입력
→ /api/search 서버 라우트
→ FC ONLINE Open API 원본 응답
   1. /id
   2. /user/basic
   3. /user/match
   4. /match-detail
→ normalizeSearchResult
→ 화면 표시용 SearchResult
→ analyzePlayStyle
→ 플레이 성향 분석 결과
→ recommendTactic
→ 추천 전술 결과
→ 최근 경기 목록과 추천 카드 표시
```

원본 API 응답은 필드가 많고 경기 상세 구조가 깊습니다. 화면은 모든 원본 값을 직접 쓰지 않고 `normalize.ts`에서 `SearchResult` 형태로 정리된 값만 사용합니다. 플레이 성향 분석기는 raw API 응답이 아니라 정규화된 `matches`만 입력으로 받습니다. 전술 추천기는 경기 목록도 보지 않고 `PlayStyleAnalysis`만 입력으로 받습니다. 이 구조를 유지하면 원본 API, 정규화 계층, 분석 계층, 추천 계층 사이의 계약을 안정적으로 관리할 수 있습니다.

서버 라우트는 동일 닉네임·경기 수 요청을 진행 중에는 하나로 합치고, 완전한 성공 결과만 15초 동안 메모리에 캐시합니다. 외부 호출은 요청별 8초 제한 시간을 가지며, 경기 상세 일부가 실패한 경우 성공한 경기만으로 결과를 만들되 429·503·시간 초과가 발생하면 추가 상세 호출을 중단합니다.

## 성향 분석 기준

성향 분석은 `src/lib/analysis/playStyleAnalyzer.ts`에서 처리합니다. 각 결과는 `label`, `score`, `reason`을 포함합니다. 데이터가 충분할 때 `score`는 0점에서 100점 사이이며, 기준값에 가까울수록 높아집니다. 복합 성향에 필요한 지표가 하나라도 없으면 `score`는 `null`이고 화면에는 `정보 부족`으로 표시됩니다.

| label | 계산 기준 |
| --- | --- |
| 공격적 | 평균 슈팅 8회 이상, 평균 드리블 18회 이상에 가까울수록 높게 계산 |
| 수비 불안 | 평균 실점 2점 이상에 가까울수록 높고, 태클 성공률 55% 이하에 가까울수록 높게 계산 |
| 득점력 높음 | 평균 득점 2점 이상, 평균 유효 슈팅 5회 이상에 가까울수록 높게 계산 |
| 점유율 지향 | 평균 점유율 53% 이상에 가까울수록 높게 계산 |
| 슈팅 빈도 높음 | 평균 슈팅 8회 이상에 가까울수록 높게 계산 |

현재 기준값은 MVP 검증용 상수입니다. 실제 성공 응답 fixture가 쌓이면 기준값을 조정할 수 있습니다.

분석 응답의 `confidence`에는 `low | medium | high` 수준, 0~100 데이터 충족률, 사용자 안내 문구가 포함됩니다. 3경기 미만이거나 지표 충족률이 낮으면 추천 전술과 함께 낮은 신뢰도 안내가 표시됩니다.

## 추천 규칙 흐름

전술 추천은 `src/lib/tactics/tacticRecommender.ts`에서 처리합니다. 추천 엔진은 `PlayStyleAnalysis`만 입력으로 받고, 주전술 1개와 대안 전술 1개를 반환합니다.

```ts
{
  primary: {
    matchedRule: string;
    title: string;
    formation: string;
    teamTactics: {
      teamMentality: string;
      defensiveTactics: {
        defensiveStyle: string;
        width: number;
        depth: number;
      };
      offensiveTactics: {
        buildUpPlay: string;
        width: number;
        playersInBox: number;
        corners: number;
        freeKicks: number;
      };
    };
    playerInstructions: Array<{
      position: string;
      role: string;
      personalTactics: Array<{
        menu: string;
        value: string;
      }>;
      attackParticipation: 1 | 2 | 3;
      defenseParticipation: 1 | 2 | 3;
    }>;
    explanation: string;
  };
  alternative: 같은 구조;
}
```

규칙은 위에서부터 먼저 맞는 것을 주전술로 선택합니다. 수비 불안이 다른 성향과 함께 높으면 무조건 보정 규칙을 먼저 봅니다. 대안 전술은 주전술이 아닌 다음 일치 규칙을 먼저 사용하되, 주전술과 같은 포메이션이면 건너뜁니다. 이후 없으면 기본 밸런스 또는 안정 점유 대안을 반환합니다.

현재 추천 후보 포메이션은 `4-2-2-2`, `4-3-2-1`, `4-3-3 홀딩`, `4-1-4-1`, `5-2-3`, `4-4-2`, `4-2-3-1`입니다.

| 규칙 | 조건 | 추천 결과 |
| --- | --- | --- |
| 수비 보정 점유 | `수비 불안 >= 70` 그리고 `점유율 지향 >= 65` | `4-1-4-1`, 수비 깊이 43, 느린 빌드업, 점유율 |
| 수비 보정 역습 | `수비 불안 >= 70` 그리고 `공격적 >= 70` | `5-2-3`, 후퇴, 수비 깊이 38, 빠른 빌드업, 전방 침투 |
| 공격 점유 압박 | `공격적 >= 70` 그리고 `점유율 지향 >= 70` 그리고 `수비 불안 <= 69` | `4-3-2-1`, 전방 압박, 밸런스 빌드업, 박스 안쪽 선수 6 |
| 투톱 슈팅 강화 | `공격적 >= 70` 그리고 `슈팅 빈도 높음 >= 70` | `4-2-2-2`, 빠른 빌드업, 박스 안쪽 선수 7 |
| 점유 득점 유지 | `점유율 지향 >= 70` 그리고 `득점력 높음 >= 70` | `4-3-3 홀딩`, 느린 빌드업, 박스 안쪽 선수 5 |
| 점유 전개 유지 | `점유율 지향 >= 70` | `4-3-3 홀딩`, 느린 빌드업, 점유율, 3미드필더 구조 |
| 수비 안정 우선 | `수비 불안 >= 70` | `4-1-4-1`, 수비 깊이 40, 박스 안 선수 4, 풀백 후방 대기 |
| 기본 밸런스 | 위 조건에 해당하지 않음 | `4-4-2`, 보통 팀 성향, 밸런스 빌드업 |
| 안정 점유 대안 | 기본 밸런스가 주전술일 때의 대안 | `4-2-3-1`, 느린 빌드업, 후방 안정 |

추천 이유는 `explanation`에 자연어로 포함되어 화면 카드에 그대로 표시됩니다.

### 현재 인게임 전술 UI 기준 매핑표

공식 New Tactic 안내의 팀 전술 항목은 `수비 스타일`, `빌드업 플레이`, `팀 성향`을 중심으로 재구성되어 있고, 수비 라인/폭과 공격 시 측면 폭, 박스 안쪽 선수, 코너킥/프리킥 숫자를 조절합니다. 이 프로젝트의 출력 필드는 아래처럼 매핑합니다.

| 프로젝트 필드 | 화면 표시명 | 인게임에서 옮겨 적는 위치 |
| --- | --- | --- |
| `teamTactics.teamMentality` | 팀 성향 | 팀 전술의 팀 성향 |
| `teamTactics.defensiveTactics.defensiveStyle` | 수비 스타일 | 팀 전술 > 수비 스타일 |
| `teamTactics.defensiveTactics.width` | 수비 폭 | 팀 전술 > 수비 폭 |
| `teamTactics.defensiveTactics.depth` | 수비 깊이 | 팀 전술 > 수비 깊이 |
| `teamTactics.offensiveTactics.buildUpPlay` | 빌드업 플레이 | 팀 전술 > 빌드업 플레이 |
| `teamTactics.offensiveTactics.width` | 공격 폭 | 팀 전술 > 공격 폭 |
| `teamTactics.offensiveTactics.playersInBox` | 박스 안쪽 선수 | 팀 전술 > 박스 안쪽 선수 |
| `teamTactics.offensiveTactics.corners` | 코너킥 | 팀 전술 > 코너킥 |
| `teamTactics.offensiveTactics.freeKicks` | 프리킥 | 팀 전술 > 프리킥 |
| `playerInstructions[].personalTactics[].menu` | 개인 전술 메뉴 | 개인 전술에서 포지션별 선택 메뉴 |
| `playerInstructions[].personalTactics[].value` | 개인 전술 선택값 | 개인 전술 메뉴의 선택값 |
| `playerInstructions[].attackParticipation` | 공격 참여도 | 개인 전술 > 공격 참여도 |
| `playerInstructions[].defenseParticipation` | 수비 참여도 | 개인 전술 > 수비 참여도 |

참고 기준: [NEXON New Tactic 업데이트 안내](https://m.fconline.nexon.com/news/notice/view?n4articlesn=4279), [개편된 팀 전술 활용 기사](https://m.gamevu.co.kr/news/articleView.html?idxno=28102).

### 추천 결과 예시

공격적 성향과 점유율 지향이 함께 높은 경우 주전술은 아래처럼 내려옵니다.

```json
{
  "primary": {
    "matchedRule": "공격 점유 압박",
    "title": "공격 점유 압박",
    "formation": "4-3-2-1",
    "teamTactics": {
      "teamMentality": "공격적",
      "defensiveTactics": {
        "defensiveStyle": "전방 압박",
        "width": 50,
        "depth": 58
      },
      "offensiveTactics": {
        "buildUpPlay": "밸런스",
        "width": 48,
        "playersInBox": 6,
        "corners": 3,
        "freeKicks": 2
      }
    },
    "playerInstructions": [
      {
        "position": "ST",
        "role": "침투형 원톱",
        "personalTactics": [
          { "menu": "공격 지원", "value": "뒤에서 침투" },
          { "menu": "위치 선정", "value": "중앙에 위치" }
        ],
        "attackParticipation": 3,
        "defenseParticipation": 2
      }
    ],
    "explanation": "공격적 점수와 점유율 지향 점수가 높고 수비 불안은 위험선 아래라 4-3-2-1을 추천합니다."
  },
  "alternative": {
    "matchedRule": "투톱 슈팅 강화",
    "title": "투톱 슈팅 강화",
    "formation": "4-2-2-2"
  }
}
```

수비 불안과 공격적 성향이 함께 높은 경우에는 아래처럼 더 보수적인 역습 전술을 먼저 추천합니다.

```json
{
  "primary": {
    "matchedRule": "수비 보정 역습",
    "title": "수비 보정 역습",
    "formation": "5-2-3",
    "teamTactics": {
      "teamMentality": "수비적",
      "defensiveTactics": {
        "defensiveStyle": "후퇴",
        "width": 42,
        "depth": 38
      },
      "offensiveTactics": {
        "buildUpPlay": "빠른 빌드업",
        "width": 58,
        "playersInBox": 5,
        "corners": 2,
        "freeKicks": 2
      }
    },
    "explanation": "수비 불안과 공격적 성향이 함께 높아 5-2-3으로 뒷공간을 줄이고 전방 3명에게 빠르게 연결합니다."
  },
  "alternative": {
    "matchedRule": "투톱 슈팅 강화",
    "title": "투톱 슈팅 강화",
    "formation": "4-2-2-2"
  }
}
```

점유율 지향과 득점력이 함께 높은 경우에는 아래처럼 점유 구조를 유지하면서 직접 패스로 마무리를 살립니다.

```json
{
  "primary": {
    "matchedRule": "점유 득점 유지",
    "title": "점유 득점 유지",
    "formation": "4-3-3 홀딩",
    "teamTactics": {
      "teamMentality": "보통",
      "defensiveTactics": {
        "defensiveStyle": "밸런스",
        "width": 48,
        "depth": 52
      },
      "offensiveTactics": {
        "buildUpPlay": "느린 빌드업",
        "width": 56,
        "playersInBox": 5,
        "corners": 2,
        "freeKicks": 2
      }
    },
    "explanation": "점유율 지향과 득점력 높음 점수가 함께 높아 4-3-3 홀딩으로 공 소유와 마무리 루트를 유지합니다."
  },
  "alternative": {
    "matchedRule": "기본 밸런스",
    "title": "기본 밸런스",
    "formation": "4-4-2"
  }
}
```

실제 응답의 `playerInstructions`에는 포지션별 개인 전술이 여러 개 포함됩니다. 화면에서는 주전술과 대안 전술을 나란히 확인할 수 있습니다.

## 추천 품질 검증 체크리스트

실제 유저 테스트는 [docs/user-test-record-template.md](docs/user-test-record-template.md)를 기준으로 기록합니다. 한 명의 닉네임으로 최소 3경기 이상 플레이해 보고 아래 항목을 확인합니다.

- 닉네임 조회가 성공했고 최근 경기 수가 충분한가
- 감지된 성향 점수와 실제 플레이 스타일이 크게 어긋나지 않는가
- `matchedRule`이 성향 조합과 납득 가능하게 연결되는가
- 주전술과 대안 전술의 포메이션이 서로 다른가
- 주전술 포메이션을 실제 FC ONLINE 전술 화면에 무리 없이 옮겨 적을 수 있는가
- 팀 전술 수치가 너무 극단적이지 않은가
- 개인 전술과 공격/수비 참여도가 포메이션 역할과 맞는가
- 추천 설명이 성향 라벨과 직접 연결되어 있는가
- 실제 플레이에서 공격 전개, 수비 안정, 점유 유지 중 어떤 부분이 개선됐는가
- 수정할 규칙이 조건값 문제인지, 포메이션 문제인지, 세부 수치 문제인지 구분됐는가

## API 보호와 운영 경계

- 닉네임은 공백 제거 후 최대 30자로 검증합니다.
- 캐시와 진행 중 동일 요청을 확인한 뒤 실제 새 검색만 상류 API 호출량 `3 + limit`을 선예약하며, 프로세스 전체 예산은 분당 120 호출 단위입니다.
- 실제 상류 API 요청 시작은 프로세스 전체에서 초당 최대 8회 간격으로 직렬화하고, 대기열은 200개로 제한합니다. 대기 시간도 8초 제한에 포함하며 429 응답의 `Retry-After` 동안 다음 요청 시작을 늦춥니다.
- `FC_ONLINE_TRUST_PROXY_HEADERS=true`인 경우 검증된 클라이언트 IP별 분당 10회 제한도 적용합니다.
- 캐시, 진행 중 요청 병합, 요청 제한 상태는 프로세스 메모리에만 존재합니다. 여러 서버 인스턴스로 배포할 때는 Redis 같은 공유 저장소 기반 제한과 캐시로 교체해야 합니다.
- 프록시 헤더를 공격자가 직접 보낼 수 있는 환경에서는 `FC_ONLINE_TRUST_PROXY_HEADERS`를 켜면 안 됩니다.
- 외부 API 원문 오류와 서버 환경변수 이름은 공개 응답에 포함하지 않고 서버 로그에만 기록합니다.

## 에러 구분

`/api/search`는 실패 상황을 아래처럼 구분합니다.

| type | 상황 | 예시 메시지 |
| --- | --- | --- |
| `validation` | 닉네임이 비어 있음 | FC ONLINE 닉네임을 입력해 주세요. |
| `configuration` | API 키 설정 누락 | 서버 설정이 완료되지 않았습니다. |
| `external-api` | NEXON Open API 실패, 시간 초과 또는 호출 제한 | 잠시 뒤 다시 시도해 주세요. |
| `empty-result` | 최근 공식 경기 또는 상세 결과 없음 | 최근 공식 경기 기록을 찾지 못했습니다. |

화면은 서버에서 정규화한 사용자용 메시지만 표시하며, 비JSON 응답이나 기술 예외 문구는 일반 오류 안내로 대체합니다.

## 테스트

```bash
npm run verify
```

`verify`는 타입 검사, Vitest 전체 테스트, 프로덕션 빌드를 순서대로 실행합니다. 현재 테스트는 API 클라이언트의 시간 초과·비JSON·외부 오류 처리, 서버 라우트의 캐시·동시 요청 병합·부분 성공·요청 제한, 정규화 경계값, 분석 신뢰도, 추천 규칙을 함께 검증합니다. GitHub Actions도 push와 pull request마다 같은 명령을 실행합니다.

## 현재 구현 범위

- 닉네임 입력 화면
- `/api/search` 서버 API 라우트
- 닉네임 기준 `ouid` 조회
- 유저 기본 정보 조회
- 최근 공식 경기 ID 조회
- 경기 상세 조회
- 화면 표시용 응답 정규화
- 정규화된 경기 기반 플레이 성향 분석
- 성향 분석 결과 기반 규칙 전술 추천
- 분석 데이터 충족률과 신뢰도 표시
- 요청 취소와 응답 경쟁 방지를 포함한 로딩·에러 상태
- 외부 API 시간 초과와 부분 성공 처리
- 메모리 캐시, 진행 중 요청 병합, 상류 호출 예산·시작 간격·IP 요청 제한
- 성공 응답 fixture 구조
- API 클라이언트와 서버 라우트 단위 테스트
- 정규화 단위 테스트
- 성향 분석 단위 테스트
- 전술 추천 단위 테스트
- GitHub Actions 검증 워크플로

## 남은 TODO

- 실제 API 키로 성공 케이스 fixture 캡처
- 실제 응답 샘플을 익명화해 테스트 fixture 보강
- 여러 서버 인스턴스에서 공유하는 캐시와 요청 제한 저장소
- 페이지·접근성 브라우저 자동화 테스트
- 경기 유형 선택 기능
- 플레이 성향 분석 지표 확장
- 추천 규칙과 기준값 보정
