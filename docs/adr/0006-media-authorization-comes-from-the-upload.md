---
status: accepted
---

# A blob's readers are decided at upload; a reference never adds one

Read authorization for media was whatever anyone claimed it was (issue #38). Naming an existing
content hash in a Message's `imeta` tag recorded a Channel reference with no check that the
publisher had any right to those bytes, so every member of that Channel could then fetch them.
A gift wrap's `x` tags did the same for Direct Messages, and worse: the envelope is relayed
input the server cannot verify, because the rumor that legitimately names the blob is encrypted
(ADR-0003). Removal from the Workspace revoked neither, since the uploader's own grant and a
recorded recipient's were honoured without asking whether they were still Members.

We decided:

- **One question, one answer.** `MediaRepository.readable_blob` decides whether a pubkey may
  read a blob: it uploaded it, it was named as a recipient when it was uploaded, or it belongs
  to a Channel that already references it. A `GET` is authorized by it, and so is every new
  reference — which is what stops a reference from widening an ACL: it can only spread a blob
  where its publisher could already read it.
- **Direct Message recipients are declared in the upload.** They are `p` tags on the uploader's
  own kind-24242 Blossom authorization, the same signed event that already pins the content
  hash — so the ACL cannot be tampered with apart from the authorization that grants it. A gift
  wrap's tags grant nothing; the relay records no media reference for one.
- **A blob keeps its first uploader.** Offering bytes that are already stored is evidence the
  sender may read them, not authority over who else may: the blob keeps the uploader it has, and
  the second uploader is recorded as one of its recipients. This supersedes ADR-0005's "the
  uploader recorded against a hash is whoever uploaded those exact bytes last".
- **A fetch asks whether the caller is still a Member.** Losing the Workspace revokes the blob
  whatever the older grant was, including the uploader's own.

## Consequences

- Revocation is as coarse as `is_workspace_member_anywhere`, the same check that gates uploading
  (ticket #45): blobs carry no Workspace, so someone removed from one Workspace but still a
  Member of another on the same server keeps fetching blobs they were granted. Closing that
  means attributing blobs to a Workspace — a change to the table, the upload and the fetch, with
  a migration for existing rows. It is not done here.
- Revoking access stops new redirects being issued; it cannot reach back into presigned URLs — or
  copies — already delivered. A URL stays valid for its remaining TTL (60 seconds).
- Recipients are recorded as declared, so a Member may name any pubkey as the reader of their own
  upload. They could hand over the bytes directly anyway; the fetch still requires Membership.
- Recipients now live in `blob_dm_recipient`. The `blob_dm_ref` rows the relay used to write from
  gift wrap tags were every one of them granted without checking the sender's right to the blob,
  so none is carried over: they are left behind, unread. Direct Message photos uploaded before
  this change stop being fetchable by their recipients — the sender can re-send them. The only
  deployment holding such rows is `studio-test`, whose data is disposable.
- The client declares recipients when it uploads an encrypted Direct Message photo. The external
  `x` tag it still puts on the gift wrap now grants nothing and is removed by issue #48.
