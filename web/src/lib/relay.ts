import { nip42, type VerifiedEvent } from "nostr-tools";
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
