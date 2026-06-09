// 대표번호 안내 → 담당자 연결 (소호/1인 사업자) — 실전 시나리오.
//
// 1인 사업자·소호(부동산·보험·사주팔자·O2O·타지역 안내 등)가 대표번호로 받은
// 전화를, 짧은 업종 인사말을 들려준 뒤 곧바로 담당자(사업자 본인 휴대폰 등)로
// 연결하는 가장 흔한 패턴입니다. DTMF 메뉴 분기 없이 "안내 → 연결" 한 흐름이라
// 설정이 번호 하나로 끝납니다.
//
// 단일 기능 데모(3.인사말 TTS / 12.웜트랜스퍼)를 실제 콜플로우로 엮은 응용
// 사례입니다. 모든 단계가 실제 게이트웨이 API라 시뮬레이션이 없습니다.
//
// 흐름:
//   1) 통화 연결(channel:state up) → 업종 인사말 TTS 재생
//      (예: "안녕하세요, ○○공인중개사입니다. 담당자에게 연결해 드리겠습니다.").
//   2) 인사말이 끝나면 곧바로 담당자 번호로 warm transfer — 통화를 보류하고
//      담당자를 호출해 응답하면 브릿지로 연결.
//
// mode=both·lite·flow 어디서나 동작: TTS는 PCM 주입(mode=both)이 안 되면 ARI
// Playback(lite/flow)으로 자동 폴백한다. warm transfer 는 게이트웨이 ARI 활성 필요.

const CODE = `// 소호 대표번호: 업종 인사말 → 담당자 연결 (warm transfer)
const GREETING = "안녕하세요, OO공인중개사입니다. 담당자에게 연결해 드리겠습니다.";
const AGENT = "01012345678";       // 담당자(사업자 본인) 번호 — 외부면 outbound:true
const connected = new Set();       // 통화별 1회 처리 가드

ws.onmessage = async (msg) => {
  const evt = JSON.parse(msg.data);

  // 통화 연결(up) → 인사말 재생 → 담당자 연결
  if (evt.event === "channel:state" && evt.state === "up") {
    const lid = evt.linkedId;
    if (connected.has(lid)) return;
    connected.add(lid);

    await injectTts(lid, GREETING);          // 1) 업종 인사말
    const r = await warmTransfer(lid, {      // 2) 담당자로 연결
      destination: AGENT,
      outbound: true,                        // 휴대폰/외부번호면 트렁크 발신
      timeoutMs: 30000,
    });
    // r.connected: 담당자 응답·연결 성사 여부
  }
};`;

// 연결(up) 직후 미디어 경로가 자리잡기 전에 주입하면 첫 음절이 잘려 들린다.
const GREETING_DELAY_MS = 2000;

// 업종별 인사말 프리셋 — 선택하면 멘트가 채워지고, 자유롭게 수정 가능.
// {biz} 자리표시자는 아래 "상호" 입력값으로 치환된다.
const PRESETS = [
  { id: "realestate", label: "🏠 부동산",   text: "안녕하세요, {biz}입니다. 매물 문의 주셔서 감사합니다. 담당자에게 연결해 드리겠습니다." },
  { id: "insurance",  label: "🛡 보험",     text: "안녕하세요, {biz}입니다. 보험 상담 도와드리겠습니다. 담당 설계사에게 연결해 드릴게요." },
  { id: "fortune",    label: "🔮 사주·운세", text: "안녕하세요, {biz}입니다. 상담 신청 감사합니다. 잠시 후 상담사에게 연결해 드리겠습니다." },
  { id: "o2o",        label: "🛠 O2O·출장", text: "안녕하세요, {biz}입니다. 예약·견적 문의 감사합니다. 담당 기사에게 바로 연결해 드릴게요." },
  { id: "region",     label: "📍 타지역 안내", text: "안녕하세요, {biz}입니다. 해당 지역 담당자에게 연결해 드리겠습니다. 잠시만 기다려 주세요." },
  { id: "custom",     label: "✏ 직접 입력", text: "" },
];

function mount(ctx) {
  ctx.body.innerHTML = `
    <p class="help">
      대표번호로 전화가 <b>연결되면</b> 업종 인사말을 들려주고, 멘트가 끝나면 곧바로
      담당자(사업자 본인 휴대폰 등)로 <b>연결</b>합니다. 1인 사업자·소호에 맞춘
      <b>안내 → 연결</b> 단순 패턴이에요 (키 입력·메뉴 없음).
      <b>3.인사말 TTS + 12.웜트랜스퍼</b>를 하나의 콜플로우로 엮은 예시이며,
      mode=both·lite·flow 모두 동작합니다. 웜 트랜스퍼는 게이트웨이 ARI가 활성이어야 합니다.
    </p>

    <div class="row" style="gap:14px;flex-wrap:wrap;align-items:flex-end;">
      <div class="field" style="flex:1;min-width:140px;">
        <label>업종 프리셋
          <select id="irt-preset">
            ${PRESETS.map((p) => `<option value="${p.id}">${p.label}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="field" style="flex:1;min-width:160px;">
        <label>상호 (멘트의 {biz} 자리)
          <input id="irt-biz" type="text" value="OO공인중개사" placeholder="예: OO공인중개사">
        </label>
      </div>
    </div>

    <div class="field">
      <label>인사말 멘트 (연결되면 자동 재생)
        <textarea id="irt-greet"></textarea>
      </label>
    </div>

    <div class="row" style="gap:14px;flex-wrap:wrap;align-items:flex-end;">
      <div class="field" style="flex:1;min-width:180px;">
        <label>담당자 번호 (연결 대상)
          <input id="irt-dest" type="text" placeholder="예: 01012345678 (휴대폰) 또는 1001 (내선)">
        </label>
      </div>
      <label class="inline" style="display:flex;align-items:center;gap:5px;padding-bottom:10px;">
        <input id="irt-outbound" type="checkbox" checked> 외부번호로 발신 (휴대폰·트렁크)
      </label>
    </div>
    <p class="help">담당자가 <b>휴대폰/외부번호</b>면 외부발신을 켜세요(트렁크 컨텍스트로 발신). 사내 <b>내선</b>이면 끄세요.</p>

    <div class="transcript" id="irt-state" style="margin-top:16px;">
      <p class="muted small">대기 중 — 통화가 연결되면 여기에 단계별 진행 상황이 표시돼요.</p>
    </div>
  `;

  const presetEl = ctx.body.querySelector("#irt-preset");
  const bizEl = ctx.body.querySelector("#irt-biz");
  const greetEl = ctx.body.querySelector("#irt-greet");
  const destEl = ctx.body.querySelector("#irt-dest");
  const outboundEl = ctx.body.querySelector("#irt-outbound");
  const stateEl = ctx.body.querySelector("#irt-state");

  // 프리셋 → 멘트 채우기({biz} 치환). "직접 입력"이면 비우고 사용자가 작성.
  // 사용자가 멘트를 수동 편집한 뒤에는 프리셋/상호 변경이 덮어쓰지 않도록 가드.
  let greetEdited = false;
  function applyPreset() {
    const p = PRESETS.find((x) => x.id === presetEl.value) || PRESETS[0];
    if (p.id === "custom") {
      if (!greetEdited) greetEl.value = "";
      return;
    }
    if (!greetEdited) {
      greetEl.value = p.text.replace(/\{biz\}/g, bizEl.value.trim() || "저희 업체");
    }
  }
  presetEl.addEventListener("change", () => { greetEdited = false; applyPreset(); });
  bizEl.addEventListener("input", applyPreset);
  greetEl.addEventListener("input", () => { greetEdited = true; });
  applyPreset(); // 초기 멘트 채우기

  // ── 진행 상황 로그 (sms-optout 패턴) ────────────────────────────
  const log = [];
  function renderLog() {
    if (log.length === 0) {
      stateEl.innerHTML = `<p class="muted small">대기 중 — 통화가 연결되면 여기에 단계별 진행 상황이 표시돼요.</p>`;
      return;
    }
    stateEl.innerHTML = log.slice(-20).reverse().map((e) => `
      <div class="line">
        <span class="speaker">${e.linkedId}</span> ${e.msg}
        <span class="muted small">${new Date(e._t).toLocaleTimeString()}</span>
      </div>
    `).join("");
  }
  function pushLog(linkedId, msg) {
    log.push({ linkedId, msg, _t: Date.now() });
    if (log.length > 40) log.shift();
    renderLog();
  }

  // ── TTS 재생 (mode 무관 폴백) ───────────────────────────────────
  async function speak(linkedId, text, label) {
    try {
      const t0 = Date.now();
      await ctx.safeInjectText(linkedId, text);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      pushLog(linkedId, `${label || `🔊 "${text.slice(0, 30)}${text.length > 30 ? "…" : ""}"`} · ${secs}s`);
      ctx.log("ok", "soho-route:tts", { linkedId, text, mode: ctx.providerMode?.() });
    } catch (err) {
      pushLog(linkedId, `✗ TTS 실패: ${err.message}`);
      ctx.log("err", "soho-route:tts:fail", { error: err.message });
    }
  }

  // ── warm transfer 연결 ──────────────────────────────────────────
  async function routeTo(linkedId, dest, outbound) {
    pushLog(linkedId, `🔀 담당자 연결 중… (${dest}${outbound ? " · 외부" : " · 내선"})`);
    ctx.log("info", "soho-route:transfer:start", { linkedId, dest, outbound });
    try {
      const r = await ctx.client.warmTransfer(linkedId, {
        destination: dest,
        timeoutMs: 30000,
        outbound,
        // 외부발신이면 트렁크 컨텍스트가 필요(운영 환경에 맞게 조정). 내선이면 기본값.
        context: outbound ? "cos-all" : "from-internal",
      });
      if (r && r.connected) {
        pushLog(linkedId, `✓ 담당자 연결 완료 (${dest})`);
      } else {
        const reason = (r && (r.failureReason || r.whisperSkipReason)) || "응답 없음/거절";
        pushLog(linkedId, `⚠ 담당자 연결 안 됨: ${reason}`);
      }
      ctx.log(r && r.connected ? "ok" : "warn", "soho-route:transfer:result", r || {});
    } catch (err) {
      pushLog(linkedId, `✗ 연결 실패: ${err.message}`);
      ctx.log("err", "soho-route:transfer:fail", { error: err.message });
    }
  }

  // ── 통화별 상태머신 ─────────────────────────────────────────────
  // sessions: linkedId → { phase: "greeting"|"routing"|"done" }
  const sessions = new Map();

  async function beginSession(linkedId) {
    if (!ctx.client || !linkedId || sessions.has(linkedId)) return;
    const dest = destEl.value.trim();
    if (!dest) {
      pushLog(linkedId, "⚠ 담당자 번호가 비어 있어요 — 위에 연결할 번호를 입력하세요");
      return;
    }
    sessions.set(linkedId, { phase: "greeting" });

    const greet = greetEl.value.trim();
    if (greet) {
      pushLog(linkedId, "⏳ 연결됨 — 잠시 후 인사말을 재생해요");
      await new Promise((r) => setTimeout(r, GREETING_DELAY_MS));
      await speak(linkedId, greet, "📢 인사말 재생");
    }

    // 인사말이 끝나면 곧바로 담당자 연결.
    const s = sessions.get(linkedId);
    if (!s) return; // 재생 중 통화 종료
    s.phase = "routing";
    await routeTo(linkedId, dest, outboundEl.checked);
    if (sessions.get(linkedId)) sessions.get(linkedId).phase = "done";
  }

  // 이미 연결(up)된 활성 통화가 있으면 템플릿을 켠 즉시 시작.
  const live = Array.from(ctx.getActiveCalls().values());
  const upCall = live.find((c) => c.state === "up" || c.channelState === "up");
  if (upCall) {
    beginSession(upCall.linkedId);
  } else if (live.length) {
    pushLog(live[0].linkedId, "📞 통화가 연결되면 자동으로 인사말 → 담당자 연결을 시작해요 (벨 울리는 중 대기)");
  }

  const handler = async (e) => {
    if (!ctx.client) return;
    const evt = e.detail;

    // 0) 통화 종료 → 세션/로그 정리
    if (evt.event === "call:ended" && evt.linkedId) {
      sessions.delete(evt.linkedId);
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].linkedId === evt.linkedId) log.splice(i, 1);
      }
      renderLog();
      return;
    }

    // 1) 통화 연결 → 인사말 → 담당자 연결
    if (evt.event === "channel:state" && evt.state === "up" && evt.linkedId) {
      await beginSession(evt.linkedId);
      return;
    }
  };

  if (ctx.client) ctx.client.addEventListener("event", handler);
  return () => {
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

export default { mount, code: CODE };
