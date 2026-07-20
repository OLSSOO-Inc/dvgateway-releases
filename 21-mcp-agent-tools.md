# 21. MCP 연동 — AI 에이전트에게 전화 시스템을 도구로

> **SDK 아님 · 게이트웨이 내장** (gw 1.4.14.114+). 코드 없이 설정만으로,
> Claude·n8n 같은 AI 에이전트가 여러분의 전화 시스템을 직접 다루게 합니다.

MCP(Model Context Protocol)는 AI 에이전트가 외부 시스템의 기능을 "도구"로
발견하고 호출하는 표준입니다. 게이트웨이가 MCP 서버로 동작하면, 에이전트에게
이렇게 말할 수 있습니다:

- *"오늘 부재중 전화 목록 보여줘"*
- *"어제 김과장이랑 한 통화 요약해줘 — 액션 아이템 중심으로"*
- *"010-1234-5678 고객한테 '내일 방문 예정입니다' 문자 보내줘"*
- *"내 내선 4801 을 오늘 저녁까지 방해금지로 해줘"*
- *"영업팀 내선들 지금 통화 가능한지 봐줘"*

에이전트가 알아서 적절한 도구를 골라 조합합니다 — 여러분은 자연어로 말하면 됩니다.

---

## 1. 켜기 (2분)

```bash
# 게이트웨이 서버에서
echo 'GW_MCP_ENABLED=true' | sudo tee -a /etc/dvgateway/dvgateway.env
sudo systemctl restart dynamic-voip-gateway
# 부팅 로그 확인: [MCP] server enabled — POST /mcp ...
```

> 기본은 **꺼짐**입니다. 전화 발신·문자 발송을 AI 에게 여는 기능이므로
> 의도적으로 켜야 합니다.

**토큰 발급** (모든 예시 공통 — 테넌트 스코프 토큰 권장):

```bash
TOKEN=$(curl -s -X POST https://gw.example.com/api/v1/auth/token \
  -H 'Content-Type: application/json' \
  -d '{"apiKey":"dvgw_여러분의_SDK_키"}' | jq -r .token)
```

---

## 2. 사용 방법 A — Claude Desktop / Claude Code

`claude_desktop_config.json`(Desktop) 또는 `.mcp.json`(Claude Code 프로젝트):

```json
{
  "mcpServers": {
    "우리회사-전화": {
      "type": "http",
      "url": "https://gw.example.com/mcp",
      "headers": { "Authorization": "Bearer <위에서 발급한 TOKEN>" }
    }
  }
}
```

끝입니다. 이제 Claude 에게:

> **"어제 걸려온 전화 중에 녹취 있는 것들 요약해서 표로 정리해줘"**

Claude 가 `list_recent_calls` → `summarize_call` 을 알아서 연쇄 호출합니다.

> 💡 발신(`click_to_call`)·문자(`send_sms`)는 실제 과금 액션입니다 —
> Claude Code 의 도구 승인(허용 목록)에서 이 둘은 **매번 확인**으로 두는 것을
> 권장합니다.

## 3. 사용 방법 B — n8n (무코드 자동화)

n8n 의 **MCP Client Tool** 노드 → Endpoint 에 `https://gw.example.com/mcp`,
Authentication 에 Bearer 토큰. AI Agent 노드에 붙이면 됩니다.

활용 예 (n8n 워크플로우):
- **매일 아침 9시**: `list_recent_calls`(전날) → LLM 요약 → 슬랙/메일 발송
- **CRM 신규 리드 웹훅** → `click_to_call` 로 담당자-고객 자동 연결
- **미응답 콜 감지** → `summarize_call`(있으면) + `send_sms` 로 "확인했습니다" 회신

## 4. 사용 방법 C — curl / 직접 호출 (개발자·스크립트)

```bash
# 도구 목록 보기
curl -s https://gw:8080/mcp -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools[].name'

# 최근 통화 5건
curl -s https://gw:8080/mcp -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"list_recent_calls","arguments":{"limit":5}}}' \
  | jq -r '.result.content[0].text'

# 특정 통화 AI 요약 (배송 렌즈 + 키워드 하이라이트)
curl -s https://gw:8080/mcp -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call",
       "params":{"name":"summarize_call",
                 "arguments":{"linkedid":"1752...","focus":"delivery","keywords":["반품","환불"]}}}'
```

## 5. 도구 카탈로그

| 도구 | 말로 하면 | 비고 |
|---|---|---|
| `list_recent_calls` | "최근/어제/이 번호와의 통화 찾아줘" | 결과의 linkedid 로 요약 연계 |
| `summarize_call` | "이 통화 요약해줘 (액션/결정/배송/부동산 관점)" | 녹취 필요 · 수십 초 소요 · PII 자동 마스킹 |
| `send_sms` | "이 번호로 문자 보내줘" | 발신 내선 권한·80바이트 제한 적용 |
| `click_to_call` | "나랑 이 고객 전화 연결해줘" | 내 내선이 먼저 울림 · 발신번호는 서버가 강제 |
| `get_presence` | "누구 통화 중이야?" | 내선 상태 + DND + 착신전환 여부 |
| `set_call_forwarding` | "내 전화 휴대폰으로 돌려줘" | CFI/CFB/CFN/CFU |
| `set_dnd` | "방해금지 켜/꺼줘" | |
| `list_active_sessions` | "지금 진행 중인 통화 있어?" | |

**권한은 REST 와 동일**합니다: 테넌트 토큰이면 자기 테넌트 데이터만, 관리자
토큰이면 도구 인자에 `tenantId` 를 지정합니다. 모바일 앱 토큰은 MCP 를 쓸 수
없습니다(서버/에이전트 전용 표면).

## 6. 온프렘 — 인터넷 없이 전부 돌리기

1. **MCP 서버**: 게이트웨이 내장 — 사내망만으로 동작.
2. **AI 요약의 LLM 도 사내로**: 대시보드 → 프로바이더 API 키 → **LLM →
   OpenAI GPT 카드**에 Base URL 로 사내 vLLM/Ollama 주소를 입력
   (예 `http://10.0.0.5:8000`), 모델명은 "AI 파이프라인" 탭 `llmModel`
   (예 `qwen2.5-14b-instruct`). API Key 는 로컬 서버가 요구하는 값(없으면 아무 값).
3. 이제 "사내 에이전트 → 사내 게이트웨이 → 사내 LLM" 폐쇄망 구성 완료.

## 7. 자주 묻는 것

- **404 가 나요** → `GW_MCP_ENABLED=true` + 재시작 확인.
- **401 이 나요** → Bearer 토큰 만료/누락. `/api/v1/auth/token` 으로 재발급.
- **요약 도구가 503** → STT/LLM 키 미설정. `GET /api/v1/config/ai` 로 가용성을
  확인하고 대시보드 "프로바이더 API 키" 탭에서 키를 등록하세요.
- **n8n 인데 MCP 노드가 없어요** → 기존 방식(webhook LLM 어댑터,
  [09. 파이프라인 훅·Webhook](09-hooks-webhook.md))으로도 대부분 가능합니다 —
  MCP 는 "에이전트가 전화를 조작", webhook 은 "통화 중 파이프라인이 외부 데이터
  사용"으로 방향이 다릅니다.

> 기술 상세(프로토콜·보안·설계)는 저장소의
> [docs/mcp-integration.md](https://github.com/OLSSOO-Inc/AI-Ready-Real-Time-Voice-Media-Gateway/blob/master/docs/mcp-integration.md) 참조.
