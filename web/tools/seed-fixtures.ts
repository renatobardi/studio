// Seeds flow 11's fixtures (#157) into studio-test: the fixtures Account's Identity and Key Backup,
// the "fixtures" Channel of the e2e Workspace — a timeline, a thread with replies and reactions —
// and a Direct Message with history between two fixture Identities. Idempotent: CD runs it before
// every smoke, which is also what brings the fixtures back after studio-test is re-seeded.
// Run from web/:
//
//   bun tools/seed-fixtures.ts
//
// Reads STUDIO_WEB_URL, STUDIO_TEST_WORKSPACE_SLUG, STUDIO_TEST_OWNER_PRIVATE_KEY_HEX,
// STUDIO_TEST_FIXTURES_EMAIL, STUDIO_TEST_FIXTURES_PASSWORD, STUDIO_TEST_FIXTURES_BACKUP_PASSPHRASE
// and STUDIO_FIREBASE_API_KEY (the web client's public key, VITE_FIREBASE_API_KEY) from the env.
// The Account itself is created by `studio_api.ensure_e2e_accounts`, like the other e2e Accounts.
import { finalizeEvent, getPublicKey, nip44, Relay, type Event, type EventTemplate, type Filter, type VerifiedEvent } from "nostr-tools";
import { decryptBackup, encryptBackup } from "../src/lib/backup";
import type { Signer } from "../src/lib/custody";
import { DM_PAGE_SIZE } from "../src/lib/dmPagination";
import { nsecFromSecretKey } from "../src/lib/identity";
import { GIFT_WRAP, giftWrapForRecipient, unwrapGiftWrap } from "../src/lib/nip17";
import {
  CHANNEL_SCRIPT,
  FIXTURE_CHANNEL,
  PROFILES,
  dmRumors,
  findMessage,
  findReaction,
  findReply,
  fixtureSecretKey,
  missingRumors,
  type Cast,
  type Handle,
} from "./seed-fixtures-lib";

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env var ${name}`);
  return value;
}

const webUrl = env("STUDIO_WEB_URL").replace(/\/$/, "");
const slug = env("STUDIO_TEST_WORKSPACE_SLUG");
const ownerHex = env("STUDIO_TEST_OWNER_PRIVATE_KEY_HEX");
const ownerKey = Uint8Array.from(Buffer.from(ownerHex, "hex"));

const now = () => Math.floor(Date.now() / 1000);

const nip98Proof = (secretKey: Uint8Array, url: string, method: string) =>
  finalizeEvent({ kind: 27235, created_at: now(), tags: [["u", url], ["method", method]], content: "" }, secretKey);

const nip98 = (secretKey: Uint8Array, url: string, method: string) =>
  `Nostr ${Buffer.from(JSON.stringify(nip98Proof(secretKey, url, method))).toString("base64")}`;

class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const apiUrl = (path: string) => `${webUrl}/api${path}`;

async function call<T>(path: string, method: string, authorization: string | ((url: string) => string), body?: unknown): Promise<T> {
  const url = apiUrl(path);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: typeof authorization === "string" ? authorization : authorization(url),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Status and path only: CD's log is public, and an error body is the API's to word.
  if (!response.ok) throw new HttpError(`${method} ${path} failed: ${response.status}`, response.status);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const owner = <T>(path: string, method = "GET", body?: unknown) =>
  call<T>(path, method, (url) => nip98(ownerKey, url, method), body);

/** Onboarding, minus the screens: the fixtures Account is linked to `me` and holds a Key Backup of
 * it under the fixtures passphrase — what flow 11's restore needs. */
async function ensureFixturesAccount(secretKey: Uint8Array): Promise<void> {
  const signIn = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env("STUDIO_FIREBASE_API_KEY")}`,
    {
      method: "POST",
      // As the app signs in: a web API key may be restricted to the app's own referrer.
      headers: { "content-type": "application/json", Referer: `${webUrl}/` },
      body: JSON.stringify({
        email: env("STUDIO_TEST_FIXTURES_EMAIL"),
        password: env("STUDIO_TEST_FIXTURES_PASSWORD"),
        returnSecureToken: true,
      }),
    },
  );
  if (!signIn.ok) throw new Error(`Firebase sign-in of the fixtures Account failed: ${signIn.status}`);
  const bearer = `Bearer ${((await signIn.json()) as { idToken: string }).idToken}`;

  const pubkey = getPublicKey(secretKey);
  const account = await call<{ pubkey: string | null }>("/account", "GET", bearer);
  if (account.pubkey === null) {
    const url = apiUrl("/account/link-identity");
    await call("/account/link-identity", "POST", bearer, { proof: nip98Proof(secretKey, url, "POST") });
  } else if (account.pubkey !== pubkey) {
    throw new Error(`the fixtures Account is linked to ${account.pubkey}, not to the fixture Identity ${pubkey}`);
  }

  const nsec = nsecFromSecretKey(secretKey);
  const passphrase = env("STUDIO_TEST_FIXTURES_BACKUP_PASSPHRASE");
  const stored = await call<{ blob_base64: string }>("/account/key-backup", "GET", bearer).catch((error: unknown) => {
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  });
  const opens = stored && (await decryptBackup(Buffer.from(stored.blob_base64, "base64"), passphrase).catch(() => null));
  if (opens === nsec) return;
  const blob = await encryptBackup(nsec, passphrase);
  await call("/account/key-backup", "PUT", bearer, { blob_base64: Buffer.from(blob).toString("base64") });
}

function signerOf(secretKey: Uint8Array): Signer {
  return {
    getPublicKey: async () => getPublicKey(secretKey),
    signEvent: async (template: EventTemplate) => finalizeEvent(template, secretKey),
    nip44Encrypt: async (pubkey, plaintext) => nip44.encrypt(plaintext, nip44.getConversationKey(secretKey, pubkey)),
    nip44Decrypt: async (pubkey, ciphertext) => nip44.decrypt(ciphertext, nip44.getConversationKey(secretKey, pubkey)),
  };
}

/** A relay connection authenticated (NIP-42) as `secretKey` — the relay takes an event only from
 * the Identity that authenticated, and a Channel event only from a Channel Member. */
async function connectAs(relayUrl: string, secretKey: Uint8Array): Promise<Relay> {
  const sign = async (template: EventTemplate) => finalizeEvent(template, secretKey);
  const relay = new Relay(relayUrl);
  // Answers the challenge as soon as it arrives; auth() below only waits for that same answer
  // (nostr-tools keeps one), and throws until the challenge is in.
  relay.onauth = sign;
  await relay.connect();
  for (let attempt = 0; ; attempt++) {
    try {
      await relay.auth(sign);
      return relay;
    } catch (error) {
      if (attempt >= 50 || !String(error).includes("no challenge")) throw error;
      await Bun.sleep(100);
    }
  }
}

/** Everything the relay holds for `filters`, up to its EOSE. A short answer would read as "missing"
 * and publish a second copy, so a subscription the relay closes, or one it never finishes, fails
 * the run instead. */
function query(relay: Relay, filters: Filter[]): Promise<VerifiedEvent[]> {
  return new Promise((resolve, reject) => {
    const events: VerifiedEvent[] = [];
    let done = false;
    const subscription = relay.subscribe(filters, {
      eoseTimeout: 60_000,
      onevent: (event) => events.push(event as VerifiedEvent),
      oneose: () => {
        done = true;
        subscription.close();
        resolve(events);
      },
      onclose: (reason) => {
        if (!done) reject(new Error(`the relay closed a query before its end: ${reason}`));
      },
    });
  });
}

async function ensureWorkspaceMember(secretKey: Uint8Array, members: Set<string>): Promise<void> {
  if (members.has(getPublicKey(secretKey))) return;
  const { code } = await owner<{ code: string }>(`/workspaces/${slug}/invites`, "POST", { max_uses: 1, expires_at: now() + 600 });
  await call(`/invites/${code}/redeem`, "POST", (url) => nip98(secretKey, url, "POST"));
}

async function main(): Promise<void> {
  const keys: Record<Handle, Uint8Array> = {
    ada: fixtureSecretKey(ownerHex, "ada"),
    bruno: fixtureSecretKey(ownerHex, "bruno"),
    me: fixtureSecretKey(ownerHex, "me"),
  };
  await ensureFixturesAccount(keys.me);
  const cast = Object.fromEntries(Object.entries(keys).map(([handle, key]) => [handle, getPublicKey(key)])) as Cast;
  const published = { profiles: 0, messages: 0, replies: 0, reactions: 0, giftWraps: 0 };

  const members = new Set((await owner<{ pubkey: string }[]>(`/workspaces/${slug}/members`)).map((member) => member.pubkey));
  for (const key of Object.values(keys)) await ensureWorkspaceMember(key, members);

  const channels = await owner<{ id: string; name: string }[]>(`/workspaces/${slug}/channels`);
  const channel =
    channels.find((candidate) => candidate.name === FIXTURE_CHANNEL) ??
    (await owner<{ id: string }>(`/workspaces/${slug}/channels`, "POST", {
      name: FIXTURE_CHANNEL,
      about: "Invented conversation for flow 11's captures (#157)",
      private: false,
    }));
  for (const pubkey of Object.values(cast)) {
    await owner(`/workspaces/${slug}/channels/${channel.id}/members`, "POST", { pubkey });
  }

  const { relay_url } = await owner<{ relay_url: string }>(`/workspaces/${slug}`);
  const relays = {} as Record<Handle, Relay>;
  for (const handle of Object.keys(keys) as Handle[]) relays[handle] = await connectAs(relay_url, keys[handle]);
  const publish = async (handle: Handle, template: EventTemplate) => {
    const event = finalizeEvent(template, keys[handle]);
    await relays[handle].publish(event);
    return event;
  };

  // What onboarding publishes: the profile, and the relay the Identity takes Direct Messages on.
  for (const handle of Object.keys(keys) as Handle[]) {
    const profile = JSON.stringify(PROFILES[handle]);
    const [current] = await query(relays.me, [{ kinds: [0], authors: [cast[handle]], limit: 1 }]);
    if (current?.content !== profile) {
      await publish(handle, { kind: 0, tags: [], content: profile, created_at: now() });
      published.profiles++;
    }
    const [relayList] = await query(relays.me, [{ kinds: [10050], authors: [cast[handle]], limit: 1 }]);
    if (relayList?.tags.find((entry) => entry[0] === "relay")?.[1] !== relay_url) {
      await publish(handle, { kind: 10050, tags: [["relay", relay_url]], content: "", created_at: now() });
      published.profiles++;
    }
  }

  const h = ["h", channel.id];
  const existing = await query(relays.me, [{ kinds: [9, 1111, 7], "#h": [channel.id], limit: 500 }]);
  // New Messages keep the script's order a minute apart, ending now.
  const messages: Event[] = [];
  for (const [index, line] of CHANNEL_SCRIPT.messages.entries()) {
    let message = findMessage(existing, cast[line.from], line.text);
    if (!message) {
      const createdAt = now() - (CHANNEL_SCRIPT.messages.length - index) * 60;
      message = await publish(line.from, { kind: 9, tags: [h], content: line.text, created_at: createdAt });
      published.messages++;
    }
    messages.push(message);
  }
  const root = messages[CHANNEL_SCRIPT.thread.root];
  const rootTags = (upper: boolean) => [
    [upper ? "E" : "e", root.id], [upper ? "K" : "k", "9"], [upper ? "P" : "p", root.pubkey],
  ];
  // A second apart, so the thread reads in the script's order rather than a tie-break's.
  for (const [index, line] of CHANNEL_SCRIPT.thread.replies.entries()) {
    if (findReply(existing, root.id, cast[line.from], line.text)) continue;
    const createdAt = now() - CHANNEL_SCRIPT.thread.replies.length + index;
    await publish(line.from, { kind: 1111, tags: [h, ...rootTags(true), ...rootTags(false)], content: line.text, created_at: createdAt });
    published.replies++;
  }
  for (const reaction of CHANNEL_SCRIPT.reactions) {
    const target = messages[reaction.on];
    if (findReaction(existing, target.id, cast[reaction.from], reaction.emoji)) continue;
    const tags = [h, ["e", target.id], ["k", "9"], ["p", target.pubkey]];
    await publish(reaction.from, { kind: 7, tags, content: reaction.emoji, created_at: now() });
    published.reactions++;
  }

  // Wrapped to `me` only — its inbox is what flow 11 opens; its own lines are the sender's copy.
  const me = signerOf(keys.me);
  const newestPage = async () => {
    const inbox = await query(relays.me, [{ kinds: [GIFT_WRAP], "#p": [cast.me], limit: DM_PAGE_SIZE }]);
    const seen = new Set<string>();
    for (const wrap of inbox) {
      const rumor = await unwrapGiftWrap(me, wrap).catch(() => null);
      if (rumor) seen.add(rumor.id);
    }
    return seen;
  };
  for (const rumor of missingRumors(dmRumors(cast), await newestPage())) {
    const sender = rumor.pubkey === cast.ada ? "ada" : "me";
    await relays.ada.publish(await giftWrapForRecipient(signerOf(keys[sender]), rumor, cast.me));
    published.giftWraps++;
  }

  // What flow 11 is about to capture must be there now, not only have been sent.
  const after = await query(relays.me, [{ kinds: [9, 1111, 7], "#h": [channel.id], limit: 500 }]);
  const expected =
    CHANNEL_SCRIPT.messages.length + CHANNEL_SCRIPT.thread.replies.length + CHANNEL_SCRIPT.reactions.length;
  const found =
    CHANNEL_SCRIPT.messages.filter((line) => findMessage(after, cast[line.from], line.text)).length +
    CHANNEL_SCRIPT.thread.replies.filter((line) => findReply(after, root.id, cast[line.from], line.text)).length +
    CHANNEL_SCRIPT.reactions.filter((r) => findReaction(after, messages[r.on].id, cast[r.from], r.emoji)).length;
  const unread = missingRumors(dmRumors(cast), await newestPage()).length;
  for (const relay of Object.values(relays)) relay.close();
  if (found !== expected) throw new Error(`the fixtures Channel holds ${found} of ${expected} seeded events`);
  if (unread > 0) throw new Error(`${unread} Direct Message lines are missing from the fixtures Identity's newest page`);

  // No slug: it is a secret, and the manual run has no log masking.
  console.log(JSON.stringify({ channel: FIXTURE_CHANNEL, published }));
}

await main();
