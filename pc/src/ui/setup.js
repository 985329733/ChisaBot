"use strict";
(async function () {
  const state = await window.chisa.invoke("state:get");
  const $ = (id) => document.getElementById(id);
  $("server").value = state.serverUrl || "https://ayase.cn:8443";
  $("user").value = state.username || "";
  $("name").value = state.hostname || "";
  (state.username ? $("pass") : $("user")).focus();
  const run = asyncButton($("submit"), { pending: "正在连接…", success: "已连接", error: "连接失败" });
  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("err").classList.remove("show");
    try {
      const result = await run(() =>
        window.chisa.invoke("setup:login", {
          serverUrl: $("server").value,
          username: $("user").value.trim(),
          password: $("pass").value,
          deviceName: $("name").value,
        }),
      );
      $("pass").value = "";
      setTimeout(() => {
        $("form").classList.add("hidden");
        $("done").classList.remove("hidden");
        $("doneText").textContent = `「${result.device.name}」已登记。接下来在设置里按需打开能力。`;
      }, 700);
    } catch (error) {
      $("err").textContent = cleanError(error);
      $("err").classList.add("show");
    }
  });
  $("finish").addEventListener("click", () => window.chisa.invoke("setup:done"));
})();
