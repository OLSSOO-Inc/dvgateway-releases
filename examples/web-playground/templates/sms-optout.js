// SMS opt-out registration (문자수신거부 등록) — TTS 안내 + 번호 확인.
//
// 흐름:
//   1) 통화가 연결(channel:state up)되면 안내 멘트를 TTS로 재생.
//   2) 등록할 번호를 정한다 — 두 가지 모드:
//      · 발신번호(CallerID) 사용: 통화의 caller 번호를 그대로 TTS로 안내.
//      · 직접 입력(DTMF):       발신자가 키패드로 번호를 누르면(#로 종료)
//                               입력한 번호를 TTS로 되읽어 확인.
//   3) 확정된 번호를 한 자리씩 또박또박 TTS로 안내해 "이 번호로 등록됩니다".
//
// 실제 운영에서는 3) 시점에 사내 수신거부 DB에 INSERT 하면 됩니다. 이 데모는
// TTS 확인까지만 보여줍니다. mode=both·lite·flow 어디서나 동작합니다 — DTMF는
// AMI 이벤트(모드 무관)로 수집하고, TTS는 PCM 주입(mode=both)이 안 되면 ARI
// Playback(lite/flow)으로 자동 폴백하므로 미디어 스트림이 없어도 들립니다.

const CODE = `// 문자수신거부 등록 — 연결 시 안내 → DTMF 수집 → 번호 확인 TTS
const callers  = new Map();      // linkedId → 발신번호(CallerID), call:new 에서 기록
const buffers  = new Map();      // linkedId → DTMF 로 입력 중인 숫자
const optedOut = new Set();      // 통화별 1회 처리 가드

// 번호를 한 자리씩 띄워 또박또박 읽히게: "0 1 0 ..."
const spell = (s) => (s || "").split("").join(" ");

ws.onmessage = async (msg) => {
  const evt = JSON.parse(msg.data);

  // 0) 발신번호 기억 (call:new 의 caller)
  if (evt.event === "call:new") callers.set(evt.linkedId, evt.caller || "");

  // 1) 통화 연결 → 안내 멘트 (ring 이 아니라 up 에서 — 그래야 들립니다)
  if (evt.event === "channel:state" && evt.state === "up") {
    buffers.set(evt.linkedId, "");
    await injectTts(evt.linkedId,
      "문자 수신거부 등록입니다. 발신하신 번호로 등록하시려면 우물정자를, " +
      "다른 번호로 등록하시려면 번호를 누르고 우물정자를 눌러주세요.");
  }

  // 2) DTMF 수집 (phase=end · received 방향만 — sent 는 게이트웨이 에코라 중복)
  if (evt.event === "call:dtmf" && evt.phase === "end") {
    if (evt.direction && evt.direction !== "received") return;
    const lid = evt.linkedId;
    if (optedOut.has(lid)) return;
    if (evt.digit === "#") {
      // # 만 눌렀으면 발신번호(CallerID)로, 아니면 입력한 번호로 등록
      const entered = buffers.get(lid) || "";
      const target = entered || callers.get(lid) || "";
      optedOut.add(lid);
      await injectTts(lid, \`\${spell(target)} 번호를 수신거부로 등록했습니다. 감사합니다.\`);
      // TODO: 사내 수신거부 DB 등록 — registerOptOut(target)
    } else if (/^[0-9*]$/.test(evt.digit)) {
      buffers.set(lid, (buffers.get(lid) || "") + evt.digit);
    }
  }
};`;

// 연결(up) 직후 미디어 경로가 안정화되기 전 주입하면 첫 음절이 끊겨 들린다.
const GREETING_DELAY_MS = 2000;

// DTMF 떨림 제거 창. 같은 digit 의 received 가 이 시간 안에 다시 오면 한 번의
// 누름으로 본다. 관측상 떨림 중복은 ~200ms 간격, 실제 같은 키 재누름은 보통
// 350ms+ 라 300ms 가 안전한 경계.
const DTMF_DEBOUNCE_MS = 300;

// spell: 번호를 한 자리씩 공백으로 분리해 TTS가 또박또박 읽도록.
const spell = (s) => String(s || "").replace(/[^0-9*#]/g, "").split("").join(" ");

// formatPhone: 한국 전화번호를 보기 좋은 하이픈 형식으로 (화면 표시용).
//   01012345678 → 010-1234-5678 / 0212345678 → 02-1234-5678 / 그 외는 원본.
const formatPhone = (s) => {
  const d = String(s || "").replace(/\D/g, "");
  if (/^01[016789]\d{7,8}$/.test(d)) {
    return d.length === 11
      ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`   // 010-1234-5678
      : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;  // 010-123-4567
  }
  if (/^02\d{7,8}$/.test(d)) {
    return d.length === 10
      ? `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`   // 02-1234-5678
      : `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}`;  // 02-123-4567
  }
  if (/^0\d{9,10}$/.test(d)) { // 그 외 지역번호 (031, 064 …)
    return d.length === 11
      ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`
      : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return d || String(s || "");
};

function mount(ctx) {
  ctx.body.innerHTML = `
    <p class="help">전화가 <b>연결되면</b> 수신거부 안내 멘트를 들려주고, 발신자가 키패드로 번호를 누르거나(#로 종료) 바로 #만 누르면 <b>발신번호(CallerID)</b>로 등록합니다. 등록 번호를 TTS로 또박또박 확인시켜 줘요. <b>mode=both·lite·flow 모두 동작</b>해요 (TTS는 PCM 주입이 안 되면 ARI 재생으로, DTMF는 AMI로 수집).</p>

    <div class="field">
      <label>안내 멘트 (연결되면 자동 재생)
        <textarea id="so-greet">문자 수신거부 등록입니다. 발신하신 번호로 등록하시려면 우물정자를, 다른 번호로 등록하시려면 번호를 누르고 우물정자를 눌러주세요.</textarea>
      </label>
      <p class="help">이 템플릿을 켜 둔 동안 <b>통화가 연결되면 안내 멘트를 자동 재생</b>합니다. 별도 버튼은 필요 없어요. 벨이 울리는 중에는 대기했다가 상대가 받는 순간 시작해요.</p>
    </div>

    <div class="transcript" id="so-state" style="margin-top:16px;">
      <p class="muted small">대기 중 — 통화가 연결되면 여기에 단계별 진행 상황이 표시돼요.</p>
    </div>
  `;

  const greetEl = ctx.body.querySelector("#so-greet");
  const stateEl = ctx.body.querySelector("#so-state");

  // 통화별 상태: { phase, entered, caller }
  const sessions = new Map();
  const log = [];

  function renderLog() {
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

  // 등록 대상 번호 조회 — "상대(고객) 번호".
  // click-to-call 아웃바운드는 우리 발신번호(caller=16682471)가 아니라 우리가
  // 건 고객 번호여야 하므로 peer(PeerNumber) 를 우선한다. peer 가 없으면(인바운드)
  // caller 로 폴백.
  function callerOf(linkedId) {
    const c = ctx.getActiveCalls().get(linkedId);
    if (!c) return "";
    return c.peer || c.caller || c.callerName || "";
  }

  async function speak(linkedId, text, label) {
    pushLog(linkedId, "🎙 음성 생성 중… (같은 문장은 캐시돼 다음부터 즉시)");
    try {
      const t0 = Date.now();
      await ctx.safeInjectText(linkedId, text);
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      pushLog(linkedId, `${label || `🔊 "${text.slice(0, 30)}${text.length > 30 ? "…" : ""}"`} · ${secs}s`);
      ctx.log("ok", "smsoptout:tts", { linkedId, text, mode: ctx.providerMode?.() });
    } catch (err) {
      pushLog(linkedId, `✗ TTS 실패: ${err.message}`);
      ctx.log("err", "smsoptout:fail", { error: err.message });
    }
  }

  // beginSession: 통화 연결 시 안내 멘트 재생 + 키 입력 수집 시작. 중복 호출
  // (즉시재생 + up 이벤트, 또는 중복 up)은 sessions 가드로 1회만 실행.
  async function beginSession(linkedId) {
    if (!ctx.client || !linkedId || sessions.has(linkedId)) return;
    sessions.set(linkedId, { phase: "collecting", entered: "", caller: callerOf(linkedId) });
    const greet = greetEl.value.trim();
    if (greet) {
      // 연결 직후 미디어 경로가 자리잡기 전에 주입하면 첫 음절이 잘려 들린다.
      // 잠시 기다렸다가 안내 멘트를 재생.
      pushLog(linkedId, "⏳ 연결됨 — 잠시 후 안내 멘트를 재생해요");
      await new Promise((r) => setTimeout(r, GREETING_DELAY_MS));
      await speak(linkedId, greet, "📢 안내 멘트 재생");
    }
    pushLog(linkedId, `⌨ 키 입력 대기 중 (등록 대상 ${callerOf(linkedId) || "미상"})`);
  }

  // 이미 연결(up)된 활성 통화가 있으면 템플릿을 켠 즉시 시작 — 통화 도중에
  // 골라도 바로 테스트되도록. 벨(ring) 단계면 안내만 띄우고 up 을 기다린다.
  const live = Array.from(ctx.getActiveCalls().values());
  const upCall = live.find((c) => c.state === "up" || c.channelState === "up");
  if (upCall) {
    beginSession(upCall.linkedId);
  } else if (live.length) {
    pushLog(live[0].linkedId, "📞 통화가 연결되면 자동으로 안내를 시작해요 (벨 울리는 중 대기)");
  }

  const handler = async (e) => {
    if (!ctx.client) return;
    const evt = e.detail;

    // 0) 통화 종료 → 해당 통화의 진행 상황/세션 정리 (화면을 깨끗이)
    if (evt.event === "call:ended" && evt.linkedId) {
      sessions.delete(evt.linkedId);
      // 이 통화에 대한 로그 줄 제거. 남은 통화가 없으면 안내 문구로 초기화.
      for (let i = log.length - 1; i >= 0; i--) {
        if (log[i].linkedId === evt.linkedId) log.splice(i, 1);
      }
      if (log.length === 0) {
        stateEl.innerHTML = `<p class="muted small">대기 중 — 통화가 연결되면 여기에 단계별 진행 상황이 표시돼요.</p>`;
      } else {
        renderLog();
      }
      return;
    }

    // 1) 통화 연결 → 안내 멘트
    if (evt.event === "channel:state" && evt.state === "up" && evt.linkedId) {
      await beginSession(evt.linkedId);
      return;
    }

    // 2) DTMF 수집
    if (evt.event === "call:dtmf" && evt.phase === "end" && evt.linkedId) {
      const s = sessions.get(evt.linkedId);
      if (!s || s.phase !== "collecting") return;

      // 게이트웨이는 같은 키를 direction="received"(발신자가 누름)와
      // direction="sent"(되돌려보낸 에코) 두 이벤트로 보낸다. 둘 다 수집하면
      // 입력이 두 배로 쌓이므로, 발신자가 실제로 누른 received 만 센다.
      // (direction 이 비어 있는 구버전 게이트웨이는 그대로 한 번만 처리.)
      if (evt.direction && evt.direction !== "received") return;

      // DTMF 떨림(debounce): 한 번 누른 키가 떼는 과정에서 같은 digit 의
      // received 가 짧은 간격으로 두 번 잡히는 경우가 있다(예: 6 이 25ms +
      // 180ms 로 두 번). 같은 digit 이 DTMF_DEBOUNCE_MS 안에 다시 오면 한 번의
      // 누름으로 보고 무시한다. 서로 다른 digit 은 항상 통과.
      const ts = evt.ts || Date.now();
      if (s.lastDigit === evt.digit && ts - (s.lastTs || 0) < DTMF_DEBOUNCE_MS) {
        return;
      }
      s.lastDigit = evt.digit;
      s.lastTs = ts;

      if (evt.digit === "#") {
        s.phase = "done";
        const target = s.entered || s.caller || "";
        if (!target) {
          await speak(evt.linkedId, "등록할 번호를 확인할 수 없습니다. 번호를 누르고 다시 시도해 주세요.", "⚠ 번호 없음");
          s.phase = "collecting";
          return;
        }
        await speak(
          evt.linkedId,
          `${spell(target)} 번호를 수신거부로 등록했습니다. 감사합니다.`,
          `✓ 등록 완료: ${formatPhone(target)} (${s.entered ? "직접 입력" : "발신번호"})`,
        );
        // 운영 환경에서는 이 시점에 사내 수신거부 DB에 등록.
      } else if (/^[0-9*]$/.test(evt.digit)) {
        s.entered += evt.digit;
        pushLog(evt.linkedId, `⌨ 입력 중: ${formatPhone(s.entered)}`);
      }
    }
  };

  if (ctx.client) ctx.client.addEventListener("event", handler);
  return () => {
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

export default { mount, code: CODE };
