# 논문 적용 및 추천 효과 검증 로드맵

> 마지막 확인: 2026-07-26
>
> 목적: 축구 분석과 추천 시스템 연구를 FC ONLINE 전술 추천기에 적용할 수 있는 범위와 검증 조건을 정의합니다.

## 1. 핵심 판단

논문은 FC ONLINE에서 사용할 전술의 정답을 직접 제공하지 않습니다. 논문에서 적용할 수 있는 것은 다음 네 가지입니다.

1. 경기 데이터를 더 유용한 특징으로 바꾸는 방법
2. 플레이 성향을 데이터로 분류하는 방법
3. 여러 전술 후보 중 실제로 도움이 되는 전술을 평가하는 방법
4. 근거가 부족할 때 추천을 보류하고 설명하는 방법

현재 프로젝트는 **집계 지표 기반 성향 휴리스틱과 규칙 기반 전술 템플릿을 보여주는 MVP**입니다. 현재 근거만으로는 “이 전술이 승률을 높인다”거나 “사용자에게 최적인 전술이다”라고 주장할 수 없습니다.

논문을 적용하기 전에 모든 전술 후보가 자동 팀 전술 검증과 포메이션·개인 전술 수동 입력 검증을 모두 통과해야 합니다. 완료 조건은 [FC ONLINE 전술 스키마와 호환성 기준](fc-online-tactic-schema.md)을 따릅니다. 게임에 존재하지 않는 설정을 연구의 행동 후보로 사용하면 이후 분석도 의미가 없습니다.

## 2. 현재 데이터와 연구 가능 범위

현재 `NormalizedMatch`가 유지하는 주요 값은 다음과 같습니다.

- 경기 결과와 득점·실점
- 점유율
- 슈팅과 유효 슈팅
- 패스 성공률
- 태클 성공률
- 드리블 수
- 상대 닉네임과 경기 시각·유형

현재 정규화 계층: [`src/lib/fconline/normalize.ts`](../src/lib/fconline/normalize.ts)

| 데이터 수준 | 확보 상태 | 가능한 연구 | 불가능하거나 위험한 주장 |
| --- | --- | --- | --- |
| 경기 집계 지표 | 현재 사용 중 | 성향 요약, 규칙 기준선, 데이터 충분도 판단 | 특정 전술의 인과 효과 |
| 슈팅별 좌표·결과 | NEXON 원본 응답에서 확보 가능, 현재 정규화하지 않음 | FC ONLINE 전용 슛 지도와 xG | 실축 xG 계수의 무검증 이식 |
| 실제 사용 전술·적용 여부 | 현재 수집하지 않음 | 수집 후 적용 전술과 성과의 연관성 분석 | 별도 식별 설계 없이 실제 적용 전술의 인과 효과 주장 |
| 추천 확률과 후보 목록 | 후보 ID는 API 응답에 있으나 결정 로그로 저장하지 않음; 배정 확률은 생성하지 않음 | 수집 후 오프라인 정책 평가 | 결정론적 기존 로그로 보지 못한 전술 평가 |
| 시간순 패스·드리블 이벤트 | 현재 없음 | VAEP·xT 계열 행동 가치 | 현재 집계값만으로 행동 가치 계산 |
| 선수·공 추적 좌표 | 현재 없음 | SoccerMap·EPV·TacticAI 계열 | 현재 API 집계값만으로 위치 생성 모델 학습 |

NEXON은 매치 상세 응답의 `ShootDetailDTO`에 슛 `x`, `y` 좌표를 제공하고 좌표의 기본 범위를 `0~1`로 안내합니다. [NEXON 공식 좌표 안내](https://openapi.nexon.com/ko/support/notice/2430740/)

연구 로그도 NEXON Game Data의 보존 예외가 아닙니다. 원본·정규화 결과·파생 집계와 추천 로그에는 `pulled_at`과 최대 30일 이내의 `expires_at`을 두고 삭제·철회 요청에 함께 대응합니다. 세부 운영 기준은 [NEXON Open API 데이터 처리 기준](data-handling-policy.md)을 따릅니다.

## 3. 연구 질문

프로젝트가 답해야 할 질문을 단계별로 분리합니다.

| ID | 질문 | 필요한 근거 |
| --- | --- | --- |
| RQ1 | 현재 성향 라벨과 임계값이 실제 FC ONLINE 사용자 유형을 잘 구분하는가? | 다수 경기 벡터, 군집 안정성, 사용자 확인 |
| RQ2 | 사용자는 슈팅을 많이 하는가, 좋은 위치에서 하는가, 마무리를 잘하는가? | 슈팅별 위치·결과와 FC ONLINE 전용 xG |
| RQ3a | 특정 전술을 먼저 시험하도록 지정·강조하는 추천 정책이 이후 성과와 적용률을 개선하는가? | 유효한 후보, 알려진 확률의 무작위 배정, `assigned_tactic_id` 기준 ITT 분석 |
| RQ3b | 사용자가 실제 적용한 전술과 이후 성과는 어떤 관계가 있는가? | 실제 적용·변경 로그. 인과효과는 적용을 통제한 실험 또는 타당한 비순응 식별 설계가 별도로 필요 |
| RQ4 | 데이터가 부족할 때 어느 수준까지 추천해야 하는가? | 데이터 충족도·추천 보류율·후속 성과. 오판 위험은 추천 손실을 먼저 정의하고 검증한 뒤 사용 |
| RQ5 | 추천 이유가 이해되고 실제 사용 가치가 있는가? | 사용자 중심 평가와 행동 로그 |
| RQ6 | 위치·이벤트 단위 전술 생성까지 확장할 가치가 있는가? | 이벤트 또는 추적 데이터 수집 가능성 검증 |

## 4. 즉시 참고할 연구

### 4.1 슈팅량과 기회 품질 분리

**Gabriel Anzer, Pascal Bauer, “A Goal Scoring Probability Model for Shots Based on Synchronized Positional and Event Data in Football (Soccer),” 2021.** [논문](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2021.624475/full)

- 모든 슈팅의 가치가 같지 않으므로 위치와 상황으로 득점 확률을 추정합니다.
- 프로젝트에서는 `총 xG`, `xG/슛`, `득점-xG`를 사용해 슈팅 빈도와 기회 품질, 마무리를 분리할 수 있습니다.
- 논문의 실축 모델 계수는 FC ONLINE에 그대로 사용하지 않습니다. FC ONLINE 슈팅 데이터로 새 모델을 학습하고 보정합니다.
- 초기에는 거리·각도 기반 로지스틱 회귀를 기준선으로 두고, 데이터가 충분할 때 더 복잡한 모델과 비교합니다.

### 4.2 고정 임계값 대신 데이터 기반 플레이 스타일

**Yonghan Zhong et al., “Data-driven classification of playing styles and match outcome prediction in UEFA Champions League teams,” 2025/2026.** [논문](https://pmc.ncbi.nlm.nih.gov/articles/PMC12954490/)

- 미리 정한 단일 임계값 대신 표준화된 경기 지표의 잠재 표현과 군집으로 플레이 스타일을 찾습니다.
- 프로젝트에서는 현재 5개 성향을 즉시 제거하지 않고 기준선으로 유지합니다.
- 충분한 FC ONLINE 경기 벡터가 쌓이면 강건한 표준화, PCA와 K-means 같은 단순 기준선부터 시작해 기존 라벨과 비교합니다.
- 군집 수는 해석 편의로 고정하지 않고 안정성, 분리도, 반복 표본 결과와 사용자 해석 가능성을 함께 봅니다.

### 4.3 집계 지표 해석의 보조 근거

**Carlos Lago-Peñas, Joaquín Lago-Ballesteros, Ezequiel Rey, “Differences in performance indicators between winning and losing teams in the UEFA Champions League,” 2011.** [논문](https://doi.org/10.2478/v10078-011-0011-3)

- 슈팅, 유효 슈팅, 슈팅 효율, 패스, 점유율과 함께 상대 수준·경기 문맥이 중요함을 보여줍니다.
- 현재 `슈팅 수`만 강조하기보다 `유효 슈팅/슈팅`, `득점/슈팅`, 득실차를 함께 기록할 근거가 됩니다.
- 승리 중이라 플레이 방식이 바뀌는 역인과가 있으므로 상관된 지표를 최적 전술의 원인으로 표현하지 않습니다.

### 4.4 정보가 부족한 추천 보류

**Ran El-Yaniv, Yair Wiener, “On the Foundations of Noise-free Selective Classification,” 2010.** [논문](https://jmlr.org/papers/v11/el-yaniv10a.html)

- 정답 또는 손실이 정의된 분류 문제에서는 애매한 사례를 거절해 제공 범위를 줄이는 대신, 제공된 예측의 위험을 낮추는 `risk-coverage` 관점을 제공합니다.
- 결측 지표가 있거나 통계적 불확실성이 규칙 임계값을 가로지르면 단일 전술을 확정하지 않고 후보 또는 정보 부족 상태를 보여주는 설계에 참고할 수 있습니다.
- 다만 현재 프로젝트에는 전술 추천의 정답·손실 함수가 검증되어 있지 않으므로, 이 논문의 이론적 위험 보장이나 `추천 오판률`을 아직 계산할 수 없습니다.

현재 코드의 `confidence.coverage`는 추천이 맞을 확률이 아니라 **데이터 충족도**입니다. UI와 문서에서 이를 추천 정확도나 보정된 확률처럼 표현하지 않습니다. 손실을 정의하고 실험으로 검증하기 전에는 `데이터 충족도`, `추천 보류율`, `후속 관찰 성과`를 서로 분리해 보고합니다.

### 4.5 사용자 중심 추천 평가

**Pearl Pu, Li Chen, Rong Hu, “A User-Centric Evaluation Framework for Recommender Systems,” 2011.** [논문](https://infoscience.epfl.ch/entities/publication/28198d5e-524a-4565-8165-9792d52a8e58)

- 경기 결과뿐 아니라 추천의 유용성, 이해도, 신뢰, 만족, 재사용 의도를 평가합니다.
- 사용자는 추천을 이해했지만 적용하지 않을 수도 있고, 적용했지만 도움이 없었다고 느낄 수도 있습니다. 각 사건을 분리해서 기록합니다.
- [실사용 테스트 기록 양식](user-test-record-template.md)에 객관 지표와 7점 척도 평가를 함께 둡니다.

## 5. 전술 추천 효과를 검증할 연구

### 5.1 전술 최적화의 개념적 구조

**Ryan Beal et al., “Optimising Game Tactics for Football,” AAMAS 2020.** [공식 원문](https://ifaamas.org/Proceedings/aamas2020/pdfs/p141.pdf)

- 팀 스타일, 포메이션, 상대 전술과 팀 강도를 문맥으로 두고 승·무·패 payoff를 비교합니다.
- 프로젝트에서는 성향 점수를 상태, 검증된 FC ONLINE 전술 템플릿을 행동, 이후 성과를 보상으로 표현할 수 있습니다.
- 논문이 보고한 모델상 개선치를 FC ONLINE의 인과적 승률 향상으로 인용하지 않습니다.

### 5.2 추천을 처치로 다루기

**Tobias Schnabel et al., “Recommendations as Treatments: Debiasing Learning and Evaluation,” ICML 2016.** [논문](https://proceedings.mlr.press/v48/schnabel16.html)

- 추천 노출과 사용자의 자발적 선택 때문에 생기는 선택 편향을 다룹니다.
- `보여줌`, `선택함`, `실제로 적용함`, `다른 전술로 변경함`, `후기를 제출함`을 각각 기록합니다.
- 자발적으로 후기를 남긴 사용자만으로 전체 만족도를 추정하지 않습니다.

### 5.3 무작위 로그 재생과 오프라인 평가

**Lihong Li et al., “Unbiased Offline Evaluation of Contextual-bandit-based News Article Recommendation Algorithms,” WSDM 2011.** [논문](https://doi.org/10.1145/1935826.1935878)

- 문맥별 후보군에서 알려진 확률로 무작위 수집한 `(문맥, 배정 행동, 보상)` 로그로 새 정책을 평가합니다.
- 균등 무작위 파일럿의 단순 일치-event 평가는 rejection replay를 사용할 수 있습니다. 비균등 또는 적응형 수집 정책에서는 단순 replay가 아니라 기록된 확률을 쓰는 IPS/DR 계열 평가가 필요합니다.
- 목표 정책이 선택할 모든 후보는 같은 문맥의 수집 후보군에서 양의 확률을 가져야 합니다. 이 support 조건을 평가할 정책마다 확인합니다.
- 추천 순간의 `assignment_probability`는 **배정된 전술**의 확률로 저장하며, 사용자가 실제로 적용한 전술의 성향점수로 재해석하지 않습니다.

### 5.4 Doubly robust 정책 평가

**Miroslav Dudík, John Langford, Lihong Li, “Doubly Robust Policy Evaluation and Learning,” ICML 2011.** [공식 원문](https://icml.cc/2011/papers/554_icmlpaper.pdf)

- 보상 예측 모델과 역성향 가중치를 결합해 새 정책의 가치를 평가합니다.
- 데이터가 쌓인 뒤 현재 규칙과 새 임계값 후보를 실제 배포 전에 비교하는 주 평가법 후보입니다.
- 평균값뿐 아니라 불확실성, 행동별 데이터 중첩, 유효 표본 크기를 함께 보고합니다.

### 5.5 개인화는 마지막 단계

**Lihong Li et al., “A Contextual-Bandit Approach to Personalized News Article Recommendation,” WWW 2010.** [논문](https://doi.org/10.1145/1772690.1772758)

- 사용자 문맥에 따라 탐색과 활용을 조정하는 개인화 구조를 제공합니다.
- 처음부터 팀 전술의 모든 숫자 조합을 행동으로 만들지 않습니다.
- 기존 규칙이 선별하고 PC 클라이언트 수동 입력까지 검증한 2~3개 전술 템플릿 안에서만 개인화를 시작합니다.

## 6. 이벤트·추적 데이터 단계의 연구

| 논문 | 필요한 데이터 | 프로젝트에서의 위치 |
| --- | --- | --- |
| [Actions Speak Louder Than Goals: VAEP](https://doi.org/10.1145/3292500.3330758), Decroos et al., 2019 | 시간순 행동 종류, 성공 여부, 위치, 소유권 | 패스·드리블·슛의 득점 및 실점 확률 변화 평가 |
| [A public data set of spatio-temporal match events](https://www.nature.com/articles/s41597-019-0247-7), Pappalardo et al., 2019 | 공개 실축 이벤트 | 파이프라인 재현용. FC ONLINE 모델 계수로 사용하지 않음 |
| [SoccerMap](https://arxiv.org/abs/2010.10202), Fernández & Bornn, 2020 | 선수·공 위치 추적 | 패스 성공·선택·가치 표면 시각화 |
| [TacticAI](https://www.nature.com/articles/s41467-024-45965-x), Wang et al., 2024 | 고주파 추적과 코너킥 이벤트 | 예측→유사 상황 검색→후보 생성→사람 선택이라는 장기 제품 흐름 |
| [축구 게임 데이터 기반 전술 예측 및 자동 해설 인공지능 모델](https://www.dbpia.co.kr/journal/articleDetail?nodeId=NODE12582100), 홍성하·김종현, 2026 | FC ONLINE 미니맵 영상과 좌표 | 향후 좌표 수집 방식 참고. 짧은 초기 학술대회 논문이므로 강한 효과 근거로 사용하지 않음 |

현재 집계 데이터만으로 이 단계의 모델을 구현하지 않습니다. 공개 실축 데이터는 코드와 평가 파이프라인을 연습하는 용도로만 사용하며, 게임 물리와 패치 메타가 다른 FC ONLINE에 수치를 그대로 전이하지 않습니다.

## 7. 최소 추천 결정 로그

추천 1회마다 최소한 다음 정보를 기록해야 합니다.

```text
decision_id
pseudonymous_user_id
timestamp
pulled_at
expires_at
consent_status
deletion_status

game_patch_version
tactic_schema_version
context_schema_version
recommendation_rule_version
reward_definition_version

style_scores
missing_value_mask
data_sufficiency_level
data_coverage
pseudonymous_pre_match_refs
pre_window_metrics

candidate_tactic_ids
assigned_tactic_id
assignment_probability
logging_policy_id
logging_policy_version
randomization_unit_id
experiment_block_id
washout_rule_version
tactic_config_hash

shown
accepted
actually_applied_tactic_id
application_status
overridden_tactic_id

post_match_outcomes[]
  pseudonymous_match_ref
  sequence_index
  assigned_tactic_id
  actually_applied_tactic_id
  applied_config_hash
  application_status
  change_timestamp
  outcome
  outcome_metrics
  exclusion_reason
post_window_metrics
subjective_feedback
outcome_observed
outcome_observation_deadline
followup_collection_method
outcome_missing_reason
```

### 로그 불변 조건

- `assignment_probability`는 사후 추정하지 않고 추천 순간에 **지정된 후보**의 실제 확률을 저장합니다. `actually_applied_tactic_id` 전술의 확률로 바꾸어 쓰지 않습니다.
- 추천 이후 경기 정보를 추천 문맥에 넣지 않습니다.
- 여러 추천 결정의 결과 경기 구간이 겹치지 않도록 관리합니다.
- `post_match_outcomes`에서 각 경기의 배정 행동, 실제 적용 설정, 중간 변경과 제외 사유를 연결합니다. 결정 단위 집계만 남기지 않습니다.
- 전술의 표시명 대신 변경되지 않는 템플릿 ID와 설정 해시를 사용합니다.
- 패치가 다른 경기 구간을 같은 효과 표본처럼 합치지 않습니다.
- 결과 관측 마감시각과 누락 사유를 기록하고, 가능하면 사용자 재방문·후기 제출과 독립적으로 후속 경기를 수집합니다.
- 결과가 선택적으로 누락되고 이를 보정할 설계가 없다면 분석 대상을 `결과가 관측된 하위집단`으로 명시합니다. IPS/DR은 보상 누락 편향을 자동으로 해결하지 않습니다.
- 무작위화 단위, 실험 블록, 전술 잔류효과를 줄일 washout 규칙을 실험 전에 고정합니다.
- 닉네임과 OUID 원문 대신 동의받은 가명 식별자를 사용합니다.
- 공개 저장소에는 원본 경기 응답과 개인 식별 로그를 올리지 않습니다.
- `pulled_at`, `expires_at`, 동의와 삭제 상태를 모든 API 원천·파생 레코드에 전파하고, 최대 30일 TTL 만료 시 분석 대상에서도 제거합니다. 삭제 완료 후에는 연결 가능한 상태 레코드도 남기지 않습니다.

## 8. 실험 설계

### 8.1 MVP 검증

- 자동 팀 전술 검증과 포메이션·개인 전술 수동 입력 검증까지 완료한 주전술과 대안만 실험 후보로 사용합니다.
- 한 번의 수동 테스트는 UI 이식 가능성과 설명 이해도를 확인하는 스모크 테스트입니다.
- 몇 경기의 전후 차이를 추천 효과로 일반화하지 않습니다.

### 8.2 초기 비교 실험

- 안전한 두 후보 중 `먼저 시험할 전술`을 무작위 지정합니다.
- 두 전술을 모두 보여주고 사용자가 자유롭게 바꿀 수 있다면 무작위화된 처치는 `실제 사용 전술`이 아니라 **먼저 지정·강조된 전술**입니다. 어느 후보를 지정했는지와 그 확률을 저장합니다.
- 주 분석은 미적용·변경 사례를 포함해 `assigned_tactic_id` 기준으로 비교하는 ITT(intention-to-treat) 분석으로 정합니다.
- 사용자가 지정 전술을 적용하지 않거나 다른 전술로 바꾼 경우도 제외하지 않고 `actually_applied_tactic_id`, `application_status`와 변경 사건을 별도로 기록합니다.
- 실제 적용 전술의 효과는 적용을 통제한 실험이나 타당한 도구변수 설계가 없으면 인과효과가 아닌 연관성으로만 표현합니다.
- 추천 전후의 동일한 길이 경기 구간을 사용하고 게임 모드, 상대 수준, 패치, 적용 순서를 기록합니다.
- 주 평가지표 하나와 보조·안전 지표를 실험 전에 정합니다.
- 무작위화 단위와 블록, 전술 간 washout 구간을 사전 등록해 반복 측정과 잔류효과를 통제합니다.

### 8.3 데이터 축적 후

1. 행동별 데이터 중첩, 정책별 support, 유효 표본 크기를 확인합니다.
2. 균등 무작위 로그에는 rejection replay를, 비균등·적응형 로그에는 기록 확률을 사용하는 IPS/DR을 적용합니다.
3. 임계값과 후보 정책을 탐색하는 데이터와 최종 평가 데이터를 분리합니다. 별도 holdout이 작으면 사용자 또는 시간 단위 교차적합을 사용합니다.
4. 같은 사용자의 반복 결정은 독립 표본으로 세지 않고 사용자 단위로 불확실성을 군집화합니다.
5. 보상 모델을 추가해 doubly robust 정책 가치와 불확실성을 산출합니다.
6. 정책을 고정한 뒤 보지 않은 최종 평가에서 기준 규칙보다 나은 결과와 수비·실점 안전 조건을 모두 충족한 후보만 제한적으로 배포합니다.
7. 충분한 반복 상호작용이 확보된 뒤에만 문맥 기반 개인화를 도입합니다.

## 9. 평가 지표

| 대상 | 주 지표 | 보조 지표 |
| --- | --- | --- |
| 데이터 충분도 | 유효 경기 수, 지표 coverage, 결측 패턴 | 요청 경기 수 대비 실제 분석 경기 수 |
| 성향 분류 | 군집 안정성, 재표본 일관성, 사용자 해석 동의 | silhouette 등 내부 분리 지표 |
| xG | Brier score, log loss, calibration | ROC-AUC, 구간별 표본 수 |
| 추천 정책 | 사전 정의한 정책 가치와 불확실성 | 경기당 승점, 득실차, 실점, 슈팅 품질 |
| 선택적 추천 | 데이터 충족도, 추천 보류율, 후속 관찰 성과 | 보류 사유 분포. 검증된 손실이 생긴 뒤에만 선택 위험 추가 |
| 사용자 경험 | 유용성, 이해도, 신뢰, 적용 의도, 재사용 의도 | 자유 서술 피드백 |

정확도 하나만 보고하지 않습니다. 특히 확률 예측은 분류 정확도보다 calibration과 확률 손실을 함께 봅니다.

## 10. 허용하는 표현과 금지하는 표현

### 현재 MVP에서 허용

- “최근 경기 집계 지표가 이 규칙 조건과 일치합니다.”
- “현재 데이터 충족도는 높음/중간/낮음입니다.”
- “공식 팀 전술 입력 계약은 통과했고 포메이션·개인 전술은 미확인입니다.”
- “사용자가 추천을 유용하다고 평가했습니다.”

### 관찰·정책 평가 로그 단계에서 허용

- “추천 적용 후 구간에서 이전 구간보다 높은 지표가 관찰됐습니다.”
- “이 전술 사용과 높은 성과 사이의 연관성이 관찰됐습니다.”
- “사전 정의한 정책, support·누락 가정과 별도 평가 데이터 아래의 DR 추정 정책 가치와 불확실성 범위는 다음과 같습니다.”

### 타당한 실험 없이 금지

- “추천 때문에 승률이 올랐습니다.”
- “이 전술이 사용자에게 최적입니다.”
- “적용 전후 차이가 추천 효과입니다.”
- “추천 정확도 90%”처럼 정확도의 정의와 검증 집단이 없는 표현
- 후기를 남긴 사용자의 만족도를 전체 사용자의 만족도로 일반화하는 표현

## 11. 단계별 적용 순서

### 단계 A — 인게임 호환성

- [x] 현행 팀 전술 스키마 타입과 런타임 검증기 구현
- [x] 모든 기존 템플릿의 숫자와 명칭을 공식 범위 안에서 의미 기준으로 재설계
- [x] `chanceCreation`, 패치 버전, 템플릿 ID·설정 해시와 검증 상태 추가
- [ ] 7개 포메이션 프리셋명과 개인 전술·참여도를 PC 클라이언트에서 수동 이식 검증

### 단계 B — 데이터 품질과 설명

- `confidence`를 데이터 충분도로 명확히 구분
- 결측·임계값 불확실 시 추천 보류
- 사용자 중심 테스트 문항과 결정 로그 도입
- 슈팅 좌표 수집의 가명 처리, 30일 TTL과 삭제 경계 확정

### 단계 C — 특징과 성향 개선

- FC ONLINE 전용 xG 기준선
- 슈팅량·기회 품질·마무리 지표 분리
- 기존 5개 성향 규칙과 데이터 기반 군집 비교

### 단계 D — 추천 효과 검증

- 안전 후보 안에서 무작위 지정 실험과 `assigned_tactic_id` 기준 ITT 분석
- 수집 정책에 맞는 replay·IPS·doubly robust 평가와 별도 최종 평가 데이터
- 사용자 단위 불확실성 군집화와 전술 간 washout 규칙
- 패치·상대 수준·게임 모드별 안정성 확인

### 단계 E — 개인화와 장기 연구

- 안전 후보군 안에서 문맥 기반 개인화
- 이벤트 데이터가 확보되면 VAEP·xT 계열 검토
- 추적 데이터 확보 가능성이 입증된 뒤 SoccerMap·TacticAI 계열 검토

단계 A의 자동 검증은 구현됐고 수동 이식 검증이 남았습니다. 새 모델을 추가하는 것보다 이 수동 검증과 단계 B를 먼저 완료하는 것이 우선입니다. 입력할 수 없는 전술이나 효과를 식별할 수 없는 로그 위에서 복잡한 모델을 학습해도 제품 신뢰도는 높아지지 않습니다.
