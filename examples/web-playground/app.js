import { GatewayClient } from "./lib/gateway-client.js";
import { templates, getTemplate } from "./templates/index.js";
import { getBrowserTtsAdapter, listBrowserTtsProviders } from "./lib/providers/index.js";

const STORAGE_KEY = "dvgw-playground-creds-v2";
const PROV_STORAGE_KEY = "dvgw-playground-provider-v1";
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

async function connect() {
  const creds = readCreds();
  if (!creds.host || !creds.tenantId || !creds.password) {
    alert("Gateway Host, Tenant ID, Password 모두 입력하세요.");
    return;
  }
  saveCreds();

  if (state.client) state.client.disconnect();

  const client = new GatewayClient(creds);
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
}

function disconnect() {
  if (state.client) {
    state.client.disconnect();
    state.client = null;
  }
  state.activeCalls.clear();
  renderCalls();
  setStatus("off", "disconnected");
  setTenantPill(null);
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

// ── templates ──────────────────────────────────────────────────────
function renderTemplateMenu() {
  const ul = $("template-menu");
  ul.innerHTML = templates.map((t) => `
    <li data-id="${t.id}">
      <span>${escapeHtml(t.title)}</span>
      <span class="desc">${escapeHtml(t.desc)}</span>
    </li>
  `).join("");
  ul.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (!li) return;
    selectTemplate(li.dataset.id);
  });
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

  const ctx = {
    client: state.client,
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
  wireProviderUI();
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
