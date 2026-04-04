# DVGateway PBX API 퀵 매뉴얼

> 자주 사용하는 PBX 관리 API를 한 눈에 — 복사해서 바로 사용하세요.

---

## 사전 준비: 토큰 발급

```bash
# 토큰 발급 (이후 모든 요청에 사용)
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/token \
  -H "X-API-Key: $(cat /etc/dvgateway/api-key)" | jq -r '.token')
```

---

## 1. 착신전환

### 조회

```bash
# 내선 전체 규칙 조회 (CFI/CFB/CFN/CFU)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/v1/diversions/45144801?tenantId=YOUR_TENANT_ID"
```

### 설정

```bash
# 즉시 착신전환 (CFI) 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/diversions/45144801/CFI?tenantId=YOUR_TENANT_ID" \
  -d '{"enable":"yes","destination":"01012345678"}'

# 통화중 착신전환 (CFB) 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/diversions/45144801/CFB?tenantId=YOUR_TENANT_ID" \
  -d '{"enable":"yes","destination":"07045144802"}'

# 착신전환 비활성화 (번호 유지)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/diversions/45144801/CFI?tenantId=YOUR_TENANT_ID" \
  -d '{"enable":"no"}'

# 착신전환 완전 해제 (번호 삭제)
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/v1/diversions/45144801/CFI?tenantId=YOUR_TENANT_ID"
```

---

## 2. 발신자 정보 변경

### 조회

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/callerid/45144800
```

### 이름만 변경 + 즉시 적용

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/callerid/45144800 \
  -d '{"name":"홍길동","applyChanges":true}'
```

### 번호만 변경 + 즉시 적용

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/callerid/45144800 \
  -d '{"number":"0212345678","applyChanges":true}'
```

### 이름 + 번호 동시 변경 + 즉시 적용

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/callerid/45144800 \
  -d '{"name":"OLSSOO Inc.","number":"16682471","applyChanges":true}'
```

> **`"applyChanges":true`** 를 포함하면 DB 변경 후 PBX 설정 재적용이 자동 실행됩니다.
> 생략하면 DB만 변경되고, 별도로 설정 재적용을 호출해야 합니다.

---

## 3. 설정 재적용

```bash
# PBX 설정 변경사항을 시스템에 즉시 반영
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/v1/pbx/apply-changes
```

> 발신자 정보, 내선 설정 등 DB 변경 후 반드시 실행해야 시스템에 반영됩니다.
> CallerID API에서 `"applyChanges":true` 사용 시 자동 호출되므로 별도 실행 불필요합니다.

---

## 4. 클릭투콜

```bash
# 간단 발신
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/pbx/click-to-call \
  -d '{
    "caller": "45144801",
    "callee": "01012345678",
    "cidName": "OLSSOO",
    "cidNumber": "16682471",
  }'

# 발신자 정보 + 커스텀 변수 포함
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  http://localhost:8080/api/v1/pbx/click-to-call \
  -d '{
    "caller": "45144801",
    "callee": "01012345678",
    "cidName": "OLSSOO",
    "cidNumber": "16682471",
    "customValue1": "홍길동",
    "customValue2": "ORD-20260330-001",
    "customValue3": "해피콜"
  }'
```

---

## 5. Early Media (응답 전 안내음)

```bash
# 조회
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/v1/earlymedia/07045144801?tenantId=YOUR_TENANT_ID"

# 음원 URL + 활성화 (자동 WAV 변환)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07045144801?tenantId=YOUR_TENANT_ID" \
  -d '{"enabled":"yes","audioUrl":"https://www.makecall.io/greeting.mp3"}'

# 비활성화만 (음원 유지)
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07045144801?tenantId=YOUR_TENANT_ID" \
  -d '{"enabled":"no"}'

# 다시 활성화
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  "http://localhost:8080/api/v1/earlymedia/07045144801?tenantId=YOUR_TENANT_ID" \
  -d '{"enabled":"yes"}'
```

---

## 빠른 참조

| 기능 | 메서드 | 경로 |
|------|:------:|------|
| 착신전환 조회 | `GET` | `/api/v1/diversions/{내선}?tenantId=...` |
| 착신전환 설정 | `PUT` | `/api/v1/diversions/{내선}/{CFI\|CFB\|CFN\|CFU}?tenantId=...` |
| 착신전환 해제 | `DELETE` | `/api/v1/diversions/{내선}/{타입}?tenantId=...` |
| 발신자 조회 | `GET` | `/api/v1/callerid/{내선}` |
| 발신자 변경 | `PUT` | `/api/v1/callerid/{내선}` + `{"applyChanges":true}` |
| Early Media 조회 | `GET` | `/api/v1/earlymedia/{내선}?tenantId=...` |
| Early Media 설정 | `PUT` | `/api/v1/earlymedia/{내선}?tenantId=...` |
| 설정 재적용 | `POST` | `/api/v1/pbx/apply-changes` |
| 클릭투콜 | `POST` | `/api/v1/pbx/click-to-call` |

### 착신전환 타입

| 타입 | 설명 |
|:----:|------|
| CFI | 즉시 착신전환 (무조건) |
| CFB | 통화중 착신전환 |
| CFN | 부재중 착신전환 (미응답) |
| CFU | 미연결 착신전환 (단말기 오프라인) |

---

> 전체 상세 문서: [docs/pbx-management-api.md](pbx-management-api.md)
