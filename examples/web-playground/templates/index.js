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
import sttCall from "./stt-call.js";
import callEnded from "./call-ended.js";
import liteIvr from "./lite-ivr.js";
import smsOptout from "./sms-optout.js";
import appPush from "./app-push.js";

// recommendedTrigger: which call-start path makes the demo easiest to try.
//   "outbound" — user should originate via the click-to-call panel
//   "inbound"  — user should dial the gateway DID from their phone
//   "either"   — both work equally; no spotlight needed
//
// requires: which provider API keys the demo needs to fully work.
//   "tts" — needs a TTS provider key (음성 합성). 「4. 프로바이더 API 키」에 등록.
//   "stt" — needs an STT provider key (음성 전사).
//   (없음) — 키 없이도 동작 (이벤트 모니터·DTMF·업로드 재생 등).
// 카드에 태그로 표시되고, 키 등록 여부에 따라 ready/needed 상태로 렌더됩니다.
export const templates = [
  {
    id: "lite-ivr",
    title: "1. ⚡ Lite IVR",
    desc: "음성 안내 재생 + 키 입력 수집 + 통화 종료 — 최소 자원으로 동작하는 자동 응답.",
    module: liteIvr,
    recommendedTrigger: "either",
    requires: ["tts"], // 커스텀 TTS 멘트 재생 시 (내장 sound: 재생은 키 불필요)
  },
  {
    id: "callinfo",
    title: "2. Callinfo 모니터",
    desc: "가장 단순한 첫 체험 — 통화 이벤트를 실시간으로 표시합니다.",
    module: callinfoMonitor,
    recommendedTrigger: "either",
    requires: [],
  },
  {
    id: "greeting-tts",
    title: "3. 전화 수신 시 인사말 TTS",
    desc: "call:new 또는 channel:state(up) 트리거 → 지정 텍스트 TTS를 통화에 주입.",
    module: greetingTts,
    recommendedTrigger: "outbound",
    requires: ["tts"],
  },
  {
    id: "click-tts",
    title: "4. Click-to-TTS",
    desc: "활성 통화를 선택하고 텍스트를 입력 → 즉시 TTS 주입.",
    module: clickTts,
    recommendedTrigger: "either",
    requires: ["tts"],
  },
  {
    id: "sample-playback",
    title: "5. 샘플 음원 재생",
    desc: "WAV/MP3 파일 업로드 → 게이트웨이가 ffmpeg로 변환 후 통화에 주입.",
    module: samplePlayback,
    recommendedTrigger: "either",
    requires: [], // 업로드 음원을 직접 주입 — TTS 합성 없음
  },
  {
    id: "dtmf-receive",
    title: "6. DTMF 수신",
    desc: "통화에서 누른 키패드 입력을 표시. IVR 데모의 기본.",
    module: dtmfReceive,
    recommendedTrigger: "inbound",
    requires: [],
  },
  {
    id: "stt-live",
    title: "7. STT 실시간 자막 (회의)",
    desc: "회의 ID에 대해 클라우드 STT를 시작하고 결과를 자막으로 표시.",
    module: sttLive,
    recommendedTrigger: "inbound",
    requires: ["stt"],
  },
  {
    id: "stt-call",
    title: "8. STT 실시간 (1:1 통화)",
    desc: "활성 1:1 통화(mode=both)에 클라우드 STT를 시작하고 발화를 시각·화자별 STT 결과로 표시.",
    module: sttCall,
    recommendedTrigger: "either",
    requires: ["stt"],
  },
  {
    id: "call-ended",
    title: "9. 통화 종료 후 후처리",
    desc: "call:ended를 받아 통화 시간과 함께 종료 이벤트 로그를 누적.",
    module: callEnded,
    recommendedTrigger: "either",
    requires: [],
  },
  {
    id: "sms-optout",
    title: "10. 문자수신거부 등록",
    desc: "연결 시 안내 TTS → 발신번호(CallerID) 또는 직접 입력(DTMF)한 번호를 수신거부로 등록하고 음성으로 확인.",
    module: smsOptout,
    recommendedTrigger: "either",
    requires: ["tts"],
  },
  {
    id: "app-push",
    title: "11. 📲 앱 푸시·알림",
    desc: "연동된 모바일 앱(내선 기준)으로 푸시 전송 — 범용/통화요약/부재중. 통화 없이도 테스트 가능.",
    module: appPush,
    recommendedTrigger: "either",
    requires: [], // 푸시 릴레이 설정이 필요(provider 키 아님). 미설정 시 503 안내.
  },
];

export function getTemplate(id) {
  return templates.find((t) => t.id === id);
}
