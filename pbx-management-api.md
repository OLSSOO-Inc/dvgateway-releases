# DVGateway PBX 관리 API 가이드

> DVGateway REST API를 통해 Dynamic VoIP PBX의 착신전환, 발신자표시, 통화기록, API 키, 응답 전 안내음, 클릭투콜, 아웃바운드 캠페인을 관리합니다.

---

## 목차

1. [인증](#1-인증) · [모바일 Firebase 인증](#11-모바일-앱-firebase-id-토큰-인증-v14844) · [온프레미스 accessToken](#12-온프레미스firebase-없는-모바일-인증--apiaccesstoken-v141140)
2. [착신전환 (Diversions)](#2-착신전환-diversions)
   - [폰북 (Phonebook)](#폰북-phonebook)
3. [발신자표시 (Caller ID)](#3-발신자표시-caller-id)
   - [통화기록 (CDR)](#통화기록-cdr)
4. [API 키 관리 (App Keys)](#4-api-키-관리-app-keys)
5. [Early Media (응답 전 안내음)](#5-early-media-응답-전-안내음)
6. [PBX API 연동 (설정 재적용 · 클릭투콜)](#6-pbx-api-연동)
7. [아웃바운드 캠페인 (예약/동보/주기 발신)](#7-아웃바운드-캠페인)
8. [에러 응답 레퍼런스](#8-에러-응답-레퍼런스)

---

## 1. 인증

서버/관리 용도는 게이트웨이 `dvgw_` API 키로 JWT 토큰을 발급해 사용합니다.

```bash
# API Key로 JWT 토큰 발급
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/token \
  -H "X-API-Key: dvgw_your-api-key" | jq -r '.token')

# 이후 모든 요청에 토큰 사용
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/...
```

**접근 권한:**

| API | 테넌트 | Admin |
|-----|:------:|:-----:|
| 착신전환 | ✅ (자기 테넌트만) | ✅ (?tenantId= 지정) |
| 발신자표시 | ✅ | ✅ |
| 통화기록 | ✅ | ✅ |
| API 키 | - | ✅ (Admin만) |
| 아웃바운드 캠페인 | - | ✅ (Admin만) |

### 1.1 모바일 앱: Firebase ID 토큰 인증 (v1.4.8.44+)

`dvgw_` 키는 게이트웨이 **전역 권한**(모든 테넌트 조회/제어)이라 모바일 앱에 임베드할 수
없습니다(유출 시 전 테넌트 위험). 대신 아래 모바일 엔드포인트는 소프트폰 프로비저닝
(`/api/v1/softphone/*`)과 **동일한 Firebase ID 토큰**을 추가로 수용합니다.

| 엔드포인트 | Firebase 토큰 | dvgw 키→JWT |
|------------|:-------------:|:-----------:|
| `GET/PUT/DELETE /api/v1/diversions/{ext}[/{type}]` | ✅ (v1.4.8.44+) | ✅ (병행) |
| `GET /api/v1/phonebook` | ✅ (v1.4.8.44+) | ✅ (병행) |
| `GET /api/v1/callerid/{ext}` (조회 전용) | ✅ (v1.4.8.47+) | ✅ (병행, GET+PUT) |
| `GET /api/v1/pbx/cdr` (통화기록) | ✅ (v1.4.8.52+, 본인 통화만) | ✅ (병행, 테넌트 전체) |
| `POST /api/v1/pbx/click-to-call` | ✅ (v1.4.8.53+, caller=본인 내선) | ✅ (병행) |
| `POST /api/v1/pbx/click-to-call/cancel` | ✅ (v1.4.14.134+, caller=본인 내선) | ✅ (병행) |

```bash
# Firebase ID 토큰만으로 호출 (dvgw 키 불필요)
curl -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  http://localhost:8080/api/v1/diversions/1010
```

**동작 / 권한 모델:**

- 게이트웨이는 토큰을 검증한 뒤 토큰의 `email` → **활성 모바일 seat** 으로
  `tenantId` 와 배정 `extension` 을 **서버가 해석**합니다(요청 본문/쿼리의
  테넌트·extension 을 신뢰하지 않음).
- **소유 검증**: 토큰 사용자의 seat 에 **배정된 extension** 에만 접근 가능.
- **멀티 테넌트(gateway 1.4.8.45+)**: 동일 이메일이 여러 테넌트(팀)에 소속된 경우, 어느 팀으로
  해석할지 **`?tenantId=<path>`** 쿼리(또는 `X-Tenant-ID` 헤더)로 선택합니다. 선택값은 토큰
  사용자 **본인 seat 범위 안에서만** 유효(타 테넌트 지정 시 401). 단일 테넌트면 생략 가능.
  후보 목록은 `GET /api/v1/softphone/seats` 로 받습니다.
  ```bash
  curl -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
    "http://localhost:8080/api/v1/diversions/1010?tenantId=0123456789abcdef"
  ```
- 이 인증 방식은 게이트웨이 운영사(관리자)가 Firebase 인증을 켜야 합니다. 운영사에 요청하세요.
  켜지지 않은 게이트웨이에서는 `dvgw_`→JWT 방식만 동작합니다.

| 상황 | HTTP |
|------|:----:|
| 정상 | `200` |
| 토큰 무효/만료, 해당 email 의 활성 seat 없음, 멀티 테넌트인데 `tenantId` 미지정/비소유(모호) | `401` |
| 타 extension 요청(비소유) / seat 에 extension 미배정 | `403` |

> Firebase 토큰은 위 표의 **모바일 엔드포인트에만** 적용됩니다(다른 관리 API 로 번지지 않음).

### 1.2 온프레미스(Firebase 없는) 모바일 인증 — `api.accessToken` (v1.4.11.40+)

Firebase 를 쓰지 않는 **온프레미스 배포**를 위해, `POST /api/v1/softphone/provision`
(enrollToken/QR 경로)과 `POST /api/v1/softphone/refresh` 응답에
**REST 데이터 평면용 단기 게이트웨이 토큰**(`api.accessToken`)이 포함됩니다.
앱은 이 토큰 하나로 1.1 의 **모든 모바일 데이터 엔드포인트**(착신전환·폰북·발신표시·CDR·
클릭투콜)를 **Firebase 없이** 호출합니다.

```jsonc
// provision / refresh 200 응답 (api 블록)
{
  "extension": "1001",
  "tenantId": "0123456789abcdef",
  "sip": { "wssUri": "...", "authUser": "...", "authToken": "...", "expiresAt": "..." },
  "ice": [ /* ... */ ],
  "api": {                                 // ★ v1.4.11.40+
    "accessToken": "<token>",              //   (tenantId, extension) 스코프 — 앱은 불투명 값으로 취급
    "expiresAt": "2026-06-19T13:00:00Z"    //   RFC3339, 기본 수명 1h
  },
  "refresh": { "url": "...", "refreshToken": "rt_...", "minTtlSeconds": 300 }
}
```

```bash
# provision 으로 받은 accessToken 으로 호출 (Firebase 토큰 불필요)
TOKEN="<api.accessToken>"
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/diversions/1001   # 200
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/phonebook          # 200
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/v1/callerid/1001      # 200
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8080/api/v1/pbx/cdr?search=...&search_fields=dst"  # 200
```

**규약 / 동작:**

- `accessToken` 은 **(tenantId, extension) 단일 seat 에 스코프**된 토큰입니다. 앱은 내용을
  해석하지 말고 그대로 `Authorization: Bearer` 로 보냅니다. Firebase ID 토큰과 **동일한
  권한·소유검증·경로 스코프**로 처리되므로, 1.1 의 권한 모델(본인 extension 만, CDR 본인
  통화만, 클릭투콜 caller=본인, 발신표시 읽기전용)이 그대로 적용됩니다.
- **경로 스코프**: 이 토큰은 1.1 표의 **모바일 엔드포인트에서만** 유효합니다.
  그 외 경로(`/api/v1/sessions`, `/api/v1/tts/*`, `apply-changes` 등)에서는 **`401`** 입니다.
- **회전**: `POST /api/v1/softphone/refresh`(기존 `refreshToken`)가 `sip` 과 함께
  `api.accessToken` 도 **새로 발급**합니다. 앱은 refresh 하나로 SIP·REST 토큰을 모두
  갱신합니다. 즉시 회수가 불가한 토큰이라 수명이 짧습니다(기본 1h) — `expiresAt` 전에 refresh 하세요.
- **멀티 테넌트**: 토큰이 이미 특정 테넌트에 고정되므로 `?tenantId=` 는 동일 값일
  때만 통과하고 다른 값이면 `403`(cross-tenant). 테넌트별로 각자의 enroll → 각자의
  accessToken 을 받습니다.
- **활성화 조건**: 별도 설정 없이 발급되며 Firebase 설정과 무관합니다. 게이트웨이 인증이
  꺼진 배포에서는 `api` 블록이 생략됩니다.
- 내선 미배정(push-only) 응답에도 테넌트 스코프 토큰(extension 없음)을 발급합니다 — 본인검증
  엔드포인트는 extension 이 없으면 `403`, 테넌트 디렉토리(폰북) 조회는 가능합니다.

| 상황 | HTTP |
|------|:----:|
| 정상(모바일 경로) | `200` |
| accessToken 무효/만료 | `401` |
| 모바일 경로 밖에서 사용 | `401` (테넌트 전역 권한으로 승격되지 않음) |
| 타 extension/테넌트 요청 | `403` |

---

## 2. 착신전환 (Diversions)

Dynamic VoIP PBX의 착신전환(Call Forward)·**방해금지(DND)**·**개인비서(Personal Assistant)**
설정을 관리합니다.

### 착신전환 / 부가서비스 타입

| 약어 | 전체 명칭 | 한글명 | 설명 | 적용 조건 | destination |
|:----:|:----------|:------:|:-----|:----------|:-----------:|
| **CFI** | CallForwardImmediately | 즉시 착신전환 | 무조건 착신전환 | 즉시 | ✅ 필요 |
| **CFB** | CallForwardBusy | 통화중 착신전환 | 통화중이면 착신전환 | 통화중일 때 | ✅ 필요 |
| **CFN** | CallForwardNoanswer | 부재중 착신전환 | 일정시간 미응답 시 착신전환 | 미응답 시 | ✅ 필요 |
| **CFU** | CallForwardUnavailable | 미연결 착신전환 | 단말기 미등록 시 착신전환 | 단말기 오프라인 | ✅ 필요 |
| **DND** | Do-Not-Disturb | 방해금지 | 모든 수신 차단 | 즉시 (on/off) | ❌ 없음 |
| **PEA** | Personal Assistant | 개인비서 | 개인비서가 통화를 먼저 받음 | 즉시 (on/off) | ❌ 없음 |

> 각 타입은 **독립적으로 설정 가능**하며, 동시에 여러 타입을 활성화할 수 있습니다.

> **⚠️ 개인비서(PEA)와 착신전환의 우선순위**: 즉시 착신전환(**CFI**)이 켜져 있으면 CFI 가
> 우선하며 PEA 는 동작하지 않습니다. CFI 가 꺼져 있고 PEA 가 켜져 있으면 **벨이 울리기 전에
> 개인비서가 먼저 전화를 받으므로** 조건부 착신전환(CFB/CFN/CFU)에는 도달하지 않습니다.
> 우선순위는 PBX 가 판단하며 API 는 각 타입의 켜짐/꺼짐만 기록합니다.

### ⚠️ 활성화 필수 조건

**착신전환(CFI/CFB/CFN/CFU)** 이 실제로 동작하려면 **두 가지 조건**을 모두 충족해야 합니다:

1. `enable` 값이 **`yes`** 이어야 함
2. `destination`에 **착신번호**가 설정되어야 함

> 둘 중 하나라도 누락되면 착신전환이 동작하지 않습니다.

> **DND·PEA는 destination이 없는 on/off 토글**입니다. `{"enable":"yes"}` 또는
> `{"enable":"no"}` 로 켜고 끄며, destination을 보내도 무시됩니다.

> **시간 조건(`timeGroup`)** — CF 4종 + DND/PEA 전부 지원(gw 1.4.14.88+). 값은 Time Group
> `"TG-{id}"`(또는 숫자 id — 서버가 정규화, `"none"` = 시간 조건 해제). 지정한 시간대에만 해당
> 규칙이 동작합니다(예: "업무시간 종료 후에만 PEA").
> Time Group 생성/관리는 `GET/POST /api/v1/timegroups`, `PUT/DELETE /api/v1/timegroups/{id}` —
> 스케줄 형식은 `"09:00-18:00,mon-fri,*,*"`(4필드: 시간,요일,일,월 — `&` 다중, `18:00-09:00`=야간
> 익일 창)이며 저장하면 PBX 에 자동 반영됩니다. 모바일 토큰은 조회 + 본인 내선 소유 그룹만
> 생성/수정/삭제할 수 있습니다.
> **PUT `schedules` 3-상태**: 필드 생략 = 기존 유지, `[]` = 스케줄 전체 삭제(그룹은
> 유지 — 참조하는 규칙은 동작하지 않음), `["행",…]` = **전체 교체**(append 아님 —
> 개별 행 수정/삭제는 남길 행 전체를 다시 보냄). POST 는 최소 1개 필수.

> **PEA 활성화 전제 — 안내음**: 개인비서는 내선별 안내음을 재생하는 IVR입니다. PEA를 켤 때
> 그 내선의 안내음이 없으면 **테넌트 기본 안내음**(`PUT /api/v1/earlymedia/_default` 로
> 업로드/TTS 합성) → **내장 기본 안내음** 순으로 자동 사용하므로, 음원이 없어도 PEA 가
> 막히지 않습니다. `400 {"code":"pea_no_recording"}` 은 안내음 준비 자체가 실패한 예외 상황에만
> 발생합니다(운영사에 문의하세요).
> 내선별 안내음 등록/교체 = `PUT /api/v1/earlymedia/{단말번호}` (url/tts/upload) —
> **모바일 토큰은 본인 내선 키만**(`_default`/타 키는 403 `not_owner`).
>
> **안내음 등록 3방식** (`PUT /api/v1/earlymedia/{단말번호}`, JSON):
> - **URL**: `{"enabled":"yes","audioUrl":"https://…mp3|wav"}` — 서버가 내려받아 8kHz WAV 로 변환. TTS 프로바이더 불필요.
> - **TTS**: `{"enabled":"yes","tts":{"text":"…","provider":"openai"?,"voice":"…"?}}` — 클라우드 TTS 합성. **게이트웨이에 TTS 키가 등록되어 있어야 함**; 없으면 400 `{"code":"tts_provider_not_configured"}` — 운영사에 TTS 키 등록을 요청하세요.
> - **파일 업로드**: `POST /api/v1/earlymedia/{단말번호}/upload` (multipart/form-data, field **`file`**, 최대 **10MB**, wav/mp3). 인증은 PUT 과 동일.
>
> 다운로드/합성 실패 시 **502 `{"code":"recording_provision_failed","detail":…}`** 를 반환합니다. 성공 시 200 + `{synthesized|downloaded:true}`.

> **개인비서 IVR 옵션 목적지** — 개인비서 안내 중 발신자가 누르는 DTMF 키별 목적지는
> `GET/PUT /api/v1/pea/{단말번호}/destinations` 로 관리합니다.
> 본문 `{"destinations":{"1":"1010","2":"01012345678"}}` — 키는 `"0"`~`"4"`(`"0"` = 무입력/타임아웃),
> 보낸 키만 갱신되고 빈 문자열은 그 옵션 삭제, 범위 밖 키는 400. 값은 영숫자·`_.,-` 만 허용(최대 128자).
> 내선·전화번호 외의 목적지(예: AI 봇 연결)에 쓸 값은 운영사에 문의하세요. 모바일 토큰은 본인 내선만.

### 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|:------:|:-----|:-----|
| `GET` | `/api/v1/diversions` | 전체 내선 착신전환 현황 |
| `GET` | `/api/v1/diversions/{단말번호}` | 특정 내선 전체 규칙 (CFI/CFB/CFN/CFU + DND/PEA) |
| `GET` | `/api/v1/diversions/{단말번호}/{타입}` | 특정 타입 조회 (CFI/CFB/CFN/CFU/DND/PEA) |
| `PUT` | `/api/v1/diversions/{단말번호}/{타입}` | 착신전환 설정 / DND·PEA 토글 |
| `DELETE` | `/api/v1/diversions/{단말번호}/{타입}` | 착신전환 해제 / DND·PEA 끄기 |

> **모바일(Firebase) 인증** (v1.4.8.44+): 위 엔드포인트는 [1.1](#11-모바일-앱-firebase-id-토큰-인증-v14844)
> 의 Firebase ID 토큰으로도 호출할 수 있습니다. 단, 모바일 토큰은 **자기 seat 에 배정된 단말번호**
> 에만 접근 가능하며(타 단말번호 → 403), 전체 현황 조회(`GET /api/v1/diversions`, 단말번호 미지정)는
> 모바일 토큰으로는 허용되지 않습니다(특정 단말번호 필수).

### 2.1 전체 내선 현황 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/diversions
```

**응답:**
```json
{
  "tenantId": "89abcdef01234567",
  "extensions": [
    {
      "extension": "12345601",
      "did": "07012345601",
      "rules": [
        {"type": "CFI", "enable": "yes", "destination": "01012345678", "rawDestination": "sub-custom-numbers,01012345678,1"},
        {"type": "CFB", "enable": "no"},
        {"type": "CFN", "enable": "no"},
        {"type": "CFU", "enable": "no"}
      ]
    }
  ]
}
```

> `destination` 은 착신번호이고, `rawDestination` 은 PBX 원본 표기입니다. 앱은 `destination` 을 사용하세요.

### 2.2 특정 내선 전체 규칙 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/diversions/12345601
```

**응답:**
```json
{
  "tenantId": "89abcdef01234567",
  "extension": "12345601",
  "did": "07012345601",
  "rules": [
    {"type": "CFI", "enable": "yes", "destination": "01012345678", "rawDestination": "sub-custom-numbers,01012345678,1"},
    {"type": "CFB", "enable": "no", "destination": ""},
    {"type": "CFN", "enable": "no", "destination": ""},
    {"type": "CFU", "enable": "no", "destination": ""}
  ]
}
```

### 2.3 착신전환 설정 (PUT)

```bash
# CFI 즉시 착신전환 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/diversions/12345601/CFI \
  -d '{"enable":"yes","destination":"01012345678"}'

# CFB 통화중 착신전환 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/diversions/12345601/CFB \
  -d '{"enable":"yes","destination":"07012345602"}'

# CFN 부재중 착신전환 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/diversions/12345601/CFN \
  -d '{"enable":"yes","destination":"01098765432"}'

# CFU 미연결 착신전환 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/diversions/12345601/CFU \
  -d '{"enable":"yes","destination":"01098765432"}'
```

**PUT Body:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `enable` | string | - | `"yes"` 또는 `"no"` (그 밖의 값은 400) |
| `destination` | string | - | 착신번호 (영숫자·`_.,+*#-`, 최대 160자 — 공백 등 그 밖의 문자는 400) |
| `timeGroup` | string | - | 시간 조건 그룹 (선택, 위 `timeGroup` 설명 참고) |

> `enable`만 보내면 번호는 유지, `destination`만 보내면 활성화 상태는 유지됩니다.

**응답:**
```json
{
  "ok": true,
  "tenantId": "89abcdef01234567",
  "extension": "12345601",
  "did": "07012345601",
  "rule": {
    "type": "CFI",
    "enable": "yes",
    "destination": "01012345678",
    "rawDestination": "sub-custom-numbers,01012345678,1"
  }
}
```

### 2.3.1 방해금지(DND) · 개인비서(PEA) 토글

DND·PEA는 **destination 없는 on/off 토글**입니다. `{"enable":"yes"|"no"}` 만 보냅니다.

```bash
# 방해금지(DND) 켜기 / 끄기
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/diversions/12345601/DND -d '{"enable":"yes"}'
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/diversions/12345601/DND -d '{"enable":"no"}'

# 개인비서(PEA) 켜기 — CFI 가 꺼져 있으면 벨이 울리기 전에 개인비서가 먼저 수신
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/diversions/12345601/PEA -d '{"enable":"yes"}'

# 조회 (단일 타입 / 전체) — 전체 조회 시 rules[]에 DND·PEA도 포함
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/diversions/12345601/PEA
```

**응답 (PEA):**
```json
{
  "ok": true,
  "tenantId": "89abcdef01234567",
  "extension": "12345601",
  "did": "07012345601",
  "rule": { "type": "PEA", "enable": "yes" }
}
```

### 2.4 착신전환 비활성화 (번호 유지)

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/diversions/12345601/CFI \
  -d '{"enable":"no"}'
```

### 2.5 착신전환 해제 (DELETE — 번호까지 삭제)

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/diversions/12345601/CFI
```

**응답:**
```json
{
  "ok": true,
  "tenantId": "89abcdef01234567",
  "extension": "12345601",
  "type": "CFI",
  "action": "disabled"
}
```

---

## 폰북 (Phonebook)

테넌트의 내부 디렉터리를 조회합니다. 모바일 앱이 **연락처 화면 분류**와
**"기능번호·음성회의는 인터넷통화(mVoIP) 전용 발신"** 분기에 사용할 수 있도록, 각 항목에
**카테고리(`type`)** 가 포함됩니다. (v1.4.8.44+)

### 엔드포인트

| 메서드 | 경로 | 설명 |
|:------:|:-----|:-----|
| `GET` | `/api/v1/phonebook[?tenantId=...]` | 테넌트 폰북(연락처 목록) 조회 |

- **인증**: 착신전환과 동일 — `dvgw_`→JWT(서버/관리) **또는** Firebase ID 토큰/accessToken(모바일).
  자세한 내용은 [1.1 모바일 Firebase 인증](#11-모바일-앱-firebase-id-토큰-인증-v14844).
- **테넌트 범위**: 테넌트/모바일 토큰은 자기 테넌트로 자동 스코프(`?tenantId=` 무시).
  Admin(`dvgw_`) 토큰은 `?tenantId={path}` 필수.

### 응답 스키마 (`contacts[]`)

```json
{
  "phonebookId": "internal-0123456789abcdef",
  "tenantId": "0123456789abcdef",
  "contacts": [
    {
      "name": "기술이사",
      "number": "1010",
      "type": "Extensions",
      "email": "user@example.com",
      "company": "Example",
      "mobile": "01012345678"
    },
    {
      "name": "영업팀",
      "number": "6000",
      "type": "Ring Groups"
    }
  ]
}
```

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `phonebookId` | string | ✅ | 폰북 식별자(`internal-{tenantId}`) |
| `tenantId` | string | ✅ | 테넌트 식별자(16-hex) |
| `contacts` | array | ✅ | 연락처 목록 |
| `contacts[].name` | string | ✅ | 표시 이름(없으면 번호로 폴백) |
| `contacts[].number` | string | ✅ | **발신 번호**(단말번호/그룹번호/회의번호/기능번호) |
| `contacts[].type` | string | ✅ | **카테고리** — 아래 고정 집합 중 하나 |
| `contacts[].email` | string | - | 이메일(있을 때만) |
| `contacts[].company` | string | - | 회사/부서(있을 때만) |
| `contacts[].mobile` | string | - | 휴대폰 번호(있을 때만) |

#### 카테고리(`type`) 값 집합 — 앱 매핑

| `type` 값 | 앱 분류 | 발신 방식 |
|-----------|---------|-----------|
| `Extensions` | 단말번호 | 일반(단말/인터넷통화) |
| `Feature Codes` | 기능번호 | **mVoIP 전용** |
| `Ring Groups` | 그룹번호 | 일반 |
| `Conferences` | 음성회의 | **mVoIP 전용** |

> 카테고리는 **PBX 원본 값을 그대로 보존**합니다(게이트웨이가 추론·재분류하지 않음). 정렬은
> 카테고리 선언 순서 → 번호 오름차순. 번호가 없는 항목은 목록에서 제외됩니다.

### 예시

```bash
# Firebase 토큰(모바일) — 자기 테넌트 폰북
curl -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  http://localhost:8080/api/v1/phonebook

# dvgw 키→JWT(Admin) — 특정 테넌트 지정
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/v1/phonebook?tenantId=0123456789abcdef"
```

> 테넌트에 내부 디렉터리가 없으면 빈 `contacts` 를 반환합니다. 게이트웨이에서 PBX 연동이 구성되지
> 않았으면 **503** 입니다 — 운영사에 문의하세요.

---

## 3. 발신자표시 (Caller ID)

Dynamic VoIP PBX의 내선별 발신자표시(CID)를 관리합니다.

### CID 형식

```
"발신자이름" <발신자번호>

예: "Example Inc." <0212345678>
예: "07012345600" <07012345600>
```

### 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|:------:|:-----|:-----|
| `GET` | `/api/v1/callerid/{단말번호}` | 내부/외부 발신자표시 조회 |
| `PUT` | `/api/v1/callerid/{단말번호}` | 외부 발신자표시 변경 |

> 🔐 **테넌트 스코프** — 내선번호는 테넌트마다 겹칠 수 있으므로 조회·변경은 테넌트 단위로 좁혀집니다.
> 테넌트·모바일 토큰은 **토큰 테넌트로 고정**되고, admin 은 `?tenantId=<path>` 로 대상을 정합니다.
> admin 이 `tenantId` 를 생략하면 그 내선이 **한 테넌트에만** 있을 때만 동작하고,
> 여러 테넌트에 있으면 `409 ambiguous_extension` 입니다. 테넌트를 해석하지 못하면
> `403 tenant_unresolved`(게이트웨이 기동 직후에는 `503 tenant_cache_not_ready` + `Retry-After` — 잠시 후 재시도),
> 해석할 수 없는 `tenantId` 는 `400 unknown_tenant` 입니다.

> `internalCid`(내부발신자표시)는 **조회만** 가능합니다 (PBX 관리).
> `externalCid`(외부발신자표시)는 **조회 + 변경** 가능합니다.

> **`did`** 는 그 내선(seat)에 지정된 **실제 수신 DID** 이며, **모르면 빈 문자열**입니다(추측하지 않음).
> provision 응답의 `dids` 와 같은 값입니다.
>
> **`perCallCid`**: 이 게이트웨이에서 **통화별 발신번호 선택이 동작하는가**. 모바일 flat 응답에도
> 포함됩니다. 앱은 `false` 면 발신번호 선택 UI 를 **숨기세요** — 꺼진 게이트웨이에서는 고른 번호가
> 무시되고 단말 CID 로 발신됩니다. 기능이 필요하면 운영사에 요청하세요.
> ⚠️ **필드 부재 = 구버전 게이트웨이** → 기존 동작을 유지하십시오(부재를 `false` 로 읽지 마세요).

### 3.1 발신자표시 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/callerid/12345600
```

**응답:**
```json
{
  "extension": "12345600",
  "did": "07012345600",
  "perCallCid": true,
  "name": "07012345600",
  "internalCid": {
    "name": "07012345600",
    "number": "12345600",
    "raw": "\"07012345600\" <12345600>"
  },
  "externalCid": {
    "name": "07012345600",
    "number": "07012345600",
    "raw": "\"07012345600\" <07012345600>"
  }
}
```

#### 모바일(Firebase) 조회 — flat `{name, number}` (v1.4.8.47+)

모바일 앱은 [1.1](#11-모바일-앱-firebase-id-토큰-인증-v14844)의 Firebase ID 토큰(또는 accessToken)으로 **GET 만** 호출하며
(PUT 은 403 `read_only` — CID 변경은 admin/서버 전용), 응답은 **외부 발신표시(이름/번호)만** flat 으로
받습니다(내부 CID 미노출). 멀티 테넌트는 `?tenantId=<path>`. 자기 배정 단말번호만 접근(타 단말 → 403).

```bash
curl -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  "http://localhost:8080/api/v1/callerid/1010?tenantId=0123456789abcdef"
```
```json
{ "name": "Example 대표", "number": "07012341010" }
```

> dvgw 키→JWT(admin) 호출은 rich 응답(extension/did/internalCid/externalCid)을 그대로 받습니다.

#### 테넌트 대표 CID — `GET /api/v1/callerid/_default` (v1.4.8.49+)

외부발신 표시정보 **폴백 체인**의 ②단계 — 내선별 CID(`/callerid/{ext}`)가 비어 있을 때 쓰는
**테넌트 대표 발신표시**(대표 이름 / 대표 번호). 인증·테넌트 스코프는 다른 callerid GET 과
동일(Firebase 또는 admin JWT). **GET 전용**(대표 CID 변경은 관리자가 테넌트 설정에서 합니다).

- `_default` 는 **테넌트 단위** 정보라 내선별 소유 검증이 없습니다 — 그 테넌트에 seat 을 가진
  사용자면 누구나 조회. 멀티 테넌트는 `?tenantId=<path>`.

```bash
curl -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  "http://localhost:8080/api/v1/callerid/_default?tenantId=0123456789abcdef"
```
```json
{ "name": "Example", "number": "0270001000" }
```

> 앱 폴백 체인: ① `/callerid/{ext}` → ② (비면) `/callerid/_default`(테넌트 대표) → ③ (그래도 비면)
> 앱의 최종 기본값.

### 3.2 외부 발신자표시 변경

> ⚠️ **중요:** 발신자 정보 변경 후 PBX에 반영하려면 **설정 재적용(apply_changes)**이 필요합니다.
> `"applyChanges": true`를 포함하면 변경 + 설정 재적용이 **한번의 호출로** 처리됩니다.

**이름만 변경 + 즉시 적용:**
```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/callerid/12345600 \
  -d '{"name":"홍길동","applyChanges":true}'
```
→ 외부 발신표시 `"홍길동" <07012345600>` + PBX 설정 재적용

**번호만 변경 + 즉시 적용:**
```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/callerid/12345600 \
  -d '{"number":"0212345678","applyChanges":true}'
```
→ 외부 발신표시 `"07012345600" <0212345678>` + PBX 설정 재적용

**이름 + 번호 동시 변경 + 즉시 적용:**
```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/callerid/12345600 \
  -d '{"name":"Example Inc.","number":"0212345678","applyChanges":true}'
```
→ 외부 발신표시 `"Example Inc." <0212345678>` + PBX 설정 재적용

**저장만 (적용 보류):**
```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/callerid/12345600 \
  -d '{"name":"홍길동"}'
```
→ 저장만 되고 PBX에는 미반영 (별도 `POST /api/v1/pbx/apply-changes` 필요)

**PUT Body:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `name` | string | - | 발신자 표시 이름 |
| `number` | string | - | 발신자 표시 번호 |
| `applyChanges` | bool | - | `true`면 변경 후 PBX 설정 자동 재적용 |

> `name`/`number` 중 하나만 보내도 나머지는 기존 값이 유지됩니다.

**응답 (`applyChanges: true` 시):**
```json
{
  "ok": true,
  "extension": "12345600",
  "did": "07012345600",
  "externalCid": {
    "name": "Example Inc.",
    "number": "0212345678",
    "raw": "\"Example Inc.\" <0212345678>"
  },
  "applied": true
}
```

---

## 통화기록 (CDR)

PBX 통화기록을 게이트웨이 경유로 조회합니다. 앱은 PBX 자격증명 없이 게이트웨이 토큰만으로
통화기록을 조회할 수 있습니다. (v1.4.8.52+)

### 엔드포인트

| 메서드 | 경로 | 설명 |
|:------:|:-----|:-----|
| `GET` | `/api/v1/pbx/cdr` | 통화기록 조회 |

- **인증**: 착신전환·폰북과 동일 — `dvgw_`→JWT(서버/관리) **또는** Firebase ID 토큰/accessToken(모바일).
  멀티 테넌트는 `?tenantId=<path>`([1.1](#11-모바일-앱-firebase-id-토큰-인증-v14844)).
- **노출 범위**:
  - **모바일**: 토큰 사용자의 **자기 단말(내선) 또는 그 단말에 걸린 착신통화만**.
    게이트웨이가 행을 caller 의 내선(`src`/`dst`)·수신 DID(`did`)로 필터합니다
    (일치 필드가 없으면 제외 — 타인 통화 미노출). 내선 미배정(push-only) 사용자는 빈 결과.
  - **dvgw 키→JWT(admin/tenant)**: 테넌트 전체(필터 없음).
- **쿼리 전달**: 앱이 보낸 쿼리(`search`/`search_fields`/페이지·기간 등)를 그대로 PBX 조회에 사용합니다
  (`tenantId`/`token` 키만 제외). 예: linkedid 단건 조회.
- **응답**: **PBX 통화기록 원본 형식 그대로**(행 형식·봉투 구조 보존). 모바일은 같은 봉투에서
  본인 통화 행만 남습니다. 행 배열 위치는 배포마다 다를 수 있으므로(`data`[] · `data.result`[] ·
  `data.results`[] · 최상위 `results`[]) 앱 파서는 네 형태를 모두 처리하세요.
- **녹취**: 각 행의 `has_recording`(불리언)이 녹취 유무를 알려 줍니다. 녹취 파일 URL(`recording_url`·`recfile`)은
  기본적으로 응답에서 제거되므로(그 값에 의존하지 마세요), 재생은 인증된 `GET /api/v1/pbx/cdr/recording` 으로 합니다.

### 예시

```bash
# 모바일(Firebase) — 본인 통화 중 특정 linkedid 조회
curl -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" \
  "http://localhost:8080/api/v1/pbx/cdr?search=1700000000.123&search_fields=linkedid"

# dvgw 키→JWT(admin) — 특정 테넌트 전체
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/v1/pbx/cdr?tenantId=0123456789abcdef&search=1010&search_fields=src,dst"
```

> **본인 통화 필터**는 표준 CDR 필드(`src` 발신·`dst` 착신·`did` 수신 대표번호)의 정확 일치로 동작합니다.
> 본인 통화가 보이지 않으면 운영사에 문의하세요.

### 통화 ↔ linkedid 연계 — `X-Linkedid` SIP 헤더

푸시(FCM)를 쓰지 않는 배포에서는 앱이 푸시로 linkedid 를 받을 수 없습니다. 그래서 앱이 통화 직후
정확한 linkedid 로 CDR/녹취를 조회하려면(번호·시각 추정 대신) mVoIP 통화의 SIP 메시지에 실린
**`X-Linkedid` 커스텀 헤더**를 앱이 SIP 시점에 읽습니다.

- 이 헤더는 게이트웨이가 아니라 **PBX 가 부착**합니다. 헤더가 오지 않으면 운영사에 `X-Linkedid` 부착을 요청하세요.
- 헤더명: **`X-Linkedid`** (값 = 그 통화의 linkedid).
- 앱은 SIP 연결 시 이 헤더를 읽어 로컬 통화이력에 linkedid 를 저장 → 위 `GET /api/v1/pbx/cdr?
  search=<linkedid>&search_fields=linkedid` 로 정확히 조회(추정·푸시 불필요).
- 푸시를 쓰는 배포에서도 같은 헤더를 쓰면 푸시와 무관하게 더 견고합니다.

---

## 4. API 키 관리 (App Keys)

Dynamic VoIP PBX의 단말(DID)별 API 인증 키를 관리합니다.

### 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|:------:|:-----|:-----|
| `GET` | `/api/v1/appkeys` | 전체 키 목록 |
| `GET` | `/api/v1/appkeys/{DID}` | DID로 키 조회 |
| `POST` | `/api/v1/appkeys` | 키 생성 (32자리 hex 자동 생성) |
| `PUT` | `/api/v1/appkeys/{DID}` | 활성화/비활성화, 키 재생성 |
| `DELETE` | `/api/v1/appkeys/{DID}` | 키 삭제 |

> 🔐 **관리자 JWT 전용** — 테넌트·모바일 토큰은 `403 admin_required` 입니다.

### 4.1 전체 키 목록 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/appkeys
```

**응답:**
```json
{
  "columns": ["id", "description", "key", "tenant", "enabled", "tenant_id"],
  "rows": [
    {"id": 1, "description": "07012345601", "key": "0123456789abcdef0123456789abcdef", "tenant": 1, "enabled": "yes", "tenant_id": 1},
    {"id": 2, "description": "07012345600", "key": "fedcba9876543210fedcba9876543210", "tenant": 1, "enabled": "yes", "tenant_id": 1}
  ],
  "count": 2
}
```

| 필드 | 설명 |
|------|------|
| `description` | DID 번호 |
| `key` | API 키 (32자리 hex) |
| `tenant` | 키가 속한 테넌트 번호 |
| `enabled` | `yes` / `no` |
| `tenant_id` | 레거시 필드 (항상 `1`) |

### 4.2 DID로 키 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/appkeys/07012345601
```

**응답:**
```json
{
  "id": 1,
  "description": "07012345601",
  "key": "0123456789abcdef0123456789abcdef",
  "tenant": 1,
  "enabled": "yes",
  "tenant_id": 1
}
```

### 4.3 키 생성

DID 번호 또는 단말번호로 생성합니다. 키는 자동 생성되며, 중복 체크를 수행합니다.

```bash
# DID 번호로 생성 (권장)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/appkeys \
  -d '{"did":"07012345603","tenantId":"0123456789abcdef"}'

# 단말번호로 생성 ("070" + 단말번호를 DID 로 사용)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/appkeys \
  -d '{"extension":"12345603"}'
```

**POST Body:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `did` | string | O* | DID 번호 (예: `07012345603`) |
| `extension` | string | O* | 단말번호 (예: `12345603`, `"070"` 을 붙여 DID 로 사용) |
| `tenantId` | string | - | 키가 묶일 테넌트 — 테넌트 path(16-hex) 또는 숫자 tenant_id. `?tenantId=` 쿼리도 받습니다(본문 우선) |

> `did` 또는 `extension` 중 하나 필수. 이미 존재하면 409 Conflict.
>
> ⚠️ **`extension` 입력은 `"070"+단말번호` 가 실제 DID 인 경우에만 쓰세요.** 그렇지 않은 설치에서는
> 엉뚱한 DID 로 키가 만들어집니다 — 가능하면 `did` 를 명시하십시오.
>
> ⚠️ **`tenantId` 를 지정하세요.** 생략하면 키가 테넌트 `1` 로 기록되고 응답에 `tenantDefaulted:true` 가
> 실립니다. 해석할 수 없는 `tenantId` 는 400 `unknown_tenant`(게이트웨이 기동 직후에는 `tenant_cache_not_ready` —
> 잠시 후 재시도)입니다.

**응답:**
```json
{
  "ok": true,
  "did": "07012345603",
  "key": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
  "tenant": "1",
  "tenantDefaulted": true
}
```

### 4.4 활성화/비활성화 및 키 재생성

```bash
# 비활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/appkeys/07012345601 \
  -d '{"enabled":"no"}'

# 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/appkeys/07012345601 \
  -d '{"enabled":"yes"}'

# 키 재생성 (새 키 발급)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/appkeys/07012345601 \
  -d '{"regenerateKey":true}'

# 비활성화 + 키 재생성 동시
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/appkeys/07012345601 \
  -d '{"enabled":"no","regenerateKey":true}'
```

**PUT Body:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `enabled` | string | - | `"yes"` 또는 `"no"` |
| `regenerateKey` | bool | - | `true`면 새 키 생성 |

**응답:**
```json
{
  "ok": true,
  "did": "07012345601",
  "enabled": "no",
  "key": "f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6"
}
```

### 4.5 키 삭제

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/appkeys/07012345603
```

---

## 5. Early Media (응답 전 안내음)

전화 응답(Answer) 전에 안내음을 재생합니다(183 Session Progress).
번호별로 활성화/비활성화 및 음원을 관리합니다.

### 동작 원리

```
전화 수신 → 응답 전 안내음 재생 → 응답(Answer) → AI 봇 연결
```

> 이 번호로 들어오는 전화에 응답 전 안내음이 재생되도록 연결하는 작업은 운영사가 합니다.

### 엔드포인트

| 메서드 | 경로 | 설명 |
|:------:|:-----|:-----|
| `GET` | `/api/v1/earlymedia/{extension}` | Early Media 설정 조회 |
| `PUT` | `/api/v1/earlymedia/{extension}` | Early Media 설정/변경 |
| `POST` | `/api/v1/earlymedia/{extension}/upload` | 음원 파일 업로드 (multipart `file`, 최대 10MB) |

### 5.1 Early Media 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/v1/earlymedia/07012345601?tenantId=0123456789abcdef"
```

**응답:**
```json
{
  "tenantId": "0123456789abcdef",
  "extension": "07012345601",
  "did": "07012345601",
  "enabled": "yes",
  "audioUrl": "https://cdn.example.com/greeting.mp3",
  "source": "url",
  "ttsText": "",
  "ttsProvider": "",
  "ttsVoice": "",
  "fileExists": true
}
```

`tenantId` 는 서버가 실제로 적용한 테넌트입니다. 의도한 테넌트와 같은지 확인하세요.

`source` 필드는 음원의 출처를 나타냅니다:
- `"url"` — 외부 URL에서 다운로드
- `"tts"` — 클라우드 TTS로 합성

### 5.2 Early Media 설정 (음원 URL + 활성화)

음원 URL을 설정하면 **자동으로 다운로드 + WAV 변환**됩니다 (MP3, OGG, FLAC 등 지원).

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07012345601?tenantId=0123456789abcdef" \
  -d '{"enabled":"yes","audioUrl":"https://cdn.example.com/greeting.mp3"}'
```

**응답:**
```json
{
  "ok": true,
  "extension": "07012345601",
  "did": "07012345601",
  "enabled": "yes",
  "audioUrl": "https://cdn.example.com/greeting.mp3",
  "source": "url",
  "downloaded": true
}
```

**PUT Body:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `enabled` | string | - | `"yes"` 또는 `"no"` |
| `audioUrl` | string | - | 음원 URL (mp3/wav/ogg/flac — 8kHz mono WAV로 자동 변환) |
| `tts` | object | - | TTS 합성 (아래 5.5 참고). `audioUrl`과 동시 사용 불가 |

### 5.3 Early Media 활성화/비활성화만 변경

음원은 유지하고 활성화 상태만 변경:

```bash
# 비활성화 (음원 유지)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07012345601?tenantId=0123456789abcdef" \
  -d '{"enabled":"no"}'

# 다시 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07012345601?tenantId=0123456789abcdef" \
  -d '{"enabled":"yes"}'
```

### 5.4 음원만 변경

활성화 상태는 유지하고 음원만 교체:

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07012345601?tenantId=0123456789abcdef" \
  -d '{"audioUrl":"https://cdn.example.com/new-greeting.mp3"}'
```

### 5.5 TTS 합성으로 Early Media 설정

텍스트만 보내면 클라우드 TTS로 합성된 음성이 Early Media로 등록됩니다. 음원 파일을 따로 준비할 필요가 없습니다.

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07012345601?tenantId=0123456789abcdef" \
  -d '{
    "enabled": "yes",
    "tts": {
      "text": "안녕하세요, 예시상사입니다. 잠시만 기다려주세요.",
      "provider": "elevenlabs"
    }
  }'
```

**응답:**
```json
{
  "ok": true,
  "extension": "07012345601",
  "did": "07012345601",
  "enabled": "yes",
  "source": "tts",
  "synthesized": true,
  "ttsProvider": "elevenlabs",
  "ttsVoice": "<voice-id>"
}
```

**TTS 객체 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `text` | string | ✅ | 합성할 텍스트 |
| `provider` | string | - | `google` / `openai` / `elevenlabs` / `azure` / `aws` / `gemini` / `cosyvoice` / `qwen`. 미지정 시 게이트웨이에 지정된 기본(1순위) 프로바이더 사용 |
| `voice` | string | - | 음성 ID. 미지정 시 게이트웨이 설정 또는 프로바이더 기본값 사용 |

**중요:**
- API 키는 본 요청에 포함하지 않습니다. 게이트웨이에 테넌트별로 사전 등록된 TTS 키가 자동 사용됩니다.
  키가 등록되지 않았으면 400 `tts_provider_not_configured` 입니다 — 운영사에 TTS 키 등록을 요청하세요.
- `audioUrl`과 `tts`는 **동시 사용 불가**입니다. 하나만 선택하세요.
- 합성된 음성은 자동으로 8kHz mono WAV로 변환되어 저장됩니다.
- TTS 메타데이터(`text`, `provider`, `voice`)는 서버에 저장되어 GET 응답에 포함됩니다.

### 5.6 테넌트 기본값 (v1.4+) — `_default` 특수 extension

번호마다 개별 설정이 없을 때 폴백으로 재생되는 **테넌트 전체 기본 Early Media**. `extension` 위치에 예약어 `_default` 를 넣으면 일반 번호별 엔드포인트가 그대로 재활용됩니다.

**폴백 순서:**

1. 해당 번호 개별 설정 `enabled="yes"` → **번호별 설정 사용**
2. 아니면 `_default` 프로파일 `enabled="yes"` → **테넌트 기본값 사용**
3. 둘 다 비활성 → Early Media 스킵

```bash
# 테넌트 기본 Early Media를 TTS로 설정
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/_default?tenantId=0123456789abcdef" \
  -d '{
    "enabled": "yes",
    "tts": {
      "text": "고객센터 상담원 연결 중입니다. 잠시만 기다려 주세요.",
      "provider": "openai",
      "voice": "nova"
    }
  }'

# 조회 — 동일한 응답 스키마
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/v1/earlymedia/_default?tenantId=0123456789abcdef"

# 기본값 비활성화 (번호별 설정은 영향 없음)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/_default?tenantId=0123456789abcdef" \
  -d '{"enabled":"no"}'
```

**입력 규칙**: API는 `extension` 값이 숫자(와 하이픈) 이거나 정확히 `_default` 여야만 받아들입니다. 그 밖의 문자열은 400 에러로 거부됩니다.

### 5.7 SDK 사용법

**TypeScript:**
```typescript
// 번호별 조회
const config = await gw.getEarlyMedia('07012345601', 'tenant-id');
console.log(config);
// { enabled: "yes", audioUrl: "https://...", source: "url", fileExists: true }

// 번호별 — 음원 URL + 활성화 설정
await gw.setEarlyMedia('07012345601', {
  enabled: 'yes',
  audioUrl: 'https://cdn.example.com/greeting.mp3',
}, 'tenant-id');

// 번호별 — TTS로 설정 (게이트웨이에 등록된 프로바이더 키 사용)
await gw.setEarlyMedia('07012345601', {
  enabled: 'yes',
  tts: {
    text: '안녕하세요, 예시상사입니다. 잠시만 기다려주세요.',
    provider: 'elevenlabs',  // optional
  },
}, 'tenant-id');

// 비활성화만 (음원 유지)
await gw.setEarlyMedia('07012345601', { enabled: 'no' }, 'tenant-id');

// 다시 활성화
await gw.setEarlyMedia('07012345601', { enabled: 'yes' }, 'tenant-id');

// 음원만 교체
await gw.setEarlyMedia('07012345601', {
  audioUrl: 'https://cdn.example.com/new-greeting.mp3',
}, 'tenant-id');

// ─── 테넌트 기본값 (v1.4+) — 편의 메서드 ─────────────────────────
// 기본값 조회
const def = await gw.getEarlyMediaDefault('tenant-id');

// 기본값 TTS 설정 — 모든 미설정 번호가 이 안내음 재생
await gw.setEarlyMediaDefault({
  enabled: 'yes',
  tts: {
    text: '고객센터 상담원 연결 중입니다. 잠시만 기다려 주세요.',
    provider: 'openai',
    voice: 'nova',
  },
}, 'tenant-id');

// 기본값 오디오 URL 설정
await gw.setEarlyMediaDefault({
  enabled: 'yes',
  audioUrl: 'https://cdn.example.com/brand-jingle.mp3',
}, 'tenant-id');

// 기본값 비활성화 (번호별 설정은 영향 없음)
await gw.setEarlyMediaDefault({ enabled: 'no' }, 'tenant-id');

// 상수로 명시적 지정도 가능 (동일 결과)
await gw.setEarlyMedia(
  DVGatewayClient.EARLY_MEDIA_DEFAULT_EXT,  // = "_default"
  { enabled: 'yes', tts: { text: '기본 안내음' } },
  'tenant-id',
);
```

**Python:**
```python
# 번호별 조회
config = await gw.get_early_media("07012345601", tenant_id="tenant-id")

# 번호별 — 음원 URL + 활성화 설정
await gw.set_early_media("07012345601",
    enabled="yes",
    audio_url="https://cdn.example.com/greeting.mp3",
    tenant_id="tenant-id")

# 번호별 — TTS로 설정
await gw.set_early_media("07012345601",
    enabled="yes",
    tts={
        "text": "안녕하세요, 예시상사입니다. 잠시만 기다려주세요.",
        "provider": "elevenlabs",  # optional
    },
    tenant_id="tenant-id")

# 비활성화만 (음원 유지)
await gw.set_early_media("07012345601", enabled="no", tenant_id="tenant-id")

# 다시 활성화
await gw.set_early_media("07012345601", enabled="yes", tenant_id="tenant-id")

# 음원만 교체
await gw.set_early_media("07012345601",
    audio_url="https://cdn.example.com/new-greeting.mp3",
    tenant_id="tenant-id")

# ─── 테넌트 기본값 (v1.4+) — 편의 메서드 ─────────────────────────
# 기본값 조회
default = await gw.get_early_media_default(tenant_id="tenant-id")

# 기본값 TTS 설정 — 모든 미설정 번호가 이 안내음 재생
await gw.set_early_media_default(
    enabled="yes",
    tts={
        "text": "고객센터 상담원 연결 중입니다. 잠시만 기다려 주세요.",
        "provider": "openai",
        "voice": "nova",
    },
    tenant_id="tenant-id",
)

# 기본값 오디오 URL 설정
await gw.set_early_media_default(
    enabled="yes",
    audio_url="https://cdn.example.com/brand-jingle.mp3",
    tenant_id="tenant-id",
)

# 기본값 비활성화 (번호별 설정은 영향 없음)
await gw.set_early_media_default(enabled="no", tenant_id="tenant-id")

# 상수로 명시적 지정도 가능 (동일 결과)
await gw.set_early_media(
    gw.EARLY_MEDIA_DEFAULT_EXT,  # = "_default"
    enabled="yes",
    tts={"text": "기본 안내음"},
    tenant_id="tenant-id",
)
```

### 5.8 실무 시나리오 — 대량 테넌트 프로비저닝

수백 개 번호에 동일한 안내음을 반복 설정할 필요 없이, 기본값 1회 + 예외 번호만 개별 설정:

**TypeScript:**
```typescript
async function provisionTenant(tenantId: string, brandName: string) {
  // 1. 테넌트 전체 기본 인사말 — 모든 번호가 이것을 폴백으로 사용
  await gw.setEarlyMediaDefault({
    enabled: 'yes',
    tts: {
      text: `${brandName} 고객센터입니다. 잠시만 기다려 주세요.`,
      provider: 'openai',
      voice: 'nova',
    },
  }, tenantId);

  // 2. VIP 번호만 특별 안내음 (기본값 자동 오버라이드)
  await gw.setEarlyMedia('07012345601', {
    enabled: 'yes',
    tts: { text: `${brandName} VIP 고객센터입니다. 최우선으로 응대해 드립니다.` },
  }, tenantId);

  // 3. 수백 개의 나머지 번호는 추가 API 호출 없이 자동으로 기본 인사말 사용
}
```

**Python:**
```python
async def provision_tenant(tenant_id: str, brand_name: str):
    # 1. 테넌트 전체 기본 인사말
    await gw.set_early_media_default(
        enabled="yes",
        tts={
            "text": f"{brand_name} 고객센터입니다. 잠시만 기다려 주세요.",
            "provider": "openai",
            "voice": "nova",
        },
        tenant_id=tenant_id,
    )

    # 2. VIP 번호만 특별 안내음
    await gw.set_early_media("07012345601",
        enabled="yes",
        tts={"text": f"{brand_name} VIP 고객센터입니다. 최우선으로 응대해 드립니다."},
        tenant_id=tenant_id,
    )
```

### 음원 파일 변환

| 입력 형식 | 출력 형식 |
|----------|----------|
| MP3, OGG, FLAC, AAC, WAV 등 | 8kHz, mono, 16-bit PCM WAV |

> 통화 중 재생은 8kHz mono WAV 만 지원합니다.
> DVGateway API가 **어떤 형식이든 저장 시 자동으로 변환**하므로 원본 형식은 신경 쓰지 않아도 됩니다.

---

## 6. PBX API 연동

설정 재적용 및 클릭투콜 기능을 제공합니다.

### 6.1 설정 재적용

PBX에서 변경된 설정을 시스템에 즉시 반영합니다.

```bash
POST /api/v1/pbx/apply-changes
```

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/pbx/apply-changes
```

### 6.2 클릭투콜

아웃바운드 통화를 발신합니다. 먼저 `caller` 단말이 울리고, 받으면 `callee` 로 연결됩니다.

```bash
POST /api/v1/pbx/click-to-call
```

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/pbx/click-to-call \
  -d '{
    "caller": "12345601",
    "callee": "01012345678",
    "cidName": "Example",
    "cidNumber": "07012345601",
    "accountCode": "",
    "customValue1": "홍길동",
    "customValue2": "ORD-001",
    "customValue3": ""
  }'
```

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `caller` | string | O | 발신 단말번호 |
| `callee` | string | O | 수신 전화번호 |
| `cidName` | string | - | 발신자 표시 이름 |
| `cidNumber` | string | - | 발신자 표시 번호 |
| `accountCode` | string | - | 과금 코드 |
| `customValue1~3` | string | - | 커스텀 변수 (통화에 함께 전달) |
| `clientMsgId` | string | - | 멱등 키 (`Idempotency-Key` 헤더로도 가능) — 같은 키로 재시도하면 다시 발신하지 않고 최초 응답을 돌려줍니다 |

> 발신 등급은 게이트웨이가 호출 테넌트 기준으로 자동 결정합니다(클라이언트 미전송). `cidNumber`·
> `accountCode` 는 테넌트에 등록된 값이 우선 적용되며, 테넌트에 발신 기본값이 등록되지 않았으면
> **412** 입니다 — 운영사에 요청하세요. 테넌트별 분당 발신 상한을 넘으면 **429 `cost_rate_limited`**.

**응답:** PBX 응답에 **`actionID`**(이 발신의 상관키)가 함께 실립니다. 앱은 이 값을 저장해 두고
발신 취소(6.3)·linkedid 조회(6.4)에 사용하세요.

```json
{ "ok": true, "actionID": "<action-id>" }
```

#### 모바일(Firebase) 클릭투콜 (v1.4.8.53+)

모바일 앱은 [1.1](#11-모바일-앱-firebase-id-토큰-인증-v14844)의 Firebase ID 토큰(또는 accessToken)으로 호출합니다.
seat 가 속한 테넌트는 서버가 해석합니다. 멀티 테넌트는 `?tenantId=<path>`(또는 `X-Tenant-ID`).

- **`caller` 는 토큰 사용자 본인 seat 에 배정된 내선이어야 함**(타 내선 → 403 `not_owner`,
  내선 미배정 → 403 `no_extension`).
- 본문은 위와 동일(`caller`/`callee`/`cidName`/`cidNumber`/`accountCode`/`customValue1~3`).

```bash
curl -X POST -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/pbx/click-to-call?tenantId=0123456789abcdef" \
  -d '{"caller":"1010","callee":"01012345678"}'
```

### 6.3 클릭투콜 발신 취소 (v1.4.14.134+)

클릭투콜 발신 **직후**(내 단말이 울리는 중 / 착신이 아직 응답하기 전) 통화를 취소하고
양쪽 통화(내 단말 콜백 + 착신)를 종료합니다. 앱의 "발신 취소" 버튼용입니다.

```bash
POST /api/v1/pbx/click-to-call/cancel
```

```bash
# 권장: 클릭투콜 응답의 actionID 로 정확히 취소
curl -X POST -H "Authorization: Bearer <FIREBASE_ID_TOKEN>" -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/pbx/click-to-call/cancel?tenantId=0123456789abcdef" \
  -d '{"actionID":"<action-id>","caller":"1010","callee":"01012345678"}'
```

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `actionID` | string | 권장 | 클릭투콜 응답의 상관키(`actionId` 표기도 허용). 있으면 그 통화를 정확히 찾아 취소 |
| `caller` | string | O* | 발신 단말번호(모바일=본인 내선) |
| `callee` | string | O* | 수신 전화번호 |

> \* `actionID` 가 없으면 `caller`·`callee` 가 필수입니다(그 경우 해당 내선의 진행 중 발신을 찾아 취소하며,
> 같은 내선의 무관한 동시 통화는 끊지 않습니다).

**인증**: 클릭투콜과 동일(게이트웨이 JWT/API 키 + `?tenantId=`, 또는 모바일 토큰).
모바일은 `caller == 본인 내선` 강제.

**응답 코드:**

| 코드 | 의미 | 앱 처리 |
|:----:|------|---------|
| `200` | 취소 성공(양쪽 종료) → `{ok, cancelled, hungUp, linkedids, source}` (`source` = `actionID` \| `seat-leg`) | 취소됨 |
| `400` | `actionID` 도 없고 `caller`/`callee` 도 누락 | — |
| `403` | 권한(`not_owner` / `no_extension`) | — |
| `409` | 진행 중 발신 없음(이미 응답/종료·미발신) — `no_active_originate` | "이미 연결됐을 수 있어요" (⚠️ **404 아님** — 404 를 "미지원"으로 해석하지 마세요) |
| `501` | 이 게이트웨이에서 미지원 — `not_implemented` | "미지원" (운영사에 문의) |
| `502` | 일시 오류 — `ami_error` | 잠시 후 재시도 |

> **한계**: 취소는 발신 후 짧은 시간(현재 60초) 이내, 통화가 아직 살아 있을 때만 동작합니다.
> 착신이 응답을 완료한 통화는 일반 통화이므로 취소 대신 통상 종료(hangup) 흐름을 사용하세요.

### 6.4 클릭투콜 linkedid 조회

```bash
GET /api/v1/pbx/click-to-call/{actionID}
```

클릭투콜 응답의 `actionID` 로 그 통화의 `linkedid` 를 조회합니다(CDR·녹취 조회에 사용).
admin 토큰은 `?tenantId=` 필요, 테넌트/모바일 토큰은 자동. 모바일은 본인 발신만 조회됩니다.

| 코드 | 응답 |
|:----:|------|
| `200` | `{"actionID":"…","linkedid":"…","ready":true}` |
| `202` | `{"actionID":"…","linkedid":"","ready":false}` — 아직 확보 전, 잠시 후 재조회 |
| `404` | `unknown_action` — 모르는 actionID 또는 만료(남의 발신도 404) |

---

## 7. 아웃바운드 캠페인

예약 발신, 동보(대량) 발신, 주기적 발신을 지원하는 캠페인 시스템입니다.

### 캠페인 타입

| 타입 | 설명 | 스케줄 | 대상 |
|:----:|------|--------|------|
| **scheduled** | 예약 발신 | 특정 일시에 1회 실행 | 1명 이상 |
| **bulk** | 동보(대량) 발신 | 즉시 또는 예약 시각에 실행 | 다수 (동시성 제어) |
| **recurring** | 주기적 발신 | cron 또는 interval 반복 | 1명 이상 |

### 캠페인 상태

| 상태 | 설명 |
|:----:|------|
| `pending` | 생성됨, 스케줄 대기 중 |
| `running` | 발신 진행 중 |
| `paused` | 일시 정지 |
| `completed` | 모든 발신 완료 |
| `cancelled` | 수동 취소 |
| `failed` | 실행 실패 |

### 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|:------:|:-----|:-----|
| `GET` | `/api/v1/pbx/campaigns` | 캠페인 목록 |
| `POST` | `/api/v1/pbx/campaigns` | 캠페인 생성 |
| `GET` | `/api/v1/pbx/campaigns/{id}` | 캠페인 상세 |
| `PUT` | `/api/v1/pbx/campaigns/{id}` | 캠페인 수정 |
| `DELETE` | `/api/v1/pbx/campaigns/{id}` | 캠페인 삭제 |
| `POST` | `/api/v1/pbx/campaigns/{id}/start` | 수동 시작 |
| `POST` | `/api/v1/pbx/campaigns/{id}/pause` | 일시 정지 |
| `POST` | `/api/v1/pbx/campaigns/{id}/resume` | 재개 |
| `POST` | `/api/v1/pbx/campaigns/{id}/cancel` | 취소 |
| `GET` | `/api/v1/pbx/campaigns/{id}/results` | 발신 결과 |

> 🔐 **관리자 JWT 전용** — 테넌트 토큰은 `403 admin_required`. 액션 경로는 표의 메서드만
> 받습니다(그 밖은 `405 method_not_allowed`).

### 7.1 예약 발신 (Scheduled)

특정 시간에 1건 이상의 전화를 발신합니다.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/pbx/campaigns \
  -d '{
    "name": "3월 30일 고객 안내 전화",
    "type": "scheduled",
    "caller": "12345601",
    "cidName": "Example",
    "cidNumber": "07012345601",
    "schedule": {
      "type": "once",
      "at": "2026-03-30T14:00:00+09:00",
      "timezone": "Asia/Seoul"
    },
    "targets": [
      {"callee": "01012345678", "customValue1": "홍길동"}
    ]
  }'
```

**응답:**
```json
{
  "id": "a1b2c3d4",
  "name": "3월 30일 고객 안내 전화",
  "type": "scheduled",
  "status": "pending",
  "schedule": {"type": "once", "at": "2026-03-30T14:00:00+09:00"},
  "targets": [{"callee": "01012345678", "customValue1": "홍길동"}]
}
```

### 7.2 동보(대량) 발신 (Bulk)

여러 번호에 동시/순차적으로 전화를 발신합니다.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/pbx/campaigns \
  -d '{
    "name": "3월 해피콜 캠페인",
    "type": "bulk",
    "caller": "12345601",
    "cidName": "Example 해피콜",
    "cidNumber": "07012345601",
    "schedule": {
      "type": "once",
      "at": "2026-03-31T09:00:00+09:00",
      "timeWindow": {"start": "09:00", "end": "18:00"},
      "timezone": "Asia/Seoul"
    },
    "bulk": {
      "concurrency": 5,
      "intervalSec": 3,
      "retryCount": 2,
      "retryDelaySec": 300
    },
    "targets": [
      {"callee": "01012345678", "customValue1": "홍길동", "customValue2": "ORD-001"},
      {"callee": "01098765432", "customValue1": "김철수", "customValue2": "ORD-002"},
      {"callee": "01055551234", "customValue1": "이영희", "customValue2": "ORD-003"}
    ]
  }'
```

**대량 발신 설정 (bulk):**

| 필드 | 기본값 | 설명 |
|------|:------:|------|
| `concurrency` | 1 | 동시 발신 채널 수 (최대 동시 통화 수) |
| `intervalSec` | 3 | 건별 발신 간격 (초) |
| `retryCount` | 0 | 실패 시 재시도 횟수 |
| `retryDelaySec` | 300 | 재시도 대기 시간 (초, 기본 5분) |

### 7.3 주기적 발신 (Recurring)

cron 표현식 또는 간격(interval)으로 반복 발신합니다.

#### cron 방식 (매주 월요일 09:00)

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/pbx/campaigns \
  -d '{
    "name": "주간 해피콜",
    "type": "recurring",
    "caller": "12345601",
    "cidName": "Example",
    "cidNumber": "07012345601",
    "schedule": {
      "type": "cron",
      "cron": "0 9 * * 1",
      "startDate": "2026-04-01",
      "endDate": "2026-12-31",
      "timeWindow": {"start": "09:00", "end": "18:00"},
      "timezone": "Asia/Seoul"
    },
    "bulk": {
      "concurrency": 3,
      "intervalSec": 5
    },
    "targets": [
      {"callee": "01012345678", "customValue1": "홍길동"},
      {"callee": "01098765432", "customValue1": "김철수"}
    ]
  }'
```

**cron 표현식 형식:** `분 시 일 월 요일`

| 표현식 | 의미 |
|--------|------|
| `0 9 * * 1` | 매주 월요일 09:00 |
| `0 9 * * 1-5` | 매주 월~금 09:00 |
| `0 9,14 * * *` | 매일 09:00, 14:00 |
| `*/30 * * * *` | 30분마다 |
| `0 9 1 * *` | 매월 1일 09:00 |

#### interval 방식 (24시간마다)

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/pbx/campaigns \
  -d '{
    "name": "일일 리마인더",
    "type": "recurring",
    "caller": "12345601",
    "schedule": {
      "type": "interval",
      "interval": "24h",
      "startDate": "2026-04-01",
      "endDate": "2026-06-30",
      "timeWindow": {"start": "10:00", "end": "17:00"},
      "timezone": "Asia/Seoul"
    },
    "targets": [
      {"callee": "01012345678"}
    ]
  }'
```

**interval 형식:** 기간 문자열 (예: `30m`, `1h`, `24h`, `168h`)

### 7.4 스케줄 설정 상세

| 필드 | 타입 | 설명 |
|------|------|------|
| `schedule.type` | string | `once` (1회), `cron` (크론), `interval` (간격) |
| `schedule.at` | string | 실행 시각 (ISO 8601, 예: `2026-03-30T14:00:00+09:00`) |
| `schedule.cron` | string | cron 표현식 (예: `0 9 * * 1`) |
| `schedule.interval` | string | 반복 간격 (예: `24h`, `30m`) |
| `schedule.startDate` | string | 시작일 (YYYY-MM-DD) |
| `schedule.endDate` | string | 종료일 (YYYY-MM-DD, 초과 시 자동 완료) |
| `schedule.timeWindow.start` | string | 발신 허용 시작 시각 (HH:MM) |
| `schedule.timeWindow.end` | string | 발신 허용 종료 시각 (HH:MM) |
| `schedule.timezone` | string | 시간대 (기본: `Asia/Seoul`) |

> **시간 창(timeWindow):** 설정하면 해당 시간대 밖에서는 발신하지 않습니다.
> 예: `09:00~18:00` → 야간 발신 방지

### 7.5 캠페인 제어

```bash
# 수동 시작 (스케줄 무시하고 즉시 실행)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/pbx/campaigns/a1b2c3d4/start

# 일시 정지
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/pbx/campaigns/a1b2c3d4/pause

# 재개 (status를 pending으로 복원 → 스케줄에 따라 다시 실행)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/pbx/campaigns/a1b2c3d4/resume

# 취소 (진행 중인 발신 중단)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/pbx/campaigns/a1b2c3d4/cancel
```

### 7.6 발신 결과 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/pbx/campaigns/a1b2c3d4/results
```

**응답:**
```json
{
  "id": "a1b2c3d4",
  "count": 3,
  "results": [
    {"callee": "01012345678", "status": "success", "attempt": 1, "calledAt": "2026-03-30T14:00:01+09:00"},
    {"callee": "01098765432", "status": "failed", "attempt": 3, "error": "PBX API error HTTP 503", "calledAt": "2026-03-30T14:00:15+09:00"},
    {"callee": "01055551234", "status": "success", "attempt": 1, "calledAt": "2026-03-30T14:00:05+09:00"}
  ]
}
```

**result.status 값:**

| 상태 | 설명 |
|:----:|------|
| `success` | 발신 성공 |
| `failed` | 모든 재시도 실패 |
| `pending` | 아직 발신 안 됨 |
| `skipped` | 캠페인 취소로 건너뜀 |

### 7.7 캠페인 수정/삭제

```bash
# 수정 (대상 추가, 스케줄 변경 등)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/pbx/campaigns/a1b2c3d4 \
  -d '{"name": "수정된 캠페인명", "targets": [{"callee": "01099998888"}]}'

# 삭제 (실행 중이면 먼저 cancel 필요)
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/pbx/campaigns/a1b2c3d4
```

### 7.8 대상(Target) 구조

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `callee` | string | O | 수신 전화번호 |
| `customValue1` | string | - | 커스텀 변수 1 (예: 고객명) |
| `customValue2` | string | - | 커스텀 변수 2 (예: 주문번호) |
| `customValue3` | string | - | 커스텀 변수 3 (예: 용도) |

> 대상별 `customValue`가 설정되면 캠페인 글로벌 `variables`보다 우선 적용됩니다.

---

## 8. 에러 응답 레퍼런스

| HTTP 코드 | 원인 | 예시 응답 |
|:---------:|------|----------|
| 400 | 잘못된 요청 | `{"error":"caller and callee required"}` |
| 400 | 잘못된 착신전환 타입 | `{"error":"invalid forwarding type","supportedTypes":"CFI, CFB, CFN, CFU, DND, PEA"}` |
| 401 | 인증 실패 | `{"error":"authentication required"}` |
| 403 | 권한 부족 | `{"error":"admin access required"}` |
| 404 | 데이터 없음 | `{"error":"extension not found"}` |
| 409 | 중복 / 모호 | `{"error":"app key already exists for this DID"}` |
| 412 | 사전 설정 없음 (예: 클릭투콜 발신 기본값 미등록) | 운영사에 요청하세요 |
| 429 | 요청 한도 초과 | `{"code":"cost_rate_limited", …}` |
| 503 | 기능 미구성 / 일시적으로 사용할 수 없음 | 운영사에 문의하세요 |
