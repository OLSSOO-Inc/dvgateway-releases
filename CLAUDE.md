# CLAUDE.md — DVGateway SDK 사용자 가이드

이 파일은 AI 코딩 어시스턴트(Claude, Copilot 등)가 DVGateway SDK를 사용하는 프로젝트에서 작업할 때 참조하는 가이드입니다.

---

## SDK 개요

**DVGateway SDK**는 Dynamic VoIP PBX의 실시간 통화를 AI 파이프라인(STT·LLM·TTS)에 연결하는 라이브러리입니다.

| 언어 | 패키지 | 설치 |
|------|--------|------|
| TypeScript | `dvgateway-sdk` + `dvgateway-adapters` | `npm install dvgateway-sdk dvgateway-adapters` |
| Python | `dvgateway-python` | `pip install dvgateway-python` |

### 버전 호환성 및 알려진 이슈

| 버전 | 상태 | 비고 |
|------|------|------|
| `1.3.5` | ✅ 안정 | 권장 안정 버전 (마지막으로 검증된 릴리즈) |
| `1.3.6` | ⚠️ | 중간 릴리즈 |
| `1.3.7` | ❌ 버그 | `OpenAIRealtimeAdapter` 오디오 입력 타입 불일치 — S2S 세션에서 오디오가 조용히 끊김 |
| `1.3.8` ~ `1.5.2` | ✅ 수정 | v1.3.7의 audio_in 타입 불일치 및 background task 사일런트 실패 수정 |
| `1.5.3` | ✅ 안정 | `channel:state` 이벤트 추가 — outbound click-to-call B-leg 응답 감지 (`gw.on_channel_state` / `gw.onChannelState`). **게이트웨이 v1.3.9.1+ 필요** (AMI Newstate / DialEnd publish 지원) |
| `1.6.0+` | ✅ 신규 | `audio:playback` 이벤트 추가 — `play_audio()` 라이프사이클 (start / complete / canceled / failed) 명시 신호. `play_audio()`/`playAudio()` 가 `playback_id`/`playbackId` 반환. **게이트웨이 v1.3.9.2+ 필요** (`PublishAudioPlayback` publish 지원) |
| `1.6.1+` | ✅ 신규 | `tts:playback` 이벤트 추가 — `inject_tts()` 라이프사이클 (start / complete / canceled / failed) 명시 신호. `phase="canceled"` 의 `error_reason` 으로 선점 (`preempted`) / barge-in (`barge_in`) / 통화 종료 (`hangup`) / 사용자 요청 (`user_request`) 구분 가능. `inject_tts()` / `injectTts()` / `say()` 가 `InjectTtsResult { inject_id }` 반환. **게이트웨이 v1.3.9.3+ 필요** (`PublishTTSPlayback` publish 지원) |
| `1.6.2+` | ✅ 신규 | **VoiceFlow + 온디맨드 오디오** — `gw.flow()` 빌더 (stage 그래프 기반 IVR 런타임), `attachAudio()`/`detachAudio()`/`getAudioStatus()` 신규 메서드 추가. 다이얼플랜에서 `Stasis(dvgateway, flow=true, ...)`로 진입한 통화는 ExternalMedia/Bridge가 자동 생성되지 않고 holding 상태로 시작 → SDK가 stage onEnter/onExit 시점에 명시적으로 attach/detach. DTMF 메뉴 단계에서 STT/TTS 비용 0, 통화 중 단계별로 Asterisk 채널 수 동적 변동 가능. `flow=true` 미지정 통화는 기존 동작 그대로(회귀 영향 0). **게이트웨이 v1.3.9.4+ 필요** (`flow` Stasis arg + `/api/v1/audio/{linkedId}` 엔드포인트 + `audio:attached`/`audio:detached` 대시보드 이벤트 지원). 자세한 내용은 [VoiceFlow 섹션](#voiceflow--stage-그래프-ivr-자동화-gateway-1394) 참조 |
| `1.7.0+` | ✅ 신규 | `call:rejected` 이벤트 추가 — 라이선스 전역 한도 또는 테넌트 동시통화 한도(`TENANT_LIMITS`) 도달 시 SDK가 거부 사실을 명시 신호로 수신. `reason`(`license_global`/`tenant_limit`), `currentActive`, `limit` 포함. **게이트웨이 v1.4.4.0+ 필요** (`PublishCallRejected` + `/api/v1/config/tenant-limits` hot-reload API 지원) |

**v1.3.7 버그 상세:**
- `OpenAIRealtimeAdapter._pipe_audio_in()`이 `chunk.samples` (AudioChunk)를 기대하지만, 실제로는 `bytes`가 전달되는 경우가 있어 `AttributeError`로 background task가 사일런트 종료됨
- `on_error` 콜백으로 예외가 전파되지 않아 진단이 어려움

**워크어라운드 (v1.3.8 릴리즈 전):**
```bash
# Python: 이전 안정 버전 고정
pip install dvgateway-python==1.3.5
```

v1.3.8부터는 `_pipe_audio_in`이 `bytes` / `bytearray` / `memoryview` / `AudioChunk`를 모두 받아들이며, task 예외가 `on_error` 핸들러 또는 stderr로 표면화됩니다.

---

## 클라이언트 초기화

### TypeScript
```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL'] ?? 'http://localhost:8080',
  auth: { type: 'apiKey', apiKey: process.env['DV_API_KEY']! },
});
```

### Python
```python
from dvgateway import DVGatewayClient
gw = DVGatewayClient(
    base_url="http://localhost:8080",
    auth={"type": "apiKey", "api_key": "dvgw_xxx"},
)
```

---

## AI 음성 파이프라인 (STT → LLM → TTS)

```python
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import AnthropicAdapter
from dvgateway.adapters.tts import GeminiTtsAdapter

stt = DeepgramAdapter(api_key="dg_xxx", language="ko", model="nova-3")
llm = AnthropicAdapter(api_key="sk-ant-xxx", model="claude-sonnet-4-6",
    system_prompt="친절한 AI 상담원. 1-2문장으로 답변.")
tts = GeminiTtsAdapter(api_key="AIza_xxx")

await gw.pipeline().stt(stt).llm(llm).tts(tts).start()
```

---

## VoiceFlow — Stage 그래프 IVR 자동화 (gateway 1.3.9.4+)

`gw.pipeline()`은 **항상 켜진 풀-듀플렉스 AI 대화**를 가정합니다. 반면 IVR / 메뉴 / 폼 입력 / "DTMF로 분기 → 단계별 AI 호출" 같은 시나리오는 단계마다 필요한 자원이 다릅니다 — 메뉴 안내 단계는 TTS만, 콜백 번호 수집 단계는 DTMF만, AI 상담 단계만 풀-듀플렉스.

이 비대칭 자원 사용을 게이트웨이가 **런타임에** 알 수 있도록 다이얼플랜에서 `flow=true`로 진입시키면, 게이트웨이는 ExternalMedia/Bridge를 자동 생성하지 않고 통화를 holding 상태로 둡니다. SDK가 stage onEnter/onExit 시점에 명시적으로 `attachAudio`/`detachAudio` REST 호출을 보내면 그때만 ExternalMedia가 만들어졌다 사라집니다 — Asterisk 채널 수와 미디어 게이트웨이 처리 비용 모두 단계별로 최소화됩니다.

### 다이얼플랜 진입

```asterisk
exten => s,1,Stasis(dvgateway,flow=true,tenantid=acme,callernum=${CALLERID(num)},callednum=${EXTEN})
```

`flow=true`를 빼면 기존 동작(StasisStart 시 즉시 ExternalMedia 생성)이 그대로 유지됩니다 — **기존 통화 회귀 영향 0**.

### 단계 audio 모드

| 모드 | REST `dir` | 게이트웨이 동작 | 사용처 |
|------|-----------|---------------|--------|
| `'none'` | (없음) | ExternalMedia 분리 — 채널은 holding bridge | DTMF 메뉴 대기 / 폼 입력 / 슬립 |
| `'tts-only'` | `out` | gateway → caller 단방향 | 안내 멘트 재생 (STT 비용 0) |
| `'stt-only'` | `in` | caller → gateway 단방향 | 발화 녹취만 |
| `'full'` | `both` | 양방향 (기본 AI 대화) | LLM 상담 단계 |

### TypeScript 예제

```typescript
import { ElevenLabsAdapter, AnthropicAdapter, DeepgramAdapter } from 'dvgateway-adapters';

const greetTts = new ElevenLabsAdapter({ apiKey: process.env.ELEVENLABS_KEY! });
const aiPipeline = gw.pipeline()
  .stt(new DeepgramAdapter({ apiKey: process.env.DEEPGRAM_KEY!, language: 'ko' }))
  .llm(new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_KEY!, model: 'claude-opus-4-7' }))
  .tts(greetTts);

gw.flow()
  .stage('greet', {
    audio: 'tts-only',                                    // out 방향만 attach
    onEnter: async (ctx) => {
      await ctx.say('안녕하세요. 1번은 상담, 2번은 콜백, 9번은 종료', greetTts);
    },
    onDtmf: { '1': 'chat', '2': 'callback', '9': 'bye' },
  })
  .stage('chat', {
    audio: 'full',                                         // both 방향 attach
    onEnter: async (ctx) => {
      // 런타임 통화 수신을 AI 파이프라인에 위임
      await aiPipeline.start();
    },
  })
  .stage('callback', {
    audio: 'none',                                         // 오디오 분리, DTMF만
    onEnter: async (ctx) => {
      const r = await ctx.collectDtmf({ maxDigits: 11, terminator: '#', timeoutMs: 15_000 });
      ctx.setVar('callbackNumber', r.digits);
      ctx.transitionTo('confirm');
    },
  })
  .stage('confirm', {
    audio: 'tts-only',
    onEnter: async (ctx) => {
      const num = ctx.getVar<string>('callbackNumber');
      await ctx.say(`${num}로 다시 연락드리겠습니다.`, greetTts);
      ctx.transitionTo('bye');
    },
  })
  .stage('bye', {
    audio: 'tts-only',
    onEnter: async (ctx) => {
      await ctx.say('감사합니다. 안녕히 계세요.', greetTts);
      await ctx.hangup();
    },
  })
  .startStage('greet')
  .start();
```

### Python 예제

```python
from dvgateway import DVGatewayClient
from dvgateway.adapters.tts import ElevenLabsAdapter

greet_tts = ElevenLabsAdapter(api_key=os.environ["ELEVENLABS_KEY"])

async def on_greet(ctx):
    await ctx.say("1번 상담, 2번 콜백, 9번 종료", greet_tts)

async def on_callback(ctx):
    r = await ctx.collect_dtmf(max_digits=11, terminator="#", timeout_ms=15_000)
    ctx.set_var("callback_number", r.digits)
    ctx.transition_to("confirm")

async def on_confirm(ctx):
    num = ctx.get_var("callback_number")
    await ctx.say(f"{num}로 다시 연락드리겠습니다.", greet_tts)
    ctx.transition_to("bye")

async def on_bye(ctx):
    await ctx.say("감사합니다.", greet_tts)
    await ctx.hangup()

(
    gw.flow()
      .stage("greet",    audio="tts-only", on_enter=on_greet,
             on_dtmf={"1": "chat", "2": "callback", "9": "bye"})
      .stage("chat",     audio="full",     on_enter=lambda ctx: aiPipeline.start())
      .stage("callback", audio="none",     on_enter=on_callback)
      .stage("confirm",  audio="tts-only", on_enter=on_confirm)
      .stage("bye",      audio="tts-only", on_enter=on_bye)
      .start_stage("greet")
      .start()
)
```

### FlowContext 헬퍼

`onEnter(ctx)`로 전달되는 컨텍스트는 `linkedId`가 자동 바인딩된 헬퍼들을 노출:

| TypeScript | Python | 설명 |
|------------|--------|------|
| `ctx.say(text, tts)` | `ctx.say(text, tts)` | TTS 합성 + 주입 (현재 통화에) |
| `ctx.playAudio(url, opts?)` | `ctx.play_audio(url, ...)` | URL 오디오 재생 |
| `ctx.collectDtmf(opts?)` | `ctx.collect_dtmf(...)` | DTMF 자릿수 수집 (`client.collectDtmf`와 동일) |
| `ctx.transitionTo(stage)` | `ctx.transition_to(stage)` | 다음 stage로 전환 (onEnter 종료 후 발효) |
| `ctx.hangup()` | `ctx.hangup()` | 통화 종료 + flow 실행 종료 |
| `ctx.setVar(key, value)` | `ctx.set_var(key, value)` | 통화별 임시 변수 저장 |
| `ctx.getVar(key)` | `ctx.get_var(key, default=None)` | 통화별 임시 변수 조회 |
| `ctx.client` | `ctx.client` | 전체 `DVGatewayClient` 접근 (헬퍼 외 메서드 호출용) |
| `ctx.linkedId` | `ctx.linked_id` | 현재 통화 ID |
| `ctx.session` | `ctx.session` | `CallSession` (caller, did, tenantId 등) |

### Stage 전환 규칙

- **`onDtmf` 매핑**: 단일 키 → 다음 stage. 첫 매칭 키가 즉시 발효.
- **명시적 `ctx.transitionTo()`**: `onEnter` 안에서 호출. `onEnter`가 끝난 뒤 발효.
- **DTMF 매핑도 명시 전환도 없는 stage**: 통화 종료까지 holding (예: 종료 인사 → `ctx.hangup()`).
- **stage 전환 사이**: `onExit` (이전 stage) → audio 모드 reconcile (필요 시 detach + 재attach) → `onEnter` (다음 stage).

### `forDid()` — 멀티 흐름 분기

한 게이트웨이에 여러 voice flow를 등록할 경우 DID로 라우팅:

```typescript
gw.flow().forDid('07045144801').stage('vip-greet', {...}).startStage('vip-greet').start();
gw.flow().forDid('07045144802').stage('main-greet', {...}).startStage('main-greet').start();
```

미지정 시 **첫 매칭 flow**가 모든 flow=true 통화를 받습니다.

### 게이트웨이 자원 비교

| 시나리오 | flow=true 사용 | 미사용 (기존) |
|---------|--------------|--------------|
| DTMF 메뉴 1단계 | ExternalMedia/Bridge **없음** | ExternalMedia/Bridge 즉시 생성 |
| TTS 안내 단계 | ExternalMedia 1개 (`out` 방향) | ExternalMedia 1개 (양방향) |
| AI 상담 단계 | ExternalMedia 1개 (`both`) | 동일 |
| 콜백 번호 수집 | ExternalMedia **분리** | 그대로 유지 |
| Asterisk 채널 수 | 단계별 변동 | 통화 시작~종료 내내 고정 |

### 직접 attach/detach (flow 빌더 없이)

VoiceFlow가 표현하지 못하는 동적 시나리오는 직접 호출:

```typescript
// flow=true 통화에 임시 안내 후 다시 detach
await gw.attachAudio(linkedId, 'out');
await gw.say(linkedId, '잠시만요', tts);
await gw.detachAudio(linkedId);

// 상태 조회
const s = await gw.getAudioStatus(linkedId);
// { flowMode: true, attached: false, extMediaId: '', bridgeId: 'dv-spy-...' }
```

`flowMode === false`인 통화는 attach/detach가 의미 없습니다 (이미 StasisStart 시점에 양방향 부착됨) — `attachAudio`는 404를 반환합니다.

### 언제 VoiceFlow를 쓰지 말아야 하는가

- **항상 풀-듀플렉스 AI 대화**: `gw.pipeline()` 단독으로 충분. flow는 오버킬.
- **Click-to-call 발신**: 통화 시작부터 양방향 필요. flow=true 의미 없음.
- **회의 (ConfBridge)**: 다중 참여자 모델은 flow와 호환 안 됨.

---

## 전체 SDK 메서드 레퍼런스

### 통화 제어
| TypeScript | Python | 설명 |
|------------|--------|------|
| `hangup(linkedId)` | `hangup(linked_id)` | 통화 종료 |
| `redirect(linkedId, dest)` | `redirect(linked_id, dest)` | 통화 전환 |
| `warmTransfer({linkedId, destination, ...})` | `warm_transfer(linked_id, destination, ...)` | 웜 트랜스퍼 — 내선/외부 PSTN, whisper 재생 (SDK 측 `TtsAdapter` 또는 gateway TTS), outbound CID/accountcode, mixed audio capture (1.6.6+), `whisper_skip_reason` 진단 코드 (1.6.9+) |
| **`attachAudio(linkedId, dir?)`** | **`attach_audio(linked_id, dir)`** | **통화 중 오디오 스트리밍 부착 (flow=true 통화 전용, gateway 1.3.9.4+)** |
| **`detachAudio(linkedId)`** | **`detach_audio(linked_id)`** | **오디오 분리 — 통화는 holding bridge에 유지** |
| **`getAudioStatus(linkedId)`** | **`get_audio_status(linked_id)`** | **현재 오디오 attach 상태 조회 (flowMode/attached/extMediaId/bridgeId)** |
| **`flow()`** | **`flow()`** | **VoiceFlow 빌더 — stage 그래프 기반 IVR 자동화 (아래 섹션 참조)** |

### 앱 푸시/알림 (모바일 FCM, gateway 1.4.8.0+)
> **모바일 단말용 SDK 설계 카탈로그**(어떤 기능을 단말 SDK로 제공 가능한지 + 보안 경계 + 로드맵): [docs/dvg-mobile-sdk-catalog.md](../docs/dvg-mobile-sdk-catalog.md). TS/Python SDK는 백엔드(신뢰) SDK이므로 단말에 그대로 올리지 않는다(정적 API 키·AI 프로바이더 키 노출 금지).

연동된 모바일 앱(예: makecall) 사용자에게 푸시 전송. gateway가 `extension → userId → fcm_token`(앱 온보딩으로 생성된 매핑)으로 라우팅해 FCM 릴레이(Cloud Function)에 HMAC 서명 전달. 모든 이벤트는 `dvg_event{subtype}` 단일 스키마. 테넌트는 서버가 JWT에서 강제. gateway에 릴레이 미설정 시 503.

| TypeScript | Python | 설명 |
|------------|--------|------|
| **`pushToExtension({extension, subtype, title?, body?, linkedId?, did?, caller?, callerName?, data?})`** | **`push_to_extension(...)`** | **범용 푸시(extension 라우팅). 임의 subtype + data(문자열 맵). did/caller/callerName 은 외부수신 표시·라우팅 필드(선택)** |
| **`pushToUser({email, subtype, title?, body?, linkedId?, did?, caller?, callerName?, data?})`** (gateway 1.4.9.0+) | **`push_to_user(...)`** | **email 라우팅 푸시 — extension 이 아직 없는(email-우선 신규) 사용자용. 릴레이가 email→userId→fcm_token. 일반 알림·외부수신 표시에 사용** |
| **`notifyCallSummary(linkedId, {extension, summaryUrl?, transcriptUrl?, audioUrl?, ...})`** | **`notify_call_summary(...)`** | **통화 종료 후 결과 링크 푸시(subtype=`call_summary`). 최소 1개 URL 필수. 짧은 만료 서명 URL 권장. 앱은 통화이력에 "요약 보기/녹취 듣기"로 노출** |
| **`notifyMissedCall({extension, callerNumber?, callerName?, linkedId?})`** | **`notify_missed_call(...)`** | **부재중 알림(subtype=`missed_call`)** |

> REST: `POST /api/v1/push/extension`, **`POST /api/v1/push/user`** (email 라우팅), `POST /api/v1/push/call-summary/{linkedId}`. 모든 푸시는 `did`(대표번호)/`caller`/`callerName` 를 **extension 유무와 무관하게** 실어 보낼 수 있다 — 외부수신(DVG/IVR/AI 선수신)은 단말 extension 없이 **대표번호(DID)** 로 라우팅·표시되므로(앱 수신 Function 이 accountCode 매칭), self-enroll 후 extension 이 없어도 외부수신/부재중/요약/일반알림은 즉시 동작한다. 단말이 직접 ring 되는 `incoming_softphone` 만 extension 전제. tenantId 는 JWT 강제(본문 신뢰 금지). 페이로드·서명 규약은 [docs/warm-transfer-push-contract.md](../docs/warm-transfer-push-contract.md)·[docs/dvg-mobile-roadmap.md](../docs/dvg-mobile-roadmap.md). 수신 측(Function + 앱 라우팅)은 makecall 레포에서 구현.
>
> **외부수신 자동 푸시 (gateway 1.4.8.14+)**: `GW_PUSH_ON_CALL_NEW=true` (기본 false, 푸시 릴레이 구성 전제) 시, 외부 수신(dir=in + caller 있음) `call:new` 마다 dvg 가 **자동으로** `subtype=incoming_call` 푸시(did/caller/callerName/tenantId/linkedId 포함)를 송신한다. 켜면 makecall 서버가 call:new 를 받아 `/push/*` 를 직접 호출할 필요가 없다. 발신(out)·내부통화·보조채널(caller 없음)은 제외. best-effort 비차단.

### WebRTC 소프트폰 프로비저닝 (gateway 1.4.8.3+ / SDK 1.8.1+)
| TypeScript | Python | 설명 |
|------------|--------|------|
| **`provisionSoftphone({enrollToken?, extension?, deviceId, platform?})`** | **`provision_softphone(device_id, *, enroll_token?, extension?, platform?)`** | **QR 의 1회용 enrollToken 으로 소프트폰 프로비저닝. 반환 `{extension, tenantId?, sip:{wssUri,authUser,authToken,realm,expiresAt}, ice[], refresh:{url,refreshToken,minTtlSeconds}}`. 앱은 `sip.wssUri`(dvg 엣지)로 등록 — PBX 직접 연결 아님** |
| **`refreshSoftphone(refreshToken)`** | **`refresh_softphone(refresh_token)`** | **refreshToken 회전 → 새 sip+ice. `expiresAt - minTtlSeconds` 에 선제 호출. 401(revoke)이면 소프트폰 내리고 click-to-call 폴백** |
| **`createSoftphoneEnrollment(extension)`** (admin) | **`create_softphone_enrollment(extension)`** | **1회용 enrollToken + `dvgprov://enroll?t=&h=` QR URI 발급. tenantPath 는 JWT 에서 서버 강제** |
| **`deprovisionSoftphone({deviceId, extension})`** | **`deprovision_softphone(device_id, extension)`** | **토큰 체인 무효화(로그아웃). PBX device 는 삭제 안 함(운영자 관리)** |

> REST: `POST /api/v1/softphone/{provision,refresh,enroll,deprovision}`. device 는 **운영자가 PBX 관리자 웹에서 생성**(protocol=wss·mobile_client=true), dvg 는 `GET /api/v2/devices` 로 조회만 한다(read-only). 토폴로지·QR·수명 규약은 [docs/webrtc-softphone-provisioning-contract.md](../docs/webrtc-softphone-provisioning-contract.md) 참조.
>
> **⚠️ INTERIM**: device WRITE/secret-rotation API 가 생기기 전까지 `sip.authToken` 은 device 의 **raw PBX secret** 을 그대로 담는다. WRITE API 도입 시 단기 회전 secret 으로 교체되며 **응답 스키마는 불변**이다. `GW_SOFTPHONE_ENABLED` 미설정 시 모든 엔드포인트 503.

### 모바일 사용자 seat 관리 (테넌트별 정원·발급, gateway 1.4.9.0+)
연동된 모바일 앱(makecall) **사용자 정원(seat)** 을 테넌트별로 관리. dvg 가 정원·발급권을 소유하고, **이메일은 식별 라벨로만 저장**한다(검증·인증은 makecall Firebase 가 SSOT — 기존 경계 불변). 발급(enrollment)은 위 소프트폰 `enrollToken` 을 재사용한다. seat 정원은 동시통화 한도와 **별개**다.

| REST 엔드포인트 | 권한 | 설명 |
|---|---|---|
| `GET /api/v1/tenants/{id}/seats` | admin · 본인 테넌트 | seat 목록 + `{limit, used, policy, seats[]}`. seat 에 `admin` 플래그 포함 |
| `GET /api/v1/tenants/{id}/seats/devices?protocol=wss` | admin · 본인 | **내선 후보** — PBX 단말 중 `protocol=wss` 만 `{extension, deviceName, mobileClient}`. seat 의 내선은 이 목록에서만 선택(임의 입력 금지) |
| `POST /api/v1/tenants/{id}/seats` | admin | seat 생성 `{email, extension?, admin?}` → seat + softphone `{enrollToken, qrUri, expiresAt}`. 정원 초과 **409** `seat_limit_exceeded` |
| `POST /api/v1/tenants/{id}/seats/self-enroll` | 본인 테넌트 · admin | **앱 자동 등록**(policy=auto 일 때만). `{email, extension?}` → seat + enrollment. email 기준 **멱등**(재설치/재로그인이 seat 안 늘림). manual 이면 **403** `self_enroll_disabled`, 정원 초과 **409**. `admin:true` 는 무시(권한 상승 방지) |
| `POST /api/v1/tenants/{id}/seats/import` | admin | CSV/JSON 일괄 등록(부분 성공 `created/skipped/errors`). CSV 헤더 `email,extension,admin` |
| `POST /api/v1/tenants/{id}/seats/{seatId}/{suspend\|resume\|archive}` | admin | 보류/재개/보관(archived=정원 슬롯 반환) |
| `POST /api/v1/tenants/{id}/seats/{seatId}/admin` | admin | `{admin:bool}` 관리계정 토글(테넌트 관리 알림/푸시 구분 라벨) |
| `POST /api/v1/tenants/{id}/seats/{seatId}/enroll` | admin | enrollToken 재발급(QR 재전송). softphone 미구성 시 **503**(seat 은 유지) |
| `GET\|PUT /api/v1/tenants/{id}/seats/limit` | admin(PUT) | seat 정원 조회/설정(동시통화 한도와 독립) |
| `GET\|PUT /api/v1/tenants/{id}/seats/policy` | admin(PUT) | 등록 정책 `{policy: "manual"\|"auto"}` |

> **등록 정책**: `manual`(기본)=관리자 사전등록만 / `auto`=앱 self-enroll 허용(정원 내 즉시 active). **자동 등록 흐름**: 앱 → makecall 서버(Firebase 로그인 검증) → dvg `self-enroll` 대행 호출. dvg 는 자신이 발급한 인증(SDK 키→JWT, 본인 테넌트)만 신뢰하고 email 은 라벨로 저장한다. **앱은 dvg 에 직결하지 않는다.** 정원이 무단 가입의 게이트.
>
> SDK 메서드(TS `SeatManager` / Python `seats`)는 후속 SDK 릴리즈에서 추가 예정 — 현재는 REST 직접 호출(makecall 서버). 통합 흐름·필드 상세는 [docs/mobile-app-sdk-guide.md](../docs/mobile-app-sdk-guide.md), 경계·라이프사이클은 [docs/mobile-seats-contract.md](../docs/mobile-seats-contract.md) 참조.

### PBX 관리
| TypeScript | Python | 설명 |
|------------|--------|------|
| `applyChanges()` | `apply_changes()` | PBX 설정 재적용 |
| `clickToCall({caller,callee,...})` | `click_to_call(caller,callee,...)` | 클릭투콜 |

### 착신전환
| TypeScript | Python | 설명 |
|------------|--------|------|
| `getDiversions(ext, tenantId?)` | `get_diversions(ext, tenant_id)` | 착신전환 조회 |
| `setDiversion(ext, type, params)` | `set_diversion(ext, cf_type, ...)` | 착신전환 설정 |
| `deleteDiversion(ext, type)` | `delete_diversion(ext, cf_type)` | 착신전환 해제 |

착신전환 타입: `CFI` (즉시), `CFB` (통화중), `CFN` (부재중), `CFU` (미연결)

### 발신자표시
| TypeScript | Python | 설명 |
|------------|--------|------|
| `getCallerID(ext)` | `get_caller_id(ext)` | 발신자표시 조회 |
| `setCallerID(ext, {name,number,applyChanges})` | `set_caller_id(ext, name, number, apply_changes)` | 발신자표시 변경 |

> `applyChanges: true` → DB 변경 + PBX 재적용을 한번에 처리

### Early Media (응답 전 안내음)
| TypeScript | Python | 설명 |
|------------|--------|------|
| `getEarlyMedia(ext, tenantId?)` | `get_early_media(ext, tenant_id)` | 특정 DID의 Early Media 설정 조회 |
| `setEarlyMedia(ext, {enabled,audioUrl,tts})` | `set_early_media(ext, enabled, audio_url, tts)` | 특정 DID의 Early Media 설정/변경 |
| **`getEarlyMediaDefault(tenantId?)`** | **`get_early_media_default(tenant_id)`** | **테넌트 전체 기본 Early Media 조회 (v1.4+)** |
| **`setEarlyMediaDefault({enabled,audioUrl,tts})`** | **`set_early_media_default(enabled, audio_url, tts)`** | **테넌트 전체 기본 Early Media 설정 (v1.4+)** |
| `DVGatewayClient.EARLY_MEDIA_DEFAULT_EXT` | `DVGatewayClient.EARLY_MEDIA_DEFAULT_EXT` | `"_default"` 상수 — 위 메서드 대신 직접 지정도 가능 |

두 가지 음원 모드 (택일):
- **`audioUrl`**: 외부 URL 자동 다운로드 + ffmpeg WAV 변환 (8kHz mono PCM, 1회성)
- **`tts`**: 클라우드 TTS로 합성 — 대시보드 **프로바이더 API 키** 탭의 테넌트별 키 자동 사용

#### Per-DID 설정 (특정 번호에만 적용)

```typescript
// TypeScript — 특정 DID에 TTS 안내음
await gw.setEarlyMedia('07045144801', {
  enabled: 'yes',
  tts: {
    text: '안녕하세요, 얼쑤팩토리입니다. 잠시만 기다려주세요.',
    provider: 'elevenlabs',  // optional, 미지정 시 대시보드 primary 사용
    voice: '9BWtsMINqrJLrRacOk9x',  // optional
  },
}, 'tenant-id');
```

```python
# Python — 특정 DID에 TTS 안내음
await gw.set_early_media("07045144801",
    enabled="yes",
    tts={
        "text": "안녕하세요, 얼쑤팩토리입니다. 잠시만 기다려주세요.",
        "provider": "elevenlabs",  # optional
    },
    tenant_id="tenant-id")
```

#### 테넌트 기본값 (v1.4+) — 개별 설정 없는 모든 DID에 자동 적용

**다이얼플랜 폴백 순서**:
1. 해당 DID의 개별 설정이 `enabled="yes"` → **그 설정** 사용
2. 아니면 `_default` 프로파일이 `enabled="yes"` → **기본값** 사용
3. 둘 다 활성화 안 됨 → Early Media 스킵

수백 개 DID에 동일한 안내음을 일괄 적용할 때 DID마다 설정할 필요 없이 한 번만 `setEarlyMediaDefault()` 호출하면 됩니다. 특정 DID만 다른 안내음을 원하면 그 DID에만 `setEarlyMedia()` 로 개별 설정 — 개별 설정이 기본값을 자동 오버라이드.

```typescript
// TypeScript — 테넌트 전체 기본 안내음 (편의 메서드)
await gw.setEarlyMediaDefault({
  enabled: 'yes',
  tts: {
    text: '고객센터 상담원 연결 중입니다.',
    provider: 'openai',       // optional
    voice: 'nova',            // optional
  },
});

// 또는 상수로 명시적 지정 (동일 결과)
await gw.setEarlyMedia(
  DVGatewayClient.EARLY_MEDIA_DEFAULT_EXT,
  { enabled: 'yes', tts: { text: '고객센터 상담원 연결 중입니다.' } },
);

// 오디오 URL 기반 기본값
await gw.setEarlyMediaDefault({
  enabled: 'yes',
  audioUrl: 'https://cdn.example.com/brand-jingle.mp3',
});

// 기본값 비활성화 (per-DID 설정은 영향 없음)
await gw.setEarlyMediaDefault({ enabled: 'no' });

// 현재 기본값 조회
const def = await gw.getEarlyMediaDefault();
console.log(def.enabled, def.source, def.ttsText, def.fileExists);
```

```python
# Python — 테넌트 전체 기본 안내음 (편의 메서드)
await gw.set_early_media_default(
    enabled="yes",
    tts={
        "text": "고객센터 상담원 연결 중입니다.",
        "provider": "openai",    # optional
        "voice": "nova",         # optional
    },
)

# 오디오 URL 기반 기본값
await gw.set_early_media_default(
    enabled="yes",
    audio_url="https://cdn.example.com/brand-jingle.mp3",
)

# 기본값 비활성화 (per-DID 설정은 영향 없음)
await gw.set_early_media_default(enabled="no")

# 현재 기본값 조회
default = await gw.get_early_media_default()
print(default["enabled"], default["source"], default["ttsText"], default["fileExists"])

# 또는 상수로 명시적 지정 (동일 결과)
await gw.set_early_media(
    gw.EARLY_MEDIA_DEFAULT_EXT,
    enabled="yes",
    tts={"text": "고객센터 상담원 연결 중입니다."},
)
```

#### 저장 경로 & 주의사항

| 항목 | Per-DID | 기본값 |
|------|---------|--------|
| 파일 경로 | `/var/spool/asterisk/{tenantId}/pa/{DID}/pamsg.wav` | `/var/spool/asterisk/{tenantId}/pa/_default/pamsg.wav` |
| AstDB 키 | `/{tenantId}/earlymedia/{DID}/*` | `/{tenantId}/earlymedia/_default/*` |
| 변환 시점 | 저장 시 1회 ffmpeg 변환 (8kHz mono WAV) | 동일 |
| 다이얼플랜 컨텍스트 | `[dvgateway-pa-noa]` | 동일 (하나의 컨텍스트가 fallback 처리) |

- TTS 메타데이터 (`text`/`provider`/`voice`)는 AstDB에 저장되어 GET 응답에 포함
- `audioUrl`을 업데이트하면 저장 시 즉시 다운로드 + 변환 (통화 시 재다운로드 없음)
- `enabled="no"` 로 설정해도 저장된 `ttsText` / `audioUrl` 값은 유지 (재활성화 시 재사용 가능)
- `_default` extension은 예약어 — 실제 전화번호로는 사용 불가 (밑줄 접두사로 충돌 방지)

### 캠페인 (예약/동보/주기 발신)
| TypeScript | Python | 설명 |
|------------|--------|------|
| `createCampaign(campaign)` | `create_campaign(campaign)` | 캠페인 생성 |
| `listCampaigns()` | `list_campaigns()` | 캠페인 목록 |
| `getCampaign(id)` | `get_campaign(id)` | 캠페인 상세 |
| `updateCampaign(id, updates)` | `update_campaign(id, updates)` | 캠페인 수정 |
| `deleteCampaign(id)` | `delete_campaign(id)` | 캠페인 삭제 |
| `startCampaign(id)` | `start_campaign(id)` | 캠페인 시작 |
| `pauseCampaign(id)` | `pause_campaign(id)` | 일시정지 |
| `resumeCampaign(id)` | `resume_campaign(id)` | 재개 |
| `cancelCampaign(id)` | `cancel_campaign(id)` | 취소 |
| `getCampaignResults(id)` | `get_campaign_results(id)` | 결과 조회 |

### 오디오/TTS
| TypeScript | Python | 설명 |
|------------|--------|------|
| `streamAudio(linkedId, { dir, pipelineType })` | `stream_audio(linked_id, dir, pipeline_type)` | 통화 오디오 수신 스트림. `pipelineType: 's2s'`로 S2S 모드 선언 |
| `injectTts(linkedId, audio)` | `inject_tts(linked_id, audio)` | TTS 오디오 주입 |
| `say(linkedId, text, tts)` | `say(linked_id, text, tts)` | 텍스트→음성 재생 |
| `broadcastTts(confId, audio)` | `broadcast_tts(conf_id, audio)` | 회의 전체 방송 |
| `startThinking(linkedId)` | `start_thinking(linked_id)` | Comfort noise 시작 (dead air 방지) |
| `stopThinking(linkedId)` | `stop_thinking(linked_id)` | Comfort noise 종료 |
| `postVad(linkedId, side, speaking)` | `post_vad(linked_id, side, speaking)` | 대시보드 VAD 인디케이터 전달 (OpenAI Realtime VAD 등) |

### Playback — `mode=lite` 통화용 ARI 직접 재생 (SDK 1.7+, gateway 1.4.3+)

`mode=lite` Stasis 통화는 ExternalMedia·Snoop·Bridge를 만들지 않는 최소 리소스 프로파일입니다 (단순 IVR / 안내 멘트 / DTMF 입력 수집 용도). PCM 스트리밍 주입 경로(`play_audio`, `inject_tts`, `say`)는 ExternalMedia가 필요하므로 lite 통화에선 동작하지 않습니다. 대신:

- **사운드 파일·숫자·톤 재생** → `playback()` (ARI Playback API 직접 호출)
- **자유 텍스트 TTS 재생** → `liteTtsPlayback()` (SDK 1.7.2+, gateway 1.4.5.8+) — 게이트웨이가 합성 → sln16 캐시 → ARI Playback 까지 한 번에 처리

| TypeScript | Python | 설명 |
|------------|--------|------|
| `playback({ linkedId, media })` | `playback(linked_id, media)` | ARI Playback 시작. 즉시 반환되고 `playback_id`를 돌려줍니다. 완료는 `audio:playback` 이벤트(`lifecycle: done`)로 알 수 있습니다 |
| `liteTtsPlayback({ linkedId, text, provider?, voice? })` *(SDK 1.7.2+)* | `lite_tts_playback(linked_id, text, provider=None, voice=None)` | 텍스트 → cloud TTS 합성 → ARI Playback. 동일 (tenant, provider, voice, text) 재호출 시 게이트웨이가 캐시 적중으로 즉시 재생 (`cache_hit=True`). cloud 키 미설정 시 espeak-ng 로컬 폴백. **게이트웨이 1.4.5.8+ 필요** (1.4.5.7 이하는 404) |
| `stopPlayback(linkedId, playbackId)` | `stop_playback(linked_id, playback_id)` | 진행 중인 playback 중단. 이미 끝난 경우도 안전 (no-op). `playback()` / `liteTtsPlayback()` 모두 동일 메서드로 중단 |

**`media` URI 포맷** (Asterisk 규약):
- `sound:hello-world` — `sounds/{lang}/hello-world.{format}`
- `sound:/abs/path-without-ext` — 절대경로, 확장자 자동 감지
- `number:1234` — 숫자 읽어주기 ("천이백삼십사")
- `digits:1234` — 자리별 읽기 ("일 이 삼 사")
- `characters:abc` — 글자 한 자씩 ("에이 비 시")
- `tone:dial` / `tone:busy` 등 — `indications.conf` 톤

**DTMF 수신**: lite 모드에서도 AMI DTMF가 정상 발생하므로 기존 callinfo 이벤트(`call:dtmf`)와 `collectDtmf()` 도우미가 그대로 동작합니다 — SDK 측 추가 코드 없음.

**TypeScript 예시 — 간단 IVR**:
```typescript
const gw = new DVGatewayClient({ baseUrl, auth: { type: 'apiKey', apiKey } });

gw.onCallEvent(async (evt) => {
  if (evt.type !== 'call:new' || evt.session.mode !== 'lite') return;
  const { linkedId } = evt.session;

  // 1) 안내 멘트
  await gw.playback({ linkedId, media: 'sound:welcome' });

  // 2) DTMF 입력 수집 (기존 collectDtmf 그대로 사용)
  const res = await gw.collectDtmf({ linkedId, maxDigits: 4, timeoutMs: 8000 });

  // 3) 수신 번호 읽어주기
  await gw.playback({ linkedId, media: `digits:${res.digits}` });

  // 4) 종료
  await gw.hangup(linkedId);
});
```

**Python 예시**:
```python
async def on_call(evt):
    if evt.type != "call:new" or evt.session.mode != "lite":
        return
    lid = evt.session.linked_id
    await gw.playback(lid, media="sound:welcome")
    res = await gw.collect_dtmf(lid, max_digits=4, timeout_ms=8000)
    await gw.playback(lid, media=f"digits:{res.digits}")
    await gw.hangup(lid)

gw.on_call_event(on_call)
```

**TypeScript 예시 — 자유 텍스트 TTS (1.7.2+)**:
```typescript
gw.onCallEvent(async (evt) => {
  if (evt.type !== 'call:new' || evt.session.mode !== 'lite') return;
  const { linkedId } = evt.session;

  // 1) 동적 안내 멘트 — 사전 녹음 없이 텍스트 그대로 합성
  const customerName = await lookupCustomer(evt.session.callerNum);
  const result = await gw.liteTtsPlayback({
    linkedId,
    text: `${customerName}님 환영합니다. 1번 영업, 2번 기술지원을 눌러주세요.`,
    provider: 'google',  // 옵션 — 미지정 시 테넌트 기본 provider
  });
  console.log('synth:', result.synthesizedBytes, 'bytes', result.cacheHit ? '(캐시)' : '(새로 합성)');

  // 2) DTMF 수집
  const dtmf = await gw.collectDtmf({ linkedId, maxDigits: 1, timeoutMs: 8000 });

  // 3) 응답도 TTS 로
  const reply = dtmf.digits === '1' ? '영업 부서로 연결합니다' : '기술지원 부서로 연결합니다';
  await gw.liteTtsPlayback({ linkedId, text: reply });

  await gw.hangup(linkedId);
});
```

**Python 예시 — 자유 텍스트 TTS (1.7.2+)**:
```python
async def on_call(evt):
    if evt.type != "call:new" or evt.session.mode != "lite":
        return
    lid = evt.session.linked_id

    name = await lookup_customer(evt.session.caller_num)
    result = await gw.lite_tts_playback(
        lid,
        f"{name}님 환영합니다. 1번 영업, 2번 기술지원을 눌러주세요.",
        provider="google",  # None → 테넌트 기본
    )
    print(f"synth: {result.synthesized_bytes} bytes, cache_hit={result.cache_hit}")

    dtmf = await gw.collect_dtmf(lid, max_digits=1, timeout_ms=8000)
    reply = "영업 부서로 연결합니다" if dtmf.digits == "1" else "기술지원 부서로 연결합니다"
    await gw.lite_tts_playback(lid, reply)

    await gw.hangup(lid)

gw.on_call_event(on_call)
```

**`liteTtsPlayback()` 동작 디테일**:
- **캐시 키**: `sha256(tenant | provider | voice | text)`. 같은 인풋 재호출 시 게이트웨이의 디스크 캐시(`GW_TTS_CACHE_DIR`, 기본 `/var/lib/dvgateway/tts-cache/{tenant}/{hash}.sln16`) 에서 바로 ARI Playback — 합성 RTT 0, 응답 보통 50ms 이내. `cache_hit=true` 로 보고.
- **provider/voice 해상**: 명시한 값 > 테넌트 primary 키 > espeak-ng 로컬 폴백. cloud provider 실패 시(예: 키 만료, 네트워크) 자동으로 espeak 로 fallback (영어 음성), 로그 `[PLAYBACK-TTS] cloud synth failed ... falling back to espeak-ng` 남김.
- **저장 형식**: 16 kHz signed-linear PCM (`.sln16`) — Asterisk 네이티브, 트랜스코드 불필요. PBX 의 `asterisk` 사용자가 게이트웨이의 `dvgateway` 사용자와 다른 OS 계정이어도 파일이 world-readable (`0644`) 로 저장돼 그대로 읽힘.
- **중단**: 일반 playback 과 동일하게 `stopPlayback(linkedId, playbackId)` / `stop_playback(linked_id, playback_id)` 호출.
- **이벤트 channel**: `audio:playback` 이벤트가 그대로 발화됨 (`lifecycle: playing → done`). 별도 `tts:playback` 이벤트는 발화되지 않음 (그건 ExternalMedia 기반 `inject_tts` 전용).

**다이얼플랜 예시** (PBX 측 설정):
```ini
exten => _8X.,1,NoOp(간단 IVR — lite 모드)
 same => n,Stasis(dvgateway,mode=lite,did=${EXTEN},callid=${UNIQUEID},tenantid=${TENANTID})
 same => n,Hangup()
```

**언제 lite 모드를 쓰면 좋은가**:
- 단순 안내 멘트 + DTMF 메뉴 (예: "1번 영업, 2번 기술지원")
- 본인 인증 코드 안내 (`digits:`로 번호 읽기)
- 통화 녹음 동의 안내 후 DTMF 컨펌
- STT/LLM/실시간 음성 분석이 **필요 없는** 모든 통화

리소스 절감(통화당): ExtMedia goroutine + Snoop audiohook + Mixing bridge + STT 세션 + ~4KB 오디오 버퍼 + downstream fan-out 4096-슬롯이 통째로 사라집니다. 라이선스 동시통화 카운터·CDR·테넌트 격리·대시보드 표시는 일반 모드와 동일하게 동작합니다.

### 시뮬레이션 (게이트웨이 · 전화번호 불필요)
| TypeScript | Python | 설명 |
|------------|--------|------|
| `simulate({ audioFile, ... })` | `simulate(audio_file=..., ...)` | **로컬 WAV 파일로 가짜 통화 재생 — 파이프라인 동작을 게이트웨이 없이 검증 (v1.4+)** |

`simulate()`는 5가지 용도를 위한 "루프백 게이트웨이"입니다:
1. 온보딩 — 설치 직후 게이트웨이/DID 설정 없이 첫 봇 실행
2. 단위 테스트 — `pytest` / `jest`에서 실제 네트워크 없이 STT→LLM→TTS 검증
3. CI 회귀 테스트 — 대화 로직 변경이 응답 품질에 미치는 영향 자동 확인
4. 문서 "Try it" 위젯 — 브라우저에서 코드 수정 → 음성 출력 재생
5. 오프라인 데모 — 전시장/영업 환경에서 전화망 없이 시연

**동작 방식**: 동일 `pipeline().stt().llm().tts().start()` 코드가 그대로 실행됩니다. `simulate()`가 내부 `WsPool`에 3개의 가상 경로를 설치해:
- `/api/v1/ws/callinfo` → 합성 `call:new` 이벤트 1개 발행 → 오디오 종료 후 `call:ended`
- `/api/v1/ws/stream?linkedid={id}` → WAV 파일을 20ms/프레임으로 주입
- `/api/v1/ws/tts/{linkedId}` → 파이프라인이 주입한 TTS 바이트를 메모리에 캡처

실제 게이트웨이·PBX·전화번호 모두 불필요합니다.

**입력 포맷**: 16 kHz 모노 16-bit PCM WAV 또는 raw slin16. 변환:
```bash
ffmpeg -i input.mp3 -ar 16000 -ac 1 -sample_fmt s16 caller.wav
```

**옵션** (TS/Python 공통, Python은 snake_case):

| 필드 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `audioFile` / `audio_file` | string | (필수) | 재생할 오디오 파일 경로 |
| `linkedId` / `linked_id` | string | `sim-{timestamp}-{hex}` | 통화 식별자 자동 생성 |
| `caller` | string | `'+1-555-0100'` | 합성 발신자 번호 |
| `callerName` / `caller_name` | string | `'Simulated Caller'` | 합성 발신자 이름 |
| `callee` | string | `'100'` | 피호출 내선 |
| `did` | string | callee와 동일 | 대표 번호 |
| `tenantId` / `tenant_id` | string | (없음) | 테넌트 식별자 |
| `realtime` | boolean | `true` | 20ms/프레임 페이싱 (false = CI용 즉시 flush) |
| `hangupDelayMs` / `hangup_delay_ms` | int | `5000` | 오디오 종료 후 `call:ended` 발행까지 대기 (봇이 마지막 TTS를 끝낼 시간) |
| `onTts` / `on_tts` | callback | (없음) | 캡처된 TTS 프레임별 콜백 (옵션) |

**반환값 — `SimulatedCall` 핸들**:

| 메서드 | 설명 |
|--------|------|
| `waitForEnd()` / `wait_for_end()` | 통화 종료까지 대기 (오디오 드레인 + hangup 지연) |
| `stop()` | 즉시 종료 — `call:ended` 발행 후 정리 |
| `capturedTtsBytes()` / `captured_tts_bytes()` | 캡처된 TTS PCM (slin16) |
| `saveTts(path)` / `save_tts(path)` | 캡처된 TTS를 16 kHz 모노 WAV로 저장 |

**TypeScript 예시**:
```typescript
import { DVGatewayClient } from 'dvgateway-sdk';

const gw = new DVGatewayClient({
  baseUrl: 'http://localhost:8080',
  auth: { type: 'apiKey', apiKey: 'simulation' },  // 실제 키 불필요
});

// 파이프라인 시작 (non-awaited — gw.close()까지 실행)
void gw.pipeline().stt(stt).llm(llm).tts(tts).start();

// 가짜 통화 재생
const call = await gw.simulate({
  audioFile: './samples/customer-inquiry.wav',
  caller: '+82-10-1234-5678',
});
await call.waitForEnd();
await call.saveTts('./samples/bot-reply.wav');  // 봇 응답을 WAV로 저장

gw.close();
```

**Python 예시**:
```python
import asyncio
from dvgateway import DVGatewayClient

async def main():
    gw = DVGatewayClient(
        base_url="http://localhost:8080",
        auth={"type": "apiKey", "api_key": "simulation"},
    )

    # 파이프라인 시작 (non-awaited — gw.close()까지 실행)
    asyncio.ensure_future(
        gw.pipeline().stt(stt).llm(llm).tts(tts).start()
    )

    # 가짜 통화 재생
    call = await gw.simulate(
        audio_file="./samples/customer-inquiry.wav",
        caller="+82-10-1234-5678",
    )
    await call.wait_for_end()
    await call.save_tts("./samples/bot-reply.wav")  # 봇 응답을 WAV로 저장

    gw.close()

asyncio.run(main())
```

**주의사항**:
- `simulate()`는 WS 계층에서만 게이트웨이를 대체합니다. `hangup()`, `redirect()`, `startThinking()` 등 **HTTP API 호출은 에러로 실패**합니다 (시뮬레이터가 처리 안 함). 테스트에서는 해당 호출을 목(mock)하거나 try/catch로 감싸세요.
- 멀티테넌트 격리 검증에는 `tenantId` 옵션으로 시나리오별 통화를 분리할 수 있습니다.
- 실제 게이트웨이와 완전히 동일한 동작을 보장하지 않습니다 — ConfBridge, AMI 이벤트 순서 등 복잡한 흐름은 실기 테스트 필요.

### 이벤트/세션
| TypeScript | Python | 설명 |
|------------|--------|------|
| `onCallEvent(handler)` | `on_call_event(handler)` | 전체 통화 이벤트 구독 |
| `on(type, handler)` | `on(event_type, handler)` | 특정 타입 이벤트만 구독 |
| `onTtsComplete(handler)` | `on_tts_complete(handler)` | **TTS 재생 완료 이벤트 구독 (v1.4+)** |
| `listSessions()` | `list_sessions()` | 활성 세션 목록 |

#### 이벤트 타입 목록

| 이벤트 | 발생 시점 | 페이로드 |
|--------|-----------|---------|
| `call:new` | 새 통화 시작 | `session` (CallSession), `tenantId` |
| `call:ended` | 통화 종료 | `linkedId`, `durationSec` |
| **`call:rejected`** *(SDK 1.7.0+ · 게이트웨이 v1.4.4.0+)* | **통화 수용 거부 — 라이선스 전역 한도 또는 테넌트 동시통화 한도 도달** | **`linkedId`, `tenantId`, `reason` (`license_global`/`tenant_limit`), `currentActive` (거부 시점 활성 세션 수), `limit` (도달한 한도), `serverId`** |
| `conf:join` | 회의 참여 | `linkedId`, `confId`, `caller` |
| `conf:leave` | 회의 퇴장 | `linkedId`, `confId` |
| `conf:ended` | 회의 종료 | `confId` |
| **`tts:complete`** | **TTS 재생 완료** | **`linkedId`, `tenantId`, `serverId`** |
| **`call:dtmf`** | **DTMF 키 입력 (AMI DTMFBegin/DTMFEnd 기반)** | **`linkedId`, `digit`, `phase` (`begin`/`end`), `durationMs` (end 단계), `direction` (`received`/`sent`), `tenantId`, `serverId`, `ts`** |
| **`channel:state`** *(SDK 1.5.3+, identity fields SDK 1.6.8+)* | **Asterisk 채널 상태 변화 (AMI Newstate / DialEnd 기반)** | **`linkedId`, `channelId`, `leg` (`a`/`b`), `state` (`ring`/`up`/`down`/`busy`/`no_answer`/`rejected`), `direction` (`inbound`/`outbound`), `sipResponseCode` (선택), `did`/`caller`/`callerName`/`callee` (선택 · 게이트웨이 v1.4.3.1+ · `call:new` 등록 이후의 이벤트에만 채워짐), `tenantId`, `serverId`, `ts`** |
| **`audio:playback`** *(SDK 1.6.0+)* | **`play_audio()` 라이프사이클** | **`linkedId`, `playbackId`, `url`, `phase` (`start`/`complete`/`canceled`/`failed`), `durationMs`, `errorReason` (failed 시), `tenantId`, `serverId`, `ts`** |
| **`tts:playback`** *(SDK 1.6.1+)* | **`inject_tts()` 라이프사이클** | **`linkedId`, `injectId`, `phase` (`start`/`complete`/`canceled`/`failed`), `durationMs` (frames × 20ms — RTP-paced), `errorReason` (canceled: `preempted`/`barge_in`/`hangup`/`user_request` · failed: `channel_lost`/`playback_failed`), `tenantId`, `serverId`, `ts`** |

#### `channel:state` 이벤트 — B-leg 응답 감지 (click-to-call 핵심)

**SDK 1.5.3+** (게이트웨이 **v1.3.9.1+** 필요) — outbound click-to-call 통화에서 **callee(B-leg)가 실제로 받은 시점**을 명시 신호로 노출합니다. EXEC_AA 자동응답 후 RTP 첫 청크는 ringback 중에도 도착하므로, "첫 청크 = answer" 휴리스틱으로 greeting 을 재생하면 callee 가 들을 수 없습니다. 이 이벤트로 정확한 응답 시점에 동기화하세요.

**상태 enum**:

| state | 의미 | 출처 |
|-------|------|------|
| `ring` | SIP 180 Ringing 또는 Asterisk Ring | AMI Newstate (Ring/Ringing) |
| `up` | 수신측 응답 (SIP 200 OK + 채널 Up) | AMI Newstate (Up) |
| `down` | 채널 종료 / 행업 | AMI Newstate (Down) |
| `busy` | 통화중 (SIP 486) | AMI DialEnd (BUSY) |
| `no_answer` | 시간내 무응답 (SIP 487) | AMI DialEnd (NOANSWER) |
| `rejected` | 거절 (SIP 603 / 회선 불가) | AMI DialEnd (CANCEL/CONGESTION/CHANUNAVAIL) |

**leg 구분**: `a` = 게이트웨이 측 originating 채널 (uniqueid==linkedid), `b` = Dial/Originate 로 생성된 후속 채널. Click-to-call 에서 `b` = 외부 callee, 인바운드에서는 `a` = 외부 caller (originating leg). 다중 leg 흐름(예: agent 재시도)은 모두 `b` 로 합쳐지므로 `channelId` 로 구분.

**`sipResponseCode`**: 현 MVP 에선 비어있을 수 있음(`None`/`undefined`). 향후 dialplan 변수 + Hangup cause 매핑으로 채워질 예정. billing 면제(미응답 통화) 판정 등 진단용으로 활용 가능.

**Wire format**:

```json
{
  "event": "channel:state",
  "linkedId": "1777432210.78",
  "channelId": "1777432210.79",
  "leg": "b",
  "state": "up",
  "direction": "outbound",
  "sipResponseCode": 200,
  "did": "025550100",
  "caller": "01012345678",
  "callerName": "Hong Gildong",
  "callee": "1001",
  "tenantId": "tenant-xyz",
  "serverId": "gw-seoul-01",
  "ts": 1713779200123
}
```

> **신규 필드** (게이트웨이 v1.4.3.1+ · SDK 1.6.8+): `did`/`caller`/`callerName`/`callee` 는 `call:new` 가 registry 에 세션을 등록한 *뒤* 발생한 `channel:state` 이벤트에만 채워집니다. 그 이전(매우 이른 Newstate)에는 비어 있을 수 있으니 `if event.caller:` 패턴으로 가드하세요. SDK 는 빈 문자열도 `undefined`/`None` 으로 정규화합니다.

**Python**:

```python
from dvgateway import ChannelStateChangeEvent

async def on_state(event: ChannelStateChangeEvent) -> None:
    if event.leg == "b" and event.state == "up":
        # B-leg answered — greeting 재생 시작
        await gw.inject_tts(event.linked_id, greeting_audio())
    elif event.leg == "b" and event.state in ("busy", "no_answer", "rejected"):
        log.info("call failed: %s sip=%s", event.state, event.sip_response_code)

gw.on_channel_state(on_state)
```

**TypeScript**:

```typescript
gw.onChannelState(async (event) => {
  if (event.leg === 'b' && event.state === 'up') {
    await gw.injectTts(event.linkedId, greetingAudio());
  } else if (event.leg === 'b' && ['busy', 'no_answer', 'rejected'].includes(event.state)) {
    console.log(`call failed: ${event.state} sip=${event.sipResponseCode ?? 'n/a'}`);
  }
});
```

**마이그레이션 (RTP-first-chunk 휴리스틱 제거)**:

```python
# Before — 부정확 (ringback 중 발화)
gw.on_audio(lambda chunk: start_greeting() if first_chunk else None)

# After — B-leg up 시점에 정확히 발화
gw.on_channel_state(lambda e: start_greeting() if e.leg == "b" and e.state == "up" else None)
```

**호환성 가드** (구버전 SDK 사용 가능성이 있는 application 코드):

```python
if hasattr(gw, "on_channel_state"):
    gw.on_channel_state(on_state)
else:
    # 1.0.x 폴백: 기존 휴리스틱 유지
    ...
```

#### `call:rejected` 이벤트 — 동시통화 한도 초과 감지

**SDK 1.7.0+** (게이트웨이 **v1.4.4.0+** 필요) — 새 통화가 라이선스 전역 한도 또는 테넌트별 동시통화 한도에 막혀 게이트웨이가 수용을 거부했을 때 발사됩니다. 이벤트가 도착하는 시점에는 WebSocket 연결이 이미 닫혔거나 ConfBridge 참여자가 강제 퇴장된 상태이므로 **순수 알림(informational)** 입니다 — 게이트웨이 측 정리는 끝났고, SDK 측은 사용자에게 "capacity exceeded" UI/메트릭만 노출하면 됩니다.

**`reason` enum**:

| reason | 의미 | 트리거 |
|--------|------|--------|
| `license_global` | 게이트웨이 라이선스의 `maxConcurrentCalls` 도달 | 모든 테넌트 합산 활성 세션 = 한도 |
| `tenant_limit` | 해당 테넌트의 `TENANT_LIMITS` / `/api/v1/config/tenant-limits` 한도 도달 | 단일 테넌트 활성 세션 = 테넌트 한도 |

**Wire format** (`/api/v1/ws/callinfo`):

```json
{
  "event": "call:rejected",
  "linkedId": "1775805184.495",
  "tenantId": "tenant-a",
  "reason": "tenant_limit",
  "currentActive": 5,
  "limit": 5,
  "serverId": "gw-seoul-01"
}
```

**라우팅**: `call:new` / `call:ended` 와 동일한 fail-CLOSED 테넌트 필터를 사용 — admin 토큰은 모든 거부 이벤트를 수신하고, 테넌트 토큰은 자기 테넌트의 거부만 수신합니다. 다른 테넌트의 한도 초과는 노출되지 않습니다.

**활용 예** (테넌트 SDK 측):

```typescript
gw.on('call:rejected', (event) => {
  console.warn(`call rejected reason=${event.reason} ${event.currentActive}/${event.limit}`);
  metrics.incrCounter('calls_rejected', { reason: event.reason });
  // 호출자에게 "현재 동시통화 한도에 도달했습니다" 안내
});
```

```python
@gw.on("call:rejected")
async def on_rejected(evt):
    logger.warning("call rejected linked=%s reason=%s %d/%d",
                   evt.linked_id, evt.reason, evt.current_active, evt.limit)
```

> **참고**: 한도는 게이트웨이 측에서 hot-reloadable 합니다. admin 토큰으로 `PUT /api/v1/config/tenant-limits` (body: `{"tenant-a":5,"tenant-b":10}`) 또는 대시보드 "👥 테넌트 동시통화 한도" 탭에서 변경하면 즉시 반영됩니다. 게이트웨이 재시작 불필요.

#### `audio:playback` 이벤트 — `play_audio()` 라이프사이클 정확 측정

**SDK 1.6.0+** (게이트웨이 **v1.3.9.2+** 필요) — `gw.play_audio(url)` 호출의 **실제 재생 완료 시점**을 명시 신호로 노출합니다. DTMF 안내 오디오 + 키 입력 수집 시 보수 추정(`base_timeout + 8s`) 으로 처리하던 부채를 정확 측정으로 회수합니다.

**phase 계약** — 재생 1회당 정확히 **1개**의 terminal phase 발사:

| phase | 의미 | 비고 |
|-------|------|------|
| `start` | PCM 주입 시작 직전 | `durationMs`=0, 선택적 |
| `complete` | 모든 PCM 프레임이 Asterisk 로 전송 완료 | `durationMs` = 실제 재생 길이 |
| `canceled` | `DELETE /api/v1/play/{linkedId}` 또는 `interruptOnDtmf` 키 입력 | `durationMs` = 중단까지 경과 |
| `failed` | 재생 중 오류 | `errorReason` 필드로 분류 |

**`errorReason` 분류** (failed 시):

| 값 | 의미 | retry 권장? |
|-----|------|------------|
| `fetch_failed` | URL 다운로드 / 캐시 실패 | ✅ (일시적 네트워크 오류) |
| `decode_failed` | 트랜스코드 / 포맷 오류 | ❌ (재시도 무의미) |
| `channel_lost` | RTP/WS to Asterisk 단절 (통화 hangup) | ❌ (통화 자체 종료) |
| `playback_failed` | 일반 player 오류 | ⚠️ 케이스별 판단 |

**`playback_id` 매칭**: `gw.play_audio()`/`gw.playAudio()` 가 반환하는 `playback_id`/`playbackId` 와 이벤트의 `playback_id` 가 일치할 때만 처리. 한 통화에 여러 audio 가 순차 재생될 때 정확한 매칭에 필수.

**Wire format**:

```json
{
  "event": "audio:playback",
  "linkedId": "1777432210.78",
  "playbackId": "9f4c3e12-…",
  "url": "https://cdn.example.com/menu.wav",
  "phase": "complete",
  "durationMs": 4860,
  "errorReason": "",
  "tenantId": "tenant-xyz",
  "serverId": "gw-seoul-01",
  "ts": 1713779200123
}
```

**Python — DTMF 안내 + 정확한 timeout 보강**:

```python
# Before — 보수 추정 (안내가 4초든 30초든 +8s 일괄)
prompt_task = asyncio.ensure_future(gw.play_audio(linked_id, prompt_url))
effective_timeout_ms = base_timeout_ms + 8000  # 마법 상수

# After — 정확 측정
res = await gw.play_audio(linked_id, prompt_url, wait_for_completion=False)
playback_id = res.playback_id
audio_done = asyncio.Event()
actual_ms = 0

async def on_pb(ev: AudioPlaybackEvent) -> None:
    nonlocal actual_ms
    if ev.playback_id != playback_id:
        return
    if ev.phase in ("complete", "canceled", "failed"):
        actual_ms = ev.duration_ms or 0
        audio_done.set()

unsub = gw.on_audio_playback(on_pb)
try:
    await asyncio.wait_for(audio_done.wait(), timeout=30.0)
    effective_timeout_ms = base_timeout_ms + actual_ms + 500  # 정확
except asyncio.TimeoutError:
    effective_timeout_ms = base_timeout_ms + 8000  # fail-safe 폴백
finally:
    unsub()
```

**TypeScript — `flow.play_audio` 노드 정확한 라우팅**:

```typescript
const { playbackId } = await gw.playAudio({ linkedId, url, waitForCompletion: false });

const unsub = gw.onAudioPlayback((ev) => {
  if (ev.playbackId !== playbackId) return;
  switch (ev.phase) {
    case 'complete': onSuccess(ev.durationMs); break;       // ✓ 끝까지 재생
    case 'canceled': onSuccess(ev.durationMs); break;       // 사용자 키 입력으로 중단 (의도적)
    case 'failed':
      if (ev.errorReason === 'fetch_failed') retry();        // 일시적 — retry
      else onError(ev.errorReason);                          // 영구적 — on_error 라우팅
      break;
  }
  unsub();
});
```

**호환성 가드**:

```python
if hasattr(gw, "on_audio_playback"):
    gw.on_audio_playback(on_pb)
else:
    # 1.5.x 폴백: 8s 보수 추정 유지
    effective_timeout_ms = base_timeout_ms + 8000
```

#### `tts:playback` 이벤트 — `inject_tts()` 라이프사이클 정확 측정

**SDK 1.6.1+** (게이트웨이 **v1.3.9.3+** 필요) — `gw.inject_tts(...)` (스트리밍 PCM 주입) 의 라이프사이클을 명시 신호로 노출합니다. `audio:playback` 의 inject_tts 버전 — 같은 phase 계약 + `inject_id` 상관관계 + cancel 사유 분리.

**왜 필요한가**: 기존 `tts:complete` 는 모든 terminal phase 에 발사되지만 `linkedId` 만 노출 — "정상 종료" / "선점됨" / "barge-in" / "channel_lost" 를 구분할 수 없었습니다. `tts:playback` 은 이 차이를 명시적으로 surface 합니다.

**phase 계약** — 주입 1회당 정확히 **1개**의 terminal phase 발사:

| phase | 의미 | 비고 |
|-------|------|------|
| `start` | PCM 프레임 송출 시작 직전 | `durationMs`=0, 선택적 |
| `complete` | 모든 PCM 프레임이 Asterisk 로 전송 완료 | `durationMs` = frames × 20ms (게이트웨이 ticker 정확 페이싱) |
| `canceled` | 자연 EOF 이전에 중단 | `errorReason` 으로 사유 분류 |
| `failed` | 재생 중 오류 | `errorReason` 으로 분류 |

**`errorReason` 분류**:

| phase | 값 | 의미 |
|-------|-----|------|
| `canceled` | `preempted` | 같은 통화에 새 `inject_tts()` 가 들어와 기존 재생을 끊음 (가장 흔함) |
| `canceled` | `barge_in` | 게이트웨이 측 VAD 가 caller 발화를 감지해 TTS 자동 중단 |
| `canceled` | `hangup` | 통화 종료가 재생 중 발생 |
| `canceled` | `user_request` | `DELETE /api/v1/tts/{lid}` 또는 `{"cmd":"stop"}` |
| `failed` | `channel_lost` | Asterisk WebSocket 끊김 (통화 hangup 가능성 높음) |
| `failed` | `playback_failed` | 일반 player 오류 |

**`inject_id` 매칭**: `gw.inject_tts()` / `gw.injectTts()` 가 `InjectTtsResult { inject_id }` 반환. 한 통화에 여러 TTS 가 순차 주입될 때 phase=canceled (이전 주입 선점) 와 phase=complete (현재 주입 종료) 를 정확히 구분하려면 매칭 필수. **선점된 (preempted) 세션도 자기 inject_id 로 phase=canceled 이벤트가 발사**되므로 양쪽 ID 모두 추적 가능.

**Wire format**:

```json
{
  "event": "tts:playback",
  "linkedId": "1777432210.78",
  "injectId": "tts-9f4c3e12-…",
  "phase": "complete",
  "durationMs": 2640,
  "errorReason": "",
  "tenantId": "tenant-xyz",
  "serverId": "gw-seoul-01",
  "ts": 1713779200123
}
```

**Python — `wait_tts_playback` 단순화 (makecall 마이그레이션)**:

```python
# Before — 시간 기반 추정 (CLAUDE.md "이벤트 기반 개발 원칙" 위반)
async def wait_tts_playback_old(linked_id: str, audio_duration_ms: int):
    inject_start = time.time()
    await gw.inject_tts(linked_id, audio_chunks)
    await tts_complete_evt.wait()                              # 전송 완료
    elapsed_ms = (time.time() - inject_start) * 1000
    remaining_ms = audio_duration_ms - elapsed_ms + 500        # 시간 추정
    if remaining_ms > 50:
        await asyncio.sleep(remaining_ms / 1000)               # ← sleep 위반
    await asyncio.sleep(0.2)                                   # ← jitter drain sleep

# After — 이벤트 기반, sleep 0개
async def wait_tts_playback_new(linked_id: str):
    result = await gw.inject_tts(linked_id, audio_chunks)
    done = asyncio.Event()
    captured_phase: str = ""

    def on_tp(ev: TtsPlaybackEvent) -> None:
        nonlocal captured_phase
        if ev.inject_id != result.inject_id:
            return
        if ev.phase in ("complete", "canceled", "failed"):
            captured_phase = ev.phase
            done.set()

    unsub = gw.on_tts_playback(on_tp)
    try:
        await done.wait()
    finally:
        unsub()
    return captured_phase  # 호출자가 phase 별 라우팅
```

**TypeScript — TTS 시퀀스 chaining**:

```typescript
// 인사 → 메뉴 안내를 차례로, 각 inject 의 진짜 끝 시점 대기
const r1 = await gw.injectTts(linkedId, greetingAudio());
await waitTtsTerminal(gw, r1.injectId);
const r2 = await gw.injectTts(linkedId, menuAudio());
await waitTtsTerminal(gw, r2.injectId);

async function waitTtsTerminal(gw: DVGatewayClient, injectId: string): Promise<void> {
  return new Promise((resolve) => {
    const unsub = gw.onTtsPlayback((ev) => {
      if (ev.injectId !== injectId) return;
      if (ev.phase === 'complete' || ev.phase === 'canceled' || ev.phase === 'failed') {
        unsub();
        resolve();
      }
    });
  });
}
```

**호환성 가드**:

```python
if hasattr(gw, "on_tts_playback"):
    # SDK 1.6.1+ — 정확 신호
    gw.on_tts_playback(on_tp)
else:
    # SDK <1.6.1 폴백 — 기존 tts:complete 사용
    gw.on_tts_complete(lambda ev: done.set())  # phase 구분 불가, 단순 종료만
```

```typescript
if ('onTtsPlayback' in gw) {
  gw.onTtsPlayback(handler);
} else {
  gw.onTtsComplete((ev) => handler({
    type: 'tts:playback',
    linkedId: ev.linkedId,
    injectId: '', // 빈 — 폴백 모드는 inject_id 없음
    phase: 'complete',
    timestamp: ev.timestamp,
  } as TtsPlaybackEvent));
}
```

**타이밍 정확도 — 측정 결과**:

게이트웨이 ticker 가 20ms strict 페이싱이므로 `phase=complete` 의 `durationMs` 는 결정론적입니다. 실측 (2026-04-29 production 로그):

| 오디오 길이 | frames | 측정 delta | 일치 |
|---|---|---|---|
| 2.6s | 132 | 2640ms (132 × 20) | ✓ |
| 519ms (barge-in) | 25 | 500ms (25 × 20) | ✓ |

게이트웨이 → Asterisk 전송 완료 ≈ 실제 RTP-end 시점 (Asterisk 측 jitter buffer drain ~20-100ms 가 잔여 — 일반 voice-bot turn-taking 에는 무시 가능).

#### `call:dtmf` 이벤트 — 통화 중 키패드 입력 감지

게이트웨이는 Asterisk AMI `DTMFBegin` / `DTMFEnd` 이벤트를 수신해 `call:dtmf` 이벤트로 전달합니다. IVR 입력, 전화기 단축키, 회의 제어 등에 사용하세요.

게이트웨이 환경 변수:
- `GW_DTMF_ENABLED` (기본 `true`) — 전체 스위치.
- `GW_DTMF_PHASE_FILTER` (기본 `end`) — `end`만 발행 (duration 포함), `both`로 설정하면 `begin`도 함께 발행.

CDR에도 통화 종료 시 집계(`dtmfCount`, `dtmfDigits`)가 자동으로 기록됩니다.

##### `collect_dtmf()` / `collectDtmf()` — DTMF 자릿수 수집 (Python · TypeScript, P0)

IVR 시나리오에서 PIN/메뉴 선택 등 여러 자리의 DTMF를 한 번에 수집하는 고수준 헬퍼입니다. 내부에서 `call:dtmf` 이벤트를 구독하고 `max_digits`, `terminator`, 타임아웃 조건 중 먼저 도래하는 것으로 완료합니다. 수집 중에는 STT 파이프라인을 자동 음소거하여 DTMF 톤이 단어로 전사되는 것을 방지합니다.

```python
result = await gw.collect_dtmf(
    linked_id,
    max_digits=4,
    timeout_ms=8_000,            # 첫 키 대기 (ms)
    inter_digit_timeout_ms=3_000, # 자릿수 간 대기 (ms)
    terminator="#",              # 종료 키 ("" 이면 비활성)
    mute_stt=True,                # 수집 중 STT 자동 mute (기본 True)
)
# DTMFResult(digits="1234", timed_out=False, terminated_by_key=True)
```

TypeScript:

```typescript
const result = await gw.collectDtmf({
  linkedId,
  maxDigits: 4,
  timeoutMs: 8_000,               // 첫 키 대기 (ms)
  interDigitTimeoutMs: 3_000,     // 자릿수 간 대기 (ms)
  terminator: '#',                // 종료 키 ("" 이면 비활성)
  muteStt: true,                  // 수집 중 STT 자동 mute (기본 true)
});
// { digits: "1234", timedOut: false, terminatedByKey: true }
```

완료 조건(먼저 도래하는 것):
1. `max_digits` 자리 누적
2. `terminator` 키 수신 (해당 키는 `digits`에 포함되지 않고 `terminated_by_key=True`로 보고)
3. 첫 키 타임아웃(`timeout_ms`) — `digits=""`, `timed_out=True`
4. 자릿수 간 타임아웃(`inter_digit_timeout_ms`) — 부분 수집된 `digits`, `timed_out=True`

동일 `linked_id`에 대한 동시 `collect_dtmf()` 호출은 각각 독립적으로 수집되며, STT mute는 reference count로 관리됩니다(마지막 홀더가 해제할 때만 실제 unmute).

##### `mute_stt()` / `unmute_stt()` · `muteStt()` / `unmuteStt()` — STT 음소거 제어 (Python · TypeScript, P0)

특정 `linked_id`에 대해 게이트웨이의 STT 파이프라인을 일시 중단합니다. mute 상태에서는 오디오 프레임이 STT 프로바이더로 전달되기 전에 drop됩니다. 주 용도는 `collect_dtmf()`이지만 DTMF 이외의 경우(예: 보류음 재생)에도 직접 사용 가능합니다.

```python
await gw.mute_stt(linked_id, duration_ms=5_000)  # 5초 뒤 자동 해제
await gw.mute_stt(linked_id)                     # 명시적 unmute 전까지 유지
await gw.unmute_stt(linked_id)                   # 즉시 해제 (모든 holder drop)
```

TypeScript:

```typescript
await gw.muteStt(linkedId, 5_000);   // 5초 뒤 자동 해제
await gw.muteStt(linkedId);           // 명시적 unmute 전까지 유지
await gw.unmuteStt(linkedId);         // 즉시 해제 (모든 holder drop)
```

게이트웨이 환경 변수:
- `GW_STT_MUTE_ENABLED` (기본 `true`) — 기능 자체 토글. `false`면 API 호출은 200을 반환하지만 실제 드롭은 수행되지 않음.

게이트웨이 REST:
- `POST /api/v1/stt/{linkedId}/mute[?duration_ms=N]` — mute (ref-count +1)
- `DELETE /api/v1/stt/{linkedId}/mute` — 즉시 force-unmute (모든 holder drop)
- `GET  /api/v1/stt/{linkedId}/mute` — 현재 상태 (`{"muted": bool, "until": iso8601|null}`)

##### `play_audio()` / `stop_audio()` · `playAudio()` / `stopAudio()` — URL 오디오 재생 (Python · TypeScript, P1)

URL로 지정한 오디오 파일(mp3/wav/ogg)을 통화에 주입합니다. 게이트웨이가 16kHz mono PCM으로 자동 변환하여 재생하며, 선택적으로 DTMF 입력 시 즉시 중단할 수 있습니다(동의 수집/법적 고지/IVR 프롬프트에 적합).

Python:

```python
result = await gw.play_audio(
    linked_id,
    url="https://cdn.example.com/legal-notice.mp3",
    loop=False,
    interrupt_on_dtmf=True,        # 아무 숫자키 누르면 즉시 중단
    wait_for_completion=True,       # 재생 완료까지 대기 (기본 True)
)
# result.completed: bool
# result.interrupted_by_dtmf: "1" 등 digit 또는 None (빈 문자열은 None으로 정규화)
# result.duration_ms: int
if result.interrupted_by_dtmf == "1":
    await process_consent(linked_id)

await gw.stop_audio(linked_id)     # 진행 중 재생 즉시 중단
```

TypeScript:

```typescript
const result = await gw.playAudio({
  linkedId,
  url: 'https://cdn.example.com/legal-notice.mp3',
  loop: false,
  interruptOnDtmf: true,
  waitForCompletion: true,
});
// result.completed: boolean
// result.interruptedByDtmf: string | null  (빈 문자열은 null로 정규화)
// result.durationMs: number
if (result.interruptedByDtmf === '1') {
  await processConsent(linkedId);
}

await gw.stopAudio(linkedId);
```

동작 규칙:
- `wait_for_completion=False` / `waitForCompletion=false` 일 때 게이트웨이는 202를 반환하고 백그라운드에서 재생. SDK는 즉시 `PlayAudioResult(completed=False, interrupted_by_dtmf=None, duration_ms=0)` 반환.
- 빈 `url`은 SDK 단계에서 `ValueError` / `Error('url is required')` 발생.
- 서버 응답의 `interruptedByDtmf` 빈 문자열은 Python/TS 모두 `None` / `null` 로 정규화.

게이트웨이 REST:
- `POST /api/v1/play/{linkedId}` — body: `{url, loop, interruptOnDtmf, waitForCompletion}`
- `DELETE /api/v1/play/{linkedId}` — 진행 중 재생 중단

##### `warm_transfer()` · `warmTransfer()` — 웜 트랜스퍼 (Python · TypeScript, P2)

활성 통화를 에이전트 내선 또는 외부 PSTN 번호로 웜 트랜스퍼합니다. 게이트웨이가 `destination`으로 새 레그를 Originate하고, 선택적으로 에이전트에 귓속말(whisper) 프롬프트를 재생한 뒤, 콜러와 에이전트를 브릿지합니다. `timeout_ms` 안에 응답이 없으면 타임아웃 처리되며 원본 통화는 유지됩니다.

`outbound=True`/`outbound: true` 를 지정하면 `destination`을 PJSIP 내부 peer 가 아닌 다이얼플랜 컨텍스트(`Local/{destination}@{context}`)로 라우팅합니다 — 외부 휴대폰/유선번호로 트렁크를 통해 발신할 때 필요합니다. 이 모드에서 `cid_number` / `cid_name` / `account_code` 가 트렁크 측 caller-ID 와 CDR 에 반영됩니다.

Whisper TTS 는 두 가지 모드로 동작합니다:

1. **SDK-side 합성 (권장)** — `whisper_tts` / `whisperTts` 에 직접 보유한 `TtsAdapter` (ElevenLabs / OpenAI / Gemini 등) 를 전달. SDK 가 사용자 API 키로 로컬 합성 후 PCM 을 게이트웨이로 전송. **프로바이더 키가 게이트웨이를 거치지 않음** (보안 우선). `client.say()` 와 동일한 패턴.
2. **Gateway-side 합성 (관리형)** — `whisper_text` / `whisperText` 만 전달. 게이트웨이가 `/etc/dvgateway/apikeys/<tenantId>.json` 의 테넌트별 클라우드 TTS 설정(`/api/v1/tts/synthesize` 와 동일한 프로바이더)으로 서버에서 합성.

두 경로 모두 실패하면 `whisper_played=False` 이고 `whisper_skip_reason` 에 사유 코드가 포함됩니다. 트랜스퍼 자체는 항상 영향 없음 — whisper 는 best-effort.

Python — 내부 내선 (관리형, 게이트웨이 측 TTS):

```python
result = await gw.warm_transfer(
    linked_id,
    destination="1001",
    whisper_text="VIP 고객입니다",
    hold_audio_url="https://cdn.example.com/hold.mp3",
    context="from-internal",      # 기본값
    timeout_ms=30_000,             # 기본 30s
)
```

Python — 외부 PSTN, SDK 보유 TTS 프로바이더 사용 (권장):

```python
from dvgateway.adapters.tts import ElevenLabsAdapter

tts = ElevenLabsAdapter(
    api_key=os.environ["ELEVENLABS_KEY"],
    voice_id="21m00Tcm4TlvDq8ikWAM",
)

result = await gw.warm_transfer(
    linked_id,
    destination="01026132471",
    outbound=True,
    context="cos-all",                # 트렁크 다이얼플랜 컨텍스트
    cid_number="16682471",
    cid_name="회사명",
    account_code="07045144800",
    whisper_text="고객: 홍길동, 용건: 환불 문의",
    whisper_tts=tts,                  # ← 사용자 키로 SDK 측 합성
    hold_audio_url="https://cdn.example.com/hold.mp3",
    timeout_ms=90_000,
)
# result.connected: bool
# result.timed_out: bool
# result.error: str | None                  (빈 문자열은 None으로 정규화)
# result.agent_channel: str | None          ("PJSIP/...-...")
# result.bridge_id: str | None              ("bridge-xyz")
# result.whisper_played: bool
# result.whisper_skip_reason: str | None    ("no_tts_provider" / "synthesize_failed" /
#                                            "bad_pcm_format" / "play_failed" /
#                                            "timeout" / "cancelled" / None)
if result.connected:
    print(f"bridged: agent={result.agent_channel}")
    if not result.whisper_played:
        print(f"whisper 스킵: {result.whisper_skip_reason}")
elif result.timed_out:
    await gw.say(linked_id, "담당자 연결에 실패했습니다.", tts)
```

TypeScript:

```typescript
import { ElevenLabsAdapter } from 'dvgateway-adapters';

const tts = new ElevenLabsAdapter({
  apiKey: process.env.ELEVENLABS_KEY!,
  voiceId: '21m00Tcm4TlvDq8ikWAM',
});

const result = await gw.warmTransfer({
  linkedId,
  destination: '01026132471',
  outbound: true,
  context: 'cos-all',
  cidNumber: '16682471',
  cidName: '회사명',
  accountCode: '07045144800',
  whisperText: '고객: 홍길동, 용건: 환불 문의',
  whisperTts: tts,                    // ← 사용자 키로 SDK 측 합성
  holdAudioUrl: 'https://cdn.example.com/hold.mp3',
  timeoutMs: 90_000,
});
if (result.connected && !result.whisperPlayed) {
  console.warn('whisper 스킵:', result.whisperSkipReason);
}
```

동작 규칙:
- 빈 `destination` → Python `ValueError` / TS `Error('destination is required')`.
- `timeout_ms` / `timeoutMs` 가 0 이하 → Python `ValueError` / TS `Error('timeoutMs must be > 0')`.
- `whisper_text`, `hold_audio_url`, `cid_number`, `cid_name`, `account_code` 빈 문자열이면 body 에서 생략됩니다.
- `whisper_tts` 가 있고 `whisper_text` 가 비어 있으면 합성을 시도하지 않고 body 에 `whisperPcm` 포함되지 않습니다 (no-op).
- `whisper_tts` 가 0 바이트 PCM 을 반환하면 SDK 가 `whisperPcm` 을 생략 → 게이트웨이가 `whisper_text` 로 fallback (`whisper_skip_reason="no_tts_provider"` 가능).
- 응답의 `error` / `agentChannel` / `bridgeId` / `whisperSkipReason` 빈 문자열은 Python/TS 모두 `None` / `null` 로 정규화.
- 네트워크 오류는 기존 HTTP transport 예외가 그대로 전파됩니다.

**Whisper 동작 조건**:
- SDK-side: 사용자가 보유한 `TtsAdapter` 가 `synthesize(text)` 로 16 kHz mono 16-bit slin16 PCM 청크를 emit 해야 합니다 (`ElevenLabsAdapter`, `OpenAITtsAdapter`, `GeminiTtsAdapter`, `CosyVoiceAdapter` 등 내장 어댑터 모두 충족).
- Gateway-side: 게이트웨이가 활성 클라우드 TTS 프로바이더(`/etc/dvgateway/apikeys/<tenantId>.json` 또는 `/api/v1/config/apikeys` 로 설정) 를 갖고 있어야 합니다. 없으면 `whisper_skip_reason="no_tts_provider"` 로 스킵.
- 게이트웨이는 PCM 을 `GW_WARM_TRANSFER_WHISPER_DIR`(기본 `/var/lib/dvgateway/whisper`)에 `.sln16` 임시 파일로 저장한 뒤 ARI Play 로 에이전트 채널에 재생합니다. 이 디렉터리는 Asterisk 프로세스가 읽을 수 있어야 하며, 재생 완료/타임아웃(기본 20초) 후 자동 삭제됩니다.
- 최대 PCM 크기: 약 1.92 MB (60초 분량의 16 kHz mono 16-bit). 초과 시 게이트웨이가 `413 Request Entity Too Large` 반환.

**`whisper_skip_reason` 값 가이드**:

| 값 | 원인 | 권장 조치 |
|----|------|----------|
| `null` | whisper 정상 재생 또는 미요청 | 없음 |
| `"no_request"` | `whisper_text` 와 `whisper_tts` 모두 미설정 | 의도된 동작 — 무시 가능 |
| `"no_tts_provider"` | SDK 어댑터 없고 게이트웨이도 키 없음 | `whisper_tts` 전달하거나 게이트웨이 `/api/v1/config/apikeys` 설정 |
| `"synthesize_failed"` | 게이트웨이 측 합성 실패 (HTTP/quota/network) | 게이트웨이 로그 확인 + 프로바이더 quota 점검 |
| `"bad_pcm_format"` | SDK PCM 이 2-byte aligned 아님 (slin16 아님) | 어댑터가 16 kHz mono 16-bit LE 를 emit 하는지 확인 |
| `"play_failed"` | ARI Play 가 audio 파일 거부 | 게이트웨이 로그 + `GW_WARM_TRANSFER_WHISPER_DIR` 권한 확인 |
| `"timeout"` | PlaybackFinished 가 timeout 안에 안 옴 | 오디오는 재생됐을 가능성 큼 — `GW_WARM_TRANSFER_WHISPER_TIMEOUT_MS` 조정 |
| `"cancelled"` | caller context 가 취소됨 | 클라이언트가 요청을 abort 한 경우 — 정상 |

**Mixed audio capture stream (SDK 1.6.6+ / Gateway 1.4.0.0+)**:
- `stream_mixed_to_external_media=True` / `streamMixedToExternalMedia: true` 옵션 시 게이트웨이가 warm bridge 에 별도 ExternalMedia 채널을 부착하여 customer↔agent mixed audio 를 동일 customer linkedID 의 fanout 으로 송출.
- 호출자는 응답 객체의 `mixed_stream_url` / `mixedStreamUrl` (보통 `ws://<gw>:8080/api/v1/ws/stream?linkedid=<lid>&dir=both`) 로 (재)연결하여 audio 수신.
- 포맷: mono slin16 (16 kHz, 20 ms / 640 B 프레임). stereo split 미지원 — Deepgram nova-3 등의 mono diarization 으로 화자 분리.
- 부착 실패 시 `mixed_stream_started=False` 로 graceful degrade. warm transfer 자체는 성공 유지.
- 통화 종료 (warm bridge dissolve) 시 ExternalMedia 자동 정리.

게이트웨이 REST:
- `POST /api/v1/transfer/warm/{linkedId}` — body: `{destination, context?, whisperText?, whisperPcm?, holdAudioUrl?, timeoutMs?, outbound?, cidNumber?, cidName?, accountCode?, streamMixedToExternalMedia?}`
- `whisperPcm`: base64-encoded 16 kHz mono 16-bit signed-linear LE PCM. SDK 가 자동으로 채움 (사용자가 `whisper_tts` 지정 시).
- 성공 응답: `{"connected":true,"timedOut":false,"error":null,"agentChannel":"...","bridgeId":"...","whisperPlayed":true|false,"whisperSkipReason":""|"...","mixedStreamStarted":true|false,"mixedStreamUrl":"ws://..."|""}`
- 타임아웃: `{"connected":false,"timedOut":true,"error":"no_answer","whisperPlayed":false,"whisperSkipReason":"...","mixedStreamStarted":false}`
- 실패: `400` (잘못된 base64 / destination 누락) / `403` (테넌트 권한) / `413` (whisperPcm 크기 초과) / `503` (warm_transfer disabled) with `{"error":"..."}`

#### `tts:complete` 이벤트 — TTS 재생 완료 감지

SDK의 `injectTts()` / `inject_tts()` 는 오디오 iterator가 소진되면 즉시 반환되지만, **게이트웨이가 실제로 모든 프레임을 Asterisk에 주입 완료한 시점이 아닙니다**. TTS Player는 20ms 틱 루프로 프레임을 밀어넣기 때문에, 오디오 길이만큼 대기한 뒤에야 실제 재생이 끝납니다.

`tts:complete` 이벤트는 게이트웨이가 **실제 재생 완료 시점**에 발행하는 authoritative 신호입니다.

**발생 시점**:
- `Player.Play()` 세션이 정상 EOF로 종료 (페이드아웃 포함 모든 프레임 Asterisk로 전송 완료)
- 명시적 `Stop()` 호출로 중단
- 동시 `Play()` 호출에 의한 선점 (stale 세션은 발행 안 함 — 중복 알림 방지)

**의미**: 게이트웨이→Asterisk WebSocket 주입 완료. Asterisk→전화기 RTP 버퍼(~20–40ms)는 고려 안 됨 (IVR/음성봇 턴 관리에는 무의미한 차이).

**주요 활용**:
1. 고객 VAD 리오픈 — AI 응답이 끝날 때까지 고객 발화 차단 유지
2. 순차 TTS 재생 — 인사말 → 메뉴 안내 체이닝 (overlap 방지)
3. 정확한 재생 완료 타임스탬프 로깅 (지연 분석용)

```typescript
// TypeScript — 인사말 끝나면 메뉴 안내 재생
await gw.injectTts(linkedId, welcomeTts.synthesize('안녕하세요'));
gw.onTtsComplete(async (ev) => {
  if (ev.linkedId !== linkedId) return;
  await gw.injectTts(linkedId, menuTts.synthesize('1번을 눌러주세요'));
});
```

```python
# Python — 동일 패턴
import asyncio
await gw.inject_tts(linked_id, welcome_tts.synthesize("안녕하세요"))

def on_done(ev):
    if ev.linked_id != linked_id:
        return
    asyncio.ensure_future(
        gw.inject_tts(linked_id, menu_tts.synthesize("1번을 눌러주세요"))
    )

gw.on_tts_complete(on_done)
```

**Wire format** (`/api/v1/ws/callinfo`):
```json
{"event":"tts:complete","linkedId":"1775805184.495","tenantId":"7be69580e27641df","serverId":"gw-seoul-01"}
```

**S2S 모드와의 관계**: OpenAI Realtime / Gemini Live 어댑터의 `onAudioOutput` 콜백으로 받은 PCM을 `gw.injectTts()`로 주입하면, 게이트웨이가 재생을 마칠 때마다 `tts:complete`가 발행됩니다. 이 이벤트를 이용해 "AI 발화 종료" 시점을 정확히 감지할 수 있습니다.

---

## 세션 필드 (call:new 이벤트)

| 필드 | 설명 |
|------|------|
| `linkedId` / `linked_id` | 통화 고유 ID |
| `caller` | 발신자 번호 |
| `callerName` / `caller_name` | 발신자 이름 |
| `callee` | 착신자 번호 |
| `did` | DID 번호 |
| `tenantId` / `tenant_id` | 멀티테넌트 ID |
| `serverId` / `server_id` | 게이트웨이 서버 ID |
| `customValue1~3` / `custom_value_1~3` | 커스텀 변수 (다이얼플랜에서 전달) |
| `streamUrl` / `stream_url` | 오디오 WebSocket URL |

---

## 캠페인 이벤트 타입

callinfo WebSocket으로 실시간 수신:

| 이벤트 | 설명 |
|--------|------|
| `campaign:started` | 캠페인 시작 |
| `call:preparing` | 발신 준비 |
| `call:dialing` | 발신 요청 |
| `call:connected` | 발신 성공 |
| `call:failed` | 발신 실패 |
| `call:retry` | 재시도 대기 |
| `campaign:completed` | 캠페인 완료 |

---

## AI 어댑터

### STT (음성→텍스트)

| 어댑터 | 패키지 | 설명 |
|--------|--------|------|
| `DeepgramAdapter` | `dvgateway-adapters/stt` / `dvgateway.adapters.stt` | Deepgram Nova-3 (한국어 최적) |
| `GoogleChirp3Adapter` | `dvgateway-adapters/stt` / `dvgateway.adapters.stt` | Google Chirp 3 (V2 API) |
| `OpenAISttAdapter` | `dvgateway-adapters/stt` / `dvgateway.adapters.stt` | OpenAI Realtime Transcription (gpt-4o-transcribe, gpt-realtime-whisper) |

#### DeepgramAdapter 옵션

```typescript
// TypeScript
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
const stt = new DeepgramAdapter({
  apiKey: 'dg_xxx',           // 필수
  language: 'ko',             // 기본: "ko"
  model: 'nova-3',            // nova-3, nova-3-medical, nova-3-phonecall, enhanced, base
  diarize: false,             // 화자 구분
  vadEnabled: true,           // 음성 활동 감지
  endpointingMs: 300,         // 발화 경계 감지 (ms)
  utteranceEndMs: 800,        // 발화 종료 감지 (ms)
  interimResults: true,       // 중간 결과
  smartFormat: true,          // 숫자/날짜 자동 포맷
  punctuate: true,            // 구두점
  keywords: ['DVGateway'],    // 키워드 부스팅
  profanityFilter: false,     // 비속어 필터
  sentiment: false,           // 감정 분석 (Nova-3)
});
```

```python
# Python
from dvgateway.adapters.stt import DeepgramAdapter
stt = DeepgramAdapter(
    api_key="dg_xxx",
    language="ko",
    model="nova-3",
    diarize=False,
    endpointing_ms=500,
    utterance_end_ms=1000,
    interim_results=True,
    smart_format=True,
    keywords=["DVGateway"],
    punctuate=True,
    profanity_filter=False,
    sentiment=False,
)
```

#### GoogleChirp3Adapter 옵션

```typescript
// TypeScript
import { GoogleChirp3Adapter } from 'dvgateway-adapters/stt';
const stt = new GoogleChirp3Adapter({
  apiKey: 'project_id:api_key',  // 필수 (V2: "project_id:key", V1: "key")
  language: 'ko-KR',             // 기본: "ko-KR"
  model: 'chirp_3',              // 기본: "chirp_3"
  punctuate: true,               // 구두점
});
```

```python
# Python
from dvgateway.adapters.stt import GoogleChirp3Adapter
stt = GoogleChirp3Adapter(
    api_key="project_id:api_key",
    language="ko-KR",
    model="chirp_3",
)
```

#### OpenAISttAdapter 옵션

OpenAI Realtime Transcription API를 사용합니다. 서버 측 VAD로 발화 구간을 자동 감지합니다.

```typescript
// TypeScript
import { OpenAISttAdapter } from 'dvgateway-adapters/stt';
const stt = new OpenAISttAdapter({
  apiKey: 'sk-xxx',               // 필수
  language: 'ko',                  // 기본: "ko"
  model: 'gpt-4o-transcribe',     // gpt-4o-transcribe, gpt-4o-mini-transcribe
  vadEnabled: true,                // 서버 VAD 활성화 (기본: true)
  vadThreshold: 0.4,               // 감도 0~1 (낮을수록 민감, 기본: 0.4)
  silenceDurationMs: 200,          // 발화 종료 판단 무음 (ms, 기본: 200)
  prefixPaddingMs: 200,            // 발화 시작 전 포함 오디오 (ms, 기본: 200)
});
```

```python
# Python
from dvgateway.adapters.stt import OpenAISttAdapter
stt = OpenAISttAdapter(
    api_key="sk-xxx",
    language="ko",
    model="gpt-4o-transcribe",
    vad_enabled=True,
    vad_threshold=0.4,
    silence_duration_ms=200,
    prefix_padding_ms=200,
)
```

### LLM (AI 대화)

| 어댑터 | 패키지 | 설명 |
|--------|--------|------|
| `AnthropicAdapter` | `dvgateway-adapters/llm` / `dvgateway.adapters.llm` | Anthropic Claude |
| `OpenAILlmAdapter` | `dvgateway-adapters/llm` / `dvgateway.adapters.llm` | OpenAI GPT |
| `WebhookAdapter` | `dvgateway-adapters/llm` / `dvgateway.adapters.llm` | n8n/Flowise/사내 API Webhook |

#### AnthropicAdapter 옵션

```typescript
// TypeScript
import { AnthropicAdapter } from 'dvgateway-adapters/llm';
const llm = new AnthropicAdapter({
  apiKey: 'sk-ant-xxx',                    // 필수
  model: 'claude-sonnet-4-6',              // claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5-20251001
  systemPrompt: '친절한 AI 상담원입니다.',    // 시스템 프롬프트
  maxTokens: 1024,                          // 최대 출력 토큰
  temperature: 0.7,                         // 창의성 (0~1)
  topP: undefined,                          // nucleus sampling
  stopSequences: [],                        // 종료 시퀀스
});
```

```python
# Python
from dvgateway.adapters.llm import AnthropicAdapter
llm = AnthropicAdapter(
    api_key="sk-ant-xxx",
    model="claude-sonnet-4-6",
    system_prompt="친절한 AI 상담원입니다.",
    max_tokens=1024,
    temperature=0.7,
)
```

#### OpenAILlmAdapter 옵션

```typescript
// TypeScript
import { OpenAILlmAdapter } from 'dvgateway-adapters/llm';
const llm = new OpenAILlmAdapter({
  apiKey: 'sk-xxx',                         // 필수
  model: 'gpt-4o-mini',                     // gpt-4o-mini, gpt-4o, o3-mini, o1-mini
  systemPrompt: '친절한 AI 상담원입니다.',    // 시스템 프롬프트
  maxTokens: 1024,
  temperature: 0.7,
  presencePenalty: 0.0,                     // 반복 억제 (0~2)
  frequencyPenalty: 0.0,                    // 빈도 패널티 (0~2)
});
```

```python
# Python
from dvgateway.adapters.llm import OpenAILlmAdapter
llm = OpenAILlmAdapter(
    api_key="sk-xxx",
    model="gpt-4o-mini",
    system_prompt="친절한 AI 상담원입니다.",
    max_tokens=1024,
    temperature=0.7,
    presence_penalty=0.0,
    frequency_penalty=0.0,
)
```

#### WebhookAdapter 옵션 (n8n, Flowise, 사내 API 연동)

```typescript
// TypeScript
import { WebhookAdapter } from 'dvgateway-adapters/llm';
const llm = new WebhookAdapter({
  url: 'https://n8n.example.com/webhook/voice-bot',  // 필수
  timeout: 5000,                                       // 타임아웃 (ms)
  secret: 'hmac-secret',                               // HMAC-SHA256 서명 키
  headers: { 'X-Custom': 'value' },                    // 커스텀 헤더
  systemPrompt: '상담원 봇입니다.',
  fallback: new AnthropicAdapter({ apiKey: '...' }),   // 장애 시 폴백 어댑터
});
```

```python
# Python
from dvgateway.adapters.llm import WebhookAdapter, AnthropicAdapter
llm = WebhookAdapter(
    url="https://n8n.example.com/webhook/voice-bot",
    timeout=5.0,
    secret="hmac-secret",
    headers={"X-Custom": "value"},
    system_prompt="상담원 봇입니다.",
    fallback=AnthropicAdapter(api_key="..."),
)
```

### TTS (텍스트→음성)

| 어댑터 | 패키지 | 설명 |
|--------|--------|------|
| `GeminiTtsAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` | Google Gemini TTS (30 음성) |
| `ElevenLabsAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` | ElevenLabs (한국어 9 네이티브 음성) |
| `OpenAITtsAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` | OpenAI TTS (11 음성) |
| `CosyVoiceAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` | Alibaba CosyVoice (9 음성) |
| `CachedTtsAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` | TTS 캐시 래퍼 (비용 절감) |

#### GeminiTtsAdapter 옵션

```typescript
// TypeScript
import { GeminiTtsAdapter, GEMINI_TTS_VOICES } from 'dvgateway-adapters/tts';
const tts = new GeminiTtsAdapter({
  apiKey: 'AIza_xxx',           // 필수
  voice: 'Kore',                // 기본: "Kore" (30개 음성: Aoede, Charon, Fenrir, Kore, Puck, ...)
  model: 'gemini-2.5-flash-tts', // gemini-2.5-flash-tts, gemini-2.5-pro-tts
  languageCode: 'ko-KR',        // 기본: "ko-KR"
  prompt: '밝고 친근한 톤으로',    // 스타일 제어 (선택)
});
```

```python
# Python
from dvgateway.adapters.tts import GeminiTtsAdapter, GEMINI_VOICES
tts = GeminiTtsAdapter(
    api_key="AIza_xxx",
    voice="Kore",
    model="gemini-2.5-flash-tts",
    language="ko-KR",
)
```

#### ElevenLabsAdapter 옵션

```typescript
// TypeScript
import { ElevenLabsAdapter, ELEVENLABS_KOREAN_VOICES } from 'dvgateway-adapters/tts';
const tts = new ElevenLabsAdapter({
  apiKey: 'el_xxx',                        // 필수
  voiceId: '21m00Tcm4TlvDq8ikWAM',        // 기본: Rachel (한국어 네이티브 9개 사용 가능)
  model: 'eleven_multilingual_v2',          // eleven_multilingual_v2, eleven_flash_v2_5
  stability: 0.3,                           // 안정성 (0~1)
  similarityBoost: 0.75,                    // 유사도 (0~1)
  style: 0.6,                               // 스타일 강도 (0~1)
  useSpeakerBoost: true,                    // 화자 부스트
  outputFormat: 'pcm_24000',                // 출력 포맷
  optimizeStreamingLatency: 3,              // 0~4 (높을수록 빠름, 품질 트레이드오프)
  humanVoice: true,                         // 한국어 최적화 프리셋 (stability/style 자동 조정)
});
// 한국어 네이티브 음성: ELEVENLABS_KOREAN_VOICES (9개)
```

```python
# Python
from dvgateway.adapters.tts import ElevenLabsAdapter, KOREAN_VOICES
tts = ElevenLabsAdapter(
    api_key="el_xxx",
    voice_id="21m00Tcm4TlvDq8ikWAM",
    model="eleven_multilingual_v2",
    stability=0.3,
    similarity_boost=0.75,
    style=0.6,
    use_speaker_boost=True,
    output_format="pcm_24000",
    optimize_streaming_latency=3,
    human_voice=True,
)
```

#### OpenAITtsAdapter 옵션

```typescript
// TypeScript
import { OpenAITtsAdapter } from 'dvgateway-adapters/tts';
const tts = new OpenAITtsAdapter({
  apiKey: 'sk-xxx',                        // 필수
  voice: 'nova',                           // alloy, echo, fable, onyx, nova, shimmer, ash, ballad, coral, sage, verse
  model: 'gpt-4o-mini-tts',               // gpt-4o-mini-tts, tts-1
  voiceInstructions: '밝고 친근한 톤',      // 음성 스타일 지시 (gpt-4o-mini-tts 전용)
  humanVoice: true,                        // 한국어 최적화 프리셋
});
```

```python
# Python
from dvgateway.adapters.tts import OpenAITtsAdapter
tts = OpenAITtsAdapter(
    api_key="sk-xxx",
    voice="nova",
    model="gpt-4o-mini-tts",
    voice_instructions="밝고 친근한 톤",
    human_voice=True,
)
```

#### CosyVoiceAdapter 옵션 (Alibaba)

```typescript
// TypeScript
import { CosyVoiceAdapter, COSYVOICE_VOICES } from 'dvgateway-adapters/tts';
const tts = new CosyVoiceAdapter({
  apiKey: 'sk-xxx',                         // 필수 (DashScope API 키)
  voice: 'longxiaochun',                    // longxiaochun, longyue, longwan, longjing, longshuo, longhua, longfei, longshu
  model: 'cosyvoice-v3.5-plus',             // cosyvoice-v3.5-plus, cosyvoice-v3.5-flash
  language: [],                              // 언어 힌트 (선택)
  sampleRate: 16000,                         // 샘플레이트
});
```

```python
# Python
from dvgateway.adapters.tts import CosyVoiceAdapter, COSYVOICE_VOICES
tts = CosyVoiceAdapter(
    api_key="sk-xxx",
    voice="longxiaochun",
    model="cosyvoice-v3.5-plus",
    language_hints=["ko"],
)
```

#### CachedTtsAdapter (비용 절감 래퍼)

반복 멘트(인사말, 안내문 등)를 캐시하여 TTS 비용을 절감합니다.

```typescript
// TypeScript
import { CachedTtsAdapter, ElevenLabsAdapter } from 'dvgateway-adapters/tts';
const inner = new ElevenLabsAdapter({ apiKey: '...' });
const tts = new CachedTtsAdapter(inner, {
  provider: 'elevenlabs',      // 캐시 키 구분용
  cacheDir: './tts-cache',     // 캐시 디렉토리
  ttlMs: 0,                    // 만료시간 (0=무제한)
  maxEntries: 0,               // 최대 캐시 수 (0=무제한)
});
```

```python
# Python
from dvgateway.adapters.tts import CachedTtsAdapter, ElevenLabsAdapter
inner = ElevenLabsAdapter(api_key="...")
tts = CachedTtsAdapter(inner, provider="elevenlabs", cache_dir="./tts-cache")
```

### Realtime (음성→음성 직통)

| 어댑터 | 패키지 | 설명 |
|--------|--------|------|
| `OpenAIRealtimeAdapter` | `dvgateway-adapters/realtime` / `dvgateway.adapters.realtime` | OpenAI Realtime API (STT+LLM+TTS 통합) |
| `GeminiLiveAdapter` | `dvgateway-adapters/realtime` / `dvgateway.adapters.realtime` | Google Gemini Live API (BidiGenerateContent, AI Studio/Vertex) |

두 어댑터는 **동일한 `RealtimeSpeechAdapter` 인터페이스**를 구현하므로 import만 바꾸면 그대로 교체됩니다. 동일한 S2S 배선(`pipelineType=s2s` + `onSpeechActivity → postVad`)이 모두 작동합니다.

#### S2S 프로바이더 비교 (OpenAI vs Gemini)

| 항목 | OpenAI Realtime | Gemini Live |
|------|----------------|-------------|
| **모델** | `gpt-realtime-2`(신규, GPT-5급), `gpt-realtime-translate`(통역), `gpt-realtime-1.5`, `gpt-4o-realtime-preview`(현 SDK 기본) | `gemini-live-2.5-flash-preview`, `gemini-2.5-flash-native-audio` |
| **음성** | 11종 (alloy, nova, shimmer 등) | 8종 (Puck, Charon, Kore, Fenrir, Aoede, Leda, Orus, Zephyr) |
| **입력 샘플레이트** | 24kHz (SDK 업샘플) | **16kHz (DVGateway 네이티브 — 리샘플 없음)** |
| **출력 샘플레이트** | 24kHz (SDK 다운샘플) | 24kHz (SDK 다운샘플) |
| **VAD** | `server_vad` 또는 `none` (명시적 start/stop 이벤트) | `server_vad` 또는 `none` (활동 이벤트는 암묵적) |
| **인증** | Bearer API 키 | AI Studio: API 키 / Vertex: OAuth Bearer |
| **리전** | Global (anycast) | Global (AI Studio) + 리전별 Vertex (asia-northeast1 등) |
| **비용** | 높음 (오디오 토큰) | 상대적으로 저렴 |
| **한국어 품질** | 우수 | 우수 (네이티브 오디오 모델에서 뛰어남) |
| **Tool Calling** | ✅ | ✅ |
| **Tool Choice** (`auto` / `none` / `required` / `function`) | ✅ (v1.0+) | ⚠️ **AUTO 고정** — Live API setup 스키마에 `tool_config` 필드 없음 |
| **`maxResponseTokens` / `max_response_tokens`** (OpenAI 이름) | ✅ 기본 | ✅ **별칭으로 수용 (v1.4.11+)** — `maxOutputTokens`로 변환. 명시적 `maxOutputTokens`가 우선. `'inf'` → 무제한 |
| **`turnDetection.threshold`** (0.0~1.0 float) | ✅ native | ✅ **별칭으로 수용 (v1.4.11+)** — Gemini의 LOW/MEDIUM/HIGH 센시티비티로 자동 매핑. 명시적 `startSensitivity`/`endSensitivity`가 우선 |
| **출력 볼륨 (기본)** | ≈ -12 dBFS (전화 적정) | ≈ -40 dBFS (너무 조용) — `outputGainDb: 24` 필수 |

#### GeminiLiveAdapter 옵션

Google Gemini Live API를 사용하여 S2S 파이프라인을 구성합니다. OpenAIRealtimeAdapter와 동일한 콜백(`onAudioOutput`, `onTranscript`, `onSpeechActivity`, `onToolCall`, `onError`)을 제공합니다.

```typescript
// TypeScript
import { GeminiLiveAdapter } from 'dvgateway-adapters/realtime';

const realtime = new GeminiLiveAdapter({
  apiKey: process.env['GEMINI_API_KEY']!,
  model: 'gemini-live-2.5-flash-preview',
  voice: 'Puck',                        // Puck | Charon | Kore | Fenrir | Aoede | Leda | Orus | Zephyr
  instructions: '친절한 한국어 AI 상담원입니다.',
  language: 'ko-KR',                     // BCP-47 (미설정 시 자동 감지)
  temperature: 0.8,
  inputTranscription: true,              // 고객 발화 전사 (기본: true)
  outputTranscription: true,             // AI 응답 전사 (기본: true)
  outputGainDb: 24,                      // ★ 필수 — half-cascade 모델 출력 볼륨 보정 (v1.4+)
  turnDetection: {
    mode: 'server_vad',                  // 'server_vad' | 'none'
    startSensitivity: 'MEDIUM',          // LOW | MEDIUM | HIGH
    endSensitivity: 'MEDIUM',
    prefixPaddingMs: 200,
    silenceDurationMs: 800,
  },
});

// 나머지 S2S 배선은 OpenAI와 100% 동일
realtime.onAudioOutput(async (pcm16k, linkedId) => {
  await gw.injectTts(linkedId, (async function* () { yield pcm16k; })());
});
realtime.onSpeechActivity(({ linkedId, side, speaking }) => {
  gw.postVad(linkedId, side, speaking).catch(() => {});
});

gw.onCallInfo(async (event) => {
  if (event.type === 'call:new') {
    const stream = gw.streamAudio(event.linkedId, {
      dir: 'both',
      pipelineType: 's2s',               // ★ 동일하게 's2s' — 대시보드가 AI 세션으로 렌더
    });
    await realtime.startSession(event.linkedId, stream);
  }
  if (event.type === 'call:ended') {
    await realtime.stop(event.linkedId);
  }
});
```

```python
# Python
from dvgateway.adapters.realtime import GeminiLiveAdapter

realtime = GeminiLiveAdapter(
    api_key=os.environ["GEMINI_API_KEY"],
    model="gemini-live-2.5-flash-preview",
    voice="Puck",                         # Puck | Charon | Kore | Fenrir | Aoede | Leda | Orus | Zephyr
    instructions="친절한 한국어 AI 상담원입니다.",
    language="ko-KR",
    temperature=0.8,
    input_transcription=True,
    output_transcription=True,
    output_gain_db=24,                    # ★ 필수 — half-cascade 모델 출력 볼륨 보정 (v1.4+)
    turn_detection={
        "mode": "server_vad",
        "start_sensitivity": "MEDIUM",
        "end_sensitivity": "MEDIUM",
        "prefix_padding_ms": 200,
        "silence_duration_ms": 800,
    },
)
```

##### ⚠️ `outputGainDb` / `output_gain_db` — Gemini 출력 볼륨 보정 (v1.4+)

Gemini Live의 **half-cascade 모델**(`gemini-live-2.5-flash-preview`)은 TTS 출력을 약 **-40 dBFS peak**로 송출합니다. OpenAI Realtime(~-12 dBFS)보다 **약 30 dB 조용**해서 전화 통화에서 거의 들리지 않습니다. SDK가 이 차이를 자동 보정하지 않으므로 반드시 명시적으로 설정해야 합니다.

**권장값**:

| 모델 | 권장 `outputGainDb` | 적용 후 peak |
|---|---|---|
| `gemini-live-2.5-flash-preview` (half-cascade) | **`24`** | ≈ -16 dBFS (전화 적정 수준) |
| `gemini-2.5-flash-native-audio` | `0`–`12` | 모델이 자체적으로 loudness 최적화 |
| `gemini-2.0-flash-live-001` (legacy) | `24` | half-cascade와 동일 |

**동작**: 어댑터가 각 오디오 청크에 선형 게인을 적용한 후 int16 범위로 clamp합니다. `24 dB`는 ≈16배 증폭이고, int16 최대 크기(±32767)를 초과하는 샘플은 wrap-around 없이 안전하게 clipped됩니다.

**운영 진단**: 게이트웨이 로그에서 `[TTS] WARNING session max_peak=-XX.XXdBFS is below -30 dBFS` 메시지가 보이면 이 옵션이 미설정이거나 값이 너무 낮다는 신호입니다. 어댑터 자체도 첫 오디오 청크에서 다음과 같이 경고합니다:

```
[GeminiLive] source peak -43.5dBFS is quiet for a phone sink (< -30 dBFS) and
outputGainDb=0 is not compensating. Recommended: outputGainDb: 24 for
half-cascade models.
```

**허용 범위**: `[-24, +40]` dB를 벗어나는 값은 WARN 로그만 발생하고 실제 적용은 됩니다 (WebRTC·파일 출력 등 비전화 sink에서는 다른 범위가 적절할 수 있음).

##### ⚠️ 모델 ID는 자주 deprecated됨 — `listGeminiLiveModels()` 권장 (v1.4.10+)

Google이 Gemini Live 모델 ID를 몇 달마다 변경합니다 (예: `gemini-live-2.5-flash-preview`는 2025년 말에 rename됨). SDK에 default model을 hardcode하면 어느 시점에 모든 사용자가 다음 close 코드로 막힙니다:

```
[GeminiLive] WS closed code=1008 reason='models/gemini-live-... is not found
for API version v1beta, or is not supported for bidiGenerateContent.'
```

**권장 패턴 — 시작 시 동적 조회**:

```typescript
// TypeScript
import { GeminiLiveAdapter, listGeminiLiveModels } from 'dvgateway-adapters/realtime';

const apiKey = process.env.GEMINI_API_KEY!;
const liveModels = await listGeminiLiveModels(apiKey);   // models.list API 호출, 5분 캐시

// 우선순위: native-audio → flash → 첫 번째
const chosen =
  liveModels.find(m => m.name.includes('native-audio'))?.name ??
  liveModels.find(m => m.name.includes('flash'))?.name ??
  liveModels[0]?.name;
if (!chosen) throw new Error('이 API 키로 Live-가능 모델 없음');

const realtime = new GeminiLiveAdapter({
  apiKey,
  model: chosen.replace(/^models\//, ''),   // "models/" prefix 제거
  voice: 'Puck',
  outputGainDb: 24,
});
```

```python
# Python
from dvgateway.adapters.realtime import GeminiLiveAdapter, list_gemini_live_models

api_key = os.environ["GEMINI_API_KEY"]
live = await list_gemini_live_models(api_key)

chosen = next(
    (m["name"] for m in live if "native-audio" in m["name"]),
    next((m["name"] for m in live if "flash" in m["name"]), None),
)
if not chosen:
    raise RuntimeError("이 API 키로 Live-가능 모델 없음")

realtime = GeminiLiveAdapter(
    api_key=api_key,
    model=chosen.removeprefix("models/"),
    voice="Puck",
    output_gain_db=24,
)
```

**Endpoint**: `GET https://generativelanguage.googleapis.com/v1beta/models?key=KEY` — `supportedGenerationMethods`에 `bidiGenerateContent`가 포함된 모델만 반환됩니다.

**캐싱**: API 키 단위로 5분 in-memory cache. `cacheMs=0` (TS) / `cache_ttl_s=0` (Python)으로 우회 가능 — 1008 close 직후 재조회할 때 사용.

**Vertex 엔드포인트**: 현재 helper는 AI Studio (`generativelanguage.googleapis.com`)만 지원. Vertex는 별도 endpoint + OAuth 필요 → 현재는 SDK 사용자가 GCP `aiplatform.models.list` 직접 호출 권장.

**자동 fallback 로깅**: 만약 잘못된 model ID로 시도하면, 어댑터가 close 후 자동으로 다음 로그 출력:

```
[GeminiLive] Model "gemini-live-2.5-flash-preview" appears to be deprecated, renamed,
or unavailable for this API key. Discover currently Live-capable models with:
  import { listGeminiLiveModels } from 'dvgateway-adapters/realtime';
  const models = await listGeminiLiveModels(apiKey);
  console.log(models.map(m => m.name));
Then pass the chosen name (without the 'models/' prefix) as the `model` option.
```

##### 🔁 OpenAI → Gemini Drop-in Migration (v1.4.11+)

OpenAI Realtime 설정을 Gemini로 그대로 복사해도 작동하도록 **두 가지 별칭**을 지원합니다:

| OpenAI 형식 | Gemini 내부 변환 | 우선순위 |
|---|---|---|
| `maxResponseTokens: 1024` | → `maxOutputTokens: 1024` | 명시적 `maxOutputTokens` 우선 |
| `maxResponseTokens: 'inf'` | → `maxOutputTokens: null` (무제한) | — |
| `turnDetection.threshold: 0.5` | → 양쪽 sensitivity **MEDIUM** | 명시적 sensitivity 우선 |
| `turnDetection.threshold: < 0.3` | → **HIGH** (민감) | — |
| `turnDetection.threshold: > 0.7` | → **LOW** (엄격) | — |

**Threshold 역매핑 이유**: OpenAI는 "higher threshold = 덜 민감", Gemini는 "HIGH = 더 민감" — 값의 의미(사용자 의도)를 유지하기 위해 매핑이 반전됩니다.

**마이그레이션 예**:

```typescript
// 이전 OpenAI 설정 — 그대로 복사 가능
const realtime = new GeminiLiveAdapter({
  apiKey: process.env.GEMINI_API_KEY!,
  model: 'gemini-2.5-flash-native-audio-preview-09-2025',  // listGeminiLiveModels로 조회
  voice: 'Puck',                        // Gemini voice로만 바꿔주세요
  instructions: '...',                  // 그대로
  maxResponseTokens: 1024,              // ✅ OpenAI 이름 그대로 — 자동 매핑
  turnDetection: {
    mode: 'server_vad',
    threshold: 0.5,                     // ✅ OpenAI 형식 그대로 — MEDIUM으로 매핑
    prefixPaddingMs: 300,               // 그대로
    silenceDurationMs: 200,             // 그대로
  },
  outputGainDb: 24,                     // Gemini 전용 — 추가 필요
});
```

**Mix-and-match 지원** — 명시적 옵션은 별칭보다 우선:

```typescript
turnDetection: {
  threshold: 0.1,                       // end만 적용 (HIGH)
  startSensitivity: 'LOW',              // ← 명시적 start는 LOW로 확정
}
// 결과: startSensitivity=LOW, endSensitivity=HIGH
```

**저수준 헬퍼** — 매핑 로직만 사용:
```typescript
import { mapThresholdToSensitivity, normalizeMaxOutputTokens } from 'dvgateway-adapters/realtime';
mapThresholdToSensitivity(0.9)         // → 'LOW'
normalizeMaxOutputTokens(undefined, 'inf')   // → null
```

##### Vertex AI 리전 엔드포인트 사용 (GCP 네이티브 배포)

데이터 레지던시 요구사항 또는 VPC Service Controls를 사용하는 경우 Vertex AI 엔드포인트를 사용합니다:

```typescript
const realtime = new GeminiLiveAdapter({
  endpoint: 'vertex',
  accessToken: process.env['GCP_ACCESS_TOKEN']!,   // gcloud auth print-access-token
  project: 'my-gcp-project',
  location: 'asia-northeast1',                      // 도쿄 — 한국 트래픽에 가장 가까움
  model: 'gemini-live-2.5-flash-preview',
  voice: 'Puck',
  // 나머지 옵션은 AI Studio와 동일
});
```

```python
realtime = GeminiLiveAdapter(
    endpoint="vertex",
    access_token=os.environ["GCP_ACCESS_TOKEN"],
    project="my-gcp-project",
    location="asia-northeast1",
    model="gemini-live-2.5-flash-preview",
    voice="Puck",
)
```

##### Gemini Live VAD 주의사항

Gemini Live API는 OpenAI Realtime과 달리 **명시적인 `speech_started` / `speech_stopped` 이벤트를 발행하지 않습니다**. 대신 서버 측 VAD가 턴 경계를 자동으로 감지하여 `serverContent.interrupted` / `turnComplete` 신호로 알립니다.

본 어댑터는 다음과 같이 **근사치 VAD 이벤트**를 제공합니다:

- `serverContent.interrupted=true` → `speaking=true` (고객이 AI 응답 중 끼어들었음을 감지)
- `serverContent.turnComplete=true` → `speaking=false` (턴 종료 시 초기화)

정밀한 VAD가 필요한 경우 `turnDetection.mode = 'none'`으로 설정하고 자체 VAD 로직(on-device VAD)에서 `adapter.sendActivityStart(linkedId)` / `adapter.sendActivityEnd(linkedId)`를 직접 호출하세요.

##### 프로바이더 전환

OpenAI Realtime에서 Gemini Live로 교체는 import 변경 + 옵션 매핑만 필요합니다. S2S 배선(pipelineType, postVad, injectTts)은 그대로 유지됩니다:

```typescript
// OpenAI
- import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';
- const realtime = new OpenAIRealtimeAdapter({ apiKey, model: 'gpt-4o-realtime-preview', voice: 'nova' });

// Gemini
+ import { GeminiLiveAdapter } from 'dvgateway-adapters/realtime';
+ const realtime = new GeminiLiveAdapter({ apiKey, model: 'gemini-live-2.5-flash-preview', voice: 'Puck' });
```

#### OpenAIRealtimeAdapter 옵션

STT·LLM·TTS를 하나의 WebSocket으로 통합하여 초저지연 음성 대화를 구현합니다.

```typescript
// TypeScript
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';
const realtime = new OpenAIRealtimeAdapter({
  apiKey: 'sk-xxx',                               // 필수
  model: 'gpt-4o-realtime-preview',               // 옵션: gpt-realtime-2 (신규, GPT-5급), gpt-realtime-translate (통역), gpt-realtime-1.5, gpt-4o-realtime-preview (현 SDK 기본), gpt-4o-mini-realtime-preview
  voice: 'alloy',                                  // alloy, echo, fable, onyx, nova, shimmer, ash, ballad, coral, sage, verse
  instructions: '친절한 한국어 AI 상담원입니다.',     // 시스템 지시
  inputTranscription: true,                        // 입력 텍스트 변환
  inputTranscriptionModel: 'whisper-1',            // 옵션: whisper-1 (기본), gpt-4o-transcribe, gpt-4o-mini-transcribe, gpt-realtime-whisper (신규)
  language: 'ko',                                   // 전사 언어 힌트 (BCP-47: "ko", "en", "ja" 등, 미설정 시 자동 감지)
  temperature: 0.8,
  maxResponseTokens: 'inf',                        // 최대 응답 토큰 ("inf" = 무제한)
  turnDetection: {                                  // VAD 설정
    mode: 'server_vad',                            // "server_vad" | "none"
    threshold: 0.5,                                // 감도 (0~1)
    prefixPaddingMs: 300,
    silenceDurationMs: 200,
  },
});
```

```python
# Python
from dvgateway.adapters.realtime import OpenAIRealtimeAdapter, OpenAIRealtimeTurnDetectionOptions

realtime = OpenAIRealtimeAdapter(
    api_key="sk-xxx",
    model="gpt-4o-realtime-preview",  # 옵션: gpt-realtime-2(신규, GPT-5급), gpt-realtime-translate(통역), gpt-realtime-1.5, gpt-4o-realtime-preview(현 SDK 기본)
    voice="alloy",
    instructions="친절한 한국어 AI 상담원입니다.",
    input_transcription=True,
    input_transcription_model="whisper-1",  # 옵션: whisper-1(기본), gpt-4o-transcribe, gpt-4o-mini-transcribe, gpt-realtime-whisper(신규)
    language="ko",               # 전사 언어 힌트 (BCP-47, 미설정 시 자동 감지)
    temperature=0.8,
    max_response_tokens="inf",
    # turn_detection: dict 또는 OpenAIRealtimeTurnDetectionOptions 모두 가능
    turn_detection={                          # dict 방식 ✅
        "mode": "server_vad",
        "threshold": 0.5,
        "prefix_padding_ms": 300,
        "silence_duration_ms": 200,
    },
    # 또는 dataclass 방식:
    # turn_detection=OpenAIRealtimeTurnDetectionOptions(
    #     mode="server_vad", threshold=0.5,
    #     prefix_padding_ms=300, silence_duration_ms=200,
    # ),
)
```

#### Live 통역 모드 (gpt-realtime-translate)

`model: 'gpt-realtime-translate'` + `inputLanguage` + `outputLanguage` 세 가지만 지정하면 SDK가 OpenAI Realtime 통역 가이드 권장 system prompt(충실 번역, 사족 금지, 고유명사/숫자 보존, 화자 속도 유지)를 자동 합성합니다. `instructions`를 직접 지정하면 SDK 자동 합성을 덮어쓰므로 도메인 용어집/존댓말 규칙 등 커스텀이 필요할 때 사용하세요.

```typescript
// TypeScript — 한국어 → 영어 실시간 통역
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';

const interpreter = new OpenAIRealtimeAdapter({
  apiKey:         process.env['OPENAI_API_KEY']!,
  model:          'gpt-realtime-translate',
  voice:          'alloy',
  inputLanguage:  'ko',   // 발화자 언어
  outputLanguage: 'en',   // 청취자 언어
  // instructions를 지정하지 않으면 SDK가 통역 프롬프트를 자동 생성
});
```

```python
# Python — 한국어 → 영어 실시간 통역
from dvgateway.adapters.realtime import OpenAIRealtimeAdapter

interpreter = OpenAIRealtimeAdapter(
    api_key=os.environ["OPENAI_API_KEY"],
    model="gpt-realtime-translate",
    voice="alloy",
    input_language="ko",    # 발화자 언어
    output_language="en",   # 청취자 언어
    # instructions를 지정하지 않으면 SDK가 통역 프롬프트를 자동 생성
)
```

지원 언어: 입력 70+ / 출력 13 (OpenAI Realtime translate 모델 기준). 동작 검증 예제는 [examples/10-realtime-translate-ko-en.ts](../examples/10-realtime-translate-ko-en.ts) / [examples/python/05_realtime_translate_ko_en.py](../examples/python/05_realtime_translate_ko_en.py) 참고.

#### S2S vs 기존 파이프라인 비교

| | 기존 파이프라인 (STT→LLM→TTS) | S2S (OpenAI Realtime) |
|---|---|---|
| 구성 | STT + LLM + TTS 어댑터 3개 | `OpenAIRealtimeAdapter` 1개 |
| API 키 | 프로바이더별 개별 키 | OpenAI 키 1개 |
| 레이턴시 | ~500ms+ (3-hop) | ~300ms (단일 WebSocket) |
| LLM 선택 | Claude, GPT, Webhook 등 | GPT-4o 전용 |
| TTS 음색 | ElevenLabs 커스텀, Gemini 30종 등 | OpenAI 내장 11종 |
| STT 모델 | Deepgram, Google Chirp3 등 | Whisper-1 고정 |
| 파이프라인 훅 | onBeforeChat/onAfterChat 지원 | 불가 (중간 텍스트 접근 불가) |
| 비용 | 프로바이더별 개별 과금 | 오디오 토큰 기반 통합 과금 |

#### S2S 완전한 사용 예제

```typescript
// TypeScript — S2S 음성 봇 (STT/LLM/TTS 설정 불필요)
import { DVGatewayClient } from 'dvgateway-sdk';
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';

const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL']!,
  auth: { type: 'apiKey', apiKey: process.env['DV_API_KEY']! },
});

const realtime = new OpenAIRealtimeAdapter({
  apiKey: process.env['OPENAI_API_KEY']!,
  model: 'gpt-4o-realtime-preview',
  voice: 'nova',
  instructions: '당신은 친절한 한국어 음성 어시스턴트입니다. 짧고 명확하게 답변하세요.',
  language: 'ko',
  turnDetection: { mode: 'server_vad', threshold: 0.5, silenceDurationMs: 200 },
});

// AI 응답 오디오 → 통화 채널에 주입
realtime.onAudioOutput(async (pcm16k, linkedId) => {
  await gw.injectTTS(linkedId, pcm16k);
});

// 전사 결과 수신 (speaker: 'customer' | 'agent')
realtime.onTranscript((result) => {
  console.log(`[${result.speaker}] ${result.text}`);
});

realtime.onError((err, linkedId) => {
  console.error(`[S2S ERROR] ${linkedId}: ${err.message}`);
});

// 통화 이벤트 구독
gw.onCallInfo(async (event) => {
  if (event.type === 'call:new') {
    const stream = gw.streamAudio(event.linkedId, { dir: 'both' });
    await realtime.startSession(event.linkedId, stream);
  }
  if (event.type === 'call:ended') {
    await realtime.stop(event.linkedId);
  }
});

await gw.connect();
```

```python
# Python — S2S 음성 봇
import asyncio, os
from dvgateway import DVGatewayClient
from dvgateway.adapters.realtime import OpenAIRealtimeAdapter

gw = DVGatewayClient(
    base_url=os.environ["DV_BASE_URL"],
    auth={"type": "apiKey", "api_key": os.environ["DV_API_KEY"]},
)

realtime = OpenAIRealtimeAdapter(
    api_key=os.environ["OPENAI_API_KEY"],
    model="gpt-4o-realtime-preview",
    voice="nova",
    instructions="당신은 친절한 한국어 음성 어시스턴트입니다. 짧고 명확하게 답변하세요.",
    language="ko",
    turn_detection={"mode": "server_vad", "threshold": 0.5, "silence_duration_ms": 200},
)

def on_audio(pcm16k: bytes, linked_id: str):
    asyncio.ensure_future(gw.inject_tts(linked_id, pcm16k))

realtime.on_audio_output(on_audio)
realtime.on_transcript(lambda r: print(f"[{r.speaker}] {r.text}"))
realtime.on_error(lambda err, lid: print(f"[S2S ERROR] {lid}: {err}"))

async def on_call(event):
    if event["type"] == "call:new":
        stream = gw.stream_audio(event["linkedId"], dir="both")
        await realtime.start_session(event["linkedId"], stream)
    elif event["type"] == "call:ended":
        await realtime.stop(event["linkedId"])

gw.on_call_info(on_call)
asyncio.run(gw.connect())
```

#### S2S 채널에 별도 TTS 삽입

S2S 진행 중 별도 TTS 오디오(공지, 안내음 등)를 삽입할 수 있지만, S2S 응답 오디오와 겹침 방지를 위해 진행 중인 응답을 먼저 취소해야 합니다.

```typescript
// S2S 응답 중단 → 별도 TTS 삽입 → 재개
// 주의: 현재 어댑터는 내부 WebSocket을 직접 노출하지 않으므로,
// response.cancel이 필요한 경우 어댑터를 확장하거나
// S2S가 응답하지 않는 타이밍에 삽입하세요.

// 방법 1: S2S 미응답 구간에 삽입 (안전)
await gw.injectTTS(linkedId, announcementPcm);

// 방법 2: S2S 세션 일시 정지 후 삽입
await realtime.stop(linkedId);          // S2S 세션 종료
await gw.injectTTS(linkedId, announcePcm); // TTS 삽입
// 필요 시 S2S 세션 재시작
const stream = gw.streamAudio(linkedId, { dir: 'both' });
await realtime.startSession(linkedId, stream);
```

#### S2S 대시보드 VU/VAD 통합 (v1.4+)

S2S 모드에서 대시보드의 수신자(Callee) VU가 "AI" 스타일로 렌더되고, OpenAI Realtime 서버 VAD 이벤트가 대시보드 VAD 인디케이터로 직접 전달되도록 설정합니다. 이를 통해 운영자가 통화 카드에서 즉시 "AI 세션", "AI 발화 중(ducking)", "고객 발화 중(authoritative VAD)"를 구분할 수 있습니다.

**필수 설정**: `streamAudio`/`stream_audio` 호출 시 `pipelineType: 's2s'`를 선언해야 합니다. 선언하지 않으면 callee VU가 비어 있는 것처럼 보입니다(S2S 특성상 실제 상담원이 없으므로).

```typescript
// TypeScript — 완전한 S2S + 대시보드 VU/VAD 통합
import { DVGatewayClient } from 'dvgateway-sdk';
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';

const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL']!,
  auth: { type: 'apiKey', apiKey: process.env['DV_API_KEY']! },
});

const realtime = new OpenAIRealtimeAdapter({
  apiKey: process.env['OPENAI_API_KEY']!,
  model: 'gpt-4o-realtime-preview',
  voice: 'nova',
  language: 'ko',
  turnDetection: { mode: 'server_vad' }, // ← 필수: VAD 이벤트 수신
});

// AI 응답 오디오 → 통화 채널
realtime.onAudioOutput(async (pcm16k, linkedId) => {
  await gw.injectTts(linkedId, (async function* () { yield pcm16k; })());
});

// ★ 대시보드 VAD 전달 — 고객이 말하기 시작/종료를 대시보드에 authoritative하게 전달
realtime.onSpeechActivity(({ linkedId, side, speaking }) => {
  // VAD는 UI 힌트이므로 fire-and-forget (네트워크 블립에서 통화 끊기면 안 됨)
  gw.postVad(linkedId, side, speaking).catch(() => {});
});

gw.onCallInfo(async (event) => {
  if (event.type === 'call:new') {
    // ★ 필수: pipelineType: 's2s' 선언 → 대시보드가 callee VU를 AI 스타일로 렌더
    const stream = gw.streamAudio(event.linkedId, {
      dir: 'both',
      pipelineType: 's2s',
    });
    await realtime.startSession(event.linkedId, stream);
  }
  if (event.type === 'call:ended') {
    await realtime.stop(event.linkedId);
  }
});

await gw.connect();
```

```python
# Python — S2S + 대시보드 VU/VAD 통합
import asyncio, os
from dvgateway import DVGatewayClient
from dvgateway.adapters.realtime import (
    OpenAIRealtimeAdapter,
    RealtimeSpeechActivityEvent,
)

gw = DVGatewayClient(
    base_url=os.environ["DV_BASE_URL"],
    auth={"type": "apiKey", "api_key": os.environ["DV_API_KEY"]},
)

realtime = OpenAIRealtimeAdapter(
    api_key=os.environ["OPENAI_API_KEY"],
    model="gpt-4o-realtime-preview",
    voice="nova",
    language="ko",
    turn_detection={"mode": "server_vad"},  # ← 필수: VAD 이벤트 수신
)

def on_audio(pcm16k: bytes, linked_id: str):
    async def _gen():
        yield pcm16k
    asyncio.ensure_future(gw.inject_tts(linked_id, _gen()))

realtime.on_audio_output(on_audio)

# ★ 대시보드 VAD 전달
def on_vad(ev: RealtimeSpeechActivityEvent) -> None:
    # fire-and-forget — VAD는 UI 힌트
    asyncio.ensure_future(
        gw.post_vad(ev.linked_id, ev.side, ev.speaking)
    )
realtime.on_speech_activity(on_vad)

async def on_call(event):
    if event["type"] == "call:new":
        # ★ 필수: pipeline_type="s2s" 선언
        stream = gw.stream_audio(
            event["linkedId"],
            dir="both",
            pipeline_type="s2s",
        )
        await realtime.start_session(event["linkedId"], stream)
    elif event["type"] == "call:ended":
        await realtime.stop(event["linkedId"])

gw.on_call_info(on_call)
asyncio.run(gw.connect())
```

##### 대시보드에서 관찰되는 동작

| 이벤트 | 대시보드 표시 |
|--------|--------------|
| `pipelineType=s2s` 선언 | 세션 카드에 보라색 `S2S` 배지, callee VU 레이블이 "AI 🤖"로 변경, VU 그라디언트가 인디고/바이올렛으로 변경 |
| OpenAI `speech_started` | Caller VU의 VAD 인디케이터가 즉시 녹색으로 켜짐 (RMS 임계값 우회) |
| OpenAI `speech_stopped` | Caller VU의 VAD 인디케이터가 꺼짐 |
| AI TTS 응답 시작 (`tts:start`) | Caller VU에 ducking 효과(grayscale + 55% opacity + ⤓), callee VU에 "AI 발화 중" 펄스 애니메이션 |
| AI TTS 응답 종료 (`tts:end`) | Ducking 해제, callee VU 0으로 감쇠 |
| OpenAI 스트림 지터 (`tts:underrun`) | 세션 카드 헤더에 노란 경고 점(4초 후 자동 제거), 로그에 경고 기록 |

##### 트러블슈팅

- **Callee VU가 비어있음**: `pipelineType: 's2s'` 선언을 잊었거나, `gw.injectTts()`를 호출하지 않는 경우. TTS 주입 경로가 활성화되어야 게이트웨이 TTS Player가 VU 이벤트를 발행합니다.
- **VAD 인디케이터가 안 움직임**: `turnDetection.mode`가 `'none'`이면 OpenAI가 speech_started/stopped를 발행하지 않습니다. `'server_vad'`로 설정해야 합니다.
- **Ducking이 적용되지 않음**: `tts:start` 이벤트는 게이트웨이 내부 TTS Player가 발행하므로 SDK 측 설정과 무관합니다. `injectTts` 호출이 게이트웨이에 도달하고 있는지 확인하세요.
- **기존 STT+LLM+TTS 파이프라인에 영향**: `pipelineType`을 선언하지 않으면 기존 동작과 100% 동일합니다(기본값 빈 문자열).

#### 대시보드 S2S 설정

게이트웨이 대시보드에서 S2S를 설정할 수 있습니다:

1. **프로바이더 API 키** 탭 → S2S (Speech-to-Speech) 섹션 → OpenAI Realtime API 활성화 + API 키 입력
2. **파이프라인 설정** 탭 → S2S 모드 활성화 → 프로바이더, 모델, 음성, 시스템 지시 설정

대시보드에서 설정하면 SDK에서 `GET /api/v1/config/pipeline`으로 설정을 가져와 자동 적용할 수 있습니다.

### LLM 자격증명 통합 (API Keys 탭으로 일원화)

LLM API 키는 STT/TTS/S2S와 동일하게 **프로바이더 API 키** 탭에서만 관리합니다. **파이프라인 설정** 탭은 *어떤 키를 쓸지*(선택)와 모델·프롬프트·동작(히스토리/인사말/웹훅)만 담당합니다.

| 역할 | 저장 위치 | 설명 |
|------|-----------|------|
| LLM API 키 (claude, openai, gemini) | `apiKeysConfig.LLM` (`/api/v1/config/apikeys`) | 테넌트별 JSON. `enabled`, `role` (`primary`/`backup`), `apiKey` |
| LLM 선택자 | `pipelineconf.Config` (`/api/v1/config/pipeline`) | `llmProvider`, `llmRole`, `llmModel`, `fallbackProvider`, `fallbackRole`, `fallbackModel` |
| LLM 자격증명 해석 | `GET /api/v1/llm/resolve?role=primary\|backup[&provider=claude]` | 파이프라인 선택자를 apiKeysConfig.LLM에 매핑해 `{provider, role, model, apiKey}` 반환 |

우선순위 (서버의 `resolveLLMProvider`와 동일):
1. `provider` 쿼리 파라미터가 `apiKeysConfig.LLM`에 enabled+keyed로 존재하면 그 항목
2. `role` 파라미터 또는 파이프라인 `llmRole`/`fallbackRole`과 일치하는 enabled+keyed 항목
3. `role == "primary"`인 첫 번째 enabled+keyed 항목
4. 임의의 enabled+keyed 항목 (fallback)

SDK 권장 사용 패턴:

```typescript
// TypeScript — primary LLM 자격증명 해석
const res = await fetch(`${gateway}/api/v1/llm/resolve?role=primary`, {
  headers: { Authorization: `Bearer ${jwt}` },
});
const { provider, model, apiKey } = await res.json();
// provider/model/apiKey 로 Anthropic/OpenAI SDK 초기화
```

```python
# Python — 동일
r = httpx.get(f"{gateway}/api/v1/llm/resolve", params={"role": "primary"}, headers={"Authorization": f"Bearer {jwt}"})
data = r.json()
provider, model, api_key = data["provider"], data["model"], data["apiKey"]
```

Primary/Backup 페일오버가 필요한 경우:
1. API Keys 탭에서 Claude(role=primary)와 OpenAI(role=backup) 모두 enabled+키 입력
2. Pipeline 탭에서 Fallback 섹션에 원하는 프로바이더 또는 `역할 = Backup` 선택
3. SDK는 `?role=primary` 실패 시 `?role=backup`으로 재시도 → 서로 다른 프로바이더로 자동 전환

`llmProvider = "webhook"`는 자격증명이 아니므로 예외입니다. `resolve` 응답은 `{provider: "webhook", webhookUrl}`을 반환하고, SDK는 `pipelineconf.WebhookURL`/`WebhookSecret`을 사용해 요청을 서명합니다.

#### S2S Tool Calling (Function Calling)

S2S 세션에서 모델이 외부 함수를 호출할 수 있습니다. DB 조회, API 호출, 주문 처리 등에 활용합니다.

```typescript
// TypeScript — S2S + Tool Calling
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';
import type { OpenAIRealtimeTool, RealtimeToolCall } from 'dvgateway-adapters/realtime';

const tools: OpenAIRealtimeTool[] = [
  {
    type: 'function',
    name: 'lookup_order',
    description: '주문번호로 주문 상태를 조회합니다.',
    parameters: {
      type: 'object',
      properties: {
        order_id: { type: 'string', description: '주문번호' },
      },
      required: ['order_id'],
    },
  },
  {
    type: 'function',
    name: 'transfer_agent',
    description: '상담원에게 통화를 전환합니다.',
    parameters: {
      type: 'object',
      properties: {
        department: { type: 'string', description: '부서명 (예: 배송, 결제, 반품)' },
      },
      required: ['department'],
    },
  },
];

const realtime = new OpenAIRealtimeAdapter({
  apiKey: process.env['OPENAI_API_KEY']!,
  model: 'gpt-4o-realtime-preview',
  voice: 'nova',
  language: 'ko',
  instructions: '주문 관련 문의 시 lookup_order를 호출하세요. 상담원 요청 시 transfer_agent를 호출하세요.',
  tools,
  toolChoice: 'auto',   // "auto" | "none" | "required" | { type: "function", name: "fn" }
});

// 모델이 함수 호출 시 실행
realtime.onToolCall(async (call: RealtimeToolCall) => {
  console.log(`[TOOL] ${call.name}(${JSON.stringify(call.args)})`);

  if (call.name === 'lookup_order') {
    const status = await db.getOrderStatus(call.args.order_id as string);
    realtime.submitToolResult(call.linkedId, call.callId, { status, eta: '2일 후 도착' });
  }
  if (call.name === 'transfer_agent') {
    realtime.submitToolResult(call.linkedId, call.callId, { transferred: true });
    // 실제 전환 로직...
  }
});
```

```python
# Python — S2S + Tool Calling
from dvgateway.adapters.realtime import OpenAIRealtimeAdapter, RealtimeToolCall

tools = [
    {
        "type": "function",
        "name": "lookup_order",
        "description": "주문번호로 주문 상태를 조회합니다.",
        "parameters": {
            "type": "object",
            "properties": {
                "order_id": {"type": "string", "description": "주문번호"},
            },
            "required": ["order_id"],
        },
    },
]

realtime = OpenAIRealtimeAdapter(
    api_key=os.environ["OPENAI_API_KEY"],
    model="gpt-4o-realtime-preview",
    voice="nova",
    language="ko",
    instructions="주문 관련 문의 시 lookup_order를 호출하세요.",
    tools=tools,              # list[dict] 또는 list[OpenAIRealtimeTool]
    tool_choice="auto",       # "auto" | "none" | "required" | {"type":"function","name":"fn"}
)

def handle_tool_call(call: RealtimeToolCall):
    print(f"[TOOL] {call.name}({call.args})")
    if call.name == "lookup_order":
        status = db.get_order_status(call.args["order_id"])
        realtime.submit_tool_result(call.linked_id, call.call_id, {"status": status})

realtime.on_tool_call(handle_tool_call)
```

**Tool Calling 흐름:**
1. 사용자 발화 → 모델이 함수 호출 필요 판단
2. `onToolCall` / `on_tool_call` 핸들러 호출 (callId, name, args 전달)
3. 함수 실행 후 `submitToolResult` / `submit_tool_result`로 결과 반환
4. 모델이 결과를 반영하여 음성 응답 생성

#### GeminiLiveAdapter — `toolChoice` / `tool_choice` 옵션은 **AUTO 고정** (중요)

⚠️ **알려진 제약 (v1.4.10+에서 안전 처리)**: `GeminiLiveAdapter`도 OpenAI parity를 위해 `toolChoice` / `tool_choice` 옵션을 노출하지만, **Gemini Live BidiGenerateContent 의 `setup` 메시지 스키마에는 `tool_config` 필드가 없습니다** (일반 `GenerateContent` API에는 있지만 Live API에는 없음). v1.4.5 ~ 1.4.9에서는 SDK가 `tool_config`를 setup에 포함시켜 **Gemini가 WS를 즉시 close (code=1011 bad setup)** 하는 버그가 있었습니다 — 사용자 측 증상은 `start_session_exit age=0s chunks_sent=N` 로 나타났습니다.

**v1.4.10+ 동작**:
- `tools`만 사용하면 정상 작동 (Gemini는 항상 AUTO 모드로 함수 호출 결정)
- `toolChoice` / `tool_choice` 값을 명시하면 어댑터가 **저장만 하고 Gemini로는 보내지 않음** + 한 번 WARN 로그 출력

```
[GeminiLive] toolChoice="required" ignored — Gemini Live BidiGenerateContent setup
has no tool_config field. Tools default to AUTO calling mode. To pin a specific
function, add an explicit instruction in your system_instruction prompt.
```

**`required` / 특정 function 강제가 필요한 경우 — 두 가지 우회 방법**:

1. **System instruction으로 강제**:
   ```python
   instructions = "주문번호로 문의 시 반드시 lookup_order 함수를 호출하세요. 직접 답변하지 마세요."
   ```
2. **Live API 대신 일반 `GenerateContent` API 사용** — `tool_config` 지원됨. `buildGeminiToolConfig()` / `build_gemini_tool_config()` 헬퍼는 이 용도로 export되어 있습니다.

**일반 사용 (AUTO 모드면 충분)**:

```typescript
// TypeScript — toolChoice 생략 (AUTO가 기본)
const realtime = new GeminiLiveAdapter({
  apiKey: process.env['GEMINI_API_KEY']!,
  model: 'gemini-live-2.5-flash-preview',
  voice: 'Puck',
  instructions: '주문 문의 시 lookup_order를 호출하세요.',
  tools,
  // toolChoice 생략 — AUTO 모드 자동 적용
});
```

```python
# Python — tool_choice 생략 (AUTO가 기본)
realtime = GeminiLiveAdapter(
    api_key=os.environ["GEMINI_API_KEY"],
    model="gemini-live-2.5-flash-preview",
    voice="Puck",
    instructions="주문 문의 시 lookup_order를 호출하세요.",
    tools=tools,
    # tool_choice 생략 — AUTO 모드 자동 적용
)
```

**OpenAI Realtime과의 차이**: OpenAI는 `session.update`에 `tool_choice` 필드가 있어 `'required'` / 특정 function 강제 가능. Gemini Live는 Setup에 없으므로 system instruction prompt로 우회해야 합니다.

TTS 선택 가이드: `GEMINI` (가성비·30음성) / `ELEVENLABS` (최고 품질·한국어 네이티브) / `OPENAI` (voiceInstructions·스타일 제어) / `COSYVOICE` (중국어 특화·저비용)

---

## 환경변수

```bash
# 게이트웨이 연결
DV_BASE_URL=http://localhost:8080    # 게이트웨이 API 주소
DV_API_KEY=dvgw_xxx                  # SDK API 키

# STT 프로바이더
DEEPGRAM_API_KEY=dg_xxx              # Deepgram
GOOGLE_STT_API_KEY=project:key       # Google Chirp3 (V2: "project_id:key")

# LLM 프로바이더
ANTHROPIC_API_KEY=sk-ant-xxx         # Anthropic Claude
OPENAI_API_KEY=sk-xxx                # OpenAI GPT (LLM + TTS + STT + Realtime 공용)

# TTS 프로바이더
GEMINI_API_KEY=AIza_xxx              # Google Gemini TTS
ELEVENLABS_API_KEY=el_xxx            # ElevenLabs
COSYVOICE_API_KEY=sk-xxx             # Alibaba CosyVoice (DashScope)
TTS_PROVIDER=gemini                  # gemini / elevenlabs / openai / cosyvoice
```

---

## 멀티테넌트

- 테넌트 클라이언트: JWT에 포함된 `tenantId`로 자동 격리
- Admin (`tenantId=""`): 모든 테넌트 데이터 접근 가능
- 착신전환 API: `tenantId` 쿼리 파라미터 또는 JWT 자동

---

## 문서 참조

| 문서 | 내용 |
|------|------|
| [SDK 가이드 (전체)](https://github.com/OLSSOO-Inc/dvgateway-releases) | 설치부터 고급 기능까지 |
| [PBX 관리 API](docs/pbx-management-api.md) | 착신전환, 발신자표시, 클릭투콜, 캠페인 REST API |
| [퀵 매뉴얼](docs/pbx-quick-reference.md) | curl 예제 복사해서 바로 사용 |
| [어댑터 상세](docs/sdk-guide/04-adapter-reference.md) | STT/LLM/TTS 설정 |
| [캠페인 가이드](docs/sdk-guide/11-pbx-management.md) | 캠페인 + 이벤트 모니터링 |

---

_최종 업데이트: 2026-04-06_
