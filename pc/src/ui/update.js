"use strict";
(async function () {
  const info = await window.chisa.invoke("update:current");
  if (!info) return window.close();
  const $ = (id) => document.getElementById(id);
  $("desc").textContent =
    `ChisaBot PC ${info.version} 已在后台下载并校验完毕（当前 ${info.currentVersion}）。重启后自动安装并重新打开，大约需要十几秒；选「稍后」会在下次退出 ChisaBot PC 时安装。`;
  const run = asyncButton($("restart"), { pending: "正在重启…", success: "正在安装", error: "重启失败" });
  $("restart").addEventListener("click", () => {
    run(() => window.chisa.invoke("update:answer", { restart: true }), { keepSuccess: true }).catch(() => {});
  });
  $("later").addEventListener("click", () => window.chisa.invoke("update:answer", { restart: false }));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") window.chisa.invoke("update:answer", { restart: false });
  });
  $("restart").focus();
})();
