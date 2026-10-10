"use strict";
(async function () {
  const OPS = { system_info: "读取系统信息", shell: "运行命令", list_files: "列出文件", read_file: "读取文件", write_file: "写入文件", screenshot: "截图", input: "操作鼠标键盘", open: "打开应用 / 网址", clipboard_read: "读取剪贴板", clipboard_write: "写入剪贴板" };
  const req = await window.chisa.invoke("approval:current");
  if (!req) return window.close();
  document.getElementById("title").textContent = `${req.botName || "机器人"} 想${OPS[req.operation] || req.operation}${req.local ? "（本机强制审批）" : ""}`;
  document.getElementById("summary").textContent = req.summary || "";
  const until = req.expiresAt ? Date.parse(req.expiresAt) : Date.now() + 120000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    document.getElementById("countdown").textContent = `${left} 秒后自动拒绝`;
    if (left <= 0) decide("deny");
  };
  tick();
  setInterval(tick, 1000);
  const decide = (decision) => window.chisa.invoke("approval:decide", { id: req.id, decision });
  document.getElementById("allow").addEventListener("click", () => decide("approve"));
  document.getElementById("deny").addEventListener("click", () => decide("deny"));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") decide("deny"); });
})();
