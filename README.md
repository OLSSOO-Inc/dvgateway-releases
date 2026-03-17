# DVGateway SDK — 사용 가이드

> **최신 버전: 1.2.9.3** | 업데이트: 2026-03-11

**DVGateway SDK**는 AI 음성 서비스(STT·LLM·TTS)를 실시간 전화 통화에 연결하는 라이브러리입니다.
**Node.js**와 **Python** 두 가지 언어를 지원하며, 개발자가 아니더라도 이 문서의 예제를 따라 하면 AI 음성 봇을 구축할 수 있습니다.

---

## 목차

1. [시스템 요구사항](#1-시스템-요구사항)
2. [서버 설치](#2-서버-설치)
3. [SDK 설치](#3-sdk-설치)
4. [프로바이더 API 키 준비](#4-프로바이더-api-키-준비)
5. [5분 만에 시작하기 — 헬로 월드 봇](#5-5분-만에-시작하기--헬로-월드-봇)
6. [연동 가능한 AI 서비스 전체 목록](#6-연동-가능한-ai-서비스-전체-목록)
    - [클라우드 STT 서비스 — 내장 게이트웨이 어댑터](#클라우드-stt-서비스--내장-게이트웨이-어댑터)
    - [클라우드 TTS 서비스 — 내장 게이트웨이 어댑터](#클라우드-tts-서비스--내장-게이트웨이-어댑터)
    - [API Key 차이점 — Google Cloud vs Google Gemini](#api-key-차이점--google-cloud-vs-google-gemini)
    - [한국 환경 — 용도별 추천 조합](#한국-환경--용도별-추천-조합)
7. [파이프라인 패턴 1: 일반 통화 STT→LLM→TTS](#7-파이프라인-패턴-1-일반-통화-sttllmtts)
8. [파이프라인 패턴 2: OpenAI 리얼타임 음성 직통 (Audio 1.5)](#8-파이프라인-패턴-2-openai-리얼타임-음성-직통-audio-15)
9. [파이프라인 패턴 3: 컨퍼런스 자동 회의록](#9-파이프라인-패턴-3-컨퍼런스-자동-회의록)
10. [어댑터별 상세 설정](#10-어댑터별-상세-설정)
    - [Deepgram STT](#deepgram-stt-음성-인식)
    - [ElevenLabs TTS](#elevenlabs-tts-음성-합성)
    - [Anthropic Claude LLM](#anthropic-claude-llm)
    - [OpenAI GPT LLM](#openai-gpt-llm)
    - [OpenAI TTS](#openai-tts-음성-합성)
    - [OpenAI 리얼타임 (Speech-to-Speech)](#openai-리얼타임-speech-to-speech)
    - [로컬 STT — whisper.cpp (오프라인 무료)](#로컬-stt--whispercpp-오프라인-무료)
    - [로컬 STT — Faster-Whisper (Python 고속 추론)](#로컬-stt--faster-whisper-python-고속-추론)
    - [로컬 STT — OpenAI Whisper (Python 공식)](#로컬-stt--openai-whisper-python-공식)
    - [로컬 LLM — Qwen (Ollama 경유)](#로컬-llm--qwen-ollama-경유)
    - [로컬 LLM — vLLM 서버 연동](#로컬-llm--vllm-서버-연동)
11. [이벤트 후킹 — 통화 시작·종료·발화 감지](#11-이벤트-후킹--통화-시작종료발화-감지)
12. [폴백(Fallback) 설정 — 장애 자동 전환](#12-폴백fallback-설정--장애-자동-전환)
13. [멀티테넌트 지원](#13-멀티테넌트-지원)
14. [모니터링 대시보드](#14-모니터링-대시보드)
15. [감정 분석 (Sentiment Analysis) — 실시간 회의 분위기 모니터링](#15-감정-분석-sentiment-analysis--실시간-회의-분위기-모니터링)
    - [Deepgram Sentiment 활성화](#deepgram-sentiment-활성화)
    - [실시간 회의 분위기 모니터링](#실시간-회의-분위기-모니터링)
    - [회의록 감정 메타데이터](#회의록-감정-메타데이터)
    - [화자별 감정 통계](#화자별-감정-통계)
    - [Sentiment 응용 사례](#sentiment-응용-사례)
16. [STT·TTS API 비용 절감 — 캐시 및 최적화 전략](#16-stttts-api-비용-절감--캐시-및-최적화-전략)
    - [TTS 캐시 어댑터 (CachedTtsAdapter)](#tts-캐시-어댑터-cachedttsadapter)
    - [안내 멘트 음원 풀 사전 생성 (warmup)](#안내-멘트-음원-풀-사전-생성-warmup)
    - [STT 비용 최적화 — VAD 필터링](#stt-비용-최적화--vad-필터링)
    - [프로바이더별 비용 비교표](#프로바이더별-비용-비교표)
    - [비용 최적화 체크리스트](#비용-최적화-체크리스트)
17. [자주 묻는 질문 (FAQ)](#17-자주-묻는-질문-faq)
18. [문제 해결](#18-문제-해결)
19. [원라인 서버 업데이트](#19-원라인-서버-업데이트)
20. [진짜 초보자용 메뉴얼 — Node.js·Python 설치부터 봇 실행까지](#20-진짜-초보자용-메뉴얼--nodejs-python-설치부터-봇-실행까지)

---

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

### 게이트웨이 API 키 확인

설치가 완료되면 **게이트웨이 API 키**가 자동 생성됩니다.
이 키는 SDK가 게이트웨이 서버에 인증할 때 사용됩니다.

```bash
# 설치 시 출력된 API 키 확인
sudo cat /etc/dvgateway/api-key

# 또는 대시보드에서 확인
# http://서버IP주소:8081 접속 → 설정(Settings) → API Keys
```

이 키를 `.env` 파일의 `DV_API_KEY`에 저장하세요.

> ⚠️ 게이트웨이 API 키는 외부 AI 서비스(Deepgram, ElevenLabs 등)의 키와는 별개입니다.
> 게이트웨이 서버 자체에 접속하기 위한 인증 키입니다.


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
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxx
```

#### Python 5분 시작 — 헬로 월드 봇

```python
# bot.py
import asyncio
import os
from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter
from dvgateway.adapters.llm import AnthropicAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter

load_dotenv()  # .env 파일 로드

async def main():
    # 1. 게이트웨이 서버에 연결
    gw = DVGatewayClient(
        base_url="http://localhost:8080",
        auth={"type": "apiKey", "api_key": "your-gateway-api-key"},
        tenant_id="tenant-a",  # (선택) 멀티테넌트 환경
    )

    # 2. AI 어댑터 준비
    stt = DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
    )

    llm = AnthropicAdapter(
        api_key=os.environ["ANTHROPIC_API_KEY"],
        model="claude-haiku-4-5-20251001",
        system_prompt="당신은 친절한 한국어 음성 안내원입니다. 짧고 명확하게 답변하세요.",
    )

    tts = ElevenLabsAdapter(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        model="eleven_flash_v2_5",
        voice_id="21m00Tcm4TlvDq8ikWAM",  # Rachel 음성
    )

    # 3. 파이프라인 시작
    await (
        gw.pipeline()
        .stt(stt)
        .llm(llm)
        .tts(tts)
        .on_new_call(lambda session: print(f"📞 새 통화: {session.linked_id}"))
        .on_transcript(lambda result: print(f"🎙️  발화: {result.text}") if result.is_final else None)
        .on_call_ended(lambda linked_id, duration: print(f"📴 통화 종료: {linked_id} ({duration}초)"))
        .on_error(lambda err: print(f"오류: {err}"))
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

    realtime.on_audio_output(lambda chunk, linked_id: gw.inject_audio(linked_id, chunk))
    realtime.on_transcript(lambda result: print(
        f"{'🤖 AI' if result.speaker == 'agent' else '👤 고객'}: {result.text}"
    ))

    @gw.on("call:new")
    async def on_new_call(event):
        session = event["session"]
        print(f"📞 리얼타임 세션 시작: {session.linked_id}")
        audio_stream = gw.audio_stream(session.linked_id, dir="in")
        await realtime.start_session(session.linked_id, audio_stream)

    @gw.on("call:ended")
    async def on_call_ended(event):
        print(f"📴 리얼타임 세션 종료: {event['linked_id']}")
        await realtime.stop(event["linked_id"])

    await gw.connect()
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
        .on_error(lambda err: print(f"오류: {err}"))
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
| **Anthropic** | AI 대화 (LLM) | https://console.anthropic.com | ❌ 유료 |
| **OpenAI** | AI 대화 / TTS / 리얼타임 | https://platform.openai.com | ❌ 유료 |

> **참고:** 위 키 외에 **게이트웨이 API 키**도 필요합니다.
> 이 키는 DVGateway 서버 설치 시 자동 생성되며, 확인 방법은 [섹션 2 — 게이트웨이 API 키 확인](#게이트웨이-api-키-확인)을 참고하세요.

API 키는 코드에 직접 쓰지 말고 환경 변수로 관리하세요:

```bash
# .env 파일 생성 (절대 git에 커밋하지 마세요!)
DV_API_KEY=your-gateway-api-key   # DVGateway 서버 인증 키 (섹션 2 참고)
DEEPGRAM_API_KEY=dg_xxxxxxxxxxxx
ELEVENLABS_API_KEY=sk_xxxxxxxxxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx
OPENAI_API_KEY=sk-xxxxxxxxxxxx
```

```typescript
// 코드에서 환경 변수 읽기
import 'dotenv/config'; // npm install dotenv

const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY!;
```

---

## 5. 5분 만에 시작하기 — 헬로 월드 봇

아래 예제는 전화가 오면 자동으로 응답하는 가장 단순한 AI 음성 봇입니다.
**Deepgram(STT) + Claude(LLM) + ElevenLabs(TTS)** 조합을 사용합니다.

```typescript
// bot.ts
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { AnthropicAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

// 1. 게이트웨이 서버에 연결
const gw = new DVGatewayClient({
  baseUrl: 'http://localhost:8080',   // DVGateway 서버 주소
  auth: { type: 'apiKey', apiKey: 'your-gateway-api-key' },
  tenantId: 'tenant-a',              // (선택) 멀티테넌트 환경에서 테넌트 ID 지정
                                     //  설정 시 모든 요청에 X-Tenant-ID 헤더 자동 삽입
});

// 2. AI 어댑터 준비
const stt = new DeepgramAdapter({
  apiKey:   process.env.DEEPGRAM_API_KEY!,
  language: 'ko',          // 한국어 인식
  model:    'nova-3',      // 최고 정확도 모델
});

const llm = new AnthropicAdapter({
  apiKey:       process.env.ANTHROPIC_API_KEY!,
  model:        'claude-haiku-4-5-20251001',   // 가장 빠른 모델
  systemPrompt: '당신은 친절한 한국어 음성 안내원입니다. 짧고 명확하게 답변하세요.',
});

const tts = new ElevenLabsAdapter({
  apiKey:  process.env.ELEVENLABS_API_KEY!,
  model:   'eleven_flash_v2_5',   // 최저 지연 TTS
  voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel 음성
});

// 3. 파이프라인 시작 (전화가 오면 자동으로 처리)
await gw.pipeline()
  .stt(stt)
  .llm(llm)
  .tts(tts)
  .onNewCall((session) => {
    console.log(`📞 새 통화: ${session.linkedId}`);
  })
  .onTranscript((result) => {
    if (result.isFinal) console.log(`🎙️  발화: ${result.text}`);
  })
  .onCallEnded((linkedId, duration) => {
    console.log(`📴 통화 종료: ${linkedId} (${duration}초)`);
  })
  .onError((err) => {
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

---

## 6. 연동 가능한 AI 서비스 전체 목록

### 음성 인식 (STT — Speech to Text)

| 서비스 | 어댑터 클래스 | 추천 모델 | 특징 |
|--------|------------|---------|------|
| **Deepgram** | `DeepgramAdapter` | `nova-3` | 최고 정확도, 한국어 지원, 가장 빠른 스트리밍 |
| **whisper.cpp** ⭐로컬 | `WhisperCppAdapter` | `large-v3-turbo` | 완전 오프라인, 무료, GPU/CPU 모두 지원 |
| **Faster-Whisper** ⭐로컬 | `FasterWhisperAdapter` | `large-v3` | Python 고속 추론 (CTranslate2), 배치 지원 |
| **OpenAI Whisper** 로컬 | `WhisperLocalAdapter` | `large-v3` | Python 공식 라이브러리, 설치 간단 |
| **Qwen3-ASR** 로컬 | `QwenAudioAdapter` | `Qwen3-ASR-1.7B` | 52개 언어, 오픈소스 최고 성능 ASR (2026-01 출시) |

### 음성 합성 (TTS — Text to Speech)

| 서비스 | 어댑터 클래스 | 추천 모델 | 특징 |
|--------|------------|---------|------|
| **ElevenLabs** | `ElevenLabsAdapter` | `eleven_flash_v2_5` | 최저 지연(<75ms), 자연스러운 음성, 한국어 지원 |
| **OpenAI TTS** | `OpenAITtsAdapter` | `tts-1` | 안정적, 여러 언어 지원 |
| **OpenAI 신경망 TTS** | `OpenAITtsAdapter` | `gpt-4o-mini-tts` | 감정 표현, 억양 제어 가능 |

### AI 대화 (LLM — Large Language Model)

| 서비스 | 어댑터 클래스 | 추천 모델 | 특징 |
|--------|------------|---------|------|
| **Anthropic Claude** | `AnthropicAdapter` | `claude-haiku-4-5-20251001` | 초저지연, 한국어 우수 |
| **OpenAI GPT** | `OpenAILlmAdapter` | `gpt-4o-mini` | 저렴, 빠름 |
| **Qwen (Ollama)** ⭐로컬 | `OllamaAdapter` | `qwen3.5:9b` | 완전 무료, GPU 불필요 (CPU 가능), 멀티모달 |
| **vLLM 서버** 로컬 | `OpenAICompatAdapter` | `Qwen/Qwen3-8B` 등 | OpenAI 호환 API, 고성능 GPU 서버 |

### 실시간 음성-음성 직통 (Realtime Speech-to-Speech)

| 서비스 | 어댑터 클래스 | 추천 모델 | 특징 |
|--------|------------|---------|------|
| **OpenAI Realtime** | `OpenAIRealtimeAdapter` | `gpt-4o-realtime-preview` | STT+LLM+TTS 통합, 최저 지연 |
| **OpenAI Realtime Mini** | `OpenAIRealtimeAdapter` | `gpt-4o-mini-realtime-preview` | 비용 효율적, Audio 1.5 엔진 |

### 클라우드 STT 서비스 — 내장 게이트웨이 어댑터

게이트웨이에 내장된 클라우드 STT 어댑터입니다. SDK 없이 대시보드에서 바로 사용할 수 있습니다.

| 서비스 | 게이트웨이 어댑터 | 프로토콜 | API Key 형식 | 한국어 | 특징 |
|--------|-----------------|---------|-------------|--------|------|
| **Deepgram** | `deepgram` | WebSocket | 단일 API Key | ✅ `nova-3` | 최저 레이턴시, 화자 구분(diarization), 스트리밍 |
| **OpenAI Whisper** | `openai` | WebSocket | API Key (`sk-...`) | ✅ `gpt-4o-transcribe` | 높은 정확도, VAD 내장, Realtime API 기반 |
| **Google Cloud STT** | `google` | REST (청크) | 서비스 계정 JSON Key | ✅ `latest_long` | 서울 리전(`asia-northeast3`), 기업 안정성 |
| **Azure Speech** | `azure` | WebSocket | 구독 키 + 리전 | ✅ | 한국 리전, 실시간 스트리밍 |
| **Qwen-ASR (DashScope)** | `qwen` | WebSocket | DashScope API Key | ✅ `paraformer-realtime-v2` | 52개 언어, 중국 리전 최적 |

### 클라우드 TTS 서비스 — 내장 게이트웨이 어댑터

게이트웨이에 내장된 클라우드 TTS 어댑터입니다. 안내방송, 입장인사, AI 응답 음성 합성에 사용됩니다.

| 서비스 | 게이트웨이 어댑터 | API Key 형식 | 한국어 | 특징 |
|--------|-----------------|-------------|--------|------|
| **ElevenLabs** | `elevenlabs` | API Key | ✅ | 자연스러운 음성, 최저 지연(<75ms), 감정 표현 |
| **OpenAI TTS** | `openai` | API Key (`sk-...`) | ✅ | `tts-1` / `gpt-4o-mini-tts`, 안정적 |
| **Google Cloud TTS** | `google` | 서비스 계정 JSON Key | ✅ | Neural2 / Studio 음성, 서울 리전 |
| **Azure TTS** | `azure` | 구독 키 + 리전 | ✅ | 한국 리전, SSML 지원 |
| **Qwen-TTS (CosyVoice)** | `qwen` | DashScope API Key | ✅ | 음성 복제, 중국 리전 최적 |

### API Key 차이점 — Google Cloud vs Google Gemini

> **주의**: Google Cloud API Key와 Google Gemini (AI Studio) API Key는 **별개의 인증 체계**입니다.

| | Google Cloud Platform | Google AI Studio (Gemini) |
|---|---|---|
| **용도** | STT, TTS, Vertex AI | Gemini LLM, 멀티모달 |
| **API Key 형식** | 서비스 계정 JSON 파일 (`.json`) | 단순 API Key (`AIza...`) |
| **인증 방식** | OAuth2 / 서비스 계정 | API Key 헤더 |
| **엔드포인트** | `{region}-aiplatform.googleapis.com` | `generativelanguage.googleapis.com` |
| **한국 리전** | ✅ `asia-northeast3` (서울) | ❌ 리전 선택 불가 (US 기반) |
| **과금** | GCP 프로젝트 빌링 계정 | Google AI Studio 별도 |
| **게이트웨이 지원** | ✅ STT(`google`) + TTS(`google`) | ❌ (별도 어댑터 필요) |

게이트웨이의 `google` STT/TTS 어댑터는 **Google Cloud Platform** API를 사용합니다.
Gemini LLM을 사용하려면 SDK에서 OpenAI 호환 어댑터로 연동하거나 별도 커스텀 어댑터가 필요합니다.

### 한국 환경 — 용도별 추천 조합

#### 조합 1: 최저 레이턴시 (AI 음성 봇)

```
STT: Deepgram (nova-3)     — ~200ms, WebSocket 스트리밍
LLM: Claude (haiku-4-5)    — ~80ms, 한국어 우수
TTS: ElevenLabs (flash v2.5) — ~75ms, 자연스러운 음성
────────────────────────────
총 레이턴시: ~355ms (목표 500ms 이하 ✅)
```

```typescript
// SDK 예시
await gw.pipeline()
  .stt(new DeepgramAdapter({ model: 'nova-3', language: 'ko' }))
  .llm(new AnthropicAdapter({ model: 'claude-haiku-4-5-20251001' }))
  .tts(new ElevenLabsAdapter({ model: 'eleven_flash_v2_5' }))
  .start(callId);
```

#### 조합 2: 기업 안정성 (한국 리전)

```
STT: Google Cloud STT v2    — 서울 리전, SLA 99.9%
LLM: Claude (sonnet-4-6)    — 고품질 응답
TTS: Google Cloud TTS Neural2 — 서울 리전, 안정적
────────────────────────────
장점: 한국 리전 데이터 주권, 기업 SLA 보장
```

#### 조합 3: 올인원 최저비용 (OpenAI)

```
Realtime API: gpt-4o-mini-realtime-preview
────────────────────────────
STT+LLM+TTS 단일 WebSocket 연결
장점: 연동 단순, 비용 효율적 ($0.60/1M input tokens)
단점: 한국어 음성 품질이 전용 TTS 대비 낮음
```

#### 조합 4: 완전 무료 (로컬 AI)

```
STT: whisper.cpp (large-v3-turbo) — GPU 불필요, 오프라인
LLM: Qwen3.5:9b (Ollama)         — CPU 가능, 한국어 지원
TTS: espeak-ng (내장)             — 무료, 품질 낮음
────────────────────────────
장점: API 비용 0원, 인터넷 불필요
단점: 음성 품질, GPU 없으면 레이턴시 높음
```

#### 조합 5: 컨퍼런스 회의록 (STT Only)

```
STT: OpenAI Whisper (gpt-4o-transcribe) — 높은 정확도
  또는 Deepgram (nova-3, diarize=true)  — 화자 구분 포함
────────────────────────────
게이트웨이 대시보드에서 STT 시작 → 자동 회의록 생성
화자별 실시간 자막 오버레이 (YouTube 라이브 스트리밍 지원)
```

---

## 7. 파이프라인 패턴 1: 일반 통화 STT→LLM→TTS

가장 보편적인 패턴입니다. 각 단계를 독립적으로 제어할 수 있습니다.

```
통화 음성 → [STT: 텍스트 변환] → [LLM: AI 응답 생성] → [TTS: 음성 합성] → 통화에 재생
```

지연 시간 목표: **500ms 이하** (STT ~200ms + LLM ~80ms + TTS ~75ms)

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { AnthropicAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

const gw = new DVGatewayClient({
  baseUrl: 'http://your-gateway:8080',
  auth: { type: 'apiKey', apiKey: 'your-key' },
});

await gw.pipeline()
  // STT 어댑터 설정
  .stt(new DeepgramAdapter({
    apiKey:         process.env.DEEPGRAM_API_KEY!,
    language:       'ko',
    model:          'nova-3',
    diarize:        true,         // 화자 구분 활성화
    smartFormat:    true,         // 자동 문장부호
    endpointingMs:  400,          // 발화 종료 감지 (ms)
    interimResults: false,        // 중간 결과 비활성화 (파이프라인에서는 불필요)
  }))
  // LLM 어댑터 설정
  .llm(new AnthropicAdapter({
    apiKey:       process.env.ANTHROPIC_API_KEY!,
    model:        'claude-sonnet-4-6',
    systemPrompt: `당신은 OLSSOO Inc.의 고객 상담 AI입니다.
- 짧고 명확하게 답변하세요 (2–3문장).
- 항상 한국어로 응답하세요.
- 모르는 내용은 솔직히 모른다고 하세요.`,
    maxTokens:   512,
    temperature: 0.6,
  }))
  // TTS 어댑터 설정
  .tts(new ElevenLabsAdapter({
    apiKey:                  process.env.ELEVENLABS_API_KEY!,
    model:                   'eleven_flash_v2_5',
    voiceId:                 'YOUR_KOREAN_VOICE_ID',  // ElevenLabs 음성 라이브러리에서 선택
    stability:               0.55,
    similarityBoost:         0.75,
    optimizeStreamingLatency: 4,
  }))
  // 인바운드 오디오만 처리 (고객 발화만 AI로 전달)
  .audioFilter({ dir: 'in' })
  .onNewCall(async (session) => {
    console.log(`통화 시작 | linkedId=${session.linkedId} | 발신자=${session.caller}`);
  })
  .onTranscript(async (result, session) => {
    if (result.isFinal) {
      console.log(`[${result.speaker ?? '화자'}] ${result.text}`);
    }
  })
  .onCallEnded(async (linkedId, durationSec) => {
    console.log(`통화 종료 | ${linkedId} | ${durationSec}초`);
  })
  .onError((err, linkedId) => {
    console.error(`파이프라인 오류 | ${linkedId}: ${err.message}`);
  })
  .start();
```

---

## 8. 파이프라인 패턴 2: OpenAI 리얼타임 음성 직통 (Audio 1.5)

OpenAI Realtime API는 STT → LLM → TTS 파이프라인을 단일 WebSocket 연결로 대체합니다.
**지연 시간이 ~300ms**로 가장 빠르며, 별도 STT/TTS 서비스가 필요 없습니다.

```
통화 음성 → [OpenAI Realtime (gpt-4o-realtime)] → AI 음성 응답 → 통화에 재생
```

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';

const gw = new DVGatewayClient({
  baseUrl: 'http://your-gateway:8080',
  auth: { type: 'apiKey', apiKey: 'your-key' },
});

// OpenAI Realtime 어댑터 초기화
const realtimeAdapter = new OpenAIRealtimeAdapter({
  apiKey: process.env.OPENAI_API_KEY!,

  // 모델 선택:
  //   gpt-4o-realtime-preview          — 최고 품질 (기본값)
  //   gpt-4o-mini-realtime-preview     — 비용 절감형 (Audio 1.5)
  model: 'gpt-4o-mini-realtime-preview',

  // AI 응답 음성 선택
  voice: 'alloy',   // alloy, echo, nova, shimmer, ash, coral, sage, verse 등

  // 시스템 지시사항 (LLM의 systemPrompt에 해당)
  instructions: `당신은 친절한 한국어 AI 상담원입니다.
- 짧고 자연스러운 대화체로 답변하세요.
- 2–3문장 이내로 답변하세요.
- 고객이 화가 난 경우 먼저 공감하세요.`,

  // 음성 감지 설정 (server_vad: 자동 감지, none: 수동 제어)
  turnDetection: {
    mode:              'server_vad',
    threshold:          0.5,    // 감지 민감도 (0.0–1.0)
    silenceDurationMs:  500,    // 발화 종료까지 침묵 시간 (ms)
    prefixPaddingMs:    300,    // 발화 시작 전 여유 시간 (ms)
  },

  // 사용자 발화 텍스트 변환 여부
  inputTranscription: true,
  temperature: 0.8,
});

// 오디오 출력 → DVGateway TTS 주입
realtimeAdapter.onAudioOutput(async (audioChunk, linkedId) => {
  await gw.injectAudio(linkedId, audioChunk);
});

// 전사 결과 처리
realtimeAdapter.onTranscript((result) => {
  const speaker = result.speaker === 'agent' ? '🤖 AI' : '👤 고객';
  console.log(`${speaker}: ${result.text}`);
});

// 오류 처리
realtimeAdapter.onError((err, linkedId) => {
  console.error(`리얼타임 오류 | ${linkedId}: ${err.message}`);
});

// 통화 이벤트 구독 — 새 통화마다 세션 시작
gw.on('call:new', async (event) => {
  const { session } = event;
  console.log(`📞 리얼타임 세션 시작: ${session.linkedId}`);

  // 통화 오디오 스트림을 리얼타임 어댑터로 연결
  const audioStream = gw.audioStream(session.linkedId, { dir: 'in' });
  await realtimeAdapter.startSession(session.linkedId, audioStream);
});

gw.on('call:ended', async (event) => {
  console.log(`📴 리얼타임 세션 종료: ${event.linkedId}`);
  await realtimeAdapter.stop(event.linkedId);
});

await gw.connect();
console.log('🎙️ OpenAI Realtime 봇이 준비되었습니다.');
```

### 리얼타임 vs 파이프라인 비교

| 항목 | STT→LLM→TTS 파이프라인 | OpenAI Realtime |
|------|----------------------|----------------|
| 지연 시간 | ~500ms | **~300ms** |
| 비용 | 서비스별 요금 | 단일 요금 (토큰/초) |
| 음성 자연스러움 | 어댑터 TTS 품질 의존 | **자연스러운 억양** |
| AI 교체 유연성 | **자유로움** (Anthropic, OpenAI 등) | OpenAI 한정 |
| 한국어 품질 | Deepgram Nova-3 최고 | 보통 |
| 컨퍼런스 지원 | ✅ | 세션당 1개 |

---

## 9. 파이프라인 패턴 3: 컨퍼런스 자동 회의록

다자 통화(ConfBridge)에서 각 참여자의 발화를 자동으로 텍스트화합니다.
TTS 응답 없이 **STT만** 사용하는 경우에 적합합니다.

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';

const gw = new DVGatewayClient({
  baseUrl: 'http://your-gateway:8080',
  auth: { type: 'apiKey', apiKey: 'your-key' },
});

// 회의록 저장용 배열
const minutes: Array<{ speaker: string; text: string; time: Date }> = [];

await gw.pipeline()
  .stt(new DeepgramAdapter({
    apiKey:   process.env.DEEPGRAM_API_KEY!,
    language: 'ko',
    model:    'nova-3',
    diarize:  true,    // 화자 구분 필수
  }))
  .forConference()    // ← 컨퍼런스 모드 (TTS 없음)
  .onTranscript(async (result, session) => {
    if (!result.isFinal) return;

    const entry = {
      speaker: result.speaker ?? session.linkedId,
      text:    result.text,
      time:    new Date(result.timestampMs),
    };

    minutes.push(entry);
    console.log(`[${entry.time.toTimeString().slice(0,8)}] ${entry.speaker}: ${entry.text}`);
  })
  .onError((err) => {
    console.error('회의록 오류:', err.message);
  })
  .start();

// 회의 종료 시 회의록 내보내기
process.on('SIGTERM', () => {
  console.log('\n=== 회의록 ===');
  for (const m of minutes) {
    console.log(`[${m.time.toISOString()}] ${m.speaker}: ${m.text}`);
  }
});
```

---

## 10. 어댑터별 상세 설정

### Deepgram STT (음성 인식)

```typescript
import { DeepgramAdapter } from 'dvgateway-adapters/stt';

const stt = new DeepgramAdapter({
  apiKey:   'dg_xxxx',

  // ── 언어 및 모델 ──────────────────────────────────────────
  language: 'ko',           // 언어: 'ko' | 'en-US' | 'en-GB' | 'ja' | 'zh' | 'multi'
  model:    'nova-3',       // 모델:
                            //   'nova-3'           — 최고 정확도 (기본값, 한국어+영어)
                            //   'nova-3-general'   — 일반 대화 최적화
                            //   'nova-3-medical'   — 의료 용어 특화
                            //   'nova-3-phonecall' — 전화 통화 품질 최적화

  // ── 발화 감지 ─────────────────────────────────────────────
  endpointingMs:  500,      // 발화 종료 침묵 시간 (ms, 기본값: 500)
  utteranceEndMs: 1000,     // 발화 확정까지 추가 대기 (ms)

  // ── 전사 옵션 ─────────────────────────────────────────────
  interimResults:  true,    // 중간 결과 수신 여부 (기본값: true)
  smartFormat:     true,    // 자동 문장 부호·숫자 형식화
  punctuate:       true,    // 문장부호 추가
  profanityFilter: false,   // 욕설 필터링

  // ── 화자 분리 ─────────────────────────────────────────────
  diarize: true,            // 화자 구분 활성화

  // ── 키워드 강화 (nova-3 전용) ─────────────────────────────
  keywords: ['AI', '게이트웨이', 'OLSSOO'],  // 도메인 특화 단어 인식률 향상
});
```

**모델 선택 가이드:**

| 상황 | 추천 모델 |
|------|---------|
| 일반 고객 상담 (한국어+영어 혼용) | `nova-3` |
| 의료 상담 | `nova-3-medical` |
| 일반 전화 통화 | `nova-3-phonecall` |
| 비용 절감이 필요한 경우 | `base` |

---

### ElevenLabs TTS (음성 합성)

```typescript
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

const tts = new ElevenLabsAdapter({
  apiKey:  'sk_xxxx',

  // ── 모델 선택 ─────────────────────────────────────────────
  model: 'eleven_flash_v2_5',
  // 옵션:
  //   'eleven_flash_v2_5'      — 최저 지연 (~75ms), 실시간 최적 (기본값)
  //   'eleven_turbo_v2_5'      — 품질/속도 균형 (~200ms)
  //   'eleven_multilingual_v2' — 최고 다국어 품질 (지연 높음)
  //   'eleven_multilingual_v3' — 차세대 다국어, 향상된 억양 (2026)

  // ── 음성 선택 ─────────────────────────────────────────────
  // ElevenLabs Voice Library에서 한국어 음성 ID를 찾아 입력하세요
  voiceId: 'YOUR_VOICE_ID',

  // ── 음성 품질 설정 ────────────────────────────────────────
  stability:               0.5,   // 안정성 (0.0–1.0, 높을수록 일관됨)
  similarityBoost:         0.75,  // 원본 음성 유사도 (0.0–1.0)
  style:                   0.0,   // 표현력 (0.0–1.0, 높으면 지연 증가)
  useSpeakerBoost:         true,  // 음성 선명도 향상

  // ── 스트리밍 최적화 ───────────────────────────────────────
  optimizeStreamingLatency: 4,    // 0(품질 최대) ~ 4(지연 최소, 기본값)
  outputFormat: 'pcm_24000',      // 내부 포맷 (변경 불필요)
});
```

**내장 한국어 네이티브 음성 (9개):**

| 음성 ID | 이름 | 성별 |
|---------|------|------|
| `pjJMvFj0JGWi3mogOkHH` | Hyun Bin | 남성 |
| `t0jbNlBVZ17f02VDIeMI` | 지영 / JiYoung | 여성 |
| `zrHiDhphv9ZnVXBqCLjz` | Jennie | 여성 |
| `ZJCNdOEhQGMOIbMuhBME` | Han Aim | 남성 |
| `ova4yY2jqnnUdGOmTGbx` | KKC HQ | 남성 |
| `Xb7hH8MSUJpSbSDYk0k2` | Anna Kim | 여성 |
| `XrExE9yKIg1WjnnlVkGX` | Yuna | 여성 |
| `ThT5KcBeYPX3keUQqHPh` | Jina | 여성 |
| `Sita5M0jWFxPiECPABjR` | jjeong | 여성 |

```typescript
import { ELEVENLABS_KOREAN_VOICES } from 'dvgateway-adapters';

// 내장 한국어 음성 사용
const tts = new ElevenLabsAdapter({
  apiKey: 'sk_xxxx',
  voiceId: ELEVENLABS_KOREAN_VOICES[0].id,  // Hyun Bin
});
```

**동적 음성 조회 & 클로닝:**

```typescript
// 사용 가능한 모든 음성 조회 (기본 + 클론 + 라이브러리)
const voices = await ElevenLabsAdapter.fetchVoices('sk_xxxx');

// 오디오 파일로 음성 복제
const cloned = await ElevenLabsAdapter.cloneVoice(
  'sk_xxxx', '내 목소리', audioData, 'sample.wav',
);
```

**REST API:**
```
GET  /api/v1/config/apikeys/voices/elevenlabs/fetch  — 음성 목록 조회
POST /api/v1/config/apikeys/voices/elevenlabs/clone  — 음성 복제 (multipart/form-data)
```

**추가 음성 찾기:**
ElevenLabs 콘솔(https://elevenlabs.io/voice-library)에서 "Korean"으로 검색하거나,
자신의 목소리를 클론하여 `voiceId`로 사용할 수 있습니다.

---

### Anthropic Claude LLM

```typescript
import { AnthropicAdapter } from 'dvgateway-adapters/llm';

const llm = new AnthropicAdapter({
  apiKey: 'sk-ant-xxxx',

  // ── 모델 선택 ─────────────────────────────────────────────
  model: 'claude-haiku-4-5-20251001',
  // 옵션 (2026-03 기준):
  //   'claude-haiku-4-5-20251001' — 가장 빠름, 저비용 (실시간 음성 권장)
  //   'claude-sonnet-4-6'         — 품질/속도 균형 (기본값)
  //   'claude-opus-4-6'           — 최고 품질, 복잡한 추론

  // ── 대화 설정 ─────────────────────────────────────────────
  systemPrompt: '당신은 친절한 AI 상담원입니다. 짧게 답변하세요.',
  maxTokens:    512,   // 응답 최대 토큰 (짧을수록 빠름)
  temperature:  0.7,   // 창의성 (0.0=정확, 1.0=창의적)

  // ── 고급 설정 (선택) ─────────────────────────────────────
  // topP: 0.9,                           // 핵 샘플링 (temperature와 동시 사용 불가)
  // stopSequences: ['###', '[END]'],      // 이 문자열이 등장하면 생성 중단
});
```

**모델 선택 가이드:**

| 상황 | 추천 모델 | 예상 지연 |
|------|---------|----------|
| 실시간 음성 봇 | `claude-haiku-4-5-20251001` | ~80ms |
| 복잡한 상담 | `claude-sonnet-4-6` | ~120ms |
| 고품질 분석 | `claude-opus-4-6` | ~200ms |

---

### OpenAI GPT LLM

```typescript
import { OpenAILlmAdapter } from 'dvgateway-adapters/llm';

const llm = new OpenAILlmAdapter({
  apiKey: 'sk-xxxx',

  // ── 모델 선택 ─────────────────────────────────────────────
  model: 'gpt-4o-mini',
  // 옵션 (2026-03 기준):
  //   'gpt-4o-mini' — 빠름, 저비용 (실시간 음성 권장, 기본값)
  //   'gpt-4o'      — 최고 품질, 멀티모달

  // ── 대화 설정 ─────────────────────────────────────────────
  systemPrompt:     '친절한 AI 상담원입니다. 한국어로 짧게 답변하세요.',
  maxTokens:        512,
  temperature:      0.7,
  presencePenalty:  0.1,   // 주제 반복 억제 (0.0–2.0)
  frequencyPenalty: 0.1,   // 표현 반복 억제 (0.0–2.0)
});
```

---

### OpenAI TTS (음성 합성)

```typescript
import { OpenAITtsAdapter } from 'dvgateway-adapters/tts';

const tts = new OpenAITtsAdapter({
  apiKey: 'sk-xxxx',

  // ── 모델 선택 ─────────────────────────────────────────────
  model: 'tts-1',
  // 옵션:
  //   'tts-1'           — 실시간 최적화 (~200ms, 기본값)
  //   'tts-1-hd'        — 고품질 (스튜디오 수준)
  //   'gpt-4o-mini-tts' — 신경망 TTS, 감정/억양 제어 (2025+)

  // ── 음성 선택 ─────────────────────────────────────────────
  voice: 'nova',
  // 옵션: alloy | echo | fable | onyx | nova | shimmer
  //       ash | ballad | coral | sage | verse  (gpt-4o-mini-tts 전용)

  // ── gpt-4o-mini-tts 전용: 음성 지시사항 ──────────────────
  // model: 'gpt-4o-mini-tts' 사용 시에만 동작
  voiceInstructions: '차분하고 명확한 한국어로 말하세요.',
});
```

---

### OpenAI 리얼타임 (Speech-to-Speech)

```typescript
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';

const realtime = new OpenAIRealtimeAdapter({
  apiKey: 'sk-xxxx',

  // ── 모델 선택 ─────────────────────────────────────────────
  model: 'gpt-4o-realtime-preview',
  // 옵션:
  //   'gpt-4o-realtime-preview'                     — 최고 품질 (기본값, 항상 최신)
  //   'gpt-4o-realtime-preview-2024-12-17'          — 고정 버전 (재현성 필요 시)
  //   'gpt-4o-mini-realtime-preview'                — 비용 절감형 (Audio 1.5)
  //   'gpt-4o-mini-realtime-preview-2024-12-17'     — 고정 버전 (미니)

  // ── AI 음성 선택 ──────────────────────────────────────────
  voice: 'alloy',    // alloy | echo | nova | shimmer | ash | coral | sage | verse

  // ── 시스템 지시사항 ───────────────────────────────────────
  instructions: '친절한 한국어 AI 상담원입니다. 짧고 자연스럽게 답변하세요.',

  // ── 발화 감지 설정 ────────────────────────────────────────
  turnDetection: {
    mode:              'server_vad',  // 자동 발화 감지
    threshold:          0.5,          // 감지 민감도
    silenceDurationMs:  500,          // 종료 판단 침묵 시간
    prefixPaddingMs:    300,          // 발화 시작 여유시간
  },

  // ── 기타 설정 ─────────────────────────────────────────────
  inputTranscription: true,   // 사용자 발화 텍스트 변환
  temperature:        0.8,    // 응답 다양성 (0.6–1.2 권장)
  maxResponseTokens:  'inf',  // 응답 길이 제한 없음 (또는 숫자)
});
```

---

### 로컬 STT — whisper.cpp (오프라인 무료)

**whisper.cpp**는 OpenAI Whisper 모델을 C++로 재구현한 초고속 로컬 STT 엔진입니다.
인터넷 없이 완전 오프라인 운영이 가능하며, CPU만으로도 실시간에 가까운 속도를 냅니다.

#### 1단계 — whisper.cpp 서버 설치 및 실행

```bash
# 소스 빌드 (Ubuntu/Debian)
sudo apt update && sudo apt install -y build-essential libopenblas-dev cmake git
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp

# GPU 지원 빌드 (CUDA — NVIDIA GPU가 있는 경우)
cmake -B build -DGGML_CUDA=ON
# CPU 전용 빌드
cmake -B build

cmake --build build --config Release -j$(nproc)

# 모델 다운로드 (large-v3-turbo 권장 — 속도·정확도 균형)
bash ./models/download-ggml-model.sh large-v3-turbo
# 또는 한국어 정확도 최고
bash ./models/download-ggml-model.sh large-v3

# HTTP 스트리밍 서버 실행 (포트 8178)
./build/bin/whisper-server \
  --model models/ggml-large-v3-turbo.bin \
  --host 0.0.0.0 \
  --port 8178 \
  --language ko \
  --threads 4 \
  --beam-size 1 \
  --no-timestamps
```

> **모델 용량**: `tiny`(75MB) ~ `large-v3`(3.1GB). 실시간 통화에는 `large-v3-turbo`(809MB) 권장.

#### 2단계 — Node.js 어댑터 설정

```typescript
import { WhisperCppAdapter } from 'dvgateway-adapters/stt';

const stt = new WhisperCppAdapter({
  // whisper.cpp HTTP 서버 주소 (같은 서버라면 localhost)
  serverUrl: 'http://localhost:8178',

  // ── 언어 설정 ───────────────────────────────────────────
  language: 'ko',       // 'ko' | 'en' | 'ja' | 'zh' | 'auto'

  // ── 발화 감지 ────────────────────────────────────────────
  // whisper.cpp는 VAD(Voice Activity Detection)를 내장 지원
  vadEnabled:      true,    // 자동 발화 감지 활성화
  vadThreshold:    0.6,     // 발화 감지 민감도 (0.0–1.0)
  silenceDurationMs: 600,   // 발화 종료 판단 침묵 시간

  // ── 추론 품질 ────────────────────────────────────────────
  beamSize:       1,        // 1=빠름, 5=정확 (실시간에는 1 권장)
  temperature:    0.0,      // 0.0=결정론적 (가장 안정적)
  noSpeechThreshold: 0.6,   // 무음 구간 필터링 임계값
});
```

#### 2단계 — Python 어댑터 설정

```python
from dvgateway.adapters.stt import WhisperCppAdapter

stt = WhisperCppAdapter(
    server_url="http://localhost:8178",  # whisper.cpp 서버 주소
    language="ko",
    vad_enabled=True,
    vad_threshold=0.6,
    silence_duration_ms=600,
    beam_size=1,
    temperature=0.0,
)
```

**모델별 성능 비교 (CPU 4코어 기준):**

| 모델 | 크기 | 실시간 배율 | 한국어 정확도 |
|------|------|------------|-------------|
| `tiny` | 75MB | ~32x | 낮음 |
| `base` | 142MB | ~16x | 보통 |
| `medium` | 769MB | ~6x | 좋음 |
| `large-v3-turbo` ★ | 809MB | ~8x | 매우 좋음 |
| `large-v3` | 3.1GB | ~2x | 최고 |

---

### 로컬 STT — Faster-Whisper (Python 고속 추론)

**Faster-Whisper**는 CTranslate2 엔진으로 OpenAI Whisper를 4–8배 빠르게 실행합니다.
DVGateway 서버와 같은 머신에서 Python 프로세스로 실행합니다.

#### 1단계 — Faster-Whisper 서비스 설치

```bash
# 가상환경 설정
python3 -m venv /opt/faster-whisper-svc
source /opt/faster-whisper-svc/bin/activate

# 패키지 설치
pip install faster-whisper

# GPU 사용 시 (NVIDIA CUDA 12.x)
pip install faster-whisper nvidia-cublas-cu12 nvidia-cudnn-cu12

# 간단한 스트리밍 서버 실행 (dvgateway-whisper-server 유틸리티)
pip install dvgateway-whisper-server
dvgateway-whisper-server \
  --model large-v3 \
  --device cuda \        # CPU 사용 시: --device cpu
  --compute-type float16 \  # CPU 사용 시: int8
  --port 8179 \
  --language ko
```

> `dvgateway-whisper-server`는 DVGateway 생태계에서 제공하는 Faster-Whisper 래퍼 서버입니다.
> 독립 실행 스크립트로도 사용 가능합니다:

```python
# whisper_server.py — 독립 실행 가능
from faster_whisper import WhisperModel
from fastapi import FastAPI, WebSocket
import asyncio, numpy as np, struct

app = FastAPI()
model = WhisperModel("large-v3", device="cpu", compute_type="int8")

@app.websocket("/ws/transcribe")
async def transcribe_ws(ws: WebSocket):
    await ws.accept()
    audio_buffer = bytearray()

    while True:
        data = await ws.receive_bytes()
        audio_buffer.extend(data)

        # 640바이트(20ms) 청크가 쌓이면 추론
        if len(audio_buffer) >= 16000 * 2:   # 1초 분량
            pcm = np.frombuffer(audio_buffer, dtype=np.int16).astype(np.float32) / 32768.0
            audio_buffer.clear()

            segments, info = model.transcribe(
                pcm,
                language="ko",
                beam_size=1,
                vad_filter=True,
                vad_parameters={"threshold": 0.5, "min_silence_duration_ms": 500},
            )
            for seg in segments:
                await ws.send_json({"text": seg.text, "is_final": True})

# 실행: uvicorn whisper_server:app --host 0.0.0.0 --port 8179
```

#### 어댑터 설정

**Node.js:**

```typescript
import { FasterWhisperAdapter } from 'dvgateway-adapters/stt';

const stt = new FasterWhisperAdapter({
  serverUrl:         'ws://localhost:8179/ws/transcribe',
  language:          'ko',
  vadEnabled:        true,
  vadThreshold:      0.5,
  silenceDurationMs: 500,
});
```

**Python:**

```python
from dvgateway.adapters.stt import FasterWhisperAdapter

stt = FasterWhisperAdapter(
    server_url="ws://localhost:8179/ws/transcribe",
    language="ko",
    vad_enabled=True,
    vad_threshold=0.5,
    silence_duration_ms=500,
)
```

또는 **Python 인프로세스 모드** (같은 프로세스에서 직접 실행):

```python
from dvgateway.adapters.stt import FasterWhisperAdapter

# server_url 없이 model 지정 → 인프로세스 실행 (추가 서버 불필요)
stt = FasterWhisperAdapter(
    model="large-v3",
    device="cpu",           # "cuda" (GPU 사용 시)
    compute_type="int8",    # CPU: "int8", GPU: "float16"
    language="ko",
    vad_enabled=True,
    vad_threshold=0.5,
    silence_duration_ms=500,
    beam_size=1,
    num_workers=2,          # 병렬 추론 워커 수
)
```

---

### 로컬 STT — OpenAI Whisper (Python 공식)

공식 OpenAI Whisper Python 라이브러리를 로컬에서 실행합니다.
Faster-Whisper보다 느리지만 설치가 가장 간단합니다.

```bash
# 설치
pip install openai-whisper

# ffmpeg 필요 (오디오 포맷 변환)
sudo apt install -y ffmpeg   # Ubuntu/Debian
# brew install ffmpeg        # macOS
```

**Python 인프로세스 어댑터:**

```python
from dvgateway.adapters.stt import WhisperLocalAdapter

stt = WhisperLocalAdapter(
    model="large-v3",       # "tiny" | "base" | "small" | "medium" | "large-v3"
    device="cpu",           # "cpu" | "cuda" | "mps" (Apple Silicon)
    language="ko",

    # 발화 감지 — silero-vad 사용 (pip install silero-vad)
    vad_enabled=True,
    vad_threshold=0.5,

    # 추론 옵션
    temperature=0.0,        # 0.0 = 결정론적 (가장 안정적)
    beam_size=1,            # 실시간에는 1 권장
    fp16=False,             # CPU에서는 False, GPU에서는 True
)
```

> **주의**: OpenAI Whisper는 스트리밍이 아닌 파일 단위 추론이 기본입니다.
> DVGateway 어댑터는 내부적으로 20ms 오디오 청크를 버퍼링하여 VAD 기반 세그먼트로 분할합니다.

---

### 로컬 LLM — Qwen (Ollama 경유)

**Qwen**은 Alibaba Cloud의 오픈소스 LLM으로, 한국어 성능이 우수합니다.
**Ollama**를 통해 GPU 없이 CPU만으로도 실행 가능합니다.

#### 1단계 — Ollama 설치 및 Qwen 모델 다운로드

```bash
# Ollama 설치 (Linux/macOS)
curl -fsSL https://ollama.com/install.sh | sh

# Qwen3.5 모델 다운로드 (2026-03 최신 — 멀티모달, 한국어 최고 성능)
ollama pull qwen3.5:9b       # 9B 파라미터 (RAM 8GB 이상 권장) ★ 권장
ollama pull qwen3.5:4b       # 4B 경량 (RAM 4GB 이상)
ollama pull qwen3:8b         # 안정화된 Qwen3 이전 버전

# 실행 확인
ollama run qwen3:8b "안녕하세요, 잘 작동하나요?"

# Ollama 서버는 기본적으로 http://localhost:11434 에서 실행됩니다
```

#### 2단계 — 어댑터 설정

**Node.js:**

```typescript
import { OllamaAdapter } from 'dvgateway-adapters/llm';

const llm = new OllamaAdapter({
  baseUrl: 'http://localhost:11434',  // Ollama 서버 주소

  // ── 모델 선택 ────────────────────────────────────────────
  model: 'qwen3.5:9b',
  // 옵션:
  //   'qwen3.5:9b'      — 멀티모달, 한국어 최고 품질 (2026-03 최신) ★
  //   'qwen3.5:4b'      — RAM 4GB로 실행 가능한 경량형
  //   'qwen3:8b'        — 안정성 검증된 이전 세대
  //   'gemma3:12b'      — Google Gemma 3 대안
  //   'llama3.3:8b'     — Meta Llama 3.3 대안

  // ── 대화 설정 ────────────────────────────────────────────
  systemPrompt: '당신은 친절한 한국어 AI 상담원입니다. 2–3문장으로 짧게 답변하세요.',
  maxTokens:    512,
  temperature:  0.7,

  // ── 스트리밍 ─────────────────────────────────────────────
  stream: true,   // 토큰 스트리밍 활성화 (지연 최소화)

  // ── Qwen3 특화 옵션 ──────────────────────────────────────
  options: {
    think: false,     // 사고 과정(thinking) 비활성화 → 빠른 응답
    num_ctx: 4096,    // 컨텍스트 윈도우 크기
    num_predict: 200, // 최대 생성 토큰 수
    top_p: 0.9,
    repeat_penalty: 1.1,
  },
});
```

**Python:**

```python
from dvgateway.adapters.llm import OllamaAdapter

llm = OllamaAdapter(
    base_url="http://localhost:11434",
    model="qwen3.5:9b",
    system_prompt="당신은 친절한 한국어 AI 상담원입니다. 2–3문장으로 짧게 답변하세요.",
    max_tokens=512,
    temperature=0.7,
    stream=True,
    options={
        "think": False,       # Qwen3 사고 과정 비활성화
        "num_ctx": 4096,
        "num_predict": 200,
        "top_p": 0.9,
        "repeat_penalty": 1.1,
    },
)
```

**Qwen 모델 선택 가이드 (2026-03 기준):**

| 모델 | RAM 요구 | 응답 속도 | 한국어 | 특징 |
|------|---------|---------|--------|------|
| `qwen3.5:4b` | 4GB | ★★★★★ | ★★★★ | 저사양 서버, 멀티모달 경량 (2026-03 최신) |
| `qwen3.5:9b` ★ | 8GB | ★★★★ | ★★★★★ | **권장**, 멀티모달, 고품질 한국어 (2026-03 최신) |
| `qwen3:8b` | 8GB | ★★★★ | ★★★★★ | 안정성 검증된 Qwen3 |
| `qwen3:14b` | 16GB | ★★★ | ★★★★★ | 복잡한 추론 |

> **Qwen3 `think` 옵션**: Qwen3는 기본적으로 "사고 과정"을 생성합니다. 실시간 음성 봇에서는 `think: false`로 비활성화하여 응답 속도를 높이세요.

---

### 로컬 LLM — vLLM 서버 연동

**vLLM**은 고성능 GPU 서버에서 OpenAI 호환 API로 LLM을 서빙합니다.
DVGateway의 `OpenAICompatAdapter`로 바로 연결됩니다.

#### 1단계 — vLLM 서버 설치 및 실행

```bash
# vLLM 설치 (CUDA 12.x + Python 3.10+)
pip install vllm

# Qwen3-8B 모델 서버 실행 (Hugging Face에서 자동 다운로드)
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen3-8B \
  --port 8000 \
  --served-model-name qwen3-8b \
  --max-model-len 4096 \
  --tensor-parallel-size 1 \   # GPU 수
  --dtype auto \
  --trust-remote-code

# 확인
curl http://localhost:8000/v1/models
```

#### 2단계 — 어댑터 설정

**Node.js:**

```typescript
import { OpenAICompatAdapter } from 'dvgateway-adapters/llm';

const llm = new OpenAICompatAdapter({
  // vLLM 서버는 OpenAI API와 완전 호환
  baseUrl: 'http://localhost:8000/v1',
  apiKey:  'not-needed',   // vLLM은 키 검증 없음 (로컬)

  model: 'qwen3-8b',       // --served-model-name 으로 지정한 이름
  systemPrompt: '친절한 한국어 AI 상담원입니다. 짧게 답변하세요.',
  maxTokens:    512,
  temperature:  0.7,
  stream:       true,

  // Qwen3 사고 과정 비활성화 (extra_body)
  extraBody: {
    chat_template_kwargs: { enable_thinking: false },
  },
});
```

**Python:**

```python
from dvgateway.adapters.llm import OpenAICompatAdapter

llm = OpenAICompatAdapter(
    base_url="http://localhost:8000/v1",
    api_key="not-needed",
    model="qwen3-8b",
    system_prompt="친절한 한국어 AI 상담원입니다. 짧게 답변하세요.",
    max_tokens=512,
    temperature=0.7,
    stream=True,
    extra_body={
        "chat_template_kwargs": {"enable_thinking": False}
    },
)
```

> **vLLM 대안**: SGLang, LMDeploy, llama.cpp server 등도 OpenAI 호환 API를 제공하므로 `OpenAICompatAdapter`로 동일하게 연결됩니다.

**완전 로컬(오프라인) 파이프라인 예시:**

```typescript
// 모든 컴포넌트를 로컬에서 실행 — 인터넷 불필요
await gw.pipeline()
  .stt(new WhisperCppAdapter({
    serverUrl: 'http://localhost:8178',
    language:  'ko',
    vadEnabled: true,
  }))
  .llm(new OllamaAdapter({
    baseUrl:     'http://localhost:11434',
    model:       'qwen3:8b',
    systemPrompt: '친절한 한국어 AI 상담원입니다.',
    options:     { think: false },
  }))
  .tts(new ElevenLabsAdapter({    // TTS는 현재 로컬 오픈소스 품질이 제한적이므로 유료 권장
    apiKey:  process.env.ELEVENLABS_API_KEY!,
    model:   'eleven_flash_v2_5',
    voiceId: 'YOUR_VOICE_ID',
  }))
  .start();
```

---

## 11. 이벤트 후킹 — 통화 시작·종료·발화 감지

파이프라인의 `.on*(...)` 메서드로 이벤트를 후킹할 수 있습니다.

```typescript
gw.pipeline()
  .stt(stt).llm(llm).tts(tts)

  // 새 통화가 시작될 때 호출
  .onNewCall(async (session) => {
    console.log(`통화 시작: ${session.linkedId}`);
    console.log(`발신자: ${session.caller}, 수신자: ${session.callee}`);
    console.log(`방향: ${session.dir}`); // 'in' | 'out' | 'both'
    // 예: DB에 통화 기록 저장, 인사말 재생 등
  })

  // 발화가 인식될 때마다 호출 (중간 + 최종)
  .onTranscript(async (result, session) => {
    if (!result.isFinal) {
      // 중간 결과 (아직 말하는 중)
      process.stdout.write(`\r${result.text}`);
    } else {
      // 최종 결과 (발화 완료)
      console.log(`\n[최종] ${result.speaker}: ${result.text}`);
      // 예: DB에 전사 저장, 웹훅 호출 등
    }
  })

  // 통화가 종료될 때 호출
  .onCallEnded(async (linkedId, durationSec) => {
    console.log(`통화 종료: ${linkedId} (${durationSec}초)`);
    // 예: 통화 요약 생성, 정산 처리 등
  })

  // 오류 발생 시 호출
  .onError((err, linkedId) => {
    console.error(`오류 [${linkedId ?? 'unknown'}]: ${err.message}`);
    // 예: 알림 발송, 오류 로그 기록 등
  })

  .start();
```

---

## 12. 폴백(Fallback) 설정 — 장애 자동 전환

주 서비스 장애 시 자동으로 백업 서비스로 전환합니다.

```typescript
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { AnthropicAdapter, OpenAILlmAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter, OpenAITtsAdapter } from 'dvgateway-adapters/tts';

await gw.pipeline()
  // STT: Deepgram 장애 시 폴백 없음 (단일 서비스)
  .stt(new DeepgramAdapter({ apiKey: process.env.DEEPGRAM_API_KEY!, language: 'ko' }))

  // LLM: Anthropic 장애 시 OpenAI로 자동 전환
  .llm(new AnthropicAdapter({ apiKey: process.env.ANTHROPIC_API_KEY! }))
  .fallback(new OpenAILlmAdapter({ apiKey: process.env.OPENAI_API_KEY! }))

  // TTS: ElevenLabs 장애 시 OpenAI TTS로 자동 전환
  .tts(new ElevenLabsAdapter({ apiKey: process.env.ELEVENLABS_API_KEY! }))
  .fallback(new OpenAITtsAdapter({ apiKey: process.env.OPENAI_API_KEY! }))

  .start();
```

---

## 13. 멀티테넌트 지원

서버에 `TENANT_CREDENTIALS` 가 설정된 경우 SDK 클라이언트에 `tenantId` 를 지정하여 테넌트 범위로 격리된 운영이 가능합니다.

### DVGatewayClient 옵션

```typescript
const gw = new DVGatewayClient({
  baseUrl:  'http://your-gateway:8080',
  auth:     { type: 'apiKey', apiKey: 'your-key' },
  tenantId: 'tenant-a',   // 설정 시 모든 요청에 X-Tenant-ID 헤더 자동 삽입
});
```

### 테넌트별 세션 목록 조회

```typescript
// 현재 tenantId에 속한 활성 세션만 반환
const sessions = await gw.listSessionsByTenant('tenant-a');
console.log(sessions);
// [{ sessionId: '...', tenantId: 'tenant-a', linkedId: '...', state: 'active' }, ...]
```

### call:new 이벤트의 tenantId

```typescript
gw.on('call:new', (event) => {
  const { session } = event;
  console.log(`tenantId: ${session.tenantId}`);    // 통화에 연결된 테넌트 ID
  console.log(`linkedId: ${session.linkedId}`);
});
```

### 멀티테넌트 파이프라인 예시

```typescript
// 테넌트별 독립된 DVGatewayClient 인스턴스 생성
const gwA = new DVGatewayClient({
  baseUrl:  'http://your-gateway:8080',
  auth:     { type: 'apiKey', apiKey: 'key-a' },
  tenantId: 'tenant-a',
});

const gwB = new DVGatewayClient({
  baseUrl:  'http://your-gateway:8080',
  auth:     { type: 'apiKey', apiKey: 'key-b' },
  tenantId: 'tenant-b',
});

// 각 파이프라인은 해당 테넌트의 통화만 처리
await gwA.pipeline().stt(sttA).llm(llmA).tts(ttsA).start();
await gwB.pipeline().stt(sttB).llm(llmB).tts(ttsB).start();
```

> **참고**: 서버의 `TENANT_LIMITS` 환경변수로 테넌트별 동시통화 한도를 개별 설정할 수 있습니다.
> 예: `TENANT_LIMITS="tenant-a:10,tenant-b:30"`

---

## 14. 모니터링 대시보드

서버 설치 후 웹 브라우저에서 `http://your-server:8081` 에 접속하면
실시간 모니터링 대시보드를 볼 수 있습니다.

**대시보드에서 확인 가능한 항목:**

| 항목 | 설명 |
|------|------|
| 활성 통화 수 | 현재 진행 중인 통화 세션 수 |
| VU 미터 | 각 통화의 실시간 음량 레벨 |
| 지연 시간 | STT/LLM/TTS 각 단계별 처리 시간 |
| 전사 로그 | 실시간 발화 텍스트 스트림 |
| 오류 로그 | AI 서비스 오류 및 연결 이슈 |
| 라이선스 상태 | 동시 통화 한도 및 사용량 |

---

## 15. 감정 분석 (Sentiment Analysis) — 실시간 회의 분위기 모니터링

Deepgram Nova-3의 **Sentiment Analysis** 기능을 활용하면, 각 발화(transcript segment)에 대해
**positive / neutral / negative** 감정 분류와 신뢰도 점수(0.0~1.0)를 실시간으로 받을 수 있습니다.

이를 통해 다음과 같은 기능이 가능합니다:

| 기능 | 설명 |
|------|------|
| **실시간 회의 분위기 모니터링** | 스트리밍 화면 참여자 목록에 감정 상태 표시 |
| **회의록 감정 메타데이터** | 회의 종료 후 회의록에 발화별 감정 데이터 포함 |
| **화자별 감정 통계** | 회의 종료 시 화자별 감정 분포 요약 제공 |

---

### Deepgram Sentiment 활성화

Deepgram STT 어댑터에서 `sentiment: true` 옵션을 추가하면 됩니다.
**Nova-3 이상** 모델에서만 지원됩니다.

**Node.js:**

```typescript
import { DeepgramAdapter } from 'dvgateway-adapters/stt';

const stt = new DeepgramAdapter({
  apiKey:   process.env.DEEPGRAM_API_KEY!,
  language: 'ko',
  model:    'nova-3',
  diarize:  true,       // 화자 구분 (sentiment와 함께 사용 권장)
  sentiment: true,      // ← 감정 분석 활성화
});
```

**Python:**

```python
from dvgateway.adapters.stt import DeepgramAdapter

stt = DeepgramAdapter(
    api_key=os.environ["DEEPGRAM_API_KEY"],
    language="ko",
    model="nova-3",
    diarize=True,
    sentiment=True,      # ← 감정 분석 활성화
)
```

활성화하면 `TranscriptResult` 에 `sentiment` 필드가 포함됩니다:

```typescript
interface SentimentResult {
  sentiment: 'positive' | 'neutral' | 'negative';
  sentimentScore: number;  // 0.0 ~ 1.0
}

// TranscriptResult.sentiment 에서 접근
result.sentiment?.sentiment      // 'positive' | 'neutral' | 'negative'
result.sentiment?.sentimentScore // 0.85
```

---

### 실시간 회의 분위기 모니터링

컨퍼런스 스트리밍 화면의 참여자 목록에 **실시간 감정 상태**를 표시할 수 있습니다.
각 참여자의 최근 발화 감정을 실시간으로 추적하여 회의 분위기를 모니터링합니다.

**Node.js:**

```typescript
// 참여자별 실시간 감정 상태 추적
const participantMood = new Map<string, {
  sentiment: string;
  score: number;
  lastUpdated: Date;
}>();

await gw.pipeline()
  .stt(new DeepgramAdapter({
    apiKey:    process.env.DEEPGRAM_API_KEY!,
    language:  'ko',
    model:     'nova-3',
    diarize:   true,
    sentiment: true,
  }))
  .forConference()
  .onTranscript(async (result, session) => {
    if (!result.isFinal) return;

    // 감정 상태 업데이트
    if (result.sentiment) {
      const speakerId = result.speaker ?? session.linkedId;
      participantMood.set(speakerId, {
        sentiment: result.sentiment.sentiment,
        score:     result.sentiment.sentimentScore,
        lastUpdated: new Date(),
      });

      // 감정 이모지 매핑
      const emoji = result.sentiment.sentiment === 'positive' ? '😊'
                   : result.sentiment.sentiment === 'negative' ? '😟'
                   : '😐';

      console.log(
        `${emoji} [${speakerId}] ${result.text} ` +
        `(${result.sentiment.sentiment}, ${(result.sentiment.sentimentScore * 100).toFixed(0)}%)`
      );
    }

    // 회의록에 저장
    if (session.confId) {
      await gw.submitTranscript(session.confId, result);
    }
  })
  .start();

// 전체 회의 분위기 요약 (주기적으로 호출)
function getMeetingMoodSummary(): string {
  const moods = [...participantMood.values()];
  const positive = moods.filter(m => m.sentiment === 'positive').length;
  const negative = moods.filter(m => m.sentiment === 'negative').length;
  const neutral  = moods.filter(m => m.sentiment === 'neutral').length;

  if (negative > moods.length / 2) return '⚠️ 부정적 분위기 감지';
  if (positive > moods.length / 2) return '✅ 긍정적 분위기';
  return '➡️ 보통';
}
```

**Python:**

```python
from collections import defaultdict
from datetime import datetime

participant_mood: dict[str, dict] = {}

async def on_transcript(result, session):
    if not result.is_final:
        return

    if result.sentiment:
        speaker_id = result.speaker or session.linked_id
        participant_mood[speaker_id] = {
            "sentiment": result.sentiment.sentiment,
            "score": result.sentiment.sentiment_score,
            "last_updated": datetime.now(),
        }

        emoji = {"positive": "😊", "neutral": "😐", "negative": "😟"}
        print(
            f"{emoji[result.sentiment.sentiment]} [{speaker_id}] {result.text} "
            f"({result.sentiment.sentiment}, {result.sentiment.sentiment_score:.0%})"
        )

    if session.conf_id:
        await gw.submit_transcript(session.conf_id, result)

await (
    gw.pipeline()
    .stt(DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
        diarize=True,
        sentiment=True,
    ))
    .for_conference()
    .on_transcript(on_transcript)
    .start()
)
```

---

### 회의록 감정 메타데이터

회의 종료 후 다운로드하는 회의록(JSON/TXT)에 **발화별 감정 데이터**가 포함됩니다.
`sentiment: true`로 STT를 실행하면 `submitTranscript()` 시 감정 메타데이터가 자동으로 함께 저장됩니다.

**JSON 회의록 예시:**

```json
{
  "confId": "7001",
  "startedAt": "2026-03-15T09:00:00Z",
  "endedAt": "2026-03-15T09:45:00Z",
  "utterances": [
    {
      "timestamp": "2026-03-15T09:01:23Z",
      "linkedId": "ch-001",
      "callerId": "김팀장",
      "text": "이번 분기 실적이 목표를 초과했습니다.",
      "isFinal": true,
      "sentiment": "positive",
      "sentimentScore": 0.92
    },
    {
      "timestamp": "2026-03-15T09:02:45Z",
      "linkedId": "ch-002",
      "callerId": "이과장",
      "text": "하지만 비용 초과가 우려됩니다.",
      "isFinal": true,
      "sentiment": "negative",
      "sentimentScore": 0.78
    }
  ],
  "sentimentSummary": {
    "overall": "neutral",
    "distribution": { "positive": 45, "neutral": 35, "negative": 20 },
    "bySpeaker": {
      "김팀장": { "positive": 60, "neutral": 30, "negative": 10, "avgScore": 0.72 },
      "이과장": { "positive": 20, "neutral": 40, "negative": 40, "avgScore": 0.45 }
    }
  }
}
```

**TXT 회의록 예시:**

```
=== Meeting Minutes ===
Conference ID: 7001
Start: 2026-03-15 09:00:00
End: 2026-03-15 09:45:00
Duration: 45m0s

--- Utterance Log ---

[09:01:23] 김팀장: 이번 분기 실적이 목표를 초과했습니다. [😊 positive 92%]
[09:02:45] 이과장: 하지만 비용 초과가 우려됩니다. [😟 negative 78%]

--- Sentiment Summary ---

Overall: neutral
Distribution: positive 45% | neutral 35% | negative 20%

Speaker Stats:
  김팀장: 😊 positive 60% | 😐 neutral 30% | 😟 negative 10% (avg: 0.72)
  이과장: 😊 positive 20% | 😐 neutral 40% | 😟 negative 40% (avg: 0.45)
```

---

### 화자별 감정 통계

회의 종료 시 화자별로 감정 분포를 집계하여 요약 통계를 생성합니다.

**Node.js:**

```typescript
// 화자별 감정 통계 수집기
class SpeakerSentimentStats {
  private stats = new Map<string, Array<{ sentiment: string; score: number }>>();

  add(speaker: string, sentiment: string, score: number): void {
    if (!this.stats.has(speaker)) {
      this.stats.set(speaker, []);
    }
    this.stats.get(speaker)!.push({ sentiment, score });
  }

  getSummary(): Record<string, {
    total: number;
    positive: number;
    neutral: number;
    negative: number;
    avgScore: number;
    dominantMood: string;
  }> {
    const summary: Record<string, any> = {};
    for (const [speaker, entries] of this.stats) {
      const positive = entries.filter(e => e.sentiment === 'positive').length;
      const neutral  = entries.filter(e => e.sentiment === 'neutral').length;
      const negative = entries.filter(e => e.sentiment === 'negative').length;
      const avgScore = entries.reduce((sum, e) => sum + e.score, 0) / entries.length;

      let dominantMood = 'neutral';
      if (positive >= neutral && positive >= negative) dominantMood = 'positive';
      else if (negative >= neutral && negative >= positive) dominantMood = 'negative';

      summary[speaker] = {
        total: entries.length,
        positive: Math.round((positive / entries.length) * 100),
        neutral:  Math.round((neutral  / entries.length) * 100),
        negative: Math.round((negative / entries.length) * 100),
        avgScore: Math.round(avgScore * 100) / 100,
        dominantMood,
      };
    }
    return summary;
  }
}

// 사용 예
const sentimentStats = new SpeakerSentimentStats();

await gw.pipeline()
  .stt(new DeepgramAdapter({
    apiKey: process.env.DEEPGRAM_API_KEY!,
    language: 'ko', model: 'nova-3',
    diarize: true, sentiment: true,
  }))
  .forConference()
  .onTranscript(async (result, session) => {
    if (!result.isFinal || !result.sentiment) return;

    const speaker = result.speaker ?? session.linkedId;
    sentimentStats.add(speaker, result.sentiment.sentiment, result.sentiment.sentimentScore);
  })
  .start();

// 회의 종료 시
process.on('SIGTERM', () => {
  console.log('\n=== 화자별 감정 통계 ===');
  const summary = sentimentStats.getSummary();
  for (const [speaker, stats] of Object.entries(summary)) {
    console.log(
      `${speaker}: 😊${stats.positive}% 😐${stats.neutral}% 😟${stats.negative}% ` +
      `(평균 점수: ${stats.avgScore}, 주요 분위기: ${stats.dominantMood})`
    );
  }
});
```

**Python:**

```python
from collections import defaultdict

class SpeakerSentimentStats:
    def __init__(self):
        self._stats: dict[str, list[dict]] = defaultdict(list)

    def add(self, speaker: str, sentiment: str, score: float) -> None:
        self._stats[speaker].append({"sentiment": sentiment, "score": score})

    def get_summary(self) -> dict:
        summary = {}
        for speaker, entries in self._stats.items():
            total = len(entries)
            positive = sum(1 for e in entries if e["sentiment"] == "positive")
            neutral  = sum(1 for e in entries if e["sentiment"] == "neutral")
            negative = sum(1 for e in entries if e["sentiment"] == "negative")
            avg_score = sum(e["score"] for e in entries) / total

            dominant = max(
                [("positive", positive), ("neutral", neutral), ("negative", negative)],
                key=lambda x: x[1],
            )[0]

            summary[speaker] = {
                "total": total,
                "positive": round(positive / total * 100),
                "neutral": round(neutral / total * 100),
                "negative": round(negative / total * 100),
                "avg_score": round(avg_score, 2),
                "dominant_mood": dominant,
            }
        return summary

# 사용 예
stats = SpeakerSentimentStats()

async def on_transcript(result, session):
    if not result.is_final or not result.sentiment:
        return
    speaker = result.speaker or session.linked_id
    stats.add(speaker, result.sentiment.sentiment, result.sentiment.sentiment_score)

# 회의 종료 시
summary = stats.get_summary()
for speaker, s in summary.items():
    print(f"{speaker}: 😊{s['positive']}% 😐{s['neutral']}% 😟{s['negative']}% "
          f"(avg: {s['avg_score']}, mood: {s['dominant_mood']})")
```

---

### Sentiment 응용 사례

#### 1. 고객 상담 품질 모니터링

실시간 감정 분석으로 **불만 고객 통화**를 자동 감지하여 상위 관리자에게 알림을 보냅니다.

```typescript
.onTranscript(async (result, session) => {
  if (!result.isFinal || !result.sentiment) return;

  // 부정 감정이 연속 3회 이상 감지되면 알림
  if (result.sentiment.sentiment === 'negative' && result.sentiment.sentimentScore > 0.7) {
    negativeCount++;
    if (negativeCount >= 3) {
      await sendAlert({
        type: 'negative_sentiment',
        linkedId: session.linkedId,
        caller: session.caller,
        message: '고객 불만 감지 — 관리자 개입 필요',
      });
    }
  } else {
    negativeCount = 0;
  }
})
```

#### 2. 교육·세미나 참여도 분석

온라인 강의에서 학습자의 **반응(긍정/부정)** 을 실시간으로 추적합니다.

```
강사 발언 → 학습자 반응 자동 집계:
  "이해했습니다" → positive (0.89)
  "잘 모르겠어요" → negative (0.72)
  "네" → neutral (0.51)
────────────────────────────────
실시간 참여도 대시보드: 😊 65% | 😐 25% | 😟 10%
```

#### 3. 면접·채용 인터뷰 분석

면접 후 지원자의 발화 감정 흐름을 리포트로 생성합니다.

```
시간대별 감정 변화:
  09:00–09:10 자기소개  → 😊 positive (자신감)
  09:10–09:20 기술 질문 → 😐 neutral  (신중한 답변)
  09:20–09:30 압박 질문 → 😟 negative (긴장)
  09:30–09:35 마무리    → 😊 positive (회복)
```

#### 4. 의료 상담 감정 추적

원격 진료에서 환자의 심리 상태를 자동으로 기록합니다.

| 시간 | 환자 발화 | 감정 | 점수 |
|------|---------|------|------|
| 14:01 | "최근에 잠을 잘 못 자요" | negative | 0.82 |
| 14:03 | "약을 먹으면 좀 나아져요" | positive | 0.67 |
| 14:05 | "그런데 부작용이 걱정돼요" | negative | 0.75 |

---

## 16. STT·TTS API 비용 절감 — 캐시 및 최적화 전략

운영 환경에서 STT·TTS API 비용은 통화량에 비례하여 빠르게 증가합니다.
아래 전략을 조합하면 **TTS 비용을 50~90%**, **STT 비용을 20~40%** 절감할 수 있습니다.

---

### TTS 캐시 어댑터 (CachedTtsAdapter)

`CachedTtsAdapter`는 기존 TTS 어댑터를 감싸서 **디스크 기반 PCM 캐시**를 제공합니다.
동일한 `(텍스트 + 화자 + 프로바이더 + 모델 + 속도)` 조합은 최초 1회만 API를 호출하고,
이후에는 캐시된 PCM 파일에서 즉시 반환합니다. **서버 재시작/업데이트 후에도 캐시가 유지됩니다.**

#### 핵심 원리

```
요청: synthesize("안녕하세요", voiceId="abc")
        ↓
  캐시 키 생성: SHA-256("elevenlabs|model|abc|1.0|안녕하세요")
        ↓
  ┌─ 캐시 HIT → 디스크에서 PCM 읽기 (0ms, API 비용 $0)
  └─ 캐시 MISS → API 호출 → PCM 저장 → 다음부터 HIT
```

#### Node.js 사용법

```typescript
import { ElevenLabsAdapter, CachedTtsAdapter } from 'dvgateway-adapters';

// 1. 기본 TTS 어댑터 생성
const baseTts = new ElevenLabsAdapter({
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: '21m00Tcm4TlvDq8ikWAM',  // Rachel
  model: 'eleven_flash_v2_5',
});

// 2. CachedTtsAdapter로 감싸기
const tts = new CachedTtsAdapter(baseTts, {
  provider:       'elevenlabs',          // 캐시 키에 포함
  cacheDir:       './tts-cache',         // 캐시 디렉토리 (재시작 후에도 유지)
  defaultVoiceId: '21m00Tcm4TlvDq8ikWAM',
  defaultModel:   'eleven_flash_v2_5',
  ttlMs:          7 * 24 * 60 * 60 * 1000, // 7일 후 자동 만료 (0=무제한)
  maxEntries:     500,                     // 최대 500개 (LRU 방식 자동 삭제)
});

// 3. 파이프라인에서 그대로 사용 (TtsAdapter 인터페이스 호환)
await gw.pipeline()
  .stt(stt)
  .llm(llm)
  .tts(tts)   // ← CachedTtsAdapter를 직접 전달
  .start();

// 4. say() / broadcastSay() 에서도 동일하게 사용
await gw.say(linkedId, '안녕하세요', tts);              // 캐시 히트 시 API 무호출
await gw.broadcastSay(confId, '회의를 시작합니다.', tts); // 컨퍼런스 방송
```

#### Python 사용법

```python
from dvgateway.adapters.tts import ElevenLabsAdapter, CachedTtsAdapter

# 1. 기본 TTS 어댑터 생성
base_tts = ElevenLabsAdapter(
    api_key=os.environ["ELEVENLABS_API_KEY"],
    voice_id="21m00Tcm4TlvDq8ikWAM",
    model="eleven_flash_v2_5",
)

# 2. CachedTtsAdapter로 감싸기
tts = CachedTtsAdapter(
    base_tts,
    provider="elevenlabs",
    cache_dir="./tts-cache",
    default_voice_id="21m00Tcm4TlvDq8ikWAM",
    default_model="eleven_flash_v2_5",
    ttl_ms=7 * 24 * 60 * 60 * 1000,  # 7일
    max_entries=500,
)

# 3. 파이프라인에서 사용
await (
    gw.pipeline()
    .stt(stt)
    .llm(llm)
    .tts(tts)
    .start()
)

# 4. say() / broadcast_say()에서 사용
await gw.say(linked_id, "안녕하세요", tts)
await gw.broadcast_say(conf_id, "회의를 시작합니다.", tts)
```

#### 캐시 옵션 상세

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `provider` | string | (필수) | 프로바이더 이름 (`"elevenlabs"`, `"openai"` 등). 캐시 키에 포함 |
| `cacheDir` / `cache_dir` | string | `"./tts-cache"` | 캐시 디렉토리 경로. 없으면 자동 생성 |
| `defaultVoiceId` / `default_voice_id` | string | `"default"` | 기본 화자 ID |
| `defaultModel` / `default_model` | string | `"default"` | 기본 모델명 |
| `ttlMs` / `ttl_ms` | number | `0` (무제한) | 캐시 만료 시간 (밀리초). 만료된 파일은 자동 삭제 |
| `maxEntries` / `max_entries` | number | `0` (무제한) | 최대 캐시 항목 수. 초과 시 가장 오래된 항목부터 LRU 삭제 |

#### 캐시 관리 API

```typescript
// 캐시 통계 확인
const stats = tts.getStats();
console.log(`히트: ${stats.hits}, 미스: ${stats.misses}`);

// 특정 텍스트가 캐시에 있는지 확인
const cached = await tts.isCached('안녕하세요');

// 캐시 전체 삭제
const removed = await tts.clearCache();
```

```python
# Python
stats = tts.get_stats()
print(f"히트: {stats.hits}, 미스: {stats.misses}")

cached = await tts.is_cached("안녕하세요")
removed = await tts.clear_cache()
```

---

### 안내 멘트 음원 풀 사전 생성 (warmup)

`warmup()` 메서드를 사용하면 서버 시작 시 자주 사용하는 안내 멘트를 **미리 합성하여 캐시에 저장**합니다.
이미 캐시에 있는 항목은 건너뛰므로 재시작 후에도 불필요한 API 호출이 발생하지 않습니다.

#### Node.js

```typescript
// 서버 시작 시 실행
const ANNOUNCEMENTS = [
  { text: '안녕하세요. OLSSOO 고객센터에 전화해 주셔서 감사합니다.' },
  { text: '잠시만 기다려 주세요. 상담사에게 연결하겠습니다.' },
  { text: '현재 상담 대기 중입니다. 잠시만 기다려 주세요.' },
  { text: '통화가 종료되었습니다. 이용해 주셔서 감사합니다.' },
  { text: '업무 시간이 종료되었습니다.' },
  { text: '본 통화는 서비스 품질 향상을 위해 녹음됩니다.' },
];

// warmup() — 캐시에 없는 항목만 API 호출
const newCount = await tts.warmup(ANNOUNCEMENTS);
console.log(`${newCount}개 새로 생성, ${ANNOUNCEMENTS.length - newCount}개 캐시 히트`);
// 재시작 후: "0개 새로 생성, 6개 캐시 히트" → API 비용 $0
```

#### Python

```python
ANNOUNCEMENTS = [
    {"text": "안녕하세요. OLSSOO 고객센터입니다."},
    {"text": "잠시만 기다려 주세요."},
    {"text": "상담사에게 연결하겠습니다."},
]

new_count = await tts.warmup(ANNOUNCEMENTS)
print(f"{new_count}개 새로 생성")
```

#### warmup 항목에 화자·속도 지정

```typescript
const ANNOUNCEMENTS = [
  { text: '안녕하세요.', voiceId: 'voice-ko-female' },
  { text: 'Hello.', voiceId: 'voice-en-male', speed: 0.9 },
];
await tts.warmup(ANNOUNCEMENTS);
```

#### 운영 시나리오 예시

```
[최초 배포]
  warmup() → 7개 멘트 API 호출 → 캐시 저장
  비용: ElevenLabs 7건 호출 ≈ $0.01

[업데이트 후 재시작]
  warmup() → 7개 모두 캐시 히트 → API 호출 0건
  비용: $0

[하루 1,000콜 × 안내 멘트 3회 = 3,000건]
  캐시 미사용: 3,000 API 호출 ≈ $45/일
  캐시 사용:   0 API 호출     = $0/일
  월 절감:     ≈ $1,350
```

---

### STT 비용 최적화 — VAD 필터링

STT API는 **전송한 오디오 시간**에 비례하여 과금됩니다.
침묵 구간을 STT로 보내지 않으면 비용을 크게 줄일 수 있습니다.

#### 방법 1: DVGateway 내장 VAD 필터

파이프라인에 `audioFilter`를 설정하면 DVGateway가 자동으로 침묵 구간을 필터링합니다.

```typescript
await gw.pipeline()
  .stt(stt)
  .llm(llm)
  .tts(tts)
  .audioFilter({ dir: 'in' })  // 인바운드(고객 음성)만 STT로 전송
  .start();
```

#### 방법 2: Deepgram 엔드포인팅 최적화

`endpointingMs` 값을 줄이면 발화 끝을 더 빨리 감지하여 불필요한 침묵 전송을 줄입니다.

```typescript
const stt = new DeepgramAdapter({
  apiKey:        process.env.DEEPGRAM_API_KEY!,
  language:      'ko',
  model:         'nova-3',
  endpointingMs: 300,       // 300ms 침묵 시 발화 종료 감지 (기본: 500ms)
  smartFormat:   true,      // 자동 구두점 (추가 비용 없음)
});
```

#### 방법 3: 로컬 STT 사용 (API 비용 $0)

완전 무료로 STT를 사용하려면 로컬 Whisper 모델을 연동합니다.
실시간 처리를 위해서는 GPU 서버가 필요합니다.

| 로컬 STT | 지연시간 | GPU 필요 | 한국어 품질 |
|----------|---------|----------|-----------|
| whisper.cpp | ~500ms | 권장 | 양호 |
| Faster-Whisper | ~300ms | 필수 | 우수 |
| OpenAI Whisper (공식) | ~800ms | 필수 | 우수 |

자세한 설정은 [10. 어댑터별 상세 설정](#10-어댑터별-상세-설정)의 로컬 STT 섹션을 참고하세요.

---

### 프로바이더별 비용 비교표

#### TTS 비용 (1,000자 기준, 2026-03)

| 프로바이더 | 모델 | 1,000자 비용 | 지연시간 | 한국어 |
|-----------|------|-------------|---------|-------|
| ElevenLabs | eleven_flash_v2_5 | ~$0.15 | ~75ms | O |
| ElevenLabs | eleven_multilingual_v2 | ~$0.18 | ~300ms | O |
| OpenAI | tts-1 | ~$0.015 | ~200ms | O |
| OpenAI | tts-1-hd | ~$0.030 | ~400ms | O |
| OpenAI | gpt-4o-mini-tts | ~$0.010 | ~150ms | O |
| Google Cloud TTS | Neural2 | ~$0.016 | ~200ms | O |

> **비용 팁**: 안내 멘트처럼 반복 텍스트가 많은 경우 ElevenLabs + CachedTtsAdapter 조합이
> 고품질 음성을 유지하면서 비용을 거의 $0으로 줄일 수 있습니다.

#### STT 비용 (분당, 2026-03)

| 프로바이더 | 모델 | 분당 비용 | 실시간 | 한국어 |
|-----------|------|----------|-------|-------|
| Deepgram | nova-3 | ~$0.0043 | O | O |
| Deepgram | nova-2 | ~$0.0036 | O | O |
| Google Cloud STT | chirp_2 | ~$0.016 | O | O |
| OpenAI | whisper-1 (API) | ~$0.006 | X (배치) | O |
| 로컬 Whisper | large-v3 | $0 (GPU 비용만) | 조건부 | O |

---

### 비용 최적화 체크리스트

프로덕션 배포 전에 아래 항목을 확인하세요:

- [ ] **TTS 캐시 활성화** — 반복 안내 멘트에 `CachedTtsAdapter` 적용
- [ ] **warmup() 호출** — 서버 시작 스크립트에 `tts.warmup()` 추가
- [ ] **TTL 설정** — 캐시 만료 기간 설정 (음성 스타일 변경 시 갱신)
- [ ] **audioFilter 설정** — 인바운드(`'in'`)만 STT로 전송 (아웃바운드 AI 음성은 불필요)
- [ ] **endpointingMs 최적화** — 300~400ms로 설정하여 침묵 전송 최소화
- [ ] **저비용 LLM 선택** — 단순 안내: `claude-haiku` / `gpt-4o-mini`
- [ ] **캐시 통계 모니터링** — `tts.getStats()`로 히트율 확인 (목표: >80%)
- [ ] **로컬 STT 검토** — GPU 서버가 있다면 Faster-Whisper로 STT 비용 $0 달성

---

## 17. 자주 묻는 질문 (FAQ)

**Q: 한국어와 영어가 섞인 통화(코드 스위칭)는 어떻게 처리하나요?**
A: Deepgram의 `language: 'multi'` 또는 `language: 'ko'`를 사용하세요. Nova-3 모델은 한국어+영어 혼용을 잘 처리합니다.

**Q: 통화 중 AI 음성을 중단시킬 수 있나요?**
A: OpenAI Realtime 어댑터를 사용하는 경우 서버 VAD가 자동으로 처리합니다. 카스케이드 파이프라인에서는 `gw.stopTtsInjection(linkedId)`를 호출하세요.

**Q: API 키 비용이 걱정됩니다.**
A: [16. STT·TTS API 비용 절감](#16-stttts-api-비용-절감--캐시-및-최적화-전략) 섹션을 참고하세요. 주요 전략:
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

## 18. 문제 해결

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

## 19. 원라인 서버 업데이트

```bash
# 대시보드 UI에서 업데이트 버튼 클릭
# 또는 터미널에서:
curl -fsSL https://github.com/OLSSOO-Inc/dvgateway-releases/releases/latest/download/install.sh | sudo bash
```

업데이트는 서비스 무중단으로 진행됩니다 (zero-downtime rolling update).

---

---

## 20. 진짜 초보자용 메뉴얼 — Node.js·Python 설치부터 봇 실행까지

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
| **Anthropic Claude** (AI 대화) | https://console.anthropic.com | 소액 유료 |

가입 후 각 사이트의 "API Keys" 메뉴에서 키를 발급받으세요.

**게이트웨이 API 키**는 위 AI 서비스와는 별개입니다.
DVGateway 서버 설치 시 자동으로 생성되며, 아래 방법으로 확인합니다:

```bash
# DVGateway 서버에서 API 키 확인
sudo cat /etc/dvgateway/api-key

# 또는 대시보드(http://서버IP:8081) → 설정 → API Keys 에서 확인
```

`.env` 파일 만들기:

```bash
# my-voice-bot 폴더 안에 .env 파일 생성
# Windows: 메모장으로 .env 파일 만들기
# Mac/Linux: 아래 명령어 실행
cat > .env << 'EOF'
DEEPGRAM_API_KEY=여기에_Deepgram_키_붙여넣기
ELEVENLABS_API_KEY=여기에_ElevenLabs_키_붙여넣기
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
> - 게이트웨이 API 키는 DVGateway **서버에서 발급받은 키**이며, Deepgram/Anthropic 등 AI 서비스 키와는 다릅니다

---

#### A-6. 첫 번째 봇 코드 작성

`bot.js` 파일을 만들고 아래 내용을 붙여넣으세요:

```javascript
// bot.js — 가장 간단한 AI 음성 봇
import 'dotenv/config';  // .env 파일 읽기

import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { AnthropicAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

async function main() {
  // ── 0. API 키가 제대로 로드됐는지 확인 ──────────────────────
  const requiredKeys = ['DV_API_KEY', 'DEEPGRAM_API_KEY', 'ANTHROPIC_API_KEY', 'ELEVENLABS_API_KEY'];
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

  const llm = new AnthropicAdapter({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: 'claude-haiku-4-5-20251001',  // 가장 빠른 모델
    systemPrompt: '당신은 친절한 한국어 AI 안내원입니다. 짧고 명확하게 답변하세요.',
  });

  const tts = new ElevenLabsAdapter({
    apiKey: process.env.ELEVENLABS_API_KEY,
    model: 'eleven_flash_v2_5',   // 가장 빠른 음성 합성
    voiceId: '21m00Tcm4TlvDq8ikWAM',  // Rachel 음성 (무료)
  });

  // 3. 파이프라인 시작
  console.log('봇을 시작합니다...');

  await gw.pipeline()
    .stt(stt)
    .llm(llm)
    .tts(tts)
    .onNewCall((session) => {
      console.log('📞 전화가 왔어요! ID:', session.linkedId);
    })
    .onTranscript((result) => {
      if (result.isFinal) {
        console.log('🎙️  고객이 말했어요:', result.text);
      }
    })
    .onCallEnded((id, duration) => {
      console.log(`📴 통화 종료. 통화 시간: ${duration}초`);
    })
    .onError((err) => {
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

> **게이트웨이 API 키**는 DVGateway 서버 설치 시 자동 생성됩니다.
> `sudo cat /etc/dvgateway/api-key` 또는 대시보드(http://서버IP:8081) → 설정 → API Keys 에서 확인하세요.

```ini
DEEPGRAM_API_KEY=여기에_Deepgram_키_붙여넣기
ELEVENLABS_API_KEY=여기에_ElevenLabs_키_붙여넣기
ANTHROPIC_API_KEY=여기에_Anthropic_키_붙여넣기
DV_API_KEY=여기에_게이트웨이_API_키_붙여넣기
```

> ⚠️ **흔한 실수 체크리스트:**
> - `여기에_..._붙여넣기` 같은 플레이스홀더를 실제 키로 바꿨나요?
> - 키 앞뒤에 **따옴표(`"`)나 공백**이 들어가지 않았나요? (`.env` 파일에는 따옴표 없이 값만 넣으세요)
> - `.env` 파일이 `bot.py`와 **같은 폴더**에 있나요?
> - 게이트웨이 API 키는 DVGateway **서버에서 발급받은 키**이며, Deepgram/Anthropic 등 AI 서비스 키와는 다릅니다
>
> 키가 올바른지 확인하는 방법:
> ```bash
> # .env 파일 내용 확인 (키 일부만 표시)
> cat .env
> # DV_API_KEY=dv_live_abc123... 처럼 실제 값이 보여야 합니다
> ```

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
from dvgateway.adapters.llm import AnthropicAdapter
from dvgateway.adapters.tts import ElevenLabsAdapter

# .env 파일에서 API 키 읽기
load_dotenv()

async def main():
    # ── 0. API 키가 제대로 로드됐는지 확인 ──────────────────────
    required_keys = ["DV_API_KEY", "DEEPGRAM_API_KEY", "ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY"]
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

    llm = AnthropicAdapter(
        api_key=os.environ["ANTHROPIC_API_KEY"],
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
        print(f"📞 전화가 왔어요! ID: {session.linked_id}")

    def on_transcript(result):
        if result.is_final:
            print(f"🎙️  고객이 말했어요: {result.text}")

    def on_call_ended(linked_id, duration):
        print(f"📴 통화 종료. 통화 시간: {duration}초")

    def on_error(err):
        print(f"❌ 오류 발생: {err}")

    # 4. 파이프라인 시작
    print("봇을 시작합니다...")

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
| 다중 사용자 서비스 만들기 | [섹션 13](#13-멀티테넌트-지원) |
| 문제가 생겼을 때 | [섹션 16](#16-문제-해결) |

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
