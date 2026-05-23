// Greeting TTS — auto-inject a TTS message when a new call appears.
// Two trigger options:
//   - call:new                    (callinfo registers the call)
//   - channel:state state=up      (callee actually answered — guide §14.4)

const CODE = `// channel:state up → 인사말 TTS 자동 주입 (guide §14.4 / §14.6)
ws.onmessage = async (msg) => {
  const evt = JSON.parse(msg.data);
  const trigger = evt.event === "channel:state" && evt.state === "up";
  if (!trigger) return;

  // 1) 텍스트 → 16k s16le PCM (서버 기본 TTS 또는 설정된 클라우드 TTS)
  const pcmRes = await fetch(\`http://\${HOST}:8080/api/v1/tts/synthesize\`, {
    method: "POST",
    headers: { "Authorization": \`Bearer \${token}\`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "안녕하세요. AI 상담원입니다." }),
  });
  const pcm = await pcmRes.arrayBuffer();

  // 2) 통화에 주입
  await fetch(\`http://\${HOST}:8080/api/v1/tts/\${evt.linkedId}\`, {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${token}\`,
      "Content-Type":  "application/octet-stream",
      "X-Inject-Id":   \`welcome-\${evt.linkedId}\`,
    },
    body: pcm,
  });
};`;

function mount(ctx) {
  ctx.body.innerHTML = `
    <div class="field">
      <label>전화에 들려드릴 인사말
        <textarea id="gt-text">안녕하세요. Dynamic VoIP 게이트웨이 데모입니다. 무엇을 도와드릴까요?</textarea>
      </label>
    </div>
    <div class="field">
      <label>언제 인사말을 보낼까요?
        <select id="gt-trigger">
          <option value="channel:state-up">📞 상대방이 전화를 받았을 때 (권장)</option>
          <option value="call:new">🔔 전화가 들어온 즉시</option>
        </select>
      </label>
      <p class="help">아웃바운드 통화나 자동응답 환경에서는 "상대방이 받았을 때" 옵션이 더 자연스러워요.</p>
    </div>
    <div class="field">
      <label><input type="checkbox" id="gt-enable" /> ✅ 자동 인사말 켜기 (체크하면 다음 통화부터 자동으로 들려드려요)</label>
    </div>
    <p class="help" id="gt-status">아직 보낸 인사말이 없어요. 위 체크박스를 켜고 새 통화가 오기를 기다려 보세요.</p>
  `;

  const textEl = ctx.body.querySelector("#gt-text");
  const triggerEl = ctx.body.querySelector("#gt-trigger");
  const enableEl = ctx.body.querySelector("#gt-enable");
  const statusEl = ctx.body.querySelector("#gt-status");

  const handler = async (e) => {
    if (!enableEl.checked) return;
    if (!ctx.client) return;

    const evt = e.detail;
    const trigger = triggerEl.value;
    let shouldFire = false;
    if (trigger === "call:new" && evt.event === "call:new") shouldFire = true;
    if (trigger === "channel:state-up" && evt.event === "channel:state" && evt.state === "up") shouldFire = true;
    if (!shouldFire) return;

    const text = textEl.value.trim();
    if (!text) return;

    statusEl.textContent = `🔊 인사말 보내는 중… "${text.slice(0, 28)}${text.length > 28 ? "…" : ""}" → 통화 ${evt.linkedId}`;
    try {
      await ctx.safeInjectText(evt.linkedId, text);
      statusEl.textContent = `✓ 인사말을 들려드렸어요 (통화 ${evt.linkedId})`;
      ctx.log("ok", "greeting:injected", { linkedId: evt.linkedId, text, mode: ctx.providerMode?.() });
    } catch (err) {
      statusEl.textContent = `✗ 인사말을 보내지 못했어요: ${err.message}`;
      ctx.log("err", "greeting:fail", { error: err.message });
    }
  };

  if (ctx.client) ctx.client.addEventListener("event", handler);
  return () => {
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

export default { mount, code: CODE };
