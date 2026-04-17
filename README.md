# DVGateway SDK — 사용 가이드

> **최신 버전: 1.3.8.7** | 업데이트: 2026-03-24

**DVGateway SDK**는 AI 음성 서비스(STT·LLM·TTS)를 실시간 전화 통화에 연결하는 라이브러리입니다.
**Node.js**와 **Python** 두 가지 언어를 지원하며, 개발자가 아니더라도 이 문서의 예제를 따라 하면 AI 음성 봇을 구축할 수 있습니다.

---

## 📖 문서 목차

| # | 문서 | 내용 |
|---|------|------|
| 01 | [시작하기](01-getting-started.md) | 시스템 요구사항, 서버 설치, SDK 설치, API 키 준비, 헬로 월드 봇 |
| 02 | [AI 서비스 목록](02-ai-services.md) | 연동 가능한 STT·TTS·LLM 서비스 전체 목록, 한국 환경 추천 조합 |
| 03 | [파이프라인 패턴](03-pipeline-patterns.md) | 일반 통화(STT→LLM→TTS), OpenAI 리얼타임, 컨퍼런스 회의록 |
| 04 | [어댑터 상세 설정](04-adapter-reference.md) | Deepgram, ElevenLabs, Claude, GPT, OpenAI TTS, 로컬 STT/LLM 등 |
| 05 | [이벤트 후킹 + 폴백](05-events-fallback.md) | 통화 시작/종료/발화 이벤트, 장애 자동 전환 |
| 06 | [모니터링 + 감정 분석](06-monitoring-sentiment.md) | 대시보드, Deepgram Sentiment, 화자별 감정 통계 |
| 07 | [비용 절감](07-cost-optimization.md) | TTS 캐시, VAD 필터링, 프로바이더별 비용 비교 |
| 08 | [Comfort Noise](08-comfort-noise.md) | AI 처리 중 무음 방지 (자동/수동, 커스텀 배경음) |
| 09 | [파이프라인 훅 + Webhook](09-hooks-webhook.md) | RAG 컨텍스트 주입, DB 연동, n8n/Flowise Webhook 어댑터 |
| 10 | [FAQ + 문제 해결](10-faq-troubleshooting.md) | 자주 묻는 질문, 트러블슈팅, 서버 업데이트, 초보자 가이드 |
| 11 | [PBX 관리 + 캠페인](11-pbx-management.md) | 착신전환, 발신자표시, 클릭투콜, 아웃바운드 캠페인, 이벤트 모니터링 |
| 12 | [통화 음질 문제 분석 (TTS+STT)](12-tts-audio-troubleshooting.md) | TTS/STT 증상 분류, 로그 분석, SDK 점검, 환경변수, 에스컬레이션 기준 |

---

## 📁 예제 코드

`examples/` 폴더에 바로 실행 가능한 예제가 포함되어 있습니다.

### TypeScript 예제

| 파일 | 설명 | 관련 문서 |
|------|------|-----------|
| [01-basic-voice-bot.ts](examples/typescript/01-basic-voice-bot.ts) | 기본 AI 음성 봇 (Deepgram + Claude + ElevenLabs) | [시작하기](01-getting-started.md) |
| [02-conference-transcription.ts](examples/typescript/02-conference-transcription.ts) | 컨퍼런스 자동 회의록 | [파이프라인 패턴](03-pipeline-patterns.md) |
| [03-advanced-mid-level-api.ts](examples/typescript/03-advanced-mid-level-api.ts) | Mid-Level API 직접 사용 | [어댑터 설정](04-adapter-reference.md) |
| [04-fallback-resilience.ts](examples/typescript/04-fallback-resilience.ts) | Fallback 체인 + 자동 복구 | [이벤트 + 폴백](05-events-fallback.md) |
| [05-cached-tts-announcements.ts](examples/typescript/05-cached-tts-announcements.ts) | TTS 캐시 안내 멘트 | [비용 절감](07-cost-optimization.md) |
| [06-text-input-tts.ts](examples/typescript/06-text-input-tts.ts) | 터미널 텍스트 → TTS 재생 | [어댑터 설정](04-adapter-reference.md) |
| [07-pipeline-hooks-rag.ts](examples/typescript/07-pipeline-hooks-rag.ts) | RAG + CRM API + DB 저장 (훅) | [훅 + Webhook](09-hooks-webhook.md) |
| [08-webhook-n8n-integration.ts](examples/typescript/08-webhook-n8n-integration.ts) | n8n Webhook 연동 + Fallback | [훅 + Webhook](09-hooks-webhook.md) |

### Python 예제

| 파일 | 설명 | 관련 문서 |
|------|------|-----------|
| [01_basic_voice_bot.py](examples/python/01_basic_voice_bot.py) | 기본 AI 음성 봇 | [시작하기](01-getting-started.md) |
| [02_conference_transcription.py](examples/python/02_conference_transcription.py) | 컨퍼런스 자동 회의록 | [파이프라인 패턴](03-pipeline-patterns.md) |
| [03_advanced_mid_level_api.py](examples/python/03_advanced_mid_level_api.py) | Mid-Level API 직접 사용 | [어댑터 설정](04-adapter-reference.md) |
| [04_enhanced_voice_bot.py](examples/python/04_enhanced_voice_bot.py) | 감정 분석 포함 음성 봇 | [감정 분석](06-monitoring-sentiment.md) |
| [05_happycall_bot.py](examples/python/05_happycall_bot.py) | 해피콜 자동 발신 봇 | [파이프라인 패턴](03-pipeline-patterns.md) |
| [06_pipeline_hooks_rag.py](examples/python/06_pipeline_hooks_rag.py) | RAG + CRM API + DB 저장 (훅) | [훅 + Webhook](09-hooks-webhook.md) |
| [07_webhook_integration.py](examples/python/07_webhook_integration.py) | Webhook 연동 + Fallback | [훅 + Webhook](09-hooks-webhook.md) |

### 빠른 시작

```bash
# 1. .env 파일 복사 후 API 키 입력
cp examples/.env.example .env

# 2. TypeScript 예제 실행
npm install dvgateway-sdk dvgateway-adapters
npx ts-node examples/typescript/01-basic-voice-bot.ts

# 3. Python 예제 실행
pip install "dvgateway[adapters]" python-dotenv
python examples/python/01_basic_voice_bot.py
```

---

## 🔗 관련 링크

- [GitHub Releases](https://github.com/OLSSOO-Inc/dvgateway-releases/releases) — 최신 바이너리 다운로드

---

_Last updated: 2026-03-24_
