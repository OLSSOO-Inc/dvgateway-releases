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

// 연결(up) 직후 미디어 경로가 안정화되기 전 주입하면 첫 음절이 끊겨 들린다.
// 짧게 기다렸다가 재생해 시작 부분이 온전히 들리도록.
const GREETING_DELAY_MS = 2000;

function mount(ctx) {
  ctx.body.innerHTML = `
    <div class="field">
      <label>전화에 들려드릴 인사말
        <textarea id="gt-text">안녕하세요. Dynamic VoIP 게이트웨이 데모입니다. 무엇을 도와드릴까요?</textarea>
      </label>
      <p class="help">이 템플릿을 켜 둔 동안 <b>통화가 연결되면 위 인사말을 자동으로 재생</b>합니다. 별도 버튼을 누를 필요는 없어요. 벨이 울리는 동안에는 아직 음성을 주고받을 수 없어, 상대가 전화를 받는 순간 들려드려요.</p>
    </div>
    <p class="help" id="gt-status">대기 중 — 통화가 연결되면 자동으로 인사말을 들려드려요.</p>
  `;

  const textEl = ctx.body.querySelector("#gt-text");
  const statusEl = ctx.body.querySelector("#gt-status");

  // 같은 통화에 인사말은 한 번만 재생 (중복 up / 즉시재생 + 이벤트 중복 방지).
  const greeted = new Set();

  async function greet(linkedId) {
    if (!ctx.client || !linkedId || greeted.has(linkedId)) return;
    const text = textEl.value.trim();
    if (!text) return;
    greeted.add(linkedId);
    // 연결 직후 미디어 경로가 완전히 자리잡기 전에 주입하면 첫 음절이 잘려
    // 들린다. 1초 기다렸다가 재생해 시작 부분이 깔끔하게 들리도록.
    statusEl.textContent = `⏳ 연결됨 — 잠시 후 인사말을 들려드려요 (통화 ${linkedId})`;
    await new Promise((r) => setTimeout(r, GREETING_DELAY_MS));
    statusEl.textContent = `🎙 음성 생성 중… 같은 문장은 캐시돼 다음부터 즉시 재생돼요. (통화 ${linkedId})`;
    try {
      const t0 = Date.now();
      await ctx.safeInjectText(linkedId, text);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      statusEl.textContent = `✓ 인사말을 들려드렸어요 (통화 ${linkedId} · ${secs}s)`;
      ctx.log("ok", "greeting:injected", { linkedId, text, mode: ctx.providerMode?.() });
    } catch (err) {
      greeted.delete(linkedId); // 실패 시 재시도 가능하도록 해제
      statusEl.textContent = `✗ 인사말을 보내지 못했어요: ${err.message}`;
      ctx.log("err", "greeting:fail", { error: err.message });
    }
  }

  // 이미 "연결(up)"된 활성 통화가 있으면 템플릿을 켠 즉시 인사말 재생 —
  // 사용자가 통화 도중에 이 템플릿을 골라도 바로 테스트되도록. 아직 벨(ring)
  // 단계면 안내만 띄우고 up 이벤트를 기다린다.
  const live = Array.from(ctx.getActiveCalls().values());
  const upCall = live.find((c) => c.state === "up" || c.channelState === "up");
  if (upCall) {
    greet(upCall.linkedId);
  } else if (live.length) {
    statusEl.textContent = "📞 통화가 연결되면(상대가 받으면) 자동으로 인사말을 들려드려요. 벨이 울리는 중에는 대기합니다.";
  }

  const handler = (e) => {
    const evt = e.detail;
    // 통화가 "연결(up)"된 순간에 주입 — ring(벨) 단계는 미디어가 없어 스킵.
    if (evt.event === "channel:state" && evt.state === "up" && evt.linkedId) {
      greet(evt.linkedId);
    }
  };

  if (ctx.client) ctx.client.addEventListener("event", handler);
  return () => {
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

export default { mount, code: CODE };
