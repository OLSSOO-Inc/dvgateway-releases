// Call-ended log — aggregate call:ended events with duration and caller info.
// Useful pattern for post-call processing (CDR upload, customer survey link, etc.).

const CODE = `// 통화 종료 이벤트 수집 → 후처리 (guide §14.4)
const completed = [];
const liveByLid = new Map();
ws.onmessage = (msg) => {
  const evt = JSON.parse(msg.data);
  if (evt.event === "call:new")  liveByLid.set(evt.linkedId, evt);
  if (evt.event === "call:ended") {
    const meta = liveByLid.get(evt.linkedId) || {};
    completed.push({ ...meta, durationSec: evt.duration, endedAt: new Date().toISOString() });
    liveByLid.delete(evt.linkedId);
    // 예: CRM 업로드, 고객 설문 SMS 발송 등
    sendSurveyLink(meta.caller, evt.duration);
  }
};`;

function mount(ctx) {
  ctx.body.innerHTML = `
    <p class="help">최근에 끝난 통화들이 아래에 차곡차곡 쌓여요.
       실제 운영에서는 이 지점에서 CRM 시스템에 통화 정보를 올리거나, 고객 설문 SMS를 보내거나, 회의록을 내려받는 작업을 자동으로 연결해요.</p>
    <div class="row">
      <button id="ce-clear">목록 비우기</button>
      <span class="muted small" id="ce-count">0건</span>
    </div>
    <div class="transcript" id="ce-list" style="margin-top:12px;">
      <p class="muted small">아직 끝난 통화가 없어요. 통화를 한 통 진행한 뒤 끊으면 여기에 정보가 나타나요.</p>
    </div>
  `;

  const list = ctx.body.querySelector("#ce-list");
  const count = ctx.body.querySelector("#ce-count");
  const clearBtn = ctx.body.querySelector("#ce-clear");
  const items = [];
  const liveByLid = new Map();

  const handler = (e) => {
    const evt = e.detail;
    if (evt.event === "call:new") {
      liveByLid.set(evt.linkedId, evt);
    } else if (evt.event === "snapshot") {
      (evt.activeCalls || []).forEach((c) => liveByLid.set(c.linkedId, c));
    } else if (evt.event === "call:ended") {
      const info = liveByLid.get(evt.linkedId) || {};
      items.push({
        linkedId: evt.linkedId,
        duration: evt.duration,
        caller: info.caller || "?",
        callee: info.callee || info.did || "?",
        endedAt: Date.now(),
      });
      liveByLid.delete(evt.linkedId);
      render();
    }
  };

  function render() {
    count.textContent = `${items.length}건`;
    if (items.length === 0) {
      list.innerHTML = '<p class="muted small">아직 끝난 통화가 없어요. 통화를 한 통 진행한 뒤 끊으면 여기에 정보가 나타나요.</p>';
      return;
    }
    list.innerHTML = items.slice(-50).reverse().map((c) => `
      <div class="line">
        <span class="speaker">${c.caller}</span> → ${c.callee}
        · <b>${formatDuration(c.duration)}</b>
        <span class="muted small">${new Date(c.endedAt).toLocaleTimeString()} · ${c.linkedId}</span>
      </div>
    `).join("");
  }

  function formatDuration(s) {
    if (!s) return "0s";
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m ? `${m}분 ${r}초` : `${r}초`;
  }

  clearBtn.addEventListener("click", () => { items.length = 0; render(); });

  if (ctx.client) ctx.client.addEventListener("event", handler);
  return () => {
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

export default { mount, code: CODE };
