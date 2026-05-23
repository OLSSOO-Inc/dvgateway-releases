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
      <span class="badge-lite">⚡ 경량 모드 전용</span>
      <span class="muted small">안내음 재생 + 키패드 입력 받기 + 통화 종료 — 자원 소모가 가장 적은 자동응답이에요</span>
    </div>

    <div class="panel-row">
      <!-- 왼쪽: 직접 제어 -->
      <div class="lite-panel">
        <h3>1️⃣ 직접 조작해 보기</h3>

        <div class="field">
          <label>어떤 통화에 보낼까요?
            <select id="li-call">
              <option value="">(진행 중인 통화가 없어요)</option>
            </select>
          </label>
          <p class="help muted small" id="li-mode-warn" style="display:none;color:var(--warn)">
            ⚠ 이 통화는 경량 모드가 아니에요. 안내음은 재생되지만 음성 인식·합성 같은 기능은 지원되지 않아요.
          </p>
        </div>

        <div class="field">
          <label>어떤 안내음을 들려드릴까요?
            <div class="media-row">
              <input id="li-media" type="text" placeholder="sound:hello-world" value="sound:hello-world" />
              <select id="li-media-preset">
                <option value="">자주 쓰는 안내음 고르기…</option>
                ${MEDIA_PRESETS.map((p) => `<option value="${p.value}">${p.label}</option>`).join("")}
              </select>
            </div>
          </label>
          <p class="help muted small">
            예시: <code>sound:hello-world</code>(인사) · <code>digits:1234</code>(숫자 읽기) · <code>tone:ring</code>(벨 소리)
          </p>
        </div>

        <div class="row" style="gap:8px;flex-wrap:wrap;">
          <button id="li-play" class="primary">▶ 재생하기</button>
          <button id="li-stop" class="warn-btn">■ 중단</button>
          <button id="li-hangup" class="danger-btn">☎ 통화 끊기</button>
        </div>

        <div class="field" style="margin-top:14px;border-top:1px solid var(--border);padding-top:14px;">
          <label>원하는 문장을 입력하면 음성으로 들려드려요
            <input id="li-tts-text" type="text" placeholder="안녕하세요, 무엇을 도와드릴까요?" />
          </label>
          <div class="row" style="gap:8px;margin-top:6px;flex-wrap:wrap;">
            <select id="li-tts-provider" style="width:auto;">
              <option value="">기본 음성</option>
              <option value="google">Google</option>
              <option value="elevenlabs">ElevenLabs</option>
              <option value="openai">OpenAI</option>
              <option value="gemini">Gemini</option>
              <option value="cosyvoice">CosyVoice</option>
            </select>
            <button id="li-tts-play" class="primary">🔊 문장을 음성으로 들려주기</button>
          </div>
          <p class="help muted small">
            문장이 클라우드에서 음성으로 합성된 뒤 통화에 재생돼요. 같은 문장은 캐시 덕분에 바로 재생돼요.
            (게이트웨이 1.4.5.8 이상에서 동작해요)
          </p>
        </div>

        <p class="help" id="li-status">통화를 고르고 재생 버튼을 눌러 주세요.</p>
      </div>

      <!-- 오른쪽: 키 입력 모니터 -->
      <div class="lite-panel">
        <h3>2️⃣ 고객이 누른 키패드 보기</h3>
        <div class="dtmf-grid">
          ${["1","2","3","4","5","6","7","8","9","*","0","#"]
            .map((k) => `<div class="dtmf-cell" data-key="${k}">${k}</div>`).join("")}
        </div>
        <div id="li-dtmf-buf" class="dtmf-buf">
          <span class="muted small">키패드 입력을 기다리고 있어요…</span>
        </div>
        <button id="li-dtmf-clear" class="ghost small" style="margin-top:8px">초기화</button>
      </div>
    </div>

    <!-- 재생 이력 -->
    <div class="field" style="margin-top:16px;">
      <h3>📜 재생 이력</h3>
      <div id="li-timeline" class="lite-timeline">
        <p class="muted small">아직 재생된 안내음이 없어요. 위에서 재생을 눌러 보세요.</p>
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
  const ttsText    = ctx.body.querySelector("#li-tts-text");
  const ttsProv    = ctx.body.querySelector("#li-tts-provider");
  const ttsPlayBtn = ctx.body.querySelector("#li-tts-play");
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
  const phaseLabel = { playing: "재생 중", done: "완료", stopped: "중단", failed: "실패" };
  const phaseClass = { playing: "lite-tl-playing", done: "lite-tl-done", stopped: "lite-tl-stopped", failed: "lite-tl-failed" };

  function addTimeline(phase, playbackId, extra) {
    const t = new Date().toLocaleTimeString();
    const extraStr = extra ? ` · ${extra}` : "";
    const entry = { phase, playbackId, t, extraStr };
    tlEntries.push(entry);
    if (tlEntries.length > 50) tlEntries.shift();
    timeline.innerHTML = tlEntries.slice(-20).reverse().map((e) => `
      <div class="lite-tl-entry ${phaseClass[e.phase] || ""}">
        ${e.t} <b>${phaseLabel[e.phase] || e.phase}</b>${e.extraStr}
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
    statusEl.textContent = `▶ 재생 시작 중… (${media})`;
    try {
      const data = await ctx.client.litePlayback(linkedId, media);
      currentPlaybackId = data.playbackId || null;
      statusEl.textContent = `✓ 재생 시작됨`;
      ctx.log("ok", "lite:playback:start", { linkedId, media, playbackId: currentPlaybackId });
    } catch (err) {
      statusEl.textContent = `✗ 실패: ${err.message}`;
      ctx.log("err", "lite:playback:fail", { error: err.message });
    } finally {
      playBtn.disabled = false;
    }
  });

  // ── TTS 합성 + 재생 (게이트웨이 1.4.5.8+) ────────────────────────────
  ttsPlayBtn.addEventListener("click", async () => {
    const linkedId = callSel.value;
    if (!linkedId) { statusEl.textContent = "활성 통화를 선택하세요."; return; }
    const text = ttsText.value.trim();
    if (!text) { statusEl.textContent = "TTS 텍스트를 입력하세요."; return; }
    if (!ctx.client) { statusEl.textContent = "먼저 Connect 하세요."; return; }

    ttsPlayBtn.disabled = true;
    statusEl.textContent = `🔊 TTS 합성 중… (${text.length}자)`;
    try {
      const provider = ttsProv.value || "";
      const data = await ctx.client.liteTtsPlayback(linkedId, text, provider);
      currentPlaybackId = data.playbackId || null;
      const preview = text.length > 28 ? text.substring(0, 28) + "…" : text;
      const cacheTag = data.cacheHit ? " (캐시)" : "";
      statusEl.textContent = `✓ TTS 재생: "${preview}"${cacheTag}`;
      ctx.log("ok", "lite:tts-playback:start", {
        linkedId, playbackId: currentPlaybackId,
        synthesizedBytes: data.synthesizedBytes, cacheHit: data.cacheHit,
        provider: data.provider, voice: data.voice,
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      // 1.4.5.8 미만에선 404 — 사용자에게 명확한 가이드
      const hint = /404/.test(msg) ? " (게이트웨이 1.4.5.8+ 필요)" : "";
      statusEl.textContent = `✗ TTS 실패: ${msg}${hint}`;
      ctx.log("err", "lite:tts-playback:fail", { error: msg });
    } finally {
      ttsPlayBtn.disabled = false;
    }
  });

  // ── 재생 중단 ────────────────────────────────────────────────────
  stopBtn.addEventListener("click", async () => {
    const linkedId = callSel.value;
    if (!linkedId) { statusEl.textContent = "통화를 선택하세요."; return; }
    if (!currentPlaybackId) { statusEl.textContent = "중단할 재생이 없습니다."; return; }
    if (!ctx.client) { statusEl.textContent = "먼저 연결하세요."; return; }

    stopBtn.disabled = true;
    statusEl.textContent = `■ 재생 중단 중…`;
    try {
      await ctx.client.liteStopPlayback(linkedId, currentPlaybackId);
      statusEl.textContent = `✓ 재생 중단됨`;
      ctx.log("ok", "lite:playback:stop", { linkedId, playbackId: currentPlaybackId });
      currentPlaybackId = null;
    } catch (err) {
      statusEl.textContent = `✗ 실패: ${err.message}`;
      ctx.log("err", "lite:stop:fail", { error: err.message });
    } finally {
      stopBtn.disabled = false;
    }
  });

  // ── 통화 종료 ───────────────────────────────────────────────────────────
  hangupBtn.addEventListener("click", async () => {
    const linkedId = callSel.value;
    if (!linkedId) { statusEl.textContent = "통화를 선택하세요."; return; }
    if (!ctx.client) { statusEl.textContent = "먼저 연결하세요."; return; }
    if (!confirm(`통화를 종료하시겠습니까?`)) return;

    hangupBtn.disabled = true;
    statusEl.textContent = `☎ 통화 종료 중…`;
    try {
      await ctx.client.hangup(linkedId);
      statusEl.textContent = `✓ 통화가 종료됐습니다`;
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
