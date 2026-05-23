import { GatewayClient } from "./lib/gateway-client.js";
import { templates, getTemplate } from "./templates/index.js";
import { getBrowserTtsAdapter, listBrowserTtsProviders } from "./lib/providers/index.js";

const STORAGE_KEY = "dvgw-playground-creds-v2";
const PROV_STORAGE_KEY = "dvgw-playground-provider-v1";
const BANNER_DISMISS_KEY = "dvgw-playground-banner-dismissed-v1";
const WELCOME_DISMISS_KEY = "dvgw-playground-welcome-dismissed-v1";
const TERMINAL_CHANNEL_STATES = new Set(["down", "busy", "no_answer", "rejected"]);
const POLL_INTERVAL_MS = 30000; // sessions reconciliation tick
const state = {
  client: null,
  activeCalls: new Map(),
  // linkedIds that we (this browser) initiated TTS/audio for. When a
  // tts:playback or audio:playback start fires for an id NOT in this set,
  // it means another callinfo subscriber (a bot, another tab) is acting on
  // the same call — surface that as a banner so the user understands why
  // their actions race or 404.
  selfInjections: new Set(),
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
  // Clear credentials 는 공용 PC 시나리오 — 안내 배너도 다음 사용자를 위해
  // 다시 노출 (다시 보지 않기 dismiss 플래그도 함께 제거).
  localStorage.removeItem(BANNER_DISMISS_KEY);
  applyBannerDismissState();
  log("ok", "creds:cleared");
}

// 안내 배너 dismiss 상태를 localStorage에서 읽어 DOM에 반영.
// 페이지 로드 시 + Clear credentials 직후에 호출.
function applyBannerDismissState() {
  const banner = $("key-warning");
  if (!banner) return;
  const dismissed = localStorage.getItem(BANNER_DISMISS_KEY) === "1";
  banner.classList.toggle("hidden", dismissed);
}

function wireBannerDismiss() {
  const btn = $("key-warning-dismiss");
  if (!btn) return;
  btn.addEventListener("click", () => {
    localStorage.setItem(BANNER_DISMISS_KEY, "1");
    applyBannerDismissState();
    log("ok", "banner:dismissed");
  });
}

// ── 환영 모달 · 용어 사전 모달 ────────────────────────────────────
// 두 모달 모두 backdrop / ✕ / "시작하기" 클릭으로 닫힘. 환영 모달은
// "다음부터 자동으로 열지 않기" 체크박스 상태를 localStorage 에 기록.
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
function wireWelcomeModal() {
  wireModal("welcome-modal", () => {
    const dont = $("welcome-dontshow");
    if (dont && dont.checked) {
      localStorage.setItem(WELCOME_DISMISS_KEY, "1");
      log("ok", "welcome:dismissed-permanent");
    }
  });
  // 헤더 "처음 가이드" 버튼은 dismiss 상태 무시하고 항상 열기
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
function wireGlossaryModal() {
  wireModal("glossary-modal");
  const open = $("btn-glossary");
  if (open) open.addEventListener("click", () => openModal("glossary-modal"));
}

// ── 단계 가이드 진행상태 ──────────────────────────────────────────
// 1) 서버 연결 → 2) 통화 발신 → 3) 데모 선택 → 4) 결과 확인
//   step-done: 완료된 단계 (회색 + ✓)
//   step-active: 현재 다음에 해야 할 단계 (강조)
function updateGuideSteps() {
  const ul = $("guide-steps");
  if (!ul) return;
  const connected = !!state.client;
  const hasCall = state.activeCalls.size > 0;
  const demoSelected = !!state.currentTemplate;
  // "결과 확인" 은 callinfo 이벤트 1회 이상 수신을 기준으로 함
  const sawEvents = state.logCount > 2;  // login:ok + snapshot 정도는 항상 옴 — 그 이상이면 데모 결과 보고 있을 가능성

  const stateBy = {
    connect: connected ? "done" : "active",
    call: !connected ? "pending" : (hasCall ? "done" : "active"),
    demo: (!connected || !hasCall) ? "pending" : (demoSelected ? "done" : "active"),
    result: (!connected || !hasCall || !demoSelected) ? "pending" : (sawEvents ? "done" : "active"),
  };
  ul.querySelectorAll("li[data-step]").forEach((li) => {
    const k = li.dataset.step;
    li.classList.remove("step-done", "step-active");
    if (stateBy[k] === "done") li.classList.add("step-done");
    else if (stateBy[k] === "active") li.classList.add("step-active");
  });
}

// ── connection ─────────────────────────────────────────────────────
function setStatus(state, text) {
  const dot = $("conn-dot");
  dot.className = `dot ${state}`;
  $("conn-text").textContent = text;
  // 상태가 바뀔 때마다 단계 가이드도 갱신 (가벼운 작업이라 매번 OK)
  if (typeof updateGuideSteps === "function") updateGuideSteps();
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

// Show 'gw vX.Y.Z' next to the brand title. Fetched after connect()
// /connectWithToken() succeeds. Hidden again on disconnect so the pill
// never lies about which gateway it was talking to.
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
    // GatewayClient doesn't have a getVersion() helper yet; hit the
    // public version endpoint directly through the same apiBase.
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
    // 버전 표시는 nice-to-have — 실패는 조용히 무시하고 콘솔에만 남김.
    log("err", "gw:version:fail", { error: String(err.message || err) });
  }
}

async function connect() {
  const creds = readCreds();
  if (!creds.host || !creds.tenantId || !creds.password) {
    alert("서버 주소, 테넌트 ID, 비밀번호를 모두 입력해 주세요.");
    return;
  }
  saveCreds();

  if (state.client) state.client.disconnect();

  const client = new GatewayClient(creds);
  state.client = client;

  client.addEventListener("status", (e) => {
    const s = e.detail.state;
    if (s === "open") setStatus("on", `연결됨 · ${creds.host}:${creds.apiPort}`);
    else if (s === "connecting") setStatus("connecting", "연결하는 중…");
    else if (s === "closed") setStatus("off", "연결이 끊겼어요");
    else if (s === "error") setStatus("off", "오류가 났어요");
  });

  client.addEventListener("event", (e) => onCallinfoEvent(e.detail));

  // Reconciliation tick: ask the gateway for the authoritative session
  // list every POLL_INTERVAL_MS and drop any local card the gateway no
  // longer knows about. Belt to the WS suspenders — if call:ended is
  // missed or routed elsewhere, the next poll cleans up.
  stopPolling();
  state.pollTimer = setInterval(reconcileSessions, POLL_INTERVAL_MS);

  setStatus("connecting", "로그인하는 중…");
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
    setStatus("off", "로그인 실패");
    setTenantPill(null);
    return;
  }
  client.connectCallinfo();
  // Re-mount the current template now that state.client is real.
  // Templates register their callinfo listeners inside mount(); if they
  // mounted earlier with a null client, those listeners were skipped.
  remountCurrentTemplate();
  // Gateway version next to the brand title.
  fetchGatewayVersion();
}

function disconnect() {
  if (state.client) {
    state.client.disconnect();
    state.client = null;
  }
  state.activeCalls.clear();
  renderCalls();
  setStatus("off", "연결이 끊겼어요");
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
      if (evt.phase === "start") {
        if (state.selfInjections.has(evt.linkedId)) break;
        state.externalActors.add(evt.linkedId);
        renderExternalActorBanner();
        break;
      }

      // Preempt detection — gateway publishes phase=canceled with
      // errorReason=preempted when a newer inject_tts for the same
      // linkedId arrives. If WE were the one playing, that means
      // another callinfo subscriber overrode our audio.
      if (evt.phase === "canceled" && evt.errorReason === "preempted") {
        if (state.selfInjections.has(evt.linkedId)) {
          state.externalActors.add(evt.linkedId);
          flashPreemptToast(evt.linkedId);
          renderExternalActorBanner();
          log("err", "preempted-by-other", {
            linkedId: evt.linkedId,
            injectId: evt.injectId || evt.playbackId,
            durationMs: evt.durationMs,
          });
        }
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

function eventLevel(name) {
  if (!name) return "";
  if (name === "call:ended" || name === "snapshot") return "ok";
  if (name.includes("error") || name.endsWith(":failed")) return "err";
  return "";
}

// ── active call cards ──────────────────────────────────────────────
function renderCalls() {
  // 통화 목록이 바뀌면 메뉴 호환성 배지도 갱신 (active 항목은 renderTemplateMenu 내부에서 반영)
  renderTemplateMenu();
  updateGuideSteps();

  const list = $("call-list");
  if (state.activeCalls.size === 0) {
    list.innerHTML = '<p class="muted small">아직 활성 통화가 없습니다.</p>';
    return;
  }
  const cards = [];
  for (const call of state.activeCalls.values()) {
    const extActor = state.externalActors.has(call.linkedId);
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

function renderProviderUI() {
  const p = state.provider;
  document.querySelectorAll('input[name="provider-mode"]').forEach((r) => {
    r.checked = r.value === p.mode;
  });
  $("prov-tts-provider").value = p.ttsProvider;
  $("prov-tts-key").value = p.ttsKey;
  $("prov-tts-voice").value = p.ttsVoice;
  $("prov-stt-provider").value = p.sttProvider;
  $("prov-stt-key").value = p.sttKey;
  updateTtsPlaceholders();
}

function updateTtsPlaceholders() {
  const adapter = getBrowserTtsAdapter(state.provider.ttsProvider);
  if (adapter) {
    $("prov-tts-key").placeholder = adapter.keyPlaceholder;
    $("prov-tts-voice").placeholder = `${adapter.voiceLabel} (기본: ${adapter.defaults.voice})`;
  }
}

function wireProviderUI() {
  loadProviderState();
  renderProviderUI();

  document.querySelectorAll('input[name="provider-mode"]').forEach((r) => {
    r.addEventListener("change", (e) => {
      state.provider.mode = e.target.value;
      saveProviderState();
      log("ok", "provider:mode", { mode: state.provider.mode });
    });
  });

  $("prov-tts-provider").addEventListener("change", (e) => {
    state.provider.ttsProvider = e.target.value;
    updateTtsPlaceholders();
    saveProviderState();
  });
  $("prov-tts-key").addEventListener("input", (e) => {
    state.provider.ttsKey = e.target.value;
    saveProviderState();
  });
  $("prov-tts-voice").addEventListener("input", (e) => {
    state.provider.ttsVoice = e.target.value;
    saveProviderState();
  });
  $("prov-stt-provider").addEventListener("change", (e) => {
    state.provider.sttProvider = e.target.value;
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
    log("ok", "provider:tts:saved", { provider: p.ttsProvider });
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
    log("ok", "provider:stt:saved", { provider: p.sttProvider });
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

// ── active call mode helpers ────────────────────────────────────────
// 현재 활성 통화 중 lite / 풀스트림 존재 여부를 반환.
// mode 필드가 없는 구버전 GW 응답은 풀스트림으로 간주.
function activeCallModes() {
  let hasLite = false;
  let hasFull = false;
  for (const c of state.activeCalls.values()) {
    if (c.mode === "lite") hasLite = true;
    else hasFull = true;
  }
  return { hasLite, hasFull };
}

// 템플릿이 현재 활성 통화에서 동작하는지 여부.
//   modes="any"  → 항상 OK
//   modes="lite" → lite 통화가 한 건이라도 있어야 OK (풀스트림만 있으면 경고)
//   modes="full" → 풀스트림 통화가 있어야 OK (lite만 있으면 경고)
//   activeCalls 가 0이면 경고 없음 (통화 없을 때는 모든 메뉴 정상 표시)
function templateCompatibility(tpl) {
  const { hasLite, hasFull } = activeCallModes();
  if (state.activeCalls.size === 0) return "ok";
  if (tpl.modes === "any") return "ok";
  if (tpl.modes === "lite") return hasLite ? "ok" : "full-only";
  if (tpl.modes === "full") return hasFull ? "ok" : "lite-only";
  return "ok";
}

// ── templates ──────────────────────────────────────────────────────
// 메뉴 클릭 이벤트는 init()에서 한 번만 등록 (renderTemplateMenu는 DOM만 갱신)
function wireTemplateMenu() {
  const ul = $("template-menu");
  ul.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    selectTemplate(li.dataset.id);
  });
}

// 활성 통화 모드에 따라 호환성 배지·회색 처리를 포함해 메뉴를 다시 그린다.
// 이벤트 리스너는 wireTemplateMenu()에서 상위 ul에 위임(event delegation)으로
// 이미 달려있으므로 여기서는 innerHTML 교체만 수행한다.
function renderTemplateMenu() {
  const ul = $("template-menu");
  const activeId = state.currentTemplate ? state.currentTemplate.id : null;
  ul.innerHTML = templates.map((t) => {
    const compat = templateCompatibility(t);
    const dimmed = compat !== "ok" ? " dimmed" : "";
    let badge = "";
    if (compat === "lite-only") {
      badge = `<span class="mode-badge mode-badge-warn" title="현재 활성 통화가 mode=lite 입니다. 이 데모는 ExternalMedia(풀스트림) 통화에서만 동작합니다.">⚠ lite 통화 전용 아님</span>`;
    } else if (compat === "full-only") {
      badge = `<span class="mode-badge mode-badge-info" title="이 데모는 mode=lite 통화 전용입니다. 현재 활성 통화가 풀스트림입니다.">⚡ lite 전용</span>`;
    }
    return `
    <li data-id="${t.id}"${activeId === t.id ? ' class="active"' : ""}>
      <span class="tpl-title${dimmed}">${escapeHtml(t.title)}</span>
      ${badge}
      <span class="desc${dimmed}">${escapeHtml(t.desc)}</span>
    </li>`;
  }).join("");
}

// 각 데모 상단의 인트로 박스 — '이 데모로 할 수 있는 것' + '미리 준비할 것'
// intro 객체 형태: { can: ["…", "…"], prep: ["…", "…"] }
// templates/index.js 에서 템플릿마다 정의. demo-body 최상단에 prepend.
function renderDemoIntro(bodyEl, intro) {
  if (!intro || (!intro.can && !intro.prep)) return;
  const div = document.createElement("div");
  div.className = "demo-intro";
  const esc = (s) => String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
  const canHtml = (intro.can || []).map((s) => `<li>${esc(s)}</li>`).join("");
  const prepHtml = (intro.prep || []).map((s) => `<li>${esc(s)}</li>`).join("");
  div.innerHTML = `
    <div class="demo-intro-box can">
      <h4>✨ 이 데모로 할 수 있는 것</h4>
      <ul>${canHtml || "<li>실시간 통화 이벤트를 보여드려요</li>"}</ul>
    </div>
    <div class="demo-intro-box prep">
      <h4>📋 미리 준비할 것</h4>
      <ul>${prepHtml || "<li>왼쪽에서 서버 연결을 먼저 해주세요</li>"}</ul>
    </div>
  `;
  // mount() 가 innerHTML 을 통째로 다시 쓴 직후 호출되므로 firstChild 앞에 삽입.
  bodyEl.insertBefore(div, bodyEl.firstChild);
}

// Re-mount the currently active template (or no-op if none). Called after
// connect/connectWithToken so templates that mounted with a null
// ctx.client get a chance to re-register their callinfo listeners
// against the now-live client. Safe to call on an unconnected page —
// state.currentTemplate is set by the init-time selectTemplate("lite-ivr").
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
  updateGuideSteps();
  $("demo-title").textContent = tpl.title;
  $("demo-desc").textContent = tpl.desc;
  const body = $("demo-body");
  body.innerHTML = "";

  // ctx.client must be a getter — selectTemplate() can run before
  // connect() completes (init() calls selectTemplate("lite-ivr") then
  // kicks off connectWithToken/connect asynchronously). Captured plain
  // values would freeze at the mount-time null and templates would
  // miss every callinfo event. The getter always returns the current
  // state.client so addEventListener() inside templates, once the
  // template is re-mounted after connect, sees the live client.
  const ctx = {
    get client() { return state.client; },
    body,
    log,
    activeCalls: state.activeCalls,
    getActiveCalls: () => state.activeCalls,
    safeInject,
    markSelfInjection: (lid) => state.selfInjections.add(lid),
    // Mode-aware text→inject: synthesize via Mode A (gateway) or Mode B
    // (browser direct) depending on the provider panel, then POST raw
    // PCM into the call. Templates should use this instead of
    // `client.injectText` so the Mode B path is honoured.
    safeInjectText: (lid, text) =>
      safeInject(lid, async () => {
        const pcm = await synthesizePcm(text);
        return state.client.injectAudio(lid, pcm, "application/octet-stream");
      }),
    providerMode: () => state.provider.mode,
  };
  try {
    state.templateDispose = tpl.module.mount(ctx) || null;
    // mount() 가 ctx.body.innerHTML 을 통째로 다시 쓰기 때문에 인트로 박스는
    // 반드시 mount 이후에 prepend 해야 살아남음. 템플릿 코드를 일일이 고칠 필요 없음.
    if (tpl.intro) renderDemoIntro(body, tpl.intro);
  } catch (err) {
    body.innerHTML = `<p style="color:var(--err)">template error: ${escapeHtml(String(err))}</p>`;
    console.error(err);
  }

  $("code-view").textContent = tpl.module.code || "// no code sample for this template";
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

// ── bootstrap ──────────────────────────────────────────────────────
function init() {
  loadCreds();
  applyBannerDismissState();
  wireBannerDismiss();
  wireWelcomeModal();
  wireGlossaryModal();
  wireProviderUI();
  renderTemplateMenu();
  wireTemplateMenu();
  wireTabs();
  updateGuideSteps();
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
  } else {
    // URL 파라미터가 없으면 — localStorage 에 저장된 자격증명 (이전 연결에서
    // saveCreds() 가 기록한 host/tid/pw 셋) 이 모두 있으면 그걸로 자동 connect.
    // 사용자가 명시적으로 disconnect 한 직후라도 페이지 새로고침 시 다시 붙는
    // 동작이 활성 테스트 흐름에 맞고, opt-out 은 좌측 "Clear credentials" 로
    // 단순함. 자격증명이 한 개라도 비어있으면 폼이 채워진 채 대기만 한다.
    const saved = readCreds();
    if (saved.host && saved.tenantId && saved.password) {
      log("info", "auto-connect:start", { tid: saved.tenantId, via: "localStorage" });
      connect();
    }
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
    // Templates mounted before connectWithToken finished saw ctx.client=null;
    // re-mount so their callinfo addEventListener actually attaches.
    remountCurrentTemplate();
    // 게이트웨이 버전 노출
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
