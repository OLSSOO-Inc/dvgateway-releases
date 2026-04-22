# 시작하기 — 설치부터 헬로 월드까지

## 1. 시스템 요구사항

| 항목 | 최소 요구사항 |
|------|-------------|
| OS | Debian 12/13, Ubuntu 22.04 이상 |
| CPU | 2코어 이상 |
| RAM | 2 GB 이상 (4 GB 권장) |
| Node.js | 20 LTS 이상 |
| 아키텍처 | amd64 / arm64 |
| 네트워크 | 공인 IP 또는 포트 포워딩 (SIP/RTP 수신용) |

---

## 2. 서버 설치

```bash
# 원라인 자동 설치 (Debian/Ubuntu)
curl -fsSL https://github.com/OLSSOO-Inc/dvgateway-releases/releases/latest/download/install.sh | sudo bash
```

특정 버전으로 설치하려면 URL의 `latest`를 원하는 버전 태그로 교체하세요:

```bash
# 특정 버전으로 설치 (예: v1.2.3)
curl -fsSL https://github.com/OLSSOO-Inc/dvgateway-releases/releases/download/v1.2.3/install.sh | sudo bash
```

설치 가능한 버전 목록은 [GitHub Releases 페이지](https://github.com/OLSSOO-Inc/dvgateway-releases/releases)에서 확인할 수 있습니다.

설치 후 열리는 포트:

| 포트 | 용도 |
|------|------|
| **8080** | SDK API 서버 (AI 클라이언트 연결) |
| **8081** | 웹 대시보드 (모니터링) |
| **8092** | 미디어 서버 내부 WebSocket |

---

## 3. SDK 설치

### 3-1. Node.js SDK (TypeScript / JavaScript)

Node.js 프로젝트 폴더에서 실행합니다.

```bash
# SDK + 어댑터 패키지 설치
npm install dvgateway-sdk dvgateway-adapters
```

TypeScript를 사용하는 경우 (권장):

```bash
npm install --save-dev typescript @types/node
npx tsc --init   # tsconfig.json 생성
```

`tsconfig.json`에 아래 옵션을 추가합니다:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true
  }
}
```

### 3-2. Python SDK

Python 3.10 이상 환경에서 실행합니다.

```bash
# 가상환경 생성 (권장)
python3 -m venv venv
source venv/bin/activate        # macOS / Linux
# venv\Scripts\activate.bat    # Windows

# SDK + 어댑터 + dotenv 설치
pip install "dvgateway[adapters]" python-dotenv
```

`.env` 파일을 만들고 API 키를 저장합니다:

```ini
DEEPGRAM_API_KEY=dg_xxxxxxxxxxxx
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx   # (선택) 백업 LLM
```

#### Python 5분 시작 — 헬로 월드 봇

```python
# bot.py
import asyncio
import os
from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import OpenAILlmAdapter, AnthropicAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter

load_dotenv()  # .env 파일 로드

async def main():
    # 1. 게이트웨이 서버에 연결
    gw = DVGatewayClient(
        base_url="http://localhost:8080",
        auth={"type": "apiKey", "api_key": "your-gateway-api-key"},
    )

    # 2. AI 어댑터 준비
    stt = DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
    )

    llm = OpenAILlmAdapter(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-4o-mini",
        system_prompt="당신은 친절한 한국어 음성 안내원입니다. 짧고 명확하게 답변하세요.",
    )

    llm_fallback = AnthropicAdapter(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        model="claude-haiku-4-5-20251001",
        system_prompt="당신은 친절한 한국어 음성 안내원입니다. 짧고 명확하게 답변하세요.",
    )

    tts = ElevenLabsAdapter(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        model="eleven_flash_v2_5",
        voice_id="21m00Tcm4TlvDq8ikWAM",  # Rachel 음성
    )

    # 3. 파이프라인 시작 (OpenAI 기본, Anthropic 백업)
    await (
        gw.pipeline()
        .stt(stt)
        .llm(llm)
        .fallback(llm_fallback)
        .tts(tts)
        .on_new_call(lambda session: print(
            f"📞 새 통화\n"
            f"   linked_id : {session.linked_id}\n"
            f"   발신자번호 : {session.caller or '알 수 없음'}\n"
            f"   발신자이름 : {session.caller_name or '알 수 없음'}\n"
            f"   DID 번호   : {session.did or '알 수 없음'}"
        ))
        .on_transcript(lambda result, session: print(f"🎙️  발화: {result.text}") if result.is_final else None)
        .on_call_ended(lambda linked_id, duration: print(f"📴 통화 종료: {linked_id} ({duration}초)"))
        .on_error(lambda err, linked_id: print(f"오류: {err}"))
        .start()
    )

asyncio.run(main())
```

실행:

```bash
python bot.py
```

#### Python — OpenAI Realtime 봇

```python
# realtime_bot.py
import asyncio
import os
from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.realtime import OpenAIRealtimeAdapter

load_dotenv()

async def main():
    gw = DVGatewayClient(
        base_url="http://localhost:8080",
        auth={"type": "apiKey", "api_key": "your-key"},
    )

    realtime = OpenAIRealtimeAdapter(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-4o-mini-realtime-preview",
        voice="alloy",
        instructions="당신은 친절한 한국어 AI 상담원입니다. 짧고 자연스럽게 답변하세요.",
        turn_detection={
            "mode": "server_vad",
            "threshold": 0.5,
            "silence_duration_ms": 500,
            "prefix_padding_ms": 300,
        },
        input_transcription=True,
        temperature=0.8,
    )

    async def inject_chunk(chunk: bytes, linked_id: str) -> None:
        await gw.inject_tts(linked_id, _single(chunk))

    async def _single(chunk: bytes):
        yield chunk

    realtime.on_audio_output(inject_chunk)
    realtime.on_transcript(lambda result: print(
        f"{'🤖 AI' if result.speaker == 'agent' else '👤 고객'}: {result.text}"
    ))

    @gw.on("call:new")
    async def on_new_call(event):
        session = event["session"]
        print(f"📞 리얼타임 세션 시작: {session.linked_id}")
        audio_stream = gw.stream_audio(session.linked_id, dir="in")
        await realtime.start_session(session.linked_id, audio_stream)

    @gw.on("call:ended")
    async def on_call_ended(event):
        print(f"📴 리얼타임 세션 종료: {event['linked_id']}")
        await realtime.stop(event["linked_id"])

    # 이벤트 루프 유지 (pipeline이 아닌 이벤트 기반 패턴에서는 프로세스 종료 방지)
    print("🎙️ OpenAI Realtime 봇이 준비되었습니다.")
    await asyncio.Event().wait()  # 무한 대기

asyncio.run(main())
```

#### Python — 컨퍼런스 회의록 봇

```python
# conference_bot.py
import asyncio
import os
from datetime import datetime
from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter

load_dotenv()

minutes = []

async def main():
    gw = DVGatewayClient(
        base_url="http://localhost:8080",
        auth={"type": "apiKey", "api_key": "your-key"},
    )

    stt = DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
        diarize=True,
    )

    async def on_transcript(result, session):
        if not result.is_final:
            return
        entry = {
            "speaker": result.speaker or session.linked_id,
            "text": result.text,
            "time": datetime.fromtimestamp(result.timestamp_ms / 1000),
        }
        minutes.append(entry)
        print(f"[{entry['time'].strftime('%H:%M:%S')}] {entry['speaker']}: {entry['text']}")

    await (
        gw.pipeline()
        .stt(stt)
        .for_conference()  # TTS 없음, 전사만
        .on_transcript(on_transcript)
        .on_error(lambda err, linked_id: print(f"오류: {err}"))
        .start()
    )

asyncio.run(main())
```

#### Node.js vs Python SDK 비교

| 항목 | Node.js SDK | Python SDK |
|------|-------------|------------|
| 패키지 | `npm install dvgateway-sdk` | `pip install dvgateway` |
| 진입점 | `DVGatewayClient` | `DVGatewayClient` |
| 어댑터 import | `dvgateway-adapters/stt` | `dvgateway.adapters.stt` |
| 비동기 방식 | `async/await` | `asyncio` + `async/await` |
| 이벤트 핸들러 | `.onNewCall(handler)` | `.on_new_call(handler)` |
| 환경 변수 | `dotenv` 패키지 | `python-dotenv` 패키지 |
| 타입 지원 | TypeScript 완전 지원 | Python `typing` / `mypy` 지원 |
| 로컬 어댑터 | 제한적 | ✅ whisper.cpp, Faster-Whisper, Qwen 등 |

> **로컬 어댑터(whisper.cpp, Qwen 등)**는 Python SDK에서 더 풍부하게 지원됩니다. 자세한 설정은 [섹션 10](#10-어댑터별-상세-설정)을 참고하세요.

---

## 4. 프로바이더 API 키 준비

사용할 AI 서비스의 API 키가 필요합니다. 아래 표에서 필요한 서비스만 선택하세요.

| 서비스 | 용도 | 발급 주소 | 무료 플랜 |
|--------|------|-----------|-----------|
| **Deepgram** | 음성 → 텍스트 (STT) | https://console.deepgram.com | ✅ $200 크레딧 |
| **ElevenLabs** | 텍스트 → 음성 (TTS) | https://elevenlabs.io | ✅ 월 10,000자 |
| **OpenAI** | AI 대화 (LLM, 기본) / TTS / 리얼타임 | https://platform.openai.com | ❌ 유료 |
| **Anthropic** | AI 대화 (LLM, 백업) | https://console.anthropic.com | ❌ 유료 (선택) |

API 키는 코드에 직접 쓰지 말고 환경 변수로 관리하세요:

```bash
# .env 파일 생성 (절대 git에 커밋하지 마세요!)
DEEPGRAM_API_KEY=dg_xxxxxxxxxxxx
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx   # (선택) 백업 LLM
```

```typescript
// 코드에서 환경 변수 읽기
import 'dotenv/config'; // npm install dotenv

const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY!;
```

### 내 게이트웨이 API 키 확인하는 방법

DVGateway 서버에 연결할 때 사용하는 **게이트웨이 API 키(`DV_API_KEY`)**를 확인하는 방법은 세 가지입니다.

> 💡 게이트웨이 API 키(`DV_API_KEY`)는 Deepgram·OpenAI 등 AI 서비스 키와 **완전히 다른 키**입니다.
> 게이트웨이 서버 자체에 인증하기 위한 키이므로 혼동하지 마세요.

#### 방법 1. 대시보드에서 확인 (가장 간편)

브라우저에서 `http://서버IP:8081` 에 접속한 뒤 **설정 → SDK API Key** 패널을 확인하세요.

- 보안을 위해 키가 마스킹 표시됩니다: `dvgw_••••••••••••••••__abcd`
- **복사** 버튼을 누르면 전체 키가 클립보드에 복사됩니다.
- **재발급** 버튼을 누르면 새 키가 생성되며, 이때만 전체 키가 한 번 표시됩니다.

#### 방법 2. REST API로 조회

```bash
# 1) 기존 API 키로 JWT 토큰 발급
TOKEN=$(curl -s -X POST http://서버IP:8080/api/v1/auth/token \
  -H "Content-Type: application/json" \
  -H "X-API-Key: 현재_API_키" \
  -d '{"apiKey": "현재_API_키"}' | jq -r '.token')

# 2) SDK API 키 조회 (마스킹된 키 반환)
curl -s http://서버IP:8080/api/v1/config/sdk-key \
  -H "Authorization: Bearer $TOKEN"

# 3) 키 재발급 (전체 키가 1회 표시됨)
curl -s -X POST http://서버IP:8080/api/v1/config/sdk-key \
  -H "Authorization: Bearer $TOKEN"
```

> ⚠️ API 키는 외부에 절대 노출하지 마세요. 키가 유출되었다고 판단되면 대시보드 또는 API에서 즉시 **재발급**하세요.

---

## 5. 5분 만에 시작하기 — 헬로 월드 봇

아래 예제는 전화가 오면 자동으로 응답하는 가장 단순한 AI 음성 봇입니다.
**Deepgram(STT) + OpenAI(LLM 기본) + Anthropic(LLM 백업) + ElevenLabs(TTS)** 조합을 사용합니다.

```typescript
// bot.ts
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter, AnthropicAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

// 1. 게이트웨이 서버에 연결
const gw = new DVGatewayClient({
  baseUrl: 'http://localhost:8080',   // DVGateway 서버 주소
  auth: { type: 'apiKey', apiKey: 'your-gateway-api-key' },
});

// 2. AI 어댑터 준비
const stt = new DeepgramAdapter({
  apiKey:   process.env.DEEPGRAM_API_KEY!,
  language: 'ko',          // 한국어 인식
  model:    'nova-3',      // 최고 정확도 모델
});

const llm = new OpenAILlmAdapter({
  apiKey:       process.env.OPENAI_API_KEY!,
  model:        'gpt-4o-mini',                // 기본 LLM
  systemPrompt: '당신은 친절한 한국어 음성 안내원입니다. 짧고 명확하게 답변하세요.',
});

const llmFallback = new AnthropicAdapter({
  apiKey:       process.env.ANTHROPIC_API_KEY!,
  model:        'claude-haiku-4-5-20251001',   // 백업 LLM
  systemPrompt: '당신은 친절한 한국어 음성 안내원입니다. 짧고 명확하게 답변하세요.',
});

const tts = new ElevenLabsAdapter({
  apiKey:  process.env.ELEVENLABS_API_KEY!,
  model:   'eleven_flash_v2_5',   // 최저 지연 TTS
  voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel 음성
});

// 3. 파이프라인 시작 (OpenAI 기본, Anthropic 백업)
await gw.pipeline()
  .stt(stt)
  .llm(llm)
  .fallback(llmFallback)
  .tts(tts)
  .onNewCall((session) => {
    console.log(
      `📞 새 통화\n` +
      `   linkedId   : ${session.linkedId}\n` +
      `   발신자번호  : ${session.caller ?? '알 수 없음'}\n` +
      `   발신자이름  : ${session.callerName ?? '알 수 없음'}\n` +
      `   DID 번호    : ${session.did ?? '알 수 없음'}`
    );
  })
  .onTranscript((result, session) => {
    if (result.isFinal) console.log(`🎙️  발화: ${result.text}`);
  })
  .onCallEnded((linkedId, duration) => {
    console.log(`📴 통화 종료: ${linkedId} (${duration}초)`);
  })
  .onError((err, linkedId) => {
    console.error('오류:', err.message);
  })
  .start();

console.log('🤖 AI 음성 봇이 시작되었습니다. 전화를 기다리는 중...');
```

실행:

```bash
npx tsx bot.ts
# 또는 컴파일 후 실행
npx tsc && node dist/bot.js
```

> 고급 통화 제어(DTMF 수집, 오디오 재생, STT 뮤트, 상담원 이관)는 [13. 음성 플로우 제어 API](13-voice-flow-controls.md) 참조.

---

