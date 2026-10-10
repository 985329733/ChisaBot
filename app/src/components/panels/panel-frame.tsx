import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/components/theme-provider";
import type { Json, PanelDefinition } from "@/lib/panels/api";

/**
 * A panel's runtime: its validated HTML and CSS, and its script, inside a sandboxed iframe.
 *
 * The frame has an opaque origin (`sandbox="allow-scripts"` without `allow-same-origin`) and a CSP
 * of `default-src 'none'`, so the panel script can reach neither the app's cookies, its DOM, nor
 * the network. Its only way out is `postMessage` to this component, which proxies the four bridge
 * calls the authoring contract allows (`panel.state.read/write`, `panel.data.read`,
 * `panel.tasks.request`) to the panels API, where the server checks grants and schemas again.
 */
export type PanelFrameBridge = {
  stateRead(signal?: AbortSignal): Promise<Json>;
  stateWrite(value: Json, signal?: AbortSignal): Promise<void>;
  dataRead(capabilityId: string, args: Json, signal?: AbortSignal): Promise<Json>;
  taskRequest(
    capabilityId: string,
    args: Json,
    signal?: AbortSignal,
  ): Promise<{ requestId: string }>;
};

const RUNTIME = String.raw`
(function(){
  var parentWin = window.parent, seq = 0, pending = {}, handlers = {}, token = document.documentElement.getAttribute('data-token');
  function post(msg){ msg.token = token; parentWin.postMessage(msg, '*'); }
  function request(method, args){
    return new Promise(function(resolve, reject){
      var id = ++seq; pending[id] = {resolve: resolve, reject: reject};
      post({kind: 'request', id: id, method: method, args: args === undefined ? null : args});
    });
  }
  window.addEventListener('message', function(e){
    if (e.source !== parentWin) return;
    var m = e.data || {};
    if (m.token !== token || m.kind !== 'response') return;
    var p = pending[m.id]; if (!p) return; delete pending[m.id];
    if (m.ok) p.resolve(m.value); else p.reject(new Error(m.error || 'bridge_error'));
  });
  function findNode(id){
    if (!id) return null;
    return document.querySelector('[data-node="' + CSS.escape(id) + '"]') || document.getElementById(id);
  }
  var SVG = 'http://www.w3.org/2000/svg', svgTags = {svg:1,g:1,path:1,rect:1,circle:1,ellipse:1,line:1,polyline:1,polygon:1,text:1,tspan:1,defs:1,lineargradient:1,radialgradient:1,stop:1};
  function build(node, inSvg){
    var tag = String(node.tag || 'div').toLowerCase();
    var svg = inSvg || tag === 'svg';
    var el = svg && svgTags[tag] ? document.createElementNS(SVG, tag === 'lineargradient' ? 'linearGradient' : tag === 'radialgradient' ? 'radialGradient' : tag) : document.createElement(tag);
    var attrs = node.attrs || {};
    for (var k in attrs) { if (!/^on/i.test(k)) el.setAttribute(k, String(attrs[k])); }
    if (node.id && !el.getAttribute('data-node')) el.setAttribute('data-node', node.id);
    if (typeof node.text === 'string') el.textContent = node.text;
    (node.children || []).forEach(function(c){ el.appendChild(build(c, svg)); });
    return el;
  }
  function patch(list){
    if (!Array.isArray(list)) list = [list];
    list.forEach(function(p){
      if (!p) return;
      var el = findNode(p.node); if (!el) return;
      if (typeof p.text === 'string') el.textContent = p.text;
      if (p.attrs) for (var k in p.attrs) {
        if (/^on/i.test(k)) continue;
        var v = p.attrs[k];
        if (v === null || v === false) el.removeAttribute(k);
        else { el.setAttribute(k, String(v)); if (k === 'value' && 'value' in el) el.value = String(v); if (k === 'checked' && 'checked' in el) el.checked = v !== 'false'; }
      }
      if (Array.isArray(p.children)) {
        while (el.firstChild) el.removeChild(el.firstChild);
        p.children.forEach(function(c){ el.appendChild(build(c, el instanceof SVGElement)); });
      }
    });
  }
  function formValues(form){
    var out = {};
    if (!form) return out;
    Array.prototype.forEach.call(form.elements, function(f){
      if (!f.name) return;
      if (f.type === 'checkbox') out[f.name] = !!f.checked;
      else if (f.type === 'radio') { if (f.checked) out[f.name] = f.value; }
      else out[f.name] = f.value;
    });
    return out;
  }
  function dispatch(type, target, ev){
    var el = target && target.closest ? target.closest('[data-action]') : null;
    if (!el) return;
    var action = el.getAttribute('data-action');
    var h = handlers[action]; if (!h) return;
    if (type === 'submit' || (el.tagName === 'BUTTON' && el.type === 'submit')) ev.preventDefault();
    var form = el.tagName === 'FORM' ? el : el.closest('form');
    var event = {type: type, actionId: action, nodeId: el.getAttribute('data-node') || el.id || null,
      value: 'value' in el ? el.value : null, checked: 'checked' in el ? !!el.checked : null, form: formValues(form)};
    Promise.resolve().then(function(){ return h(event); }).catch(function(err){ post({kind:'error', error: String(err && err.message || err)}); });
  }
  document.addEventListener('click', function(e){ var t = e.target.closest && e.target.closest('[data-action]'); if (!t) return; if (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.tagName === 'FORM') return; dispatch('click', e.target, e); });
  document.addEventListener('input', function(e){ dispatch('input', e.target, e); });
  document.addEventListener('change', function(e){ dispatch('change', e.target, e); });
  document.addEventListener('submit', function(e){ e.preventDefault(); dispatch('submit', e.target, e); });
  var panel = Object.freeze({
    on: function(action, fn){ if (typeof action === 'string' && typeof fn === 'function') handlers[action] = fn; },
    ui: Object.freeze({ patch: patch }),
    state: Object.freeze({ read: function(){ return request('state.read'); }, write: function(v){ return request('state.write', v); } }),
    data: Object.freeze({ read: function(id, args){ return request('data.read', {capabilityId: id, args: args === undefined ? {} : args}); } }),
    tasks: Object.freeze({ request: function(id, args){ return request('tasks.request', {actionId: id, args: args === undefined ? {} : args}); } })
  });
  function report(){ post({kind: 'height', height: Math.ceil(document.documentElement.scrollHeight)}); }
  new ResizeObserver(report).observe(document.body);
  report();
  try {
    var src = document.getElementById('panel-script').textContent;
    var fn = new Function('panel', '"use strict";\n' + src);
    var r = fn(panel);
    if (r && typeof r.then === 'function') r.catch(function(err){ post({kind:'error', error: String(err && err.message || err)}); });
  } catch (err) { post({kind: 'error', error: String(err && err.message || err)}); }
  post({kind: 'ready'});
})();
`;

const BASE_CSS = `
:root{font-family:"PingFang SC","HarmonyOS Sans SC","MiSans","Noto Sans SC","Noto Sans CJK SC","Source Han Sans SC","Microsoft YaHei UI",system-ui,sans-serif;font-size:13px;line-height:1.5;color:#111a2b}
html[data-theme=dark]{color:#e9eef8}
html[data-theme=dark] input,html[data-theme=dark] select,html[data-theme=dark] textarea{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.14);color:inherit}
html[data-theme=dark] button{background:#e9eff9;color:#0e1628}
html,body{margin:0;padding:0;background:transparent}
body{padding:2px 0;overflow:hidden}
button{font:inherit;cursor:pointer;border:0;border-radius:999px;padding:6px 12px;background:#15203a;color:#fff}
input,select,textarea{font:inherit;border:1px solid rgba(22,24,29,.12);border-radius:10px;padding:6px 10px;background:rgba(255,255,255,.7)}
table{border-collapse:collapse;width:100%}
td,th{padding:4px 6px;text-align:left}
`;

function escapeScript(text: string) {
  return text.replace(/<\/(script)/gi, "<\\/$1").replace(/<!--/g, "<\\!--");
}

function escapeStyle(text: string) {
  return text.replace(/<\/(style)/gi, "<\\/$1");
}

export function buildPanelDocument(
  definition: PanelDefinition,
  token: string,
  dark = false,
) {
  // The frame's colour scheme must match the app's, or the browser paints an opaque canvas behind
  // a transparent frame (a light frame inside a dark page shows as a white box).
  const scheme = dark ? "dark" : "light";
  return `<!doctype html><html data-token="${token}" data-theme="${scheme}" style="color-scheme:${scheme}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline' 'unsafe-eval'; img-src data:; font-src data:">
<style>${BASE_CSS}</style><style>${escapeStyle(definition.css)}</style></head>
<body><div id="panel-root">${definition.html}</div>
<script type="text/plain" id="panel-script">${escapeScript(definition.script)}</script>
<script>${RUNTIME}</script></body></html>`;
}

export function PanelFrame({
  definition,
  bridge,
  active = true,
  onError,
  minHeight = 60,
}: {
  definition: PanelDefinition;
  bridge: PanelFrameBridge;
  active?: boolean;
  onError?: (message: string) => void;
  minHeight?: number;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const { dark } = useTheme();
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new document (and token) per definition or theme.
  const token = useMemo(() => crypto.randomUUID(), [definition, dark]);
  const doc = useMemo(
    () => buildPanelDocument(definition, token, dark),
    [definition, token, dark],
  );
  const fixed =
    definition.size.height === "auto" ? null : definition.size.height;
  const [height, setHeight] = useState<number>(fixed ?? 120);
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const errorRef = useRef(onError);
  errorRef.current = onError;

  useEffect(() => {
    if (!active) return;
    const controllers = new Set<AbortController>();
    const onMessage = async (event: MessageEvent) => {
      const frame = ref.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const message = event.data as {
        token?: string;
        kind?: string;
        id?: number;
        method?: string;
        args?: Json;
        height?: number;
        error?: string;
      };
      if (!message || message.token !== token) return;
      if (message.kind === "height" && typeof message.height === "number") {
        if (fixed === null)
          setHeight(Math.max(minHeight, Math.min(1600, message.height)));
        return;
      }
      if (message.kind === "error") {
        errorRef.current?.(message.error ?? "面板脚本出错");
        return;
      }
      if (message.kind !== "request" || typeof message.id !== "number") return;
      const reply = (ok: boolean, value?: unknown, error?: string) =>
        frame.contentWindow?.postMessage(
          { token, kind: "response", id: message.id, ok, value, error },
          "*",
        );
      const controller = new AbortController();
      controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const b = bridgeRef.current;
        const args = (message.args ?? {}) as Record<string, Json>;
        let value: unknown = null;
        if (message.method === "state.read")
          value = await b.stateRead(controller.signal);
        else if (message.method === "state.write")
          await b.stateWrite(message.args ?? null, controller.signal);
        else if (message.method === "data.read")
          value = await b.dataRead(
            String(args.capabilityId),
            args.args ?? {},
            controller.signal,
          );
        else if (message.method === "tasks.request")
          value = await b.taskRequest(
            String(args.actionId),
            args.args ?? {},
            controller.signal,
          );
        else throw new Error("unknown_bridge_method");
        reply(true, value === undefined ? null : value);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        reply(false, undefined, text);
      } finally {
        clearTimeout(timer);
        controllers.delete(controller);
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      for (const c of controllers) c.abort();
    };
  }, [token, active, fixed, minHeight]);

  if (!active) {
    return (
      <div
        className="grid place-items-center text-xs text-muted-foreground"
        style={{ height: Math.min(height, 120) }}
      >
        {"面板已暂停"}
      </div>
    );
  }

  return (
    <iframe
      ref={ref}
      title={definition.name}
      sandbox="allow-scripts"
      srcDoc={doc}
      className="block w-full border-0 bg-transparent"
      style={{ height, colorScheme: dark ? "dark" : "light" }}
    />
  );
}

/** Preview runs only the definition's sample state and refuses data and tasks. */
export function previewBridge(initial: Json): PanelFrameBridge {
  let state: Json = structuredClone(initial);
  return {
    stateRead: async () => structuredClone(state),
    stateWrite: async (value) => {
      state = structuredClone(value);
    },
    dataRead: async () => {
      throw new Error("preview_sample_only");
    },
    taskRequest: async () => {
      throw new Error("preview_sample_only");
    },
  };
}
