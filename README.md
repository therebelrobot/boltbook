# boltbook

**Every bolt, every pattern, in one book.**

A self-hosted fabric-stash and sewing-pattern library: catalogue the fabric, patterns and
notions you already own, keep the details that matter — yardage, fibre, colour, size range,
what you have made from it — and find what you have when a new project starts.

Local-first, no account, runs on your own box.

## Where it fits

`boltbook` is the companion to [dressform](https://github.com/therebelrobot/dressform), and
they do different jobs:

| | job |
|---|---|
| **dressform** | draft and design a pattern — 2D flat sheet, emitted FreeSewing source, 3D drape and fit |
| **boltbook** (this) | keep what you already own — the stash and the pattern library |

boltbook is **not** a drafting tool. It never draws a piece or drafts a garment. It records
the fabric on the shelf and the patterns in the box, and answers the question a project
starts with: *do I already have this?*

The scope is the parts of Threadloop and Stash Hub that matter to one person on their own
machine, without the account or the cloud.

## Status

**M1–M4b landed.** The backend is complete: fabrics (with photos), patterns (with views and
per-view yardage requirements), notions, thread and tools, each with full CRUD, plus FTS5 search
across the four indexed entities. Projects allocate fabric, thread and notions, and the shortfall
readout reports what is short (remaining minus what other live projects reserve) and what is too
narrow.

Access is the house single-user model minus the vault: a one-time setup token claims the
instance, then a passphrase (optional TOTP) with a `__Host-` session cookie, rate limiting, an
audit log, and a `reset-passphrase` script. 81 passing tests; `npm audit` clean on Node 26.13.1.
The client (M5) is next, and it does the photo downscaling and EXIF stripping. The client is
mobile-first.

## License

[Unlicense](LICENSE) — public domain.
