# FAQ 및 문제 해결

## 19. 자주 묻는 질문 (FAQ)

**Q: 한국어와 영어가 섞인 통화(코드 스위칭)는 어떻게 처리하나요?**
A: Deepgram의 `language: 'multi'` 또는 `language: 'ko'`를 사용하세요. Nova-3 모델은 한국어+영어 혼용을 잘 처리합니다.

**Q: 통화 중 AI 음성을 중단시킬 수 있나요?**
A: OpenAI Realtime 어댑터를 사용하는 경우 서버 VAD가 자동으로 처리합니다. 카스케이드 파이프라인에서는 `DELETE /api/v1/tts/{linkedId}` REST API를 호출하여 진행 중인 TTS 재생을 중단할 수 있습니다.

**Q: AI 응답 대기 중 통화가 무음이 되어 고객이 끊습니다.**
A: `GW_COMFORT_NOISE_ENABLED=true`를 설정하세요. 파이프라인 빌더 사용 시 별도 코드 없이 자동으로 comfort noise가 주입됩니다. 자세한 내용은 [16. Comfort Noise](#16-comfort-noise--ai-처리-중-무음-방지) 섹션을 참고하세요.

**Q: API 키 비용이 걱정됩니다.**
A: [15. STT·TTS API 비용 절감](#15-stttts-api-비용-절감--캐시-및-최적화-전략) 섹션을 참고하세요. 주요 전략:
- TTS 캐시: `CachedTtsAdapter`로 반복 안내 멘트 비용 $0 달성
- STT 최적화: VAD 필터 + `endpointingMs` 조정으로 20~40% 절감
- 저비용 프로바이더: Deepgram Nova-3 ($0.0043/분) + claude-haiku/gpt-4o-mini + OpenAI tts-1

**Q: 녹음/전사 데이터를 저장하고 싶습니다.**
A: `onTranscript` 콜백에서 DB에 저장하면 됩니다. 단, 개인정보보호법 준수를 위해 동의 없이 저장하지 마세요.

**Q: 동시에 몇 통화까지 처리할 수 있나요?**
A: 서버 라이선스에 따라 다릅니다 (1 / 10 / 50 / 100 / 500+ 동시 통화). `http://your-gateway:8080/api/v1/license/status`에서 현재 한도를 확인할 수 있습니다.

**Q: 인터넷 없이 온프레미스로만 사용 가능한가요?**
A: DVGateway 서버 자체는 온프레미스로 설치 가능합니다. 단, AI 서비스(Deepgram, ElevenLabs 등)는 외부 API를 호출하므로 인터넷 연결이 필요합니다. 완전 폐쇄망 환경은 별도 문의하세요.

---

## 20. 문제 해결

### 연결 오류: `ECONNREFUSED http://localhost:8080`

DVGateway 서버가 실행 중인지 확인하세요:

```bash
# 서비스 상태 확인
systemctl status dvgateway

# 재시작
systemctl restart dvgateway

# 로그 확인
journalctl -u dvgateway -f
```

### SSL 오류: `SSL: WRONG_VERSION_NUMBER`

로컬 개발 환경에서 WebSocket 연결 시 아래와 같은 오류가 반복된다면:

```
"err": "Cannot connect to host localhost:8080 ssl:default [[SSL: WRONG_VERSION_NUMBER] wrong version number ...]"
```

**원인**: SDK의 `force_tls` 옵션이 기본값 `true`이므로, `http://` → `https://` → `wss://`로 자동 변환됩니다. 로컬 서버가 TLS를 사용하지 않으면 SSL 핸드셰이크가 실패합니다.

**해결** — `DVGatewayClient` 생성 시 `force_tls`를 끄세요:

```python
# Python
gw = DVGatewayClient(
    base_url="http://localhost:8080",
    security={"force_tls": False},   # ← 로컬 개발 시 필수
)
```

```javascript
// Node.js
const gw = new DVGatewayClient({
  baseUrl: 'http://localhost:8080',
  security: { forceTls: false },     // ← 로컬 개발 시 필수
});
```

> ⚠️ **운영(프로덕션) 환경에서는 반드시 TLS를 사용하세요.** `force_tls: false`는 로컬 개발 전용입니다.

### 인증 오류: `HTTP 401: authentication required`

SDK가 게이트웨이 서버에 연결할 때 API 키를 JWT로 교환하는데, 이 단계에서 인증이 실패한 경우입니다.

**확인 순서:**

1. `.env` 파일이 `bot.py` (또는 `bot.js`)와 **같은 폴더**에 있는지 확인
2. `.env` 파일에서 `DV_API_KEY` 값이 플레이스홀더가 아닌 **실제 키**인지 확인
3. 키 앞뒤에 따옴표(`"`)나 공백이 없는지 확인 (`.env` 파일에는 따옴표 없이 값만 넣으세요)
4. 게이트웨이 서버에서 API 키를 다시 확인:

```bash
# DVGateway 서버에서 실행
sudo cat /etc/dvgateway/api-key

# 또는 대시보드(http://서버IP:8081) → 설정 → API Keys
```

5. API 키가 맞는지 직접 테스트:

```bash
# 서버에 직접 인증 요청 (your-api-key를 실제 키로 교체)
curl -X POST http://localhost:8080/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"apiKey": "your-api-key"}'

# 성공 시 {"token": "eyJ..."} 형태의 JWT가 반환됩니다
# 실패 시 {"error": "authentication required"} 가 반환됩니다
```

> 💡 **참고:** `DV_API_KEY`는 DVGateway 서버의 키이며, Deepgram·Anthropic·ElevenLabs 등 AI 서비스의 API 키와는 **완전히 다른 키**입니다. 혼동하지 마세요!

### STT가 인식을 못 함

1. Deepgram API 키가 올바른지 확인 (`dg_` 로 시작)
2. 언어 코드 확인 (`language: 'ko'`)
3. 대시보드(`http://your-server:8081`)에서 VU 미터로 오디오 수신 여부 확인

### TTS 음성이 통화에 재생되지 않음

1. `linkedId`가 정확한지 확인
2. `audioFilter` 방향 확인 (인바운드/아웃바운드)
3. DVGateway 로그에서 TTS 주입 오류 확인

### OpenAI Realtime 연결 오류

1. API 키에 Realtime 모델 접근 권한이 있는지 확인
2. `OpenAI-Beta: realtime=v1` 헤더가 설정되어 있는지 확인 (어댑터가 자동 처리)
3. 모델명이 정확한지 확인: `gpt-4o-realtime-preview`

### 지연 시간이 너무 김

지연 시간 단축 체크리스트:

- [ ] ElevenLabs: `model: 'eleven_flash_v2_5'`, `optimizeStreamingLatency: 4`
- [ ] Deepgram: `endpointingMs: 400` 이하로 설정
- [ ] LLM: `maxTokens` 를 256–512로 줄이기
- [ ] 가장 빠른 LLM 모델 사용: `claude-haiku-4-5-20251001` 또는 `gpt-4o-mini`
- [ ] 또는 OpenAI Realtime 어댑터로 전환 (단일 서비스, 최저 지연)

---

## 21. 원라인 서버 업데이트

```bash
# 대시보드 UI에서 업데이트 버튼 클릭
# 또는 터미널에서:
curl -fsSL https://github.com/OLSSOO-Inc/dvgateway-releases/releases/latest/download/install.sh | sudo bash
```

업데이트는 서비스 무중단으로 진행됩니다 (zero-downtime rolling update).

---

---

## 22. 진짜 초보자용 메뉴얼 — Node.js·Python 설치부터 봇 실행까지

> 이 섹션은 프로그래밍 경험이 없거나 처음 시작하는 분들을 위한 단계별 안내입니다.
> 마치 옆에서 알려주듯이 하나씩 따라 하세요. 어렵지 않아요! 😊

---

### A. Node.js로 시작하기 (Windows / macOS / Linux)

#### A-1. Node.js 설치

Node.js는 JavaScript를 서버에서 실행하게 해주는 프로그램입니다.

**Windows:**

1. 웹 브라우저에서 https://nodejs.org 접속
2. **"LTS"** 버튼 클릭 (Long Term Support — 안정 버전)
3. 다운로드된 `.msi` 파일을 실행하고 "Next" 계속 클릭
4. 설치 완료 후 **Windows 키 → "cmd" 검색 → 명령 프롬프트** 실행
5. 아래 명령어 입력 후 버전이 나오면 설치 성공:

```
node --version
npm --version
```

예상 출력:
```
v22.14.0
10.9.2
```

**macOS:**

```bash
# Homebrew가 없다면 먼저 설치
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js 설치
brew install node@22

# 버전 확인
node --version
npm --version
```

**Ubuntu / Debian Linux:**

```bash
# NodeSource 공식 저장소 추가 (Node.js 22 LTS)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 버전 확인
node --version
npm --version
```

---

#### A-2. 프로젝트 폴더 만들기

```bash
# 바탕화면이나 원하는 위치에 폴더 생성
mkdir my-voice-bot
cd my-voice-bot
```

---

#### A-3. DVGateway 서버 설치

AI 음성 봇이 통화를 받으려면 DVGateway 서버가 필요합니다.
서버는 여러분의 컴퓨터(또는 클라우드 서버)에 설치합니다.

```bash
# DVGateway 서버 원라인 설치 (Ubuntu/Debian 서버)
# ⚠️ 이 명령은 서버 컴퓨터(Linux)에서 실행하세요
curl -fsSL https://github.com/OLSSOO-Inc/dvgateway-releases/releases/latest/download/install.sh | sudo bash
```

설치 후 자동으로 서비스가 시작됩니다.

```bash
# 서버가 잘 실행되는지 확인
systemctl status dvgateway

# 대시보드 접속 (웹 브라우저)
# http://서버IP주소:8081
```

---

#### A-4. SDK 설치 (Node.js)

```bash
# my-voice-bot 폴더 안에서 실행
npm init -y                          # package.json 생성
npm pkg set type=module              # ESM 모듈 방식 설정
npm install dvgateway-sdk dvgateway-adapters dotenv
```

> `npm init -y`는 프로젝트 설정 파일을 자동 생성합니다.
> 여러 질문을 건너뛰고 싶을 때 `-y` 옵션을 씁니다.
> `npm pkg set type=module`은 최신 `import` 문법을 사용하기 위해 필요합니다.

---

#### A-5. API 키 준비

AI 서비스를 사용하려면 각 서비스의 API 키가 필요합니다.
API 키는 "서비스를 쓰기 위한 비밀 암호"라고 생각하세요.

| 서비스 | 가입 주소 | 비용 |
|--------|---------|------|
| **Deepgram** (음성→텍스트) | https://console.deepgram.com | 무료 $200 크레딧 |
| **ElevenLabs** (텍스트→음성) | https://elevenlabs.io | 무료 월 10,000자 |
| **OpenAI** (AI 대화, 기본) | https://platform.openai.com | 소액 유료 |
| **Anthropic Claude** (AI 대화, 백업) | https://console.anthropic.com | 소액 유료 (선택) |

가입 후 각 사이트의 "API Keys" 메뉴에서 키를 발급받으세요.

`.env` 파일 만들기:

```bash
# my-voice-bot 폴더 안에 .env 파일 생성
# Windows: 메모장으로 .env 파일 만들기
# Mac/Linux: 아래 명령어 실행
cat > .env << 'EOF'
DEEPGRAM_API_KEY=여기에_Deepgram_키_붙여넣기
ELEVENLABS_API_KEY=여기에_ElevenLabs_키_붙여넣기
OPENAI_API_KEY=여기에_OpenAI_키_붙여넣기
ANTHROPIC_API_KEY=여기에_Anthropic_키_붙여넣기
DV_API_KEY=여기에_게이트웨이_API_키_붙여넣기
EOF
```

> ⚠️ `.env` 파일은 절대 다른 사람에게 보여주거나 GitHub에 올리지 마세요!
> API 키가 유출되면 요금이 나올 수 있습니다.

> ⚠️ **흔한 실수 체크리스트:**
> - `여기에_..._붙여넣기` 같은 플레이스홀더를 실제 키로 바꿨나요?
> - 키 앞뒤에 **따옴표(`"`)나 공백**이 들어가지 않았나요? (`.env` 파일에는 따옴표 없이 값만 넣으세요)
> - `.env` 파일이 `bot.js`와 **같은 폴더**에 있나요?

---

#### A-5-1. 내 게이트웨이 API 키(`DV_API_KEY`) 확인하는 방법

`.env` 파일에 넣을 `DV_API_KEY` 값을 모르겠다면 아래 방법으로 확인하세요.
이 키는 Deepgram·OpenAI 등 AI 서비스 키와 **다른 키**입니다 — DVGateway 서버 자체에 접속하기 위한 키입니다.

**방법 1. 대시보드에서 확인 (가장 쉬움)**

1. 브라우저를 열고 주소창에 `http://서버IP:8081` 을 입력합니다.
2. 왼쪽 메뉴에서 **설정**을 클릭합니다.
3. **SDK API Key** 항목에서 키를 확인합니다.
4. **복사** 버튼을 누르면 키가 복사됩니다 → `.env` 파일의 `DV_API_KEY=` 뒤에 붙여넣으세요.

> 처음 접속하면 키가 자동으로 생성됩니다. 별도 신청이 필요 없습니다.

**방법 2. 키를 분실했거나 재발급이 필요할 때**

대시보드(`http://서버IP:8081`)의 **설정 → SDK API Key** 에서 **재발급** 버튼을 누르세요.
새 키가 화면에 한 번 표시됩니다 — 이때 반드시 복사해 두세요!

> ⚠️ 재발급하면 이전 키는 즉시 무효화됩니다. 기존 봇의 `.env` 파일도 새 키로 업데이트하세요.

---

#### A-6. 첫 번째 봇 코드 작성

`bot.js` 파일을 만들고 아래 내용을 붙여넣으세요:

```javascript
// bot.js — 가장 간단한 AI 음성 봇
import 'dotenv/config';  // .env 파일 읽기

import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter, AnthropicAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

async function main() {
  // ── 0. API 키가 제대로 로드됐는지 확인 ──────────────────────
  const requiredKeys = ['DV_API_KEY', 'DEEPGRAM_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY'];
  const missing = requiredKeys.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`❌ .env 파일에 다음 키가 없습니다: ${missing.join(', ')}`);
    console.error('   .env 파일을 확인하고 API 키를 넣어주세요.');
    process.exit(1);
  }

  // 1. 게이트웨이 서버 연결
  //    ↓ 서버 IP 주소를 입력하세요 (같은 컴퓨터면 localhost)
  //    ⚠️ 로컬 개발 시 security.forceTls: false 필수!
  //       이 옵션이 없으면 SDK가 자동으로 https/wss로 변환하여
  //       "SSL: WRONG_VERSION_NUMBER" 오류가 발생합니다.
  const gw = new DVGatewayClient({
    baseUrl: 'http://localhost:8080',
    auth: {
      type: 'apiKey',
      apiKey: process.env.DV_API_KEY,
    },
    security: { forceTls: false },  // 로컬 개발 시 필수 (TLS 미사용)
  });

  // 2. AI 어댑터 설정
  const stt = new DeepgramAdapter({
    apiKey: process.env.DEEPGRAM_API_KEY,
    language: 'ko',      // 한국어
    model: 'nova-3',     // 가장 정확한 모델
  });

  const llm = new OpenAILlmAdapter({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini',           // 기본 LLM
    systemPrompt: '당신은 친절한 한국어 AI 안내원입니다. 짧고 명확하게 답변하세요.',
  });

  const llmFallback = new AnthropicAdapter({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-4-5-20251001',  // 백업 LLM
    systemPrompt: '당신은 친절한 한국어 AI 안내원입니다. 짧고 명확하게 답변하세요.',
  });

  const tts = new ElevenLabsAdapter({
    apiKey: process.env.ELEVENLABS_API_KEY,
    model: 'eleven_flash_v2_5',   // 가장 빠른 음성 합성
    voiceId: '21m00Tcm4TlvDq8ikWAM',  // Rachel 음성 (무료)
  });

  // 3. 파이프라인 시작 (OpenAI 기본, Anthropic 백업)
  console.log('봇을 시작합니다...');

  await gw.pipeline()
    .stt(stt)
    .llm(llm)
    .fallback(llmFallback)
    .tts(tts)
    .onNewCall((session) => {
      console.log(
        `📞 전화가 왔어요!\n` +
        `   linkedId    : ${session.linkedId}\n` +
        `   발신자번호  : ${session.caller ?? '알 수 없음'}\n` +
        `   발신자이름  : ${session.callerName ?? '알 수 없음'}\n` +
        `   DID 번호    : ${session.did ?? '알 수 없음'}\n` +
        `   상담원내선  : ${session.agentNumber ?? '알 수 없음'}`
        // ── session에서 추가로 출력할 수 있는 필드 ──
        // + `\n   착신번호    : ${session.callee}`
        // + `\n   콜 ID      : ${session.callId}`
        // + `\n   방향        : ${session.dir}`
        // + `\n   컨퍼런스ID  : ${session.confId}`
        // + `\n   테넌트 ID   : ${session.tenantId}`
        // + `\n   시작시각    : ${session.startedAt}`
        // + `\n   스트림 URL  : ${session.streamUrl}`
        // + `\n   메타데이터  : ${JSON.stringify(session.metadata)}`
      );
    })
    .onTranscript((result, session) => {
      if (result.isFinal) {
        console.log('🎙️  고객이 말했어요:', result.text);
      }
    })
    .onCallEnded((id, duration) => {
      console.log(`📴 통화 종료. 통화 시간: ${duration}초`);
    })
    .onError((err, linkedId) => {
      console.error('❌ 오류 발생:', err.message);
    })
    .start();

  console.log('✅ 봇이 준비되었습니다. 전화를 기다리는 중...');
}

// 프로그램 시작
main().catch(console.error);
```

---

#### A-7. 봇 실행

```bash
node bot.js
```

정상 실행 시 아래와 같이 출력됩니다:
```
봇을 시작합니다...
✅ 봇이 준비되었습니다. 전화를 기다리는 중...
```

이제 전화가 오면 자동으로 AI가 응대합니다!

멈추려면 `Ctrl + C`를 누르세요.

---

#### A-7½. 기능 확장 — 키워드 부스팅 · 감정 분석 · TTS 인사 재생

기본 봇이 잘 돌아가면, 아래 기능들을 하나씩 추가해 보세요.
각 기능은 **독립적**이므로 원하는 것만 골라 적용할 수 있습니다.

> ⚠️ **도메인 키워드(Keywords)는 기본 적용이 아닙니다.**
> SDK가 자동으로 키워드를 넣어주는 것이 아니라, 개발자가 `keywords` 옵션을 직접 설정해야 합니다.
> 내 서비스에서 자주 쓰이는 전문 용어를 넣으면 인식률이 크게 올라갑니다.

`bot-enhanced.js` 파일을 새로 만들어 보세요:

```javascript
// bot-enhanced.js — 키워드 부스팅 + 감정 분석 + TTS 인사 재생
import 'dotenv/config';

import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

async function main() {
  const gw = new DVGatewayClient({
    baseUrl: 'http://localhost:8080',
    auth: { type: 'apiKey', apiKey: process.env.DV_API_KEY },
    security: { forceTls: false },
  });

  // ── STT: 도메인 키워드 부스팅 + 감정 분석 ─────────────────
  //    keywords 배열에 내 서비스의 전문 용어를 넣으세요.
  //    Deepgram Nova-3가 해당 단어를 우선 인식합니다.
  //    ⚠️ keywords는 기본 적용이 아닙니다 — 직접 설정해야 합니다!
  const stt = new DeepgramAdapter({
    apiKey: process.env.DEEPGRAM_API_KEY,
    language: 'ko',
    model: 'nova-3',
    keywords: [                       // ← 도메인 용어 부스팅
      '게이트웨이', 'DVGateway',      //   제품명
      'OLSSOO', '얼쑤',              //   회사명
      'SIP', 'RTP', 'WebRTC',        //   기술 용어
      '인바운드', '아웃바운드',         //   업무 용어
    ],
    sentiment: true,                  // ← 감정 분석 활성화
  });

  const llm = new OpenAILlmAdapter({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini',
    systemPrompt: '당신은 친절한 한국어 AI 안내원입니다. 짧고 명확하게 답변하세요.',
  });

  const tts = new ElevenLabsAdapter({
    apiKey: process.env.ELEVENLABS_API_KEY,
    model: 'eleven_flash_v2_5',
    voiceId: '21m00Tcm4TlvDq8ikWAM',  // Rachel 음성
  });

  console.log('확장 봇을 시작합니다...');

  await gw.pipeline()
    .stt(stt)
    .llm(llm)
    .tts(tts)
    // ── 전화가 오면 TTS로 인사말 재생 ────────────────────────
    .onNewCall(async (session) => {
      console.log(
        `📞 전화가 왔어요!\n` +
        `   linkedId    : ${session.linkedId}\n` +
        `   발신자번호  : ${session.caller ?? '알 수 없음'}\n` +
        `   발신자이름  : ${session.callerName ?? '알 수 없음'}\n` +
        `   DID 번호    : ${session.did ?? '알 수 없음'}\n` +
        `   상담원내선  : ${session.agentNumber ?? '알 수 없음'}`
        // ── session에서 추가로 출력할 수 있는 필드 ──
        // + `\n   착신번호    : ${session.callee}`
        // + `\n   콜 ID      : ${session.callId}`
        // + `\n   방향        : ${session.dir}`
        // + `\n   컨퍼런스ID  : ${session.confId}`
        // + `\n   테넌트 ID   : ${session.tenantId}`
        // + `\n   시작시각    : ${session.startedAt}`
        // + `\n   스트림 URL  : ${session.streamUrl}`
        // + `\n   메타데이터  : ${JSON.stringify(session.metadata)}`
      );

      // TTS로 환영 인사를 먼저 재생합니다
      await gw.say(
        session.linkedId,
        '안녕하세요, MAKECALL AI 안내 서비스입니다. 무엇을 도와드릴까요?',
        tts,
      );
      console.log('🔊 인사말 재생 완료');
    })
    // ── 감정 분석 결과 확인 ───────────────────────────────────
    .onTranscript((result, session) => {
      if (!result.isFinal) return;

      // 발화 텍스트 출력
      console.log('🎙️  고객:', result.text);

      // 감정 분석 결과가 있으면 함께 출력
      if (result.sentiment) {
        const emoji = result.sentiment.sentiment === 'positive' ? '😊'
                    : result.sentiment.sentiment === 'negative' ? '😟'
                    : '😐';
        console.log(
          `   ${emoji} 감정: ${result.sentiment.sentiment} ` +
          `(${(result.sentiment.sentimentScore * 100).toFixed(0)}% 확신)`
        );
      }
    })
    .onCallEnded((id, duration) => {
      console.log(`📴 통화 종료. 통화 시간: ${duration}초`);
    })
    .onError((err) => {
      console.error('❌ 오류:', err.message);
    })
    .start();

  console.log('✅ 확장 봇 준비 완료. 전화를 기다리는 중...');
}

main().catch(console.error);
```

실행:
```bash
node bot-enhanced.js
```

**각 기능 설명:**

| 기능 | 코드 위치 | 효과 |
|------|----------|------|
| **키워드 부스팅** | `keywords: [...]` | 전문 용어 인식률 향상 (기본 OFF, 직접 설정 필요) |
| **감정 분석** | `sentiment: true` | 고객 감정 실시간 파악 (positive/neutral/negative) |
| **TTS 인사** | `gw.say(...)` in `onNewCall` | 전화 받자마자 AI 음성으로 인사 |

> 💡 **키워드 예시** — 내 업종에 맞게 바꾸세요:
> - 병원: `['진료', '예약', '처방전', '보험', '접수']`
> - 쇼핑몰: `['배송', '교환', '환불', '주문번호', '카드결제']`
> - IT 헬프데스크: `['비밀번호', 'VPN', '재부팅', '로그인', '원격접속']`

---

#### A-7¾. 텍스트 입력 → TTS 재생 (터미널에서 직접 음성 송출)

봇이 통화 중일 때, 터미널에서 텍스트를 입력하면 상대방에게 TTS로 재생하는 기능입니다.
실시간 안내 방송, 수동 메시지 전달, 디버깅 등에 유용합니다.

`bot-tts-input.js` 파일을 만들어 보세요:

```javascript
// bot-tts-input.js — 텍스트 입력 → TTS 재생
import 'dotenv/config';
import * as readline from 'node:readline';

import { DVGatewayClient } from 'dvgateway-sdk';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

async function main() {
  // ── API 키 확인 ─────────────────────────────────────────────
  const requiredKeys = ['DV_API_KEY', 'ELEVENLABS_API_KEY'];
  const missing = requiredKeys.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`❌ .env 파일에 다음 키가 없습니다: ${missing.join(', ')}`);
    process.exit(1);
  }

  // ── 1. 게이트웨이 연결 ──────────────────────────────────────
  const gw = new DVGatewayClient({
    baseUrl: 'http://localhost:8080',
    auth: { type: 'apiKey', apiKey: process.env.DV_API_KEY },
    security: { forceTls: false },
  });

  // ── 2. TTS 어댑터 설정 ─────────────────────────────────────
  const tts = new ElevenLabsAdapter({
    apiKey: process.env.ELEVENLABS_API_KEY,
    model: 'eleven_flash_v2_5',       // 최저 지연 (~75ms)
    voiceId: '21m00Tcm4TlvDq8ikWAM',  // Rachel 음성 (무료)
  });

  // ── 3. 활성 콜 추적 ────────────────────────────────────────
  const activeCalls = new Map();       // linkedId → 발신자 정보
  let selectedCallId = null;           // 현재 선택된 콜

  // 새 전화가 오면 자동 추적
  gw.onCallEvent((event) => {
    if (event.type === 'call:new') {
      activeCalls.set(event.session.linkedId, {
        caller: event.session.caller ?? '알 수 없음',
      });
      console.log(`\n📞 새 콜: [${event.session.linkedId}] ${event.session.caller ?? ''}`);

      // 첫 번째 콜이면 자동 선택
      if (activeCalls.size === 1) {
        selectedCallId = event.session.linkedId;
        console.log('   → 자동 선택됨');
      }
    }
    if (event.type === 'call:ended') {
      activeCalls.delete(event.linkedId);
      console.log(`\n📴 콜 종료: [${event.linkedId}]`);
      if (selectedCallId === event.linkedId) {
        selectedCallId = activeCalls.size > 0
          ? activeCalls.keys().next().value
          : null;
      }
    }
  });

  // ── 4. TTS 재생 함수 ───────────────────────────────────────
  async function playTts(linkedId, text) {
    console.log(`🔊 TTS 재생 중... "${text}"`);
    try {
      await gw.say(linkedId, text, tts);
      console.log('✅ 재생 완료');
    } catch (err) {
      console.error('❌ 재생 실패:', err.message);
    }
  }

  // ── 5. 터미널 입력 받기 ─────────────────────────────────────
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  텍스트 입력 → TTS 재생기                      ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log('║  텍스트 입력  → 선택된 콜에 TTS 재생            ║');
  console.log('║  /list       → 활성 콜 목록                    ║');
  console.log('║  /select <id> → 재생 대상 콜 선택               ║');
  console.log('║  /quit       → 종료                            ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
  console.log('🔊 콜을 기다리는 중... 전화가 오면 텍스트를 입력하세요.\n');

  rl.setPrompt('TTS> ');
  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) { rl.prompt(); return; }

    // 명령어 처리
    if (input === '/quit') {
      console.log('👋 종료합니다...');
      gw.close();
      process.exit(0);
    }

    if (input === '/list') {
      if (activeCalls.size === 0) {
        console.log('📋 활성 콜 없음');
      } else {
        console.log(`📋 활성 콜 (${activeCalls.size}개):`);
        for (const [id, info] of activeCalls) {
          const marker = id === selectedCallId ? ' ← 선택됨' : '';
          console.log(`   [${id}] ${info.caller}${marker}`);
        }
      }
      rl.prompt();
      return;
    }

    if (input.startsWith('/select ')) {
      const id = input.split(/\s+/)[1];
      if (activeCalls.has(id)) {
        selectedCallId = id;
        console.log(`✅ 선택됨: [${id}]`);
      } else {
        console.log(`⚠️  콜 [${id}]을(를) 찾을 수 없습니다.`);
      }
      rl.prompt();
      return;
    }

    // TTS 재생
    if (!selectedCallId || !activeCalls.has(selectedCallId)) {
      console.log('⚠️  활성 콜이 없습니다. 전화가 오면 자동으로 선택됩니다.');
      rl.prompt();
      return;
    }

    await playTts(selectedCallId, input);
    rl.prompt();
  });
}

main().catch(console.error);
```

실행:
```bash
node bot-tts-input.js
```

**사용 방법:**

1. 봇을 실행하고 전화가 올 때까지 기다립니다
2. 전화가 연결되면 `TTS>` 프롬프트에 원하는 텍스트를 입력합니다
3. 입력한 텍스트가 상대방에게 AI 음성으로 재생됩니다

```
TTS> 안녕하세요, 잠시만 기다려 주세요.
🔊 TTS 재생 중... "안녕하세요, 잠시만 기다려 주세요."
✅ 재생 완료
TTS> 담당자를 연결해 드리겠습니다.
🔊 TTS 재생 중... "담당자를 연결해 드리겠습니다."
✅ 재생 완료
```

> 💡 **활용 예시:**
> - 콜센터 운영자가 상담 중 직접 안내 메시지 전달
> - AI 봇이 답변하기 어려운 질문에 사람이 직접 개입
> - 개발/테스트 시 TTS 음질 확인

---

#### A-7⅞. 커스텀 변수 활용 — 해피콜 · 주문확인 · 설문조사 봇

Dynamic VoIP 다이얼플랜에서 `CUSTOM_VALUE_01/02/03` 변수를 설정하면, SDK의 `session.customValue1/2/3`으로 전달됩니다. 이를 활용해 **고객 이름으로 인사하는 봇**, **주문번호를 확인하는 봇** 등을 만들 수 있습니다.

**원리 요약:**

```
┌─────────────────────────────────────────────────────────────┐
│ Dynamic VoIP 다이얼플랜                                          │
│   Set(CUSTOM_VALUE_01=홍길동)      ← 고객 이름               │
│   Set(CUSTOM_VALUE_02=ORD-20260321-001)  ← 주문번호          │
│   Set(CUSTOM_VALUE_03=happycall)  ← 용도 구분                │
│   Stasis(dvgateway, ..., custom_value_01=${CUSTOM_VALUE_01}, │
│     custom_value_02=${CUSTOM_VALUE_02},                      │
│     custom_value_03=${CUSTOM_VALUE_03})                      │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│ SDK (Node.js / Python)                                      │
│   session.customValue1  →  "홍길동"                          │
│   session.customValue2  →  "ORD-20260321-001"               │
│   session.customValue3  →  "happycall"                      │
│                                                             │
│   → TTS: "안녕하세요 홍길동 고객님, 주문 ORD-20260321-001    │
│           건에 대해 안내드리겠습니다."                         │
└─────────────────────────────────────────────────────────────┘
```

**다이얼플랜 예제 (Dynamic VoIP extensions.conf):**

해피콜, 주문확인, 설문조사 등 각 용도별로 커스텀 변수를 설정합니다.
CRM 시스템에서 Dynamic VoIP Originate API를 호출할 때 변수를 전달하면 됩니다.

```ini
; ── 해피콜 발신 컨텍스트 ──────────────────────────────────────
; CRM에서 Originate 호출 시 CUSTOM_VALUE_01~03 변수를 전달합니다.
; 예: AMI Action: Originate
;     Channel: SIP/trunk/01012345678
;     Context: outbound-happycall
;     Variable: CUSTOM_VALUE_01=홍길동,CUSTOM_VALUE_02=ORD-20260321-001,CUSTOM_VALUE_03=happycall
[outbound-happycall]
exten => _X.,1,NoOp(해피콜 발신: ${CUSTOM_VALUE_01})
 same => n,Set(DID_NUMBER=${CALLERID(num)})
 same => n,Stasis(dvgateway,mode=both,role=monitor,did=${DID_NUMBER},callernum=${CALLERID(num)},callednum=${EXTEN},custom_value_01=${CUSTOM_VALUE_01},custom_value_02=${CUSTOM_VALUE_02},custom_value_03=${CUSTOM_VALUE_03})
 same => n,Dial(SIP/trunk/${EXTEN},60)
 same => n,Hangup()

; ── 설문조사 발신 컨텍스트 ────────────────────────────────────
; CUSTOM_VALUE_01=고객이름, CUSTOM_VALUE_02=설문ID, CUSTOM_VALUE_03=survey
[outbound-survey]
exten => _X.,1,NoOp(설문조사 발신: ${CUSTOM_VALUE_01})
 same => n,Set(DID_NUMBER=${CALLERID(num)})
 same => n,Stasis(dvgateway,mode=both,role=monitor,did=${DID_NUMBER},callernum=${CALLERID(num)},callednum=${EXTEN},custom_value_01=${CUSTOM_VALUE_01},custom_value_02=${CUSTOM_VALUE_02},custom_value_03=${CUSTOM_VALUE_03})
 same => n,Dial(SIP/trunk/${EXTEN},60)
 same => n,Hangup()
```

##### 예제 1. 해피콜 봇 (Node.js)

`bot-happycall.js` — 고객 이름으로 인사하고, 주문 만족도를 확인하는 봇:

```javascript
// bot-happycall.js — 해피콜 봇 (커스텀 변수 활용)
import 'dotenv/config';

import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

async function main() {
  const gw = new DVGatewayClient({
    baseUrl: 'http://localhost:8080',
    auth: { type: 'apiKey', apiKey: process.env.DV_API_KEY },
    security: { forceTls: false },
  });

  const stt = new DeepgramAdapter({
    apiKey: process.env.DEEPGRAM_API_KEY,
    language: 'ko',
    model: 'nova-3',
    keywords: ['만족', '불만족', '교환', '환불', '배송'],
  });

  const tts = new ElevenLabsAdapter({
    apiKey: process.env.ELEVENLABS_API_KEY,
    model: 'eleven_flash_v2_5',
    voiceId: '21m00Tcm4TlvDq8ikWAM',
  });

  console.log('🎯 해피콜 봇을 시작합니다...');

  await gw.pipeline()
    .stt(stt)
    .llm(null)  // LLM 없이 시나리오 기반 동작
    .tts(tts)

    .onNewCall(async (session) => {
      // ── 커스텀 변수에서 고객 정보 추출 ──────────────────
      const customerName = session.customValue1 ?? '고객';    // "홍길동"
      const orderId      = session.customValue2 ?? '';        // "ORD-20260321-001"
      const callType     = session.customValue3 ?? 'general'; // "happycall"

      console.log(`📞 해피콜 시작`);
      console.log(`   고객명   : ${customerName}`);
      console.log(`   주문번호 : ${orderId}`);
      console.log(`   콜 유형  : ${callType}`);

      // ── 고객 이름을 넣어 TTS 인사말 재생 ────────────────
      // customValue1(고객 이름)을 인사말에 직접 사용합니다!
      const greeting = orderId
        ? `안녕하세요 ${customerName} 고객님, 인공지능 상담원 토리입니다. ` +
          `주문번호 ${orderId} 건에 대해 만족도 확인차 연락드렸습니다. ` +
          `서비스에 만족하셨나요?`
        : `안녕하세요 ${customerName} 고객님, 인공지능 상담원 토리입니다. ` +
          `최근 이용하신 서비스에 대해 만족도 확인차 연락드렸습니다. ` +
          `서비스에 만족하셨나요?`;

      await gw.say(session.linkedId, greeting, tts);
      console.log('🔊 인사말 재생 완료');
    })

    .onTranscript(async (result, session) => {
      if (!result.isFinal) return;

      const text = result.text;
      const customerName = session.customValue1 ?? '고객';
      console.log(`🎙️  ${customerName} 고객: ${text}`);

      // ── 간단한 키워드 기반 응답 ─────────────────────────
      if (text.includes('만족') || text.includes('좋') || text.includes('네')) {
        await gw.say(session.linkedId,
          `감사합니다 ${customerName} 고객님. ` +
          `만족하셨다니 다행입니다. 앞으로도 좋은 서비스로 보답하겠습니다. ` +
          `좋은 하루 되세요!`, tts);
      } else if (text.includes('불만') || text.includes('별로') || text.includes('아니')) {
        await gw.say(session.linkedId,
          `${customerName} 고객님, 불편을 드려 죄송합니다. ` +
          `담당자에게 전달하여 개선하도록 하겠습니다. ` +
          `추가로 말씀해 주실 내용이 있으신가요?`, tts);
      }
    })

    .onCallEnded((id, duration) => {
      console.log(`📴 해피콜 종료 (${duration}초)`);
    })
    .start();

  console.log('✅ 해피콜 봇 준비 완료. 발신을 기다리는 중...');
}

main().catch(console.error);
```

실행:
```bash
node bot-happycall.js
```

##### 예제 2. 주문확인 봇 (Node.js)

`bot-order-confirm.js` — 주문 내용을 안내하고 배송일을 확인하는 봇:

```javascript
// bot-order-confirm.js — 주문확인 전화 봇
import 'dotenv/config';

import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

async function main() {
  const gw = new DVGatewayClient({
    baseUrl: 'http://localhost:8080',
    auth: { type: 'apiKey', apiKey: process.env.DV_API_KEY },
    security: { forceTls: false },
  });

  const stt = new DeepgramAdapter({
    apiKey: process.env.DEEPGRAM_API_KEY,
    language: 'ko',
    model: 'nova-3',
    keywords: ['주문', '배송', '확인', '취소', '변경'],
  });

  const tts = new ElevenLabsAdapter({
    apiKey: process.env.ELEVENLABS_API_KEY,
    model: 'eleven_flash_v2_5',
    voiceId: '21m00Tcm4TlvDq8ikWAM',
  });

  // LLM에 주문 정보를 컨텍스트로 전달
  // onNewCall에서 session.customValue2(주문번호)를 시스템 프롬프트에 주입합니다
  const llm = new OpenAILlmAdapter({
    apiKey: process.env.OPENAI_API_KEY,
    model: 'gpt-4o-mini',
    systemPrompt: '당신은 주문 확인 전화를 하는 AI 상담원 토리입니다. 짧고 명확하게 답변하세요.',
  });

  console.log('📦 주문확인 봇을 시작합니다...');

  await gw.pipeline()
    .stt(stt)
    .llm(llm)
    .tts(tts)

    .onNewCall(async (session) => {
      const customerName = session.customValue1 ?? '고객';
      const orderId      = session.customValue2 ?? '주문번호 미확인';
      const orderDetail  = session.customValue3 ?? '';  // 예: "무선이어폰 1개, 3월 25일 배송예정"

      console.log(`📦 주문확인 전화 시작`);
      console.log(`   고객명   : ${customerName}`);
      console.log(`   주문번호 : ${orderId}`);
      console.log(`   주문내용 : ${orderDetail}`);

      // LLM 시스템 프롬프트에 주문 정보 주입
      // → LLM이 주문 내용을 알고 대화할 수 있습니다
      llm.setSystemPrompt(
        `당신은 주문 확인 전화를 하는 AI 상담원 토리입니다.\n` +
        `현재 통화 중인 고객: ${customerName}\n` +
        `주문번호: ${orderId}\n` +
        `주문내용: ${orderDetail}\n` +
        `고객이 주문 내용을 확인하면 감사 인사를 하고, ` +
        `변경이나 취소를 원하면 담당자 연결을 안내하세요.`
      );

      // 고객 이름 + 주문번호로 개인화된 인사
      await gw.say(session.linkedId,
        `안녕하세요 ${customerName} 고객님, 인공지능 상담원 토리입니다. ` +
        `주문번호 ${orderId} 건에 대해 안내드리겠습니다. ` +
        (orderDetail
          ? `고객님의 주문 내용은 ${orderDetail} 입니다. 맞으신가요?`
          : `주문 내용을 확인해 드릴까요?`),
        tts
      );
    })

    .onTranscript((result, session) => {
      if (result.isFinal) {
        console.log(`🎙️  ${session.customValue1 ?? '고객'}: ${result.text}`);
      }
    })

    .onCallEnded((id, duration) => {
      console.log(`📴 주문확인 종료 (${duration}초)`);
    })
    .start();

  console.log('✅ 주문확인 봇 준비 완료.');
}

main().catch(console.error);
```

##### 예제 3. 해피콜 봇 (Python) — custom_value_1을 TTS 인사말에 삽입

`05_happycall_bot.py` — 고객 이름(`custom_value_1`)과 주문번호(`custom_value_2`)를 TTS 인사말에 삽입하고,
통화별로 LLM 시스템 프롬프트에 고객 컨텍스트를 주입하는 실전 해피콜 봇:

```python
# examples/python/05_happycall_bot.py — 해피콜 봇 (커스텀 변수 활용)
#
# 핵심 포인트:
#   1. on_new_call에서 gw.say()로 고객 이름을 넣은 개인화 TTS 인사말 재생
#   2. 통화별로 LLM system_prompt에 고객 정보(이름, 주문번호) 주입
#   3. STT → LLM → TTS 전체 파이프라인으로 자연스러운 대화 처리
#
# 환경변수 (.env 파일 또는 export):
#   DV_BASE_URL=http://<gateway-host>:8080
#   DV_API_KEY=dvgw_xxxx...
#   DEEPGRAM_API_KEY=...
#   ANTHROPIC_API_KEY=...
#   ELEVENLABS_API_KEY=...
#
# 설치: pip install dvgateway-python python-dotenv
# 실행: python examples/python/05_happycall_bot.py
import os
import asyncio
from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import AnthropicAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter

load_dotenv()


async def main():
    gw = DVGatewayClient(
        base_url=os.environ.get("DV_BASE_URL", "http://localhost:8080"),
        auth={
            "type": "apiKey",
            "api_key": os.environ.get("DV_API_KEY", "dev-no-auth"),
        },
        reconnect={"max_attempts": 10, "initial_delay_ms": 2000},
    )

    stt = DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
        interim_results=True,
        endpointing_ms=400,
        smart_format=True,
        keywords=["만족", "불만족", "교환", "환불", "배송"],
    )

    llm = AnthropicAdapter(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        model="claude-sonnet-4-6",
        system_prompt="당신은 해피콜 AI 상담원 토리입니다.",
        max_tokens=200,
        temperature=0.7,
    )

    tts = ElevenLabsAdapter(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        model="eleven_flash_v2_5",
        voice_id="21m00Tcm4TlvDq8ikWAM",
    )

    # ── on_new_call: 고객 이름으로 TTS 인사말 + LLM 컨텍스트 주입 ──

    async def on_new_call(session):
        customer_name = session.custom_value_1 or "고객"
        order_id = session.custom_value_2 or ""

        print(f"[해피콜] 통화 시작")
        print(f"  고객명   : {customer_name}")
        print(f"  주문번호 : {order_id or '(없음)'}")

        # ✅ 통화별 LLM 시스템 프롬프트에 고객 정보 주입
        llm.system_prompt = (
            f"당신은 해피콜 전문 AI 상담원 '토리'입니다.\n"
            f"현재 통화 고객: {customer_name}\n"
            + (f"주문번호: {order_id}\n" if order_id else "")
            + "친절하고 간결하게 1-2문장으로 응대하세요.\n"
            "만족 응답 시 감사 인사 후 종료 안내, "
            "불만 응답 시 공감하고 담당자 연결을 안내하세요."
        )

        # ✅ 핵심: custom_value_1(고객 이름)을 TTS 인사말에 삽입
        if order_id:
            greeting = (
                f"안녕하세요 {customer_name} 고객님, "
                f"인공지능 상담원 토리입니다. "
                f"주문번호 {order_id} 건에 대해 "
                f"만족도 확인차 연락드렸습니다. "
                f"서비스에 만족하셨나요?"
            )
        else:
            greeting = (
                f"안녕하세요 {customer_name} 고객님, "
                f"인공지능 상담원 토리입니다. "
                f"최근 이용하신 서비스에 대해 "
                f"만족도 확인차 연락드렸습니다. "
                f"서비스에 만족하셨나요?"
            )

        await gw.say(session.linked_id, greeting, tts)
        print(f"[해피콜] 인사말 재생 완료")

    print("해피콜 봇 시작...\n전화를 기다리는 중...\n")

    await (
        gw.pipeline()
        .stt(stt)
        .llm(llm)
        .tts(tts)
        .on_new_call(on_new_call)
        .on_transcript(lambda result, session: (
            print(f"  {session.custom_value_1 or '고객'}: \"{result.text}\"")
            if result.is_final else None
        ))
        .on_call_ended(lambda linked_id, duration:
            print(f"[해피콜] 통화 종료 ({duration}초)\n")
        )
        .on_error(lambda err, linked_id=None:
            print(f"[해피콜] 오류: {err}")
        )
        .start()
    )


asyncio.run(main())
```

실행:
```bash
python examples/python/05_happycall_bot.py
```

##### 커스텀 변수 활용 요약

| 변수 | SDK 필드 (TS / Python) | 활용 예시 |
|------|----------------------|----------|
| `CUSTOM_VALUE_01` | `customValue1` / `custom_value_1` | 고객 이름 → TTS 인사말에 삽입 |
| `CUSTOM_VALUE_02` | `customValue2` / `custom_value_2` | 주문번호 / 설문 ID → 업무 컨텍스트 |
| `CUSTOM_VALUE_03` | `customValue3` / `custom_value_3` | 용도 구분 (happycall / survey / order) |

**핵심 패턴 — TTS에 변수 삽입:**

```javascript
// ✅ customValue1을 TTS 인사말에 삽입하는 핵심 코드
const name = session.customValue1 ?? '고객';
await gw.say(session.linkedId,
  `안녕하세요 ${name} 고객님, 인공지능 상담원 토리입니다.`,
  tts
);
```

```python
# ✅ Python 버전 — custom_value_1을 TTS 인사말에 삽입
name = session.custom_value_1 or "고객"
await gw.say(
    session.linked_id,
    f"안녕하세요 {name} 고객님, 인공지능 상담원 토리입니다.",
    tts,
)
```

**핵심 패턴 — LLM에 컨텍스트 주입:**

```javascript
// ✅ 커스텀 변수로 LLM에 업무 맥락을 전달
llm.setSystemPrompt(
  `현재 통화 고객: ${session.customValue1}\n` +
  `주문번호: ${session.customValue2}\n` +
  `통화 목적: ${session.customValue3}\n` +
  `위 정보를 바탕으로 고객을 응대하세요.`
);
```

> 💡 **CRM 연동 팁:** Dynamic VoIP AMI `Originate` API로 전화를 걸 때
> `Variable` 파라미터에 `CUSTOM_VALUE_01=홍길동,CUSTOM_VALUE_02=ORD-001`을 전달하면,
> 자동으로 다이얼플랜 → 게이트웨이 → SDK로 전달됩니다.

---

#### A-8. 봇을 항상 실행되게 하기 (PM2 사용)

컴퓨터가 재시작되어도 봇이 자동으로 켜지게 하려면:

```bash
# PM2 설치 (프로세스 관리자)
npm install -g pm2

# 봇을 PM2로 실행
pm2 start bot.js --name "my-voice-bot"

# 컴퓨터 재시작 시 자동 실행 등록
pm2 startup
pm2 save

# 로그 보기
pm2 logs my-voice-bot

# 봇 상태 확인
pm2 status

# 봇 재시작
pm2 restart my-voice-bot
```

---

### B. Python으로 시작하기 (Windows / macOS / Linux)

#### B-1. Python 설치

Python은 데이터 과학, AI 분야에서 가장 인기 있는 언어입니다.

**Windows:**

1. https://python.org/downloads 접속
2. **"Download Python 3.12.x"** 버튼 클릭
3. 설치 파일 실행
4. **반드시** "Add Python to PATH" 체크 후 Install Now 클릭
5. 설치 후 명령 프롬프트(cmd) 열고 확인:

```
python --version
pip --version
```

예상 출력:
```
Python 3.12.8
pip 24.3.1
```

**macOS:**

```bash
# Homebrew로 설치
brew install python@3.12

# 버전 확인
python3 --version
pip3 --version
```

**Ubuntu / Debian Linux:**

```bash
sudo apt update
sudo apt install -y python3.12 python3.12-venv python3-pip

# 버전 확인
python3 --version
pip3 --version
```

---

#### B-2. 가상환경 만들기

가상환경은 프로젝트마다 독립된 Python 환경을 만들어줍니다.
다른 프로젝트와 패키지 버전이 충돌하지 않도록 해줍니다.

```bash
# 프로젝트 폴더 만들기
mkdir my-voice-bot-py
cd my-voice-bot-py

# 가상환경 생성
python3 -m venv venv

# 가상환경 활성화
# ─ macOS / Linux:
source venv/bin/activate
# ─ Windows (명령 프롬프트):
venv\Scripts\activate.bat
# ─ Windows (PowerShell):
venv\Scripts\Activate.ps1

# 활성화되면 프롬프트 앞에 (venv) 가 붙습니다:
# (venv) user@computer:~/my-voice-bot-py$
```

> 가상환경에서 나오려면 `deactivate` 입력

---

#### B-3. SDK 및 필수 패키지 설치

```bash
# 가상환경이 활성화된 상태에서 실행
pip install "dvgateway[adapters]" python-dotenv
```

---

#### B-4. API 키 설정

`.env` 파일 만들기 (Node.js 섹션 A-5와 동일):

```ini
DEEPGRAM_API_KEY=여기에_Deepgram_키_붙여넣기
ELEVENLABS_API_KEY=여기에_ElevenLabs_키_붙여넣기
OPENAI_API_KEY=여기에_OpenAI_키_붙여넣기
ANTHROPIC_API_KEY=여기에_Anthropic_키_붙여넣기   # (선택) 백업 LLM
DV_API_KEY=여기에_게이트웨이_API_키_붙여넣기
```

> ⚠️ **흔한 실수 체크리스트:**
> - `여기에_..._붙여넣기` 같은 플레이스홀더를 실제 키로 바꿨나요?
> - 키 앞뒤에 **따옴표(`"`)나 공백**이 들어가지 않았나요? (`.env` 파일에는 따옴표 없이 값만 넣으세요)
> - `.env` 파일이 `bot.py`와 **같은 폴더**에 있나요?
>
> 키가 올바른지 확인하는 방법:
> ```bash
> # .env 파일 내용 확인 (키 일부만 표시)
> cat .env
> # DV_API_KEY=dv_live_abc123... 처럼 실제 값이 보여야 합니다
> ```

**`DV_API_KEY` 값을 모르겠다면?** → 위의 [A-5-1. 내 게이트웨이 API 키 확인하는 방법](#a-5-1-내-게이트웨이-api-키dv_api_key-확인하는-방법) 섹션을 참고하세요.
대시보드(`http://서버IP:8081`) → 설정 → SDK API Key에서 복사하는 것이 가장 쉽습니다.

---

#### B-5. 첫 번째 봇 코드 작성

`bot.py` 파일 만들기:

```python
# bot.py — 가장 간단한 AI 음성 봇 (Python 버전)
import asyncio
import os
from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import OpenAILlmAdapter, AnthropicAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter

# .env 파일에서 API 키 읽기
load_dotenv()

async def main():
    # ── 0. API 키가 제대로 로드됐는지 확인 ──────────────────────
    required_keys = ["DV_API_KEY", "DEEPGRAM_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY"]
    missing = [k for k in required_keys if not os.environ.get(k)]
    if missing:
        print(f"❌ .env 파일에 다음 키가 없습니다: {', '.join(missing)}")
        print("   .env 파일을 확인하고 API 키를 넣어주세요.")
        return

    # 1. 게이트웨이 서버 연결
    #    ↓ 서버 IP 주소를 입력하세요 (같은 컴퓨터면 localhost)
    #    ⚠️ 로컬 개발 시 security={"force_tls": False} 필수!
    #       이 옵션이 없으면 SDK가 자동으로 https/wss로 변환하여
    #       "SSL: WRONG_VERSION_NUMBER" 오류가 발생합니다.
    gw = DVGatewayClient(
        base_url="http://localhost:8080",   # 서버 IP 주소
        auth={
            "type": "apiKey",
            "api_key": os.environ["DV_API_KEY"],
        },
        security={"force_tls": False},      # 로컬 개발 시 필수 (TLS 미사용)
    )

    # 2. AI 어댑터 설정
    stt = DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
    )

    llm = OpenAILlmAdapter(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-4o-mini",
        system_prompt="당신은 친절한 한국어 AI 안내원입니다. 짧고 명확하게 답변하세요.",
    )

    llm_fallback = AnthropicAdapter(
        api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        model="claude-haiku-4-5-20251001",
        system_prompt="당신은 친절한 한국어 AI 안내원입니다. 짧고 명확하게 답변하세요.",
    )

    tts = ElevenLabsAdapter(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        model="eleven_flash_v2_5",
        voice_id="21m00Tcm4TlvDq8ikWAM",
    )

    # 3. 이벤트 핸들러 정의
    def on_new_call(session):
        print(
            f"📞 전화가 왔어요!\n"
            f"   linked_id  : {session.linked_id}\n"
            f"   발신자번호 : {session.caller or '알 수 없음'}\n"
            f"   발신자이름 : {session.caller_name or '알 수 없음'}\n"
            f"   DID 번호   : {session.did or '알 수 없음'}\n"
            f"   상담원내선 : {session.agent_number or '알 수 없음'}"
            # ── session에서 추가로 출력할 수 있는 필드 ──
            # f"\n   착신번호   : {session.callee}"
            # f"\n   콜 ID     : {session.call_id}"
            # f"\n   방향       : {session.dir}"
            # f"\n   컨퍼런스ID : {session.conf_id}"
            # f"\n   테넌트 ID  : {session.tenant_id}"
            # f"\n   시작시각   : {session.started_at}"
            # f"\n   스트림 URL : {session.stream_url}"
            # f"\n   메타데이터 : {session.metadata}"
        )

    def on_transcript(result, session):
        if result.is_final:
            print(f"🎙️  고객이 말했어요: {result.text}")

    def on_call_ended(linked_id, duration):
        print(f"📴 통화 종료. 통화 시간: {duration}초")

    def on_error(err, linked_id):
        print(f"❌ 오류 발생: {err}")

    # 4. 파이프라인 시작
    print("봇을 시작합니다...")

    await (
        gw.pipeline()
        .stt(stt)
        .llm(llm)
        .fallback(llm_fallback)
        .tts(tts)
        .on_new_call(on_new_call)
        .on_transcript(on_transcript)
        .on_call_ended(on_call_ended)
        .on_error(on_error)
        .start()
    )

    print("✅ 봇이 준비되었습니다. 전화를 기다리는 중...")

# 프로그램 시작
asyncio.run(main())
```

---

#### B-6. 봇 실행

```bash
# 가상환경이 활성화된 상태에서
python bot.py
```

---

#### B-6½. 기능 확장 — 키워드 부스팅 · 감정 분석 · TTS 인사 재생 (Python)

Node.js와 동일한 확장 기능을 Python으로 구현한 버전입니다.

> ⚠️ **도메인 키워드(Keywords)는 기본 적용이 아닙니다.**
> SDK가 자동으로 키워드를 넣어주는 것이 아니라, 개발자가 `keywords` 옵션을 직접 설정해야 합니다.

`bot_enhanced.py` 파일을 새로 만들어 보세요:

```python
# bot_enhanced.py — 키워드 부스팅 + 감정 분석 + TTS 인사 재생
import asyncio
import os
from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import OpenAILlmAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter

load_dotenv()

async def main():
    gw = DVGatewayClient(
        base_url="http://localhost:8080",
        auth={"type": "apiKey", "api_key": os.environ["DV_API_KEY"]},
        security={"force_tls": False},
    )

    # ── STT: 도메인 키워드 부스팅 + 감정 분석 ─────────────────
    #    keywords 리스트에 내 서비스의 전문 용어를 넣으세요.
    #    ⚠️ keywords는 기본 적용이 아닙니다 — 직접 설정해야 합니다!
    stt = DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
        keywords=[                        # ← 도메인 용어 부스팅
            "게이트웨이", "DVGateway",     #   제품명
            "OLSSOO", "얼쑤",             #   회사명
            "SIP", "RTP", "WebRTC",       #   기술 용어
            "인바운드", "아웃바운드",        #   업무 용어
        ],
        sentiment=True,                   # ← 감정 분석 활성화
    )

    llm = OpenAILlmAdapter(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-4o-mini",
        system_prompt="당신은 친절한 한국어 AI 안내원입니다. 짧고 명확하게 답변하세요.",
    )

    tts = ElevenLabsAdapter(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        model="eleven_flash_v2_5",
        voice_id="21m00Tcm4TlvDq8ikWAM",  # Rachel 음성
    )

    SENTIMENT_EMOJI = {"positive": "😊", "neutral": "😐", "negative": "😠"}

    # ── 전화가 오면 발신자 정보 출력 + TTS 인사말 재생 ─────────
    async def on_new_call(session):
        print(
            f"📞 전화가 왔어요!\n"
            f"   linked_id  : {session.linked_id}\n"
            f"   발신자번호 : {session.caller or '알 수 없음'}\n"
            f"   발신자이름 : {session.caller_name or '알 수 없음'}\n"
            f"   DID 번호   : {session.did or '알 수 없음'}\n"
            f"   상담원내선 : {session.agent_number or '알 수 없음'}"
            # ── session에서 추가로 출력할 수 있는 필드 ──
            # f"\n   착신번호   : {session.callee}"
            # f"\n   콜 ID     : {session.call_id}"
            # f"\n   방향       : {session.dir}"
            # f"\n   컨퍼런스ID : {session.conf_id}"
            # f"\n   테넌트 ID  : {session.tenant_id}"
            # f"\n   시작시각   : {session.started_at}"
            # f"\n   스트림 URL : {session.stream_url}"
            # f"\n   메타데이터 : {session.metadata}"
        )

        # TTS로 환영 인사를 먼저 재생합니다
        await gw.say(
            session.linked_id,
            "안녕하세요, MAKECALL AI 안내 서비스입니다. 무엇을 도와드릴까요?",
            tts,
        )
        print("🔊 인사말 재생 완료")

    # ── 감정 분석 결과 확인 ───────────────────────────────────
    def on_transcript(result, session):
        if not result.is_final:
            return

        sentiment_str = ""
        if result.sentiment:
            emoji = SENTIMENT_EMOJI.get(result.sentiment.sentiment, "")
            score_pct = round(result.sentiment.sentiment_score * 100)
            sentiment_str = f" {emoji} {result.sentiment.sentiment}({score_pct}%)"

        confidence_pct = round((result.confidence or 0) * 100)
        print(
            f"🎙️  고객: {result.text}"
            f"  [신뢰도:{confidence_pct}%{sentiment_str}]"
        )

    def on_call_ended(linked_id, duration):
        print(f"📴 통화 종료. 통화 시간: {duration}초")

    def on_error(err, linked_id):
        print(f"❌ 오류: {err}")

    print("확장 봇을 시작합니다...")
    print(f"게이트웨이: {os.environ.get('DV_BASE_URL', 'http://localhost:8080')}")
    print("콜을 기다리는 중...\n")

    await (
        gw.pipeline()
        .stt(stt)
        .llm(llm)
        .tts(tts)
        .on_new_call(on_new_call)
        .on_transcript(on_transcript)
        .on_call_ended(on_call_ended)
        .on_error(on_error)
        .start()
    )

asyncio.run(main())
```

실행:
```bash
python bot_enhanced.py
```

**각 기능 설명:**

| 기능 | 코드 위치 | 효과 |
|------|----------|------|
| **키워드 부스팅** | `keywords=[...]` | 전문 용어 인식률 향상 (기본 OFF, 직접 설정 필요) |
| **감정 분석** | `sentiment=True` | 고객 감정 실시간 파악 (positive/neutral/negative) |
| **TTS 인사** | `gw.say(...)` in `on_new_call` | 전화 받자마자 AI 음성으로 인사 |

> 💡 **키워드 예시** — 내 업종에 맞게 바꾸세요:
> - 병원: `["진료", "예약", "처방전", "보험", "접수"]`
> - 쇼핑몰: `["배송", "교환", "환불", "주문번호", "카드결제"]`
> - IT 헬프데스크: `["비밀번호", "VPN", "재부팅", "로그인", "원격접속"]`

---

#### B-6¾. 텍스트 입력 → TTS 재생 (터미널에서 직접 음성 송출 — Python)

Node.js 버전(A-7¾)과 동일한 기능의 Python 버전입니다.
터미널에서 텍스트를 입력하면 활성 통화에 TTS로 재생합니다.

`bot_tts_input.py` 파일을 만들어 보세요:

```python
# bot_tts_input.py — 텍스트 입력 → TTS 재생 (Python 버전)
import asyncio
import os
import sys
from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.tts import ElevenLabsAdapter

load_dotenv()

# Windows asyncio 호환성
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

async def main():
    # ── API 키 확인 ─────────────────────────────────────────────
    required_keys = ["DV_API_KEY", "ELEVENLABS_API_KEY"]
    missing = [k for k in required_keys if not os.environ.get(k)]
    if missing:
        print(f"❌ .env 파일에 다음 키가 없습니다: {', '.join(missing)}")
        return

    # ── 1. 게이트웨이 연결 ──────────────────────────────────────
    gw = DVGatewayClient(
        base_url="http://localhost:8080",
        auth={"type": "apiKey", "api_key": os.environ["DV_API_KEY"]},
        security={"force_tls": False},
    )

    # ── 2. TTS 어댑터 설정 ─────────────────────────────────────
    tts = ElevenLabsAdapter(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        model="eleven_flash_v2_5",       # 최저 지연 (~75ms)
        voice_id="21m00Tcm4TlvDq8ikWAM",  # Rachel 음성 (무료)
    )

    # ── 3. 활성 콜 추적 ────────────────────────────────────────
    active_calls = {}      # linked_id → 발신자 정보
    selected_call_id = None

    def on_call_event(event):
        nonlocal selected_call_id

        if event.type == "call:new":
            active_calls[event.session.linked_id] = {
                "caller": getattr(event.session, "caller", "알 수 없음"),
            }
            print(f"\n📞 새 콜: [{event.session.linked_id}] "
                  f"{getattr(event.session, 'caller', '')}")

            # 첫 번째 콜이면 자동 선택
            if len(active_calls) == 1:
                selected_call_id = event.session.linked_id
                print("   → 자동 선택됨")

        if event.type == "call:ended":
            active_calls.pop(event.linked_id, None)
            print(f"\n📴 콜 종료: [{event.linked_id}]")
            if selected_call_id == event.linked_id:
                selected_call_id = (
                    next(iter(active_calls)) if active_calls else None
                )

    gw.on_call_event(on_call_event)

    # ── 4. TTS 재생 함수 ───────────────────────────────────────
    async def play_tts(linked_id, text):
        print(f'🔊 TTS 재생 중... "{text}"')
        try:
            await gw.say(linked_id, text, tts)
            print("✅ 재생 완료")
        except Exception as e:
            print(f"❌ 재생 실패: {e}")

    # ── 5. 메인 루프 ──────────────────────────────────────────
    print("")
    print("╔══════════════════════════════════════════════╗")
    print("║  텍스트 입력 → TTS 재생기 (Python)             ║")
    print("╠══════════════════════════════════════════════╣")
    print("║  텍스트 입력  → 선택된 콜에 TTS 재생            ║")
    print("║  /list       → 활성 콜 목록                    ║")
    print("║  /select <id> → 재생 대상 콜 선택               ║")
    print("║  /quit       → 종료                            ║")
    print("╚══════════════════════════════════════════════╝")
    print("")
    print("🔊 콜을 기다리는 중... 전화가 오면 텍스트를 입력하세요.\n")

    loop = asyncio.get_event_loop()

    while True:
        # 비동기 input (이벤트 루프를 블로킹하지 않음)
        try:
            line = await loop.run_in_executor(None, lambda: input("TTS> "))
        except (EOFError, KeyboardInterrupt):
            print("\n👋 종료합니다...")
            gw.close()
            break

        text = line.strip()
        if not text:
            continue

        # 명령어 처리
        if text == "/quit":
            print("👋 종료합니다...")
            gw.close()
            break

        if text == "/list":
            if not active_calls:
                print("📋 활성 콜 없음")
            else:
                print(f"📋 활성 콜 ({len(active_calls)}개):")
                for cid, info in active_calls.items():
                    marker = " ← 선택됨" if cid == selected_call_id else ""
                    print(f"   [{cid}] {info['caller']}{marker}")
            continue

        if text.startswith("/select "):
            cid = text.split(maxsplit=1)[1]
            if cid in active_calls:
                selected_call_id = cid
                print(f"✅ 선택됨: [{cid}]")
            else:
                print(f"⚠️  콜 [{cid}]을(를) 찾을 수 없습니다.")
            continue

        # TTS 재생
        if not selected_call_id or selected_call_id not in active_calls:
            print("⚠️  활성 콜이 없습니다. 전화가 오면 자동으로 선택됩니다.")
            continue

        await play_tts(selected_call_id, text)

asyncio.run(main())
```

실행:
```bash
# 가상환경이 활성화된 상태에서
python bot_tts_input.py
```

**사용 방법은 Node.js 버전(A-7¾)과 동일합니다:**

```
TTS> 안녕하세요, 잠시만 기다려 주세요.
🔊 TTS 재생 중... "안녕하세요, 잠시만 기다려 주세요."
✅ 재생 완료
TTS> 담당자를 연결해 드리겠습니다.
🔊 TTS 재생 중... "담당자를 연결해 드리겠습니다."
✅ 재생 완료
```

---

#### B-7. 봇을 항상 실행되게 하기 (systemd 사용 — Linux 서버)

```bash
# 서비스 파일 생성
sudo tee /etc/systemd/system/voice-bot.service << 'EOF'
[Unit]
Description=My Voice Bot
After=network.target dvgateway.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/my-voice-bot-py
ExecStart=/home/ubuntu/my-voice-bot-py/venv/bin/python bot.py
Restart=always
RestartSec=5
EnvironmentFile=/home/ubuntu/my-voice-bot-py/.env

[Install]
WantedBy=multi-user.target
EOF

# 서비스 등록 및 시작
sudo systemctl daemon-reload
sudo systemctl enable voice-bot
sudo systemctl start voice-bot

# 상태 확인
sudo systemctl status voice-bot

# 로그 보기
journalctl -u voice-bot -f
```

---

### C. 자주 겪는 문제와 해결책 (초보자 버전)

#### "ECONNREFUSED" 오류가 나요

DVGateway 서버가 실행 중이지 않습니다.

```bash
# 서버 상태 확인
sudo systemctl status dvgateway

# 서버 시작
sudo systemctl start dvgateway
```

#### "Invalid API key" 오류가 나요

API 키가 잘못되었습니다.

1. `.env` 파일을 열어서 키가 정확히 붙여넣어져 있는지 확인
2. 키 앞뒤에 공백이 없는지 확인
3. 따옴표(`"`)가 없어야 합니다:
   - ✅ 올바름: `DEEPGRAM_API_KEY=dg_abcdef123456`
   - ❌ 틀림: `DEEPGRAM_API_KEY="dg_abcdef123456"`

#### Node.js에서 "Cannot find module" 오류가 나요

패키지가 설치되지 않았습니다.

```bash
npm install dvgateway-sdk dvgateway-adapters dotenv
```

#### Python에서 "ModuleNotFoundError" 오류가 나요

가상환경이 활성화되지 않았거나 패키지 미설치입니다.

```bash
# 가상환경 활성화
source venv/bin/activate   # macOS/Linux
venv\Scripts\activate.bat  # Windows

# 패키지 재설치
pip install "dvgateway[adapters]" python-dotenv
```

#### 전화가 와도 봇이 응답하지 않아요

1. SIP 전화기 설정이 DVGateway 서버를 가리키는지 확인
2. 방화벽에서 SIP(5060) 및 RTP(10000-20000) 포트가 열려 있는지 확인:

```bash
# Ubuntu 방화벽 포트 열기
sudo ufw allow 5060/udp    # SIP
sudo ufw allow 10000:20000/udp  # RTP
sudo ufw allow 8080/tcp    # SDK API
sudo ufw allow 8081/tcp    # 대시보드
```

#### Python `asyncio` 관련 오류가 나요 (Windows)

Windows에서는 asyncio 이벤트 루프 정책이 다릅니다:

```python
# bot.py 맨 위에 추가
import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
```

---

### D. 다음 단계 — 더 배우고 싶다면

| 주제 | 읽을 섹션 |
|------|---------|
| AI 서비스 비교 및 선택 | [섹션 6](#6-연동-가능한-ai-서비스-전체-목록) |
| 고급 파이프라인 설정 | [섹션 7–9](#7-파이프라인-패턴-1-일반-통화-sttllmtts) |
| API 키 없이 무료로 쓰기 | [섹션 10 로컬 어댑터](#로컬-stt--whispercpp-오프라인-무료) |
| 키워드 부스팅·감정 분석 상세 | [섹션 10](#deepgram-stt-음성-인식), [섹션 14](#14-감정-분석-sentiment-analysis--실시간-회의-분위기-모니터링) |
| TTS 캐시·비용 절감 | [섹션 15](#15-stttts-api-비용-절감--캐시-및-최적화-전략) |
| 문제가 생겼을 때 | [섹션 17](#17-문제-해결) |

---

## 지원 및 문의

| 항목 | 연락처 |
|------|--------|
| 기술 지원 | GitHub Issues |
| 라이선스 문의 | OLSSOO Inc. 영업팀 |
| 버그 리포트 | GitHub Issues |

---

© 2026 OLSSOO Inc. All rights reserved.
DVGateway SDK는 [MIT 라이선스](../LICENSE)로 배포됩니다.
