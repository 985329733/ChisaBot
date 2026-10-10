import { expect, test } from "bun:test";
import {
  modelSettingsInput,
  modelSettingsValidation,
} from "@/lib/model-settings/form";

const current = {
  provider: "openai" as const,
  model: "current-model",
  baseUrl: "https://models.example.test/v1",
  useApiKey: true,
  hasApiKey: true,
  source: "environment" as const,
};

test.each(["openai", "anthropic"] as const)(
  "the official Step Plan %s base shares the canonical address without re-entering its key",
  (provider) => {
    const saved = {
      ...current,
      provider,
      model: "step-5-preview",
      baseUrl: "https://api.stepfun.com/step_plan",
    };
    const draft = {
      ...saved,
      baseUrl: "https://api.stepfun.com/step_plan/v1",
      apiKey: "",
    };
    expect(modelSettingsValidation(draft, saved)).toEqual({});
    expect(
      modelSettingsValidation(
        { ...draft, baseUrl: saved.baseUrl },
        { ...saved, baseUrl: draft.baseUrl },
      ),
    ).toEqual({});
    expect(
      modelSettingsInput({ ...draft, baseUrl: `${saved.baseUrl}/` }).baseUrl,
    ).toBe(draft.baseUrl);
    expect(
      modelSettingsValidation(
        { ...draft, baseUrl: "https://api.stepfun.ai/step_plan" },
        saved,
      ).apiKey,
    ).toBeTruthy();
    expect(
      modelSettingsValidation(
        { ...draft, baseUrl: "https://api.stepfun.com/custom" },
        saved,
      ).apiKey,
    ).toBeTruthy();
  },
);

test("leaving the key blank preserves it without sending an empty secret", () => {
  expect(
    modelSettingsInput({ ...current, model: "next-model", apiKey: "  " }),
  ).toEqual({
    provider: "openai",
    model: "next-model",
    baseUrl: "https://models.example.test/v1",
    useApiKey: true,
  });
});

test("a changed destination requires its own key instead of forwarding the current one", () => {
  const errors = modelSettingsValidation(
    { ...current, baseUrl: "https://other.example.test/v1", apiKey: "" },
    current,
  );
  expect(errors.apiKey).toBeTruthy();
  expect(
    modelSettingsValidation(
      { ...current, provider: "anthropic", apiKey: "" },
      current,
    ).apiKey,
  ).toBeTruthy();
});

test("an explicitly unauthenticated local endpoint needs no key", () => {
  expect(
    modelSettingsValidation(
      {
        ...current,
        baseUrl: "http://localhost:11434/v1",
        useApiKey: false,
        apiKey: "",
      },
      current,
    ),
  ).toEqual({});
});

test("disabling authentication omits a previously typed key", () => {
  expect(
    modelSettingsInput({ ...current, useApiKey: false, apiKey: "unused-key" })
      .apiKey,
  ).toBeUndefined();
});

test("a missing deployment key requires a new key before submitting", () => {
  expect(
    modelSettingsValidation(
      { ...current, apiKey: "" },
      { ...current, hasApiKey: false },
    ).apiKey,
  ).toBeTruthy();
});

test("the same normalized endpoint keeps its existing key", () => {
  expect(
    modelSettingsValidation(
      { ...current, baseUrl: "https://models.example.test/", apiKey: "" },
      current,
    ),
  ).toEqual({});
});

test.each([
  ["", "model"],
  ["file:///etc/config", "baseUrl"],
  ["https://user:secret@models.example.test/v1", "baseUrl"],
  ["https://models.example.test/v1?key=secret", "baseUrl"],
  ["https://models.example.test/v1#secret", "baseUrl"],
])("rejects incomplete or unsafe fields: %s", (value, field) => {
  expect(
    modelSettingsValidation(
      { ...current, [field]: value, apiKey: "" },
      current,
    )[field as "model" | "baseUrl"],
  ).toBeTruthy();
});
