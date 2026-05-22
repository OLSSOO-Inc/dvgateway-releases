// Template registry. Each template is a self-contained module that
// receives a `ctx` object and renders into `ctx.body`.
//
// ctx = {
//   client: GatewayClient instance,
//   body: HTMLElement to render into,
//   log: (level, event, payload?) => void,
//   activeCalls: Map<linkedId, callInfo>,
// }
//
// Each template returns a `dispose()` function called when the user
// switches away — used to detach event listeners.

import callinfoMonitor from "./callinfo-monitor.js";
import greetingTts from "./greeting-tts.js";
import clickTts from "./click-tts.js";
import samplePlayback from "./sample-playback.js";
import dtmfReceive from "./dtmf-receive.js";
import sttLive from "./stt-live.js";
import callEnded from "./call-ended.js";
import liteIvr from "./lite-ivr.js";

export const templates = [
  {
    id: "lite-ivr",
    title: "1. ⚡ Lite IVR",
    desc: "mode=lite 통화 전용 — ARI Playback + DTMF 수집 + Hangup. ExternalMedia/STT/TTS 없음, 최소 자원 IVR.",
    module: liteIvr,
  },
  {
    id: "callinfo",
    title: "2. Callinfo 모니터",
    desc: "가장 단순한 첫 체험 — 통화 이벤트를 실시간으로 표시합니다.",
    module: callinfoMonitor,
  },
  {
    id: "greeting-tts",
    title: "3. 전화 수신 시 인사말 TTS",
    desc: "call:new 또는 channel:state(up) 트리거 → 지정 텍스트 TTS를 통화에 주입.",
    module: greetingTts,
  },
  {
    id: "click-tts",
    title: "4. Click-to-TTS",
    desc: "활성 통화를 선택하고 텍스트를 입력 → 즉시 TTS 주입.",
    module: clickTts,
  },
  {
    id: "sample-playback",
    title: "5. 샘플 음원 재생",
    desc: "WAV/MP3 파일 업로드 → 게이트웨이가 ffmpeg로 변환 후 통화에 주입.",
    module: samplePlayback,
  },
  {
    id: "dtmf-receive",
    title: "6. DTMF 수신",
    desc: "통화에서 누른 키패드 입력을 표시. IVR 데모의 기본.",
    module: dtmfReceive,
  },
  {
    id: "stt-live",
    title: "7. STT 실시간 자막 (회의)",
    desc: "회의 ID에 대해 클라우드 STT를 시작하고 결과를 자막으로 표시.",
    module: sttLive,
  },
  {
    id: "call-ended",
    title: "8. 통화 종료 후 후처리",
    desc: "call:ended를 받아 통화 시간과 함께 종료 이벤트 로그를 누적.",
    module: callEnded,
  },
];

export function getTemplate(id) {
  return templates.find((t) => t.id === id);
}
