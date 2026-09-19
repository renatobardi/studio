// What flow 11 (#157) finds in studio-test: a Channel with a timeline, a thread with replies and
// reactions, and a Direct Message with history. Every name and word is invented, and every
// Identity is a fixture — `me` included. The lookups let tools/seed-fixtures.ts run on every
// deploy and publish only what is missing.
import { sha256 } from "@noble/hashes/sha2.js";
import { getEventHash, type Event } from "nostr-tools";
import { DM_RUMOR, type Rumor } from "../src/lib/nip17";

/** `me` is the Identity of the fixtures Account, the one flow 11 signs in as. */
export type Handle = "ada" | "bruno" | "me";
export type Cast = Record<Handle, string>;

export const FIXTURE_CHANNEL = "fixtures";

/** kind 0 as onboarding publishes it: a name and an emoji for a picture. */
export const PROFILES: Record<Handle, { name: string; picture: string }> = {
  ada: { name: "Ada Moreira", picture: "🦉" },
  bruno: { name: "Bruno Sato", picture: "🐙" },
  me: { name: "Rita Campos", picture: "🦊" },
};

export const CHANNEL_SCRIPT = {
  messages: [
    { from: "ada", text: "Morning! The new onboarding copy is on studio-test — could someone read it before lunch?" },
    { from: "bruno", text: "On it. The invite step reads much better now." },
    { from: "me", text: "Checked it on mobile too. One nit on the passphrase hint, otherwise good to go." },
    { from: "ada", text: "Release checklist for Friday: freeze at 14:00, smoke on studio-test, promote after a green run." },
    { from: "bruno", text: "Mockups for the members pane are in the shared folder, by the way." },
  ] as { from: Handle; text: string }[],
  /** Replies under `messages[root]`. */
  thread: {
    root: 3,
    replies: [
      { from: "bruno", text: "Could we freeze at 13:00 instead? Promote takes a while." },
      { from: "me", text: "13:00 works for me." },
      { from: "ada", text: "Done — checklist updated." },
    ] as { from: Handle; text: string }[],
  },
  /** Reactions on `messages[on]`. */
  reactions: [
    { on: 0, from: "bruno", emoji: "👍" },
    { on: 0, from: "me", emoji: "👍" },
    { on: 1, from: "ada", emoji: "🙏" },
    { on: 3, from: "me", emoji: "✅" },
  ] as { on: number; from: Handle; emoji: string }[],
};

export const DM_SCRIPT: { from: "ada" | "me"; text: string }[] = [
  { from: "ada", text: "Hey, do you have a minute today to pair on the members pane?" },
  { from: "me", text: "Sure — after 15:00?" },
  { from: "ada", text: "Perfect, I'll send an invite." },
  { from: "me", text: "Thanks! I'll bring yesterday's screenshots." },
];

/** 14/09/2026 14:00 UTC. A rumor is never checked against the clock, so the Direct Message can
 * keep fixed times — and with them fixed ids, which the app keeps one copy of however often the
 * same rumor is wrapped again. However far down the inbox it ends up, opening the conversation
 * pages until it shows (#231). */
const DM_STARTS_AT = 1_789_394_400;
const DM_GAP_SECONDS = 4 * 60;

/** A fixture Identity's key: stable across runs, and only as reachable as the owner key it is
 * derived from — a fixed public seed would let anyone post into the Workspace as a Member. */
export function fixtureSecretKey(ownerHex: string, handle: string): Uint8Array {
  return sha256(new TextEncoder().encode(`studio-fixtures/${handle}/${ownerHex}`));
}

const tag = (event: Event, name: string) => event.tags.find((entry) => entry[0] === name)?.[1];

export function findMessage(events: Event[], pubkey: string, text: string): Event | undefined {
  return events.find((event) => event.kind === 9 && event.pubkey === pubkey && event.content === text);
}

export function findReply(events: Event[], rootId: string, pubkey: string, text: string): Event | undefined {
  return events.find(
    (event) => event.kind === 1111 && event.pubkey === pubkey && event.content === text && tag(event, "E") === rootId,
  );
}

export function findReaction(events: Event[], targetId: string, pubkey: string, emoji: string): Event | undefined {
  return events.find(
    (event) => event.kind === 7 && event.pubkey === pubkey && event.content === emoji && tag(event, "e") === targetId,
  );
}

/** The Direct Message between Ada and `me`, as NIP-17 rumors (kind 14) in script order. */
export function dmRumors(cast: Cast): Rumor[] {
  return DM_SCRIPT.map((line, index) => {
    const unsigned = {
      pubkey: cast[line.from],
      created_at: DM_STARTS_AT + index * DM_GAP_SECONDS,
      kind: DM_RUMOR,
      tags: [["p", line.from === "ada" ? cast.me : cast.ada]],
      content: line.text,
    };
    return { ...unsigned, id: getEventHash(unsigned) };
  });
}

/** The rumors the reader's newest page of gift wraps does not carry — the page the app opens on. */
export function missingRumors(rumors: Rumor[], seen: Set<string>): Rumor[] {
  return rumors.filter((rumor) => !seen.has(rumor.id));
}
