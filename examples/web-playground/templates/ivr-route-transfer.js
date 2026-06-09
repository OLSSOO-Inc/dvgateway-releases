// 대표번호 안내 → 담당자 연결 (소호/1인 사업자) — 실전 시나리오.
//
// 1인 사업자·소호(부동산·보험·사주팔자·O2O·타지역 안내 등)가 대표번호로 받은
// 전화를, 짧은 업종 인사말을 들려준 뒤 곧바로 담당자(사업자 본인 휴대폰 등)로
// 연결하는 가장 흔한 패턴입니다. DTMF 메뉴 분기 없이 "안내 → 연결" 한 흐름이라
// 설정이 번호 하나로 끝납니다.
//
// 단일 기능 데모(3.인사말 TTS / 12.웜트랜스퍼)를 실제 콜플로우로 엮은 응용
// 사례입니다. 모든 단계가 실제 게이트웨이 API라 시뮬레이션이 없습니다.
//
// 흐름:
//   1) 통화 연결(channel:state up) → 업종 인사말 TTS 재생
//      (예: "안녕하세요, ○○공인중개사입니다. 담당자에게 연결해 드리겠습니다.").
//   2) 인사말이 끝나면 곧바로 담당자 번호로 warm transfer — 통화를 보류하고
//      담당자를 호출해 응답하면 브릿지로 연결.
//
// mode=both·lite·flow 어디서나 동작: TTS는 PCM 주입(mode=both)이 안 되면 ARI
// Playback(lite/flow)으로 자동 폴백한다. warm transfer 는 게이트웨이 ARI 활성 필요.

const CODE = `// 소호 대표번호: 업종 인사말 → 담당자 연결 (warm transfer) + 모바일 푸시
const GREETING = "안녕하세요, 지화자입니다. 담당자에게 연결해 드리겠습니다."; // 발신자에게
const WHISPER  = "지화자 고객 연결입니다.";   // 담당자에게만 (받는 순간, 고객엔 안 들림)
const AGENT = "01012345678";       // 담당자(사업자 본인) 번호 — 외부면 outbound:true
const OWNER_EMAIL = "owner@biz.kr"; // 모바일 알림 받을 사장/담당자(seat 이메일)
const connected = new Set();       // 통화별 1회 처리 가드

ws.onmessage = async (msg) => {
  const evt = JSON.parse(msg.data);

  // 통화 연결(up) → [전화수신 푸시] → 인사말 → 담당자 연결 → [전환통화 푸시]
  if (evt.event === "channel:state" && evt.state === "up") {
    const lid = evt.linkedId;
    if (connected.has(lid)) return;
    connected.add(lid);

    // 전화수신 알림 — 통화가 연결되면 사장/담당자 앱으로 푸시(이메일 라우팅)
    await pushToUser({ email: OWNER_EMAIL, subtype: "incoming_call", linkedid: lid });

    await injectTts(lid, GREETING);          // 발신자에게 업종 인사말

    // 전환통화 알림 — 전환이 시작되는 시점에 푸시(warmTransfer 는 응답까지
    // 블로킹하므로 호출 직전에 발사해야 담당자가 연결 전에 받는다)
    pushToUser({ email: OWNER_EMAIL, subtype: "warm_transfer", linkedid: lid });

    const r = await warmTransfer(lid, {      // 담당자로 연결
      destination: AGENT,
      whisperText: WHISPER,                  // 담당자에게만 들려줄 안내(고객엔 안 들림)
      outbound: true,                        // 휴대폰/외부번호면 트렁크 발신
      timeoutMs: 30000,
    });
    // r.connected: 담당자 응답·연결 성사 여부
  }
};`;

// 연결(up) 직후 미디어 경로가 자리잡기 전에 주입하면 첫 음절이 잘려 들린다.
const GREETING_DELAY_MS = 2000;

// 업종별 인사말 프리셋 — 선택하면 멘트가 채워지고, 자유롭게 수정 가능.
// {biz} 자리표시자는 아래 "상호" 입력값으로 치환된다.
const PRESETS = [
  { id: "realestate", label: "🏠 부동산",   text: "안녕하세요, {biz}입니다. 매물 문의 주셔서 감사합니다. 담당자에게 연결해 드리겠습니다." },
  { id: "insurance",  label: "🛡 보험",     text: "안녕하세요, {biz}입니다. 보험 상담 도와드리겠습니다. 담당 설계사에게 연결해 드릴게요." },
  { id: "fortune",    label: "🔮 사주·운세", text: "안녕하세요, {biz}입니다. 상담 신청 감사합니다. 잠시 후 상담사에게 연결해 드리겠습니다." },
  { id: "o2o",        label: "🛠 O2O·출장", text: "안녕하세요, {biz}입니다. 예약·견적 문의 감사합니다. 담당 기사에게 바로 연결해 드릴게요." },
  { id: "region",     label: "📍 타지역 안내", text: "안녕하세요, {biz}입니다. 해당 지역 담당자에게 연결해 드리겠습니다. 잠시만 기다려 주세요." },
  { id: "custom",     label: "✏ 직접 입력", text: "" },
];

function mount(ctx) {
  ctx.body.innerHTML = `
    <p class="help">
      대표번호로 전화가 <b>연결되면</b> 업종 인사말을 들려주고, 멘트가 끝나면 곧바로
      담당자(사업자 본인 휴대폰 등)로 <b>연결</b>합니다. 1인 사업자·소호에 맞춘
      <b>안내 → 연결</b> 단순 패턴이에요 (키 입력·메뉴 없음).
      <b>3.인사말 TTS + 12.웜트랜스퍼</b>를 하나의 콜플로우로 엮은 예시이며,
      mode=both·lite·flow 모두 동작합니다. 웜 트랜스퍼는 게이트웨이 ARI가 활성이어야 합니다.
    </p>

    <div class="row" style="gap:14px;flex-wrap:wrap;align-items:flex-end;">
      <div class="field" style="flex:1;min-width:140px;">
        <label>업종 프리셋
          <select id="irt-preset">
            ${PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="field" style="flex:1;min-width:160px;">
        <label>상호 (멘트의 {biz} 자리)
          <input id="irt-biz" type="text" value="지화자" placeholder="예: 지화자">
        </label>
      </div>
    </div>

    <div class="field">
      <label>인사말 멘트 (발신자에게 — 연결되면 자동 재생)
        <textarea id="irt-greet"></textarea>
      </label>
    </div>

    <div class="field">
      <label>담당자 안내 멘트 (whisper — 연결 직전 담당자에게만 들려줌)
        <input id="irt-whisper" type="text" value="지화자 고객 연결입니다." placeholder="예: 지화자 고객 연결입니다.">
      </label>
      <p class="help">웜 트랜스퍼의 핵심 — 담당자가 전화를 받는 순간, <b>고객에게는 안 들리고 담당자에게만</b> 짧게 들려주는 안내예요(누구 전화인지 미리 귀띔). 비우면 whisper 없이 바로 연결돼요.</p>
    </div>

    <div class="row" style="gap:14px;flex-wrap:wrap;align-items:flex-end;">
      <div class="field" style="flex:1;min-width:180px;">
        <label>담당자 번호 (연결 대상)
          <input id="irt-dest" type="text" placeholder="예: 01012345678 (휴대폰) 또는 1001 (내선)">
        </label>
      </div>
      <label class="inline" style="display:flex;align-items:center;gap:5px;padding-bottom:10px;">
        <input id="irt-outbound" type="checkbox" checked> 외부번호로 발신 (휴대폰·트렁크)
      </label>
    </div>
    <p class="help">담당자가 <b>휴대폰/외부번호</b>면 외부발신을 켜세요(트렁크 컨텍스트로 발신). 사내 <b>내선</b>이면 끄세요.</p>

    <div class="field" style="margin-top:16px;border-top:1px solid var(--border,#2a2f3a);padding-top:14px;">
      <label>📲 모바일 알림 받을 사람 (선택)
        <select id="irt-seat"><option value="">로그인 후 사용 가능</option></select>
      </label>
      <p class="help">테넌트에 등록된 <b>모바일 앱 사용자(seat)</b>에게 앱 푸시를 보냅니다(이메일 라우팅). 목록이 비었으면 「📱 모바일 앱 사용자」에서 먼저 등록하세요. <a href="#" id="irt-seat-reload">새로고침</a></p>
      <div class="row" style="gap:16px;flex-wrap:wrap;margin-top:6px;">
        <label class="inline" style="display:flex;align-items:center;gap:5px;">
          <input id="irt-push-incoming" type="checkbox"> 전화수신 알림 (incoming_call)
        </label>
        <label class="inline" style="display:flex;align-items:center;gap:5px;">
          <input id="irt-push-transfer" type="checkbox"> 전환통화 알림 (warm_transfer)
        </label>
      </div>
      <p class="help">켜면 <b>통화가 연결될 때</b> 전화수신 알림을, <b>담당자 연결이 성사될 때</b> 전환통화 알림을 선택한 사용자에게 푸시해요. 게이트웨이에 푸시 릴레이(<code>GW_WARM_TRANSFER_PUSH_*</code>)가 설정돼 있어야 동작합니다(미설정 시 진행 로그에 사유 표시).</p>
    </div>

    <div class="row" style="margin-top:16px;justify-content:space-between;align-items:center;">
      <span class="muted small">단계별 진행 상황</span>
      <button id="irt-clear" class="ghost small" type="button">🧹 Clear</button>
    </div>
    <div class="transcript" id="irt-state">
      <p class="muted small">대기 중 — 통화가 연결되면 여기에 단계별 진행 상황이 표시돼요.</p>
    </div>
  `;

  const presetEl = ctx.body.querySelector("#irt-preset");
  const bizEl = ctx.body.querySelector("#irt-biz");
  const greetEl = ctx.body.querySelector("#irt-greet");
  const whisperEl = ctx.body.querySelector("#irt-whisper");
  const destEl = ctx.body.querySelector("#irt-dest");
  const outboundEl = ctx.body.querySelector("#irt-outbound");
  const stateEl = ctx.body.querySelector("#irt-state");
  const clearBtn = ctx.body.querySelector("#irt-clear");
  const seatEl = ctx.body.querySelector("#irt-seat");
  const seatReloadEl = ctx.body.querySelector("#irt-seat-reload");
  const pushIncomingEl = ctx.body.querySelector("#irt-push-incoming");
  const pushTransferEl = ctx.body.querySelector("#irt-push-transfer");

  // ── 모바일 알림 수신자(seat) ────────────────────────────────────
  // 테넌트 등록 seat 을 드롭다운으로. 선택값은 seatId, 부가 정보(email/ext)는
  // seatById 에 보관해 푸시 시 email 로 라우팅. active 만 노출(11.app-push 패턴).
  let seatById = {};
  function selectedSeat() {
    const id = seatEl && seatEl.value;
    return id ? seatById[id] : null;
  }
  async function loadSeats() {
    if (!ctx.client) { seatEl.innerHTML = `<option value="">로그인 후 사용 가능</option>`; return; }
    seatEl.innerHTML = `<option value="">불러오는 중…</option>`;
    try {
      const d = await ctx.client.listSeats();
      const seats = (d.seats || []).filter((s) => s.status === "active");
      seatById = {};
      if (!seats.length) {
        seatEl.innerHTML = `<option value="">등록된 모바일 사용자 없음 — 「📱 모바일 앱 사용자」에서 추가</option>`;
        return;
      }
      seatEl.innerHTML = `<option value="">(선택 안 함 — 푸시 보내지 않음)</option>` + seats.map((s) => {
        seatById[s.seatId] = s;
        const parts = [s.email];
        if (s.extension) parts.push(`내선 ${s.extension}`);
        return `<option value="${s.seatId}">${parts.join(" · ")}</option>`;
      }).join("");
    } catch (err) {
      seatEl.innerHTML = `<option value="">목록 조회 실패</option>`;
      ctx.log("err", "ivr-route:seats_load_fail", { error: String(err && err.message || err) });
    }
  }
  if (seatReloadEl) {
    seatReloadEl.addEventListener("click", (e) => { e.preventDefault(); loadSeats(); });
  }
  loadSeats();

  // sendPush: 선택한 seat 의 이메일로 subtype 푸시(best-effort). seat 미선택이면
  // 스킵. 실패는 진행 로그에 사유까지 표시(게이트웨이가 릴레이 4xx 본문 전달).
  //
  // 알림 제목/본문 템플릿의 {caller}{callerName}{did} 가 실제 값으로 치환되려면
  // 통화의 발신정보를 푸시 요청에 함께 실어야 한다(게이트웨이는 이벤트에 실린
  // caller/callerName/did 로 템플릿을 렌더한다). 활성 통화에서 꺼내 전달한다 —
  // 안 실으면 게이트웨이가 빈 값으로 치환해 "{caller}" 가 빈칸으로 보인다.
  // transferTo: 전환통화(warm_transfer) 푸시일 때만 전달하는 전환 대상 번호
  // ({transferTo} 치환용). incoming_call 등에는 빈 값.
  async function sendPush(linkedId, subtype, label, transferTo) {
    const seat = selectedSeat();
    if (!seat || !seat.email || !ctx.client) return;
    const call = ctx.getActiveCalls().get(linkedId) || {};
    // 발신번호: 인바운드는 caller, click-to-call 아웃바운드는 peer(고객번호).
    const caller = call.caller || call.peer || "";
    // 활성 통화 정보가 없으면 caller/did/callerName 변수는 빈 값으로 치환된다(정상).
    // 실제 수신 통화에서는 call:new 의 값이 채워진다 — 테스트 시 안내만 남긴다.
    if (!caller && !call.did && !call.callerName) {
      pushLog(linkedId, "ℹ 활성 통화 정보가 없어 발신번호 변수는 빈 값으로 전송돼요 (실제 통화에선 채워짐)");
    }
    try {
      await ctx.client.pushToUser({
        email: seat.email,
        subtype,
        linkedId,
        // {extension} 치환용 — 선택한 seat 의 내선. 게이트웨이도 email→seat 으로
        // 자동 채우지만 아는 값을 명시 전달해 단일 소스로 둔다.
        extension: seat.extension || "",
        caller,
        callerName: call.callerName || "",
        did: call.did || "",
        transferTo: transferTo || "",
      });
      pushLog(linkedId, `📲 ${label} 푸시 전송 → ${seat.email}${caller ? ` (발신 ${caller})` : ""}${transferTo ? ` (전환 ${transferTo})` : ""}`);
      ctx.log("ok", "ivr-route:push", { linkedId, subtype, email: seat.email, caller, extension: seat.extension || "", transferTo: transferTo || "" });
    } catch (err) {
      const m = String(err && err.message || err);
      pushLog(linkedId, `✗ ${label} 푸시 실패: ${m}`);
      ctx.log("err", "ivr-route:push:fail", { subtype, error: m });
    }
  }

  // 상호({biz}) 기준 기본 whisper 문구.
  const whisperDefault = (biz) => `${biz || "저희 업체"} 고객 연결입니다.`;

  // 프리셋 → 멘트 채우기({biz} 치환). "직접 입력"이면 비우고 사용자가 작성.
  // 사용자가 멘트를 수동 편집한 뒤에는 프리셋/상호 변경이 덮어쓰지 않도록 가드.
  let greetEdited = false;
  let whisperEdited = false;
  function applyPreset() {
    const biz = bizEl.value.trim();
    // whisper 는 프리셋과 무관하게 상호만 반영(사용자 미편집 시).
    if (!whisperEdited) whisperEl.value = whisperDefault(biz);
    const p = PRESETS.find((x) => x.id === presetEl.value) || PRESETS[0];
    if (p.id === "custom") {
      if (!greetEdited) greetEl.value = "";
      return;
    }
    if (!greetEdited) {
      greetEl.value = p.text.replace(/\{biz\}/g, biz || "저희 업체");
    }
  }
  presetEl.addEventListener("change", () => { greetEdited = false; applyPreset(); });
  bizEl.addEventListener("input", applyPreset);
  greetEl.addEventListener("input", () => { greetEdited = true; });
  whisperEl.addEventListener("input", () => { whisperEdited = true; });
  applyPreset(); // 초기 멘트 채우기

  // ── 진행 상황 로그 (sms-optout 패턴) ────────────────────────────
  const log = [];
  function renderLog() {
    if (log.length === 0) {
      stateEl.innerHTML = `<p class="muted small">대기 중 — 통화가 연결되면 여기에 단계별 진행 상황이 표시돼요.</p>`;
      return;
    }
    stateEl.innerHTML = log.slice(-20).reverse().map((e) => `
      <div class="line">
        <span class="speaker">${e.linkedId}</span> ${e.msg}
        <span class="muted small">${new Date(e._t).toLocaleTimeString()}</span>
      </div>
    `).join("");
  }
  function pushLog(linkedId, msg) {
    log.push({ linkedId, msg, _t: Date.now() });
    if (log.length > 40) log.shift();
    renderLog();
  }

  // Clear — 진행 상황 로그를 비운다(진행 중인 통화나 가드 상태는 건드리지 않음,
  // 화면 정리 용도). 활성 통화가 다시 단계를 진행하면 새 줄이 쌓인다.
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      log.length = 0;
      renderLog();
    });
  }

  // ── TTS 재생 (mode 무관 폴백) ───────────────────────────────────
  async function speak(linkedId, text, label) {
    try {
      const t0 = Date.now();
      await ctx.safeInjectText(linkedId, text);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      pushLog(linkedId, `${label || `🔊 "${text.slice(0, 30)}${text.length > 30 ? "…" : ""}"`} · ${secs}s`);
      ctx.log("ok", "soho-route:tts", { linkedId, text, mode: ctx.providerMode?.() });
    } catch (err) {
      pushLog(linkedId, `✗ TTS 실패: ${err.message}`);
      ctx.log("err", "soho-route:tts:fail", { error: err.message });
    }
  }

  // ── warm transfer 연결 ──────────────────────────────────────────
  async function routeTo(linkedId, dest, outbound) {
    const whisper = whisperEl.value.trim();
    pushLog(linkedId, `🔀 담당자 연결 중… (${dest}${outbound ? " · 외부" : " · 내선"}${whisper ? " · 안내멘트" : ""})`);
    ctx.log("info", "soho-route:transfer:start", { linkedId, dest, outbound, whisper: !!whisper });

    // 전환통화 알림 — 전환이 "시작되는" 시점에 발사한다(연결 성사 후가 아님).
    // warmTransfer 는 담당자 응답까지 최대 30초 블로킹하므로, 성사 후 푸시하면
    // 너무 늦다. 담당자/사장이 "지금 전환 전화가 걸려온다"를 연결 전에 받게 한다.
    // (토글 ON + seat 선택 시. fire-and-forget — 전환 진행을 막지 않는다.)
    if (pushTransferEl && pushTransferEl.checked) sendPush(linkedId, "warm_transfer", "전환통화", dest);

    try {
      const r = await ctx.client.warmTransfer(linkedId, {
        destination: dest,
        // whisper: 담당자가 받는 순간 담당자에게만 들려주는 안내(고객엔 안 들림).
        whisperText: whisper || undefined,
        timeoutMs: 30000,
        outbound,
        // 외부발신이면 트렁크 컨텍스트가 필요(운영 환경에 맞게 조정). 내선이면 기본값.
        context: outbound ? "cos-all" : "from-internal",
      });
      if (r && r.connected) {
        pushLog(linkedId, `✓ 담당자 연결 완료 (${dest})${r.whisperPlayed ? " · 안내멘트 재생됨" : ""}`);
      } else {
        const reason = (r && (r.failureReason || r.whisperSkipReason)) || "응답 없음/거절";
        pushLog(linkedId, `⚠ 담당자 연결 안 됨: ${reason}`);
      }
      ctx.log(r && r.connected ? "ok" : "warn", "soho-route:transfer:result", r || {});
    } catch (err) {
      pushLog(linkedId, `✗ 연결 실패: ${err.message}`);
      ctx.log("err", "soho-route:transfer:fail", { error: err.message });
    }
  }

  // ── 통화별 상태머신 ─────────────────────────────────────────────
  // sessions: linkedId → { phase: "greeting"|"routing"|"done" }
  const sessions = new Map();

  async function beginSession(linkedId) {
    if (!ctx.client || !linkedId || sessions.has(linkedId)) return;
    sessions.set(linkedId, { phase: "greeting" });

    // 0) 전화수신 알림 — 통화가 연결된 시점에 푸시(토글 ON + seat 선택 시).
    //    인사말 재생 전에 발사해 사장/담당자가 "전화 왔다"를 즉시 받게 한다.
    if (pushIncomingEl && pushIncomingEl.checked) sendPush(linkedId, "incoming_call", "전화수신");

    // 1) 인사말은 담당자 번호 유무와 무관하게 항상 들려준다 — 소호 안내 멘트는
    //    번호를 안 넣어도 "인사말만" 체험할 수 있어야 한다(연결 단계만 번호 필요).
    const greet = greetEl.value.trim();
    if (greet) {
      pushLog(linkedId, "⏳ 연결됨 — 잠시 후 인사말을 재생해요");
      await new Promise((r) => setTimeout(r, GREETING_DELAY_MS));
      await speak(linkedId, greet, "📢 인사말 재생");
    }

    // 2) 인사말이 끝나면 담당자 연결. 번호가 비어 있으면 연결만 건너뛴다
    //    (인사말은 이미 재생됨). 통화가 재생 중 끊겼으면 중단.
    const s = sessions.get(linkedId);
    if (!s) return;
    const dest = destEl.value.trim();
    if (!dest) {
      pushLog(linkedId, "⚠ 담당자 번호가 비어 있어 연결은 생략했어요 — 위에 연결할 번호를 입력하면 다음 통화부터 연결됩니다");
      s.phase = "done";
      return;
    }
    s.phase = "routing";
    await routeTo(linkedId, dest, outboundEl.checked);
    if (sessions.get(linkedId)) sessions.get(linkedId).phase = "done";
  }

  // 한 물리 통화당 1회만 처리하기 위한 가드. click-to-call 아웃바운드는 Local
  // 채널로 같은 통화에 여러 leg(서로 다른 linkedId)를 만들고, 각 leg 가 channel:state
  // up 을 내보낸다. 그런데 보조 Local leg 는 call:new 를 받지 못한다(메인 통화만
  // call:new). 따라서:
  //   · call:new 를 받은 linkedId 만 "처리 대상 메인 통화"로 인정(mainCalls)하고,
  //   · 그 통화의 leg=="a" up 에서만 1회(handledCalls) beginSession.
  //   · 추가로, 동시에 1건만 라우팅(routingActive)해 중복 originate("Allocation
  //     failed")를 원천 차단한다 — 소호 단일 회선 시나리오는 동시 다발 통화를
  //     가정하지 않는다.
  // 보조 leg(b)·스눕·call:new 없는 leg 는 무시한다.
  const mainCalls = new Set();    // call:new 를 받은 메인 linkedId
  const handledCalls = new Set(); // 이미 beginSession 한 메인 linkedId
  let routingActive = false;      // 현재 인사말/연결 진행 중인 통화가 있나

  async function maybeBegin(linkedId) {
    if (!linkedId || handledCalls.has(linkedId)) return;
    if (!mainCalls.has(linkedId)) return; // call:new 없는 보조 leg → 무시
    if (routingActive) return;            // 이미 한 통화 처리 중 → 중복 방지
    handledCalls.add(linkedId);
    routingActive = true;
    try {
      await beginSession(linkedId);
    } finally {
      routingActive = false;
    }
  }

  // 이미 연결(up)된 활성 통화가 있으면 템플릿을 켠 즉시 시작(메인 통화 하나만).
  // 템플릿을 통화 도중 켠 경우 call:new 를 못 봤을 수 있으므로, 활성 통화는
  // mainCalls 로 인정해 준다(이 경우 이미 게이트웨이가 1:1 통화로 추적 중).
  const live = Array.from(ctx.getActiveCalls().values());
  const upCall = live.find((c) => c.state === "up" || c.channelState === "up");
  if (upCall) {
    mainCalls.add(upCall.linkedId);
    maybeBegin(upCall.linkedId);
  } else if (live.length) {
    pushLog(live[0].linkedId, "📞 통화가 연결되면 자동으로 인사말 → 담당자 연결을 시작해요 (벨 울리는 중 대기)");
  }

  const handler = async (e) => {
    if (!ctx.client) return;
    const evt = e.detail;

    // call:new → 메인 통화로 등록(보조 Local leg 와 구분하는 기준).
    if (evt.event === "call:new" && evt.linkedId) {
      mainCalls.add(evt.linkedId);
      return;
    }

    // 0) 통화 종료 → 세션/로그/가드 정리. 메인 통화가 끝나면 routingActive 해제.
    if (evt.event === "call:ended" && evt.linkedId) {
      sessions.delete(evt.linkedId);
      if (handledCalls.has(evt.linkedId)) routingActive = false;
      handledCalls.delete(evt.linkedId);
      mainCalls.delete(evt.linkedId);
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].linkedId === evt.linkedId) log.splice(i, 1);
      }
      renderLog();
      return;
    }

    // 1) 통화 연결 → 인사말 → 담당자 연결.
    //    leg=="a"(최초 채널) up 만 발동 — 보조 leg(b)·스눕은 무시.
    //    leg 정보가 없는 구버전 이벤트는 그대로 허용(maybeBegin 가 다중 가드).
    if (evt.event === "channel:state" && evt.state === "up" && evt.linkedId) {
      if (evt.leg && evt.leg !== "a") return;
      await maybeBegin(evt.linkedId);
      return;
    }
  };

  if (ctx.client) ctx.client.addEventListener("event", handler);
  return () => {
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

export default { mount, code: CODE };
