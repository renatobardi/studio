# Studio

Collaboration app for humans and agents built on Nostr: unified inbox, channels, threads, DMs, projects, agents and workflows. Small-scale, self-hosted.

## Language

### Structure

**Workspace**:
A Nostr relay with its own members and channels. A Studio server may host many, each reached at its own relay URL and isolated from the others (ADR-0005); a person may belong to workspaces on different servers with the same Identity.
_Avoid_: tenant, team, community, server

**Workspace Key**:
The Nostr keypair a Workspace signs with when it announces its own metadata, members and roles. Held by the server, never by a person.
_Avoid_: relay key, admin key, server key

**Channel**:
A named conversation space inside a Workspace with its own members and roles. Modelled as a NIP-29 group.
_Avoid_: room, group, topic

**Workspace Member**:
An Identity admitted to a Workspace with a workspace role (owner, admin, member). Decided by the server, announced as Workspace-signed events.
_Avoid_: user, participant, follower

**Channel Member**:
A Workspace Member admitted to a specific Channel, possibly with a channel role. Never someone outside the Workspace.
_Avoid_: subscriber, joiner

**Invite**:
A server-private token that lets a person who may not yet have an Identity become a Member. Never an event.
_Avoid_: invitation link, join request

**Home Server**:
The Studio server holding a person's Account and Key Backup. Other servers only ever see their Identity.
_Avoid_: origin, backend

### Conversation

**Message**:
A short chat post in a Channel's timeline, signed by its author. Immutable once sent; corrections are a new Message.
_Avoid_: post, note, chat, comment

**Thread**:
The side conversation attached to one Message. Thread Replies never appear in the Channel timeline.
_Avoid_: reply chain, sub-thread, discussion

**Thread Reply**:
A comment inside a Thread, always pointing at the Thread's root Message.
_Avoid_: reply, answer, nested reply

**Forum Post**:
A titled, long-lived topic in a forum-type Channel. Answers are Forum Replies to the root only, never nested.
_Avoid_: thread, topic, article

**Reaction**:
An emoji a Member attaches to a Message, Thread Reply or Forum Post.
_Avoid_: like, emoji response

**Direct Message**:
A private conversation between Identities, end-to-end encrypted so the server cannot read it.
_Avoid_: DM room, private chat, whisper

**Attachment**:
A file (typically an image) referenced from a Message by URL and hash; the file itself lives outside the relay.
_Avoid_: upload, media, blob

### Identity and access

**Account**:
The Firebase-authenticated login (email/password or Google) that lets a person recover their Identity on a new device. It never signs anything.
_Avoid_: user, login, profile

**Identity**:
A Nostr keypair. The public key (`npub`) is who a person or agent *is* in Studio; every event is signed by it.
_Avoid_: account, wallet, user

**Person**:
An Identity operated by a human. Has an Account on a Home Server.
_Avoid_: user, human, member

**Agent**:
An Identity operated by software. Joins Workspaces as a Workspace Member with the `agent` role and signs its own events; it has no Account.
_Avoid_: bot, assistant, AI user

**Runtime**:
The process (local daemon or cloud) that holds an Agent's private key and runs it. Connects to relays as an ordinary client.
_Avoid_: harness, worker, executor, compute node

**Key Backup**:
The user's private key encrypted with a passphrase of their own (an `.age` file), stored server-side against the Account and also downloadable. The passphrase is never the Account password. Exists only under local custody: an extension holding the key never exports it, so there is nothing for Studio to back up (ADR-0005).
_Avoid_: seed, recovery file, export

**Custody**:
Who holds an Identity's private key: a NIP-07 browser extension, or Studio itself in the browser's local storage. It decides what onboarding can promise — under local custody a verified Key Backup is mandatory; under an extension it does not exist (ADR-0005).
_Avoid_: key storage, signer mode, wallet
