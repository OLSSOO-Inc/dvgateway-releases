# SMS 발송·수신 (SIP MESSAGE)

> Dynamic VoIP 게이트웨이로 **문자(SMS)를 발송·수신**합니다. 발신은 SDK 한 줄 또는 REST 한 번,
> 설정·이력은 웹 대시보드 "📩 SMS" 탭에서. 통신사(KCT/Xener IP-SMSC) 단말연동규격을 그대로 구현.
> **gateway 1.4.14.52+ / SDK 1.9.1+**

전화 통화(AI 음성)와 별개로, 같은 게이트웨이에서 **문자 메시지**도 보낼 수 있습니다.

- **발신** — 내선(대표번호)에서 휴대폰으로 SMS 전송. 동보(여러 명 동시) 최대 10명.
- **수신** — 외부에서 온 SMS 를 실시간 이벤트 + 이력으로 수신.
- **이력** — 발신/수신 내역, 전송 상태(전송/실패/수신) 조회.
- **테넌트별 동작** — 테넌트마다 SMSC/발신 realm/트렁크를 따로 설정(다른 통신사도 가능).

---

## 0. 이 기능을 쓰기 전에 (관리자 1회 설정)

SMS 는 **관리자가 테넌트별 라우팅을 먼저 설정**해야 동작합니다. 설정 전에 발송하면 SDK/REST 가
`412` 와 함께 **"관리자에게 문의하세요"** 안내를 돌려줍니다(코드 `sms_disabled` / `sms_unprovisioned`).

관리자가 대시보드 **⚙ 설정 → 📩 SMS → 라우팅 설정**에서 채울 값:

| 항목 | 설명 | 예시 |
|------|------|------|
| SMS 활성화 | 이 테넌트에서 SMS 사용 | ✅ |
| SMSC 도메인 | Request-URI 도메인(통신사 SMSC) | `smsc.catvphone.com` |
| 발신 realm | To/From 도메인(가입자 도메인) | `xic001.catvphone.com` |
| 트렁크 endpoint | 통신사 SSW 로 도달하는 PJSIP endpoint **이름** | `DKCT` |
| 기본 회신번호 | 회신번호 폴백(선택) — 미지정 시 **발신 내선의 외부번호(external_cid)가 먼저** 쓰이고, 그것도 없을 때 이 값 사용 | (비움 가능) |
| 인코딩 | 본문 인코딩 | `euc-kr`(기본) / `utf-8` |

> PBX 트렁크(`outbound_proxy` 등) 설정과 AMI `message` 권한이 함께 필요합니다.
> 상세: [go-gateway/docs/sms-integration.md](../../go-gateway/docs/sms-integration.md).

발신자로 넣는 값은 **내선번호**(예 `1001`)입니다. 게이트웨이가 그 내선의 **실제 발신번호**(external
CID → 테넌트 대표번호)로 자동 변환해 통신사에 보냅니다 — 내선번호 그대로는 통신사가 거부합니다.

### 대시보드 발신 화면 (코드 없이)

"📩 SMS" 탭 발신 화면은 다음을 제공합니다:
- **템플릿** — 이 **테넌트에 서버 저장**되는 문구(기기/브라우저 공유). 저장/삭제, 선택 시 본문 자동 채움. (`GET/PUT /api/v1/sms/templates`)
- **치환 변수** — `{repName}`(대표번호 이름)·`{repNumber}`(대표번호) 칩. 본문에 삽입하면 **발송 시 게이트웨이가 이 테넌트의 실제 값(cid_name/cid_number)으로 치환**. SMS 는 통화 컨텍스트가 없어 대표번호 계열만 지원.
- **특수문자/이모지 팔레트** — 클릭해 본문 커서 위치에 삽입(복사/붙여넣기 불필요). ⚠️ **이모지는 인코딩이 `utf-8` 인 테넌트에서만** 제공 — 기본 `euc-kr` 은 이모지를 표현할 수 없어(발송 실패) 팔레트에서 숨겨지고, 특수문자/장식도 EUC-KR 가능 글자만 노출된다. (키보드로 이모지를 직접 넣어 EUC-KR 로 보내면 "EUC-KR 로 보낼 수 없는 문자" 오류.)
- **80바이트 제한** — 본문 최대 80바이트(EUC-KR). 카운터는 **치환 후** 길이(대표번호 실제 값으로 `{repName}`/`{repNumber}` 를 바꾼 뒤)로 표시·차단하여 서버 판정과 일치합니다. 초과 시 발송 전에 막고, 서버도 재검증(`sms_body_too_long`).
- **템플릿 저장/수정** — 템플릿을 선택하면 본문 편집기에 채워집니다. 그 자리에서 바로 고친 뒤 **💾 수정 저장** 을 누르면 선택한 템플릿을 현재 본문으로 덮어씁니다(모달 없음). 새 이름으로 남기려면 **＋ 새로 저장**. 같은 이름 저장 시 덮어쓰기 확인(중복 방지). 같은 템플릿을 다시 선택하면 원본 본문으로 다시 불러옵니다.
- **발송 결과 상세** — 성공(messageId·수신자) / 실패(원인·조치, 예: "관리자에게 SMS 라우팅 문의").
- **이력 행 클릭** — 상태·messageId·전체 본문, 실패 건은 원인(errorDetail) 상세.

---

## 1. SDK로 발송

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';

const gw = new DVGatewayClient({
  baseUrl: 'https://your-gateway:8080',
  auth: { type: 'apiKey', apiKey: process.env.DVG_API_KEY! },
});

const res = await gw.sendSMS({
  from: '1001',                       // 발신 내선 (실제 번호로 자동 변환)
  to: ['01012345678'],                // 수신 번호 (최대 10)
  text: '안녕하세요, 테스트 문자입니다.',
  priority: '1',                      // '0' 긴급 | '1' 빠름 | '2' 보통 (선택)
});
console.log(res); // { id, messageId, status: 'delivered', recipients: [...] }
```

> **사용자별 개인번호 발신** — `from` 에는 **내선번호**만 넣습니다. 게이트웨이가 그 내선의
> 외부 CID(`external_cid` → 테넌트 대표번호)로 자동 변환해 보냅니다. 즉 사용자마다 자기 내선을
> 넘기면 **각자의 개인 대표번호로 발신**됩니다. 모바일 앱(`api.accessToken`)은 **본인 내선만**
> 발신 가능하며, 관리자가 그 seat 에 발신 권한을 켜야 합니다(기본 차단, `403 sms_not_allowed`).
> 앱이 사용자 발신번호를 표시하려면 `GET /api/v1/sms/senders`(내선+외부 CID 목록)를 씁니다.

```python
from dvgateway import DVGatewayClient
import os

gw = DVGatewayClient(base_url="https://your-gateway:8080",
                     auth={"type": "apiKey", "apiKey": os.environ["DVG_API_KEY"]})

res = await gw.send_sms(
    from_="1001",
    to=["01012345678"],
    text="안녕하세요, 테스트 문자입니다.",
    priority="1",
)
print(res)  # {"id": ..., "messageId": ..., "status": "delivered", "recipients": [...]}
```

### 동보(여러 명에게 한 번에)

```typescript
await gw.sendSMS({ from: '1001', to: ['01011112222', '01033334444', '01055556666'], text: '공지입니다.' });
```

### SDK 없이 REST 로 직접

SDK 를 안 써도 됩니다 — 순수 HTTP 로 바로 호출할 수 있습니다.

```bash
curl -X POST 'https://your-gateway:8080/api/v1/sms/send' \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"from":"1001","to":["01012345678"],"text":"안녕하세요","priority":"1"}'
# → {"id":"…","messageId":"1001…","status":"delivered","recipients":["01012345678"]}
```

---

## 2. 이력 조회

```typescript
// 최근 발신/수신 20건
const { total, records } = await gw.listSMS({ limit: 20, offset: 0 });

// 발신만 / 수신만
const outbox = await gw.listSMS({ direction: 'out' });
const inbox  = await gw.listSMS({ direction: 'in' });

// 단건 상태 확인
const one = await gw.getSMS(records[0].id as string);
```

```python
page = await gw.list_sms(limit=20, offset=0)          # {"total": N, "records": [...]}
outbox = await gw.list_sms(direction="out")
one = await gw.get_sms(page["records"][0]["id"])
```

각 레코드 필드: `id, direction(out|in), messageId, from, to[], text, status, createdAt`.
상태값: `submitted`(전송 중) · `delivered`(전송) · `failed`(실패) · `received`(수신).

### 이력 비우기 (관리자/테스트 정리)

```typescript
const { deleted } = await gw.deleteSMS();                     // 이 테넌트 전체
await gw.deleteSMS({ before: '2026-01-01T00:00:00Z' });        // 그 이전 것만
```

```python
await gw.delete_sms()
await gw.delete_sms(before="2026-01-01T00:00:00Z")
```

---

## 3. 수신 (inbound SMS)

외부에서 온 SMS 는 세 경로로 받습니다:

1. **실시간 이벤트** — callinfo WebSocket(`/api/v1/ws/callinfo`)로 `sms:received` 이벤트가 push.
   페이로드: `{ event: "sms:received", smsFrom, smsTo, smsText, smsMessageId, smsRecordId, tenantId }`.
2. **이력** — `listSMS({ direction: 'in' })` 로 조회.
3. **모바일 푸시(sms_received, gw 1.4.14.50+)** — 인바운드 SMS 의 **수신번호(To)를 수신 DID 로 가진
   모바일 사용자(seat)** 에게 자동 푸시. 라우팅은 수신전화(incoming_call)와 동일(수신 DID + 정책
   all/flagged). 관리자가 대시보드 `💬 문자 수신 푸시` 마스터 + 테넌트 "문자(SMS) 수신" subtype 을
   켜야 발송됩니다. `data={sender, sender_number, body, msgid, record_id, receiver_number}`.

> 수신은 PBX 다이얼플랜(`message_context` → `UserEvent`) 설정이 필요합니다(관리자).
> 상세: [go-gateway/docs/sms-integration.md §4.2](../../go-gateway/docs/sms-integration.md),
> 푸시 3단계 제어: [docs/push-notifications.md §10](../push-notifications.md).

### 사용자별 발신 권한

모바일 사용자(seat)의 SMS **발신**은 관리자가 사용자별로 허용/차단합니다(기본 차단, opt-in).

- 대시보드 "📱 모바일 앱 사용자" → seat 표의 **SMS 발신** 토글, 또는
  `POST /api/v1/tenants/{id}/seats/{seatId}/sms-enabled {enabled}`.
- 테넌트 전체를 한 번에 허용: `PUT /api/v1/tenants/{id}/seats/sms-send-policy {policy:"allow"}`.
- 발신 권한 없는 seat 이 발신을 시도하면 `403 sms_not_allowed`.
- **수신 푸시와 발신 권한은 독립**입니다 — 수신 알림은 수신 DID/수신 정책으로, 발신은 이 토글로.

---

## 4. 테넌트 라우팅 설정 (SDK/REST)

대시보드 대신 코드로도 설정할 수 있습니다.

```typescript
// 현재 설정 조회
const cfg = await gw.getSMSConfig();
// 설정 저장 (테넌트 토큰=자기것, admin=?tenantId 또는 글로벌)
await gw.setSMSConfig({
  enabled: true,
  smscDomain: 'smsc.catvphone.com',
  senderRealm: 'xic001.catvphone.com',
  trunkEndpoint: 'DKCT',
  charset: 'euc-kr',
});
```

```python
cfg = await gw.get_sms_config()
await gw.set_sms_config({
    "enabled": True,
    "smscDomain": "smsc.catvphone.com",
    "senderRealm": "xic001.catvphone.com",
    "trunkEndpoint": "DKCT",
    "charset": "euc-kr",
})
```

**다른 통신사도 지원**: 값은 전부 테넌트별 설정에서 읽으므로, 테넌트마다 자기 통신사의
SMSC 도메인·realm·트렁크를 넣으면 됩니다. 코드는 통신사 무관하게 동작합니다.

---

## 5. 테넌트 격리 (중요)

- **테넌트 토큰**(일반 SDK 사용자): 자기 테넌트의 SMS 만 발송·조회. `tenantId` 를 넘겨도 무시되고,
  다른 테넌트를 지정하면 **403**.
- **모바일**(`api.accessToken`): **본인 내선으로만** 발신 가능(다른 내선 시도 시 403).
- **Admin 토큰**: `tenantId`(= PBX `path`)로 대상 테넌트 지정(설정은 미지정 시 글로벌).

---

## 6. 문제 해결 (실패 시)

발송이 실패하면 응답의 `code` 로 원인을 알 수 있습니다. **대부분 관리자 설정 문제**입니다.

| 응답 | 원인 | 조치 |
|------|------|------|
| `412 sms_disabled` | 테넌트에 SMS 미활성 | 관리자에게 SMS 활성화 요청 |
| `412 sms_unprovisioned` (`missing` 배열) | SMSC 도메인/트렁크 미설정 | 관리자에게 라우팅 설정 요청(누락 항목은 `missing`) |
| `403 not_owner` | 모바일이 본인 아닌 내선으로 발신 | 본인 내선으로 |
| `403 sms_not_allowed` | 이 사용자(seat)에 SMS 발신 권한 없음 | 관리자: seat "SMS 발신" 토글 또는 테넌트 발신 정책 허용 |
| `400 bad_from`/`bad_to` | 번호 형식 오류(숫자 아님) | 숫자만(예 `01012345678`) |
| `502 ami_message_permission` | 게이트웨이 AMI `message` 권한 없음 | 관리자: `manager.conf` 에 `write=…,message` + 재시작 |
| `502` 기타 | 통신사(SSW)가 거부 | 발신번호가 통신사에 등록됐는지, 트렁크 라우팅 확인 |

SDK 는 이 응답을 예외로 던지므로, 메시지를 그대로 사용자에게 보여주고 **관리자 문의**를 안내하면
됩니다. 게이트웨이가 이미 한국어 안내 문구를 담아 줍니다.

```typescript
try {
  await gw.sendSMS({ from, to, text });
} catch (e: any) {
  // e.message 예: "SMS 발신 설정이 완료되지 않았습니다(트렁크 endpoint 미설정). 관리자에게 …"
  showToUser(e.message);
}
```

---

## 참고

- **AI 콤보 예제** — 영업시간 외 AI 예약 접수 + 확인 문자 자동 발송: [TS 09](examples/typescript/09-ai-sms-confirmation.ts) · [PY 08](examples/python/08_ai_sms_confirmation.py)
- **활용 레시피** — 모니터링·cron·n8n 에서 알림 문자 보내기(사내 문자 게이트웨이): [22-sms-alert-gateway.md](22-sms-alert-gateway.md)
- 게이트웨이/PBX 설정·다이얼플랜·트러블슈팅: [go-gateway/docs/sms-integration.md](../../go-gateway/docs/sms-integration.md)
- 규격: KCT/Xener IP-SMSC 단말연동규격(SIP MESSAGE). 본문 인코딩 EUC-KR(실측 검증).
