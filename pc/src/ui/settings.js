"use strict";
(function () {
  const CAPS = [
    ["shell", "命令行", "运行 PowerShell 命令（有超时和输出上限）。", true],
    ["files_read", "读取文件", "列出和读取允许的文件夹里的文件。", false],
    ["files_write", "写入文件", "在允许的文件夹里新建或修改文件，覆盖前自动备份。", true],
    ["screenshot", "截图", "截取屏幕画面发给机器人。", false],
    ["input", "鼠标键盘", "移动鼠标、点击、输入文字和按键。", true],
    ["open", "打开应用 / 网址", "用默认浏览器打开网址，或启动程序。", false],
    ["clipboard", "剪贴板", "读取或写入剪贴板文字。", false],
  ];
  const POL = [["off", "关闭"], ["ask", "询问"], ["allow", "允许"]];
  const $ = (id) => document.getElementById(id);
  let state = null;

  document.querySelectorAll(".tabs button").forEach((tab) =>
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tabs button").forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      document.querySelectorAll("[data-panel]").forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== tab.dataset.tab));
      if (tab.dataset.tab === "audit") loadAudit();
    }),
  );

  async function call(channel, payload) {
    try {
      state = await window.chisa.invoke(channel, payload);
      render();
    } catch (error) {
      toast(cleanError(error));
    }
  }

  function render() {
    if (!state) return;
    const device = state.device;
    const offline = state.agentState !== "online";
    $("ver").textContent = `v${state.version}`;
    $("devName").textContent = device?.name || state.hostname;
    const st = $("status");
    st.className = `badge ${state.status === "online" ? "ok" : state.status === "paused" ? "danger" : ""}`;
    st.innerHTML = `<i class="dot"></i>${escapeHtml(state.statusText)}`;
    $("server").textContent = state.serverUrl || "未设置服务器";
    $("server2").textContent = state.serverUrl || "—";
    $("user").textContent = state.username || "—";
    $("tokenInfo").textContent = state.loggedIn ? (state.tokenProtected ? "已用 Windows 数据保护（DPAPI）加密保存在本机" : "已保存在本机（系统加密不可用）") : "未登录";
    const paused = state.local.localPaused;
    $("killbar").classList.toggle("show", paused);
    $("kill").classList.toggle("hidden", paused);
    $("autoStart").setAttribute("aria-checked", String(state.local.autoStart));
    $("forceLocal").setAttribute("aria-checked", String(state.local.forceLocalApproval));
    if (document.activeElement !== $("nameInput")) $("nameInput").value = device?.name || "";
    const caps = device?.capabilities || {};
    $("caps").innerHTML = CAPS.map(
      ([key, label, desc, danger]) =>
        `<div class="row wrapable"><div class="grow"><div class="t">${label}${danger ? ' <span class="badge warn" style="height:20px;font-size:11px">高风险</span>' : ""}</div><div class="s">${desc}</div></div>` +
        `<div class="ctl"><div class="seg" role="radiogroup" aria-label="${label}">${POL.map(([v, l]) => `<button type="button" role="radio" class="${v}" data-cap="${key}" data-pol="${v}" aria-checked="${(caps[key] || "off") === v}" ${offline ? "disabled" : ""}>${l}</button>`).join("")}</div></div></div>`,
    ).join("");
    const roots = device?.allowedRoots || [];
    $("roots").innerHTML = roots.length
      ? roots.map((r) => `<div class="row"><span class="ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span><span class="grow mono">${escapeHtml(r)}</span><button class="btn sm ghost" type="button" data-root="${escapeHtml(r)}" ${offline ? "disabled" : ""}>移除</button></div>`).join("")
      : `<div class="empty">还没有允许的文件夹。</div>`;
    $("addRoot").disabled = offline;
  }

  $("caps").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-cap]");
    if (button && !button.disabled) call("cap:set", { capability: button.dataset.cap, policy: button.dataset.pol });
  });
  $("roots").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-root]");
    if (button) call("roots:remove", button.dataset.root);
  });
  $("addRoot").addEventListener("click", () => call("roots:add"));
  $("kill").addEventListener("click", () => call("paused:set", true));
  $("unkill").addEventListener("click", () => call("paused:set", false));
  $("autoStart").addEventListener("click", () => call("local:set", { autoStart: !state.local.autoStart }));
  $("forceLocal").addEventListener("click", () => call("local:set", { forceLocalApproval: !state.local.forceLocalApproval }));
  $("openWeb").addEventListener("click", () => window.chisa.invoke("web:devices"));
  const renameRun = asyncButton($("rename"), { pending: "保存中…", success: "已保存", error: "保存失败" });
  $("rename").addEventListener("click", () => renameRun(async () => { state = await window.chisa.invoke("device:rename", $("nameInput").value); render(); }).catch((e) => toast(cleanError(e))));
  const logoutRun = asyncButton($("logout"), { pending: "退出中…", success: "已退出", error: "退出失败" });
  $("logout").addEventListener("click", () => {
    if (!window.confirm("退出登录会作废这台电脑的设备令牌并断开连接，确定吗？")) return;
    logoutRun(() => window.chisa.invoke("account:logout")).catch((e) => toast(cleanError(e)));
  });

  const OUT = { succeeded: ["成功", "ok"], failed: ["失败", "danger"], approved_local: ["本机批准", "ok"], denied_local: ["本机拒绝", "warn"] };
  async function loadAudit() {
    const entries = await window.chisa.invoke("audit:get");
    $("audit").innerHTML = entries.length
      ? entries
          .map((e) => {
            const [text, tone] = OUT[e.outcome] || [e.outcome, ""];
            return `<div class="row"><time>${new Date(e.at).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time><div class="grow"><div class="t">${escapeHtml(e.actor || "")} · ${escapeHtml(e.operation || "")}</div><div class="s mono">${escapeHtml(e.summary || "")}${e.detail ? ` — ${escapeHtml(e.detail)}` : ""}</div></div><span class="badge ${tone}">${escapeHtml(text)}</span></div>`;
          })
          .join("")
      : `<div class="empty">还没有远程操作。</div>`;
  }

  async function refresh(kind) {
    state = await window.chisa.invoke("state:get");
    render();
    if (kind === "audit" && !document.querySelector('[data-panel="audit"]').classList.contains("hidden")) loadAudit();
  }
  window.chisa.onState(refresh);
  refresh();
  setInterval(refresh, 5000);
})();
