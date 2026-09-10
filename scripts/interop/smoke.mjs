// Interop smoke test (ticket #2): an independent client library
// (nostr-tools, run under Bun) authenticates against the real relay,
// publishes an event and reads it back — proving wire compatibility from
// outside this repo's own Python event-construction code, not just that
// our own client and server agree with each other.
//
// Uses a well-known, public test keypair (BIP-340 test vector 0) seeded
// into the relay's allowlist for this run only — not a real credential.

import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

const RELAY_URL = process.env.RELAY_URL ?? "ws://localhost/relay/family";
const PRIVATE_KEY_HEX =
  "0000000000000000000000000000000000000000000000000000000000000003";

const secretKey = Uint8Array.from(Buffer.from(PRIVATE_KEY_HEX, "hex"));
const pubkey = getPublicKey(secretKey);

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", (event) => reject(new Error(String(event))), {
      once: true,
    });
  });
}

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    const onMessage = (event) => {
      ws.removeEventListener("message", onMessage);
      resolve(JSON.parse(event.data));
    };
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", (event) => reject(new Error(String(event))), {
      once: true,
    });
  });
}

async function main() {
  console.log(`connecting to ${RELAY_URL} as ${pubkey} ...`);
  const ws = await connect(RELAY_URL);

  const authChallenge = await nextMessage(ws);
  if (authChallenge[0] !== "AUTH") {
    throw new Error(`expected an AUTH challenge, got ${JSON.stringify(authChallenge)}`);
  }
  const challenge = authChallenge[1];

  const authEvent = finalizeEvent(
    {
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["relay", RELAY_URL],
        ["challenge", challenge],
      ],
      content: "",
    },
    secretKey,
  );
  ws.send(JSON.stringify(["AUTH", authEvent]));
  const authAck = await nextMessage(ws);
  if (authAck[0] !== "OK" || authAck[2] !== true) {
    throw new Error(`AUTH was not accepted: ${JSON.stringify(authAck)}`);
  }
  console.log("authenticated");

  const note = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "hello from the nostr-tools interop smoke",
    },
    secretKey,
  );
  ws.send(JSON.stringify(["EVENT", note]));
  const publishAck = await nextMessage(ws);
  if (publishAck[0] !== "OK" || publishAck[2] !== true) {
    throw new Error(`publish was not accepted: ${JSON.stringify(publishAck)}`);
  }
  console.log(`published event ${note.id}`);

  ws.send(JSON.stringify(["REQ", "smoke-sub", { ids: [note.id] }]));
  const received = await nextMessage(ws);
  if (received[0] !== "EVENT" || received[2].id !== note.id) {
    throw new Error(`did not read the event back: ${JSON.stringify(received)}`);
  }
  const eose = await nextMessage(ws);
  if (eose[0] !== "EOSE") {
    throw new Error(`expected EOSE after the event, got ${JSON.stringify(eose)}`);
  }
  console.log("read the event back, EOSE received");

  ws.close();
  console.log("interop smoke OK");
}

main().catch((error) => {
  console.error("interop smoke FAILED:", error);
  process.exit(1);
});
