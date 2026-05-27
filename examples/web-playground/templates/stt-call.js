// 1:1 call STT live transcript — start STT on an active 1:1 call (mode=both),
// render transcripts pushed over callinfo as stt:result events.
//
// Distinct from stt-live.js (conference / ConfBridge). This targets a single
// call by linkedId via POST/DELETE /api/v1/stt/{linkedId}/{start|stop}.
// Requires a call with an audio stream — mode=lite calls have no audio so the
// gateway returns 409.

const CODE = `// 1:1 통화 STT — SDK 1.7.0
// 통화는 mode=both 로 진입해야 함 (mode=lite 는 오디오 스트림이 없어 STT 불가)

// 1) 1:1 통화에 대해 STT 시작
await fetch(\`http://\${HOST}:8080/api/v1/stt/\${linkedId}/start\`, {
  method: "POST",
  headers: { "Authorization": \`Bearer \${token}\` },
});

// 2) callinfo WS로 stt:result 수신
ws.onmessage = (msg) => {
  const evt = JSON.parse(msg.data);
  if (evt.event === "stt:result") {
    console.log(evt.speaker, evt.text, evt.isFinal);
  }
};

// 3) 정지
await fetch(\`http://\${HOST}:8080/api/v1/stt/\${linkedId}/stop\`, {
  method: "POST",
  headers: { "Authorization": \`Bearer \${token}\` },
});`;

function mount(ctx) {
  ctx.body.innerHTML = `
    <div class="field">
      <label>어떤 통화의 음성을 인식할까요?
        <select id="sc-call"><option value="">(진행 중인 통화가 없어요)</option></select>
      </label>
      <p class="help muted small" id="sc-mode-warn" style="display:none;color:var(--warn)">
        ⚠ 이 통화는 경량(lite) 모드예요. 오디오 스트림이 없어 음성 인식(STT)을 시작할 수 없어요. mode=both 통화가 필요해요.
      </p>
      <p class="help">왼쪽 <b>프로바이더 API 키</b>에서 STT(예: deepgram) 키가 저장돼 있어야 해요. STT 라이선스도 필요해요.</p>
    </div>
    <div class="row">
      <button id="sc-start" class="primary">📝 자막 시작</button>
      <button id="sc-stop">자막 정지</button>
    </div>
    <div class="transcript" id="sc-transcript">
      <p class="muted small">자막이 여기에 표시될 거예요. 통화를 고르고 자막을 시작해 보세요.</p>
    </div>
    <p class="help" id="sc-status">아직 자막이 시작되지 않았어요.</p>
  `;

  const callSel = ctx.body.querySelector("#sc-call");
  const modeWarn = ctx.body.querySelector("#sc-mode-warn");
  const startBtn = ctx.body.querySelector("#sc-start");
  const stopBtn = ctx.body.querySelector("#sc-stop");
  const transcript = ctx.body.querySelector("#sc-transcript");
  const statusEl = ctx.body.querySelector("#sc-status");

  const lines = [];

  // ── 활성 통화 목록 갱신 (lite-ivr 패턴) ──────────────────────────────
  function refreshCalls() {
    const calls = Array.from(ctx.getActiveCalls().values());
    const cur = callSel.value;
    callSel.innerHTML = calls.length === 0
      ? '<option value="">(활성 통화 없음)</option>'
      : calls.map((c) => {
          const isLite = c.mode === "lite";
          return `<option value="${c.linkedId}" data-mode="${c.mode || ""}">${
            isLite ? "⚡" : "○"
          } ${c.linkedId} · ${c.caller || "?"} → ${c.callee || c.did || "?"}${isLite ? " [lite]" : ""}</option>`;
        }).join("");
    if (cur && calls.find((c) => c.linkedId === cur)) callSel.value = cur;
    else if (calls.length === 1) callSel.value = calls[0].linkedId;
    updateModeWarn();
  }
  function updateModeWarn() {
    const opt = callSel.selectedOptions[0];
    const isLite = opt && opt.dataset.mode === "lite";
    modeWarn.style.display = isLite ? "block" : "none";
    startBtn.disabled = !!isLite;
  }
  callSel.addEventListener("change", updateModeWarn);
  const tick = setInterval(refreshCalls, 500);
  refreshCalls();

  async function call(action) {
    const linkedId = callSel.value;
    if (!linkedId) { statusEl.textContent = "활성 통화를 선택하세요."; return; }
    if (!ctx.client) { statusEl.textContent = "먼저 Connect 하세요."; return; }
    const provider = (ctx.sttProvider && ctx.sttProvider()) || "";
    const q = action === "start" && provider ? `?provider=${encodeURIComponent(provider)}` : "";
    try {
      const res = await fetch(`${ctx.client.apiBase}/api/v1/stt/${encodeURIComponent(linkedId)}/${action}${q}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${ctx.client.token}` },
      });
      if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
      const label = action === "start" ? "시작" : "정지";
      statusEl.textContent = `✓ ${linkedId} 통화 자막을 ${label}했어요`;
      ctx.log("ok", `stt:call:${action}`, { linkedId, provider });
    } catch (err) {
      const label = action === "start" ? "시작" : "정지";
      statusEl.textContent = `✗ 자막을 ${label}하지 못했어요: ${err.message}`;
      ctx.log("err", `stt:call:${action}:fail`, { error: err.message });
    }
  }
  startBtn.addEventListener("click", () => call("start"));
  stopBtn.addEventListener("click", () => call("stop"));

  // ── stt:result 이벤트 → 자막 렌더 ───────────────────────────────────
  const handler = (e) => {
    const evt = e.detail;
    if (!evt || evt.event !== "stt:result") return;
    const speaker = evt.speaker || evt.linkedId || "?";
    const text = evt.text || "";
    const isFinal = evt.isFinal ?? true;
    // interim 결과는 마지막 줄을 덮어쓰기 (같은 화자)
    if (!isFinal && lines.length > 0 && !lines[lines.length - 1].isFinal && lines[lines.length - 1].speaker === speaker) {
      lines[lines.length - 1] = { speaker, text, isFinal, t: Date.now() };
    } else {
      lines.push({ speaker, text, isFinal, t: Date.now() });
    }
    if (lines.length > 100) lines.shift();
    transcript.innerHTML = lines.slice(-30).map((l) => {
      const ts = new Date(l.t).toLocaleTimeString();
      return `<div class="line ${l.isFinal ? "" : "interim"}">
        <span class="muted small" style="margin-right:6px;">${ts}</span>
        <span class="speaker">${escape(l.speaker)}</span>${escape(l.text)}
      </div>`;
    }).join("");
    transcript.scrollTop = transcript.scrollHeight;
  };
  if (ctx.client) ctx.client.addEventListener("event", handler);

  return () => {
    clearInterval(tick);
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

function escape(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

export default { mount, code: CODE };
