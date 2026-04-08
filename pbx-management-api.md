# DVGateway PBX 관리 API 가이드

> DVGateway REST API를 통해 Dynamic VoIP PBX의 착신전환, 발신자표시, API 키, 외부 DB, 아웃바운드 캠페인을 관리합니다.

---

## 목차

1. [인증](#1-인증)
2. [착신전환 (Diversions)](#2-착신전환-diversions)
3. [발신자표시 (Caller ID)](#3-발신자표시-caller-id)
4. [API 키 관리 (App Keys)](#4-api-키-관리-app-keys)
5. [외부 DB 프록시](#5-외부-db-프록시)
6. [Early Media (응답 전 안내음)](#6-early-media-응답-전-안내음)
7. [PBX API 연동](#7-pbx-api-연동)
8. [아웃바운드 캠페인 (예약/동보/주기 발신)](#8-아웃바운드-캠페인)
9. [게이트웨이 설정](#9-게이트웨이-설정)
10. [에러 응답 레퍼런스](#10-에러-응답-레퍼런스)

### 단말번호 ↔ DID 번호 관계

```
DID 번호 = "070" + 단말번호
예: 단말번호 45144801 → DID 07045144801
```

---

## 1. 인증

모든 요청에 JWT 토큰이 필요합니다.

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
| API 키 | ✅ | ✅ |
| 외부 DB 프록시 | - | ✅ (Admin만) |
| DB 설정 | - | ✅ (Admin만) |

---

## 2. 착신전환 (Diversions)

Dynamic VoIP AstDB의 착신전환 설정을 관리합니다.

### 착신전환 타입

| 약어 | 전체 명칭 | 한글명 | 설명 | 적용 조건 |
|:----:|:----------|:------:|:-----|:----------|
| **CFI** | CallForwardImmediately | 즉시 착신전환 | 무조건 착신전환 | 즉시 |
| **CFB** | CallForwardBusy | 통화중 착신전환 | 통화중이면 착신전환 | 통화중일 때 |
| **CFN** | CallForwardNoanswer | 부재중 착신전환 | 일정시간 미응답 시 착신전환 | 미응답 시 |
| **CFU** | CallForwardUnavailable | 미연결 착신전환 | 단말기 미등록 시 착신전환 | 단말기 오프라인 |

> 각 타입은 **독립적으로 설정 가능**하며, 동시에 여러 타입을 활성화할 수 있습니다.

### ⚠️ 활성화 필수 조건

착신전환이 실제로 동작하려면 **두 가지 조건**을 모두 충족해야 합니다:

1. `enable` 값이 **`yes`** 이어야 함
2. `destination`에 **착신번호**가 설정되어야 함

> 둘 중 하나라도 누락되면 착신전환이 동작하지 않습니다.

### AstDB 저장 구조

```
/{tenantId}/diversions/{단말번호}/{타입}/enable       → yes | no
/{tenantId}/diversions/{단말번호}/{타입}/destination   → sub-custom-numbers,{전화번호},1
/{tenantId}/diversions/{단말번호}/{타입}/time_group    → (시간 조건 그룹)
```

### 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|:------:|:-----|:-----|
| `GET` | `/api/v1/diversions` | 전체 내선 착신전환 현황 |
| `GET` | `/api/v1/diversions/{단말번호}` | 특정 내선 전체 규칙 (CFI/CFB/CFN/CFU) |
| `GET` | `/api/v1/diversions/{단말번호}/{타입}` | 특정 착신전환 타입 조회 |
| `PUT` | `/api/v1/diversions/{단말번호}/{타입}` | 착신전환 설정 |
| `DELETE` | `/api/v1/diversions/{단말번호}/{타입}` | 착신전환 해제 |

### 2.1 전체 내선 현황 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/diversions
```

**응답:**
```json
{
  "tenantId": "bdd23e154a7ea1c8",
  "extensions": [
    {
      "extension": "45144801",
      "did": "07045144801",
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

### 2.2 특정 내선 전체 규칙 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/diversions/45144801
```

**응답:**
```json
{
  "tenantId": "bdd23e154a7ea1c8",
  "extension": "45144801",
  "did": "07045144801",
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
  http://localhost:8080/api/v1/diversions/45144801/CFI \
  -d '{"enable":"yes","destination":"01012345678"}'

# CFB 통화중 착신전환 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/diversions/45144801/CFB \
  -d '{"enable":"yes","destination":"07045144802"}'

# CFN 부재중 착신전환 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/diversions/45144801/CFN \
  -d '{"enable":"yes","destination":"01098765432"}'

# CFU 미연결 착신전환 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/diversions/45144801/CFU \
  -d '{"enable":"yes","destination":"01098765432"}'
```

**PUT Body:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `enable` | string | - | `"yes"` 또는 `"no"` |
| `destination` | string | - | 착신번호 (전화번호) |
| `timeGroup` | string | - | 시간 조건 그룹 (선택) |

> `enable`만 보내면 번호는 유지, `destination`만 보내면 활성화 상태는 유지됩니다.

**응답:**
```json
{
  "ok": true,
  "tenantId": "bdd23e154a7ea1c8",
  "extension": "45144801",
  "did": "07045144801",
  "rule": {
    "type": "CFI",
    "enable": "yes",
    "destination": "01012345678",
    "rawDestination": "sub-custom-numbers,01012345678,1"
  }
}
```

### 2.4 착신전환 비활성화 (번호 유지)

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/diversions/45144801/CFI \
  -d '{"enable":"no"}'
```

### 2.5 착신전환 해제 (DELETE — 번호까지 삭제)

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/diversions/45144801/CFI
```

**응답:**
```json
{
  "ok": true,
  "tenantId": "bdd23e154a7ea1c8",
  "extension": "45144801",
  "type": "CFI",
  "action": "disabled"
}
```

---

## 3. 발신자표시 (Caller ID)

Dynamic VoIP PBX의 내선별 발신자표시(CID)를 관리합니다.

### CID 형식

```
"발신자이름" <발신자번호>

예: "OLSSOO Inc." <16682471>
예: "07045144800" <07045144800>
```

### 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|:------:|:-----|:-----|
| `GET` | `/api/v1/callerid/{단말번호}` | 내부/외부 발신자표시 조회 |
| `PUT` | `/api/v1/callerid/{단말번호}` | 외부 발신자표시 변경 |

> `internal_cid`(내부발신자표시)는 **조회만** 가능합니다 (PBX 관리).
> `external_cid`(외부발신자표시)는 **조회 + 변경** 가능합니다.

### 3.1 발신자표시 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/callerid/45144800
```

**응답:**
```json
{
  "extension": "45144800",
  "did": "07045144800",
  "name": "07045144800",
  "internalCid": {
    "name": "07045144800",
    "number": "45144800",
    "raw": "\"07045144800\" <45144800>"
  },
  "externalCid": {
    "name": "07045144800",
    "number": "07045144800",
    "raw": "\"07045144800\" <07045144800>"
  }
}
```

### 3.2 외부 발신자표시 변경

> ⚠️ **중요:** 발신자 정보 변경 후 PBX에 반영하려면 **설정 재적용(apply_changes)**이 필요합니다.
> `"applyChanges": true`를 포함하면 DB 변경 + 설정 재적용이 **한번의 호출로** 처리됩니다.

**이름만 변경 + 즉시 적용:**
```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/callerid/45144800 \
  -d '{"name":"홍길동","applyChanges":true}'
```
→ `external_cid = "홍길동" <07045144800>` + PBX 설정 재적용

**번호만 변경 + 즉시 적용:**
```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/callerid/45144800 \
  -d '{"number":"0212345678","applyChanges":true}'
```
→ `external_cid = "07045144800" <0212345678>` + PBX 설정 재적용

**이름 + 번호 동시 변경 + 즉시 적용:**
```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/callerid/45144800 \
  -d '{"name":"OLSSOO Inc.","number":"16682471","applyChanges":true}'
```
→ `external_cid = "OLSSOO Inc." <16682471>` + PBX 설정 재적용

**DB만 변경 (적용 보류):**
```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/callerid/45144800 \
  -d '{"name":"홍길동"}'
```
→ DB만 변경, PBX에는 미반영 (별도 `POST /api/v1/pbx/apply-changes` 필요)

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
  "extension": "45144800",
  "did": "07045144800",
  "externalCid": {
    "name": "OLSSOO Inc.",
    "number": "16682471",
    "raw": "\"OLSSOO Inc.\" <16682471>"
  },
  "applied": true
}
```

---

## 4. API 키 관리 (App Keys)

Dynamic VoIP PBX의 단말별 API 인증 키(`ombu_app_keys` 테이블)를 관리합니다.

### 테이블 구조

```sql
CREATE TABLE ombu_app_keys (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  description VARCHAR(255) NOT NULL,    -- DID 번호 (070 + 단말번호)
  `key`       VARCHAR(255) NOT NULL,    -- MD5 해시 (32자리 hex)
  tenant      INT UNSIGNED DEFAULT 1,
  enabled     ENUM('yes','no') DEFAULT 'yes',
  tenant_id   INT UNSIGNED DEFAULT 1
);
```

### 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|:------:|:-----|:-----|
| `GET` | `/api/v1/appkeys` | 전체 키 목록 |
| `GET` | `/api/v1/appkeys/{DID}` | DID로 키 조회 |
| `POST` | `/api/v1/appkeys` | 키 생성 (MD5 자동 생성) |
| `PUT` | `/api/v1/appkeys/{DID}` | 활성화/비활성화, 키 재생성 |
| `DELETE` | `/api/v1/appkeys/{DID}` | 키 삭제 |

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
    {"id": 1, "description": "07045144801", "key": "6eee820f89e769967beec99a7b6d8281", "tenant": 1, "enabled": "yes", "tenant_id": 1},
    {"id": 2, "description": "07045144800", "key": "3fc99c88ed6fd288d5ec3340921feeec", "tenant": 1, "enabled": "yes", "tenant_id": 1}
  ],
  "count": 2
}
```

### 4.2 DID로 키 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/appkeys/07045144801
```

**응답:**
```json
{
  "id": 1,
  "description": "07045144801",
  "key": "6eee820f89e769967beec99a7b6d8281",
  "tenant": 1,
  "enabled": "yes",
  "tenant_id": 1
}
```

### 4.3 키 생성

DID 번호 또는 단말번호로 생성합니다. MD5 해시 키가 자동 생성되며, 중복 체크를 수행합니다.

```bash
# DID 번호로 생성
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/appkeys \
  -d '{"did":"07045144803"}'

# 단말번호로 생성 (070 자동 추가)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/appkeys \
  -d '{"extension":"45144803"}'
```

**POST Body:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `did` | string | O* | DID 번호 (예: `07045144803`) |
| `extension` | string | O* | 단말번호 (예: `45144803`, 자동으로 `070` 추가) |

> `did` 또는 `extension` 중 하나 필수. 이미 존재하면 409 Conflict.

**응답:**
```json
{
  "ok": true,
  "did": "07045144803",
  "key": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
}
```

### 4.4 활성화/비활성화 및 키 재생성

```bash
# 비활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/appkeys/07045144801 \
  -d '{"enabled":"no"}'

# 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/appkeys/07045144801 \
  -d '{"enabled":"yes"}'

# 키 재생성 (새 MD5 해시 발급)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/appkeys/07045144801 \
  -d '{"regenerateKey":true}'

# 비활성화 + 키 재생성 동시
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/appkeys/07045144801 \
  -d '{"enabled":"no","regenerateKey":true}'
```

**PUT Body:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `enabled` | string | - | `"yes"` 또는 `"no"` |
| `regenerateKey` | bool | - | `true`면 새 MD5 키 생성 |

**응답:**
```json
{
  "ok": true,
  "did": "07045144801",
  "enabled": "no",
  "key": "f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6"
}
```

### 4.5 키 삭제

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/appkeys/07045144803
```

---

## 5. 외부 DB 프록시

DVGateway를 통해 로컬 MySQL/PostgreSQL 데이터베이스에 직접 CRUD 작업을 수행합니다.
**Admin 전용** 엔드포인트입니다.

### 엔드포인트 목록

| 메서드 | 경로 | 설명 |
|:------:|:-----|:-----|
| `GET` | `/api/v1/db/ping` | DB 연결 테스트 |
| `POST` | `/api/v1/db/query` | SELECT 조회 |
| `POST` | `/api/v1/db/insert` | INSERT 삽입 |
| `POST` | `/api/v1/db/update` | UPDATE 수정 (WHERE 필수) |

### 5.1 DB 연결 테스트

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/db/ping
```

**응답:**
```json
{"ok": true, "driver": "mysql"}
```

### 5.2 데이터 조회 (SELECT)

```bash
# 단말번호로 조회
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/db/query \
  -d '{
    "table": "ombu_extensions",
    "where": {"extension": "45144801"},
    "limit": 10
  }'

# 전체 조회 (WHERE 없이)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/db/query \
  -d '{"table": "ombu_app_keys", "orderBy": "id", "limit": 100}'

# 조건부 조회
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/db/query \
  -d '{
    "table": "ombu_app_keys",
    "where": {"enabled": "yes", "tenant_id": "1"},
    "orderBy": "description",
    "limit": 50
  }'
```

**POST Body:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `table` | string | O | 테이블명 |
| `where` | object | - | WHERE 조건 (컬럼: 값) |
| `orderBy` | string | - | 정렬 컬럼명 |
| `limit` | int | - | 최대 행 수 (기본 100, 최대 1000) |

**응답:**
```json
{
  "columns": ["id", "description", "key", "tenant", "enabled", "tenant_id"],
  "rows": [
    {"id": 1, "description": "07045144801", "key": "6eee820f...", "tenant": 1, "enabled": "yes", "tenant_id": 1}
  ],
  "count": 1
}
```

### 5.3 데이터 삽입 (INSERT)

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/db/insert \
  -d '{
    "table": "ombu_app_keys",
    "data": {
      "description": "07045144805",
      "key": "abcdef1234567890abcdef1234567890",
      "tenant": "1",
      "enabled": "yes",
      "tenant_id": "1"
    }
  }'
```

**POST Body:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `table` | string | O | 테이블명 |
| `data` | object | O | 삽입할 데이터 (컬럼: 값) |

### 5.4 데이터 수정 (UPDATE)

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/db/update \
  -d '{
    "table": "ombu_app_keys",
    "set": {"enabled": "no"},
    "where": {"description": "07045144805"}
  }'
```

**POST Body:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `table` | string | O | 테이블명 |
| `set` | object | O | 변경할 데이터 (컬럼: 값) |
| `where` | object | O | WHERE 조건 (**필수** — 전체 업데이트 차단) |

> ⚠️ `where`는 반드시 지정해야 합니다. 전체 테이블 UPDATE는 보안상 차단됩니다.

---

## 6. Early Media (응답 전 안내음)

전화 응답(Answer) 전에 183 Session Progress로 안내음을 재생합니다.
DID별로 활성화/비활성화 및 음원 URL을 관리합니다.

### 동작 원리

```
전화 수신 → 다이얼플랜 → Progress() (183 SDP) → Playback(pamsg) → Answer() → Stasis(dvgateway)
                                                   ↑ 응답 전 안내음                    ↑ AI 봇 연결
```

음원 파일 저장 경로: `/var/spool/asterisk/{PBX_API_TENANT_ID}/pa/{extension}/pamsg.wav`

### 엔드포인트

| 메서드 | 경로 | 설명 |
|:------:|:-----|:-----|
| `GET` | `/api/v1/earlymedia/{extension}` | Early Media 설정 조회 |
| `PUT` | `/api/v1/earlymedia/{extension}` | Early Media 설정/변경 |

### 6.1 Early Media 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/v1/earlymedia/07045144801?tenantId=7be69580e27641df"
```

**응답:**
```json
{
  "extension": "07045144801",
  "did": "07007045144801",
  "enabled": "yes",
  "audioUrl": "https://www.makecall.io/demo-echotest.mp3",
  "source": "url",
  "ttsText": "",
  "ttsProvider": "",
  "ttsVoice": "",
  "localPath": "/var/spool/asterisk/7be69580e27641df/pa/07045144801/pamsg.wav",
  "fileExists": true
}
```

`source` 필드는 음원의 출처를 나타냅니다:
- `"url"` — 외부 URL에서 다운로드
- `"tts"` — 클라우드 TTS로 합성

### 6.2 Early Media 설정 (음원 URL + 활성화)

음원 URL을 설정하면 **자동으로 다운로드 + WAV 변환**됩니다 (MP3, OGG, FLAC 등 모든 형식 지원).

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07045144801?tenantId=7be69580e27641df" \
  -d '{"enabled":"yes","audioUrl":"https://www.makecall.io/demo-echotest.mp3"}'
```

**응답:**
```json
{
  "ok": true,
  "extension": "07045144801",
  "did": "07007045144801",
  "enabled": "yes",
  "audioUrl": "https://www.makecall.io/demo-echotest.mp3",
  "source": "url",
  "downloaded": true
}
```

**PUT Body:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `enabled` | string | - | `"yes"` 또는 `"no"` |
| `audioUrl` | string | - | 음원 URL (mp3/wav/ogg/flac — 8kHz mono WAV로 자동 변환) |
| `tts` | object | - | TTS 합성 (아래 6.5 참고). `audioUrl`과 동시 사용 불가 |

### 6.3 Early Media 활성화/비활성화만 변경

음원은 유지하고 활성화 상태만 변경:

```bash
# 비활성화 (음원 유지)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07045144801?tenantId=7be69580e27641df" \
  -d '{"enabled":"no"}'

# 다시 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07045144801?tenantId=7be69580e27641df" \
  -d '{"enabled":"yes"}'
```

### 6.4 음원만 변경

활성화 상태는 유지하고 음원만 교체:

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07045144801?tenantId=7be69580e27641df" \
  -d '{"audioUrl":"https://cdn.example.com/new-greeting.mp3"}'
```

### 6.5 TTS 합성으로 Early Media 설정

텍스트만 보내면 클라우드 TTS로 합성된 음성이 Early Media로 등록됩니다. 음원 파일을 따로 준비할 필요가 없습니다.

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07045144801?tenantId=7be69580e27641df" \
  -d '{
    "enabled": "yes",
    "tts": {
      "text": "안녕하세요, 얼쑤팩토리입니다. 잠시만 기다려주세요.",
      "provider": "elevenlabs"
    }
  }'
```

**응답:**
```json
{
  "ok": true,
  "extension": "07045144801",
  "did": "07007045144801",
  "enabled": "yes",
  "source": "tts",
  "synthesized": true,
  "ttsProvider": "elevenlabs",
  "ttsVoice": "9BWtsMINqrJLrRacOk9x"
}
```

**TTS 객체 필드:**

| 필드 | 타입 | 필수 | 설명 |
|------|:----:|:----:|------|
| `text` | string | ✅ | 합성할 텍스트 |
| `provider` | string | - | `google` / `openai` / `elevenlabs` / `azure` / `aws` / `gemini` / `cosyvoice` / `qwen`. 미지정 시 대시보드의 primary 프로바이더 사용 |
| `voice` | string | - | 음성 ID. 미지정 시 대시보드 설정 또는 프로바이더 기본값 사용 |

**중요:**
- API 키는 본 요청에 포함하지 않습니다. 대시보드 **프로바이더 API 키** 탭에서 테넌트별로 사전 등록된 키가 자동 사용됩니다.
- `audioUrl`과 `tts`는 **동시 사용 불가**입니다. 하나만 선택하세요.
- 합성된 음성은 자동으로 8kHz mono WAV로 변환되어 동일한 경로(`pamsg.wav`)에 저장됩니다.
- TTS 메타데이터(`text`, `provider`, `voice`)는 AstDB에 저장되어 GET 응답과 재합성에 활용됩니다.

**대시보드에서 TTS 키 사전 등록:**

1. 대시보드 → **⚙ Dynamic VoIP 설정** → **🔑 프로바이더 API 키** 탭
2. **TTS (Text-to-Speech)** 섹션에서 사용할 프로바이더 활성화 + API 키 입력
3. **1순위 사용**으로 설정하면 `provider` 미지정 시 자동 선택됨

### SDK 사용법

**TypeScript:**
```typescript
// 조회
const config = await gw.getEarlyMedia('07045144801', 'tenant-id');
console.log(config);
// { enabled: "yes", audioUrl: "https://...", source: "url", fileExists: true }

// 음원 URL + 활성화 설정
await gw.setEarlyMedia('07045144801', {
  enabled: 'yes',
  audioUrl: 'https://www.makecall.io/demo-echotest.mp3',
}, 'tenant-id');

// TTS로 설정 (대시보드 프로바이더 키 사용)
await gw.setEarlyMedia('07045144801', {
  enabled: 'yes',
  tts: {
    text: '안녕하세요, 얼쑤팩토리입니다. 잠시만 기다려주세요.',
    provider: 'elevenlabs',  // optional
  },
}, 'tenant-id');

// 비활성화만 (음원 유지)
await gw.setEarlyMedia('07045144801', { enabled: 'no' }, 'tenant-id');

// 다시 활성화
await gw.setEarlyMedia('07045144801', { enabled: 'yes' }, 'tenant-id');

// 음원만 교체
await gw.setEarlyMedia('07045144801', {
  audioUrl: 'https://cdn.example.com/new-greeting.mp3',
}, 'tenant-id');
```

**Python:**
```python
# 조회
config = await gw.get_early_media("07045144801", tenant_id="tenant-id")

# 음원 URL + 활성화 설정
await gw.set_early_media("07045144801",
    enabled="yes",
    audio_url="https://www.makecall.io/demo-echotest.mp3",
    tenant_id="tenant-id")

# TTS로 설정
await gw.set_early_media("07045144801",
    enabled="yes",
    tts={
        "text": "안녕하세요, 얼쑤팩토리입니다. 잠시만 기다려주세요.",
        "provider": "elevenlabs",  # optional
    },
    tenant_id="tenant-id")

# 비활성화만 (음원 유지)
await gw.set_early_media("07045144801", enabled="no", tenant_id="tenant-id")

# 다시 활성화
await gw.set_early_media("07045144801", enabled="yes", tenant_id="tenant-id")

# 음원만 교체
await gw.set_early_media("07045144801",
    audio_url="https://cdn.example.com/new-greeting.mp3",
    tenant_id="tenant-id")
```

### AstDB 저장 구조

```
/{tenantId}/earlymedia/{extension}/enabled       → yes | no
/{tenantId}/earlymedia/{extension}/audio_url     → https://... (url 모드)
/{tenantId}/earlymedia/{extension}/source        → url | tts
/{tenantId}/earlymedia/{extension}/tts_text      → 합성된 텍스트 (tts 모드)
/{tenantId}/earlymedia/{extension}/tts_provider  → elevenlabs/openai/google/... (tts 모드)
/{tenantId}/earlymedia/{extension}/tts_voice     → 사용된 voice ID (tts 모드)
```

### 음원 파일 변환

| 입력 형식 | 출력 형식 | 변환 도구 |
|----------|----------|----------|
| MP3, OGG, FLAC, AAC, WAV 등 | 8kHz, mono, 16-bit PCM WAV | ffmpeg |

> Asterisk `Playback()`은 8kHz mono WAV만 지원합니다.
> DVGateway API가 **어떤 형식이든 자동으로 Asterisk 호환 WAV로 변환**합니다.

---

## 7. PBX API 연동

PBX API를 통해 설정 재적용 및 클릭투콜 기능을 제공합니다.

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

PBX API를 통해 아웃바운드 통화를 발신합니다.

```bash
POST /api/v1/pbx/click-to-call
```

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/pbx/click-to-call \
  -d '{
    "caller": "45144801",
    "callee": "01012345678",
    "cidName": "OLSSOO",
    "cidNumber": "07045144801",
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
| `customValue1~3` | string | - | 커스텀 변수 (다이얼플랜 전달) |

---

## 8. 아웃바운드 캠페인

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

### 7.1 예약 발신 (Scheduled)

특정 시간에 1건 이상의 전화를 발신합니다.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/pbx/campaigns \
  -d '{
    "name": "3월 30일 고객 안내 전화",
    "type": "scheduled",
    "caller": "45144801",
    "cidName": "OLSSOO",
    "cidNumber": "07045144801",
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
    "caller": "45144801",
    "cidName": "OLSSOO 해피콜",
    "cidNumber": "07045144801",
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
    "caller": "45144801",
    "cidName": "OLSSOO",
    "cidNumber": "07045144801",
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
    "caller": "45144801",
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

**interval 형식:** Go duration (예: `30m`, `1h`, `24h`, `168h`)

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
> 예: `09:00~18:00` → 야간/공휴일 발신 방지

### 7.5 캠페인 제어

```bash
# 수동 시작 (스케줄 무시하고 즉시 실행)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/pbx/campaigns/a1b2c3d4/start

# 일시 정지
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/pbx/campaigns/a1b2c3d4/pause

# 재개 (status를 pending으로 복원 → 스케줄러가 재트리거)
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
| `success` | 발신 성공 (PBX API 200 응답) |
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

## 9. 게이트웨이 설정

대시보드 관리 화면 (게이트웨이 설정)에서 DB 접속 정보를 설정합니다.

| 환경변수 | 기본값 | 설명 |
|----------|--------|------|
| `EXT_DB_DRIVER` | (빈값) | `mysql` 또는 `postgres` (빈값 = 비활성화) |
| `EXT_DB_HOST` | `127.0.0.1` | DB 호스트 |
| `EXT_DB_PORT` | `3306` | DB 포트 |
| `EXT_DB_USER` | `dipcast` | DB 사용자 |
| `EXT_DB_PASS` | `dipcast5k1!` | DB 비밀번호 |
| `EXT_DB_NAME` | `ombutel` | DB 이름 |

**활성화 방법:**

1. 대시보드 → 게이트웨이 설정 → `EXT_DB_DRIVER`를 `mysql`로 설정
2. 서비스 재시작: `systemctl restart dvgateway`
3. 연결 테스트: `GET /api/v1/db/ping`

**또는 환경변수 직접 설정:**
```bash
# /etc/dvgateway/env
EXT_DB_DRIVER=mysql
EXT_DB_HOST=127.0.0.1
EXT_DB_PORT=3306
EXT_DB_USER=dipcast
EXT_DB_PASS=dipcast5k1!
EXT_DB_NAME=ombutel
```

---

## 10. 에러 응답 레퍼런스

| HTTP 코드 | 원인 | 예시 응답 |
|:---------:|------|----------|
| 400 | 잘못된 요청 | `{"error":"table name required"}` |
| 400 | 잘못된 착신전환 타입 | `{"error":"invalid forwarding type","supportedTypes":"CFI, CFB, CFN, CFU"}` |
| 400 | WHERE 누락 | `{"error":"where clause required (full-table update not allowed)"}` |
| 401 | 인증 실패 | `{"error":"authentication required"}` |
| 403 | 권한 부족 | `{"error":"admin access required"}` |
| 404 | 데이터 없음 | `{"error":"extension not found"}` |
| 409 | 중복 | `{"error":"app key already exists for this DID"}` |
| 503 | AMI/DB 미연결 | `{"error":"external database not configured"}` |

---

## AstDB 직접 확인 (서버 CLI)

```bash
# 전체 테넌트 착신전환 조회
asterisk -rx "database show bdd23e154a7ea1c8/diversions"

# 특정 내선 착신전환 조회
asterisk -rx "database show bdd23e154a7ea1c8/diversions/45144801"

# 특정 값 조회
asterisk -rx "database get bdd23e154a7ea1c8 diversions/45144801/CFI/enable"
```

## MariaDB 직접 확인 (서버 CLI)

```bash
# API 키 조회
mysql -u dipcast -p ombutel -e "SELECT * FROM ombu_app_keys"

# 발신자표시 조회
mysql -u dipcast -p ombutel -e "SELECT extension, name, internal_cid, external_cid FROM ombu_extensions WHERE extension = '45144800'"
```
