// App push / notifications (앱 푸시·알림) — 연동된 모바일 앱으로 푸시 전송.
//
// 대상은 테넌트에 등록된 모바일 사용자(seat) 목록에서 고른다(직접 입력 X). 푸시는
// 그 사용자의 이메일로 라우팅된다(email → userId → fcm_token). 게이트웨이가 FCM
// 릴레이(Cloud Function)에 HMAC 서명 전달. 모든 이벤트는 dvg_event{subtype} 스키마.
//
// 사전 요구: 게이트웨이에 푸시 릴레이가 설정돼 있어야 합니다
//   GW_WARM_TRANSFER_PUSH_ENABLED=true + _URL + _SECRET.
// 미설정이면 503 으로 응답하며, 이 템플릿은 그 경우를 안내합니다.
//
// 프리셋 3종으로 다양한 푸시를 바로 테스트:
//   · 범용(custom)    — 임의 subtype + data
//   · 통화 요약(call_summary) — summaryUrl/transcriptUrl/audioUrl (내선 기반)
//   · 부재중(missed_call)     — callerNumber/callerName
//
// 추가로 "전화 수신 시 자동 푸시" 토글 — call:new 마다 통화 DID 에 매핑된 seat
// (없으면 선택한 사용자)에게 subtype="incoming_call" + receiverEmail 을 발사하는
// 데모. 운영에서는 게이트웨이가 GW_PUSH_ON_CALL_NEW=true 일 때 서버측에서 같은
// 푸시를 자동 멀티캐스트한다(앱은 따로 켤 필요 없음).
//
// 우측에 Android/iOS 앱 설치 QR(오프라인 생성, 외부 의존 없음)을 표시.

import { renderQr } from "../lib/qrcode.js";

const ANDROID_URL = "https://play.google.com/store/apps/details?id=com.olssoo.makecall_app";
const IOS_URL = "https://apps.apple.com/kr/app/makecall/id6475055702";

// 공식 스토어 배지 스타일을 인라인 SVG로 재현(외부 이미지/다운로드 없음 →
// 오프라인·폐쇄망에서도 동작, 외부 서버 의존 0). 검정 라운드 버튼 +
// 스토어 아이콘 + "GET IT ON / Google Play", "Download on the / App Store".
// 폭 132로 QR과 동일 정렬.
const BADGE_W = 132;
const BADGE_H = 40;

// Google Play 삼각 재생 아이콘(4색) + 텍스트
const GOOGLE_PLAY_SVG = `
<svg width="${BADGE_W}" height="${BADGE_H}" viewBox="0 0 132 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Get it on Google Play">
  <rect x="0.5" y="0.5" width="131" height="39" rx="6" fill="#000" stroke="#a6a6a6" stroke-width="1"/>
  <g transform="translate(11,10)">
    <path d="M0 0.6 L0 19.4 L10 10 Z" fill="#00d2ff"/>
    <path d="M0 0.6 L13.8 8.0 L10 10 Z" fill="#00f076"/>
    <path d="M0 19.4 L13.8 12.0 L10 10 Z" fill="#fc3349"/>
    <path d="M13.8 8.0 L18 10 L13.8 12.0 L10 10 Z" fill="#ffce00"/>
  </g>
  <text x="40" y="15" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="7" letter-spacing="0.5">GET IT ON</text>
  <text x="40" y="30" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="600">Google Play</text>
</svg>`;

// Apple 로고 + 텍스트
const APP_STORE_SVG = `
<svg width="${BADGE_W}" height="${BADGE_H}" viewBox="0 0 132 40" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Download on the App Store">
  <rect x="0.5" y="0.5" width="131" height="39" rx="6" fill="#000" stroke="#a6a6a6" stroke-width="1"/>
  <path fill="#fff" transform="translate(12,9) scale(0.9)" d="M14.94 11.07c-.02-2.06 1.68-3.05 1.76-3.1-0.96-1.4-2.45-1.6-2.98-1.62-1.27-.13-2.48.75-3.12.75-.64 0-1.64-.73-2.7-.71-1.39.02-2.67.81-3.38 2.05-1.44 2.5-.37 6.2 1.04 8.23.69.99 1.51 2.1 2.58 2.06 1.04-.04 1.43-.67 2.69-.67 1.25 0 1.61.67 2.7.65 1.12-.02 1.83-1 2.51-2 .79-1.15 1.12-2.26 1.14-2.32-.03-.01-2.18-.84-2.2-3.32zM12.9 5.01c.56-.69.94-1.63.84-2.59-.81.03-1.81.54-2.39 1.22-.52.6-.98 1.58-.86 2.5.91.07 1.84-.46 2.41-1.13z"/>
  <text x="32" y="15" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="7" letter-spacing="0.3">Download on the</text>
  <text x="32" y="30" fill="#fff" font-family="Arial,Helvetica,sans-serif" font-size="15" font-weight="600">App Store</text>
</svg>`;

const CODE = `// SDK로 동일하게:
import { DVGatewayClient } from "dvgateway-sdk";
const client = new DVGatewayClient({ baseUrl, auth: { type: "apiKey", apiKey } });

// 0) 테넌트에 등록된 모바일 사용자(seat) 목록 — 푸시 대상 선택용
const { seats } = await client.listSeats();   // [{ seatId, email, extension, did, status }]
const target = seats.find((s) => s.status === "active");

// 1) 범용 푸시 — 이메일로 라우팅 (email → userId → fcm_token)
await client.pushToUser({
  email: target.email,
  subtype: "custom",
  title: "공지",
  body: "잠시 후 회의가 시작됩니다",
  data: { room: "A-301" },
});

// 2) 통화 종료 후 결과 링크 (짧은 만료 서명 URL 권장) — 내선 기반
await client.notifyCallSummary(linkedId, {
  extension: target.extension,
  summaryUrl: "https://.../s/abc",
  audioUrl:   "https://.../a/abc",
});

// 3) 부재중 — 이메일로
await client.pushToUser({
  email: target.email,
  subtype: "missed_call",
  data: { caller_number: "01012345678", caller_name: "홍길동" },
});

// 4) 전화 수신 — 운영은 게이트웨이가 자동(GW_PUSH_ON_CALL_NEW): 통화 DID 에
//    매핑된 seat 전원에게 incoming_call + receiverEmail 을 서버측 멀티캐스트.
//    클라이언트가 직접 쏘려면(데모):
client.addEventListener("event", (e) => {
  const evt = e.detail;
  if (evt.event !== "call:new") return;
  const recipients = seats
    .filter((s) => s.status === "active" && s.did === evt.did)
    .map((s) => s.email);
  for (const email of recipients) {
    client.pushToUser({
      email, subtype: "incoming_call",
      title: "수신 전화", body: evt.callerName || evt.caller,
      linkedId: evt.linkedId, did: evt.did,
      caller: evt.caller, callerName: evt.callerName,
    });
  }
});`;

function mount(ctx) {
  ctx.body.innerHTML = `
    <p class="help">연동된 <b>모바일 앱</b> 사용자에게 푸시를 보냅니다. 아래에서 <b>테넌트에 등록된 모바일 사용자(seat)</b>를 골라요 — 직접 입력할 필요 없어요. 푸시는 그 사용자의 <b>이메일</b>로 라우팅돼요(<code>email → userId → fcm_token</code>). <b>사전 요구</b>: 게이트웨이에 푸시 릴레이(<code>GW_WARM_TRANSFER_PUSH_ENABLED</code> + URL + SECRET)가 설정돼 있어야 합니다 — 미설정이면 503으로 안내해요.</p>

    <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap;">
     <div style="flex:1 1 360px;min-width:300px;">

    <div class="field">
      <label>대상 모바일 사용자 (seat)
        <select id="ap-seat"><option value="">불러오는 중…</option></select>
      </label>
      <p class="help">테넌트에 등록된 모바일 앱 사용자 목록이에요. 선택하면 그 사용자의 이메일로 푸시가 가요. 목록이 비었으면 위 「📱 모바일 앱 사용자」 관리에서 먼저 등록하세요. <a href="#" id="ap-seat-reload">새로고침</a></p>
    </div>

    <div class="field">
      <label>푸시 종류
        <select id="ap-kind">
          <option value="custom">범용 (custom)</option>
          <option value="call_summary">통화 요약 (call_summary)</option>
          <option value="missed_call">부재중 (missed_call)</option>
        </select>
      </label>
    </div>

    <!-- custom -->
    <div class="ap-pane" data-kind="custom">
      <div class="field"><label>subtype <input id="ap-subtype" type="text" value="custom" /></label></div>
      <div class="field"><label>title <input id="ap-title" type="text" placeholder="공지" /></label></div>
      <div class="field"><label>body <input id="ap-body" type="text" placeholder="잠시 후 회의가 시작됩니다" /></label></div>
      <div class="field"><label>data (JSON, 문자열 맵)
        <textarea id="ap-data" placeholder='{"room":"A-301"}'></textarea></label>
        <p class="help">앱이 subtype 별로 해석하는 추가 필드. 값은 모두 문자열로 전송돼요.</p>
      </div>
    </div>

    <!-- call_summary -->
    <div class="ap-pane" data-kind="call_summary" style="display:none;">
      <div class="field"><label>linkedId (어느 통화의 요약인가)
        <input id="ap-linked" type="text" placeholder="활성 통화에서 선택하거나 직접 입력" /></label>
      </div>
      <div class="field"><label>summaryUrl <input id="ap-summary" type="text" placeholder="https://.../s/abc" /></label></div>
      <div class="field"><label>transcriptUrl <input id="ap-transcript" type="text" placeholder="https://.../t/abc" /></label></div>
      <div class="field"><label>audioUrl <input id="ap-audio" type="text" placeholder="https://.../a/abc" /></label></div>
      <p class="help">세 URL 중 <b>최소 한 개</b>는 필요해요. 운영에서는 <b>짧은 만료 서명 URL</b>을 쓰세요. 활성 통화가 있으면 아래에서 골라 linkedId를 채울 수 있어요.</p>
      <div id="ap-calls" class="muted small"></div>
    </div>

    <!-- missed_call -->
    <div class="ap-pane" data-kind="missed_call" style="display:none;">
      <div class="field"><label>callerNumber <input id="ap-caller-num" type="text" placeholder="01012345678" /></label></div>
      <div class="field"><label>callerName <input id="ap-caller-name" type="text" placeholder="홍길동" /></label></div>
    </div>

    <div class="field" style="margin-top:12px;">
      <label>빠른 예시 <span class="muted small">— 클릭하면 값이 채워져요 (전문가는 위에서 직접 입력)</span></label>
      <div id="ap-presets" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;"></div>
    </div>

    <div style="margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      <button id="ap-send" class="primary">푸시 전송</button>
      <button id="ap-clear" type="button">입력 지우기</button>
      <label class="muted small" style="display:flex;align-items:center;gap:4px;">
        <input id="ap-autosend" type="checkbox" checked /> 예시 클릭 시 바로 발송
      </label>
    </div>

    <div class="field" style="margin-top:12px;padding:10px;border:1px dashed var(--border,#444);border-radius:6px;">
      <label style="display:flex;align-items:center;gap:6px;">
        <input id="ap-incoming" type="checkbox" /> <b>📞 전화 수신 시 자동 푸시</b>
      </label>
      <p class="help">켜 두면 인바운드 통화가 들어올 때(<code>call:new</code>) <b>선택한 사용자</b>에게 <code>subtype="incoming_call"</code> + <code>receiverEmail</code> 푸시를 자동 발사합니다 — 단말 도달 전(IVR/시스템 선응답)에도 이메일로 수신자를 깨워요. <span class="muted">이건 데모용 클라이언트 트리거예요. 운영에서는 게이트웨이가 <code>GW_PUSH_ON_CALL_NEW=true</code> 일 때 통화의 대표번호(DID)에 매핑된 seat 들에게 <b>서버측에서 자동</b>으로 같은 푸시를 멀티캐스트합니다 — 앱은 따로 켤 필요 없어요.</span></p>
    </div>

    <div class="transcript" id="ap-result" style="margin-top:16px;">
      <p class="muted small">대기 중 — <b>대상 사용자</b>를 고르고 위의 <b>빠른 예시</b>를 클릭하면 바로 발송돼요. 세부 값은 직접 입력해도 됩니다.</p>
    </div>

     </div><!-- /left column -->

     <div style="flex:0 0 auto;min-width:180px;">
       <div class="field" style="margin-top:0;">
         <label>📱 받을 앱 설치 <span class="muted small">— 폰으로 QR 스캔</span></label>
         <p class="help">푸시는 이 앱을 설치하고 <b>로그인·내선 등록</b>을 마친 기기로 도착해요.</p>
       </div>
       <div style="display:flex;gap:16px;flex-wrap:wrap;">
         <div style="text-align:center;width:132px;">
           <a href="${ANDROID_URL}" target="_blank" rel="noopener" title="Android — Google Play"
              style="display:block;margin-bottom:6px;line-height:0;">${GOOGLE_PLAY_SVG}</a>
           <canvas id="ap-qr-android" title="Android — Google Play" style="display:block;border:1px solid var(--border,#333);border-radius:6px;"></canvas>
         </div>
         <div style="text-align:center;width:132px;">
           <a href="${IOS_URL}" target="_blank" rel="noopener" title="iOS — App Store"
              style="display:block;margin-bottom:6px;line-height:0;">${APP_STORE_SVG}</a>
           <canvas id="ap-qr-ios" title="iOS — App Store" style="display:block;border:1px solid var(--border,#333);border-radius:6px;"></canvas>
         </div>
       </div>
     </div><!-- /qr column -->

    </div><!-- /flex row -->
  `;

  const $ = (sel) => ctx.body.querySelector(sel);
  const kindEl = $("#ap-kind");
  const resultEl = $("#ap-result");
  const result = [];

  // ── 모바일 사용자(seat) 목록 ───────────────────────────────────────
  // 테넌트 등록 seat 을 드롭다운으로. 선택값은 seatId, 부가 정보(email/ext/did)는
  // seatById 에 보관해 발송 시 꺼내 쓴다. active 상태만 노출(보류·보관 제외).
  let seatById = {};
  const seatEl = $("#ap-seat");
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
      seatEl.innerHTML = seats.map((s) => {
        seatById[s.seatId] = s;
        const parts = [s.email];
        if (s.extension) parts.push(`내선 ${s.extension}`);
        if (s.did) parts.push(`수신 ${s.did}`);
        return `<option value="${s.seatId}">${parts.join(" · ")}</option>`;
      }).join("");
    } catch (err) {
      const m = String(err && err.message || err);
      seatEl.innerHTML = `<option value="">목록 조회 실패</option>`;
      ctx.log("err", "push:seats_load_fail", { error: m });
      pushResult(false, `모바일 사용자 목록 조회 실패: ${m}`);
    }
  }

  // 앱 설치 QR (오프라인 생성). 실패해도 링크는 남으므로 치명적 아님.
  try {
    renderQr($("#ap-qr-android"), ANDROID_URL, { size: 132 });
    renderQr($("#ap-qr-ios"), IOS_URL, { size: 132 });
  } catch (e) {
    ctx.log("warn", "push:qr_render_failed", { error: String(e && e.message || e) });
  }

  function pushResult(ok, msg) {
    result.push({ ok, msg, _t: Date.now() });
    if (result.length > 30) result.shift();
    resultEl.innerHTML = result.slice(-20).reverse().map((e) => `
      <div class="line">
        <span class="speaker">${e.ok ? "✓" : "✗"}</span> ${e.msg}
        <span class="muted small">${new Date(e._t).toLocaleTimeString()}</span>
      </div>
    `).join("");
  }

  function showPane() {
    const kind = kindEl.value;
    ctx.body.querySelectorAll(".ap-pane").forEach((p) => {
      p.style.display = p.dataset.kind === kind ? "" : "none";
    });
    if (kind === "call_summary") renderCalls();
    renderPresets();
  }
  kindEl.addEventListener("change", showPane);

  // 활성 통화 목록 → 클릭하면 linkedId 채움 (call_summary 편의)
  function renderCalls() {
    const calls = Array.from(ctx.getActiveCalls().values());
    const box = $("#ap-calls");
    if (!box) return;
    if (!calls.length) { box.textContent = "활성 통화 없음 — linkedId를 직접 입력하세요."; return; }
    box.innerHTML = "활성 통화: " + calls.map((c) =>
      `<a href="#" data-lid="${c.linkedId}">${c.linkedId}</a>`).join(" · ");
    box.querySelectorAll("a").forEach((a) => a.addEventListener("click", (ev) => {
      ev.preventDefault();
      $("#ap-linked").value = a.dataset.lid;
    }));
  }

  // ── 빠른 예시 프리셋 ───────────────────────────────────────────
  // 종류별로 필드를 한 번에 채우는 예시. 테스트하는 사람이 "뭘 입력하지?"
  // 고민 없이 클릭만으로 바로 발송해볼 수 있게. 전문가는 위 입력란에 직접.
  // linkedId 처럼 환경에 따라 달라지는 값은 활성 통화에서 자동 보충한다.
  const PRESETS = {
    custom: [
      { label: "📢 공지", fields: { subtype: "announcement", title: "공지사항", body: "잠시 후 전체 회의가 시작됩니다", data: '{"room":"A-301"}' } },
      { label: "🟢 상태(통화중)", fields: { subtype: "agent_status", title: "상태 변경", body: "통화 중으로 전환됨", data: '{"status":"busy"}' } },
      { label: "🔔 대기열 경고", fields: { subtype: "queue_alert", title: "대기열 알림", body: "대기 통화 5건 초과", data: '{"queue":"support","waiting":"5"}' } },
    ],
    call_summary: [
      { label: "📝 요약+녹취", fields: { summary: "https://example.com/s/demo", transcript: "https://example.com/t/demo", audio: "https://example.com/a/demo" } },
      { label: "📄 요약만", fields: { summary: "https://example.com/s/demo" } },
      { label: "🎧 녹취만", fields: { audio: "https://example.com/a/demo" } },
    ],
    missed_call: [
      { label: "📵 휴대폰", fields: { callerNum: "01012345678", callerName: "홍길동" } },
      { label: "📵 번호만", fields: { callerNum: "0212345678", callerName: "" } },
    ],
  };

  // 종류별 필드 id 매핑 (지우기·채우기 공용)
  const FIELD_IDS = {
    custom: { subtype: "#ap-subtype", title: "#ap-title", body: "#ap-body", data: "#ap-data" },
    call_summary: { linked: "#ap-linked", summary: "#ap-summary", transcript: "#ap-transcript", audio: "#ap-audio" },
    missed_call: { callerNum: "#ap-caller-num", callerName: "#ap-caller-name" },
  };

  function fillFields(kind, fields) {
    const ids = FIELD_IDS[kind];
    for (const [key, sel] of Object.entries(ids)) {
      if (key in fields) { const el = $(sel); if (el) el.value = fields[key]; }
    }
    // call_summary 는 linkedId 가 있어야 발송 가능 — 비어 있으면 활성 통화에서 보충.
    if (kind === "call_summary") {
      const linkedEl = $("#ap-linked");
      if (linkedEl && !linkedEl.value.trim()) {
        const calls = Array.from(ctx.getActiveCalls().values());
        if (calls.length) linkedEl.value = calls[0].linkedId;
      }
    }
  }

  function clearFields(kind) {
    const ids = FIELD_IDS[kind || kindEl.value];
    for (const sel of Object.values(ids)) { const el = $(sel); if (el) el.value = ""; }
    if ((kind || kindEl.value) === "custom") { const s = $("#ap-subtype"); if (s) s.value = "custom"; }
  }

  function renderPresets() {
    const box = $("#ap-presets");
    if (!box) return;
    const kind = kindEl.value;
    box.innerHTML = (PRESETS[kind] || []).map((p, i) =>
      `<button type="button" class="ap-preset small" data-idx="${i}">${p.label}</button>`).join("");
    box.querySelectorAll(".ap-preset").forEach((b) => b.addEventListener("click", async () => {
      const p = PRESETS[kind][Number(b.dataset.idx)];
      fillFields(kind, p.fields);
      // "바로 발송" 체크 시 채우고 즉시 전송 (대상 사용자가 선택됐을 때만).
      if ($("#ap-autosend").checked) {
        if (!selectedSeat()) { pushResult(false, "예시를 채웠어요 — 대상 모바일 사용자를 고르고 「푸시 전송」을 눌러주세요."); return; }
        await send();
      } else {
        pushResult(true, `예시 채움: ${p.label} — 확인 후 「푸시 전송」`);
      }
    }));
  }

  async function send() {
    if (!ctx.client) { pushResult(false, "먼저 왼쪽 「1. 게이트웨이 연결」에서 로그인해 주세요."); return; }
    const seat = selectedSeat();
    if (!seat) { pushResult(false, "대상 모바일 사용자를 선택하세요"); return; }
    const who = seat.email;
    const kind = kindEl.value;
    const btn = $("#ap-send");
    btn.disabled = true;
    try {
      let res;
      if (kind === "custom") {
        const subtype = $("#ap-subtype").value.trim() || "custom";
        let data;
        const raw = $("#ap-data").value.trim();
        if (raw) {
          try { data = JSON.parse(raw); }
          catch { pushResult(false, "data 가 올바른 JSON이 아니에요"); btn.disabled = false; return; }
        }
        res = await ctx.client.pushToUser({
          email: seat.email, subtype,
          title: $("#ap-title").value.trim() || undefined,
          body: $("#ap-body").value.trim() || undefined,
          data,
        });
        pushResult(true, `전송됨 · subtype=${res.subtype || subtype} → ${who}`);
        ctx.log("ok", "push:user", { email: seat.email, subtype });
      } else if (kind === "call_summary") {
        // 통화요약 엔드포인트는 extension 기반 — seat 에 내선이 있어야 발송 가능.
        if (!seat.extension) { pushResult(false, `통화요약 푸시는 내선이 필요해요 — 선택한 사용자(${who})에게 내선이 없어요. 다른 사용자를 고르거나 seat 에 내선을 지정하세요.`); btn.disabled = false; return; }
        const linkedId = $("#ap-linked").value.trim();
        if (!linkedId) { pushResult(false, "linkedId 를 입력하세요"); btn.disabled = false; return; }
        res = await ctx.client.notifyCallSummary(linkedId, {
          extension: seat.extension,
          summaryUrl: $("#ap-summary").value.trim() || undefined,
          transcriptUrl: $("#ap-transcript").value.trim() || undefined,
          audioUrl: $("#ap-audio").value.trim() || undefined,
        });
        pushResult(true, `통화요약 푸시 전송됨 · linkedId=${linkedId} → ${who} (내선 ${seat.extension})`);
        ctx.log("ok", "push:call_summary", { extension: seat.extension, linkedId });
      } else { // missed_call
        const data = {};
        const cn = $("#ap-caller-num").value.trim();
        const cnm = $("#ap-caller-name").value.trim();
        if (cn) data.caller_number = cn;
        if (cnm) data.caller_name = cnm;
        res = await ctx.client.pushToUser({
          email: seat.email,
          subtype: "missed_call",
          title: cnm || cn || undefined,
          body: cn || undefined,
          data,
        });
        pushResult(true, `부재중 푸시 전송됨 → ${who}`);
        ctx.log("ok", "push:missed_call", { email: seat.email });
      }
    } catch (err) {
      const m = String(err && err.message || err);
      // 503 = 릴레이 미설정. 사용자가 바로 알 수 있게 안내.
      if (m.includes("(503)")) {
        pushResult(false, "푸시 릴레이가 게이트웨이에 설정되지 않았어요 (GW_WARM_TRANSFER_PUSH_ENABLED + URL + SECRET). 운영자에게 설정을 요청하세요.");
      } else if (m.includes("(404)")) {
        pushResult(false, "해당 사용자(이메일)로 등록된 기기가 없어요 — 앱에서 로그인·기기 승인이 끝났는지 확인하세요.");
      } else {
        pushResult(false, m);
      }
      ctx.log("err", "push:fail", { error: m });
    } finally {
      btn.disabled = false;
    }
  }

  $("#ap-send").addEventListener("click", send);
  $("#ap-clear").addEventListener("click", () => {
    clearFields();
    pushResult(true, "입력을 지웠어요");
  });

  // ── 전화 수신 시 자동 푸시 (incoming_call + receiverEmail) ──────────
  // 토글이 켜져 있으면 call:new 마다 수신 대상에게 incoming_call 푸시를 한 번
  // 발사한다(데모: 클라이언트 트리거). 운영은 게이트웨이가 통화 DID 에 매핑된 seat
  // 전원에게 서버측 자동 멀티캐스트한다(GW_PUSH_ON_CALL_NEW). 여기서는 통화 DID 에
  // 매핑된 seat 들(없으면 선택한 사용자)에게 보낸다. 같은 통화 중복 발사 방지.
  const pushedIncoming = new Set();
  async function autoPushIncoming(evt) {
    if (!ctx.client || !evt.linkedId || pushedIncoming.has(evt.linkedId)) return;
    // 대상 이메일: 통화 대표번호(DID)에 매핑된 active seat 들 → 없으면 선택한 사용자.
    let targets = [];
    if (evt.did) {
      targets = Object.values(seatById)
        .filter((s) => s.status === "active" && (s.did || "").trim() === String(evt.did).trim())
        .map((s) => s.email);
    }
    if (!targets.length && selectedSeat()) targets = [selectedSeat().email];
    if (!targets.length) {
      pushResult(false, "자동 푸시: 수신 대상을 알 수 없어요 — 통화 DID 에 매핑된 seat 이 없고 선택된 사용자도 없어요.");
      return;
    }
    pushedIncoming.add(evt.linkedId);
    let okCount = 0;
    for (const email of targets) {
      try {
        await ctx.client.pushToUser({
          email,
          subtype: "incoming_call",
          title: "수신 전화",
          body: evt.callerName || evt.caller || "전화가 왔어요",
          linkedId: evt.linkedId,
          did: evt.did || undefined,
          caller: evt.caller || undefined,
          callerName: evt.callerName || undefined,
        });
        okCount++;
        ctx.log("ok", "push:incoming_call", { email, linkedId: evt.linkedId });
      } catch (err) {
        const m = String(err && err.message || err);
        if (m.includes("(503)")) {
          pushResult(false, "자동 푸시 실패: 릴레이 미설정 (GW_WARM_TRANSFER_PUSH_ENABLED + URL + SECRET).");
        } else if (m.includes("(404)")) {
          pushResult(false, `자동 푸시: ${email} 으로 등록된 기기가 없어요(스킵).`);
        } else {
          pushResult(false, `자동 푸시 실패(${email}): ${m}`);
        }
        ctx.log("err", "push:incoming_fail", { email, error: m });
      }
    }
    if (okCount) pushResult(true, `📞 수신 자동 푸시 → ${okCount}명 (통화 ${evt.linkedId})`);
    else pushedIncoming.delete(evt.linkedId); // 전부 실패면 재시도 가능
  }

  // call:new → (토글 시) 자동 푸시 / call:ended 시 call_summary 통화목록 갱신
  const handler = (e) => {
    const evt = e.detail;
    if (evt.event === "call:new" && $("#ap-incoming") && $("#ap-incoming").checked) {
      autoPushIncoming(evt);
    }
    if (evt.event === "call:ended" && evt.linkedId) {
      pushedIncoming.delete(evt.linkedId);
    }
    if (kindEl.value === "call_summary" &&
        (evt.event === "call:new" || evt.event === "call:ended")) {
      renderCalls();
    }
  };
  if (ctx.client) ctx.client.addEventListener("event", handler);

  // 모바일 사용자(seat) 드롭다운 로드 + 새로고침 링크.
  const reloadLink = $("#ap-seat-reload");
  if (reloadLink) reloadLink.addEventListener("click", (ev) => { ev.preventDefault(); loadSeats(); });
  loadSeats();

  showPane();
  return () => {
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

export default { mount, code: CODE };
