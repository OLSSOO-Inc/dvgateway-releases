# Dynamic VoIP Real-Time Media Gateway

> **최신 버전: 1.2.0.2**

AI 연동을 위한 고성능 실시간 VoIP 미디어 게이트웨이입니다.
Dynamic VoIP의 통화 오디오를 실시간으로 스트리밍 해서 AI 서비스(STT·LLM·TTS)에 활용합니다.

---

## 원라인 설치

```bash
curl -fsSL https://github.com/OLSSOO-Inc/dvgateway-releases/releases/latest/download/install.sh | sudo bash
```

> **지원 환경:** Debian 12/13 · Ubuntu 22.04+ · amd64 / arm64

---

## 수동 설치

### .deb 패키지 (권장, Debian/Ubuntu)

```bash
# 최신 릴리즈 다운로드
wget https://github.com/OLSSOO-Inc/dvgateway-releases/releases/latest/download/dvgateway_1.2.0.2_amd64.deb

# 설치
sudo dpkg -i dvgateway_1.2.0.2_amd64.deb

# 설정 편집 (AMI 비밀번호 등)
sudo nano /etc/dvgateway/env

# 서비스 시작
sudo systemctl restart dvgateway
```

### 바이너리 직접 설치

```bash
# amd64
sudo curl -fsSL \
  https://github.com/OLSSOO-Inc/dvgateway-releases/releases/latest/download/dvgateway_linux_amd64 \
  -o /usr/bin/dvgateway
sudo chmod +x /usr/bin/dvgateway

# arm64
sudo curl -fsSL \
  https://github.com/OLSSOO-Inc/dvgateway-releases/releases/latest/download/dvgateway_linux_arm64 \
  -o /usr/bin/dvgateway
sudo chmod +x /usr/bin/dvgateway
```

---

## 업그레이드

대시보드(`:8081`) → **업데이트 확인** 버튼으로 원클릭 업그레이드 가능합니다.

또는 터미널에서:

```bash
sudo /usr/local/bin/dvgateway-update.sh
```

---

## 주요 기능

| 기능 | 설명 |
|------|------|
| 실시간 오디오 스트리밍 | Dynamic VoIP ExternalMedia → AI 서비스로 PCM 16kHz 스트림 전달 |
| AI 파이프라인 연동 | Deepgram·Whisper·Google STT / Anthropic·OpenAI / ElevenLabs·Polly |
| TTS 오디오 주입 | REST API로 AI 응답 오디오를 통화에 실시간 삽입 |
| 컨퍼런스 지원 | ConfBridge 다자통화 참여자별 독립 스트림 + 의사록 자동 생성 |
| 모니터링 대시보드 | 포트 8081에서 실시간 세션·VU미터·로그 확인 |
| 라이선스 관리 | 동시 통화 수 제한, 대시보드에서 라이선스 등록 가능 |

---

## 포트

| 포트 | 방향 | 용도 |
|------|------|------|
| **8088** | Dynamic VoIP → GW | ExternalMedia WebSocket (오디오 입력) |
| **8080** | GW ↔ AI 서비스 | REST API + 다운스트림 WebSocket |
| **8081** | 브라우저 → GW | 실시간 모니터링 대시보드 |

---

## 설정 파일

설치 후 `/etc/dvgateway/env` 를 편집합니다:

```env
# Asterisk AMI 연결
AMI_HOST=127.0.0.1
AMI_PORT=5038
AMI_USERNAME=dvgateway
AMI_SECRET=your-secret-here

# ARI (Stasis 방식)
ARI_ENABLED=true
ARI_USER=dvgateway
ARI_PASS=your-ari-password

# 오디오 포맷 (slin16 권장)
GW_AUDIO_FORMAT=slin16

# 대시보드 비밀번호 (선택)
DASHBOARD_PASSWORD=
```

전체 변수 목록: [`/etc/dvgateway/env`](https://github.com/OLSSOO-Inc/AI-Ready-Real-Time-Voice-Media-Gateway/blob/master/go-gateway/dynamic-voip-gateway.service)

---

## 빠른 확인

```bash
# 서비스 상태
systemctl status dvgateway

# 실시간 로그
journalctl -u dvgateway -f

# 대시보드 접속
open http://<서버IP>:8081
```

---

## 다운로드

| 파일 | 설명 |
|------|------|
| `dvgateway_linux_amd64` | Linux x86_64 바이너리 |
| `dvgateway_linux_arm64` | Linux ARM64 바이너리 |
| `dvgateway_1.2.0.2_amd64.deb` | Debian/Ubuntu .deb 패키지 |

---

- [Asterisk 다이얼플랜 설정](https://github.com/OLSSOO-Inc/AI-Ready-Real-Time-Voice-Media-Gateway/blob/master/go-gateway/docs/asterisk-dialplan.md)
- [Speech-to-Speech 파이프라인](https://github.com/OLSSOO-Inc/AI-Ready-Real-Time-Voice-Media-Gateway/blob/master/go-gateway/docs/speech-to-speech-guide.md)
