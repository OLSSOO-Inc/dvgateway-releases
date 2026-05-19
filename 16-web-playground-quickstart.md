# 16. Web Playground 빠른 시작 — 코드 없이 5분 만에 체험하기

이 페이지는 **DVGateway SaaS 테넌트** 가입 직후, 코드 한 줄 안 쓰고
브라우저에서 통화 이벤트·TTS·DTMF·STT를 클릭으로 체험할 수 있도록 만든
**Web Playground** 사용법입니다.

> 📦 **다운로드**:
> [GitHub Releases](https://github.com/OLSSOO-Inc/dvgateway-releases/releases/latest) →
> `web-playground.zip` (가장 최근 릴리즈)
>
> 또는 dvgateway-releases 레포의 [`examples/web-playground/`](https://github.com/OLSSOO-Inc/dvgateway-releases/tree/main/examples/web-playground) 디렉터리를 그대로 복사해도 됩니다.

---

## 누구를 위한 가이드인가

- **방금 SaaS 테넌트를 발급받은 사용자** — 게이트웨이 운영 권한은 없고,
  본인 테넌트 자격증명 (Host / Tenant ID / Password) 만 받은 상태.
- **SDK 코드를 짜기 전에 무엇이 가능한지 먼저 보고 싶은 개발자** — Node/Python
  설치 없이 브라우저만으로 흐름을 확인.
- **AI 서비스 (TTS·STT) 키를 직접 테스트해보려는 사용자** — ElevenLabs /
  Gemini / Deepgram / OpenAI 키가 정상 동작하는지 통화 없이도 확인 가능.

코드를 직접 작성해야 한다면 [01 시작하기](01-getting-started.md) 와
[14 신규 테넌트 가이드](14-tenant-fixed-audio-guide.md) 를 함께 참고하세요.

---

## 사전 준비 — 운영자에게 받아야 할 3가지

본인의 SaaS 운영팀 또는 게이트웨이 관리자에게 다음 3개를 발급받습니다.

| 항목 | 예시 | 비고 |
|---|---|---|
| **Gateway Host** | `gw.example.com` | 도메인 또는 IP. **스킴/포트 없이** (`https://`, `:8080` 빼고 입력) |
| **Tenant ID** | `tenant-acme` | 본인 테넌트 식별자 |
| **Tenant Password** | 받은 비밀번호 | JWT 토큰 발급용. 24시간마다 갱신됨 |

기본 포트는 `8081` (로그인) + `8080` (API/WS) 입니다. 비표준 포트나 TLS 를
사용하는 환경은 Playground 의 **고급** 토글로 변경합니다.

---

## 1단계 — Playground 실행

### 옵션 A: 다운로드한 zip 으로 (가장 쉬움)

```bash
# 1. 최신 릴리즈에서 web-playground.zip 다운로드 후 압축 해제
unzip web-playground.zip
cd web-playground

# 2. 정적 서버로 띄우기 (둘 중 아무거나)
python3 -m http.server 8000
# 또는
npx serve .
```

### 옵션 B: dvgateway-releases 레포에서 직접

```bash
git clone https://github.com/OLSSOO-Inc/dvgateway-releases.git
cd dvgateway-releases/examples/web-playground
python3 -m http.server 8000
```

브라우저에서 **`http://localhost:8000`** 열기.

> 💡 **왜 정적 서버를 띄우나요?** 일부 브라우저가 `file://` 로 직접 연 페이지에서
> ES 모듈 로딩을 막습니다. `python3 -m http.server 8000` 한 줄이면 충분합니다.

---

## 2단계 — 연결

좌측 패널 **1. Tenant credentials** 에 운영자에게 받은 3개를 입력합니다.

```
Gateway Host:     gw.example.com
Tenant ID:        tenant-acme
Tenant Password:  ********
```

**Connect** 버튼을 누릅니다.

- ✅ 성공: 우측 상단에 `tenant: tenant-acme` 표시 + 로그 패널에 `callinfo WS open`
- ❌ 실패:
  - `login failed (404)` → Host 또는 포트 오타. **`8081`** 인지 확인 (대시보드와 같은 포트)
  - `login failed (401)` → Tenant ID 또는 Password 오타
  - `connection refused` → 운영자에게 방화벽/포트 오픈 요청

자격증명은 이 브라우저의 `localStorage` 에만 저장됩니다. 공용 PC 사용 후엔
**Clear credentials** 버튼으로 즉시 삭제하세요.

---

## 3단계 — 통화 만들기

게이트웨이가 알고 있는 본인 테넌트 번호로 **휴대폰에서 직접 전화**를 걸어
보세요. 보통:

- 운영자가 발급한 DID 번호 (예: `02-1234-5678`)
- 또는 운영자가 캠페인 / Click-to-call 로 발신해주는 통화

연결되면 좌측 **Active calls** 패널에 통화 카드가 자동으로 나타납니다.
카드를 클릭하면 그 통화가 "선택된 통화" 로 설정되고, 우측 영역의 데모
템플릿이 그 통화를 대상으로 동작합니다.

---

## 4단계 — 7개 데모 체험

상단의 **템플릿 선택** 드롭다운에서 하나 고른 다음, 우측 패널의 안내대로
버튼을 누르면 됩니다. 각 템플릿은 **Code** 탭에서 동일 동작을 SDK 로
구현하는 핵심 코드를 보여주니, 마음에 드는 흐름이 있으면 그 코드를 복사해
프로젝트에 가져갈 수 있습니다.

| # | 템플릿 | 무엇을 보나 | 처음 시작 추천도 |
|---|---|---|---|
| 1 | **Callinfo 모니터** | 모든 통화 이벤트가 실시간 흐르는 모습 | ⭐⭐⭐ 가장 먼저 |
| 2 | **인사말 TTS** | 전화 받자마자 자동 TTS 재생 | ⭐⭐⭐ |
| 3 | **Click-to-TTS** | 활성 통화에 즉시 텍스트→음성 주입 | ⭐⭐⭐ |
| 4 | **샘플 음원 재생** | PCM/WAV/MP3 파일을 통화에 송출 | ⭐⭐ |
| 5 | **DTMF 수신** | 키패드 입력을 실시간 표시 | ⭐⭐ |
| 6 | **STT 실시간 자막** | 회의 ID 에 STT 시작 → 자막 라이브 | ⭐ STT 라이선스 필요 |
| 7 | **통화 종료 후 후처리** | `call:ended` 누적 → CRM 업로드 패턴 | ⭐ |

### 권장 순서

1. **#1 Callinfo 모니터** 켜놓고 휴대폰으로 전화 → 끊기까지 → 어떤 이벤트가
   언제 발사되는지 눈으로 확인.
2. **#2 인사말 TTS** 로 전화 받자마자 자동 안내 재생.
3. **#3 Click-to-TTS** 로 통화 중 임의 시점에 음성 주입 — 가장 시각적임.
4. 나머지는 본인 요구사항에 맞춰서.

---

## 5단계 (선택) — 본인 TTS/STT 키 테스트

ElevenLabs · OpenAI · Deepgram · Gemini · Google STT 키를 직접 가지고
있다면 좌측 **2. 프로바이더 API 키** 섹션에서 두 가지 방식으로 시도할 수
있습니다.

| 모드 | 어떻게 동작 | 언제 쓰나 |
|---|---|---|
| **A — 게이트웨이에 저장** (권장) | 키를 게이트웨이에 보관 → TTS/STT 호출이 그 키 사용 | 실제 통화에 적용 |
| **B — 브라우저에서 직접 호출** | 키가 게이트웨이에 안 가고 브라우저에서 provider 로 직접 fetch | 키 작동 여부만 빠르게 검증 |

**테스트 합성** 버튼은 현재 모드 + 선택된 provider 로 "테스트입니다" 를
합성해 PCM 바이트 길이만 보고합니다. **통화에는 주입하지 않으므로 안전하게
키 검증용으로 쓸 수 있습니다.**

> 🔐 **보안**: 키는 게이트웨이가 마스킹된 형태 (`••••••••abcd`) 로
> `/etc/dvgateway/apikeys/{tenantId}.json` 에 저장합니다. 브라우저
> `localStorage` 의 `dvgw-playground-provider-v1` 에도 사용자 입력 그대로
> 저장됩니다 (모드 B 용). **Clear credentials** 누르면 둘 다 비워집니다.

---

## 자주 발생하는 문제

| 증상 | 원인 / 조치 |
|---|---|
| 통화는 걸리는데 Active calls 에 안 뜸 | 다른 테넌트 소속 통화이거나, 게이트웨이가 아직 callinfo 발사 전. 1-2초 대기 후에도 없으면 운영자에게 본인 테넌트의 DID 매핑 확인 요청 |
| TTS 버튼 누르면 `403` | 받은 `linkedId` 가 내 테넌트 소유가 아님. JWT 가 다른 테넌트로 발급된 상태이거나, 다른 사용자의 통화를 잡고 있음 |
| TTS `404` | 그 통화가 이미 종료됨. `call:ended` 받은 뒤에는 호출 불가 |
| TTS `503` | 기능이 라이선스로 비활성. 운영자에게 라이선스 확인 요청 |
| WebSocket 이 즉시 `1006` 으로 끊김 | JWT 24h 만료 → **Connect** 다시. nginx/리버스 프록시가 `Upgrade` / `Connection` 헤더를 흘리는지 확인 |
| TTS 가 잡음이거나 속도 이상 | 업로드한 PCM 포맷 오류. `ffmpeg -ac 1 -ar 16000 -f s16le -acodec pcm_s16le out.pcm` 로 변환 |
| STT 시작했는데 자막 안 나옴 | 회의 ID 가 잘못됐거나 STT 라이선스 미보유. 운영자에게 회의 ID 발급 + 라이선스 피처 확인 |

더 자세한 트러블슈팅은 [10 FAQ + 문제 해결](10-faq-troubleshooting.md) 참조.

---

## 다음 단계 — SDK 로 옮기기

Playground 에서 동작 확인한 흐름은 그대로 SDK 코드로 옮길 수 있습니다.
각 템플릿의 **Code** 탭에 있는 핵심 코드 + 해당 문서를 함께 참고하세요.

| Playground 에서 본 것 | SDK 로 옮기려면 |
|---|---|
| Callinfo 이벤트 흐름 | [05 이벤트 후킹](05-events-fallback.md), [11 PBX 관리](11-pbx-management.md) |
| 전화 받자마자 TTS 인사 | [13 음성 플로우 제어](13-voice-flow-controls.md), [14 신규 테넌트 가이드](14-tenant-fixed-audio-guide.md) |
| Click-to-TTS / 임의 시점 주입 | [01 시작하기](01-getting-started.md), 예제 `06-text-input-tts.ts` |
| 샘플 음원 재생 | [13 음성 플로우 제어 — play_audio](13-voice-flow-controls.md) |
| DTMF 수신 | [13 음성 플로우 제어 — DTMF](13-voice-flow-controls.md) |
| STT 자막 | [02 AI 서비스](02-ai-services.md), [03 파이프라인](03-pipeline-patterns.md) |
| 후처리 (CRM 업로드 등) | [09 훅 + Webhook](09-hooks-webhook.md), 예제 `07-pipeline-hooks-rag.ts` |

---

## 운영자에게 (참고)

이 Playground 는 게이트웨이 **서버 측에 아무것도 설치하지 않습니다.**
사용자 노트북에서 정적 HTML 로만 동작하고, 게이트웨이의 REST/WS API 를
JWT 인증으로 호출합니다. 테넌트별 RLS 미들웨어가 격리해주므로 다른
테넌트의 통화/이벤트는 절대 받을 수 없습니다.

내부적으로 호출하는 엔드포인트:

- `POST :8081/login` — Tenant 자격증명 → JWT
- `WS :8080/api/v1/ws/callinfo?token=<JWT>` — 이벤트 구독
- `POST :8080/api/v1/tts/{linkedId}` — TTS PCM 주입
- `POST :8080/api/v1/config/apikeys` — provider 키 등록 (Mode A)
- `POST :8080/api/v1/tts/synthesize` — 키 검증용 텍스트→음성

CORS 는 게이트웨이가 모든 경로에서 `Access-Control-Allow-Origin: *` +
`Authorization, X-API-Key, X-Tenant-ID, Content-Type` 헤더 허용하도록
이미 설정되어 있어 별도 프록시 불필요.
