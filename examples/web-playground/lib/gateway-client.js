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
  let hint = "";
  if (res.status === 403) hint = " — 다른 테넌트의 linkedId일 수 있습니다";
  else if (res.status === 404) hint = " — 활성 통화 없음 (이미 종료됐을 가능성)";
  else if (res.status === 503) hint = " — 기능 비활성 (라이선스 또는 설정)";
  return new Error(`${op} failed (${res.status})${hint}: ${body}`);
}
