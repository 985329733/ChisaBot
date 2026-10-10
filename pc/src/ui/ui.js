"use strict";
/* 本地窗口共用：时间天空、异步按钮状态机（DESIGN.md §2：最少 300ms 进行中、成功 1.5s、失败 2s）、toast。 */
(function () {
  const hour = new Date().getHours();
  document.body.dataset.sky = hour >= 5 && hour < 8 ? "dawn" : hour >= 17 && hour < 20 ? "dusk" : "day";
})();

function asyncButton(button, labels) {
  const idle = button.innerHTML;
  button.dataset.async = "";
  button.dataset.state = "idle";
  button.innerHTML =
    `<span class="s-idle">${idle}</span>` +
    `<span class="s-pending"><i class="spin"></i>${labels.pending}</span>` +
    `<span class="s-success">✓ ${labels.success}</span>` +
    `<span class="s-error">✕ ${labels.error}</span>`;
  return async function run(fn) {
    if (button.dataset.state === "pending") return undefined;
    button.dataset.state = "pending";
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const started = Date.now();
    try {
      const value = await fn();
      await new Promise((r) => setTimeout(r, Math.max(0, 300 - (Date.now() - started))));
      button.dataset.state = "success";
      setTimeout(() => { button.dataset.state = "idle"; button.disabled = false; }, 1500);
      return value;
    } catch (error) {
      await new Promise((r) => setTimeout(r, Math.max(0, 300 - (Date.now() - started))));
      button.dataset.state = "error";
      setTimeout(() => { button.dataset.state = "idle"; button.disabled = false; }, 2000);
      throw error;
    } finally {
      button.removeAttribute("aria-busy");
    }
  };
}

function toast(text) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2600);
}

function cleanError(error) {
  const text = error && error.message ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

function escapeHtml(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
