# 큐(대기열) 관리 + 에이전트 런타임

> SDK를 통해 Dynamic VoIP **큐(대기열, ACD)** 를 조회·생성·수정·삭제하고, **상담원(에이전트)의
> 실시간 로그인/이석(pause)** 을 제어합니다.
> **gateway 1.4.11.30+ / SDK 1.8.7+**

콜센터/상담 시나리오에서 가장 많이 쓰는 두 가지를 SDK 한 줄로 처리할 수 있습니다.

- **에이전트 런타임** — 상담원이 출근하면 큐에 **로그인**, 점심/휴식엔 **이석(pause)**, 복귀하면
  **해제(unpause)**, 퇴근하면 **로그아웃**. 라이브 조작이라 즉시 반영됩니다.
- **큐 설정 CRUD** — 큐 목록/상세 조회, 큐 생성·수정·삭제.

---

## 0. 사전 준비

이 API는 게이트웨이가 **Dynamic VoIP 테넌트 동기화**(`PBX_TENANT_SYNC_ENABLED=true`)로 PBX와
연결되어 있어야 동작합니다. 꺼져 있으면 모든 큐 호출이 **503** 을 반환합니다.

```typescript
import { DVGatewayClient } from 'dvgateway-sdk';

const gw = new DVGatewayClient({
  baseUrl: 'https://your-gateway:8080',
  auth: { type: 'apiKey', apiKey: process.env.DVG_API_KEY! },
});
```

```python
from dvgateway import DVGatewayClient

gw = DVGatewayClient(base_url="https://your-gateway:8080",
                     auth={"type": "apiKey", "apiKey": os.environ["DVG_API_KEY"]})
```

### 테넌트 격리 (중요)

- **테넌트 토큰**(일반 SDK 사용자): 별도 지정 없이 **자기 테넌트의 큐만** 보고 제어합니다.
  `tenantId` 옵션을 넘겨도 무시되며, 다른 테넌트를 지정하면 게이트웨이가 **403** 으로 차단합니다.
- **Admin 토큰**(대시보드/통합 서버): 어느 테넌트에도 속하지 않으므로 `tenantId`(= PBX `path`)
  를 **반드시** 넘겨 대상 테넌트를 지정해야 합니다. 미지정 시 **400**.

아래 예제는 테넌트 토큰 기준입니다. Admin 이라면 각 호출에 `{ tenantId: '5a77fc279d842279' }`
(Python `tenant_id=...`) 를 추가하세요.

---

## 1. 에이전트 런타임 — 로그인 / 이석 / 복귀 / 로그아웃

> ⭐ 가장 자주 쓰는 기능. **`deviceId` 는 PBX device id 이며, 내선 번호가 아닙니다.**
> (소프트폰을 쓰는 앱이라면 프로비저닝/디바이스 목록에서 받은 device id 를 사용하세요.)

### TypeScript

```typescript
const deviceId = '42';

// 출근 — 모든 큐에 로그인
await gw.queueAgentLogin(deviceId);

// 특정 큐에만 로그인 (큐 id/번호 콤마 구분)
await gw.queueAgentLogin(deviceId, { queues: '5,7' });

// 휴식 — 이석 (사유 라벨)
await gw.queueAgentPause(deviceId, { reason: 'break' });

// 복귀 — 이석 해제
await gw.queueAgentUnpause(deviceId);

// 퇴근 — 로그아웃
await gw.queueAgentLogout(deviceId);

// 현재 상태 조회 (큐 id 키 맵)
const status = await gw.getQueueAgentStatus(deviceId);
// { "5": { status: true, paused: false, queue: "Q500", type: "dynamic" }, ... }
for (const [queueId, s] of Object.entries(status)) {
  console.log(`${s.queue}: ${s.status ? '로그인' : '로그아웃'}${s.paused ? ' (이석)' : ''}`);
}
```

### Python

```python
device_id = "42"

# 출근 — 모든 큐에 로그인
await gw.queue_agent_login(device_id)

# 특정 큐에만
await gw.queue_agent_login(device_id, queues="5,7")

# 휴식 — 이석
await gw.queue_agent_pause(device_id, reason="break")

# 복귀
await gw.queue_agent_unpause(device_id)

# 퇴근
await gw.queue_agent_logout(device_id)

# 현재 상태
status = await gw.queue_agent_status(device_id)
# {"5": {"status": True, "paused": False, "queue": "Q500", "type": "dynamic"}}
for queue_id, s in status.items():
    state = "로그인" if s["status"] else "로그아웃"
    if s["paused"]:
        state += " (이석)"
    print(f'{s["queue"]}: {state}')
```

### 에이전트 상태 필드

| 필드 | 타입 | 의미 |
|------|------|------|
| `status` | boolean | 큐에 **로그인** 되어 있으면 `true` |
| `paused` | boolean | **이석(일시정지)** 상태면 `true` |
| `queue` | string | 큐 이름 (예 `Q500`) |
| `type` | `dynamic`\|`static` | 멤버십 유형 |

> 💡 **즉시 반영**: login/logout/pause/unpause 는 라이브 AMI 조작이라 호출 즉시 큐에 반영됩니다.
> (큐 *설정* 변경과 달리 별도 apply 단계가 필요 없습니다.)

---

## 2. 큐 조회

### TypeScript

```typescript
// 전체 큐 목록 (멤버 포함)
const queues = await gw.listQueues();
for (const q of queues) {
  console.log(`${q.name} (ext ${q.extension}) — ${q.description ?? ''} · 멤버 ${q.members?.length ?? 0}명`);
}

// 방향별 필터
const inbound = await gw.listQueues({ direction: 'inbound' });
const outbound = await gw.listQueues({ direction: 'outbound' });

// 단일 큐 상세
const q = await gw.getQueue(2);
console.log(q.strategy, q.timeout, q.members);
```

### Python

```python
# 전체 큐 목록
queues = await gw.list_queues()
for q in queues:
    print(f'{q["name"]} (ext {q.get("extension")}) · 멤버 {len(q.get("members", []))}명')

# 방향별
inbound = await gw.list_queues(direction="inbound")
outbound = await gw.list_queues(direction="outbound")

# 단일 큐
q = await gw.get_queue(2)
print(q["strategy"], q["timeout"], q.get("members"))
```

---

## 3. 큐 생성 / 수정 / 삭제

### TypeScript

```typescript
// 생성 — Dynamic VoIP 큐 본문 (필요한 필드만)
const created = await gw.createQueue({
  extension: 510,
  description: 'Partners',
  direction: 'inbound',
  strategy: 'rrordered',      // ringall | rrordered | random | linear | leastrecent | fewestcalls | rrmemory | wrandom
  timeout: 15,                // 멤버 1명당 벨 울림(초)
  retry: 5,                   // 다음 멤버 시도 전 대기(초)
  servicelevel: 30,           // SLA 기준(초)
  members: [
    { extension_id: 288, penalty: 0, type: 'dynamic' },
    { extension_id: 6374, penalty: 0, type: 'dynamic' },
  ],
});
console.log('created queue_id =', created.queue_id);

// 수정 (전체 본문, 생성과 동일 형태)
await gw.updateQueue(created.queue_id!, {
  description: 'VitalPBX Partners',
  strategy: 'rrordered',
  timeout: 15,
  queue_timeout: 300,
  members: [{ member_id: 41, extension_id: 288, type: 'dynamic' }],
});

// 삭제
await gw.deleteQueue(created.queue_id!);
```

### Python

```python
created = await gw.create_queue({
    "extension": 510,
    "description": "Partners",
    "direction": "inbound",
    "strategy": "rrordered",
    "timeout": 15,
    "retry": 5,
    "servicelevel": 30,
    "members": [
        {"extension_id": 288, "penalty": 0, "type": "dynamic"},
        {"extension_id": 6374, "penalty": 0, "type": "dynamic"},
    ],
})
print("created queue_id =", created.get("queue_id"))

await gw.update_queue(created["queue_id"], {
    "description": "VitalPBX Partners",
    "strategy": "rrordered",
    "timeout": 15,
    "queue_timeout": 300,
    "members": [{"member_id": 41, "extension_id": 288, "type": "dynamic"}],
})

await gw.delete_queue(created["queue_id"])
```

### 자주 쓰는 큐 필드

| 필드 | 기본값 | 설명 |
|------|--------|------|
| `extension` | — | 큐에 도달하는 내선 번호 |
| `description` | — | 큐 식별용 짧은 설명 (테넌트 내 **중복 불가** — 중복 시 400) |
| `direction` | `inbound` | `inbound` / `outbound`(다이얼러) |
| `strategy` | `rrordered` | 멤버 호출 전략 (위 코드 주석의 8종) |
| `timeout` | `15` | 멤버 1명당 벨 울림 시간(초) |
| `retry` | `5` | 다음 멤버 시도 전 대기(초) |
| `wrapuptime` | `0` | 통화 후 멤버 대기(휴식) 시간(초) |
| `servicelevel` | `30` | SLA 기준 시간(초, 통계용) |
| `queue_timeout` | `0` | 큐 전체 타임아웃(초, 0=무제한) |
| `joinempty` | `yes` | 멤버 부재 시 인입 허용 (`yes`/`no`/`loose`/`strict`/`no_inuse`) |
| `leavewhenempty` | `no` | 멤버 사라지면 대기콜 퇴출 |
| `record` | `false` | 큐 통화 녹취 여부 |
| `members[]` | — | 멤버 배열 — 각 항목 `extension_id`(필수), `penalty`, `type`(dynamic/static) |

전체 필드(40+)와 의미는 [큐 API 분석 문서](https://github.com/OLSSOO-Inc/AI-Ready-Real-Time-Voice-Media-Gateway/blob/master/go-gateway/docs/queue-api-analysis.md)를 참고하세요.

> ⚠️ **큐 설정 변경의 PBX 반영**: 생성/수정/삭제는 PBX DB에 즉시 기록되지만, 일부 변경은
> Asterisk 다이얼플랜 재적용(apply)이 필요할 수 있습니다. SDK 의 `applyChanges()` /
> `apply_changes()` (PBX 관리 섹션 참조)로 적용하세요. **에이전트 런타임(섹션 1)은 apply 불필요.**

---

## 4. 응답 형태에 대한 주의 (PBX 원본 스키마)

큐 객체는 Dynamic VoIP 큐 모델을 **그대로**(snake_case) 노출합니다. PBX가 엔드포인트별로
형식이 **일관되지 않으므로** 코드에서 방어적으로 다루세요:

- 목록/상세는 플래그를 **boolean**(`record: true`)으로 주지만, `direction` 필터(`inbound`/
  `outbound`) 목록은 **문자열**(`record: "no"`)로 줍니다. TS 타입에서 이런 플래그는 느슨하게
  (`boolean | string`) 정의되어 있습니다.
- 멤버 식별자도 엔드포인트에 따라 `extension_id` 또는 `member_id` 로 옵니다(수정 시에는 기존
  멤버에 `member_id`, 신규 멤버에 `extension_id` 를 넣습니다).
- 생성/수정 시 `final_destination` / `after_hangup_destination` 의 카테고리 키는 PBX 원본
  철자인 **`cetegory_id`**(오타)입니다 — 와이어로는 그대로 보내야 합니다.

---

## 5. 에러 처리

| 상황 | 응답 | 대처 |
|------|------|------|
| PBX 동기화 비활성 | **503** `PBX tenant sync disabled` | 게이트웨이 `PBX_TENANT_SYNC_ENABLED=true` 확인 |
| Admin 이 `tenantId` 미지정 | **400** | `{ tenantId }` / `tenant_id=` 추가 |
| 다른 테넌트 지정(테넌트 토큰) | **403** | 자기 테넌트만 접근 가능 |
| 잘못된 `direction` / action | **400** | `inbound`/`outbound`, `login/logout/pause/unpause` 만 |
| 큐 설명 중복 등 PBX 검증 실패 | **502** (PBX 메시지 포함) | 응답 `error` 의 PBX 메시지 확인 |
| `deviceId` 누락(에이전트 액션) | SDK가 즉시 throw | device id 전달 |

```typescript
try {
  await gw.queueAgentPause('42', { reason: 'lunch' });
} catch (err) {
  // 503: PBX 동기화 꺼짐 / 502: PBX 거부 / 400·403: 권한·입력
  console.error('큐 이석 실패:', (err as Error).message);
}
```

---

## 6. 메서드 요약

| TypeScript | Python | REST |
|------------|--------|------|
| `listQueues({direction?, tenantId?})` | `list_queues(*, direction?, tenant_id?)` | `GET /api/v1/queues` |
| `getQueue(id, {tenantId?})` | `get_queue(id, *, tenant_id?)` | `GET /api/v1/queues/{id}` |
| `createQueue(spec, {tenantId?})` | `create_queue(spec, *, tenant_id?)` | `POST /api/v1/queues` |
| `updateQueue(id, spec, {tenantId?})` | `update_queue(id, spec, *, tenant_id?)` | `PUT /api/v1/queues/{id}` |
| `deleteQueue(id, {tenantId?})` | `delete_queue(id, *, tenant_id?)` | `DELETE /api/v1/queues/{id}` |
| `getQueueAgentStatus(deviceId, {tenantId?})` | `queue_agent_status(device_id, *, tenant_id?)` | `GET /api/v1/queues/agent/{deviceId}` |
| `queueAgentLogin(deviceId, {queues?, tenantId?})` | `queue_agent_login(device_id, *, queues?, tenant_id?)` | `POST .../agent/{deviceId}/login` |
| `queueAgentLogout(deviceId, {queues?, tenantId?})` | `queue_agent_logout(device_id, *, queues?, tenant_id?)` | `POST .../agent/{deviceId}/logout` |
| `queueAgentPause(deviceId, {queues?, reason?, tenantId?})` | `queue_agent_pause(device_id, *, queues?, reason?, tenant_id?)` | `POST .../agent/{deviceId}/pause` |
| `queueAgentUnpause(deviceId, {queues?, tenantId?})` | `queue_agent_unpause(device_id, *, queues?, tenant_id?)` | `POST .../agent/{deviceId}/unpause` |

`queues` 는 `all`(기본) 또는 큐 id/번호 콤마 목록. `reason` 은 pause 전용 라벨.

---

## 아직 제공되지 않는 것 (로드맵)

- **실시간 큐 통계** — 대기콜 수·평균 대기시간·SLA 달성률 등 라이브 지표는 이 REST API에
  포함되지 않습니다(Asterisk AMI 이벤트 출처). 추후 WebSocket push 로 제공 예정.
- **모바일 상담원 self-service** — 현재 에이전트 런타임은 테넌트/Admin 토큰 스코프입니다.
  모바일 앱 사용자가 본인 단말만 제어하는 device-소유권 강제는 후속 예정.

---

_Last updated: 2026-06-17_
