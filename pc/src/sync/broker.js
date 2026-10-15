"use strict";
/**
 * 电脑同步的本机中转（P4b）：主进程里一个只听 127.0.0.1 的小服务，给 ssh 的 ProxyCommand（tunnel.js --broker）用。
 * 每条连接第一行是「<口令> <工作区>」：口令对上（每次启动随机生成，只在 Mutagen / git 子进程的环境变量里）才用设备令牌
 * 换一次性隧道票、开 WSS /api/devices/agent/sync-tunnel，然后两边字节直接对接。设备令牌一直留在主进程里，不落盘、不进命令行。
 */
const net = require("node:net");
const crypto = require("node:crypto");
const { PassThrough } = require("node:stream");
const { pipeTunnel } = require("./tunnel");

const ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * @param {{ serverUrl: () => string, getToken: () => string | null, allow: (workspaceId: string) => boolean,
 *           WebSocket?: any, fetchImpl?: any, log?: (s: string) => void }} options
 */
function createBroker(options) {
  const log = options.log || (() => {});
  const secret = crypto.randomBytes(24).toString("base64url");
  const live = new Set();
  let server = null;
  let port = 0;

  function onConnection(sock) {
    live.add(sock);
    sock.on("close", () => live.delete(sock));
    sock.setNoDelay(true);
    let head = Buffer.alloc(0);
    const timer = setTimeout(() => sock.destroy(), 10_000);
    const onData = (chunk) => {
      head = Buffer.concat([head, chunk]);
      const nl = head.indexOf(10);
      if (nl < 0) {
        if (head.length > 256) sock.destroy();
        return;
      }
      clearTimeout(timer);
      sock.removeListener("data", onData);
      sock.pause();
      const [given, workspaceId] = head.subarray(0, nl).toString("utf8").trim().split(" ");
      const rest = head.subarray(nl + 1);
      const ok = given && given.length === secret.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret));
      if (!ok || !ID.test(String(workspaceId)) || !options.allow(workspaceId)) {
        log("中转：口令或工作区不对，断开");
        sock.destroy();
        return;
      }
      const token = options.getToken();
      if (!token) {
        sock.destroy();
        return;
      }
      const input = new PassThrough();
      if (rest.length) input.write(rest);
      sock.pipe(input);
      sock.resume();
      pipeTunnel({ server: options.serverUrl(), token, workspaceId, input, output: sock, WebSocket: options.WebSocket, fetchImpl: options.fetchImpl, log })
        .catch((e) => log(`中转：${e.message}`))
        .finally(() => sock.destroy());
    };
    sock.on("data", onData);
    sock.on("error", () => {});
  }

  return {
    secret,
    async start() {
      if (server) return port;
      server = net.createServer(onConnection);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      port = server.address().port;
      return port;
    },
    port: () => port,
    address: () => `127.0.0.1:${port}`,
    stop() {
      for (const s of live) s.destroy();
      live.clear();
      try {
        server && server.close();
      } catch {}
      server = null;
    },
  };
}

module.exports = { createBroker };
