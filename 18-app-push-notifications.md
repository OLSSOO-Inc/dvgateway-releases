# 18. 앱 푸시 / 알림 (모바일 FCM)

> **요약**: 게이트웨이에 연동된 모바일 앱(예: makecall) 사용자에게 SDK로 푸시를 보냅니다.
> 통화 종료 후 요약/녹취 링크, 부재중 알림, 임의 이벤트 등. 게이트웨이가
> `extension → userId → fcm_token` 매핑(앱 온보딩으로 생성)으로 라우팅해 FCM 릴레이에
> HMAC 서명 전달합니다. **gateway 1.4.8.0 / SDK 1.8.0+**.

---

## 무엇을 할 수 있나

모바일 앱이 게이트웨이/PBX에 연동되면(내선 등록 + 기기 토큰 등록), SDK가 그 사용자 단말로
푸시를 보낼 수 있습니다. 모든 푸시는 `dvg_event{subtype}` 단일 스키마를 쓰며, 한 가지 HMAC
서명 규약과 한 개의 FCM 릴레이를 공유합니다.

| 메서드 | subtype | 용도 |
|--------|---------|------|
| `pushToExtension(...)` | (임의) | 범용 — 직접 subtype·data 지정 |
| `notifyCallSummary(linkedId, ...)` | `call_summary` | **통화 종료 후 요약·전사·녹취 링크** |
| `notifyMissedCall(...)` | `missed_call` | 부재중 알림 |

> 추가 subtype(agent_status, campaign_event 등)은 `pushToExtension`에 원하는 `subtype`을
> 넘기면 그대로 동작합니다. 수신 측(앱)이 그 subtype을 해석하도록 구현돼 있어야 합니다.

---

## 사전 요구 — 게이트웨이 푸시 릴레이 설정

푸시는 게이트웨이가 **FCM 릴레이(예: Firebase Cloud Function)** 로 서명된 요청을 보내는
구조입니다. 운영자가 게이트웨이에 다음 환경변수를 설정해야 동작합니다(셋 다 필요):

| 환경변수 | 설명 |
|----------|------|
| `GW_WARM_TRANSFER_PUSH_ENABLED` | `true` (기본 false — opt-in) |
| `GW_WARM_TRANSFER_PUSH_URL` | 릴레이 엔드포인트 (Cloud Function URL) |
| `GW_WARM_TRANSFER_PUSH_SECRET` | HMAC-SHA256 서명 키 (릴레이와 동일 값) |

미설정 상태에서 푸시 API를 호출하면 **HTTP 503**으로 응답합니다. 서명은 CDR 웹훅과 동일
패턴(`X-DVG-Signature = hex(HMAC-SHA256(secret, rawBody))`)이라, 릴레이가 같은 시크릿으로
검증합니다. 전체 규약: [warm-transfer-push-contract.md](../warm-transfer-push-contract.md),
subtype 카탈로그: [dvg-mobile-roadmap.md](../dvg-mobile-roadmap.md).

> **수신 자격**: 앱에서 ① 로그인 ② 내선 등록 ③ 기기 토큰 등록·승인이 끝난 사용자만 푸시가
> 도착합니다. 미등록 내선으로 보내면 게이트웨이가 발송하지 않고 **404**를 돌려줍니다.

---

## 멀티테넌트 — 테넌트 격리 & 라우팅

푸시는 **처음부터 테넌트 격리**가 적용됩니다(별도 옵션 아님).

- **발신(SDK) 측**: `tenantId`는 **요청 본문이 아니라 인증(JWT `tid` / `X-Tenant-ID`)에서 강제**됩니다. 따라서 한 테넌트로 인증한 클라이언트는 **자기 테넌트의 내선으로만** 푸시할 수 있고, 본문에 다른 tenantId를 넣어도 무시됩니다. SDK 메서드에 `tenantId`를 직접 넘기지 않습니다 — 클라이언트 초기화 시 결정됩니다.
- **페이로드의 `tenantId`** = **Dynamic VoIP 테넌트 `path`** (16-hex, 예: `7be69580e27641df`). 게이트웨이가 `PBX_TENANT_SYNC_ENABLED=true`로 동작할 때, 이 값은 다이얼플랜 `${TENANT_PATH}` = REST `tenant` 헤더 = 통화 세션 tenantId와 **전 구간 동일한 단일 값**입니다.
- **`extension`은 bare**(prefix 없음). Dynamic VoIP는 테넌트별 `T{tenant_id}_` prefix를 쓰지만(예: 테넌트2 내선 2000 = `T2_2000`), 페이로드에는 `2000`처럼 prefix 없이 담깁니다.
- **수신(앱) 측 라우팅 키 = `(tenantId, extension)` 복합키**. 같은 내선 번호가 서로 다른 테넌트에 동시에 존재할 수 있으므로, extension 단독으로 토큰을 조회하면 **다른 테넌트 사용자에게 오발송**될 수 있습니다. 매칭 실패 시 extension 단독 폴백 금지(fail-closed). 수신 측 구현·온보딩 규약: [handoff-makecall-tenant-push.md](../handoff-makecall-tenant-push.md).

> 즉 SDK 사용자는 평소처럼 `extension`만 지정하면 되고(테넌트는 인증에서 자동), 멀티테넌트 정합성은 게이트웨이(발신 격리) + 앱(수신 복합키 라우팅)이 함께 보장합니다.

---

## 1. 통화 종료 후 요약/녹취 링크 — `notifyCallSummary`

가장 가치 있는 패턴입니다. 통화가 끝나면(`call:ended`) STT 전사·요약·녹취를 만들어
**짧은 만료 서명 URL**로 앱에 푸시 → 앱은 통화이력 항목에 "요약 보기 / 녹취 듣기"로 노출합니다.

### TypeScript
```ts
import { DVGatewayClient } from "dvgateway-sdk";

const client = new DVGatewayClient({
  baseUrl: "https://gw.example.com:8080",
  auth: { type: "apiKey", apiKey: process.env.DVG_API_KEY! },
});

client.on("call:ended", async (event) => {
  const linkedId = event.session.linkedId;
  // (앱/백엔드에서) 요약·전사·녹취를 만들고 서명된 단기 URL을 발급했다고 가정
  const links = await buildSignedLinks(linkedId); // 직접 구현

  await client.notifyCallSummary(linkedId, {
    extension: "1001",  // 알림 받을 내선 (세션에서 얻거나 매핑)
    summaryUrl: links.summary,
    transcriptUrl: links.transcript,
    audioUrl: links.audio,
    title: "통화 요약이 준비되었습니다",
  });
});
```

### Python
```python
from dvgateway import DVGatewayClient

client = DVGatewayClient(base_url="https://gw.example.com:8080",
                         auth={"type": "apiKey", "api_key": API_KEY})

@client.on("call:ended")
async def on_ended(event):
    linked_id = event["session"].linked_id
    links = await build_signed_links(linked_id)  # 직접 구현
    await client.notify_call_summary(
        linked_id,
        extension="1001",   # 알림 받을 내선 (세션에서 얻거나 매핑)
        summary_url=links["summary"],
        transcript_url=links["transcript"],
        audio_url=links["audio"],
        title="통화 요약이 준비되었습니다",
    )
```

> `summaryUrl` / `transcriptUrl` / `audioUrl` 중 **최소 한 개**는 필수입니다. 운영에서는
> 만료·서명이 포함된 URL을 쓰세요(앱이 Firestore 등 내부 저장소를 직접 보지 않도록).

---

## 2. 부재중 알림 — `notifyMissedCall`

```ts
// TypeScript — 무응답/거절로 끝난 통화에 대해
await client.notifyMissedCall({
  extension: "1001",
  callerNumber: "01012345678",
  callerName: "홍길동",
  linkedId: ev.linkedId,   // 선택 — 앱에서 통화이력과 연결
});
```
```python
# Python
await client.notify_missed_call(
    extension="1001",
    caller_number="01012345678",
    caller_name="홍길동",
    linked_id=ev["linkedId"],
)
```

---

## 3. 범용 푸시 — `pushToExtension`

임의 subtype과 데이터로 푸시합니다. 나머지 편의 메서드의 기반입니다.

```ts
// TypeScript
await client.pushToExtension({
  extension: "1001",
  subtype: "agent_status",          // 앱이 해석할 subtype (자유)
  title: "대기열 알림",
  body: "대기 통화 5건 초과",
  data: { queue: "support", waiting: "5" },  // 값은 문자열 권장 (FCM data 제약)
});
```
```python
# Python
await client.push_to_extension(
    "1001",
    "agent_status",
    title="대기열 알림",
    body="대기 통화 5건 초과",
    data={"queue": "support", "waiting": "5"},
)
```

> `data`의 값은 FCM 제약상 **문자열**로 전달하는 것을 권장합니다(게이트웨이는 받은 맵을
> 릴레이로 그대로 전달).

---

## 반환값 / 에러

| 상황 | 결과 |
|------|------|
| 성공 | `{ delivered: true, subtype: "..." }` (call_summary는 `linkedid` 포함) |
| 릴레이 미설정 | HTTP **503** — 운영자가 `GW_WARM_TRANSFER_PUSH_*` 설정 필요 |
| 미등록 내선 | HTTP **404** — 앱에서 로그인/내선/기기 등록 미완료 |
| 릴레이 전달 실패 | HTTP **502** — Function/네트워크 오류 |
| 필수값 누락 | HTTP **400** (예: call_summary에 URL 0개) |

테넌트는 **JWT에서 강제**됩니다 — 요청 본문의 tenantId는 신뢰하지 않으므로, 다른 테넌트의
내선으로는 보낼 수 없습니다.

---

## 코드 없이 체험 — Web Playground

브라우저 플레이그라운드의 **「11. 📲 앱 푸시·알림」** 템플릿에서 범용/통화요약/부재중 푸시를
바로 보내볼 수 있습니다(릴레이 미설정 시 안내). → [16. Web Playground 빠른 시작](16-web-playground-quickstart.md)

---

## 수신 측(앱)은 어떻게 처리하나

게이트웨이는 **발신 측**입니다. 수신(FCM 토큰 조회 + 멀티캐스트 + 앱 라우팅)은 모바일 앱
레포(makecall 등)에서 구현합니다. 앱은 FCM `data.type == "dvg_event"` + `data.subtype`으로
분기해 `call_summary` → 통화이력 카드, `missed_call` → 부재중 배너 등으로 처리합니다.
연계 규약은 [dvg-mobile-roadmap.md](../dvg-mobile-roadmap.md) 참조.
