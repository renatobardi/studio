import type { Filter, VerifiedEvent } from "nostr-tools";
import type { SubscriptionHandle, SubscriptionHandlers } from "./relay";

export interface Profile {
  name?: string;
  picture?: string;
  about?: string;
}

/** All `ProfileStore` needs of a `RelayClient` — and all a test has to stand in for. */
export interface ProfileClient {
  subscribe(filters: Filter[], handlers: SubscriptionHandlers): SubscriptionHandle;
}

/**
 * Resolves kind 0 profiles for whichever pubkeys are requested, kept off React so the
 * subscription it holds can be tested on its own.
 *
 * One subscription, for the store's whole life: each new batch of pubkeys widens its
 * `authors` through `update()` instead of opening another REQ — the hook this replaced left
 * one open per batch, forever. It cannot end at EOSE either: kind 0 is replaceable, so
 * a profile another client edits later has to keep reaching this session (#86).
 */
export class ProfileStore {
  private readonly requested = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private handle: SubscriptionHandle | null = null;
  private snapshot = new Map<string, Profile>();
  private readonly client: ProfileClient;

  constructor(client: ProfileClient) {
    this.client = client;
  }

  ensure = (pubkeys: string[]): void => {
    const missing = pubkeys.filter((pubkey) => !this.requested.has(pubkey));
    if (missing.length === 0) return;
    for (const pubkey of missing) this.requested.add(pubkey);
    const filters: Filter[] = [{ kinds: [0], authors: [...this.requested] }];
    if (this.handle !== null) this.handle.update(filters);
    else this.handle = this.client.subscribe(filters, { onEvent: this.onEvent });
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Map<string, Profile> => this.snapshot;

  close = (): void => {
    this.handle?.();
    this.handle = null;
  };

  private readonly onEvent = (event: VerifiedEvent): void => {
    let parsed: Profile;
    try {
      parsed = JSON.parse(event.content) as Profile;
    } catch {
      return;
    }
    this.snapshot = new Map(this.snapshot).set(event.pubkey, parsed);
    for (const listener of this.listeners) listener();
  };
}
