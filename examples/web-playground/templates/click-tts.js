// Click-to-TTS — pick an active call from the dropdown, type, send.
// Uses /api/v1/tts/synthesize then POST /api/v1/tts/{linkedId} (guide §14.6).

const CODE = `// 활성 통화에 텍스트 TTS 즉시 주입
async function injectTts(linkedId, text) {
  // 1) text → 16k s16le PCM
  const r = await fetch(\`http://\${HOST}:8080/api/v1/tts/synthesize\`, {
    method: "POST",
    headers: { "Authorization": \`Bearer \${token}\`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const pcm = await r.arrayBuffer();

  // 2) PCM → 통화 주입 (raw slin16 바이트)
  await fetch(\`http://\${HOST}:8080/api/v1/tts/\${linkedId}\`, {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${token}\`,
      "Content-Type":  "application/octet-stream",
    },
    body: pcm,
  });
}`;

function mount(ctx) {
  ctx.body.innerHTML = `
    <div class="field">
      <label>대상 통화
        <select id="ct-call"></select>
      </label>
    </div>
    <div class="field">
      <label>전송할 텍스트
        <textarea id="ct-text" placeholder="예: 잠시만 기다려 주세요. 담당자에게 연결해 드리겠습니다."></textarea>
      </label>
    </div>
    <div class="row">
      <button id="ct-send" class="primary">TTS 주입</button>
      <button id="ct-stop">진행중 주입 중단</button>
    </div>
    <p class="help" id="ct-status">통화가 활성화되면 드롭다운에 나타납니다.</p>
  `;

  const callSel = ctx.body.querySelector("#ct-call");
  const textEl = ctx.body.querySelector("#ct-text");
  const sendBtn = ctx.body.querySelector("#ct-send");
  const stopBtn = ctx.body.querySelector("#ct-stop");
  const statusEl = ctx.body.querySelector("#ct-status");

  function refreshCalls() {
    const calls = Array.from(ctx.getActiveCalls().values());
    const cur = callSel.value;
    callSel.innerHTML = calls.length === 0
      ? '<option value="">(활성 통화 없음)</option>'
      : calls.map((c) => `<option value="${c.linkedId}">${c.linkedId} · ${c.caller || "?"} → ${c.callee || "?"}</option>`).join("");
    if (cur && calls.find((c) => c.linkedId === cur)) callSel.value = cur;
  }

  const tick = setInterval(refreshCalls, 500);
  refreshCalls();

  sendBtn.addEventListener("click", async () => {
    const linkedId = callSel.value;
    const text = textEl.value.trim();
    if (!linkedId) { statusEl.textContent = "활성 통화를 선택하세요."; return; }
    if (!text) { statusEl.textContent = "텍스트를 입력하세요."; return; }
    if (!ctx.client) { statusEl.textContent = "먼저 Connect 하세요."; return; }
    sendBtn.disabled = true;
    statusEl.textContent = "주입 중…";
    try {
      await ctx.safeInjectText(linkedId, text);
      statusEl.textContent = `✓ 주입 완료 (${linkedId}) · Mode ${ctx.providerMode?.() || "A"}`;
      ctx.log("ok", "click-tts:injected", { linkedId, text, mode: ctx.providerMode?.() });
    } catch (err) {
      statusEl.textContent = `✗ 주입 실패: ${err.message}`;
      ctx.log("err", "click-tts:fail", { error: err.message });
    } finally {
      sendBtn.disabled = false;
    }
  });

  stopBtn.addEventListener("click", async () => {
    const linkedId = callSel.value;
    if (!linkedId || !ctx.client) return;
    try {
      await ctx.client.stopInjection(linkedId);
      statusEl.textContent = `진행중 주입 중단 요청됨 (${linkedId})`;
    } catch (err) {
      statusEl.textContent = `중단 실패: ${err.message}`;
    }
  });

  return () => clearInterval(tick);
}

export default { mount, code: CODE };
