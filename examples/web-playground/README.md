# DVGateway Web Playground

SaaS DVGateway 테넌트가 브라우저에서 자기 테넌트 자격증명만 가지고
통화 이벤트·TTS·DTMF·STT를 클릭으로 체험할 수 있는 단일 페이지 데모입니다.

빌드 도구가 필요 없습니다. 정적 HTML + 모듈 JS로 동작하며,
인증/이벤트/주입 흐름은 SDK 가이드 [14-tenant-fixed-audio-guide.md](../../docs/sdk-guide/14-tenant-fixed-audio-guide.md) 와 정확히 일치합니다.

> **참고 링크**
> - 바이너리·install.sh — [OLSSOO-Inc/dvgateway-releases](https://github.com/OLSSOO-Inc/dvgateway-releases)
> - SDK 가이드 (한국어) — [docs/sdk-guide/](../../docs/sdk-guide/README.md)
> - SaaS 테넌트 5분 시작 — [§14 tenant-fixed-audio-guide](../../docs/sdk-guide/14-tenant-fixed-audio-guide.md)
> - 멀티 구독자 충돌 방지 — [§15 multi-subscriber-tenant-isolation](../../docs/sdk-guide/15-multi-subscriber-tenant-isolation.md)

---

## 빠른 시작

```bash
cd examples/web-playground
python3 -m http.server 8000
# 또는
npx serve .
```

브라우저에서 `http://localhost:8000` 을 열고 다음 순서대로 진행합니다:

1. **연결** — 좌측 "1. 테넌트 자격증명"에 운영자가 발급한 Gateway Host / Tenant ID / Password 를 입력하고 Connect.
2. **전화 걸어보기 또는 전화 받기로 테스트** — 좌측 "3. 발신(클릭투콜)" 패널에서 수신 번호로 전화를 걸거나, 본인 휴대폰에서 게이트웨이 DID로 전화를 걸어 활성 통화를 만듭니다. 발신표시번호·과금번호는 운영자가 등록한 값이 자동으로 사용되며 변경할 수 없습니다.
3. **데모 템플릿 선택** — TTS·DTMF·STT 등 원하는 시나리오를 클릭하면 우측 패널에서 실행됩니다.

기본 포트는 `:8081/login` (JWT 발급) + `:8080/api/...` (API/WS) 입니다.
TLS·non-standard 포트는 **고급** 토글에서 변경할 수 있습니다.

연결되면 우측 상단에 `tenant: <tid>` 핑이 표시되고, 활성 통화가 좌측 패널에 나타납니다.

### 발신(클릭투콜) 사전 조건

발신 패널의 Originate 버튼이 비활성화돼 있다면, 해당 테넌트에 대한 발신표시번호(`cidNumber`)와 과금번호(`accountCode`)가 아직 등록되지 않았다는 뜻입니다. **운영자(admin)** 가 다음 한 줄로 등록할 수 있습니다:

```bash
curl -X PUT https://gw.example.com:8080/api/v1/tenants/<tenantId>/outbound-defaults \
  -H "Authorization: Bearer <ADMIN_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"cidNumber":"07045144801","cidName":"ACME 상담센터","accountCode":"ACCT-2026-01"}'
```

또는 게이트웨이 대시보드의 **테넌트 설정 → 발신 고정값** 카드에서 등록합니다. 이 값은 변조 방지를 위해 클라이언트(playground/SDK)에서는 절대 변경할 수 없으며, click-to-call 요청 시 게이트웨이가 자동으로 주입합니다.

---

## 프로바이더 API 키 (TTS/STT 자기 키로 시도)

데모 사용자가 자기 ElevenLabs · Google Gemini · Deepgram · OpenAI · Google STT 키를 직접 사용해
TTS·STT를 시도해볼 수 있습니다. 좌측 패널 **2. 프로바이더 API 키**에서 두 가지 모드를 제공합니다.

| 모드 | 동작 | 지원 |
|------|------|------|
| **A — 게이트웨이에 저장** (권장) | `POST /api/v1/config/apikeys` 로 게이트웨이에 키 등록 → `/tts/synthesize`·STT 시작 호출이 그 키를 자동 사용. | TTS 5종 · STT 3종 |
| **B — 브라우저에서 직접 호출** | 키가 게이트웨이에 저장되지 않고, 브라우저에서 provider 로 직접 fetch → 받은 오디오를 게이트웨이로 raw bytes POST. | TTS: ElevenLabs / Gemini |

Mode B의 STT 가 빠진 이유: STT는 통화 오디오 스트림(20ms 프레임 raw PCM)을 받아 provider WS로
중계하는 작업이라 브라우저 3홉 경로가 적절치 않습니다. STT는 Mode A로 충분합니다.

**키 저장**:
- 게이트웨이가 마스킹된 형태(`••••••••abcd`)로 받은 키를 `/etc/dvgateway/apikeys/{tenantId}.json` 에 보관 (Mode A)
- 브라우저 `localStorage` 의 `dvgw-playground-provider-v1` 에도 사용자 입력 그대로 저장 (Clear credentials 누르면 둘 다 비워짐)

**테스트 합성** 버튼은 현재 모드 + 선택된 provider 로 "테스트입니다" 를 합성해 PCM 바이트 길이를 보고합니다 — 통화에는 주입하지 않으므로 안전하게 키 검증용으로 쓰세요.

> `file://` 로 직접 열어도 동작은 하지만, 일부 브라우저가 ES 모듈 로딩을 막을 수 있으니
> 작은 정적 서버로 띄우는 것을 권장합니다.

---

## 들어 있는 데모 7개

| # | 템플릿 | 설명 |
|---|--------|------|
| 1 | Callinfo 모니터 | 모든 callinfo 이벤트의 최근 흐름을 시각화 |
| 2 | 전화 수신 시 인사말 TTS | `channel:state(up)` 또는 `call:new` 트리거 → 자동 TTS 주입 |
| 3 | Click-to-TTS | 활성 통화 선택 → 텍스트 입력 → 즉시 주입 |
| 4 | 샘플 음원 재생 | slin16 PCM (또는 WAV/MP3) 업로드 → 통화 주입 |
| 5 | DTMF 수신 | 키패드 UI로 받은 DTMF 강조 표시 |
| 6 | STT 실시간 자막 | 회의 ID에 대해 클라우드 STT 시작/정지 + 자막 라이브 |
| 7 | 통화 종료 후 후처리 | `call:ended` 누적 — CRM 업로드/설문 발송 패턴 |
| … | 앱 푸시·알림 | 연동된 모바일 앱(내선 기준)으로 dvg_event 푸시 — 범용/통화요약/부재중. 푸시 릴레이 설정 필요 |

> 인앱 좌측 목록의 번호가 최신 기준입니다(이 표는 대표 항목만 발췌). 전체 목록은 `templates/index.js` 참조.

각 템플릿은 우측 **Code** 탭에서 복사 가능한 핵심 코드를 보여줍니다.

---

## 인증 흐름 (가이드 §14.3)

```
1) POST http://<host>:8081/login
   Content-Type: application/json
   { "tenantId": "...", "password": "..." }
   → { "token": "<JWT (24h)>" }

2) ws://<host>:8080/api/v1/ws/callinfo?token=<JWT>
   (브라우저는 Authorization 헤더를 못 보내므로 ?token= 쿼리 사용)

3) POST http://<host>:8080/api/v1/tts/<linkedId>
   Authorization: Bearer <JWT>
   Content-Type: application/octet-stream
   <raw slin16 PCM>
```

JWT 페이로드의 `tid` 클레임으로 게이트웨이가 자동 격리하므로,
**다른 테넌트의 이벤트나 통화는 절대 받을 수 없습니다.**

---

## 자격증명 저장

- 입력한 Host / Tenant ID / **Password**, 포트 설정은 이 브라우저의 `localStorage`에만 저장됩니다.
- **Clear credentials** 버튼으로 즉시 삭제됩니다.
- 공용 PC에서 사용한 뒤에는 반드시 지우거나 시크릿 창을 사용하세요.

---

## 트러블슈팅

| 증상 | 원인 / 조치 |
|------|------------|
| `login failed (404)` | 포트 오타. `/login`은 **8081**번 포트입니다 (대시보드와 동일) |
| `login failed (401)` | tenantId 또는 password 오류 |
| WebSocket 즉시 `1006` 끊김 | JWT 만료(24h) — Connect 다시 / 프록시(nginx)가 `Upgrade`/`Connection` 헤더 차단 |
| TTS `403` | 받은 `linkedId`가 내 테넌트 소유가 아님 (다른 테넌트 통화의 linkedId 사용) |
| TTS `404` | 해당 통화가 이미 종료됨 — `call:ended` 받은 뒤에는 호출 불가 |
| TTS `503` | 기능 비활성 — 라이선스 확인 요청 |
| 음질 이상 (잡음, 속도) | PCM 포맷 오류. `ffmpeg -ac 1 -ar 16000 -f s16le -acodec pcm_s16le` 로 변환 |

---

## CORS

게이트웨이는 모든 경로에서 `Access-Control-Allow-Origin: *` 와
`Authorization, X-API-Key, X-Tenant-ID, Content-Type` 헤더를 허용합니다.
별도 프록시 없이 브라우저에서 바로 호출됩니다.

---

## 구조

```
web-playground/
├── index.html              엔트리 (UI 마크업 + 모듈 import)
├── app.js                  연결 / 활성 콜 / 로그 / 템플릿 라우팅
├── styles.css
├── lib/
│   └── gateway-client.js   얇은 브라우저 클라이언트 (login, callinfo WS, TTS POST)
└── templates/
    ├── index.js            템플릿 레지스트리
    ├── callinfo-monitor.js
    ├── greeting-tts.js
    ├── click-tts.js
    ├── sample-playback.js
    ├── dtmf-receive.js
    ├── stt-live.js
    └── call-ended.js
```

새 템플릿을 추가하려면 `templates/` 안에 모듈을 만들고 `templates/index.js`의
`templates` 배열에 등록하세요. 모듈은 `{ mount(ctx), code }` 를 export하면 됩니다.

---

## 백엔드 SDK 예제 (참고)

브라우저 데모로는 부족하고 실제 서버에서 돌리는 정식 SDK 예제는
`examples/01-basic-voice-bot.ts` ~ `examples/08-webhook-n8n-integration.ts`
및 `examples/python/` 디렉터리를 참조하세요.

> SaaS 테넌트 가입자가 처음 보아야 할 문서:
> [docs/sdk-guide/14-tenant-fixed-audio-guide.md](../../docs/sdk-guide/14-tenant-fixed-audio-guide.md)
