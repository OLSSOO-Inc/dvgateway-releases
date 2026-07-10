# SMS 알림 게이트웨이 활용 — 모니터링·cron·n8n 에서 문자 보내기

> DVG 의 SMS API 를 **사내 문자 게이트웨이**로 씁니다. 모니터링 경보, 일일 리포트, 워크플로
> 알림을 **건당 과금 없이** 회사 회선으로 발송 — 별도 문자업체 계약이 필요 없습니다.
> **SDK 불필요, REST 두 번이면 끝.** (gateway 1.4.14.47+, SMS 라우팅 설정 전제)

이 문서는 코드가 아니라 **복붙 레시피** 모음입니다. SMS 기능 자체(발신/수신/이력/에러코드)는
[21. SMS 발송·수신](21-sms.md) 참조.

---

## 0. 준비물 (관리자 1회)

1. **SMS 라우팅 설정** — 대시보드 "📩 SMS" 탭에서 활성화·SMSC·트렁크 설정
   ([21-sms.md §0](21-sms.md)). 설정 전 발송은 `412` 로 거절됩니다.
2. **API 키** — 대시보드에서 발급.
   - **테넌트 키**(권장): 그 테넌트로 자동 스코프 — 스크립트에 `?tenantId=` 불필요.
   - 글로벌(admin) 키: 발송 시 `?tenantId=<path>` 를 붙여야 합니다.
3. 발신 내선(예 `1001`)과 수신자 휴대폰 번호.

> 인증 흐름: `POST /api/v1/auth/token` 에 `X-API-Key` 헤더 → `{"token":"<jwt>"}` →
> 그 JWT 로 `POST /api/v1/sms/send`. 토큰은 스크립트 실행 때마다 새로 받으면 됩니다.

---

## 1. 기본기 — curl 두 줄

```bash
JWT=$(curl -s -X POST https://gw.example.com:8080/api/v1/auth/token \
  -H "X-API-Key: $DVG_API_KEY" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')

curl -s -X POST https://gw.example.com:8080/api/v1/sms/send \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d '{"from":"1001","to":["01012345678"],"text":"[경보] 서버 디스크 92%"}'
# → {"id":"…","messageId":"…","status":"delivered","recipients":["01012345678"]}
```

**본문 제한: EUC-KR 80바이트 = 한글 40자 / 영문·숫자 80자.** 초과 시
`400 sms_body_too_long`. 이모지 불가(EUC-KR). 알림 문구는 짧게 설계하세요 —
`[경보] db1 디스크 92% (07/10 17:32)` 같은 포맷이면 충분히 들어갑니다.

---

## 2. 공용 발송 스크립트 (`/usr/local/bin/dvg-sms.sh`)

모든 레시피가 이 스크립트 하나를 재사용합니다.

```bash
#!/bin/bash
# dvg-sms.sh <수신번호> <본문>  — DVG 게이트웨이로 문자 발송
# 예: dvg-sms.sh 01012345678 "[경보] 디스크 92%"
GW="https://gw.example.com:8080"
API_KEY="여기에_테넌트_API_키"   # 테넌트 키 권장(자동 스코프)
FROM="1001"                      # 발신 내선(실번호로 자동 변환)

TO="$1"; TEXT="$2"
[ -z "$TO" ] || [ -z "$TEXT" ] && { echo "usage: dvg-sms.sh <to> <text>"; exit 1; }

JWT=$(curl -s -m 10 -X POST "$GW/api/v1/auth/token" -H "X-API-Key: $API_KEY" \
  | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -z "$JWT" ] && { echo "auth failed"; exit 1; }

curl -s -m 10 -X POST "$GW/api/v1/sms/send" \
  -H "Authorization: Bearer $JWT" -H 'Content-Type: application/json' \
  -d "{\"from\":\"$FROM\",\"to\":[\"$TO\"],\"text\":\"$TEXT\"}"
```

```bash
sudo install -m 755 dvg-sms.sh /usr/local/bin/dvg-sms.sh
dvg-sms.sh 01012345678 "테스트 문자"   # 동작 확인
```

> jq 없이 sed 만 사용 — 어느 서버에서도 동작. API 키가 스크립트에 들어가므로 권한 755/소유 root,
> 또는 키를 `/etc/dvg-sms.env`(600) 로 분리해 `source` 하세요.

---

## 3. 레시피

### 3-1. cron — 임계치 경보 + 일일 리포트

```cron
# /etc/cron.d/dvg-alerts
# 디스크 90% 초과 시 5분마다 경보
*/5 * * * * root u=$(df / --output=pcent | tail -1 | tr -dc 0-9); [ "$u" -ge 90 ] && /usr/local/bin/dvg-sms.sh 01012345678 "[경보] $(hostname) 디스크 ${u}%"

# 매일 09:00 업타임 보고
0 9 * * * root /usr/local/bin/dvg-sms.sh 01012345678 "[일일] $(hostname) $(uptime -p | cut -c1-25)"
```

리부팅 알림은 systemd 로:

```ini
# /etc/systemd/system/boot-sms.service
[Unit]
Description=send SMS on boot
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/dvg-sms.sh 01012345678 "[알림] %H 부팅됨"
[Install]
WantedBy=multi-user.target
```

### 3-2. Zabbix — Alert Script

1. 서버의 `AlertScriptsPath`(기본 `/usr/lib/zabbix/alertscripts/`)에 `dvg-sms.sh` 복사.
2. **Administration → Media types → Create**: Type `Script`, Script name `dvg-sms.sh`,
   Parameters 두 줄 — `{ALERT.SENDTO}` / `{ALERT.MESSAGE}`.
3. 사용자 Media 에 수신 휴대폰 번호 등록, Action 의 메시지 템플릿을 **80바이트 내로**:
   `[{EVENT.SEVERITY}] {HOST.NAME} {TRIGGER.NAME}` 정도로 짧게.

### 3-3. Grafana / 기타 webhook 발신원

Grafana·Alertmanager 류는 자기 포맷의 JSON 을 POST 하므로, 중간에 **한 줄 중계**를 둡니다
(토큰 교환 + 본문 80바이트 절단). n8n 이 있으면 아래 3-4 가 곧 그 중계입니다. 없으면
webhook 수신용 소형 스크립트(예: `webhook → dvg-sms.sh` 호출) 하나면 됩니다 —
핵심은 어떤 시스템이든 **마지막 한 홉이 `POST /api/v1/sms/send`** 라는 것.

### 3-4. n8n — HTTP Request 노드 2개

어떤 트리거(폼, 스케줄, webhook, DB 변화)든 뒤에 이 두 노드를 붙이면 문자가 나갑니다.

**노드 1 — 토큰 발급** (HTTP Request)
- Method `POST` · URL `https://gw.example.com:8080/api/v1/auth/token`
- Body(JSON): `{ "apiKey": "여기에_API_키" }`

**노드 2 — 발신** (HTTP Request)
- Method `POST` · URL `https://gw.example.com:8080/api/v1/sms/send`
- Header: `Authorization` = `Bearer {{ $json.token }}`
- Body(JSON):
  ```json
  { "from": "1001", "to": ["01012345678"], "text": "{{ $('Trigger').item.json.message.slice(0, 38) }}" }
  ```
  (`slice(0, 38)` — 한글 기준 안전 절단. 서버가 80바이트 초과를 거절하므로 미리 자름)

### 3-5. 사내 시스템 (ERP·CRM·쇼핑몰)

개발팀이 있으면 SDK 한 줄이 가장 쉽습니다:

```typescript
await gw.sendSMS({ from: '1001', to: [customer.phone], text: `[주문] ${orderNo} 발송되었습니다` });
```

없으면 위 curl 패턴 그대로 — 어떤 언어든 HTTP POST 두 번입니다.

---

## 4. 운영 팁

| 항목 | 권장 |
|------|------|
| 발송 이력·감사 | `GET /api/v1/sms?direction=out` — 누가·언제·무엇을 보냈는지 전부 남음. 대시보드 "📩 SMS" 이력에서도 확인 |
| 실패 처리 | 응답 `status:"failed"` + `errorDetail`. 스크립트 알림은 best-effort 로 두고, 중요 경보는 재시도 1회 정도만 |
| 키 관리 | 테넌트별 키 사용(스코프 최소화), 스크립트 밖 env 파일(600) 분리 |
| 문구 설계 | 접두사 규약을 정하면 40자로 충분: `[경보]`/`[일일]`/`[주문]` + 핵심만 |
| ⚠️ 광고성 발송 금지 | 이 채널은 **거래·알림용**입니다. 광고성 문자는 법적 표기 의무(`(광고)`+080)가 80바이트에 물리적으로 불가 — 보내지 마세요 |

## 5. 문제 해결

발송 실패 코드(`sms_disabled`/`sms_unprovisioned`/`sms_body_too_long` 등)는
[21-sms.md §6](21-sms.md) 표 참조. `auth failed` 는 API 키 미설정/오타 — 대시보드에서 재발급.
