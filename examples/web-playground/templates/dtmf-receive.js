// DTMF receive — render incoming keypresses on a phone-style keypad.
// Highlights the cell briefly on call:dtmf phase="end" (guide §14.4).

const CODE = `ws.onmessage = (msg) => {
  const evt = JSON.parse(msg.data);
  if (evt.event !== "call:dtmf" || evt.phase !== "end") return;
  console.log(\`DTMF \${evt.digit} from \${evt.linkedId} (\${evt.durationMs}ms)\`);
  // IVR 로직 예시:
  //   if (evt.digit === "1") transferToAgent(evt.linkedId);
  //   if (evt.digit === "9") playMenu(evt.linkedId);
};`;

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

function mount(ctx) {
  ctx.body.innerHTML = `
    <p class="help">전화기 키패드에서 DTMF가 눌리면 해당 셀이 강조됩니다.
       phase="end" 이벤트만 사용하는 게 일반적입니다 (durationMs 포함).</p>
    <div class="dtmf-grid">
      ${KEYS.map((k) => `<div class="dtmf-cell" data-key="${k}">${k}</div>`).join("")}
    </div>
    <div class="transcript" id="dt-history" style="margin-top:20px;">
      <p class="muted small">DTMF 히스토리가 여기 표시됩니다.</p>
    </div>
  `;

  const cells = new Map();
  ctx.body.querySelectorAll(".dtmf-cell").forEach((cell) => {
    cells.set(cell.dataset.key, cell);
  });
  const history = ctx.body.querySelector("#dt-history");
  const events = [];

  const handler = (e) => {
    const evt = e.detail;
    if (evt.event !== "call:dtmf") return;
    if (evt.phase !== "end") return;
    const cell = cells.get(evt.digit);
    if (cell) {
      cell.classList.add("hit");
      setTimeout(() => cell.classList.remove("hit"), 600);
    }
    events.push({ ...evt, _t: Date.now() });
    if (events.length > 50) events.shift();
    history.innerHTML = events.slice(-20).reverse().map((e) => `
      <div class="line">
        <span class="speaker">${e.digit}</span>
        linkedId=${e.linkedId} · ${e.durationMs || 0}ms · ${e.direction || "received"}
        <span class="muted small">${new Date(e._t).toLocaleTimeString()}</span>
      </div>
    `).join("");
  };

  if (ctx.client) ctx.client.addEventListener("event", handler);
  return () => {
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

export default { mount, code: CODE };
