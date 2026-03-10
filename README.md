# Dynamic VoIP Real-Time Media Gateway

> **최신 버전: 1.2.5.4**

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
| AI 파이프라인 연동 (SDK 제공 예정) | Deepgram · Whisper · Google STT / Anthropic · OpenAI / ElevenLabs · Polly |
| TTS 오디오 주입 | REST API로 AI 응답 오디오를 통화에 실시간 삽입 |
| 컨퍼런스 지원 | 다자통화 참여자별 독립 스트림 + 스트리밍 지원 |
| 모니터링 대시보드 | 포트 8081에서 실시간 세션·VU미터·로그 확인 |
| 원클릭 업데이트 | 대시보드에서 최신 버전으로 즉시 업그레이드 |

## AI 연동 API 요약


### 오디오 스트림 수신 (STT 입력)

```
WS  ws://{gateway}:8080/api/v1/ws/stream?linkedid={linkedId}&dir=both
    → 16kHz, 16-bit PCM 바이너리 프레임 수신
```

### TTS 주입 (AI 응답 재생)

```
# 1:1 통화
POST http://{gateway}:8080/api/v1/tts/{linkedId}
Body: raw 16kHz 16-bit PCM

# 음성회의 전체 참여자에게 공지
POST http://{gateway}:8080/api/v1/tts/conf/{confId}
Body: raw 16kHz 16-bit PCM
```

### 통화 이벤트 구독

```
WS  ws://{gateway}:8080/api/v1/ws/callinfo
    → {"event":"call:new","linkedId":"...","streamUrl":"..."}
```

---

## 라이선스

© OLSSOO Inc. All rights reserved.
