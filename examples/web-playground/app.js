import { GatewayClient } from "./lib/gateway-client.js";
import { templates, getTemplate } from "./templates/index.js";
import { getBrowserTtsAdapter, listBrowserTtsProviders, listTtsProviders, listSttProviders } from "./lib/providers/index.js";

const STORAGE_KEY = "dvgw-playground-creds-v2";
const PROV_STORAGE_KEY = "dvgw-playground-provider-v1";
const OUTBOUND_STORAGE_KEY = "dvgw-playground-outbound-v1";
const WELCOME_DISMISS_KEY = "dvgw-playground-welcome-dismissed-v1";
const TERMINAL_CHANNEL_STATES = new Set(["down", "busy", "no_answer", "rejected"]);
const POLL_INTERVAL_MS = 30000; // sessions reconciliation tick

// Track outstanding originate requests by callee number so we can spotlight
// the matching activeCall card the moment channel:state up arrives. Cleared
// when matched or after a 60s ttl.
const pendingOutbound = new Map(); // callee → { ts, actionId }
const state = {
  client: null,
  activeCalls: new Map(),
  // linkedIds that we (this browser) initiated TTS/audio for. When a
  // tts:playback or audio:playback start fires for an id NOT in this set,
  // it means another callinfo subscriber (a bot, another tab) is acting on
  // the same call — surface that as a banner so the user understands why
  // their actions race or 404.
  selfInjections: new Set(),
  // injectIds (X-Inject-Id) of TTS we (this browser) sent. Used to tell our
  // OWN sequential injections apart from a genuine other-subscriber injection.
  // When sms-optout/greeting injects a 2nd time on the same call (e.g. the
  // confirmation prompt after the greeting), the gateway preempts our 1st
  // playback — that is normal, NOT another bot, so we must not warn on a
  // preempt/start whose injectId is one of ours.
  myInjectIds: new Set(),
  externalActors: new Set(),
  currentTemplate: null,
  templateDispose: null,
  logCount: 0,
  pollTimer: null,
  // Provider keys / mode — kept browser-local. In Mode A, the actual key
  // is sent once to the gateway via POST /api/v1/config/apikeys and the
  // gateway uses it for /tts/synthesize + STT. In Mode B, the browser
  // calls the provider directly and never hands the key to the gateway.
  provider: {
    mode: "A",                 // "A" (gateway) or "B" (browser-direct)
    ttsProvider: "elevenlabs", // current TTS adapter selection
    ttsKey: "",                // browser-local copy (Mode B); also used to save into Mode A
    ttsVoice: "",
    sttProvider: "deepgram",
    sttKey: "",
  },
  // keyStatus: whether the gateway currently has a usable TTS / STT provider
  // key registered. Refreshed from GET /api/v1/config/apikeys on connect and
  // after each key save. Drives the per-template "키 등록됨 / 키 필요" tags so
  // the user sees at a glance whether a demo will work. null = 아직 미확인.
  // {ttsByProvider,sttByProvider}: per-provider presence (name → bool) so the
  // provider panel can show whether the SELECTED provider already has a saved
  // key — changing the dropdown clears the input and would otherwise hide it.
  keyStatus: { tts: null, stt: null, ttsByProvider: {}, sttByProvider: {} },
};

const $ = (id) => document.getElementById(id);

// ── credentials ────────────────────────────────────────────────────
function loadCreds() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const c = JSON.parse(raw);
    if (c.host) $("cred-host").value = c.host;
    if (c.tenantId) $("cred-tid").value = c.tenantId;
    if (c.password) $("cred-pw").value = c.password;
    if (c.tls) $("cred-tls").checked = true;
    if (c.loginPort) $("cred-login-port").value = c.loginPort;
    if (c.apiPort) $("cred-api-port").value = c.apiPort;
  } catch {}
}

function readCreds() {
  return {
    host: $("cred-host").value.trim(),
    tenantId: $("cred-tid").value.trim(),
    password: $("cred-pw").value,
    tls: $("cred-tls").checked,
    loginPort: parseInt($("cred-login-port").value, 10) || 8081,
    apiPort: parseInt($("cred-api-port").value, 10) || 8080,
  };
}

function saveCreds() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readCreds()));
}

function clearCreds() {
  localStorage.removeItem(STORAGE_KEY);
  $("cred-host").value = "";
  $("cred-tid").value = "";
  $("cred-pw").value = "";
  $("cred-tls").checked = false;
  $("cred-login-port").value = 8081;
  $("cred-api-port").value = 8080;
  // also wipe provider keys — operator clearing creds expects a clean
  // browser, including any cached provider keys (Mode B safety).
  clearProviderState();
  renderProviderUI();
  // 공용 PC 안전: 환영 모달 dismiss 상태도 함께 제거 → 다음 사용자에게
  // 처음 가이드가 다시 노출됨.
  localStorage.removeItem(WELCOME_DISMISS_KEY);
  log("ok", "creds:cleared");
}

// ── connection ─────────────────────────────────────────────────────
function setStatus(state, text) {
  const dot = $("conn-dot");
  dot.className = `dot ${state}`;
  $("conn-text").textContent = text;
}

function setTenantPill(tid) {
  const el = $("conn-tenant");
  if (tid) {
    el.textContent = `tenant: ${tid}`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

// setGatewayVersionPill / fetchGatewayVersion: 1.4.5.10(#600)에서 도입된
// 헤더 좌측 'gw vX.Y.Z' 표시. 사용자가 어느 게이트웨이에 붙어있는지
// 한눈에 보고 운영자와 소통할 때 버전을 인용하기 쉽도록 함.
function setGatewayVersionPill(version) {
  const el = $("gw-version");
  if (!el) return;
  if (version) {
    el.textContent = `gw v${version}`;
    el.classList.remove("hidden");
  } else {
    el.textContent = "";
    el.classList.add("hidden");
  }
}

async function fetchGatewayVersion() {
  if (!state.client) return;
  try {
    const r = await fetch(`${state.client.apiBase}/api/v1/version`, {
      headers: state.client.token ? { Authorization: `Bearer ${state.client.token}` } : {},
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    if (data && data.version) {
      setGatewayVersionPill(data.version);
      log("ok", "gw:version", { version: data.version, product: data.product });
    }
  } catch (err) {
    // nice-to-have이므로 실패는 로그만.
    log("err", "gw:version:fail", { error: String(err.message || err) });
  }
}

async function connect() {
  const creds = readCreds();
  if (!creds.host || !creds.tenantId || !creds.password) {
    alert("Gateway Host, Tenant ID, Password 모두 입력하세요.");
    return;
  }
  saveCreds();

  if (state.client) state.client.disconnect();

  const client = new GatewayClient(creds);
  client.onQuota = flashQuotaNotice; // provider 429 → 친절 안내(장애 아님)
  state.client = client;

  client.addEventListener("status", (e) => {
    const s = e.detail.state;
    if (s === "open") setStatus("on", `connected · ${creds.host}:${creds.apiPort}`);
    else if (s === "connecting") setStatus("connecting", "connecting…");
    else if (s === "closed") setStatus("off", "disconnected");
    else if (s === "error") setStatus("off", "error");
  });

  client.addEventListener("event", (e) => onCallinfoEvent(e.detail));

  // Reconciliation tick: ask the gateway for the authoritative session
  // list every POLL_INTERVAL_MS and drop any local card the gateway no
  // longer knows about. Belt to the WS suspenders — if call:ended is
  // missed or routed elsewhere, the next poll cleans up.
  stopPolling();
  state.pollTimer = setInterval(reconcileSessions, POLL_INTERVAL_MS);

  setStatus("connecting", "logging in…");
  try {
    const { tid, exp } = await client.login();
    if (tid && tid !== creds.tenantId) {
      log("err", "login:mismatch", { claimed: tid, input: creds.tenantId });
    }
    setTenantPill(tid || creds.tenantId);
    log("ok", "login:ok", {
      tid: tid || creds.tenantId,
      expiresIn: exp ? `${Math.floor((exp - Date.now() / 1000) / 60)}m` : "?",
    });
  } catch (err) {
    log("err", "login:fail", { error: String(err.message || err) });
    setStatus("off", "login failed");
    setTenantPill(null);
    return;
  }
  client.connectCallinfo();
  refreshOutboundDefaults();
  // 현재 템플릿을 다시 mount해서 callinfo 이벤트 listener가 살아있는
  // client에 등록되도록 함. init() 시점에 client=null로 mount된 상태라면
  // listener가 영구히 안 달려있던 회귀를 방지.
  remountCurrentTemplate();
  // 템플릿 카드의 TTS/STT 키 태그를 게이트웨이 등록 상태로 갱신.
  refreshKeyStatus();
  // 헤더 좌측에 게이트웨이 버전 표시.
  fetchGatewayVersion();
}

function disconnect() {
  setOutboundEnabled(false, "Disconnect 됨. 다시 Connect 하면 발신 고정값을 불러옵니다.");
  $("btn-originate").disabled = true;
  if (state.client) {
    state.client.disconnect();
    state.client = null;
  }
  state.activeCalls.clear();
  renderCalls();
  setStatus("off", "disconnected");
  setTenantPill(null);
  setGatewayVersionPill(null);
  stopPolling();
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

// reconcileSessions: ask the gateway for the current session list and
// drop any local card the gateway no longer tracks. Quiet on success;
// errors are non-fatal — we'll retry next tick.
async function reconcileSessions() {
  if (!state.client) return;
  let live;
  try {
    live = await state.client.listSessions();
  } catch (err) {
    log("err", "poll:fail", { error: String(err.message || err) });
    return;
  }
  // The /api/v1/sessions response shape is { calls: [...], conferences: [...] }
  // for tenant tokens. Accept arrays too in case admin tokens are used.
  const seen = new Set();
  const collect = (arr) => Array.isArray(arr) && arr.forEach((c) => {
    const lid = c && (c.linkedId || c.LinkedID);
    if (lid) seen.add(lid);
  });
  if (Array.isArray(live)) collect(live);
  else if (live && typeof live === "object") {
    collect(live.calls);
    collect(live.conferences);
    collect(live.activeCalls);
  }
  let removed = 0;
  for (const lid of Array.from(state.activeCalls.keys())) {
    if (!seen.has(lid)) {
      state.activeCalls.delete(lid);
      state.selfInjections.delete(lid);
      state.externalActors.delete(lid);
      removed++;
    }
  }
  if (removed > 0) {
    renderCalls();
    renderExternalActorBanner();
    log("ok", "poll:reconciled", { removed });
  }
}

// ── callinfo dispatch ──────────────────────────────────────────────
function onCallinfoEvent(evt) {
  log(eventLevel(evt.event), evt.event, evt);

  switch (evt.event) {
    case "snapshot":
      // Always rebuild from the snapshot — an empty list means no active
      // calls and we must clear any stale local cards (page reload mid-call,
      // missed call:ended during WS gap, etc).
      state.activeCalls.clear();
      state.externalActors.clear();
      state.myInjectIds.clear(); // no live calls → our injectIds are all stale
      (evt.activeCalls || []).forEach((c) => state.activeCalls.set(c.linkedId, c));
      renderCalls();
      renderExternalActorBanner();
      break;
    case "call:new":
      state.activeCalls.set(evt.linkedId, { ...evt, state: "ring" });
      renderCalls();
      break;
    case "call:ended":
      state.activeCalls.delete(evt.linkedId);
      state.selfInjections.delete(evt.linkedId);
      state.externalActors.delete(evt.linkedId);
      renderCalls();
      renderExternalActorBanner();
      break;
    case "channel:state": {
      const c = state.activeCalls.get(evt.linkedId);
      // Spotlight an outbound card the moment the callee picks up. We
      // match on the dialed number (evt.callee) rather than linkedId
      // because the gateway assigns the linkedId server-side and the
      // browser only knows what it dialed.
      if (evt.state === "up" && evt.callee && pendingOutbound.has(evt.callee)) {
        pendingOutbound.delete(evt.callee);
        // Render may not have created the card yet (snapshot ordering);
        // schedule for the next tick.
        setTimeout(() => highlightOutboundCard(evt.linkedId), 50);
      }
      if (TERMINAL_CHANNEL_STATES.has(evt.state)) {
        // busy / no_answer / rejected often arrive without a matching
        // call:ended (the call never reached "up"). Drop the card to
        // prevent stale ring entries from piling up.
        state.activeCalls.delete(evt.linkedId);
        state.selfInjections.delete(evt.linkedId);
        state.externalActors.delete(evt.linkedId);
        renderCalls();
        renderExternalActorBanner();
        break;
      }
      if (c) {
        c.channelState = evt.state;
        if (evt.state === "up") c.state = "up";
        if (evt.state === "ring") c.state = "ring";
        renderCalls();
      }
      break;
    }
    case "tts:playback":
    case "audio:playback": {
      if (!evt.linkedId) break;

      // External-actor detection: a playback we did NOT start, on a call
      // that's still active. The first `phase=start` for an unknown
      // injectId/playbackId arrives from another callinfo subscriber.
      const evtInjectId = evt.injectId || evt.playbackId;
      // terminal phases of our own injection — drop the tracked id so the set
      // doesn't grow unbounded across a long call with many injections.
      if (evtInjectId && (evt.phase === "complete" || evt.phase === "failed")) {
        state.myInjectIds.delete(evtInjectId);
      }
      if (evt.phase === "start") {
        // If WE are injecting on this call, the start is ours — full stop.
        // The gateway can emit tts:playback `start` over the WS BEFORE the
        // injectAudio HTTP response (which carries our injectId) returns, so
        // matching purely on injectId races and false-flags our own audio.
        // In this single-operator playground a start on a call we're injecting
        // into is effectively never a foreign bot, so trust selfInjections.
        if (state.selfInjections.has(evt.linkedId)) break;
        // Otherwise, a recognised injectId is still ours (defensive); only an
        // unknown id on a call we're NOT injecting into is a real other actor.
        if (evtInjectId && state.myInjectIds.has(evtInjectId)) break;
        state.externalActors.add(evt.linkedId);
        renderExternalActorBanner();
        break;
      }

      // Preempt detection — gateway publishes phase=canceled with
      // errorReason=preempted when a newer inject_tts for the same linkedId
      // arrives. This is a normal self-preempt whenever WE are the one
      // injecting on the call (e.g. greeting → confirmation prompt), so stay
      // quiet. Only warn when the preempt happens on a call we are NOT
      // injecting into AND the preempted id is not one of ours — i.e. a
      // genuine other subscriber. (Same single-operator rationale as `start`.)
      if (evt.phase === "canceled" && evt.errorReason === "preempted") {
        if (evtInjectId) state.myInjectIds.delete(evtInjectId); // done with this one
        if (state.selfInjections.has(evt.linkedId)) break; // our own re-inject — quiet
        // not injecting on this call but our id was preempted? still ours.
        if (evtInjectId && state.myInjectIds.has(evtInjectId)) break;
        // genuine foreign preempt — but only meaningful if we ever played here.
        // With no self-injection on this call there is nothing of ours to lose,
        // so we simply note it without alarming the user.
        log("info", "preempt:observed", { linkedId: evt.linkedId, injectId: evtInjectId });
      }
      break;
    }
  }
}

function flashPreemptToast(linkedId) {
  const el = $("preempt-toast");
  if (!el) return;
  el.textContent = `방금 보낸 음원이 다른 구독자에 의해 끊겼습니다 (linkedId=${linkedId}). 같은 테넌트로 붙어 있는 봇이 새 inject_tts를 보낸 것입니다.`;
  el.classList.remove("hidden");
  clearTimeout(flashPreemptToast._t);
  flashPreemptToast._t = setTimeout(() => el.classList.add("hidden"), 8000);
}

// flashQuotaNotice: show a friendly, non-error advisory when the cloud TTS
// provider hit its rate-limit / quota (HTTP 429). This is NOT a service outage
// — the gateway fell back to a basic built-in voice so the call still works,
// and the cloud voice returns automatically once the quota window resets. The
// wording is for non-engineers so they don't report a false outage.
function flashQuotaNotice({ provider, retryAfterSec }) {
  const el = $("quota-notice");
  if (!el) return;
  const prov = provider || "클라우드 TTS";
  const retry = retryAfterSec > 0
    ? `약 ${retryAfterSec}초 후 자동으로 정상화돼요.`
    : "잠시 후 자동으로 정상화돼요.";
  el.textContent =
    `⏳ ${prov} 음성 생성 사용량(무료 한도)을 잠시 초과했어요 — 서비스 장애가 아닙니다. ` +
    `지금은 기본 안내 음성으로 대체 재생되며, ${retry} ` +
    `자주 쓰는 문장은 캐시되어 한도에 영향을 덜 줍니다.`;
  el.classList.remove("hidden");
  clearTimeout(flashQuotaNotice._t);
  flashQuotaNotice._t = setTimeout(() => el.classList.add("hidden"), 12000);
  log("err", "tts:quota", { provider: prov, retryAfterSec });
}

function eventLevel(name) {
  if (!name) return "";
  if (name === "call:ended" || name === "snapshot") return "ok";
  if (name.includes("error") || name.endsWith(":failed")) return "err";
  return "";
}

// ── active call cards ──────────────────────────────────────────────
function renderCalls() {
  const list = $("call-list");
  // 활성 통화가 있으면 originate 버튼을 자동 disable — 같은 사용자가
  // 연달아 눌러 중복 발신이 일어나는 사고를 차단. activeCalls가 0건으로
  // 떨어지면(=통화 종료/카드 dismiss) 자동 재활성화. outbound-defaults
  // 미등록 등의 다른 disable 조건은 refreshOutboundDefaults()가 별도로
  // 관리하므로 여기서는 활성 통화 유무만 반영한다.
  syncOriginateButton();
  // 본문 상단 toolbar 도 같이 갱신 — 사이드바 카드와 동일 데이터 소스.
  renderActiveCallToolbar();
  if (state.activeCalls.size === 0) {
    list.innerHTML = '<p class="muted small">아직 활성 통화가 없습니다.</p>';
    return;
  }
  const cards = [];
  for (const call of state.activeCalls.values()) {
    const extActor = state.externalActors.has(call.linkedId);
    // 사이드바 카드의 ☎ 통화 끊기 버튼은 1.4.7.0 부터 제거 — 통화 끊기는
    // 본문 상단 #active-call-toolbar 의 ☎ 통화 끊기 한 곳에서만 노출되어
    // 진입점 중복을 정리한다. 카드 dismiss(×) 는 그대로 유지.
    cards.push(`
      <div class="call-card" data-linkedid="${escapeHtml(call.linkedId || "")}">
        <button class="card-x" data-action="dismiss" data-linkedid="${escapeHtml(call.linkedId || "")}" title="카드 제거 (게이트웨이에는 영향 없음)">×</button>
        <div class="id">${escapeHtml(call.linkedId || "")}</div>
        <div class="caller">${escapeHtml(call.caller || "?")}${call.callerName ? ` (${escapeHtml(call.callerName)})` : ""} → ${escapeHtml(call.callee || call.did || "?")}</div>
        <span class="state ${call.state || ""}">${escapeHtml(call.state || "?")}</span>
        ${extActor ? '<span class="state ext">other-client</span>' : ""}
      </div>
    `);
  }
  list.innerHTML = cards.join("");
  list.querySelectorAll("button.card-x").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const lid = btn.dataset.linkedid;
      if (!lid) return;
      state.activeCalls.delete(lid);
      state.selfInjections.delete(lid);
      state.externalActors.delete(lid);
      log("ok", "card:dismissed", { linkedId: lid });
      renderCalls();
      renderExternalActorBanner();
    });
  });
}

// renderActiveCallToolbar: 본문 #demo-body 위에 활성 통화별 ☎ 통화 끊기
// 버튼을 노출. 어느 템플릿(STT/TTS/IVR/Playback...)을 열어도 동일한
// 위치에서 통화를 끊을 수 있어, 사이드바 카드 위치를 가리는 좁은 창에서도
// 운영자가 바로 종료 액션에 도달 가능하다. 사이드바 카드 hangup 과
// 같은 requestHangup() 진입점을 공유하므로 모달/로직이 항상 일치한다.
function renderActiveCallToolbar() {
  const el = $("active-call-toolbar");
  if (!el) return;
  if (!state.activeCalls.size) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  const rows = [];
  for (const call of state.activeCalls.values()) {
    const who = `${escapeHtml(call.caller || "?")}${call.callerName ? ` (${escapeHtml(call.callerName)})` : ""} → ${escapeHtml(call.callee || call.did || "?")}`;
    rows.push(`
      <div class="toolbar-row" data-linkedid="${escapeHtml(call.linkedId || "")}">
        <span class="id">${escapeHtml(call.linkedId || "")}</span>
        <span class="who">${who}</span>
        <span class="state ${call.state || ""}">${escapeHtml(call.state || "?")}</span>
        <button class="toolbar-hangup" data-action="hangup" data-linkedid="${escapeHtml(call.linkedId || "")}" title="통화 끊기 — 채널을 끊고 CDR 기록을 남긴다">☎ 통화 끊기</button>
      </div>
    `);
  }
  el.classList.remove("hidden");
  el.innerHTML = `<div class="toolbar-head">활성 통화 ${state.activeCalls.size}건</div>${rows.join("")}`;
  el.querySelectorAll("button.toolbar-hangup").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      requestHangup(btn.dataset.linkedid, btn, "☎ 통화 끊기");
    });
  });
}

// requestHangup: 카드·toolbar 어디서든 동일한 흐름으로 통화를 끊는다.
// dvgwConfirm(Lite IVR 과 같은 공용 모달) → SDK client.hangup() → 성공 시
// call:ended 이벤트로 UI 자동 정리. 실패하면 버튼 상태만 복구하고 카드는
// 그대로 둬서 운영자가 재시도할 수 있게 한다.
async function requestHangup(lid, btn, originalLabel) {
  if (!lid) return;
  if (!state.client) {
    log("err", "hangup:no-client", { linkedId: lid });
    return;
  }
  const ok = window.dvgwConfirm
    ? await window.dvgwConfirm(`통화 ${lid} 를 끊을까요?`, { title: "통화 끊기", okLabel: "끊기" })
    : confirm(`통화 ${lid} 를 끊을까요?`);
  if (!ok) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "☎ 끊는 중…";
  }
  try {
    await state.client.hangup(lid);
    log("ok", "hangup:requested", { linkedId: lid });
  } catch (err) {
    log("err", "hangup:fail", { linkedId: lid, error: err.message || String(err) });
    if (btn) {
      btn.disabled = false;
      btn.textContent = originalLabel || "☎ 통화 끊기";
    }
  }
}

function renderExternalActorBanner() {
  const el = $("ext-actor-banner");
  if (!el) return;
  const ids = Array.from(state.externalActors).filter((lid) => state.activeCalls.has(lid));
  if (ids.length === 0) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.classList.remove("hidden");
  const preview = ids.slice(0, 3).join(", ") + (ids.length > 3 ? ` (+${ids.length - 3})` : "");
  el.textContent = `다른 callinfo 구독자가 동일 통화에 TTS/음원을 주입 중입니다 (${preview}). 이 봇이 곧 hangup 하면 우리 쪽 주입은 404가 됩니다.`;
}

// ── provider keys / mode ──────────────────────────────────────────
function loadProviderState() {
  try {
    const raw = localStorage.getItem(PROV_STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    Object.assign(state.provider, p);
  } catch {}
}

function saveProviderState() {
  localStorage.setItem(PROV_STORAGE_KEY, JSON.stringify(state.provider));
}

function clearProviderState() {
  localStorage.removeItem(PROV_STORAGE_KEY);
  state.provider = { mode: "A", ttsProvider: "elevenlabs", ttsKey: "", ttsVoice: "", sttProvider: "deepgram", sttKey: "" };
}

// renderTtsProviderOptions / renderSttProviderOptions: SSOT인
// lib/providers/index.js 의 메타데이터로 select 옵션을 동적 생성.
// HTML에는 빈 <select>만 있고, mode 전환 시 TTS 옵션 목록이 바뀌어야
// 하므로(Mode B는 browser-direct adapter가 있는 provider만 노출) 매번
// 다시 그린다. 현재 선택값을 보존하되, 새 목록에 없으면 첫 항목으로
// fallback해서 state.provider.ttsProvider 와 동기화.
function renderTtsProviderOptions(mode) {
  const sel = $("prov-tts-provider");
  if (!sel) return;
  const providers = listTtsProviders(mode);
  const currentVal = state.provider.ttsProvider;
  sel.innerHTML = providers.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  if (providers.find((p) => p.id === currentVal)) {
    sel.value = currentVal;
  } else if (providers.length > 0) {
    sel.value = providers[0].id;
    state.provider.ttsProvider = providers[0].id;
    saveProviderState();
  }
}

function renderSttProviderOptions() {
  const sel = $("prov-stt-provider");
  if (!sel) return;
  const providers = listSttProviders();
  const currentVal = state.provider.sttProvider;
  sel.innerHTML = providers.map((p) => `<option value="${p.id}">${p.label}</option>`).join("");
  if (providers.find((p) => p.id === currentVal)) {
    sel.value = currentVal;
  } else if (providers.length > 0) {
    sel.value = providers[0].id;
    state.provider.sttProvider = providers[0].id;
    saveProviderState();
  }
}

function renderProviderUI() {
  const p = state.provider;
  document.querySelectorAll('input[name="provider-mode"]').forEach((r) => {
    r.checked = r.value === p.mode;
  });
  renderTtsProviderOptions(p.mode);
  renderSttProviderOptions();
  $("prov-tts-key").value = p.ttsKey;
  $("prov-stt-key").value = p.sttKey;
  updateTtsPlaceholders();
}

// updateTtsPlaceholders: voice 입력란이 1.4.6.14에서 제거됐으므로 API key
// placeholder만 갱신. ttsVoice는 항상 빈 문자열로 두고 adapter.defaults.voice가
// 자동 사용됨 (한국어 기본 음성 — ElevenLabs Rachel, Gemini Kore).
function updateTtsPlaceholders() {
  const adapter = getBrowserTtsAdapter(state.provider.ttsProvider);
  if (adapter) {
    $("prov-tts-key").placeholder = adapter.keyPlaceholder;
  }
}

// updateProviderKeyHint: show whether the CURRENTLY SELECTED TTS/STT provider
// already has a key saved on the gateway. Changing the provider dropdown clears
// the (write-only) key input, so without this the operator can't tell if the
// new provider is already configured — they'd re-enter a key they already have,
// or assume it's missing. Reads state.keyStatus.{tts,stt}ByProvider (gateway
// truth, refreshed on connect/save). Stays quiet before Connect (unknown).
function updateProviderKeyHint() {
  const paint = (statusElId, byProvider, providerName) => {
    const el = $(statusElId);
    if (!el) return;
    // Don't clobber a transient action message (저장 중…/✓ 저장됨/에러).
    if (el.dataset.transient === "1") return;
    if (!state.client || !byProvider || Object.keys(byProvider).length === 0) {
      el.textContent = ""; // 연결 전이거나 아직 조회 안 됨 — 표시 안 함
      return;
    }
    if (byProvider[providerName]) {
      el.textContent = `✓ 이 provider는 게이트웨이에 키가 저장돼 있어요 — 비워 두면 그대로 사용해요.`;
    } else {
      el.textContent = `⚠ 이 provider는 저장된 키가 없어요 — 키를 입력하고 "키 저장"을 눌러주세요.`;
    }
  };
  paint("prov-tts-status", state.keyStatus.ttsByProvider, state.provider.ttsProvider);
  paint("prov-stt-status", state.keyStatus.sttByProvider, state.provider.sttProvider);
}

function wireProviderUI() {
  loadProviderState();
  renderProviderUI();

  document.querySelectorAll('input[name="provider-mode"]').forEach((r) => {
    r.addEventListener("change", (e) => {
      state.provider.mode = e.target.value;
      saveProviderState();
      // Mode B는 browser-direct adapter가 있는 provider만 노출하므로
      // 옵션 목록을 다시 그린다. 현재 선택값이 Mode B에서 사라지면
      // renderTtsProviderOptions가 첫 항목으로 fallback + state 갱신.
      renderTtsProviderOptions(state.provider.mode);
      updateTtsPlaceholders();
      log("ok", "provider:mode", { mode: state.provider.mode });
    });
  });

  $("prov-tts-provider").addEventListener("change", (e) => {
    state.provider.ttsProvider = e.target.value;
    // 1.4.6.15: provider 바꾸면 이전 키는 새 provider에서 사용 불가 →
    // 입력/state/localStorage 모두 리셋. 사용자가 의도치 않게 잘못된
    // 키를 전송하지 않도록.
    state.provider.ttsKey = "";
    $("prov-tts-key").value = "";
    updateTtsPlaceholders();
    $("prov-tts-status").dataset.transient = ""; // 새 provider — 액션 메시지 해제
    updateProviderKeyHint(); // 새 provider 의 키 저장 여부 안내
    saveProviderState();
  });
  $("prov-tts-key").addEventListener("input", (e) => {
    state.provider.ttsKey = e.target.value;
    saveProviderState();
  });
  // Voice ID 입력란은 1.4.6.14에서 제거됐어요. state.provider.ttsVoice는
  // 항상 빈 문자열로 유지되며, adapter.defaults.voice (한국어 기본 음성)가
  // synthesizeToPcm 시점에 자동 채워집니다.
  $("prov-stt-provider").addEventListener("change", (e) => {
    state.provider.sttProvider = e.target.value;
    // 1.4.6.15: provider 바꾸면 이전 키는 새 provider에서 사용 불가 → 리셋.
    state.provider.sttKey = "";
    $("prov-stt-key").value = "";
    $("prov-stt-status").dataset.transient = ""; // 새 provider — 액션 메시지 해제
    updateProviderKeyHint(); // 새 provider 의 키 저장 여부 안내
    saveProviderState();
  });
  $("prov-stt-key").addEventListener("input", (e) => {
    state.provider.sttKey = e.target.value;
    saveProviderState();
  });

  $("btn-prov-tts-save").addEventListener("click", () => saveTtsKeyToGateway());
  $("btn-prov-tts-test").addEventListener("click", () => testTtsSynthesis());
  $("btn-prov-stt-save").addEventListener("click", () => saveSttKeyToGateway());
}

async function saveTtsKeyToGateway() {
  const statusEl = $("prov-tts-status");
  if (!state.client) { statusEl.textContent = "먼저 Connect 하세요."; return; }
  const p = state.provider;
  if (!p.ttsKey) { statusEl.textContent = "API 키를 입력하세요."; return; }
  statusEl.textContent = "게이트웨이에 저장 중…";
  try {
    await state.client.setApiKey({
      category: "tts",
      provider: p.ttsProvider,
      apiKey: p.ttsKey,
      voice: p.ttsVoice || undefined,
      role: "primary",
    });
    statusEl.textContent = `✓ ${p.ttsProvider} 키 저장됨 (게이트웨이의 /tts/synthesize 가 즉시 사용)`;
    statusEl.dataset.transient = "1"; // refreshKeyStatus 의 hint 가 덮어쓰지 않게
    log("ok", "provider:tts:saved", { provider: p.ttsProvider });
    refreshKeyStatus(); // 템플릿 카드 TTS 태그 + per-provider 상태 갱신
    setTimeout(() => { statusEl.dataset.transient = ""; }, 4000);
  } catch (err) {
    statusEl.textContent = `✗ 실패: ${err.message}`;
    log("err", "provider:tts:save:fail", { error: err.message });
  }
}

async function saveSttKeyToGateway() {
  const statusEl = $("prov-stt-status");
  if (!state.client) { statusEl.textContent = "먼저 Connect 하세요."; return; }
  const p = state.provider;
  if (!p.sttKey) { statusEl.textContent = "API 키를 입력하세요."; return; }
  statusEl.textContent = "게이트웨이에 저장 중…";
  try {
    await state.client.setApiKey({
      category: "stt",
      provider: p.sttProvider,
      apiKey: p.sttKey,
      role: "primary",
    });
    statusEl.textContent = `✓ ${p.sttProvider} 키 저장됨 (회의 STT 시작 시 이 provider 사용)`;
    statusEl.dataset.transient = "1"; // refreshKeyStatus 의 hint 가 덮어쓰지 않게
    log("ok", "provider:stt:saved", { provider: p.sttProvider });
    refreshKeyStatus(); // 템플릿 카드 STT 태그 + per-provider 상태 갱신
    setTimeout(() => { statusEl.dataset.transient = ""; }, 4000);
  } catch (err) {
    statusEl.textContent = `✗ 실패: ${err.message}`;
    log("err", "provider:stt:save:fail", { error: err.message });
  }
}

// Quick sanity check — synthesize "테스트입니다" using the current TTS
// mode/provider/key and report the resulting PCM byte count. Does not
// inject into any call.
async function testTtsSynthesis() {
  const statusEl = $("prov-tts-status");
  statusEl.dataset.transient = "1";
  statusEl.textContent = "합성 중…";
  try {
    const bytes = await synthesizePcm("테스트입니다");
    const ms = Math.round((bytes.length / 2) / 16);
    statusEl.textContent = `✓ ${state.provider.mode === "B" ? "브라우저 직접" : "게이트웨이"} 합성 OK — ${bytes.length} bytes (~${ms}ms)`;
    log("ok", "provider:tts:test:ok", { bytes: bytes.length, ms });
  } catch (err) {
    statusEl.textContent = `✗ 실패: ${err.message}`;
    log("err", "provider:tts:test:fail", { error: err.message });
  }
  setTimeout(() => { statusEl.dataset.transient = ""; }, 4000);
}

// Mode-aware text → slin16 PCM. In Mode A delegates to the gateway,
// in Mode B uses the browser-direct adapter for the selected provider.
async function synthesizePcm(text) {
  if (!text) throw new Error("text required");
  if (state.provider.mode === "B") {
    const adapter = getBrowserTtsAdapter(state.provider.ttsProvider);
    if (!adapter) throw new Error(`Mode B: provider ${state.provider.ttsProvider} 미지원 (현재 ElevenLabs/Gemini만)`);
    if (!state.provider.ttsKey) throw new Error("Mode B: TTS API 키가 비어 있습니다");
    return adapter.synthesizeToPcm(text, {
      apiKey: state.provider.ttsKey,
      voice: state.provider.ttsVoice || undefined,
    });
  }
  // Mode A — gateway side
  if (!state.client) throw new Error("Connect 먼저");
  return state.client.synthesizeText(text);
}

// Wrap injection calls so templates get: pre-check liveness, self-actor
// marking, and auto-removal of stale cards on 404 — all in one place.
async function safeInject(linkedId, doInject) {
  if (!state.client) throw new Error("먼저 Connect 하세요.");
  if (!linkedId) throw new Error("linkedId 없음");
  let alive;
  try {
    alive = await state.client.sessionExists(linkedId);
  } catch (err) {
    log("err", "session:probe:fail", { linkedId, error: String(err.message || err) });
    throw err;
  }
  if (!alive) {
    state.activeCalls.delete(linkedId);
    state.selfInjections.delete(linkedId);
    state.externalActors.delete(linkedId);
    renderCalls();
    renderExternalActorBanner();
    throw new Error(`해당 통화가 더 이상 활성이 아닙니다 (linkedId=${linkedId}). 카드를 정리했습니다.`);
  }
  state.selfInjections.add(linkedId);
  try {
    return await doInject();
  } catch (err) {
    // If it 404'd between our probe and the POST, self-heal.
    if (String(err.message || "").includes("(404)")) {
      state.activeCalls.delete(linkedId);
      state.selfInjections.delete(linkedId);
      state.externalActors.delete(linkedId);
      renderCalls();
      renderExternalActorBanner();
    }
    throw err;
  }
}

// ── outbound (click-to-call) panel ─────────────────────────────────
//
// State held in localStorage is intentionally limited to the
// user-editable fields (caller / callee / cidName / custom1-3). cidNumber
// and accountCode are NEVER cached locally — every Connect re-fetches
// them from the gateway via getOutboundDefaults(), so a tenant whose
// admin rotates the registered values sees the change immediately and
// cannot operate stale values from this browser.
// 단순화된 발신 패널은 수신 번호만 받습니다. caller(발신 내선)는
// outbound-defaults.cidNumber를 자동으로 사용하고, cidName / custom
// 값은 UI에서 노출하지 않습니다. UI에 입력이 거의 없으니 localStorage
// 캐시는 수신 번호만 보관합니다.
function loadOutboundForm() {
  try {
    const raw = localStorage.getItem(OUTBOUND_STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (p.callee) $("ob-callee").value = p.callee;
    if (p.caller) $("ob-caller").value = p.caller;
  } catch {}
}

function saveOutboundForm() {
  localStorage.setItem(OUTBOUND_STORAGE_KEY, JSON.stringify({
    callee: $("ob-callee").value.trim(),
    caller: $("ob-caller").value.trim(),
  }));
}

function setOutboundEnabled(enabled, reason) {
  $("ob-fieldset").disabled = !enabled;
  $("ob-conn-hint").textContent = reason || "";
}

// Fetch the per-tenant registered cidNumber / accountCode and paint the
// "fixed values" box. Called once after every successful Connect. A 404 ⇒
// the admin hasn't provisioned this tenant for outbound yet, so we
// disable the Originate button rather than allow a click that would 412.
// cidNumber 는 originate() 시 caller 로 자동 사용되므로 state.outboundDefaults
// 에 캐시합니다.
async function refreshOutboundDefaults() {
  const box = $("ob-fixed-box");
  const cidNumEl = $("ob-fixed-cidnumber");
  const acctEl = $("ob-fixed-accountcode");
  if (!state.client) return;
  try {
    const def = await state.client.getOutboundDefaults();
    if (!def) {
      cidNumEl.textContent = "(미등록)";
      acctEl.textContent = "(미등록)";
      box.classList.add("unset");
      state.outboundDefaults = null;
      setOutboundEnabled(true, "발신표시번호·과금번호가 미등록입니다. 관리자에게 등록을 요청하세요.");
      log("err", "outbound:defaults:missing", { tid: state.client.tokenTid });
      syncOriginateButton();
      return;
    }
    cidNumEl.textContent = def.cidNumber || "(미등록)";
    acctEl.textContent = def.accountCode || "—";
    box.classList.remove("unset");
    state.outboundDefaults = def;
    setOutboundEnabled(true, "");
    log("ok", "outbound:defaults:loaded", { cidNumber: def.cidNumber, updatedAt: def.updatedAt });
    syncOriginateButton();
  } catch (err) {
    cidNumEl.textContent = "(조회 실패)";
    acctEl.textContent = "(조회 실패)";
    box.classList.add("unset");
    state.outboundDefaults = null;
    setOutboundEnabled(true, `발신 고정값 조회 실패: ${err.message}`);
    log("err", "outbound:defaults:fail", { error: err.message });
    syncOriginateButton();
  }
}

async function originate() {
  const resultEl = $("ob-result");
  resultEl.classList.remove("hidden", "ok", "err");
  if (!state.client) {
    resultEl.classList.add("err");
    resultEl.textContent = "먼저 Connect 하세요.";
    return;
  }
  saveOutboundForm();
  const callee = $("ob-callee").value.trim();
  const caller = $("ob-caller").value.trim();
  if (!callee) {
    resultEl.classList.add("err");
    resultEl.textContent = "수신 번호를 입력해 주세요.";
    return;
  }
  // caller는 click-to-call 의 A-leg — 상대방이 받은 뒤 연결될 번호 (보통
  // 자동응답 ARS 진입 번호나 상담사 내선). 발신표시번호(cidNumber)와는
  // 다른 개념이라 별도 입력. 게이트웨이는 outbound-defaults 등록 여부와
  // 무관하게 caller가 비어 있으면 400을 돌려준다.
  if (!caller) {
    resultEl.classList.add("err");
    resultEl.textContent = "발신 통화 후 연결할 번호를 입력해 주세요.";
    return;
  }
  if (state.outboundDefaults === null) {
    resultEl.classList.add("err");
    resultEl.textContent = "발신표시번호가 등록되지 않았습니다. 관리자에게 등록을 요청하세요.";
    return;
  }
  resultEl.textContent = `Originate 요청 중 … ${caller} → ${callee}`;
  try {
    const res = await state.client.clickToCall({ caller, callee });
    pendingOutbound.set(callee, { ts: Date.now(), actionId: res?.actionId || "" });
    setTimeout(() => {
      const e = pendingOutbound.get(callee);
      if (e && Date.now() - e.ts > 60000) pendingOutbound.delete(callee);
    }, 65000);
    resultEl.classList.add("ok");
    resultEl.innerHTML = `✓ 발신 요청 성공.<br>
      <code>actionId: ${escapeHtml(res?.actionId || "(없음)")}</code><br>
      상대방이 받으면 좌측 "활성 통화" 카드가 강조되며,
      <code>channel:state(up)</code> 이벤트가 도착합니다.`;
    log("ok", "outbound:originate", { caller, callee, actionId: res?.actionId });
  } catch (err) {
    resultEl.classList.add("err");
    resultEl.textContent = `✗ Originate 실패: ${err.message}`;
    log("err", "outbound:originate:fail", { error: err.message });
  }
}

// syncOriginateButton: renderCalls() / refreshOutboundDefaults()가 각자의
// 사유로 #btn-originate를 disable할 수 있어 한 곳에서 합치는 헬퍼.
// 우선순위(높음 → 낮음):
//   1. outbound-defaults 미등록(state.outboundDefaults가 null) → disable
//   2. 활성 통화 ≥ 1건 → disable (중복 발신 방지)
//   3. 그 외 → enable
function syncOriginateButton() {
  const btn = document.getElementById("btn-originate");
  if (!btn) return;
  if (!state.client) {
    btn.disabled = true;
    return;
  }
  if (state.outboundDefaults === null) {
    btn.disabled = true;
    return;
  }
  if (state.activeCalls && state.activeCalls.size > 0) {
    btn.disabled = true;
    btn.title = "이미 활성 통화가 있어요. 현재 통화가 끝나면 다시 활성화돼요.";
    return;
  }
  btn.disabled = false;
  btn.title = "";
}

function highlightOutboundCard(linkedId) {
  const el = document.querySelector(`.call-card[data-linkedid="${linkedId}"]`);
  if (!el) return;
  el.classList.add("highlight");
  setTimeout(() => el.classList.remove("highlight"), 2400);
}

function wireOutboundPanel() {
  loadOutboundForm();
  setOutboundEnabled(false, "먼저 Connect 하세요. 연결 후 게이트웨이에 등록된 발신표시번호·과금번호를 자동으로 불러옵니다.");
  $("btn-originate").addEventListener("click", () => originate());
  $("btn-ob-clear").addEventListener("click", () => {
    ["ob-callee", "ob-caller"].forEach((id) => {
      const el = $(id);
      if (el) el.value = "";
    });
    saveOutboundForm();
    $("ob-result").classList.add("hidden");
  });
  // Persist as the user types so a reload doesn't lose the demo input.
  ["ob-callee", "ob-caller"].forEach((id) => {
    const el = $(id);
    if (el) el.addEventListener("change", saveOutboundForm);
  });
}

// ── event log ──────────────────────────────────────────────────────
function log(level, event, payload) {
  const time = new Date().toLocaleTimeString();
  let json = "";
  if (payload !== undefined) {
    try { json = JSON.stringify(payload); } catch { json = String(payload); }
  }
  const html = `<span class="time">${time}</span><span class="ev">${escapeHtml(event)}</span>${json ? ` ${escapeHtml(json)}` : ""}`;
  const klass = `entry ${level || ""}`;
  appendLogEntry($("event-log"), html, klass);
  appendLogEntry($("inline-log-feed"), html, klass, 200);
  state.logCount++;
  $("log-count").textContent = `${state.logCount} events`;
  const inlineCount = $("inline-log-count");
  if (inlineCount) inlineCount.textContent = `${state.logCount} events`;
}

function appendLogEntry(container, html, klass, capLines) {
  if (!container) return;
  const entry = document.createElement("div");
  entry.className = klass;
  entry.innerHTML = html;
  container.appendChild(entry);
  if (capLines && container.childElementCount > capLines) {
    const toRemove = container.childElementCount - capLines;
    for (let i = 0; i < toRemove; i++) container.firstChild?.remove();
  }
  container.scrollTop = container.scrollHeight;
}

function escapeHtml(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
}

// ── templates ──────────────────────────────────────────────────────

// reqTag: render a single TTS/STT requirement chip for a template card. The
// chip reflects whether the gateway has a usable key for that category:
//   ready  — 키 등록됨 (초록 ✓)
//   needed — 키 필요  (앰버 ⚠) → 「4. 프로바이더 API 키」에서 등록 안내
//   unknown — 아직 미확인 (연결 전, 회색)
function reqTag(kind) {
  const label = kind.toUpperCase();
  const has = state.keyStatus[kind]; // true / false / null
  let cls = "req-tag req-" + kind;
  let mark = "";
  let title = "";
  if (has === true) { cls += " ready"; mark = "✓"; title = `${label} 키 등록됨 — 바로 사용 가능`; }
  else if (has === false) { cls += " needed"; mark = "⚠"; title = `${label} 키 필요 — 「4. 프로바이더 API 키」에서 등록하세요`; }
  else { cls += " unknown"; title = `${label} 키 필요 — Connect 후 등록 여부가 표시돼요`; }
  return `<span class="${cls}" title="${escapeHtml(title)}">${mark ? mark + " " : ""}${label}</span>`;
}

let templateMenuWired = false;

function renderTemplateMenu() {
  const ul = $("template-menu");
  ul.innerHTML = templates.map((t) => {
    const reqs = (t.requires || []);
    const tags = reqs.length
      ? `<span class="req-tags">${reqs.map(reqTag).join("")}</span>`
      : `<span class="req-tags"><span class="req-tag none" title="API 키 없이도 동작해요">키 불필요</span></span>`;
    return `
    <li data-id="${t.id}" class="${state.currentTemplate && state.currentTemplate.id === t.id ? "active" : ""}">
      <span class="tpl-head">${escapeHtml(t.title)}${tags}</span>
      <span class="desc">${escapeHtml(t.desc)}</span>
    </li>
  `;
  }).join("");
  // delegated click — attach once so repeated re-renders don't stack listeners.
  if (!templateMenuWired) {
    ul.addEventListener("click", (e) => {
      const li = e.target.closest("li");
      if (!li) return;
      selectTemplate(li.dataset.id);
    });
    templateMenuWired = true;
  }
}

// refreshKeyStatus: query the gateway for registered provider keys and update
// the per-template tags. A category counts as "ready" if any provider in that
// bucket is enabled (or carries a non-empty masked key). Best-effort — on
// error we leave the prior state untouched.
async function refreshKeyStatus() {
  if (!state.client) return;
  try {
    const cfg = await state.client.getApiKeys();
    // A category is "ready" only when some provider is BOTH enabled AND carries
    // a non-empty key. `enabled` alone is not enough — a provider can be left
    // enabled with an empty/cleared key (the gateway masks an empty key to ""),
    // which would otherwise show a false "✓ 등록됨" while synthesis still fails.
    // The gateway returns masked keys (e.g. "••••AIza"); only "" means no key.
    const providerHasKey = (p) => !!(p && p.enabled && p.apiKey && String(p.apiKey).length > 0);
    const hasKey = (bucket) => !!bucket && Object.values(bucket).some(providerHasKey);
    state.keyStatus.tts = hasKey(cfg.tts);
    state.keyStatus.stt = hasKey(cfg.stt);
    // Per-provider presence — so the panel can tell the user whether the
    // CURRENTLY SELECTED provider already has a saved key (changing the
    // dropdown clears the input, which previously hid this fact).
    state.keyStatus.ttsByProvider = {};
    state.keyStatus.sttByProvider = {};
    for (const [name, p] of Object.entries(cfg.tts || {})) state.keyStatus.ttsByProvider[name] = providerHasKey(p);
    for (const [name, p] of Object.entries(cfg.stt || {})) state.keyStatus.sttByProvider[name] = providerHasKey(p);
    updateProviderKeyHint();
  } catch (err) {
    // leave keyStatus as-is; tags stay in their last known state
    console.warn("refreshKeyStatus failed:", err);
  }
  renderTemplateMenu();
}

// remountCurrentTemplate: connect 직후 호출. 템플릿이 mount() 안에서
// `if (ctx.client) ctx.client.addEventListener(...)` 패턴으로 listener를
// 등록하기 때문에, init() 시점에 state.client=null로 mount된 템플릿은
// listener를 못 달고 영구히 callinfo 이벤트를 못 받는다. 같은 템플릿을
// 다시 mount해서 살아있는 client로 listener를 등록한다. 1.4.5.10(#600)
// 에서 도입된 패턴.
function remountCurrentTemplate() {
  if (state.currentTemplate) selectTemplate(state.currentTemplate.id);
}

function selectTemplate(id) {
  const tpl = getTemplate(id);
  if (!tpl) return;

  if (state.templateDispose) {
    try { state.templateDispose(); } catch (err) { console.warn(err); }
    state.templateDispose = null;
  }

  document.querySelectorAll("#template-menu li").forEach((li) => {
    li.classList.toggle("active", li.dataset.id === id);
  });

  state.currentTemplate = tpl;
  $("demo-title").textContent = tpl.title;
  $("demo-desc").textContent = tpl.desc;
  const body = $("demo-body");
  body.innerHTML = "";

  // "통화 시작 방법" chip — surfaces the recommended way to create a call
  // for this template so newcomers don't sit on the page wondering what to
  // do. Persistently dismissable per browser.
  renderTriggerHint(body, tpl);

  // ctx.client을 단순 값으로 캡쳐하면 mount 시점의 state.client(null)을
  // 그대로 들고 있어 connect 이후에도 템플릿이 "먼저 Connect 하세요"라고
  // 안내합니다. init()이 connect 완료 전에 selectTemplate("lite-ivr")을
  // 부르기 때문. getter property로 항상 최신 state.client를 반환하도록
  // 합니다 — 1.4.5.10(#600)에서 한 번 고쳤던 패턴.
  const ctx = {
    body,
    log,
    activeCalls: state.activeCalls,
    getActiveCalls: () => state.activeCalls,
    safeInject,
    markSelfInjection: (lid) => state.selfInjections.add(lid),
    // Mode-aware text→inject with automatic delivery fallback.
    //
    // Two TTS delivery paths exist on the gateway:
    //   1. PCM 주입 (POST /api/v1/tts/{id}) — fade-in/out, but needs an active
    //      TTS player (= ExternalMedia attached). flow/lite 통화는 attach 전
    //      이라 player 가 없어 404 "no active player" 로 거절됨.
    //   2. ARI Playback TTS (POST /api/v1/playback/{id}/tts) — .sln16 파일을
    //      ARI 로 채널에 직접 재생. player/ExternalMedia 불필요 → flow/lite
    //      통화에서도 동작.
    // 먼저 PCM 주입을 시도하고(일반 mode=both 의 부드러운 fade 유지), player
    // 부재(404)면 ARI Playback 으로 폴백해 flow/lite 통화에서도 들리게 한다.
    safeInjectText: (lid, text) =>
      safeInject(lid, async () => {
        try {
          const pcm = await synthesizePcm(text);
          const injectId = await state.client.injectAudio(lid, pcm, "application/octet-stream");
          // remember our own injectId so a later self-preempt (we inject again
          // on the same call) is not mistaken for another subscriber.
          if (injectId) state.myInjectIds.add(injectId);
          return injectId;
        } catch (err) {
          // no active player (flow/lite, attach 전) → ARI Playback 폴백
          if (String(err && err.message || "").includes("(404)")) {
            log("info", "tts:fallback:playback", { linkedId: lid });
            const provider = (state.provider && state.provider.ttsProvider) || "";
            const res = await state.client.liteTtsPlayback(lid, text, provider);
            // ARI Playback surfaces a playbackId on audio:playback events — track
            // it the same way so self-preempts on the fallback path stay quiet too.
            if (res && res.playbackId) state.myInjectIds.add(res.playbackId);
            return res && res.playbackId ? res.playbackId : null;
          }
          throw err;
        }
      }),
    providerMode: () => state.provider.mode,
    // 1.4.6.15: 데모 템플릿(lite-ivr 등)이 사이드바 선택을 SSOT로 사용할 수
    // 있게 getter로 노출. 빈 문자열을 보내면 게이트웨이가 자기 기본 provider를
    // 쓰므로, 사용자가 선택한 provider를 명확히 전달.
    ttsProvider: () => state.provider.ttsProvider,
    sttProvider: () => state.provider.sttProvider,
  };
  Object.defineProperty(ctx, "client", {
    get() { return state.client; },
    enumerable: true,
  });
  try {
    state.templateDispose = tpl.module.mount(ctx) || null;
  } catch (err) {
    body.innerHTML = `<p style="color:var(--err)">template error: ${escapeHtml(String(err))}</p>`;
    console.error(err);
  }

  $("code-view").textContent = tpl.module.code || "// no code sample for this template";
}

// ── per-template "how to start a call" hint ────────────────────────
const TRIGGER_HINT_DISMISS_KEY = "dvgw-playground-trigger-hint-dismissed-v1";

function isTriggerHintDismissed() {
  return localStorage.getItem(TRIGGER_HINT_DISMISS_KEY) === "1";
}

function dismissTriggerHint() {
  localStorage.setItem(TRIGGER_HINT_DISMISS_KEY, "1");
  document.querySelectorAll(".trigger-hint").forEach((el) => el.remove());
}

// Render the call-start hint at the top of demo-body. recommendedTrigger
// drives which option is preselected and which copy is emphasized; the
// other option is always available for the user to flip to.
function renderTriggerHint(container, tpl) {
  if (isTriggerHintDismissed()) return;
  const rec = tpl.recommendedTrigger || "either";
  const outboundActive = rec === "outbound";
  const inboundActive = rec === "inbound";
  const wrapper = document.createElement("section");
  wrapper.className = "trigger-hint";
  wrapper.innerHTML = `
    <div class="trigger-hint-head">
      <span class="trigger-hint-title">이 데모를 시작하려면</span>
      <button class="ghost small" id="btn-trigger-hint-dismiss" title="이 안내를 다시 보지 않기">다음부터 숨기기</button>
    </div>
    <div class="trigger-hint-options">
      <button class="trigger-hint-card${outboundActive ? " active" : ""}" data-trigger="outbound">
        <div class="trigger-hint-emoji">📞</div>
        <div>
          <div class="trigger-hint-card-title">발신 하기 (Originate)</div>
          <div class="trigger-hint-card-desc">좌측 "발신(클릭투콜)" 패널에서 수신 번호를 입력하고 전화 걸기를 누릅니다.</div>
        </div>
      </button>
      <button class="trigger-hint-card${inboundActive ? " active" : ""}" data-trigger="inbound">
        <div class="trigger-hint-emoji">📲</div>
        <div>
          <div class="trigger-hint-card-title">수신 대기 (Inbound)</div>
          <div class="trigger-hint-card-desc">본인 휴대폰에서 게이트웨이 DID로 전화를 걸면 활성 통화 카드가 자동 생성됩니다.</div>
        </div>
      </button>
    </div>
  `;
  container.appendChild(wrapper);

  wrapper.querySelector("#btn-trigger-hint-dismiss").addEventListener("click", () => {
    dismissTriggerHint();
  });
  wrapper.querySelectorAll(".trigger-hint-card").forEach((card) => {
    card.addEventListener("click", () => {
      wrapper.querySelectorAll(".trigger-hint-card").forEach((c) => c.classList.remove("active"));
      card.classList.add("active");
      if (card.dataset.trigger === "outbound") spotlightOutboundPanel();
      else spotlightCallList();
    });
  });
}

function spotlightOutboundPanel() {
  const panel = $("outbound-panel");
  if (!panel) return;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  panel.classList.add("spotlight");
  setTimeout(() => panel.classList.remove("spotlight"), 1800);
  const callee = $("ob-callee");
  if (callee && !$("ob-fieldset").disabled) callee.focus();
}

function spotlightCallList() {
  const list = $("call-list");
  if (!list) return;
  list.scrollIntoView({ behavior: "smooth", block: "start" });
  list.classList.add("spotlight");
  setTimeout(() => list.classList.remove("spotlight"), 1800);
}

// ── tabs ───────────────────────────────────────────────────────────
function wireTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".tab-panel").forEach((p) => {
        p.classList.toggle("hidden", p.dataset.panel !== target);
      });
    });
  });
}

// ── 환영 모달 (처음 사용 가이드) ───────────────────────────────────
// 첫 방문 시 자동 노출, "다음부터 자동으로 열지 않기" 체크 시 localStorage에
// dvgw-playground-welcome-dismissed-v1 = "1" 저장. 헤더 우측 👋 처음 가이드
// 버튼은 dismiss 상태와 무관하게 항상 열림 → 사용자가 언제든 다시 볼 수 있음.
// "저장 정보 지우기" 버튼은 이 키도 함께 제거하므로 공용 PC에서 안전.
function openModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.remove("hidden");
}
function closeModal(id) {
  const m = document.getElementById(id);
  if (!m) return;
  m.classList.add("hidden");
}
function wireModal(id, onClose) {
  const m = document.getElementById(id);
  if (!m) return;
  m.addEventListener("click", (e) => {
    const t = e.target;
    if (t && t.dataset && t.dataset.action === "close") {
      if (onClose) onClose();
      closeModal(id);
    }
  });
}

// 공용 확인 모달 — window.confirm() 대체. destructive 액션이나 사용자
// 명시 동의가 필요한 흐름에서 환영 모달과 같은 스타일로 표시. 마크업은
// index.html의 #confirm-modal. data-action="confirm-ok"가 onOk를,
// "confirm-cancel"이 onCancel을 호출하고 모달 닫음. Promise 형태로도
// 쓸 수 있게 호출자에게 Promise<boolean> 반환.
let _confirmHandlers = null;
function openConfirm(message, opts) {
  const o = opts || {};
  const titleEl = document.getElementById("confirm-title");
  const msgEl = document.getElementById("confirm-message");
  const okBtn = document.getElementById("confirm-ok-btn");
  if (titleEl) titleEl.textContent = o.title || "확인";
  if (msgEl) msgEl.textContent = message;
  if (okBtn) okBtn.textContent = o.okLabel || "확인";
  return new Promise((resolve) => {
    _confirmHandlers = {
      ok: () => { resolve(true); _confirmHandlers = null; },
      cancel: () => { resolve(false); _confirmHandlers = null; },
    };
    openModal("confirm-modal");
  });
}
function wireConfirmModal() {
  const m = document.getElementById("confirm-modal");
  if (!m) return;
  m.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.dataset) return;
    if (t.dataset.action === "confirm-ok") {
      if (_confirmHandlers) _confirmHandlers.ok();
      closeModal("confirm-modal");
    } else if (t.dataset.action === "confirm-cancel") {
      if (_confirmHandlers) _confirmHandlers.cancel();
      closeModal("confirm-modal");
    }
  });
}
// templates 모듈에서도 호출할 수 있도록 window에 노출. ctx에 추가하는
// 게 더 깔끔하지만 confirm 같은 utility는 전역이 자연스럽다.
if (typeof window !== "undefined") {
  window.dvgwConfirm = openConfirm;
}
function wireWelcomeModal() {
  wireModal("welcome-modal", () => {
    const dont = $("welcome-dontshow");
    if (dont && dont.checked) {
      localStorage.setItem(WELCOME_DISMISS_KEY, "1");
      log("ok", "welcome:dismissed-permanent");
    }
  });
  // 헤더 "처음 가이드" 버튼은 dismiss 상태 무시하고 항상 열기 (사용자가
  // 일부러 다시 보겠다고 누른 거니까 체크박스도 초기화해서 두 번 끄지
  // 않도록 함).
  const open = $("btn-welcome");
  if (open) open.addEventListener("click", () => {
    const dont = $("welcome-dontshow");
    if (dont) dont.checked = false;
    openModal("welcome-modal");
  });
  // 첫 방문 자동 노출
  if (localStorage.getItem(WELCOME_DISMISS_KEY) !== "1") {
    openModal("welcome-modal");
  }
}

// ── bootstrap ──────────────────────────────────────────────────────
function init() {
  loadCreds();
  wireProviderUI();
  wireOutboundPanel();
  wireWelcomeModal();
  wireConfirmModal();
  renderTemplateMenu();
  wireTabs();
  $("btn-connect").addEventListener("click", connect);
  $("btn-disconnect").addEventListener("click", disconnect);
  $("btn-clear").addEventListener("click", clearCreds);
  $("btn-log-clear").addEventListener("click", () => {
    $("event-log").innerHTML = "";
    state.logCount = 0;
    $("log-count").textContent = "0 events";
    const ic = $("inline-log-count");
    if (ic) ic.textContent = "0 events";
    const il = $("inline-log-feed");
    if (il) il.innerHTML = "";
  });
  $("btn-inline-log-clear")?.addEventListener("click", () => {
    const il = $("inline-log-feed");
    if (il) il.innerHTML = "";
  });
  $("btn-inline-log-toggle")?.addEventListener("click", () => {
    $("inline-log")?.classList.toggle("collapsed");
  });
  selectTemplate("lite-ivr");

  // URL 파라미터로 대시보드에서 넘어온 경우 자동 연결
  // ?host=<hostname>&token=<jwt>[&tid=<tenantId>]
  const urlParams = new URLSearchParams(location.search);
  const paramHost = urlParams.get("host");
  const paramToken = urlParams.get("token");
  const paramTid = urlParams.get("tid");
  if (paramHost && paramToken) {
    // 폼에 호스트 채우기 (비밀번호 불필요 — 토큰 직접 사용)
    $("cred-host").value = paramHost;
    if (paramTid) $("cred-tid").value = paramTid;
    // URL 파라미터 제거 (보안: 토큰이 히스토리에 남지 않게)
    history.replaceState(null, "", location.pathname);
    // 토큰을 직접 주입하여 login() 없이 연결.
    // 폼 채우기와 자동 연결이 별개의 실패 모드를 가지므로 try/catch로 분리하지 않고
    // connectWithToken 내부에서 단일 실패 경로(setStatus + log)로 수렴시킨다.
    log("info", "auto-login:start", { host: paramHost, tid: paramTid || "" });
    connectWithToken({ host: paramHost, token: paramToken, tid: paramTid });
  } else if (paramHost || paramToken) {
    // 한쪽만 있으면 사용자가 직접 만든 URL일 가능성이 큼 — 무시하지 않고 알려준다.
    log("warn", "auto-login:skipped", {
      reason: "host/token must be provided together",
      hasHost: !!paramHost,
      hasToken: !!paramToken,
    });
    setStatus("off", "URL 파라미터 부족 — 직접 로그인");
  }
}

async function connectWithToken({ host, token, tid }) {
  setStatus("connecting", "대시보드 토큰으로 자동 로그인 중…");
  try {
    if (state.client) state.client.disconnect();

    const claims = parseJwt(token);
    if (!claims) {
      throw new Error("토큰 형식이 잘못되었습니다 (JWT 디코딩 실패)");
    }
    // exp는 unix epoch seconds. 클라이언트/서버 시계 차이 5초 허용.
    if (claims.exp && claims.exp * 1000 + 5000 < Date.now()) {
      throw new Error("토큰이 만료되었습니다 — 대시보드에서 다시 로그인하세요");
    }

    const client = new GatewayClient({ host, tenantId: tid || "", password: "" });
    client.token = token;
    client.onQuota = flashQuotaNotice; // provider 429 → 친절 안내(장애 아님)
    state.client = client;

    client.addEventListener("status", (e) => {
      const s = e.detail.state;
      if (s === "open") setStatus("on", `연결됨 · ${host}`);
      else if (s === "connecting") setStatus("connecting", "연결 중…");
      else if (s === "closed") setStatus("off", "연결 안 됨");
      else if (s === "error") setStatus("off", "오류 — 직접 연결 시도 필요");
    });
    client.addEventListener("event", (e) => onCallinfoEvent(e.detail));

    stopPolling();
    state.pollTimer = setInterval(reconcileSessions, POLL_INTERVAL_MS);

    const tenantId = tid || claims.tid || "";
    setTenantPill(tenantId);
    log("ok", "login:ok", { tid: tenantId, via: "dashboard" });
    client.connectCallinfo();
    // 현재 활성 세션 즉시 동기화
    reconcileSessions();
    refreshOutboundDefaults();
    // 살아있는 client로 템플릿 listener 재등록 — connect() 와 동일.
    remountCurrentTemplate();
    // 헤더 좌측에 게이트웨이 버전 표시.
    fetchGatewayVersion();
  } catch (err) {
    // 자동 로그인 실패: silent 금지. 사용자가 좌측 폼으로 수동 로그인 가능하도록 안내.
    const msg = err && err.message ? err.message : String(err);
    setStatus("off", `자동 로그인 실패: ${msg}`);
    log("err", "auto-login:fail", { error: msg, host, tid: tid || "" });
  }
}

function parseJwt(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64 + "=".repeat((4 - b64.length % 4) % 4)));
  } catch { return null; }
}

init();
