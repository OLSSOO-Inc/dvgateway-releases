# 18. 앱 푸시 / 알림 (모바일 FCM)

> **요약**: 게이트웨이에 연동된 모바일 앱 사용자에게 SDK로 푸시를 보냅니다.
> 통화 종료 후 요약/녹취 링크, 부재중 알림, 임의 이벤트 등. 내선번호만 지정하면
> 게이트웨이가 그 내선에 등록된 앱 단말로 전달합니다. **gateway 1.4.8.0 / SDK 1.8.0+**.

---

## 무엇을 할 수 있나

모바일 앱이 게이트웨이/PBX에 연동되면(내선 등록 + 기기 토큰 등록), SDK가 그 사용자 단말로
푸시를 보낼 수 있습니다. 모든 푸시는 `dvg_event{subtype}` 단일 스키마를 쓰며, 같은
전달 경로를 공유합니다.

| 메서드 | subtype | 용도 |
|--------|---------|------|
| `pushToExtension(...)` | (임의) | 범용 — 직접 subtype·data 지정 |
| `notifyCallSummary(linkedId, ...)` | `call_summary` | **통화 종료 후 요약·전사·녹취 링크** |
| `notifyMissedCall(...)` | `missed_call` | 부재중 알림 |

> 추가 subtype(agent_status, campaign_event 등)은 `pushToExtension`에 원하는 `subtype`을
> 넘기면 그대로 동작합니다. 수신 측(앱)이 그 subtype을 해석하도록 구현돼 있어야 합니다.

---

## 사전 요구 — 게이트웨이 푸시 설정

이 기능은 게이트웨이 운영사(관리자)가 켜야 합니다. 운영사에 요청하세요.
꺼져 있는 상태에서 푸시 API를 호출하면 **HTTP 503**으로 응답합니다.

> **수신 자격**: 앱에서 ① 로그인 ② 내선 등록 ③ 기기 토큰 등록·승인이 끝난 사용자만 푸시가
> 도착합니다. 미등록 내선으로 보내면 게이트웨이가 발송하지 않고 **404**를 돌려줍니다.

---

## 멀티테넌트 — 테넌트 격리 & 라우팅

푸시는 **처음부터 테넌트 격리**가 적용됩니다(별도 옵션 아님).

- **발신(SDK) 측**: `tenantId`는 **요청 본문이 아니라 인증(JWT `tid` / `X-Tenant-ID`)에서 강제**됩니다. 따라서 한 테넌트로 인증한 클라이언트는 **자기 테넌트의 내선으로만** 푸시할 수 있고, 본문에 다른 tenantId를 넣어도 무시됩니다. SDK 메서드에 `tenantId`를 직접 넘기지 않습니다 — 클라이언트 초기화 시 결정됩니다.
- **페이로드의 `tenantId`** = 통화 세션의 `tenantId` 와 같은 16-hex 테넌트 식별자입니다(예: `0123456789abcdef`).
- **`extension`은 prefix 없는 내선번호**입니다(예: `2000`).
- **수신(앱) 측 라우팅 키 = `(tenantId, extension)` 복합키**. 같은 내선 번호가 서로 다른 테넌트에 동시에 존재할 수 있으므로, 수신 측은 extension 단독으로 단말을 찾으면 안 됩니다.

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
  const linkedId = event.linkedId;   // call:ended 는 이벤트에 바로 linkedId 가 있습니다
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
    linked_id = event.linked_id   # call:ended 는 이벤트에 바로 linked_id 가 있습니다
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
> 만료·서명이 포함된 URL을 쓰세요(앱이 내부 저장소를 직접 보지 않도록).

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
    linked_id=ev.linked_id,   # 선택 — 앱에서 통화이력과 연결
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
> 그대로 전달).

---

## 반환값 / 에러

| 상황 | 결과 |
|------|------|
| 성공 | `{ delivered: true, subtype: "..." }` (call_summary는 `linkedid` 포함) |
| 푸시 미설정 | HTTP **503** — 운영사에 푸시 기능 활성화 요청 |
| 미등록 내선 | HTTP **404** — 앱에서 로그인/내선/기기 등록 미완료 |
| 전달 실패 | HTTP **502** — 푸시 전달 경로 오류(일시적이면 재시도, 계속되면 운영사 문의) |
| 필수값 누락 | HTTP **400** (예: call_summary에 URL 0개) |

테넌트는 **JWT에서 강제**됩니다 — 요청 본문의 tenantId는 신뢰하지 않으므로, 다른 테넌트의
내선으로는 보낼 수 없습니다.

---

## 코드 없이 체험 — Web Playground

브라우저 플레이그라운드의 **「11. 📲 앱 푸시·알림」** 템플릿에서 범용/통화요약/부재중 푸시를
바로 보내볼 수 있습니다(푸시 미설정 시 안내). → [16. Web Playground 빠른 시작](16-web-playground-quickstart.md)

---

## 수신 측(앱)은 어떻게 처리하나

게이트웨이는 **발신 측**입니다. 수신 처리는 모바일 앱이 합니다. 앱은 FCM `data.type == "dvg_event"` + `data.subtype`으로
분기해 `call_summary` → 통화이력 카드, `missed_call` → 부재중 배너 등으로 처리합니다.
`pushToExtension` 으로 새 subtype 을 보낼 때는 앱이 그 subtype 을 해석하는지 먼저 확인하세요.
