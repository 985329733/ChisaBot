/*
 * 构建时替换 @copilotkit/a2ui-renderer（DESIGN.md §41.4，app/vite.config.ts 的 resolve.alias）。
 *
 * A2UI 早已被 json-render 取代：服务器把 SDK 的 A2UI 永久关掉（server/src/copilot.ts `a2ui: { enabled: false }`），
 * 前端也不传 a2ui 目录，所以 CopilotKit 里 `a2uiActive` 永远是 false，这些导出只被引用、从不执行。
 * 真身约 330KB（未压缩）却一直在首屏包里。万一将来被打开，这里什么都不画，并在控制台说明原因。
 */
import type { ReactNode } from "react";

const warn = () => console.warn("[ChisaBot] A2UI 已停用（被 json-render 取代），这个界面不会显示。");

export const A2UI_SCHEMA_CONTEXT_DESCRIPTION = "A2UI component schemas (disabled in ChisaBot)";
export const DEFAULT_SURFACE_ID = "default";
export const ROOT_COMPONENT_ID = "root";
export const viewerTheme = {};
export const defaultTheme = {};

export class Catalog {}

export function A2UIProvider({ children }: { children?: ReactNode }) {
  return children ?? null;
}
export function A2UIRenderer() {
  warn();
  return null;
}
export function buildCatalogContextValue() {
  return "";
}
export function extractCatalogComponentSchemas() {
  return {};
}
export function filterCatalog<T>(catalog: T) {
  return catalog;
}
export function initializeDefaultCatalog() {}
export function injectStyles() {}
export function useA2UIActions() {
  return { processMessages: () => {}, getSurface: () => undefined };
}
export function useA2UIError() {
  return null;
}
