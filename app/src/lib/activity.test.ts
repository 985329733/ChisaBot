import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterEach, expect, test } from "bun:test";
import { refreshWouldInterrupt, setBusy } from "./activity";

// The full app tree preloads a DOM (app/tests/preload.ts); this subset may not, so register one here.
if (typeof document === "undefined") GlobalRegistrator.register();

afterEach(() => {
  document.body.innerHTML = "";
  setBusy("t", false);
});

test("refresh is safe on an idle page", () => {
  document.body.innerHTML = '<textarea></textarea><div contenteditable="true">  </div>';
  expect(refreshWouldInterrupt()).toBeNull();
});

test("a running reply or unsent text holds the refresh", () => {
  setBusy("t", true);
  expect(refreshWouldInterrupt()).toBe("running");
  setBusy("t", false);
  document.body.innerHTML = '<div contenteditable="true">还没发的话</div>';
  expect(refreshWouldInterrupt()).toBe("typing");
  document.body.innerHTML = "<textarea>草稿</textarea>";
  expect(refreshWouldInterrupt()).toBe("typing");
});
