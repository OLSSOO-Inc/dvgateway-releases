// Warm transfer — 활성 통화를 보류하고 상담원/외부번호를 호출해 연결.
// 선택적으로 상담원에게 먼저 들려줄 안내 멘트(whisper)를 지정할 수 있다.
// POST /api/v1/transfer/warm/{linkedId} (가이드 §13 warm transfer).

const CODE = `// 활성 통화를 보류하고 destination 을 호출 → 응답 시 브릿지 연결(warm transfer)
async function warmTransfer(linkedId, destination, whisperText) {
  const res = await fetch(
    \`http://\${HOST}:8080/api/v1/transfer/warm/\${linkedId}\`,
    {
      method: "POST",
      headers: { "Authorization": \`Bearer \${token}\`, "Content-Type": "application/json" },
      body: JSON.stringify({
        destination,            // 상담원 내선 또는 외부번호
        whisperText,            // (선택) 상담원에게 먼저 들려줄 안내 멘트
        timeoutMs: 30000,       // 응답 대기 시간
        context: "from-internal", // 외부발신이면 outbound:true + context:"cos-all"
      }),
    },
  );
  const r = await res.json();
  // r.connected: 연결 성사 여부, r.whisperSkipReason: whisper 미재생 사유 등
  return r;
}`;

function mount(ctx) {
  ctx.body.innerHTML = `
    <div class="field">
      <label>어떤 통화를 넘길까요? (보류 후 연결)
        <select id="wt-call"></select>
      </label>
    </div>
    <div class="field">
      <label>연결 대상 (상담원 내선 또는 외부번호)
        <input id="wt-dest" type="text" placeholder="예: 1010 (내선) 또는 01012345678 (외부)">
      </label>
    </div>
    <div class="field">
      <label>상담원 안내 멘트 (선택 — 연결 전 상담원에게만 들려줌)
        <textarea id="wt-whisper" placeholder="예: VIP 고객 연결입니다. 잠시 후 연결됩니다."></textarea>
      </label>
    </div>
    <div class="row" style="gap:14px;flex-wrap:wrap;">
      <label class="inline" style="display:flex;align-items:center;gap:5px;">
        <input id="wt-outbound" type="checkbox"> 외부번호로 발신 (트렁크)
      </label>
      <label class="inline" style="display:flex;align-items:center;gap:5px;">
        대기시간(초) <input id="wt-timeout" type="number" min="5" max="120" value="30" style="width:70px;">
      </label>
    </div>
    <div class="row">
      <button id="wt-go" class="primary">🔀 통화 넘기기 (warm transfer)</button>
    </div>
    <p class="help" id="wt-status">진행 중인 통화가 생기면 위 목록에 나타나요. 게이트웨이 ARI가 활성이어야 동작합니다.</p>
  `;

  const callSel = ctx.body.querySelector("#wt-call");
  const destEl = ctx.body.querySelector("#wt-dest");
  const whisperEl = ctx.body.querySelector("#wt-whisper");
  const outboundEl = ctx.body.querySelector("#wt-outbound");
  const timeoutEl = ctx.body.querySelector("#wt-timeout");
  const goBtn = ctx.body.querySelector("#wt-go");
  const statusEl = ctx.body.querySelector("#wt-status");

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

  goBtn.addEventListener("click", async () => {
    const linkedId = callSel.value;
    const destination = destEl.value.trim();
    const whisperText = whisperEl.value.trim();
    const outbound = outboundEl.checked;
    const timeoutMs = Math.max(5, Math.min(120, parseInt(timeoutEl.value, 10) || 30)) * 1000;
    if (!ctx.client) { statusEl.textContent = "먼저 왼쪽에서 서버에 연결해 주세요."; return; }
    if (!linkedId) { statusEl.textContent = "넘길 통화를 골라 주세요."; return; }
    if (!destination) { statusEl.textContent = "연결 대상(내선/번호)을 입력해 주세요."; return; }

    goBtn.disabled = true;
    statusEl.textContent = `🔀 ${destination} 호출 중… 응답을 기다립니다 (최대 ${timeoutMs / 1000}초)`;
    ctx.log("info", "warm-transfer:start", { linkedId, destination, outbound, whisper: !!whisperText });
    try {
      const r = await ctx.client.warmTransfer(linkedId, {
        destination,
        whisperText: whisperText || undefined,
        timeoutMs,
        outbound,
        // 외부발신이면 트렁크 컨텍스트가 필요(운영 환경에 맞게 조정). 내선이면 기본값.
        context: outbound ? "cos-all" : "from-internal",
      });
      if (r && r.connected) {
        statusEl.textContent = `✓ ${destination} 연결 완료${r.whisperPlayed ? " (안내 멘트 재생됨)" : ""}`;
      } else {
        const reason = (r && (r.failureReason || r.whisperSkipReason)) || "응답 없음/거절";
        statusEl.textContent = `⚠ 연결되지 않았어요: ${reason}`;
      }
      ctx.log(r && r.connected ? "ok" : "warn", "warm-transfer:result", r || {});
    } catch (err) {
      statusEl.textContent = `✗ 넘기지 못했어요: ${err.message}`;
      ctx.log("err", "warm-transfer:fail", { error: err.message });
    } finally {
      goBtn.disabled = false;
    }
  });

  return () => clearInterval(tick);
}

export default { mount, code: CODE };
