// Callinfo monitor — passively renders incoming events into a feed.
// Matches the flow in docs/sdk-guide/14-tenant-fixed-audio-guide.md (§14.3 + §14.4).

const CODE = `// 1) JWT 발급 (테넌트별 격리 — :8081/login)
const r = await fetch(\`http://\${HOST}:8081/login\`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tenantId, password }),
});
const { token } = await r.json();

// 2) callinfo WebSocket 구독 — :8080
//   브라우저처럼 헤더를 못 보내는 환경은 ?token=<JWT> 쿼리로 인증
const ws = new WebSocket(\`ws://\${HOST}:8080/api/v1/ws/callinfo?token=\${token}\`);

ws.onmessage = (msg) => {
  const evt = JSON.parse(msg.data);
  switch (evt.event) {
    case "snapshot":      console.log("active", evt.activeCalls?.length); break;
    case "call:new":      console.log("새 통화", evt.caller, "→", evt.callee, "did=", evt.did); break;
    case "channel:state": console.log("채널 상태", evt.state, evt.leg); break;
    case "call:dtmf":     console.log("DTMF", evt.digit, evt.phase); break;
    case "call:ended":    console.log("종료", evt.linkedId, evt.duration + "s"); break;
  }
};`;

function mount(ctx) {
  ctx.body.innerHTML = `
    <p class="help">전화가 오고, 연결되고, 끊기는 모든 순간이 아래에 실시간으로 표시돼요 (최근 20건).
       내 테넌트의 이벤트만 보이도록 자동으로 걸러져요. 더 자세한 전체 기록은 위쪽 <b>이벤트 로그</b> 탭에서 보실 수 있어요.</p>
    <div class="transcript" id="cim-feed"></div>
  `;

  const feed = ctx.body.querySelector("#cim-feed");
  const buffer = [];

  function render() {
    feed.innerHTML = buffer.slice(-20).reverse().map((evt) => {
      const time = new Date(evt._t).toLocaleTimeString();
      return `<div class="line"><span class="speaker">${evt.event}</span>${formatBody(evt)} <span class="muted small">${time}</span></div>`;
    }).join("");
  }

  function formatBody(e) {
    switch (e.event) {
      case "call:new":      return `${e.caller || "?"}${e.callerName ? `(${e.callerName})` : ""} → ${e.callee || e.did || "?"} · linkedId=${e.linkedId}`;
      case "call:ended":    return `linkedId=${e.linkedId} · duration=${e.duration}s`;
      case "call:dtmf":     return `digit=<b>${e.digit}</b> phase=${e.phase}${e.durationMs ? ` durMs=${e.durationMs}` : ""}`;
      case "channel:state": return `state=<b>${e.state}</b> leg=${e.leg}${e.sipResponseCode ? ` sip=${e.sipResponseCode}` : ""}`;
      case "tts:playback":  return `phase=${e.phase} injectId=${e.injectId} durMs=${e.durationMs}`;
      case "audio:playback":return `phase=${e.phase} url=${e.url || ""}`;
      case "snapshot":      return `${(e.activeCalls || []).length} active calls`;
      default:              return JSON.stringify(e);
    }
  }

  const handler = (e) => {
    const evt = { ...e.detail, _t: Date.now() };
    buffer.push(evt);
    if (buffer.length > 100) buffer.shift();
    render();
  };
  if (ctx.client) ctx.client.addEventListener("event", handler);

  return () => {
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

export default { mount, code: CODE };
