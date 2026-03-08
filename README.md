# Dynamic VoIP Real-Time Media Gateway

> **최신 버전: 1.2.2.0**

Dynamic VoIP 통화 오디오를 AI 서비스(STT·LLM·TTS)에 실시간으로 연결하는 고성능 미디어 게이트웨이입니다.

---

## 원라인 설치

```bash
curl -fsSL https://github.com/OLSSOO-Inc/dvgateway-releases/releases/latest/download/install.sh | sudo bash
```

> **지원 환경:** Debian 12/13 · Ubuntu 22.04+ · amd64 / arm64

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 실시간 오디오 스트리밍 | Dynamic VoIP 통화 오디오를 AI 서비스로 PCM 16kHz 스트림 전달 |
| AI 파이프라인 연동 | Deepgram · Whisper · Google STT / Anthropic · OpenAI / ElevenLabs · Polly |
| TTS 오디오 주입 | REST API로 AI 응답 오디오를 통화에 실시간 삽입 |
| 컨퍼런스 지원 | 다자통화 참여자별 독립 스트림 + 의사록 자동 생성 |
| 모니터링 대시보드 | 포트 8081에서 실시간 세션·VU미터·로그 확인 |
| 원클릭 업데이트 | 대시보드에서 최신 버전으로 즉시 업그레이드 |
