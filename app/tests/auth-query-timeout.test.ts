import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { currentUserQueryOptions, type AuthenticatedUser } from "../src/lib/auth/queries";

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const deadlines = new Map<number, () => void>();
const clients: QueryClient[] = [];
let nextDeadline = 10_000;

beforeEach(() => {
  deadlines.clear();
  spyOn(globalThis, "setTimeout").mockImplementation(
    ((callback: (...args: unknown[]) => void, delay?: number, ...args: unknown[]) => {
      if (delay !== 15_000) return originalSetTimeout(callback, delay, ...args);
      const id = ++nextDeadline;
      deadlines.set(id, () => callback(...args));
      return id as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
  );
  spyOn(globalThis, "clearTimeout").mockImplementation((timer) => {
    if (deadlines.delete(timer as unknown as number)) return;
    originalClearTimeout(timer as number | undefined);
  });
});

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
  globalThis.fetch = originalFetch;
  mock.restore();
  deadlines.clear();
});

function queryClient() {
  // A global retry default must not double the startup deadline.
  const client = new QueryClient({ defaultOptions: { queries: { retry: 3, gcTime: Infinity } } });
  clients.push(client);
  return client;
}

function expireDeadline() {
  expect(deadlines.size).toBe(1);
  [...deadlines.values()][0]!();
}

test("a stalled login request rejects at its deadline and aborts the transport", async () => {
  let requestSignal: AbortSignal | undefined;
  const fetchMock = mock((_url: unknown, options?: RequestInit) => {
    requestSignal = options?.signal ?? undefined;
    return new Promise<Response>(() => {});
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const result = queryClient().fetchQuery(currentUserQueryOptions()).catch((error: unknown) => error);

  expect(requestSignal).toBeInstanceOf(AbortSignal);
  expireDeadline();
  const error = await result;
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain("登录检查超时");
  expect(requestSignal!.aborted).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(deadlines.size).toBe(0);
});

test("the same deadline covers a response body that never finishes", async () => {
  let requestSignal: AbortSignal | undefined;
  let readingBody = false;
  let notifyBodyStarted!: () => void;
  const bodyStarted = new Promise<void>((resolve) => { notifyBodyStarted = resolve; });
  const response = new Response(null, { status: 200 });
  response.json = () => {
    readingBody = true;
    notifyBodyStarted();
    return new Promise(() => {});
  };
  globalThis.fetch = mock((_url: unknown, options?: RequestInit) => {
    requestSignal = options?.signal ?? undefined;
    return Promise.resolve(response);
  }) as unknown as typeof fetch;
  const result = queryClient().fetchQuery(currentUserQueryOptions()).catch((error: unknown) => error);
  await bodyStarted;

  expect(readingBody).toBe(true);
  expireDeadline();
  const error = await result;
  expect((error as Error).message).toContain("登录检查超时");
  expect(requestSignal!.aborted).toBe(true);
  expect(deadlines.size).toBe(0);
});

test("canceling the query aborts the login request and clears its deadline", async () => {
  let requestSignal: AbortSignal | undefined;
  globalThis.fetch = mock((_url: unknown, options?: RequestInit) => {
    requestSignal = options?.signal ?? undefined;
    return new Promise<Response>(() => {});
  }) as unknown as typeof fetch;
  const client = queryClient();
  const options = currentUserQueryOptions();
  const result = client.fetchQuery(options).catch((error: unknown) => error);

  expect(requestSignal).toBeInstanceOf(AbortSignal);
  expect(deadlines.size).toBe(1);
  await client.cancelQueries({ queryKey: options.queryKey });
  await result;
  await Promise.resolve();
  expect(requestSignal!.aborted).toBe(true);
  expect(requestSignal!.reason.name).toBe("AbortError");
  expect(deadlines.size).toBe(0);
});

test("a signed-in user is returned and releases the startup timer", async () => {
  const user: AuthenticatedUser = { id: "user-1", email: "admin@example.com", name: "Admin", role: "admin", onboarding: null };
  globalThis.fetch = mock(() => Promise.resolve(Response.json({ user }))) as unknown as typeof fetch;

  expect(await queryClient().fetchQuery(currentUserQueryOptions())).toEqual(user);
  expect(deadlines.size).toBe(0);
});

test("an expired login remains a null user and releases the startup timer", async () => {
  globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 401 }))) as unknown as typeof fetch;

  expect(await queryClient().fetchQuery(currentUserQueryOptions())).toBeNull();
  expect(deadlines.size).toBe(0);
});

test("a refused request fails once instead of repeating the entire login check", async () => {
  const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 503 })));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  const options = currentUserQueryOptions();
  expect(options.retry).toBe(false);

  await expect(queryClient().fetchQuery(options)).rejects.toThrow("无法加载当前用户 (503)");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(deadlines.size).toBe(0);
});
