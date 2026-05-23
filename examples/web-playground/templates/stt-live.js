// Cloud STT live transcript — start STT for a conference, render transcripts
// pushed over callinfo. STT 시작/정지는 API 측 :8080/api/v1/stt/conf/{confId}/{start|stop}.

const CODE = `// 1) 회의에 대해 클라우드 STT 시작
await fetch(\`http://\${HOST}:8080/api/v1/stt/conf/\${confId}/start\`, {
  method: "POST",
  headers: { "Authorization": \`Bearer \${token}\` },
});

// 2) callinfo WS로 STT 결과 수신
ws.onmessage = (msg) => {
  const evt = JSON.parse(msg.data);
  if (evt.event === "stt:result" || evt.event === "stt:transcript") {
    console.log(evt.speaker, evt.text, evt.isFinal);
  }
};

// 3) 정지
await fetch(\`http://\${HOST}:8080/api/v1/stt/conf/\${confId}/stop\`, {
  method: "POST",
  headers: { "Authorization": \`Bearer \${token}\` },
});`;

function mount(ctx) {
  ctx.body.innerHTML = `
    <div class="field">
      <label>회의 ID
        <input type="text" id="st-conf" placeholder="예: conf-1001" />
      </label>
      <p class="help">참여자가 여러 명인 회의(ConfBridge)의 ID를 입력해 주세요. 음성 인식(STT) 기능이 활성화된 라이선스가 필요해요.</p>
    </div>
    <div class="row">
      <button id="st-start" class="primary">📝 자막 시작</button>
      <button id="st-stop">자막 정지</button>
    </div>
    <div class="transcript" id="st-transcript">
      <p class="muted small">자막이 여기에 표시될 거예요. 위에서 자막을 시작해 보세요.</p>
    </div>
    <p class="help" id="st-status">아직 자막이 시작되지 않았어요.</p>
  `;

  const confEl = ctx.body.querySelector("#st-conf");
  const startBtn = ctx.body.querySelector("#st-start");
  const stopBtn = ctx.body.querySelector("#st-stop");
  const transcript = ctx.body.querySelector("#st-transcript");
  const statusEl = ctx.body.querySelector("#st-status");

  const lines = [];

  async function call(action) {
    const confId = confEl.value.trim();
    if (!confId || !ctx.client) return;
    try {
      const res = await fetch(`${ctx.client.apiBase}/api/v1/stt/conf/${encodeURIComponent(confId)}/${action}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${ctx.client.token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const label = action === "start" ? "시작" : "정지";
      statusEl.textContent = `✓ ${confId} 회의 자막을 ${label}했어요`;
      ctx.log("ok", `stt:${action}`, { confId });
    } catch (err) {
      const label = action === "start" ? "시작" : "정지";
      statusEl.textContent = `✗ 자막을 ${label}하지 못했어요: ${err.message}`;
      ctx.log("err", `stt:${action}:fail`, { error: err.message });
    }
  }

  startBtn.addEventListener("click", () => call("start"));
  stopBtn.addEventListener("click", () => call("stop"));

  const handler = (e) => {
    const evt = e.detail;
    if (!evt || !evt.event) return;
    if (!evt.event.startsWith("stt:") && evt.event !== "transcript") return;
    const speaker = evt.speaker || evt.channel || evt.linkedId || "?";
    const text = evt.text || evt.transcript || "";
    const isFinal = evt.isFinal ?? evt.final ?? true;
    lines.push({ speaker, text, isFinal, t: Date.now() });
    if (lines.length > 100) lines.shift();
    transcript.innerHTML = lines.slice(-30).map((l) => `
      <div class="line ${l.isFinal ? "" : "interim"}">
        <span class="speaker">${escape(l.speaker)}</span>${escape(l.text)}
      </div>
    `).join("");
    transcript.scrollTop = transcript.scrollHeight;
  };

  if (ctx.client) ctx.client.addEventListener("event", handler);
  return () => {
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

function escape(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

export default { mount, code: CODE };
