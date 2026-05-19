// Browser-direct Google Gemini TTS adapter (Mode B).
//
// Gemini's generateContent endpoint with responseModalities=AUDIO returns
// inline raw 24 kHz mono signed-16 little-endian PCM base64-encoded inside
// the response JSON. We just decode, downsample 24k → 16k, and hand the
// resulting slin16 bytes to the gateway for injection.
//
// Endpoint accepts `key=<API_KEY>` query parameter from any origin, so the
// call works directly from the browser. The key is supplied by the demo
// user; we never relay it through our gateway.

const GEMINI_DEFAULT_VOICE = "Kore"; // a clear, neutral preset voice
const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash-preview-tts";

export const geminiTts = {
  id: "gemini",
  label: "Google Gemini",
  defaults: { voice: GEMINI_DEFAULT_VOICE, model: GEMINI_DEFAULT_MODEL },
  keyPlaceholder: "AIza... (Google AI Studio API key)",
  voiceLabel: "Voice name (예: Kore, Puck, Charon, ...)",

  /**
   * @param {string} text
   * @param {{ apiKey: string, voice?: string, model?: string }} opts
   * @returns {Promise<Uint8Array>} slin16 PCM (16k mono 16-bit LE)
   */
  async synthesizeToPcm(text, opts) {
    if (!opts?.apiKey) throw new Error("Gemini API key required");
    const voice = opts.voice || GEMINI_DEFAULT_VOICE;
    const model = opts.model || GEMINI_DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const inline = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!inline?.data) throw new Error("Gemini response missing inline audio data");
    // mimeType looks like "audio/L16;rate=24000;codec=pcm" or similar.
    const srcRate = extractRate(inline.mimeType) || 24000;
    const pcm24 = base64ToInt16(inline.data); // signed-16 LE @ srcRate, mono
    return downsampleS16ToSlin16(pcm24, srcRate);
  },
};

function extractRate(mimeType) {
  if (!mimeType) return null;
  const m = /rate=(\d+)/.exec(mimeType);
  return m ? parseInt(m[1], 10) : null;
}

function base64ToInt16(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // Reinterpret as little-endian signed-16. Use DataView to be explicit
  // about byte order even on big-endian platforms (extremely rare for
  // browsers, but free correctness).
  const out = new Int16Array(bytes.length / 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

// downsampleS16ToSlin16: signed-16 mono at `srcRate` → signed-16 mono at
// 16 kHz, little-endian byte buffer ready to POST to the gateway.
function downsampleS16ToSlin16(int16, srcRate) {
  const TARGET = 16000;
  if (srcRate === TARGET) {
    // Already correct — just emit LE bytes.
    const out = new Uint8Array(int16.length * 2);
    const view = new DataView(out.buffer);
    for (let i = 0; i < int16.length; i++) view.setInt16(i * 2, int16[i], true);
    return out;
  }
  const ratio = srcRate / TARGET;
  const outLen = Math.floor(int16.length / ratio);
  const bytes = new Uint8Array(outLen * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const i0 = Math.floor(srcIdx);
    const i1 = Math.min(i0 + 1, int16.length - 1);
    const frac = srcIdx - i0;
    const sample = int16[i0] * (1 - frac) + int16[i1] * frac;
    view.setInt16(i * 2, Math.round(sample), true);
  }
  return bytes;
}
