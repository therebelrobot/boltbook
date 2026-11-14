# 0001. No encryption at rest

**Status:** Accepted
**Date:** 2026-11-14

## Context

The house's other single-user services — `resonate` and `reframe` — encrypt their databases.
Every record lives in a `payload` column as AES-256-GCM ciphertext, and the data key is
wrapped under a key derived from the passphrase with scrypt, with a second copy under a
recovery code. A stolen database file or backup is ciphertext without the passphrase.

That is the right call for a voice-journal and for a therapy thought-record: the contents are
intimate, and the cost of the machinery is paid back by the stakes.

boltbook holds a fabric stash and a pattern library. The contents are personal but not
sensitive in the way those two are — a list of cloth and a list of envelopes. The threat that
encryption answers (a stolen file, a leaked backup) is unchanged, but the consequence of that
file leaking is not the same.

## Decision

boltbook stores its data in **plaintext SQLite**. No envelope encryption, no data key, no
key-wrapping material, no recovery code for a key.

Auth is unchanged from the house model: a one-time setup token claims a fresh instance, then
a passphrase (12+ characters, optional TOTP) with a `__Host-` session cookie. Underneath it,
records are ordinary rows.

Stated plainly, so it is not a surprise later:

- `boltbook.db` and **every backup of it are plaintext**.
- The passphrase is stored as a scrypt hash; the TOTP secret must be recoverable and is
  therefore stored in the clear (it is a shared secret, not a password).
- The boundary is the box, the reverse proxy and the sign-in. Disk-level encryption (FileVault,
  LUKS, an encrypted volume) is the right tool if the box itself is the concern, and it is
  outside this app.

## Consequences

- The server is simpler: no `vault` service, no `crypto/envelope`, no data-key plumbing, and
  no "locked" versus "unlocked" split in the read path. Repositories read and write rows
  directly; the session carries identity, not a key.
- Backup is one file copied, and it can be read with `sqlite3` without the app — which is a
  feature for a personal record whose owner should never be locked out of their own data.
- TOTP is still available and still optional; losing the passphrase is a manual reset (the
  file is editable), not a recovery-code flow.
- If the stakes change — the stash shared with others, the box exposed — this decision is the
  one to revisit first, and the response is envelope encryption as in `reframe`, not a bolt-on.
