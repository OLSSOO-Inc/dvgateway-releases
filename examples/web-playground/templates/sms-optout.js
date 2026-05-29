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
// TTS 확인까지만 보여줍니다. (mode=both 통화 필요 — TTS 주입에 미디어 스트림이
// 있어야 합니다.)

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

  // 2) DTMF 수집 (phase=end 기준)
  if (evt.event === "call:dtmf" && evt.phase === "end") {
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

// spell: 번호를 한 자리씩 공백으로 분리해 TTS가 또박또박 읽도록.
const spell = (s) => String(s || "").replace(/[^0-9*#]/g, "").split("").join(" ");

function mount(ctx) {
  ctx.body.innerHTML = `
    <p class="help">전화가 <b>연결되면</b> 수신거부 안내 멘트를 들려주고, 발신자가 키패드로 번호를 누르거나(#로 종료) 바로 #만 누르면 <b>발신번호(CallerID)</b>로 등록합니다. 등록 번호를 TTS로 또박또박 확인시켜 줘요. <b>(mode=both 통화 필요)</b></p>

    <div class="field">
      <label>안내 멘트 (연결되면 자동 재생)
        <textarea id="so-greet">문자 수신거부 등록입니다. 발신하신 번호로 등록하시려면 우물정자(#)를, 다른 번호로 등록하시려면 번호를 누르고 우물정자(#)를 눌러주세요.</textarea>
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

  function pushLog(linkedId, msg) {
    log.push({ linkedId, msg, _t: Date.now() });
    if (log.length > 40) log.shift();
    stateEl.innerHTML = log.slice(-20).reverse().map((e) => `
      <div class="line">
        <span class="speaker">${e.linkedId}</span> ${e.msg}
        <span class="muted small">${new Date(e._t).toLocaleTimeString()}</span>
      </div>
    `).join("");
  }

  // 발신번호 조회 — activeCalls 의 caller 필드.
  function callerOf(linkedId) {
    const c = ctx.getActiveCalls().get(linkedId);
    return (c && (c.caller || c.callerName)) || "";
  }

  async function speak(linkedId, text, label) {
    try {
      await ctx.safeInjectText(linkedId, text);
      pushLog(linkedId, label || `🔊 "${text.slice(0, 30)}${text.length > 30 ? "…" : ""}"`);
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
    if (greet) await speak(linkedId, greet, "📢 안내 멘트 재생");
    pushLog(linkedId, `⌨ 키 입력 대기 중 (발신번호 ${callerOf(linkedId) || "미상"})`);
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

    // 1) 통화 연결 → 안내 멘트
    if (evt.event === "channel:state" && evt.state === "up" && evt.linkedId) {
      await beginSession(evt.linkedId);
      return;
    }

    // 2) DTMF 수집
    if (evt.event === "call:dtmf" && evt.phase === "end" && evt.linkedId) {
      const s = sessions.get(evt.linkedId);
      if (!s || s.phase !== "collecting") return;

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
          `✓ 등록 완료: ${target} (${s.entered ? "직접 입력" : "발신번호"})`,
        );
        // 운영 환경에서는 이 시점에 사내 수신거부 DB에 등록.
      } else if (/^[0-9*]$/.test(evt.digit)) {
        s.entered += evt.digit;
        pushLog(evt.linkedId, `⌨ 입력 중: ${s.entered}`);
      }
    }
  };

  if (ctx.client) ctx.client.addEventListener("event", handler);
  return () => {
    if (ctx.client) ctx.client.removeEventListener("event", handler);
  };
}

export default { mount, code: CODE };
