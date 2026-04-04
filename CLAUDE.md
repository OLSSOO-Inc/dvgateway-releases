# CLAUDE.md — DVGateway SDK 사용자 가이드

이 파일은 AI 코딩 어시스턴트(Claude, Copilot 등)가 DVGateway SDK를 사용하는 프로젝트에서 작업할 때 참조하는 가이드입니다.

---

## SDK 개요

**DVGateway SDK**는 Dynamic VoIP PBX의 실시간 통화를 AI 파이프라인(STT·LLM·TTS)에 연결하는 라이브러리입니다.

| 언어 | 패키지 | 설치 |
|------|--------|------|
| TypeScript | `dvgateway-sdk` + `dvgateway-adapters` | `npm install dvgateway-sdk dvgateway-adapters` |
| Python | `dvgateway-python` | `pip install dvgateway-python` |

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

## 전체 SDK 메서드 레퍼런스

### 통화 제어
| TypeScript | Python | 설명 |
|------------|--------|------|
| `hangup(linkedId)` | `hangup(linked_id)` | 통화 종료 |
| `redirect(linkedId, dest)` | `redirect(linked_id, dest)` | 통화 전환 |

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
| `getEarlyMedia(ext, tenantId?)` | `get_early_media(ext, tenant_id)` | Early Media 설정 조회 |
| `setEarlyMedia(ext, {enabled,audioUrl})` | `set_early_media(ext, enabled, audio_url)` | Early Media 설정/변경 |

> `audioUrl` 설정 시 자동 다운로드 + ffmpeg WAV 변환 (8kHz mono PCM)
> 저장 경로: `/var/spool/asterisk/{tenantId}/pa/{extension}/pamsg.wav`

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
| `injectTts(linkedId, audio)` | `inject_tts(linked_id, audio)` | TTS 오디오 주입 |
| `say(linkedId, text, tts)` | `say(linked_id, text, tts)` | 텍스트→음성 재생 |
| `broadcastTts(confId, audio)` | `broadcast_tts(conf_id, audio)` | 회의 전체 방송 |

### 이벤트/세션
| TypeScript | Python | 설명 |
|------------|--------|------|
| `onCallEvent(handler)` | `on_call_event(handler)` | 통화 이벤트 구독 |
| `listSessions()` | `list_sessions()` | 활성 세션 목록 |

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
| 어댑터 | 패키지 |
|--------|--------|
| `DeepgramAdapter` | `dvgateway-adapters/stt` / `dvgateway.adapters.stt` |

### LLM (AI 대화)
| 어댑터 | 패키지 |
|--------|--------|
| `AnthropicAdapter` | `dvgateway-adapters/llm` / `dvgateway.adapters.llm` |
| `OpenAILlmAdapter` | `dvgateway-adapters/llm` / `dvgateway.adapters.llm` |

### TTS (텍스트→음성)
| 어댑터 | 패키지 |
|--------|--------|
| `GeminiTtsAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` |
| `ElevenLabsAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` |
| `OpenAITtsAdapter` | `dvgateway-adapters/tts` / `dvgateway.adapters.tts` |

TTS 선택: `TTS_PROVIDER` 환경변수로 `gemini` (기본) / `elevenlabs` 전환

---

## 환경변수

```bash
DV_BASE_URL=http://localhost:8080   # 게이트웨이 API 주소
DV_API_KEY=dvgw_xxx                  # SDK API 키
DEEPGRAM_API_KEY=dg_xxx              # STT
ANTHROPIC_API_KEY=sk-ant-xxx         # LLM
GEMINI_API_KEY=AIza_xxx              # TTS (Gemini)
TTS_PROVIDER=gemini                   # gemini 또는 elevenlabs
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

_최종 업데이트: 2026-04-03_
