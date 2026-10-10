"use strict";

(() => {
  const form = document.getElementById("login-form");
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const remember = document.getElementById("remember");
  const toggle = document.getElementById("password-toggle");
  const submit = document.getElementById("login-submit");
  const submitLabel = document.getElementById("submit-label");
  const error = document.getElementById("login-error");
  let submitting = false;

  function safeNext(value) {
    if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin !== window.location.origin || url.pathname === "/login" || url.pathname.startsWith("/auth/")) return "/";
      return url.pathname + url.search + url.hash;
    } catch {
      return "/";
    }
  }

  const next = safeNext(new URLSearchParams(window.location.search).get("next"));

  function setError(message, invalidCredentials = false) {
    error.textContent = message;
    for (const input of [username, password]) {
      if (invalidCredentials) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
    }
  }

  function setBusy(busy) {
    submitting = busy;
    submit.disabled = busy;
    submit.setAttribute("aria-busy", String(busy));
    submitLabel.textContent = busy ? "正在登录" : "登录";
  }

  toggle.addEventListener("click", () => {
    const visible = password.type === "password";
    password.type = visible ? "text" : "password";
    toggle.textContent = visible ? "隐藏" : "显示";
    toggle.setAttribute("aria-label", visible ? "隐藏密码" : "显示密码");
    toggle.setAttribute("aria-pressed", String(visible));
  });

  for (const input of [username, password]) {
    input.addEventListener("input", () => setError(""));
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;
    if (!form.reportValidity()) return;
    setError("");
    setBusy(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ username: username.value.trim(), password: password.value, remember: remember.checked, next }),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (response.ok && data?.ok === true) {
        password.value = "";
        window.location.replace(safeNext(data.next || next));
        return;
      }
      if (response.status === 401) {
        setError("账号或密码不正确，请重新输入。", true);
        password.focus();
        password.select();
      } else if (response.status === 429) {
        setError("登录尝试次数较多，请稍后再试。");
      } else if (response.status === 403) {
        setError("登录请求已失效，请刷新页面后重试。");
      } else {
        setError("暂时无法登录，请稍后重试。");
      }
    } catch (cause) {
      setError(cause?.name === "AbortError" ? "连接超时，请重试。" : "无法连接，请检查网络后重试。");
    } finally {
      window.clearTimeout(timeout);
      setBusy(false);
    }
  });

  // A returning session opens its original workspace without asking for credentials again.
  const sessionController = new AbortController();
  const sessionTimeout = window.setTimeout(() => sessionController.abort(), 8000);
  fetch("/auth/session", {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Accept": "application/json" },
    signal: sessionController.signal,
  })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => {
      if (data?.authenticated === true && !submitting) window.location.replace(next);
    })
    .catch(() => {})
    .finally(() => window.clearTimeout(sessionTimeout));
})();
