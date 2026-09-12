import { describe, expect, test } from "bun:test";
import type { Signer } from "./custody";
import { RelayClient } from "./relay";

const RELAY_URL = "wss://relay.example.com/relay/family";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  listeners: Record<string, ((event: unknown) => void)[]> = {};
  sent: unknown[] = [];
  closed = false;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    (this.listeners[type] ??= []).push(listener);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== listener);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.closed = true;
    this.emit("close", {});
  }

  emit(type: string, event: unknown): void {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  emitMessage(payload: unknown[]): void {
    this.emit("message", { data: JSON.stringify(payload) });
  }

  lastSent(type: string): unknown[] {
    return [...this.sent].reverse().find((m) => (m as unknown[])[0] === type) as unknown[];
  }
}

function fakeSigner(pubkey = "a".repeat(64)): Signer {
  return {
    async getPublicKey() {
      return pubkey;
    },
    async signEvent(template) {
      return { ...template, id: `sig-${Math.random()}`, pubkey, sig: "s" } as never;
    },
    async nip44Encrypt() {
      throw new Error("not used in these tests");
    },
    async nip44Decrypt() {
      throw new Error("not used in these tests");
    },
  };
}

async function authenticate(ws: FakeWebSocket, challenge: string): Promise<void> {
  ws.emitMessage(["AUTH", challenge]);
  await Promise.resolve();
  await Promise.resolve();
  const authEvent = ws.lastSent("AUTH")[1] as { id: string };
  ws.emitMessage(["OK", authEvent.id, true, ""]);
  await Promise.resolve();
}

function newClient(): RelayClient {
  FakeWebSocket.instances = [];
  return new RelayClient(RELAY_URL, fakeSigner(), {
    wsFactory: (url) => new FakeWebSocket(url) as unknown as WebSocket,
    reconnectDelayMs: 0,
  });
}

async function connectedClient(): Promise<{ client: RelayClient; ws: FakeWebSocket }> {
  const client = newClient();
  const connectPromise = client.connect();
  const ws = FakeWebSocket.instances[0]!;
  await authenticate(ws, "challenge1");
  await connectPromise;
  return { client, ws };
}

describe("RelayClient.connect", () => {
  test("completes the NIP-42 handshake and reports state open", async () => {
    const { client } = await connectedClient();
    expect(client.state).toBe("open");
  });
});

describe("RelayClient.subscribe", () => {
  test("sends a REQ and forwards matching EVENT/EOSE frames", async () => {
    const { client, ws } = await connectedClient();
    const events: unknown[] = [];
    let eosed = false;

    client.subscribe([{ kinds: [9] }], {
      onEvent: (e) => events.push(e),
      onEose: () => (eosed = true),
    });

    const reqMessage = ws.lastSent("REQ");
    const subId = reqMessage[1] as string;

    ws.emitMessage(["EVENT", subId, { id: "e1", kind: 9 }]);
    ws.emitMessage(["EOSE", subId]);

    expect(events).toEqual([{ id: "e1", kind: 9 }]);
    expect(eosed).toBe(true);
  });

  test("unsubscribe sends CLOSE and stops forwarding events", async () => {
    const { client, ws } = await connectedClient();
    const events: unknown[] = [];

    const unsubscribe = client.subscribe([{ kinds: [9] }], { onEvent: (e) => events.push(e) });
    const subId = ws.lastSent("REQ")[1] as string;
    unsubscribe();

    const closeMessage = ws.lastSent("CLOSE");
    expect(closeMessage).toEqual(["CLOSE", subId]);

    ws.emitMessage(["EVENT", subId, { id: "e1", kind: 9 }]);
    expect(events).toEqual([]);
  });

  test("update re-issues the REQ under the same subscription id", async () => {
    const { client, ws } = await connectedClient();
    const events: unknown[] = [];

    const subscription = client.subscribe([{ kinds: [0], authors: ["a"] }], {
      onEvent: (e) => events.push(e),
    });
    const subId = ws.lastSent("REQ")[1] as string;

    subscription.update([{ kinds: [0], authors: ["a", "b"] }]);

    // NIP-01: a REQ with an id already open replaces that subscription, so the wider
    // filter costs no extra subscription slot and leaves no gap needing a CLOSE.
    expect(ws.lastSent("REQ")).toEqual(["REQ", subId, { kinds: [0], authors: ["a", "b"] }]);
    expect(ws.sent.filter((m) => (m as unknown[])[0] === "REQ")).toHaveLength(2);
    expect(ws.sent.some((m) => (m as unknown[])[0] === "CLOSE")).toBe(false);

    ws.emitMessage(["EVENT", subId, { id: "e1", kind: 0 }]);
    expect(events).toEqual([{ id: "e1", kind: 0 }]);
  });

  test("a CLOSED frame reaches the subscription's handlers instead of being dropped", async () => {
    const { client, ws } = await connectedClient();
    const events: unknown[] = [];
    const closed: string[] = [];

    client.subscribe([{ kinds: [9] }], {
      onEvent: (e) => events.push(e),
      onClosed: (reason) => closed.push(reason),
    });
    const subId = ws.lastSent("REQ")[1] as string;

    ws.emitMessage(["CLOSED", subId, "restricted: not a member of this workspace"]);

    expect(closed).toEqual(["restricted: not a member of this workspace"]);

    // The relay ended it: nothing more belongs to this id.
    ws.emitMessage(["EVENT", subId, { id: "e1", kind: 9 }]);
    expect(events).toEqual([]);
  });

  test("unsubscribing before the connection ever opens does not throw", () => {
    // Regression: two React state updates that used to land in the same batch (and so ran this
    // effect's subscribe/unsubscribe/resubscribe only once, after the socket was already open)
    // landing in separate renders instead — subscribe() then immediately unsubscribe() while
    // still CONNECTING crashed the app (WebSocket.send() throws InvalidStateError on a socket
    // that isn't open yet; see AppShell.tsx's channels effect).
    const client = newClient();
    client.connect().catch(() => {});
    const ws = FakeWebSocket.instances[0]!;

    const unsubscribe = client.subscribe([{ kinds: [9] }], { onEvent: () => {} });
    expect(unsubscribe).not.toThrow();
    expect(ws.sent).toEqual([]);
  });
});

describe("RelayClient.publish", () => {
  test("sends immediately when already open", async () => {
    const { client, ws } = await connectedClient();

    const publishPromise = client.publish({ id: "m1" } as never);
    await Promise.resolve();
    await Promise.resolve();
    ws.emitMessage(["OK", "m1", true, ""]);
    await publishPromise;

    expect(ws.lastSent("EVENT")).toEqual(["EVENT", { id: "m1" }]);
  });

  test("waits out a reconnect instead of failing on a stale socket", async () => {
    const { client, ws } = await connectedClient();

    ws.close(); // drops to "reconnecting"; this.ws is now the dead socket
    expect(client.state).toBe("reconnecting");

    const publishPromise = client.publish({ id: "m1" } as never);
    await new Promise((r) => setTimeout(r, 0));

    const newWs = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    await authenticate(newWs, "challengeC");
    await Promise.resolve();
    expect(client.state).toBe("open");

    newWs.emitMessage(["OK", "m1", true, ""]);
    await publishPromise;

    expect(newWs.lastSent("EVENT")).toEqual(["EVENT", { id: "m1" }]);
  });
});

describe("RelayClient reconnection", () => {
  test("on close, reconnects and re-issues active subscriptions", async () => {
    const { client, ws } = await connectedClient();
    client.subscribe([{ kinds: [9] }], { onEvent: () => {} });
    const states: string[] = [];
    client.onStateChange((s) => states.push(s));

    ws.close();
    expect(client.state).toBe("reconnecting");
    await new Promise((r) => setTimeout(r, 0));

    const newWs = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    expect(newWs).not.toBe(ws);
    await authenticate(newWs, "challenge2");
    await Promise.resolve();

    expect(client.state).toBe("open");
    expect(newWs.lastSent("REQ")).toBeDefined();
    expect(states).toEqual(["reconnecting", "open"]);
  });

  test("backs off exponentially on repeated failures, resetting after success", async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return originalSetTimeout(fn, 0);
    }) as typeof setTimeout;

    try {
      FakeWebSocket.instances = [];
      const client = new RelayClient(RELAY_URL, fakeSigner(), {
        wsFactory: (url) => new FakeWebSocket(url) as unknown as WebSocket,
        reconnectDelayMs: 100,
        maxReconnectDelayMs: 1000,
      });
      const connectPromise = client.connect();
      const ws1 = FakeWebSocket.instances[0]!;
      await authenticate(ws1, "challengeA");
      await connectPromise;

      ws1.close(); // 1st failure: attempt 0 -> 100ms
      await new Promise((r) => originalSetTimeout(r, 0));
      const ws2 = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
      ws2.close(); // 2nd failure before re-auth: attempt 1 -> 200ms
      await new Promise((r) => originalSetTimeout(r, 0));

      expect(delays).toEqual([100, 200]);

      const ws3 = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
      await authenticate(ws3, "challengeB");
      await new Promise((r) => originalSetTimeout(r, 0));
      expect(client.state).toBe("open");

      ws3.close(); // reconnected successfully, so this failure resets to attempt 0 -> 100ms again
      await new Promise((r) => originalSetTimeout(r, 0));

      expect(delays).toEqual([100, 200, 100]);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });
});

describe("RelayClient.onProblem", () => {
  test("a refused subscription is reported to the app, not only to its own handlers", async () => {
    const { client, ws } = await connectedClient();
    const problems: string[] = [];
    client.onProblem((problem) => problems.push(problem.reason));

    client.subscribe([{ kinds: [9] }], { onEvent: () => {} });
    const subId = ws.lastSent("REQ")[1] as string;
    ws.emitMessage(["CLOSED", subId, "restricted: not a member of this workspace"]);

    // Without this the pane shows "Connected" over an empty timeline (#47).
    expect(problems).toEqual(["restricted: not a member of this workspace"]);
  });

  test("a NOTICE reaches the app instead of being dropped on the floor", async () => {
    const { client, ws } = await connectedClient();
    const problems: { kind: string; reason: string }[] = [];
    client.onProblem((problem) => problems.push(problem));

    ws.emitMessage(["NOTICE", "invalid: malformed frame"]);

    expect(problems).toEqual([{ kind: "notice", reason: "invalid: malformed frame" }]);
  });

  test("a rejected AUTH says why, rather than looping through silent reconnects", async () => {
    const client = newClient();
    const problems: { kind: string; reason: string }[] = [];
    client.onProblem((problem) => problems.push(problem));
    client.connect().catch(() => {});
    const ws = FakeWebSocket.instances[0]!;

    ws.emitMessage(["AUTH", "challenge1"]);
    await Promise.resolve();
    await Promise.resolve();
    const authEvent = ws.lastSent("AUTH")[1] as { id: string };
    ws.emitMessage(["OK", authEvent.id, false, "restricted: not a member of this workspace"]);
    await Promise.resolve();

    expect(problems).toEqual([
      { kind: "auth", reason: "restricted: not a member of this workspace" },
    ]);
  });

  test("a successful (re)connection clears the problem it reported", async () => {
    const { client, ws } = await connectedClient();
    const problems: ({ kind: string; reason: string } | null)[] = [];
    client.onProblem((problem) => problems.push(problem));

    client.subscribe([{ kinds: [9] }], { onEvent: () => {} });
    const subId = ws.lastSent("REQ")[1] as string;
    ws.emitMessage(["CLOSED", subId, "error: this subscription fell too far behind"]);
    expect(problems).toHaveLength(1);

    ws.close();
    await new Promise((r) => setTimeout(r, 0));
    const reconnected = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    await authenticate(reconnected, "challenge2");
    await Promise.resolve();

    expect(problems[problems.length - 1]).toBeNull();
  });
});
