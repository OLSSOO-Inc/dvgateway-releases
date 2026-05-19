// Browser-direct ElevenLabs TTS adapter (Mode B).
//
// The user supplies their own ElevenLabs API key. We call the ElevenLabs
// REST endpoint from the browser, receive MP3 (which is what ElevenLabs
// returns by default for the streaming endpoint), then decode + downmix +
// resample to 16 kHz mono 16-bit LE PCM ("slin16") so the gateway can
// inject it directly into the call via POST /api/v1/tts/{linkedId}.
//
// Key never leaves the browser → gateway path. ElevenLabs accepts the
// xi-api-key header from CORS preflight, so this works in-browser.

const ELEVENLABS_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const ELEVENLABS_DEFAULT_MODEL = "eleven_flash_v2_5";

export const elevenLabsTts = {
  id: "elevenlabs",
  label: "ElevenLabs",
  defaults: { voice: ELEVENLABS_DEFAULT_VOICE, model: ELEVENLABS_DEFAULT_MODEL },
  keyPlaceholder: "xi-api-key (sk_...)",
  voiceLabel: "Voice ID (예: 21m00Tcm4TlvDq8ikWAM)",

  /**
   * @param {string} text
   * @param {{ apiKey: string, voice?: string, model?: string }} opts
   * @returns {Promise<Uint8Array>} slin16 PCM (16k mono 16-bit LE)
   */
  async synthesizeToPcm(text, opts) {
    if (!opts?.apiKey) throw new Error("ElevenLabs API key required");
    const voice = opts.voice || ELEVENLABS_DEFAULT_VOICE;
    const model = opts.model || ELEVENLABS_DEFAULT_MODEL;
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": opts.apiKey,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: model,
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 200)}`);
    }
    const mp3 = await res.arrayBuffer();
    return await decodeToSlin16(mp3);
  },
};

// decodeToSlin16: any browser-decodable encoded audio (MP3/WAV/OGG) →
// 16 kHz mono 16-bit LE PCM. Used by both ElevenLabs (MP3) and any future
// adapter that returns a compressed format.
export async function decodeToSlin16(arrayBuffer) {
  // Lazy-create a shared offline-friendly AudioContext. We do not use the
  // OfflineAudioContext directly because some browsers (Safari) require
  // sampleRate to be in a narrow range; we instead decode at the
  // browser's native rate and resample manually below.
  const ctx = getDecodeContext();
  // decodeAudioData transfers the buffer; clone first so callers can reuse.
  const copy = arrayBuffer.slice(0);
  const audioBuf = await new Promise((resolve, reject) => {
    // Safari prefers the callback form; pass both for compatibility.
    try {
      const p = ctx.decodeAudioData(copy, resolve, reject);
      if (p && typeof p.then === "function") p.then(resolve, reject);
    } catch (e) { reject(e); }
  });
  return audioBufferToSlin16(audioBuf);
}

let _decodeCtx = null;
function getDecodeContext() {
  if (_decodeCtx) return _decodeCtx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) throw new Error("WebAudio not available in this browser");
  _decodeCtx = new Ctor();
  return _decodeCtx;
}

// audioBufferToSlin16: downmix to mono, resample to 16 kHz with linear
// interpolation, clamp + convert to 16-bit signed little-endian PCM bytes.
//
// Linear interpolation is fine for telephony — the gateway pipes this
// straight into a 16 kHz slin16 channel where higher-order resampling
// quality is wasted (the line itself is bandwidth-limited).
function audioBufferToSlin16(audioBuf) {
  const srcRate = audioBuf.sampleRate;
  const srcLen = audioBuf.length;
  const channels = audioBuf.numberOfChannels;
  // 1) downmix to mono Float32
  const mono = new Float32Array(srcLen);
  if (channels === 1) {
    mono.set(audioBuf.getChannelData(0));
  } else {
    for (let ch = 0; ch < channels; ch++) {
      const data = audioBuf.getChannelData(ch);
      for (let i = 0; i < srcLen; i++) mono[i] += data[i];
    }
    const inv = 1 / channels;
    for (let i = 0; i < srcLen; i++) mono[i] *= inv;
  }

  // 2) resample to 16 kHz (linear)
  const TARGET_RATE = 16000;
  if (srcRate === TARGET_RATE) return floatToS16LE(mono);

  const ratio = srcRate / TARGET_RATE;
  const outLen = Math.floor(srcLen / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, srcLen - 1);
    const frac = srcIdx - i0;
    out[i] = mono[i0] * (1 - frac) + mono[i1] * frac;
  }
  return floatToS16LE(out);
}

function floatToS16LE(float32) {
  const bytes = new Uint8Array(float32.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    s = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(i * 2, s | 0, true); // little-endian
  }
  return bytes;
}
