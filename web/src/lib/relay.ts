import { nip42, type Filter, type VerifiedEvent } from "nostr-tools";
import type { Signer } from "./custody";

/**
 * Connects to a Workspace relay and completes the NIP-42 AUTH handshake the
 * relay initiates on connect (see api/src/studio_api/nostr/relay.py).
 */
export function connectAndAuthenticate(relayUrl: string, signer: Signer): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);

    let authEventId: string | null = null;

    const onMessage = async (raw: MessageEvent) => {
      const msg = JSON.parse(raw.data as string);
      if (msg[0] === "AUTH") {
        const challenge = msg[1] as string;
        const template = nip42.makeAuthEvent(relayUrl, challenge);
        const authEvent = await signer.signEvent(template);
        authEventId = authEvent.id;
        ws.send(JSON.stringify(["AUTH", authEvent]));
        return;
      }
      if (msg[0] === "OK" && msg[1] === authEventId) {
        const [, , ok, message] = msg as [string, string, boolean, string];
        ws.removeEventListener("message", onMessage);
        if (ok) resolve(ws);
        else reject(new Error(message));
      }
    };

    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", () => reject(new Error(`could not connect to ${relayUrl}`)));
  });
}

/** Publishes an already-signed event and resolves once the relay accepts it. */
export function publishEvent(ws: WebSocket, event: VerifiedEvent): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: MessageEvent) => {
      const msg = JSON.parse(raw.data as string);
      if (msg[0] === "OK" && msg[1] === event.id) {
        ws.removeEventListener("message", onMessage);
        const [, , ok, message] = msg as [string, string, boolean, string];
        if (ok) resolve();
        else reject(new Error(message));
      }
    };
    ws.addEventListener("message", onMessage);
    ws.send(JSON.stringify(["EVENT", event]));
  });
}

export type ConnectionState = "connecting" | "open" | "reconnecting" | "closed";

interface SubscribeHandlers {
  onEvent(event: VerifiedEvent): void;
  onEose?(): void;
}

interface Subscription {
  id: string;
  filters: Filter[];
  handlers: SubscribeHandlers;
}

export interface RelayClientOptions {
  wsFactory?: (url: string) => WebSocket;
  /** Delay before the *first* reconnect attempt; doubles on each further attempt. Defaults to 1s. */
  reconnectDelayMs?: number;
  /** Ceiling the doubling delay never exceeds. Defaults to 30s. */
  maxReconnectDelayMs?: number;
}

let subCounter = 0;

/**
 * A Channel timeline's relay connection: the NIP-42 handshake plus REQ
 * subscriptions that survive a dropped socket — on close it reconnects,
 * re-authenticates, and re-issues every subscription still open (ticket #5).
 */
export class RelayClient {
  private readonly relayUrl: string;
  private readonly signer: Signer;
  private ws: WebSocket | null = null;
  private _state: ConnectionState = "closed";
  private readonly stateListeners = new Set<(state: ConnectionState) => void>();
  private readonly subscriptions = new Map<string, Subscription>();
  private explicitlyClosed = false;
  private readonly wsFactory: (url: string) => WebSocket;
  private readonly baseReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private reconnectAttempt = 0;

  constructor(relayUrl: string, signer: Signer, options: RelayClientOptions = {}) {
    this.relayUrl = relayUrl;
    this.signer = signer;
    this.wsFactory = options.wsFactory ?? ((url) => new WebSocket(url));
    this.baseReconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;
  }

  get state(): ConnectionState {
    return this._state;
  }

  /** Returns an unsubscribe function. */
  onStateChange(callback: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(callback);
    return () => this.stateListeners.delete(callback);
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    for (const listener of this.stateListeners) listener(state);
  }

  connect(): Promise<void> {
    this.explicitlyClosed = false;
    if (this._state === "closed") this.setState("connecting");
    return this.open();
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = this.wsFactory(this.relayUrl);
      this.ws = ws;
      let authEventId: string | null = null;
      let settled = false;

      const onMessage = async (raw: MessageEvent) => {
        const msg = JSON.parse(raw.data as string);
        if (msg[0] === "AUTH") {
          const challenge = msg[1] as string;
          const template = nip42.makeAuthEvent(this.relayUrl, challenge);
          const authEvent = await this.signer.signEvent(template);
          authEventId = authEvent.id;
          ws.send(JSON.stringify(["AUTH", authEvent]));
          return;
        }
        if (msg[0] === "OK" && msg[1] === authEventId) {
          const [, , ok] = msg as [string, string, boolean, string];
          if (ok) {
            this.reconnectAttempt = 0;
            this.setState("open");
            this.resubscribeAll();
            if (!settled) {
              settled = true;
              resolve();
            }
          } else {
            ws.close();
          }
          return;
        }
        if (msg[0] === "EVENT") {
          const [, subId, event] = msg as [string, string, VerifiedEvent];
          this.subscriptions.get(subId)?.handlers.onEvent(event);
          return;
        }
        if (msg[0] === "EOSE") {
          const [, subId] = msg as [string, string];
          this.subscriptions.get(subId)?.handlers.onEose?.();
        }
      };

      ws.addEventListener("message", onMessage);
      ws.addEventListener("close", () => {
        if (!settled) {
          settled = true;
          reject(new Error(`connection to ${this.relayUrl} closed`));
        }
        this.handleDisconnect();
      });
      ws.addEventListener("error", () => {
        if (!settled) {
          settled = true;
          reject(new Error(`could not connect to ${this.relayUrl}`));
        }
      });
    });
  }

  private handleDisconnect(): void {
    if (this.explicitlyClosed) {
      this.setState("closed");
      return;
    }
    this.setState("reconnecting");
    const delay = Math.min(
      this.baseReconnectDelayMs * 2 ** this.reconnectAttempt,
      this.maxReconnectDelayMs,
    );
    this.reconnectAttempt += 1;
    setTimeout(() => {
      this.open().catch(() => {});
    }, delay);
  }

  private resubscribeAll(): void {
    for (const sub of this.subscriptions.values()) {
      this.send(["REQ", sub.id, ...sub.filters]);
    }
  }

  /** No-op when the socket isn't open (still CONNECTING, or already CLOSING/CLOSED) — calling
   * WebSocket.send() in those states throws synchronously. A subscribe() cleanup can legitimately
   * run before the connection ever opened (e.g. two state updates that used to land in the same
   * React batch landing in separate ones instead), so this must be silent, not just avoided by
   * callers. */
  private send(message: unknown[]): void {
    if (this._state === "open") this.ws?.send(JSON.stringify(message));
  }

  /** Subscribes to `filters`; returns an unsubscribe function. Safe to call before `connect()`
   * resolves — the subscription is (re-)issued whenever the connection is or becomes open. */
  subscribe(filters: Filter[], handlers: SubscribeHandlers): () => void {
    const id = `sub${++subCounter}`;
    this.subscriptions.set(id, { id, filters, handlers });
    if (this._state === "open") this.send(["REQ", id, ...filters]);
    return () => {
      this.subscriptions.delete(id);
      this.send(["CLOSE", id]);
    };
  }

  /** Publishes once the connection is open — waiting out a brief reconnect rather than failing,
   * since `this.ws` may be a stale reference to a socket that just dropped. */
  publish(event: VerifiedEvent): Promise<void> {
    return this.whenOpen().then((ws) => publishEvent(ws, event));
  }

  private whenOpen(timeoutMs = 15_000): Promise<WebSocket> {
    if (this._state === "open" && this.ws !== null) return Promise.resolve(this.ws);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error("timed out waiting for the connection to open"));
      }, timeoutMs);
      const unsubscribe = this.onStateChange((state) => {
        if (state === "open" && this.ws !== null) {
          clearTimeout(timer);
          unsubscribe();
          resolve(this.ws);
        }
      });
    });
  }

  close(): void {
    this.explicitlyClosed = true;
    this.ws?.close();
  }
}
