# 15. 같은 테넌트에 여러 구독자가 붙을 때 — 충돌 방지

> **대상**: 운영 환경에서 한 테넌트로 **여러 SDK 클라이언트**(자동응답 봇, 모니터, 데모용 웹 플레이그라운드 등)를 동시에 운영하려는 개발자.
> **선행 문서**: [14. 신규 테넌트 가이드](14-tenant-fixed-audio-guide.md)

---

## 15.1 무슨 문제가 생기는가

게이트웨이의 `/api/v1/ws/callinfo`는 한 테넌트에 **여러 구독자**가 동시에 붙는 것을 허용합니다. 같은 자격증명으로 로그인한 모든 클라이언트는 그 테넌트의 모든 통화 이벤트(`call:new`, `channel:state`, `call:ended`, `call:dtmf`, …)를 **동일하게** 받습니다.

이건 회의록 봇 + 운영 모니터처럼 **read-only** 구독자가 여럿 붙는 시나리오에는 그대로 좋습니다. 그런데 **write** 동작(`inject_tts`, `play_audio`, hangup 등)을 하는 클라이언트가 둘 이상이면 다음과 같은 충돌이 일어납니다:

| 충돌 | 게이트웨이 동작 | 사용자 체감 |
|------|----------------|------------|
| 두 클라이언트가 같은 `linkedId`에 동시에 `inject_tts` | 마지막 inject가 이전을 끊고 재생됨 — `tts:playback phase=canceled reason=preempted` | 우리가 보낸 음원이 갑자기 끊김 |
| 한 봇이 TTS 후 자동 hangup | 게이트웨이는 정상 `call:ended` 발행 | 다른 클라이언트가 다음 동작을 하려는 사이 통화가 사라져 `404 No active call` |
| 같은 linkedId에 둘이 `DELETE /api/v1/tts/{linkedId}` | 가장 먼저 도착한 stop이 적용 | 예측 불가 |

게이트웨이 입장에서는 모두 의도된 동작이고 **테넌트 격리도 깨지지 않습니다**. 그러나 운영적으로는 "누가 이겼는가"가 비결정적이라 디버깅이 어렵습니다.

---

## 15.2 권장: 책임 분리

같은 테넌트 안에서도 **누가 무엇을 책임지는지** 명확히 분리하세요. 추천 순서:

### A. 테넌트 자체를 분리 (가장 깨끗)

운영 봇과 데모/모니터 환경을 **별도 테넌트**로 발급받으세요.

| 환경 | tenant ID | 권한 |
|------|-----------|------|
| 운영 자동응답 봇 | `tenant-acme-prod` | 본인 DID만 수신 + write |
| 데모 / 플레이그라운드 | `tenant-acme-demo` | 별도 DID 또는 시뮬레이션 |
| 모니터링 | `tenant-acme-readonly` | 모든 DID 수신 (read-only) |

각 테넌트는 자기 DID 외엔 이벤트를 받지 않으므로 충돌이 원천 차단됩니다.

### B. 같은 테넌트 안에서 DID로 라우팅 분리

테넌트를 늘리기 어렵다면, **DID 단위**로 코드에서 분기하세요. 가이드 §14.4 의 `call:new` 이벤트에는 `did` 필드가 들어 있습니다.

```javascript
ws.onmessage = async (msg) => {
  const evt = JSON.parse(msg.data);
  if (evt.event !== "call:new") return;

  // 봇은 PROD_DIDS 만 처리
  if (!PROD_DIDS.has(evt.did)) return;

  await handleCall(evt);
};
```

운영 봇이 자기 책임 DID만 처리하면, 데모용 DID로 들어온 통화는 봇이 손대지 않으므로 데모 클라이언트가 자유롭게 사용할 수 있습니다.

### C. 봇에 "유휴 모드" 토글 (단기 처방)

장기 데모를 위해 운영 봇에 일시 중단 스위치를 두세요. 예:

- 환경 변수 `BOT_MUTED=1` 로 시작하면 `call:new`를 수신해도 inject/hangup을 안 함
- 또는 자체 REST: `POST /admin/mute { "ttlSec": 300 }`

데모 직전에 켜고, 끝나면 자동 해제되도록.

---

## 15.3 그래도 같이 쓸 때의 방어 코드

위 분리를 적용하더라도 사고를 대비해 **모든 write 클라이언트는 다음을 구현**하세요.

### 15.3.1 inject 전 라이브 검증

```javascript
// 통화가 정말 살아 있는지 확인 후 inject
const ok = await sessionExists(linkedId);  // GET /api/v1/sessions/{linkedId}
if (!ok) {
  console.warn(`call ${linkedId} already gone — skip inject`);
  return;
}
await injectTts(linkedId, text);
```

### 15.3.2 preempted 감지

`tts:playback` 이벤트의 `phase`가 `canceled`, `errorReason`이 `preempted` 인 경우, **방금 우리가 보낸 inject가 다른 구독자에 의해 끊긴 것**입니다. 가이드 §14.4 의 라이프사이클 이벤트로 명시되어 있습니다.

```javascript
ws.onmessage = (msg) => {
  const evt = JSON.parse(msg.data);
  if (evt.event !== "tts:playback") return;
  if (evt.phase === "canceled" && evt.errorReason === "preempted"
      && ourActiveInjectIds.has(evt.injectId)) {
    console.warn(`our inject ${evt.injectId} was preempted by another subscriber on ${evt.linkedId}`);
    // 알림, 재시도, 또는 사용자에게 경고 표시
  }
};
```

`audio:playback` 도 같은 형태로 `errorReason=preempted` 가 발행됩니다.

### 15.3.3 외부 구독자가 시작한 inject 감지

우리가 시작하지 않은 `tts:playback phase=start` 또는 `audio:playback phase=start`가 도착하면, 다른 구독자가 같은 통화에 작업 중인 것입니다.

```javascript
const ourInjects = new Set();      // 우리가 시작한 injectId

ws.onmessage = (msg) => {
  const evt = JSON.parse(msg.data);
  if (evt.event === "tts:playback" && evt.phase === "start"
      && !ourInjects.has(evt.injectId)) {
    console.warn(`another subscriber is injecting TTS into ${evt.linkedId}`);
  }
};

async function injectTts(linkedId, text) {
  const r = await fetch(`/api/v1/tts/${linkedId}`, { /* ... */ });
  const injectId = r.headers.get("X-Inject-Id");
  if (injectId) ourInjects.add(injectId);
}
```

### 15.3.4 종료 상태 즉시 처리

가이드 §14.4 의 `channel:state` 종료 상태는 `down`만 있는 게 아닙니다. **`busy`, `no_answer`, `rejected`** 도 통화가 끝났다는 신호이며, 이때는 `call:ended` 가 안 올 수도 있습니다. 로컬 상태에서 즉시 제거하세요.

```javascript
const TERMINAL = new Set(["down", "busy", "no_answer", "rejected"]);

ws.onmessage = (msg) => {
  const evt = JSON.parse(msg.data);
  if (evt.event === "channel:state" && TERMINAL.has(evt.state)) {
    activeCalls.delete(evt.linkedId);
  }
};
```

---

## 15.4 결정 트리

```
새 SDK 통합을 시작하시나요?
│
├── 다른 시스템이 같은 테넌트에 이미 붙어 있나요?
│   ├── 아니오 → 그대로 진행
│   └── 예
│       ├── 별도 테넌트 발급이 가능한가요?
│       │   ├── 예 → 분리 (15.2 A) ★ 권장
│       │   └── 아니오 → DID 라우팅으로 분리 (15.2 B)
│       └── 어쨌든 15.3 의 방어 코드는 모두 구현
└── 항상: 15.3.4 종료 상태 즉시 처리
```

---

## 15.5 트러블슈팅

### Q. "방금 inject 했는데 음원이 갑자기 끊겼습니다."

`tts:playback phase=canceled errorReason=preempted` 이벤트가 같은 `injectId`로 왔는지 확인하세요. 왔다면 다른 구독자가 새 inject를 보낸 것입니다. 15.3.2 의 감지 코드를 추가하고, 운영 측에 누가 인젝트하고 있는지 확인 요청하세요.

### Q. "이벤트는 도착하는데 inject 가 404 로 떨어집니다."

다른 구독자(예: 봇)가 TTS 후 자동 hangup 했을 가능성. 게이트웨이 로그에서 같은 `linkedId` 의 `[API] call hangup` 이 우리 POST 직전에 떴는지 확인. 15.3.1 의 라이브 검증을 모든 inject 직전에 적용.

### Q. "두 봇이 동시에 응답해서 사용자가 두 번 듣습니다."

이건 게이트웨이가 막아주지 않습니다 — preempt 정책은 같은 `linkedId` 안에서만 작동하므로, 두 inject 가 매우 가깝게 도착하면 두 번째가 첫 번째를 끊고 재생하기 전까지 일부 프레임은 이미 캐스터에 도달했을 수 있습니다. 15.2 A 또는 B 로 책임을 원천 분리하세요.

### Q. "데모용 클라이언트가 운영 봇의 통화를 끊습니다."

권한 분리가 안 되어 있는 것입니다. 운영 봇이 `DELETE /api/v1/tts/{linkedId}` 나 hangup API 를 데모용 자격증명에서 호출 못 하도록 별도 테넌트로 옮기세요.

---

## 15.6 요약

| 원칙 | 적용 |
|------|------|
| **write 권한이 있는 클라이언트는 한 통화당 하나만** | 테넌트 또는 DID로 책임 분리 |
| **read-only 구독자는 여럿이어도 OK** | 모니터링, 회의록, 분석은 안전 |
| **모든 클라이언트는 종료 상태(`down/busy/no_answer/rejected`)를 즉시 처리** | call:ended 만 기다리지 말 것 |
| **inject 전 라이브 검증** | 404 self-heal |
| **preempted 감지** | `tts:playback canceled reason=preempted` 모니터링 |

위 원칙 다섯 가지를 지키면 같은 테넌트에 여러 클라이언트가 붙어 있어도 운영 예측 가능성이 크게 올라갑니다. 단, **가장 안전한 운영 형태는 여전히 §15.2 A의 테넌트 분리**입니다.
