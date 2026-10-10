"use strict";
(async function () {
  const state = await window.chisa.invoke("state:get");
  const $ = (id) => document.getElementById(id);
  $("server").value = state.serverUrl || "https://ayase.cn:8443";
  $("user").value = state.username || "";
  $("name").value = state.hostname || "";
  (state.username ? $("pass") : $("user")).focus();
  const run = asyncButton($("submit"), { pending: "正在连接…", success: "已连接", error: "连接失败" });
  const fail = (text) => {
    $("err").textContent = text;
    $("err").classList.remove("hidden");
  };
  $("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    $("err").classList.add("hidden");
    if (!$("server").value.trim() || !$("user").value.trim() || !$("pass").value) return fail("请填写服务器地址、账号和密码。");
    try {
      const result = await run(
        () =>
          window.chisa.invoke("setup:login", {
            serverUrl: $("server").value,
            username: $("user").value.trim(),
            password: $("pass").value,
            deviceName: $("name").value,
          }),
        { keepSuccess: true },
      );
      $("pass").value = "";
      setTimeout(() => {
        $("form").classList.add("hidden");
        $("done").classList.remove("hidden");
        $("doneText").textContent = `「${result.device.name}」已登记。接下来会打开它的设备页，在那里按需打开能力、选择允许的文件夹。`;
        $("finish").focus();
      }, 700);
    } catch (error) {
      fail(cleanError(error));
    }
  });
  $("finish").addEventListener("click", () => window.chisa.invoke("setup:done"));
})();
