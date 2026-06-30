# 네이버웍스(NAVER WORKS / LINE WORKS) 연동

> **이 기능은 SDK가 아닙니다.** TypeScript/Python SDK 코드 없이, **게이트웨이 내장 기능**으로
> 동작합니다. 설정은 전부 **대시보드 "네이버웍스" 탭** 또는 **REST API**로 합니다.
> 네이버웍스를 이미 쓰는 조직이 **별도 앱 설치 없이 WORKS 안에서** 통화·팩스 업무를 처리하게 됩니다.

DVGateway를 네이버웍스에 연결하는 방법은 **두 축**이며, 보완재로 함께 씁니다.

| 축 | 방향 | 용도 | 설정 위치 |
|----|------|------|-----------|
| **① 봇 알림** | 게이트웨이 → WORKS 봇 메시지 | 통화·팩스 **알림 받기**(수신/부재중/통화요약/팩스수신) | 대시보드 "네이버웍스" → 봇 / `…/config/lineworks` |
| **② WOFF 미니앱** | WORKS 앱 안 웹 UI ↔ 게이트웨이 | 클릭투콜·팩스·통화이력·프레즌스 **조작하기** | 대시보드 "네이버웍스" → WOFF / `…/config/woff` |

두 축이 합쳐지면 **WORKS 안에서 통화 업무가 닫힙니다**: 알림은 봇으로 받고, 거기서 미니앱을 열어
클릭투콜·팩스를 바로 수행합니다.

> 설계·아키텍처 전체 배경은 [docs/woff-naverworks-integration.md](https://github.com/OLSSOO-Inc/AI-Ready-Real-Time-Voice-Media-Gateway/blob/master/docs/woff-naverworks-integration.md) 를 참고하세요.

---

## ① 봇 알림 — 통화·팩스 알림을 WORKS 메시지로

게이트웨이가 통화 이벤트(수신/부재중/통화종료요약/팩스수신)를 **WORKS 봇 메시지**로 직원에게 보냅니다.
모바일 푸시(FCM)와 동일한 알림 정책 위에서 동작하며, 전송 채널만 WORKS 봇입니다.

### 설정 (대시보드가 가장 쉬움)

1. **네이버웍스 Developer Console**에서 앱(App) + 봇(Bot)을 등록하고 **서비스 계정(SA) 자격증명**
   (Client ID/Secret, Service Account, Private Key)을 발급받습니다.
2. 대시보드 **"네이버웍스" 탭**에 그 값들을 붙여넣습니다(테넌트별 저장).
   - 봇이 아직 없으면 **"🤖 봇 자동 생성"** 버튼이 등록 + 도메인 추가까지 해줍니다(SA에 bot scope+관리자 권한 필요).
3. **"연결 테스트"** — 본인 이메일로 실제 WORKS 메시지를 1건 발송해 폰에서 즉시 확인합니다.

### REST API

| 메서드·경로 | 설명 |
|-------------|------|
| `GET/PUT/DELETE /api/v1/config/lineworks` | 봇 자격증명 CRUD (admin 전용, 테넌트별, secret/privateKey 미노출) |
| `POST /api/v1/config/lineworks/test` | 토큰 발급 + 본인 이메일로 실제 메시지 발송 테스트 |
| `POST /api/v1/config/lineworks/create-bot` | 봇 자동 등록 + 도메인 추가 → `botId` 영속 |

> 자격증명은 **테넌트별**로 저장됩니다(`/etc/dvgateway/lineworks/{tenantId}.json`). `JWT signature is not
> valid` 오류는 대개 그 테넌트의 **Private Key 불일치**입니다(코드 버그 아님).

---

## ② WOFF 미니앱 — WORKS 안 통화/팩스 웹 UI

**WOFF(WORKS Front-end Framework)** = WORKS 앱 웹뷰 안에서 도는 미니앱(LINE의 LIFF에 해당).
게이트웨이가 미니앱 HTML을 **API 서버(:8080)의 `/woff`** 로 직접 서빙하고, WORKS SSO Access Token을
seat 인증으로 바꿔 **클릭투콜·팩스·통화이력·프레즌스**를 제공합니다(Firebase 비의존).

### 설정

1. Developer Console에서 **WOFF App 등록** → `woffId` 발급, Endpoint URL = `https://<공개호스트>/woff/`.
2. 대시보드 **"네이버웍스" 탭 → WOFF 카드**에서 입력(전부 web-settable, hot-reload):
   - **인증 활성화** 토글
   - **사용자 검증 URL** `https://www.worksapis.com/v1.0/users/me` (공공기관 `gov.worksapis.com`)
   - **woffId**, **공개 베이스 URL**(Endpoint 안내용), (선택) **redirect verification** Secret Key
3. WORKS 콘솔 OAuth Scope에 `user.read` 필요. nginx로 TLS 종단 + `/woff`·`/api` → :8080 프록시
   ([docs/woff-nginx.md](https://github.com/OLSSOO-Inc/AI-Ready-Real-Time-Voice-Media-Gateway/blob/master/docs/woff-nginx.md)).

### REST API

| 메서드·경로 | 설명 |
|-------------|------|
| `GET /woff` · `/woff/` | 게이트웨이가 서빙하는 WOFF 미니앱(정적 HTML). WORKS Endpoint URL = `{base}/woff/` |
| `POST /api/v1/woff/auth` | WORKS Access Token → seat 인증 → 모바일 `api.accessToken` 발급 |
| `GET /api/v1/woff/clientconfig` | 미니앱 공개 설정(`woff.init`용, 인증 전) |
| `GET/PUT/POST /api/v1/config/woff` | WOFF 설정 (admin 전용, hot-reload, secretKey 미반환) |
| `POST /api/v1/config/woff/test` | WORKS 토큰 검증 + seat 매칭 확인(실제 mint 안 함) |

> 봇 버튼·QR·딥링크는 **순수 WORKS 런치 URL**(`woff.worksmobile.com/woff/{woffId}`)만 써야 합니다 —
> Endpoint URL 직접 링크나 `?tenantId=` 같은 쿼리를 붙이면 WORKS가 토큰을 안 붙여 "로그인 필요"가 됩니다.

---

## 관련 환경변수 (부팅 시드)

운영 중에는 위 대시보드/REST로 hot-reload 하므로 env는 첫 부팅 시드용입니다.

| 변수 | 설명 |
|------|------|
| `GW_WOFF_ENABLED` | WOFF 인증 브리지 활성화(기본 true) |
| `GW_WOFF_USERINFO_URL` | WORKS 사용자 검증 엔드포인트(미설정 시 503) |
| `GW_WOFF_ID` | 미니앱 `woff.init`에 쓸 woffId |
| `GW_WOFF_PUBLIC_BASE_URL` | 공개 베이스 URL(Endpoint 안내) |
| `GW_WOFF_REDIRECT_VERIFY` / `GW_WOFF_SECRET_KEY` | redirect verification(HMAC, opt-in) |

LINE WORKS 봇 자격증명은 env가 아니라 대시보드/`…/config/lineworks`로만 관리합니다(테넌트별 파일 영속).
