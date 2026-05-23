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
      <label>어떤 통화에 들려드릴까요?
        <select id="sp-call"></select>
      </label>
    </div>
    <div class="field">
      <label>들려드릴 음원 파일
        <input type="file" id="sp-file" accept="audio/*,.wav,.mp3,.ogg,.pcm,.sln,.sln16" />
      </label>
      <p class="help">
        WAV·MP3·OGG 파일 모두 올리실 수 있어요. 서버가 자동으로 통화에 맞는 형식으로 바꿔서 들려드려요.<br/>
        <span class="muted small">개발자 팁: 미리 16kHz mono PCM(slin16)으로 변환해 두면 더 빠르고 안정적이에요.</span>
      </p>
    </div>
    <div class="row">
      <button id="sp-send" class="primary">🎵 통화에 들려주기</button>
    </div>
    <p class="help" id="sp-status">파일을 고르고, 통화를 선택한 뒤 들려주기를 눌러 주세요.</p>
  `;

  const callSel = ctx.body.querySelector("#sp-call");
  const fileEl = ctx.body.querySelector("#sp-file");
  const sendBtn = ctx.body.querySelector("#sp-send");
  const statusEl = ctx.body.querySelector("#sp-status");

  function refreshCalls() {
    const calls = Array.from(ctx.getActiveCalls().values());
    const cur = callSel.value;
    callSel.innerHTML = calls.length === 0
      ? '<option value="">(진행 중인 통화가 없어요)</option>'
      : calls.map((c) => `<option value="${c.linkedId}">${c.linkedId} · ${c.caller || "?"} → ${c.callee || "?"}</option>`).join("");
    if (cur && calls.find((c) => c.linkedId === cur)) callSel.value = cur;
  }
  const tick = setInterval(refreshCalls, 500);
  refreshCalls();

  sendBtn.addEventListener("click", async () => {
    const linkedId = callSel.value;
    if (!linkedId) { statusEl.textContent = "들려드릴 통화를 골라 주세요."; return; }
    const file = fileEl.files?.[0];
    if (!file) { statusEl.textContent = "음원 파일을 골라 주세요."; return; }
    if (!ctx.client) { statusEl.textContent = "먼저 왼쪽에서 서버에 연결해 주세요."; return; }

    statusEl.textContent = `📤 ${file.name} (${(file.size / 1024).toFixed(1)} KB) 보내는 중이에요…`;
    sendBtn.disabled = true;
    try {
      const bytes = await file.arrayBuffer();
      await ctx.safeInject(linkedId, () =>
        ctx.client.injectAudio(linkedId, new Uint8Array(bytes), "application/octet-stream"),
      );
      statusEl.textContent = `✓ "${file.name}" 을 통화에 들려드리고 있어요`;
      ctx.log("ok", "sample:injected", { linkedId, file: file.name, size: file.size });
    } catch (err) {
      statusEl.textContent = `✗ 음원을 보내지 못했어요: ${err.message}`;
      ctx.log("err", "sample:fail", { error: err.message });
    } finally {
      sendBtn.disabled = false;
    }
  });

  return () => clearInterval(tick);
}

export default { mount, code: CODE };
