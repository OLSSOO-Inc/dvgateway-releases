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

// modes: 이 템플릿이 어떤 통화 모드에서 동작하는지
//   "any"  — mode=lite / mode=both|customer|agent 모두 OK (이벤트 구독만)
//   "lite" — mode=lite 전용 (ARI Playback 기반, ExternalMedia 불필요)
//   "full" — 풀스트림 전용 (ExternalMedia/injectAudio/STT 사용, mode=lite 에선 동작 안 함)
export const templates = [
  {
    id: "lite-ivr",
    title: "1. ⚡ 가벼운 자동응답 (Lite IVR)",
    desc: "전화가 오면 음성 안내를 들려주고, 누른 키패드 번호를 수집하는 가장 단순한 자동응답이에요.",
    modes: "lite",
    intro: {
      can: [
        "통화에 안내음(예: hello-world)을 재생할 수 있어요",
        "원하는 문장을 음성으로 합성해서 통화에 들려드려요",
        "고객이 누른 키패드(0~9, *, #) 입력을 실시간으로 확인할 수 있어요",
        "통화를 종료시킬 수도 있어요",
      ],
      prep: [
        "왼쪽에서 서버 연결을 마쳐 주세요",
        "경량 모드(mode=lite)로 들어오는 전화가 한 통 있어야 해요",
        "TTS를 쓰려면 게이트웨이 버전이 1.4.5.8 이상이어야 해요",
      ],
    },
    module: liteIvr,
  },
  {
    id: "callinfo",
    title: "2. 📞 통화 이벤트 살펴보기",
    desc: "전화가 오고 끊기는 순간들을 실시간으로 보여드려요. 가장 먼저 체험해 보세요.",
    modes: "any",
    intro: {
      can: [
        "전화가 새로 들어오는 순간(call:new)을 확인할 수 있어요",
        "통화가 연결·종료되는 순간을 실시간으로 볼 수 있어요",
        "키패드 입력(DTMF)이 들어올 때마다 표시돼요",
      ],
      prep: [
        "왼쪽에서 서버 연결을 마쳐 주세요",
        "체험을 위해 테스트 전화를 한 통 걸어 보세요",
      ],
    },
    module: callinfoMonitor,
  },
  {
    id: "greeting-tts",
    title: "3. 👋 전화 받을 때 인사말 보내기",
    desc: "전화가 연결되는 순간, 정해진 문장을 음성으로 합성해서 들려드려요.",
    modes: "full",
    intro: {
      can: [
        "전화가 연결되는 순간 자동으로 인사말을 들려드릴 수 있어요",
        "원하는 문장을 입력해서 직접 인사말을 정할 수 있어요",
      ],
      prep: [
        "음성 합성(TTS) 키가 게이트웨이에 등록되어 있어야 해요",
        "풀스트림 모드(mode=both 등)로 들어오는 전화가 필요해요",
      ],
    },
    module: greetingTts,
  },
  {
    id: "click-tts",
    title: "4. 💬 원하는 문장을 통화에 보내기",
    desc: "통화를 선택하고 텍스트를 입력하면, 곧바로 음성으로 합성해서 들려드려요.",
    modes: "full",
    intro: {
      can: [
        "진행 중인 통화에 원하는 문장을 즉시 들려드릴 수 있어요",
        "여러 통화 중에서 대상 통화를 골라 보낼 수 있어요",
      ],
      prep: [
        "음성 합성(TTS) 키가 등록되어 있어야 해요",
        "풀스트림 통화가 한 통 이상 진행 중이어야 해요",
      ],
    },
    module: clickTts,
  },
  {
    id: "sample-playback",
    title: "5. 🎵 미리 준비한 음원 들려주기",
    desc: "직접 만든 WAV/MP3 파일을 업로드하면, 게이트웨이가 변환해서 통화에 흘려보내요.",
    modes: "full",
    intro: {
      can: [
        "WAV·MP3 파일을 업로드해서 통화에 들려드릴 수 있어요",
        "녹음된 안내 멘트, 음악 등을 자유롭게 재생할 수 있어요",
      ],
      prep: [
        "재생할 WAV 또는 MP3 파일이 준비되어 있어야 해요",
        "풀스트림 통화가 진행 중이어야 해요",
      ],
    },
    module: samplePlayback,
  },
  {
    id: "dtmf-receive",
    title: "6. 🔢 키패드 입력 받기",
    desc: "통화 중에 누른 0~9·*·# 버튼을 화면에 보여드려요. 자동응답의 가장 기본 기능이에요.",
    modes: "any",
    intro: {
      can: [
        "통화 중 누른 키패드 번호를 실시간으로 확인할 수 있어요",
        "어떤 메뉴에서 어떤 키를 눌렀는지 흐름을 관찰할 수 있어요",
      ],
      prep: [
        "통화가 한 통 진행 중이어야 해요",
        "통화 중에 휴대폰·전화기에서 숫자 키를 눌러 보세요",
      ],
    },
    module: dtmfReceive,
  },
  {
    id: "stt-live",
    title: "7. 📝 실시간 자막 (회의 음성 → 글자)",
    desc: "회의에서 오가는 음성을 실시간으로 글자로 바꿔서 자막처럼 보여드려요.",
    modes: "full",
    intro: {
      can: [
        "회의에서 들리는 음성을 실시간 글자(자막)로 변환해서 보여드려요",
        "참여자별로 누가 말했는지 구분할 수 있어요",
      ],
      prep: [
        "회의(ConfBridge) 통화가 진행 중이어야 해요",
        "음성 인식(STT) 키가 게이트웨이에 등록되어 있어야 해요",
      ],
    },
    module: sttLive,
  },
  {
    id: "call-ended",
    title: "8. 📊 끝난 통화 정리하기",
    desc: "통화가 끝나는 순간 통화 시간과 발신/수신 번호를 모아서 보여드려요. CRM 연동의 출발점이에요.",
    modes: "any",
    intro: {
      can: [
        "끝난 통화의 발신·수신 번호와 통화 시간을 모아서 보여드려요",
        "실제 운영에서는 이 지점에서 CRM 업로드·고객 설문 발송 등을 연결해요",
      ],
      prep: [
        "왼쪽에서 서버 연결을 마쳐 주세요",
        "통화가 한 통이라도 끝나야 목록에 표시돼요",
      ],
    },
    module: callEnded,
  },
];

export function getTemplate(id) {
  return templates.find((t) => t.id === id);
}
