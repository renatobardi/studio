import { finalizeEvent, type EventTemplate, type Filter, type VerifiedEvent } from "nostr-tools";
import type { Signer } from "../lib/custody";
import type { ConnectionState, RelayClient, RelayProblem, SubscriptionHandle, SubscriptionHandlers } from "../lib/relay";
import type { Person } from "./fixtures";

function matches(event: VerifiedEvent, filter: Filter): boolean {
  if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
  if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
  if (filter.ids && !filter.ids.includes(event.id)) return false;
  if (filter.since !== undefined && event.created_at < filter.since) return false;
  if (filter.until !== undefined && event.created_at > filter.until) return false;
  for (const [key, wanted] of Object.entries(filter)) {
    if (!key.startsWith("#")) continue;
    const name = key.slice(1);
    const values = event.tags.filter((tag) => tag[0] === name).map((tag) => tag[1]);
    if (!(wanted as string[]).some((value) => values.includes(value))) return false;
  }
  return true;
}

/** Answers subscriptions from a fixed set of events, newest first with the filter's limit, then
 * EOSE — the way a relay would. Quacks like `RelayClient` for everything the shell touches. */
export class FakeRelayClient {
  private readonly events: VerifiedEvent[];

  constructor(events: VerifiedEvent[]) {
    this.events = [...events].sort((a, b) => b.created_at - a.created_at);
  }

  onStateChange(callback: (state: ConnectionState) => void): () => void {
    queueMicrotask(() => callback("open"));
    return () => {};
  }

  onProblem(_callback: (problem: RelayProblem | null) => void): () => void {
    return () => {};
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  subscribe(filters: Filter[], handlers: SubscriptionHandlers): SubscriptionHandle {
    const sent = new Set<string>();
    const emit = (current: Filter[]) => {
      for (const filter of current) {
        let remaining = filter.limit ?? Number.POSITIVE_INFINITY;
        for (const event of this.events) {
          if (remaining <= 0) break;
          if (!matches(event, filter) || sent.has(event.id)) continue;
          sent.add(event.id);
          remaining -= 1;
          handlers.onEvent(event);
        }
      }
    };
    queueMicrotask(() => {
      emit(filters);
      handlers.onEose?.();
    });
    const handle = (() => {}) as SubscriptionHandle;
    handle.update = (next: Filter[]) => queueMicrotask(() => emit(next));
    return handle;
  }

  publish(_event: VerifiedEvent): Promise<void> {
    return Promise.resolve();
  }

  close(): void {}

  asClient(): RelayClient {
    return this as unknown as RelayClient;
  }
}

/** Signs for real (so NIP-98 proofs and fixtures verify) but "encrypts" nothing: the fixtures
 * are readable on purpose. Never leaves preview.html. */
export function previewSigner(own: Person): Signer {
  return {
    getPublicKey: () => Promise.resolve(own.pubkey),
    signEvent: (template: EventTemplate) => Promise.resolve(finalizeEvent(template, own.secret)),
    nip44Encrypt: (_pubkey, plaintext) => Promise.resolve(plaintext),
    nip44Decrypt: (_pubkey, ciphertext) => Promise.resolve(ciphertext),
  };
}
