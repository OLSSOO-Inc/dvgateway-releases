// Minimal browser client for DVGateway — no SDK, no build step.
// Follows the official SaaS tenant flow documented in
// docs/sdk-guide/14-tenant-fixed-audio-guide.md:
//
//   1. POST :8081/login  { tenantId, password }  → { token }   (dashboard port)
//   2. WS   :8080/api/v1/ws/callinfo?token=<jwt>  (or Authorization: Bearer)
//   3. POST :8080/api/v1/tts/{linkedId}            raw slin16 PCM body
//   4. POST :8080/api/v1/tts/synthesize            text → 16k PCM (for click-to-tts demo)
//
// The JWT carries a `tid` claim identifying the tenant; the gateway enforces
// strict tenant isolation on every endpoint and WS event.

export class GatewayClient extends EventTarget {
  /**
   * @param {object} opts
   * @param {string} opts.host       e.g. "gw.example.com" or "1.2.3.4" (no scheme, no port)
   * @param {string} opts.tenantId   tenant identifier issued by the operator
   * @param {string} opts.password   tenant password issued by the operator
   * @param {boolean} [opts.tls=false]    when true, use https/wss
   * @param {number} [opts.apiPort=8080]  API/WebSocket port
   * @param {number} [opts.loginPort=8081]  dashboard /login port
   */
  constructor({ host, tenantId, password, tls = false, apiPort = 8080, loginPort = 8081 }) {
    super();
    this.host = String(host || "").replace(/^\w+:\/\//, "").replace(/\/.*$/, "").replace(/:\d+$/, "");
    this.tenantId = tenantId;
    this.password = password;
    this.tls = !!tls;
    this.apiPort = apiPort;
    this.loginPort = loginPort;
    this.token = null;
    this.tokenTid = null;
    this.tokenExp = null;
    this.ws = null;
    this._closedByUser = false;
    this._reconnectAttempt = 0;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  get apiBase() {
    return `${this.tls ? "https" : "http"}://${this.host}:${this.apiPort}`;
  }
  get loginBase() {
    return `${this.tls ? "https" : "http"}://${this.host}:${this.loginPort}`;
  }
  get wsBase() {
    return `${this.tls ? "wss" : "ws"}://${this.host}:${this.apiPort}`;
  }

  // ── auth ─────────────────────────────────────────────────────────
  // POST :8081/login {tenantId, password} → {token}
  async login() {
    const res = await fetch(`${this.loginBase}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenantId: this.tenantId, password: this.password }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let msg = `login failed (${res.status})`;
      if (res.status === 401) msg = "login failed (401) — 비밀번호가 잘못되었거나 테넌트 ID가 틀립니다";
      else if (res.status === 404) msg = `login failed (404) — :${this.loginPort}/login 경로 확인 (포트 오타?)`;
      throw new Error(`${msg}: ${text}`);
    }
    const data = await res.json();
    if (!data || !data.token) throw new Error("login response missing token");
    this.token = data.token;
    const claims = decodeJwtPayload(this.token);
    this.tokenTid = claims?.tid ?? null;
    this.tokenExp = claims?.exp ?? null;
    return { token: this.token, tid: this.tokenTid, exp: this.tokenExp };
  }

  // ── callinfo websocket ───────────────────────────────────────────
  connectCallinfo() {
    if (!this.token) throw new Error("call login() first");
    this._closedByUser = false;
    const url = new URL(`${this.wsBase}/api/v1/ws/callinfo`);
    url.searchParams.set("token", this.token);
    this.ws = new WebSocket(url.toString());
    this._emit("status", { state: "connecting" });

    this.ws.addEventListener("open", () => {
      this._reconnectAttempt = 0;
      this._emit("status", { state: "open" });
    });

    this.ws.addEventListener("message", (msg) => {
      let evt;
      try { evt = JSON.parse(msg.data); } catch { return; }
      this._emit("event", evt);
      if (evt.event) this._emit(evt.event, evt);
    });

    this.ws.addEventListener("close", () => {
      this._emit("status", { state: "closed" });
      if (!this._closedByUser) this._scheduleReconnect();
    });

    this.ws.addEventListener("error", (err) => {
      this._emit("status", { state: "error", error: err });
    });
  }

  _scheduleReconnect() {
    this._reconnectAttempt++;
    const delay = Math.min(1000 * 2 ** this._reconnectAttempt, 30000);
    setTimeout(() => {
      if (this._closedByUser) return;
      // JWT may have expired during the gap — re-login first if so.
      if (this.tokenExp && Date.now() / 1000 > this.tokenExp - 60) {
        this.login()
          .then(() => this.connectCallinfo())
          .catch((err) => this._emit("status", { state: "error", error: err }));
      } else {
        this.connectCallinfo();
      }
    }, delay);
  }

  disconnect() {
    this._closedByUser = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ── REST helpers ─────────────────────────────────────────────────
  _authHeaders(extra = {}) {
    return { "Authorization": `Bearer ${this.token}`, ...extra };
  }

  // text → 16k s16le PCM bytes
  async synthesizeText(text, provider) {
    const res = await fetch(`${this.apiBase}/api/v1/tts/synthesize`, {
      method: "POST",
      headers: this._authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text, provider: provider || "" }),
    });
    if (!res.ok) throw await mkApiError(res, "synthesize");
    // Provider quota / rate-limit (HTTP 429) is surfaced by the gateway as
    // X-TTS-Quota headers — the audio body is the espeak-ng fallback so it
    // still plays, but the caller should tell the user it's a temporary
    // 사용량 한도, not a service outage. Notify via onQuota if registered.
    if (res.headers.get("X-TTS-Quota") === "exceeded" && typeof this.onQuota === "function") {
      try {
        this.onQuota({
          provider: res.headers.get("X-TTS-Quota-Provider") || provider || "",
          retryAfterSec: parseInt(res.headers.get("X-TTS-Quota-Retry-After") || "0", 10) || 0,
        });
      } catch {}
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  // raw audio bytes (slin16 PCM 권장; WAV/MP3는 게이트웨이가 ffmpeg 변환) → 통화 주입
  async injectAudio(linkedId, bytes, contentType = "application/octet-stream") {
    const res = await fetch(`${this.apiBase}/api/v1/tts/${encodeURIComponent(linkedId)}`, {
      method: "POST",
      headers: this._authHeaders({ "Content-Type": contentType }),
      body: bytes,
    });
    if (!res.ok) throw await mkApiError(res, "inject");
    return res.headers.get("X-Inject-Id") || null;
  }

  async injectText(linkedId, text, provider) {
    const pcm = await this.synthesizeText(text, provider);
    return this.injectAudio(linkedId, pcm, "application/octet-stream");
  }

  async stopInjection(linkedId) {
    const res = await fetch(`${this.apiBase}/api/v1/tts/${encodeURIComponent(linkedId)}`, {
      method: "DELETE",
      headers: this._authHeaders(),
    });
    return res.ok;
  }

  async listSessions() {
    const res = await fetch(`${this.apiBase}/api/v1/sessions`, {
      headers: this._authHeaders(),
    });
    if (!res.ok) throw await mkApiError(res, "sessions");
    return res.json();
  }

  // Cheap liveness probe — returns true if the gateway still tracks the call
  // for our tenant. Used before TTS/audio injection so we never POST against
  // a linkedId the gateway already tore down (and so we can self-heal the
  // local activeCalls map when callinfo missed a call:ended).
  async sessionExists(linkedId) {
    if (!linkedId) return false;
    const res = await fetch(`${this.apiBase}/api/v1/sessions/${encodeURIComponent(linkedId)}`, {
      headers: this._authHeaders(),
    });
    if (res.status === 404 || res.status === 403) return false;
    if (!res.ok) throw await mkApiError(res, "sessionExists");
    return true;
  }

  // ── click-to-call (outbound) ─────────────────────────────────────
  //
  // Initiate an outbound call via PBX. cidNumber and accountCode are
  // intentionally NOT accepted here — the gateway looks them up from
  // its per-tenant outbound-defaults store (see
  // /api/v1/tenants/{id}/outbound-defaults) so they cannot be spoofed
  // from the browser.
  //
  // 412 (Precondition Failed) means the gateway has no registered defaults
  // for this tenant; the user needs an admin to provision them first.
  async clickToCall({ caller, callee, cidName, customValue1, customValue2, customValue3 }) {
    if (!caller || !callee) throw new Error("caller and callee are required");
    const body = { caller, callee };
    if (cidName) body.cidName = cidName;
    if (customValue1) body.customValue1 = customValue1;
    if (customValue2) body.customValue2 = customValue2;
    if (customValue3) body.customValue3 = customValue3;
    const res = await fetch(`${this.apiBase}/api/v1/pbx/click-to-call`, {
      method: "POST",
      headers: this._authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await mkApiError(res, "clickToCall");
    return res.json();
  }

  // Read the tenant's registered outbound defaults (cidNumber, cidName,
  // accountCode). accountCode in the response is masked. Used by the
  // playground to prefill the read-only "fixed values" chip.
  // 404 = no entry registered yet for this tenant.
  async getOutboundDefaults(tenantId) {
    const tid = tenantId || this.tokenTid || this.tenantId;
    if (!tid) throw new Error("tenantId required to fetch outbound defaults");
    const res = await fetch(
      `${this.apiBase}/api/v1/tenants/${encodeURIComponent(tid)}/outbound-defaults`,
      { headers: this._authHeaders() },
    );
    if (res.status === 404) return null;
    if (!res.ok) throw await mkApiError(res, "getOutboundDefaults");
    return res.json();
  }

  // ── lite-mode IVR (SDK 1.7.0) ────────────────────────────────────
  // POST /api/v1/playback/{linkedId} → { playbackId, state }
  async litePlayback(linkedId, media) {
    if (!media) throw new Error("media is required");
    const res = await fetch(`${this.apiBase}/api/v1/playback/${encodeURIComponent(linkedId)}`, {
      method: "POST",
      headers: this._authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ media }),
    });
    if (!res.ok) throw await mkApiError(res, "litePlayback");
    return res.json(); // { playbackId, state }
  }

  // POST /api/v1/playback/{linkedId}/tts → { playbackId, media, synthesizedBytes, cacheHit }
  //
  // mode=lite 통화 전용 TTS 재생. 게이트웨이가 cloud TTS(또는 local fallback)
  // 로 합성한 뒤 ARI Playback으로 채널에 직접 재생. lite는 ExternalMedia/
  // bridge가 없어서 PCM 주입 경로(POST /api/v1/tts/{linkedId})는 4xx로 거절됨.
  // 게이트웨이는 sha256(tenant|provider|voice|text) 기반 cache로 같은 입력은
  // 합성을 생략한다.
  async liteTtsPlayback(linkedId, text, provider) {
    if (!text) throw new Error("text is required");
    const body = { text };
    if (provider) body.provider = provider;
    const res = await fetch(`${this.apiBase}/api/v1/playback/${encodeURIComponent(linkedId)}/tts`, {
      method: "POST",
      headers: this._authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!res.ok) throw await mkApiError(res, "liteTtsPlayback");
    return res.json();
  }

  // DELETE /api/v1/playback/{linkedId}/{playbackId}
  async liteStopPlayback(linkedId, playbackId) {
    if (!playbackId) throw new Error("playbackId is required");
    const res = await fetch(
      `${this.apiBase}/api/v1/playback/${encodeURIComponent(linkedId)}/${encodeURIComponent(playbackId)}`,
      { method: "DELETE", headers: this._authHeaders() },
    );
    return res.ok;
  }

  // POST /api/v1/calls/{linkedId}/hangup
  async hangup(linkedId) {
    const res = await fetch(`${this.apiBase}/api/v1/calls/${encodeURIComponent(linkedId)}/hangup`, {
      method: "POST",
      headers: this._authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({}),
    });
    return res.ok;
  }

  // ── warm transfer (SDK 1.4.x / gateway warm_transfer) ─────────────
  // POST /api/v1/transfer/warm/{linkedId}
  //   → { connected, transferId, bridgeId?, whisperPlayed?, whisperSkipReason?,
  //       mixedStreamUrl?, ... }
  // 현재 통화(linkedId)를 보류하고 destination(상담원/외부번호)을 호출 → 응답하면
  // 두 레그를 브릿지로 연결한다. whisperText 지정 시 상담원에게 먼저 안내 멘트를
  // 들려준 뒤 연결(서버측 cloud TTS). outbound=true 면 destination 을 외부 트렁크로
  // 발신(context=cos-all 등 트렁크 컨텍스트 필요). 게이트웨이 ARI 활성 필수.
  async warmTransfer(linkedId, opts = {}) {
    if (!linkedId) throw new Error("linkedId is required");
    if (!opts.destination) throw new Error("destination is required");
    const body = {
      destination: opts.destination,
      timeoutMs: Math.floor(opts.timeoutMs || 30000),
    };
    if (opts.context) body.context = opts.context;
    if (opts.whisperText) body.whisperText = opts.whisperText;
    if (opts.holdAudioUrl) body.holdAudioUrl = opts.holdAudioUrl;
    if (opts.outbound) body.outbound = true;
    if (opts.cidNumber) body.cidNumber = opts.cidNumber;
    if (opts.cidName) body.cidName = opts.cidName;
    if (opts.accountCode) body.accountCode = opts.accountCode;
    if (opts.streamMixedToExternalMedia) body.streamMixedToExternalMedia = true;
    const res = await fetch(
      `${this.apiBase}/api/v1/transfer/warm/${encodeURIComponent(linkedId)}`,
      {
        method: "POST",
        headers: this._authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) throw await mkApiError(res, "warmTransfer");
    return res.json();
  }

  // ── provider API keys (Mode A — gateway-side storage) ────────────
  // Mirrors what the gateway dashboard's "API Keys" panel does. Lets demo
  // users register their own STT/TTS/LLM provider keys against the
  // gateway so /tts/synthesize and /stt/conf/{cid}/start pick them up.
  //
  // Response shape: { stt: {provider→cfg}, tts: {...}, llm: {...} }
  // where cfg = { enabled, role, apiKey (masked), voice, ... }
  async getApiKeys() {
    const res = await fetch(`${this.apiBase}/api/v1/config/apikeys`, {
      headers: this._authHeaders(),
    });
    if (!res.ok) throw await mkApiError(res, "getApiKeys");
    return res.json();
  }

  // Reveal the unmasked key for a single provider (used to roundtrip
  // through saveApiKeys without overwriting unrelated providers).
  async revealApiKey(category, provider) {
    const url = new URL(`${this.apiBase}/api/v1/config/apikeys/reveal`);
    url.searchParams.set("cat", category);
    url.searchParams.set("provider", provider);
    const res = await fetch(url.toString(), { headers: this._authHeaders() });
    if (!res.ok) throw await mkApiError(res, "revealApiKey");
    const data = await res.json();
    return data.apiKey || "";
  }

  // Enable a single provider with the given key + voice (if applicable).
  // Reads the current full config, mutates one slot, posts it back. The
  // gateway preserves masked entries elsewhere so this won't clobber
  // existing settings.
  async setApiKey({ category, provider, apiKey, voice, role = "primary" }) {
    const cfg = await this.getApiKeys();
    const bucket = cfg[category];
    if (!bucket) throw new Error(`unknown category ${category}`);
    const slot = bucket[provider] || { enabled: false, role: "", apiKey: "" };
    slot.apiKey = apiKey;
    slot.enabled = !!apiKey;
    if (voice !== undefined) slot.voice = voice;
    if (role) slot.role = role;
    bucket[provider] = slot;
    // demote other primaries in the same category so we don't trip the
    // gateway's "only one primary per category" guard.
    for (const [name, p] of Object.entries(bucket)) {
      if (name !== provider && p && p.role === "primary") p.role = "backup";
    }
    const res = await fetch(`${this.apiBase}/api/v1/config/apikeys`, {
      method: "POST",
      headers: this._authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(cfg),
    });
    if (!res.ok) throw await mkApiError(res, "setApiKey");
    return res.json();
  }

  // List which providers the gateway currently considers usable for the
  // tenant (enabled + non-empty key). Returns
  // { stt: [{provider,role,voice?}], tts: [...], llm: [...] }.
  async listProviders() {
    const res = await fetch(`${this.apiBase}/api/v1/config/apikeys/providers`, {
      headers: this._authHeaders(),
    });
    if (!res.ok) throw await mkApiError(res, "listProviders");
    return res.json();
  }

  // ── 앱 푸시 / 알림 (gateway 1.4.8.0) ─────────────────────────────
  // 연동된 모바일 앱(extension → userId → fcm_token)에 dvg_event 푸시.
  // 게이트웨이에 푸시 릴레이(GW_WARM_TRANSFER_PUSH_ENABLED + URL + SECRET)가
  // 설정돼 있어야 동작 — 미설정 시 503.

  // POST /api/v1/push/extension → { delivered, subtype }
  // 범용 푸시. data 는 문자열 맵(앱이 subtype 별로 해석).
  async pushToExtension({ extension, subtype, title, body, linkedId, data }) {
    if (!extension) throw new Error("extension is required");
    if (!subtype) throw new Error("subtype is required");
    const payload = { extension, subtype };
    if (title) payload.title = title;
    if (body) payload.body = body;
    if (linkedId) payload.linkedid = linkedId;
    if (data && Object.keys(data).length) payload.data = data;
    const res = await fetch(`${this.apiBase}/api/v1/push/extension`, {
      method: "POST",
      headers: this._authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await mkApiError(res, "pushToExtension");
    return res.json();
  }

  // POST /api/v1/push/user → { delivered, subtype }
  // 이메일 키 푸시. 단말(extension) 도달 전(IVR/시스템 선응답)이거나 내선이 아직
  // 없는 사용자에게도 라우팅(email → userId → fcm_token). 게이트웨이 자동
  // incoming_call 푸시와 동일한 receiverEmail 라우팅 레일.
  async pushToUser({ email, subtype, title, body, linkedId, extension, did, caller, callerName, data }) {
    if (!email) throw new Error("email is required");
    if (!subtype) throw new Error("subtype is required");
    const payload = { email, subtype };
    if (title) payload.title = title;
    if (body) payload.body = body;
    if (linkedId) payload.linkedid = linkedId;
    if (extension) payload.extension = extension;
    if (did) payload.did = did;
    if (caller) payload.caller = caller;
    if (callerName) payload.callerName = callerName;
    if (data && Object.keys(data).length) payload.data = data;
    const res = await fetch(`${this.apiBase}/api/v1/push/user`, {
      method: "POST",
      headers: this._authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw await mkApiError(res, "pushToUser");
    return res.json();
  }

  // GET /api/v1/tenants/{id}/seats → { seats:[{seatId,email,extension,did,status,...}], limit, used, ... }
  // 테넌트에 등록된 모바일 앱 사용자(seat) 목록. 푸시 대상 선택 드롭다운 소스.
  async listSeats() {
    const tid = this.tenantId;
    if (!tid) throw new Error("tenantId is required");
    const res = await fetch(
      `${this.apiBase}/api/v1/tenants/${encodeURIComponent(tid)}/seats`,
      { headers: this._authHeaders() },
    );
    if (!res.ok) throw await mkApiError(res, "listSeats");
    return res.json();
  }

  // POST /api/v1/push/call-summary/{linkedId} → { delivered, subtype, linkedid }
  // 통화 종료 후 결과 링크 푸시. summaryUrl/transcriptUrl/audioUrl 중 1개 이상 필수.
  async notifyCallSummary(linkedId, { extension, summaryUrl, transcriptUrl, audioUrl, title, body }) {
    if (!linkedId) throw new Error("linkedId is required");
    if (!extension) throw new Error("extension is required");
    if (!summaryUrl && !transcriptUrl && !audioUrl) {
      throw new Error("at least one of summaryUrl/transcriptUrl/audioUrl is required");
    }
    const payload = { extension };
    if (summaryUrl) payload.summaryUrl = summaryUrl;
    if (transcriptUrl) payload.transcriptUrl = transcriptUrl;
    if (audioUrl) payload.audioUrl = audioUrl;
    if (title) payload.title = title;
    if (body) payload.body = body;
    const res = await fetch(
      `${this.apiBase}/api/v1/push/call-summary/${encodeURIComponent(linkedId)}`,
      {
        method: "POST",
        headers: this._authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(payload),
      },
    );
    if (!res.ok) throw await mkApiError(res, "notifyCallSummary");
    return res.json();
  }

  // 부재중 알림 — pushToExtension 의 missed_call subtype 편의 래퍼.
  async notifyMissedCall({ extension, callerNumber, callerName, linkedId }) {
    const data = {};
    if (callerNumber) data.caller_number = callerNumber;
    if (callerName) data.caller_name = callerName;
    return this.pushToExtension({
      extension,
      subtype: "missed_call",
      title: callerName || callerNumber || undefined,
      body: callerNumber || undefined,
      linkedId,
      data,
    });
  }
}

// ── JWT helpers ────────────────────────────────────────────────────
// Decode the payload only — we never trust this for security decisions
// (the gateway re-verifies the signature), but it lets us show the tenant
// id and expiry in the UI.
function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = atob(b64 + pad);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function mkApiError(res, op) {
  const body = await res.text().catch(() => "");
  // push 계열은 503/404 의 의미가 통화 API 와 달라서 별도 힌트.
  //   503 = 푸시 릴레이(GW_WARM_TRANSFER_PUSH_*) 미설정
  //   404 = 해당 내선으로 등록된 기기 없음 (앱 미등록/미승인)
  const isPush = /push|notify/i.test(op);
  let hint = "";
  if (res.status === 403) hint = " — 다른 테넌트의 linkedId일 수 있습니다";
  else if (res.status === 404) {
    hint = isPush
      ? " — 해당 내선으로 등록된 기기 없음 (앱 로그인·내선 등록·기기 승인 확인)"
      : " — 활성 통화 없음 (이미 종료됐을 가능성)";
  } else if (res.status === 503) {
    hint = isPush
      ? " — 푸시 릴레이 미설정 (GW_WARM_TRANSFER_PUSH_ENABLED + URL + SECRET)"
      : " — 기능 비활성 (라이선스 또는 설정)";
  }
  return new Error(`${op} failed (${res.status})${hint}: ${body}`);
}
