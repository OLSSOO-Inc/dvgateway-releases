// Lite IVR — mode=lite 통화에 ARI Playback + DTMF 수집 + Hangup 데모 (SDK 1.7.0)
//
// 다이얼플랜 예시:
//   exten => _8X.,1,Stasis(dvgateway,mode=lite,did=${EXTEN},tenantid=${TENANTID})
//   same  => n,Hangup()
//
// lite 모드는 ExternalMedia / Snoop / Bridge를 만들지 않으므로 per-call
// 자원이 극소화됩니다. playback() / collect_dtmf() / hangup() 만 지원하며
// TTS 주입(injectAudio)은 사용할 수 없습니다.

const CODE = `// mode=lite IVR — SDK 1.7.0 (dvgateway-python)
// 다이얼플랜: Stasis(dvgateway,mode=lite,did=\${EXTEN},tenantid=\${TENANTID})

gw = DVGatewayClient(base_url=GW_URL, auth={"type":"apiKey","api_key":KEY})

async def on_call(evt):
    if evt.type != "call:new": return
    if evt.session.mode != "lite": return   # lite 통화만 처리
    lid = evt.session.linked_id

    # 1) 환영 안내
    await gw.playback(lid, media="sound:hello-world")

    # 2) 메뉴 안내 → DTMF 수집
    await gw.playback(lid, media="sound:enter-ext-of-person")
    res = await gw.collect_dtmf(lid, max_digits=4,
                                timeout_ms=8000,
                                inter_digit_timeout_ms=3000,
                                terminator="#")

    if res.timed_out or not res.digits:
        await gw.playback(lid, media="sound:vm-goodbye")
    else:
        await gw.playback(lid, media=f"digits:{res.digits}")
        await gw.playback(lid, media="sound:thank-you-for-calling")

    await gw.hangup(lid)

gw.on_call_event(on_call)
await asyncio.Event().wait()   # 서버 계속 실행`;

// ── DTMF 수집 상태머신 (브라우저 측 시뮬레이션) ──────────────────────────────
// 실제 IVR 로직은 Python SDK가 처리하고, 여기서는 callinfo 이벤트를 통해
// 같은 통화의 진행 상황을 모니터링·시각화합니다.
// "직접 제어" 버튼은 게이트웨이 API를 브라우저에서 직접 호출하는 데모입니다.

const MEDIA_PRESETS = [
  { label: "환영 인사", value: "sound:hello-world" },
  { label: "내선 입력 안내", value: "sound:enter-ext-of-person" },
  { label: "감사 인사", value: "sound:thank-you-for-calling" },
  { label: "작별 인사", value: "sound:vm-goodbye" },
  { label: "숫자 읽기", value: "digits:1234" },
  { label: "전화 벨 톤", value: "tone:ring" },
];

function mount(ctx) {
  ctx.body.innerHTML = `
    <div class="lite-badge">
      <span class="badge-lite">mode=lite</span>
      <span class="muted small">ExternalMedia / Snoop / Bridge 없음 · 최소 자원 IVR</span>
    </div>

    <div class="panel-row">
      <!-- 왼쪽: 직접 제어 -->
      <div class="lite-panel">
        <h3>직접 제어 <span class="muted small">(브라우저 → Gateway API)</span></h3>

        <div class="field">
          <label>대상 통화
            <select id="li-call">
              <option value="">(활성 통화 없음)</option>
            </select>
          </label>
          <p class="help muted small" id="li-mode-warn" style="display:none;color:var(--warn)">
            ⚠ 선택한 통화가 lite 모드가 아닙니다. playback()은 동작하지만 TTS 주입과 STT는 없습니다.
          </p>
        </div>

        <div class="field">
          <label>Media URI
            <div class="media-row">
              <input id="li-media" type="text" placeholder="sound:hello-world" value="sound:hello-world" />
              <select id="li-media-preset">
                <option value="">프리셋 선택…</option>
                ${MEDIA_PRESETS.map((p) => `<option value="${p.value}">${p.label}</option>`).join("")}
              </select>
            </div>
          </label>
          <p class="help muted small">
            <code>sound:&lt;이름&gt;</code> · <code>number:1234</code> · <code>digits:1234</code> · <code>tone:ring</code>
          </p>
        </div>

        <div class="row" style="gap:8px;flex-wrap:wrap;">
          <button id="li-play" class="primary">▶ Playback 시작</button>
          <button id="li-stop" class="warn-btn">■ 중단</button>
          <button id="li-hangup" class="danger-btn">☎ Hangup</button>
        </div>
        <p class="help" id="li-status">통화를 선택하고 Playback을 누르세요.</p>
      </div>

      <!-- 오른쪽: DTMF 입력 모니터 -->
      <div class="lite-panel">
        <h3>DTMF 모니터 <span class="muted small">(callinfo 이벤트)</span></h3>
        <div class="dtmf-grid">
          ${["1","2","3","4","5","6","7","8","9","*","0","#"]
            .map((k) => `<div class="dtmf-cell" data-key="${k}">${k}</div>`).join("")}
        </div>
        <div id="li-dtmf-buf" class="dtmf-buf">
          <span class="muted small">입력 대기 중…</span>
        </div>
        <button id="li-dtmf-clear" class="ghost small" style="margin-top:8px">버퍼 초기화</button>
      </div>
    </div>

    <!-- Playback 이벤트 타임라인 -->
    <div class="field" style="margin-top:16px;">
      <h3>audio:playback 이벤트 타임라인</h3>
      <div id="li-timeline" class="lite-timeline">
        <p class="muted small">audio:playback 이벤트를 기다리는 중…</p>
      </div>
    </div>

  `;

  // ── 스타일 주입 (한 번만) ────────────────────────────────────────
  if (!document.getElementById("lite-ivr-styles")) {
    const s = document.createElement("style");
    s.id = "lite-ivr-styles";
    s.textContent = `
      .lite-badge { display:flex; align-items:center; gap:10px; margin-bottom:16px; }
      .badge-lite {
        background:#1e3a5f; color:#5b9eff; border:1px solid #5b9eff;
        border-radius:4px; padding:2px 10px; font-size:12px; font-weight:600;
        letter-spacing:.04em;
      }
      .panel-row { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
      @media(max-width:700px) { .panel-row { grid-template-columns:1fr; } }
      .lite-panel {
        background:var(--panel-2); border:1px solid var(--border);
        border-radius:6px; padding:14px;
      }
      .lite-panel h3 { margin:0 0 12px; font-size:13px; }
      .media-row { display:flex; gap:6px; }
      .media-row input { flex:1; }
      .media-row select { width:auto; }
      .warn-btn {
        background:transparent; border:1px solid var(--warn); color:var(--warn);
        padding:6px 14px; border-radius:4px; cursor:pointer; font-size:13px;
      }
      .warn-btn:hover { background:rgba(251,191,36,.1); }
      .danger-btn {
        background:transparent; border:1px solid var(--err); color:var(--err);
        padding:6px 14px; border-radius:4px; cursor:pointer; font-size:13px;
      }
      .danger-btn:hover { background:rgba(248,113,113,.1); }
      .dtmf-buf {
        margin-top:10px; padding:8px 12px;
        background:var(--bg); border:1px solid var(--border); border-radius:4px;
        font-family:"SF Mono",Menlo,Consolas,monospace; font-size:20px;
        min-height:40px; letter-spacing:.15em;
      }
      .lite-timeline {
        background:var(--bg); border:1px solid var(--border); border-radius:4px;
        padding:10px 12px; max-height:180px; overflow-y:auto;
      }
      .lite-tl-entry {
        font-size:12px; font-family:"SF Mono",Menlo,Consolas,monospace;
        padding:3px 0; border-bottom:1px solid var(--border);
      }
      .lite-tl-entry:last-child { border-bottom:none; }
      .lite-tl-playing { color:var(--ok); }
      .lite-tl-done    { color:var(--muted); }
      .lite-tl-stopped { color:var(--warn); }
      .lite-tl-failed  { color:var(--err); }
      .code-block {
        background:var(--code-bg); border:1px solid var(--border); border-radius:4px;
        padding:10px 12px; font-size:12px; overflow-x:auto; margin:8px 0;
      }
    `;
    document.head.appendChild(s);
  }

  // ── DOM 참조 ────────────────────────────────────────────────────────
  const callSel    = ctx.body.querySelector("#li-call");
  const mediaInput = ctx.body.querySelector("#li-media");
  const presetSel  = ctx.body.querySelector("#li-media-preset");
  const playBtn    = ctx.body.querySelector("#li-play");
  const stopBtn    = ctx.body.querySelector("#li-stop");
  const hangupBtn  = ctx.body.querySelector("#li-hangup");
  const statusEl   = ctx.body.querySelector("#li-status");
  const modeWarn   = ctx.body.querySelector("#li-mode-warn");
  const dtmfBuf    = ctx.body.querySelector("#li-dtmf-buf");
  const dtmfClear  = ctx.body.querySelector("#li-dtmf-clear");
  const timeline   = ctx.body.querySelector("#li-timeline");
  const dtmfCells  = new Map();
  ctx.body.querySelectorAll(".dtmf-cell").forEach((c) => dtmfCells.set(c.dataset.key, c));

  let currentPlaybackId = null;
  let dtmfDigits = [];
  let tlEntries = [];

  // ── 통화 목록 갱신 ──────────────────────────────────────────────────
  function refreshCalls() {
    const calls = Array.from(ctx.getActiveCalls().values());
    const cur = callSel.value;
    callSel.innerHTML = calls.length === 0
      ? '<option value="">(활성 통화 없음)</option>'
      : calls.map((c) => {
          const isLite = c.mode === "lite";
          return `<option value="${c.linkedId}" data-mode="${c.mode || ""}">${
            isLite ? "⚡" : "○"
          } ${c.linkedId} · ${c.caller || "?"} → ${c.callee || c.did || "?"}${isLite ? " [lite]" : ""}</option>`;
        }).join("");
    if (cur && calls.find((c) => c.linkedId === cur)) callSel.value = cur;
    updateModeWarn();
  }

  function updateModeWarn() {
    const opt = callSel.selectedOptions[0];
    const isLite = opt && opt.dataset.mode === "lite";
    // 모드가 없거나(오래된 GW) lite인 경우는 경고 숨김
    modeWarn.style.display = (opt && opt.dataset.mode && !isLite) ? "block" : "none";
  }

  callSel.addEventListener("change", updateModeWarn);
  const tick = setInterval(refreshCalls, 500);
  refreshCalls();

  // ── 프리셋 선택 ─────────────────────────────────────────────────────
  presetSel.addEventListener("change", () => {
    if (presetSel.value) {
      mediaInput.value = presetSel.value;
      presetSel.value = "";
    }
  });

  // ── 타임라인 헬퍼 ─────────────────────────────────────────────────────
  function addTimeline(phase, playbackId, extra) {
    const phaseClass = {
      playing: "lite-tl-playing",
      done:    "lite-tl-done",
      stopped: "lite-tl-stopped",
      failed:  "lite-tl-failed",
    }[phase] || "";
    const t = new Date().toLocaleTimeString();
    const id = playbackId ? playbackId.slice(0, 8) + "…" : "";
    const extraStr = extra ? ` · ${extra}` : "";
    const entry = { phase, playbackId, t, id, extraStr };
    tlEntries.push(entry);
    if (tlEntries.length > 50) tlEntries.shift();
    timeline.innerHTML = tlEntries.slice(-20).reverse().map((e) => `
      <div class="lite-tl-entry ${
        { playing:"lite-tl-playing", done:"lite-tl-done", stopped:"lite-tl-stopped", failed:"lite-tl-failed" }[e.phase] || ""
      }">
        ${e.t} <b>${e.phase}</b> ${e.id}${e.extraStr}
      </div>
    `).join("");
  }

  // ── callinfo 이벤트 핸들러 ────────────────────────────────────────────
  const handler = (e) => {
    const evt = e.detail;

    // DTMF 시각화
    if (evt.event === "call:dtmf" && evt.phase === "end") {
      const cell = dtmfCells.get(evt.digit);
      if (cell) {
        cell.classList.add("hit");
        setTimeout(() => cell.classList.remove("hit"), 600);
      }
      dtmfDigits.push(evt.digit);
      if (dtmfDigits.length > 20) dtmfDigits.shift();
      dtmfBuf.textContent = dtmfDigits.join(" ");
      ctx.log("ok", "lite:dtmf", { digit: evt.digit, linkedId: evt.linkedId });
    }

    // audio:playback 타임라인
    if (evt.event === "audio:playback") {
      const phase = evt.phase || evt.lifecycle || "";
      const extra = evt.durationMs ? `${evt.durationMs}ms` : "";
      addTimeline(phase, evt.playbackId, extra);
      ctx.log(
        phase === "failed" ? "err" : phase === "playing" ? "ok" : "",
        `lite:playback:${phase}`,
        { playbackId: evt.playbackId, linkedId: evt.linkedId, durationMs: evt.durationMs },
      );
    }
  };

  if (ctx.client) ctx.client.addEventListener("event", handler);

  // ── Playback 시작 ────────────────────────────────────────────────────
  playBtn.addEventListener("click", async () => {
    const linkedId = callSel.value;
    if (!linkedId) { statusEl.textContent = "활성 통화를 선택하세요."; return; }
    const media = mediaInput.value.trim();
    if (!media) { statusEl.textContent = "Media URI를 입력하세요."; return; }
    if (!ctx.client) { statusEl.textContent = "먼저 Connect 하세요."; return; }

    playBtn.disabled = true;
    statusEl.textContent = `▶ Playback 시작 중… (${media})`;
    try {
      const data = await ctx.client.litePlayback(linkedId, media);
      currentPlaybackId = data.playbackId || null;
      statusEl.textContent = `✓ Playback 시작 — playbackId: ${currentPlaybackId || "?"}`;
      ctx.log("ok", "lite:playback:start", { linkedId, media, playbackId: currentPlaybackId });
    } catch (err) {
      statusEl.textContent = `✗ 실패: ${err.message}`;
      ctx.log("err", "lite:playback:fail", { error: err.message });
    } finally {
      playBtn.disabled = false;
    }
  });

  // ── Playback 중단 ────────────────────────────────────────────────────
  stopBtn.addEventListener("click", async () => {
    const linkedId = callSel.value;
    if (!linkedId) { statusEl.textContent = "활성 통화를 선택하세요."; return; }
    if (!currentPlaybackId) { statusEl.textContent = "중단할 Playback이 없습니다."; return; }
    if (!ctx.client) { statusEl.textContent = "먼저 Connect 하세요."; return; }

    stopBtn.disabled = true;
    statusEl.textContent = `■ Playback 중단 중…`;
    try {
      await ctx.client.liteStopPlayback(linkedId, currentPlaybackId);
      statusEl.textContent = `✓ Playback 중단됨 — ${currentPlaybackId}`;
      ctx.log("ok", "lite:playback:stop", { linkedId, playbackId: currentPlaybackId });
      currentPlaybackId = null;
    } catch (err) {
      statusEl.textContent = `✗ 실패: ${err.message}`;
      ctx.log("err", "lite:stop:fail", { error: err.message });
    } finally {
      stopBtn.disabled = false;
    }
  });

  // ── Hangup ───────────────────────────────────────────────────────────
  hangupBtn.addEventListener("click", async () => {
    const linkedId = callSel.value;
    if (!linkedId) { statusEl.textContent = "활성 통화를 선택하세요."; return; }
    if (!ctx.client) { statusEl.textContent = "먼저 Connect 하세요."; return; }
    if (!confirm(`정말로 통화를 종료하시겠습니까?\n${linkedId}`)) return;

    hangupBtn.disabled = true;
    statusEl.textContent = `☎ Hangup 전송 중…`;
    try {
      await ctx.client.hangup(linkedId);
      statusEl.textContent = `✓ Hangup 전송됨 — ${linkedId}`;
      ctx.log("ok", "lite:hangup", { linkedId });
    } catch (err) {
      statusEl.textContent = `✗ 실패: ${err.message}`;
      ctx.log("err", "lite:hangup:fail", { error: err.message });
    } finally {
      hangupBtn.disabled = false;
    }
  });

  // ── DTMF 버퍼 초기화 ─────────────────────────────────────────────────
  dtmfClear.addEventListener("click", () => {
    dtmfDigits = [];
    dtmfBuf.innerHTML = '<span class="muted small">입력 대기 중…</span>';
  });

  return () => {
    clearInterval(tick);
    if (ctx.client) ctx.client.removeEventListener("event", handler);
    const styleEl = document.getElementById("lite-ivr-styles");
    if (styleEl) styleEl.remove();
  };
}

export default { mount, code: CODE };
