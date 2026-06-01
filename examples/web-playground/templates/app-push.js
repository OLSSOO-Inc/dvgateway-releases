// App push / notifications (앱 푸시·알림) — 연동된 모바일 앱으로 푸시 전송.
//
// 게이트웨이가 extension → userId → fcm_token 매핑(앱 온보딩 산출물)으로 라우팅해
// FCM 릴레이(Cloud Function)에 HMAC 서명 전달합니다. 모든 이벤트는
// dvg_event{subtype} 단일 스키마.
//
// 사전 요구: 게이트웨이에 푸시 릴레이가 설정돼 있어야 합니다
//   GW_WARM_TRANSFER_PUSH_ENABLED=true + _URL + _SECRET.
// 미설정이면 503 으로 응답하며, 이 템플릿은 그 경우를 안내합니다.
//
// 프리셋 3종으로 다양한 푸시를 바로 테스트:
//   · 범용(custom)    — 임의 subtype + data
//   · 통화 요약(call_summary) — summaryUrl/transcriptUrl/audioUrl
//   · 부재중(missed_call)     — callerNumber/callerName

const CODE = `// SDK로 동일하게:
import { DVGatewayClient } from "dvgateway-sdk";
const client = new DVGatewayClient({ baseUrl, auth: { type: "apiKey", apiKey } });

// 1) 범용 푸시
await client.pushToExtension({
  extension: "1001",
  subtype: "custom",
  title: "공지",
  body: "잠시 후 회의가 시작됩니다",
  data: { room: "A-301" },
});

// 2) 통화 종료 후 결과 링크 (짧은 만료 서명 URL 권장)
await client.notifyCallSummary(linkedId, {
  extension: "1001",
  summaryUrl: "https://.../s/abc",
  audioUrl:   "https://.../a/abc",
});

// 3) 부재중
await client.notifyMissedCall({
  extension: "1001",
  callerNumber: "01012345678",
  callerName: "홍길동",
});`;

function mount(ctx) {
  ctx.body.innerHTML = `
    <p class="help">연동된 <b>모바일 앱</b> 사용자(내선 기준)에게 푸시를 보냅니다. 게이트웨이가 <code>extension → userId → fcm_token</code> 으로 라우팅하고, 테넌트는 JWT에서 강제돼요. <b>사전 요구</b>: 게이트웨이에 푸시 릴레이(<code>GW_WARM_TRANSFER_PUSH_ENABLED</code> + URL + SECRET)가 설정돼 있어야 합니다 — 미설정이면 503으로 안내해요.</p>

    <div class="field">
      <label>대상 내선 (extension)
        <input id="ap-ext" type="text" placeholder="예: 1001" />
      </label>
      <p class="help">앱에서 이미 등록·승인된 내선이어야 푸시가 도착해요(미등록이면 게이트웨이가 발송 안 함).</p>
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

    <div style="margin-top:12px;">
      <button id="ap-send" class="primary">푸시 전송</button>
    </div>

    <div class="transcript" id="ap-result" style="margin-top:16px;">
      <p class="muted small">대기 중 — 대상 내선과 푸시 종류를 정하고 「푸시 전송」을 눌러보세요.</p>
    </div>
  `;

  const $ = (sel) => ctx.body.querySelector(sel);
  const kindEl = $("#ap-kind");
  const resultEl = $("#ap-result");
  const result = [];

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

  async function send() {
    if (!ctx.client) { pushResult(false, "게이트웨이에 연결되어 있지 않아요"); return; }
    const extension = $("#ap-ext").value.trim();
    if (!extension) { pushResult(false, "대상 내선(extension)을 입력하세요"); return; }
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
        res = await ctx.client.pushToExtension({
          extension, subtype,
          title: $("#ap-title").value.trim() || undefined,
          body: $("#ap-body").value.trim() || undefined,
          data,
        });
        pushResult(true, `전송됨 · subtype=${res.subtype || subtype} → 내선 ${extension}`);
        ctx.log("ok", "push:extension", { extension, subtype });
      } else if (kind === "call_summary") {
        const linkedId = $("#ap-linked").value.trim();
        if (!linkedId) { pushResult(false, "linkedId 를 입력하세요"); btn.disabled = false; return; }
        res = await ctx.client.notifyCallSummary(linkedId, {
          extension,
          summaryUrl: $("#ap-summary").value.trim() || undefined,
          transcriptUrl: $("#ap-transcript").value.trim() || undefined,
          audioUrl: $("#ap-audio").value.trim() || undefined,
        });
        pushResult(true, `통화요약 푸시 전송됨 · linkedId=${linkedId} → 내선 ${extension}`);
        ctx.log("ok", "push:call_summary", { extension, linkedId });
      } else { // missed_call
        res = await ctx.client.notifyMissedCall({
          extension,
          callerNumber: $("#ap-caller-num").value.trim() || undefined,
          callerName: $("#ap-caller-name").value.trim() || undefined,
        });
        pushResult(true, `부재중 푸시 전송됨 → 내선 ${extension}`);
        ctx.log("ok", "push:missed_call", { extension });
      }
    } catch (err) {
      const m = String(err && err.message || err);
      // 503 = 릴레이 미설정. 사용자가 바로 알 수 있게 안내.
      if (m.includes("(503)")) {
        pushResult(false, "푸시 릴레이가 게이트웨이에 설정되지 않았어요 (GW_WARM_TRANSFER_PUSH_ENABLED + URL + SECRET). 운영자에게 설정을 요청하세요.");
      } else if (m.includes("(404)")) {
        pushResult(false, "해당 내선으로 등록된 기기가 없어요 — 앱에서 로그인·내선 등록·기기 승인이 끝났는지 확인하세요.");
      } else {
        pushResult(false, m);
      }
      ctx.log("err", "push:fail", { error: m });
    } finally {
      btn.disabled = false;
    }
  }

  $("#ap-send").addEventListener("click", send);

  // call:ended 시 call_summary 패널의 통화 목록 갱신
  const handler = (e) => {
    const evt = e.detail;
    if (kindEl.value === "call_summary" &&
        (evt.event === "call:new" || evt.event === "call:ended")) {
      renderCalls();
    }
  };
  if (ctx.client) ctx.client.addEventListener("event", handler);

  showPane();
  return () => {
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

export default { mount, code: CODE };
