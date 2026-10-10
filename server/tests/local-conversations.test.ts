import { expect, test } from "bun:test";
import { EventType, type BaseEvent } from "@ag-ui/client";
import {
  mergeConversationMessages,
  prepareConversationMessages,
  toLocalHistoryMessage,
} from "../src/local-conversations";

test("tool call arguments and result identifiers survive the history boundary", () => {
  expect(toLocalHistoryMessage({
    id: "assistant-1", role: "assistant", content: "Searching",
    toolCalls: [{ id: "call-1", type: "function", function: { name: "search", arguments: '{"q":"hello"}' } }],
  })).toEqual({
    id: "assistant-1", role: "assistant", content: "Searching",
    toolCalls: [{ id: "call-1", name: "search", args: '{"q":"hello"}' }],
  });
  expect(toLocalHistoryMessage({ id: "result-1", role: "tool", content: "found", toolCallId: "call-1" })).toEqual({
    id: "result-1", role: "tool", content: "found", toolCallId: "call-1",
  });
});

test("a private handoff task executes while its visible summary is the saved input", () => {
  const saved = [{ id: "prior", role: "user" as const, content: "Saved" }];
  const task = { id: "handoff", role: "user" as const, content: "Private report 42" };
  const shown = { id: "handoff", role: "user" as const, content: "Bot joined" };
  const prepared = prepareConversationMessages(saved, [task], [shown]);
  expect(prepared.execution).toEqual([...saved, task]);
  expect(prepared.visible).toEqual([...saved, shown]);
  expect(prepared.project([...saved, task, { id: "answer", role: "assistant", content: "42" }])).toEqual([
    ...saved, shown, { id: "answer", role: "assistant", content: "42" },
  ]);
  const hidden = prepareConversationMessages(saved, [task], []);
  expect(hidden.project([...saved, task, { id: "answer", role: "assistant", content: "42" }])).toEqual([
    ...saved, { id: "answer", role: "assistant", content: "42" },
  ]);
  expect(prepared.event({ type: EventType.MESSAGES_SNAPSHOT, messages: [task, { id: "answer", role: "assistant", content: "42" }] } as BaseEvent)).toEqual({
    type: EventType.MESSAGES_SNAPSHOT, messages: [...saved, shown, { id: "answer", role: "assistant", content: "42" }],
  });
  expect(hidden.sanitize({ nested: { messages: [task] } })).toEqual({ nested: { messages: [] } });
  expect(prepared.event({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: task.id, delta: task.content } as BaseEvent)).toBeUndefined();
  expect(prepared.event({ type: EventType.TOOL_CALL_RESULT, messageId: "fresh-result", toolCallId: "fresh-call", role: "tool", content: "42" } as BaseEvent)).toEqual({
    type: EventType.TOOL_CALL_RESULT, messageId: "fresh-result", toolCallId: "fresh-call", role: "tool", content: "42",
  });
});

test("a caller cannot overwrite canonical history by reusing a message id", () => {
  expect(mergeConversationMessages(
    [{ id: "old", role: "user", content: "Original" }],
    [{ id: "old", role: "user", content: "Changed" }, { id: "new", role: "user", content: "Next" }],
  )).toEqual([
    { id: "old", role: "user", content: "Original" },
    { id: "new", role: "user", content: "Next" },
  ]);
});
