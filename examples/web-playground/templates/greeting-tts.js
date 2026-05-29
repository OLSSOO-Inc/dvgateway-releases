// Greeting TTS — auto-inject a TTS message the moment a call connects.
//
// 트리거는 channel:state state=up 하나만 사용합니다. call:new(벨이 울리는
// 시점)에는 아직 통화가 연결되지 않아 미디어 스트림이 없어서, 그때 TTS를
// 주입해도 발신자가 들을 수 없습니다. 통화가 실제로 연결(up)된 순간 주입해야
// 인사말이 정상 재생됩니다 (guide §14.4).

const CODE = `// channel:state up → 인사말 TTS 자동 주입 (guide §14.4 / §14.6)
// 통화가 "연결(up)"된 순간 한 번만 주입 — 벨(ring) 단계에서는 미디어가 없어
// 주입해도 들리지 않으므로 up 을 기다립니다.
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
      <label><input type="checkbox" id="gt-enable" /> ✅ 자동 인사말 켜기 (체크하면 다음 통화부터 자동으로 들려드려요)</label>
      <p class="help">통화가 <b>연결되는 순간</b>(상대방이 전화를 받았을 때) 인사말이 자동으로 재생돼요. 벨이 울리는 동안에는 아직 음성을 주고받을 수 없어 재생되지 않습니다 — 연결될 때까지 기다렸다가 들려드려요.</p>
    </div>
    <p class="help" id="gt-status">아직 보낸 인사말이 없어요. 위 체크박스를 켜고 새 통화가 연결되기를 기다려 보세요.</p>
  `;

  const textEl = ctx.body.querySelector("#gt-text");
  const enableEl = ctx.body.querySelector("#gt-enable");
  const statusEl = ctx.body.querySelector("#gt-status");

  // 같은 통화에서 channel:state up 이 여러 번 와도 인사말은 한 번만 재생.
  const greeted = new Set();

  const handler = async (e) => {
    if (!enableEl.checked) return;
    if (!ctx.client) return;

    const evt = e.detail;
    // 통화가 "연결(up)"된 순간에만 주입 — ring(벨) 단계에는 미디어가 없어
    // 주입해도 발신자가 들을 수 없으므로 up 을 기다린다.
    if (!(evt.event === "channel:state" && evt.state === "up")) return;
    if (!evt.linkedId || greeted.has(evt.linkedId)) return;
    greeted.add(evt.linkedId);

    const text = textEl.value.trim();
    if (!text) return;

    statusEl.textContent = `🔊 인사말 보내는 중… "${text.slice(0, 28)}${text.length > 28 ? "…" : ""}" → 통화 ${evt.linkedId}`;
    try {
      await ctx.safeInjectText(evt.linkedId, text);
      statusEl.textContent = `✓ 인사말을 들려드렸어요 (통화 ${evt.linkedId})`;
      ctx.log("ok", "greeting:injected", { linkedId: evt.linkedId, text, mode: ctx.providerMode?.() });
    } catch (err) {
      greeted.delete(evt.linkedId); // 실패 시 재시도 가능하도록 표시 해제
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
