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
      <label>어떤 통화에 보낼까요?
        <select id="ct-call"></select>
      </label>
    </div>
    <div class="field">
      <label>들려드릴 문장
        <textarea id="ct-text" placeholder="예: 잠시만 기다려 주세요. 담당자에게 연결해 드리겠습니다."></textarea>
      </label>
    </div>
    <div class="row">
      <button id="ct-send" class="primary">🔊 문장을 음성으로 보내기</button>
      <button id="ct-stop">재생 중단</button>
    </div>
    <p class="help" id="ct-status">진행 중인 통화가 생기면 위 목록에 나타나요.</p>
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
      ? '<option value="">(진행 중인 통화가 없어요)</option>'
      : calls.map((c) => `<option value="${c.linkedId}">${c.linkedId} · ${c.caller || "?"} → ${c.callee || "?"}</option>`).join("");
    if (cur && calls.find((c) => c.linkedId === cur)) callSel.value = cur;
  }

  const tick = setInterval(refreshCalls, 500);
  refreshCalls();

  sendBtn.addEventListener("click", async () => {
    const linkedId = callSel.value;
    const text = textEl.value.trim();
    if (!linkedId) { statusEl.textContent = "보낼 통화를 골라 주세요."; return; }
    if (!text) { statusEl.textContent = "보낼 문장을 입력해 주세요."; return; }
    if (!ctx.client) { statusEl.textContent = "먼저 왼쪽에서 서버에 연결해 주세요."; return; }
    sendBtn.disabled = true;
    statusEl.textContent = "🔊 문장을 음성으로 만들고 통화에 보내는 중이에요…";
    try {
      await ctx.safeInjectText(linkedId, text);
      statusEl.textContent = `✓ 통화 ${linkedId} 에 음성을 들려드렸어요`;
      ctx.log("ok", "click-tts:injected", { linkedId, text, mode: ctx.providerMode?.() });
    } catch (err) {
      statusEl.textContent = `✗ 음성을 보내지 못했어요: ${err.message}`;
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
      statusEl.textContent = `통화 ${linkedId} 의 재생을 중단했어요`;
    } catch (err) {
      statusEl.textContent = `중단하지 못했어요: ${err.message}`;
    }
  });

  return () => clearInterval(tick);
}

export default { mount, code: CODE };
