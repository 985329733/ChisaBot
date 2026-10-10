import type { ConnectVoice } from "./types";
import { connectWebRtc } from "./webrtc";
import { connectWebSocket } from "./websocket";

export function voiceSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export const connectVoice: ConnectVoice = async (options) => {
  if (!voiceSupported())
    throw new Error("语音通话需要支持的浏览器和 HTTPS 或 localhost。");
  const response = await fetch("/api/voice/config", {
    credentials: "include",
    signal: options.signal,
  });
  if (!response.ok) throw new Error("语音通话不可用。请检查部署的语音配置。");
  const config: unknown = await response.json();
  if (config && typeof config === "object" && "transport" in config) {
    if (config.transport === "webrtc") return connectWebRtc(options);
    if (config.transport === "websocket") return connectWebSocket(options);
  }
  throw new Error("此部署使用不受支持的语音连接。");
};
