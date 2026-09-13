/**
 * Deterministic data for the preview harness (preview.html): the prototype's `eng-platform`
 * conversation and `Ana Petrova` Direct Message, signed with fixed keys at fixed times so every
 * event id — and every screen — comes out the same on every run. Nothing here is real.
 */
import { finalizeEvent, getPublicKey, type VerifiedEvent } from "nostr-tools";
import type { ChannelOut, WorkspaceMemberOut, WorkspaceOut } from "../lib/api";
import { DM_RUMOR, GIFT_WRAP, SEAL, type Rumor } from "../lib/nip17";

function secret(seed: number): Uint8Array {
  const key = new Uint8Array(32);
  key.fill(seed);
  key[31] = seed + 1;
  return key;
}

export interface Person {
  secret: Uint8Array;
  pubkey: string;
  name: string;
  about?: string;
}

function person(seed: number, name: string, about?: string): Person {
  const secretKey = secret(seed);
  return { secret: secretKey, pubkey: getPublicKey(secretKey), name, about };
}

export const OWN = person(11, "Renato Bardi", "Platform and design systems. Mostly relay-bus these days.");
export const ANA = person(21, "Ana Petrova", "Design. Asks the awkward question early.");
export const TOMAS = person(31, "Tomás Rocha");
export const MARINA = person(41, "Marina Silva");
export const SPRIG = person(51, "Sprig", "Triages nightly runs and files what a human has to decide.");
export const HARBOR = person(61, "Harbor");
/** A name and a Channel long enough to have to be cut (#68, #72). */
export const MAXI = person(71, "Maximiliana Konstantinopoulou-Berenguer de Albuquerque Vasconcelos");
export const PEOPLE = [OWN, ANA, TOMAS, MARINA, SPRIG, HARBOR, MAXI];

/** 2026-09-11 08:00 UTC, the day the reference captures show. */
const DAY = Date.UTC(2026, 8, 11, 8, 0, 0) / 1000;
const at = (hh: number, mm: number) => DAY + (hh - 8) * 3600 + mm * 60;

export const WORKSPACE: WorkspaceOut = {
  slug: "family",
  name: "Studio HQ",
  relay_url: "ws://preview.invalid/relay",
  media_url: "/media",
  role: "owner",
};

export const CHANNELS: ChannelOut[] = [
  { id: "eng-platform", name: "eng-platform", about: "", private: false, role: "admin" },
  { id: "relay-ops", name: "relay-ops", about: "", private: false, role: "member" },
  { id: "general", name: "general", about: "", private: false, role: "member" },
  { id: "design-review", name: "design-review", about: "", private: false, role: "member" },
  { id: "release-train", name: "release-train", about: "", private: true, role: "member" },
  {
    id: "incident-review",
    name: "incident-review-2026-q3-relay-bus-backpressure-and-scheduler-follow-ups",
    about: "",
    private: true,
    role: "member",
  },
];

export const MEMBERS: WorkspaceMemberOut[] = [
  { pubkey: OWN.pubkey, role: "owner" },
  { pubkey: ANA.pubkey, role: "admin" },
  { pubkey: TOMAS.pubkey, role: "member" },
  { pubkey: MARINA.pubkey, role: "member" },
  { pubkey: SPRIG.pubkey, role: "agent" },
  { pubkey: HARBOR.pubkey, role: "agent" },
  { pubkey: MAXI.pubkey, role: "member" },
];

function signed(author: Person, kind: number, tags: string[][], content: string, created_at: number): VerifiedEvent {
  return finalizeEvent({ kind, tags, content, created_at }, author.secret);
}

const profiles = PEOPLE.map((p) =>
  signed(p, 0, [], JSON.stringify({ name: p.name, about: p.about }), at(7, 0)),
);

const channel = "eng-platform";
const m1 = signed(
  TOMAS,
  9,
  [["h", channel]],
  "It's the scheduler. Same signature as last week's incident — the lease renewal fires while the bus is still draining.\n\nOpen an issue against relay-bus and link the run so we don't lose the trace.",
  at(8, 2),
);
const m2 = signed(
  SPRIG,
  9,
  [["h", channel]],
  'Issue opened: relay-bus#284 — "backpressure_under_load flakes on shared runner". Linked run 4f21c9 and quarantined the test.',
  at(8, 11),
);
const m3 = signed(MARINA, 9, [["h", channel]], "Moving the huddle to 15h so the Lisbon folks can join.", at(9, 5));
const m4 = signed(
  HARBOR,
  9,
  [["h", channel]],
  "Staging is on relay 0.42.1. Smoke suite green in 2m18s — promotion to prod stays gated on review.",
  at(9, 40),
);
const m5 = signed(
  ANA,
  9,
  [["h", channel]],
  "Two options for the row density — the second keeps the type label out of the preview.",
  at(10, 26),
);
const m6 = signed(OWN, 9, [["h", channel]], "Taking the second. Ship it behind the density setting first.", at(10, 31));
const m7 = signed(
  MAXI,
  9,
  [["h", channel]],
  "Trace for the record: https://relay.example.invalid/runs/4f21c9/artifacts/backpressure_under_load/attempt-3/shared-runner-eu-west-1b/log.txt#L4821-L4903 — no spaces, so it has to wrap by itself.",
  at(10, 40),
);

const reactionTo = (author: Person, target: VerifiedEvent, emoji: string, when: number) =>
  signed(author, 7, [["h", channel], ["e", target.id], ["k", "9"], ["p", target.pubkey]], emoji, when);

const replyTo = (author: Person, root: VerifiedEvent, content: string, when: number) =>
  signed(
    author,
    1111,
    [["h", channel], ["E", root.id], ["K", "9"], ["P", root.pubkey], ["e", root.id], ["k", "9"], ["p", root.pubkey]],
    content,
    when,
  );

const membersProjection = signed(
  OWN,
  39002,
  [["d", channel], ...MEMBERS.map((m) => ["p", m.pubkey, m.role])],
  "",
  at(7, 30),
);

export const CHANNEL_EVENTS: VerifiedEvent[] = [
  ...profiles,
  m1,
  m2,
  m3,
  m4,
  m5,
  m6,
  m7,
  reactionTo(ANA, m1, "👍", at(8, 5)),
  reactionTo(MARINA, m1, "👍", at(8, 6)),
  replyTo(ANA, m2, "Does the quarantine skip it in the release gate too, or only nightly?", at(8, 20)),
  replyTo(SPRIG, m2, "Only nightly. The release gate still runs it — I can widen the quarantine if you want the gate green.", at(8, 21)),
  replyTo(TOMAS, m2, "Leave the gate honest. I'd rather see it fail than pretend.", at(8, 34)),
  replyTo(ANA, m2, "Agreed. I'll take the scheduler fix this afternoon.", at(9, 48)),
  membersProjection,
];

/** A Direct Message the way it reaches the reader: a gift wrap whose "ciphertext" is the seal
 * in the clear, and a seal whose "ciphertext" is the rumor in the clear — the preview signer's
 * nip44Decrypt is the identity, so the real unwrap code path runs over readable fixtures. */
function dm(from: Person, to: Person, content: string, when: number): VerifiedEvent {
  const rumor: Rumor = {
    id: "",
    pubkey: from.pubkey,
    created_at: when,
    kind: DM_RUMOR,
    tags: [["p", to.pubkey]],
    content,
  };
  const unsigned = finalizeEvent({ kind: rumor.kind, tags: rumor.tags, content, created_at: when }, from.secret);
  rumor.id = unsigned.id;
  const seal = signed(from, SEAL, [], JSON.stringify(rumor), when);
  return signed(person(99, "wrap"), GIFT_WRAP, [["p", OWN.pubkey]], JSON.stringify(seal), when);
}

export const DM_EVENTS: VerifiedEvent[] = [
  dm(ANA, OWN, "Saw the density options — the second one, definitely. Want me to draft the settings copy?", at(9, 12)),
  dm(OWN, ANA, "Yes please. Keep it to one line per option, the rest goes in the tooltip.", at(9, 15)),
  dm(ANA, OWN, "Done, it's in the Figma comments. One thing: 'Comfy' reads odd next to 'Compact'.", at(10, 2)),
  dm(OWN, ANA, "It's the prototype's word. Let's keep it until someone outside the team trips on it.", at(10, 4)),
];

export const ALL_EVENTS = [...CHANNEL_EVENTS, ...DM_EVENTS];
