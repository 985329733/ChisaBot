"use strict";
(async function () {
  const OPS = { system_info: "读取系统信息", shell: "运行命令", list_files: "列出文件", read_file: "读取文件", write_file: "写入文件", screenshot: "截图", input: "操作鼠标键盘", open: "打开应用 / 网址", clipboard_read: "读取剪贴板", clipboard_write: "写入剪贴板" };
  const req = await window.chisa.invoke("approval:current");
  if (!req) return window.close();
  const $ = (id) => document.getElementById(id);
  $("title").textContent = `${req.botName || "机器人"} 想${OPS[req.operation] || req.operation}`;
  $("title").title = $("title").textContent;
  if (req.local) {
    $("eyebrow").textContent = "ChisaBot · 高风险操作 · 本机确认";
    $("where").textContent = "只能在这台电脑上处理";
  }
  $("summary").textContent = req.summary || "";
  // 剩余时间：优先用服务器按它自己的时钟算好的 remainingMs（这台电脑的时钟可能不准）；
  // 没有时才看 expiresAt，且只在结果合理时采用，否则按 2 分钟；之后用单调时钟倒数。
  const fallback = 120000;
  let ms = typeof req.remainingMs === "number" ? req.remainingMs : NaN;
  if (!(ms > 0)) {
    const naive = req.expiresAt ? Date.parse(req.expiresAt) - Date.now() : NaN;
    ms = naive > 0 && naive <= fallback ? naive : fallback;
  }
  const deadline = performance.now() + ms;
  let decided = false;
  const decide = (decision) => {
    if (decided) return;
    decided = true;
    window.chisa.invoke("approval:decide", { id: req.id, decision });
  };
  const tick = () => {
    const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    $("countdown").textContent = left > 0 ? `${left} 秒后自动拒绝` : "即将自动拒绝";
    if (left <= 0) decide("deny");
  };
  tick();
  setInterval(tick, 1000);
  $("allow").addEventListener("click", () => decide("approve"));
  $("deny").addEventListener("click", () => decide("deny"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") decide("deny");
  });
  $("deny").focus();
})();
