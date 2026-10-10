"use strict";
const { contextBridge, ipcRenderer } = require("electron");

const CHANNELS = new Set([
  "state:get",
  "setup:login",
  "setup:done",
  "cap:set",
  "roots:add",
  "roots:remove",
  "device:rename",
  "paused:set",
  "local:set",
  "audit:get",
  "chat:open",
  "web:devices",
  "account:logout",
  "approval:current",
  "approval:decide",
]);

contextBridge.exposeInMainWorld("chisa", {
  invoke(channel, payload) {
    if (!CHANNELS.has(channel)) return Promise.reject(new Error(`未知操作 ${channel}`));
    return ipcRenderer.invoke(channel, payload);
  },
  onState(callback) {
    const listener = (_event, kind) => callback(kind);
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  },
});
