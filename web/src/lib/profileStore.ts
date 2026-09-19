import type { Filter, VerifiedEvent } from "nostr-tools";
import type { ConnectionState, SubscriptionHandle, SubscriptionHandlers } from "./relay";

/** A kind 0's content — or `{}` for an author the relay answered for without one, which is how
 * "never published" reads apart from "not heard back yet" (no entry at all, #196). */
export interface Profile {
  name?: string;
  picture?: string;
  about?: string;
}

/** All `ProfileStore` needs of a `RelayClient` — and all a test has to stand in for. */
export interface ProfileClient {
  subscribe(filters: Filter[], handlers: SubscriptionHandlers): SubscriptionHandle;
  /** A REQ goes out only while open; on (re)open the client re-issues each subscription once. */
  readonly state: ConnectionState;
  onStateChange(listener: (state: ConnectionState) => void): () => void;
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
  /** The authors of each REQ sent and still waiting for its EOSE, oldest first: an `update()`
   * re-issues the REQ, and each one ends with an EOSE of its own. */
  private unanswered: string[][] = [];
  private stopFollowing: (() => void) | null = null;
  private snapshot = new Map<string, Profile>();
  private readonly client: ProfileClient;

  constructor(client: ProfileClient) {
    this.client = client;
  }

  ensure = (pubkeys: string[]): void => {
    const missing = pubkeys.filter((pubkey) => !this.requested.has(pubkey));
    // A closed store resumes when asked again, even for pubkeys it already had: StrictMode
    // closes it and replays the same ensure on remount (#143).
    if (missing.length === 0 && (this.handle !== null || pubkeys.length === 0)) return;
    for (const pubkey of missing) this.requested.add(pubkey);
    const filters: Filter[] = [{ kinds: [0], authors: [...this.requested] }];
    this.stopFollowing ??= this.client.onStateChange(this.onConnection);
    if (this.client.state === "open") this.unanswered.push([...this.requested]);
    if (this.handle !== null) this.handle.update(filters);
    else this.handle = this.client.subscribe(filters, { onEvent: this.onEvent, onEose: this.onEose });
  };

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Map<string, Profile> => this.snapshot;

  close = (): void => {
    this.handle?.();
    this.handle = null;
    this.stopFollowing?.();
    this.stopFollowing = null;
    this.unanswered = [];
  };

  private readonly onEvent = (event: VerifiedEvent): void => {
    let parsed: Profile;
    try {
      parsed = JSON.parse(event.content) as Profile;
    } catch {
      return;
    }
    this.snapshot = new Map(this.snapshot).set(event.pubkey, parsed);
    this.notify();
  };

  /** Opening sends one REQ with every author requested so far — whatever was asked while closed,
   * and whatever a dropped connection lost before its EOSE came back. */
  private readonly onConnection = (state: ConnectionState): void => {
    this.unanswered = state === "open" && this.handle !== null ? [[...this.requested]] : [];
  };

  /** Whoever the ended REQ asked for and got no kind 0 from has published none — so far. */
  private readonly onEose = (): void => {
    const authors = this.unanswered.shift();
    if (authors === undefined) return;
    const silent = authors.filter((pubkey) => !this.snapshot.has(pubkey));
    if (silent.length === 0) return;
    this.snapshot = new Map([...this.snapshot, ...silent.map((pubkey): [string, Profile] => [pubkey, {}])]);
    this.notify();
  };

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
