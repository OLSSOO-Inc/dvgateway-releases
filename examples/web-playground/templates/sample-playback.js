// Sample audio playback — upload a slin16 PCM (또는 WAV/MP3) → POST raw bytes
// to /api/v1/tts/{linkedId}. Guide §14.6 권장 포맷은 slin16:
//   ffmpeg -y -i input.mp3 -ac 1 -ar 16000 -f s16le -acodec pcm_s16le output.pcm

const CODE = `// 미리 변환해둔 PCM(slin16)을 통화에 재생 (guide §14.6)
//   변환: ffmpeg -y -i welcome.mp3 -ac 1 -ar 16000 -f s16le -acodec pcm_s16le welcome.pcm
const file = fileInput.files[0];
const bytes = await file.arrayBuffer();

await fetch(\`http://\${HOST}:8080/api/v1/tts/\${linkedId}\`, {
  method: "POST",
  headers: {
    "Authorization": \`Bearer \${token}\`,
    "Content-Type":  "application/octet-stream",
    "X-Inject-Id":   \`sample-\${linkedId}\`,
  },
  body: bytes,
});`;

function mount(ctx) {
  ctx.body.innerHTML = `
    <div class="field">
      <label>대상 통화
        <select id="sp-call"></select>
      </label>
    </div>
    <div class="field">
      <label>오디오 파일
        <input type="file" id="sp-file" accept="audio/*,.wav,.mp3,.ogg,.pcm,.sln,.sln16" />
      </label>
      <p class="help">
        권장 포맷은 <b>slin16</b> (16kHz mono 16-bit LE, 헤더 없는 raw PCM).
        WAV/MP3는 게이트웨이가 ffmpeg로 자동 변환을 시도하지만, 안정적이려면 미리 변환해서 캐시하세요.<br/>
        <code>ffmpeg -y -i in.mp3 -ac 1 -ar 16000 -f s16le -acodec pcm_s16le out.pcm</code>
      </p>
    </div>
    <div class="row">
      <button id="sp-send" class="primary">통화에 재생</button>
    </div>
    <p class="help" id="sp-status">파일을 선택하고 통화를 고른 뒤 재생을 누르세요.</p>
  `;

  const callSel = ctx.body.querySelector("#sp-call");
  const fileEl = ctx.body.querySelector("#sp-file");
  const sendBtn = ctx.body.querySelector("#sp-send");
  const statusEl = ctx.body.querySelector("#sp-status");

  function refreshCalls() {
    const calls = Array.from(ctx.getActiveCalls().values());
    const cur = callSel.value;
    callSel.innerHTML = calls.length === 0
      ? '<option value="">(활성 통화 없음)</option>'
      : calls.map((c) => `<option value="${c.linkedId}">${c.linkedId} · ${c.caller || "?"} → ${c.callee || "?"}</option>`).join("");
    if (cur && calls.find((c) => c.linkedId === cur)) callSel.value = cur;
  }
  const tick = setInterval(refreshCalls, 500);
  refreshCalls();

  sendBtn.addEventListener("click", async () => {
    const linkedId = callSel.value;
    if (!linkedId) { statusEl.textContent = "활성 통화를 선택하세요."; return; }
    const file = fileEl.files?.[0];
    if (!file) { statusEl.textContent = "파일을 선택하세요."; return; }
    if (!ctx.client) { statusEl.textContent = "먼저 Connect 하세요."; return; }

    statusEl.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB) 업로드 중…`;
    sendBtn.disabled = true;
    try {
      const bytes = await file.arrayBuffer();
      await ctx.safeInject(linkedId, () =>
        ctx.client.injectAudio(linkedId, new Uint8Array(bytes), "application/octet-stream"),
      );
      statusEl.textContent = `✓ 재생 시작 — ${file.name}`;
      ctx.log("ok", "sample:injected", { linkedId, file: file.name, size: file.size });
    } catch (err) {
      statusEl.textContent = `✗ 실패: ${err.message}`;
      ctx.log("err", "sample:fail", { error: err.message });
    } finally {
      sendBtn.disabled = false;
    }
  });

  return () => clearInterval(tick);
}

export default { mount, code: CODE };
