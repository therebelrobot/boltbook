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

**M1–M3 landed.** The backend is complete for v1's scope: fabrics, patterns (with views and
per-view yardage requirements), notions, thread and tools, each with full CRUD, plus FTS5 search
across all four indexed entities. Projects allocate fabric, thread and notions, and the shortfall
readout reports what is short (remaining minus what other live projects reserve) and what is too
narrow. `server/` + `shared/model.ts` + 59 passing tests; `npm audit` clean on Node 26.13.1.
Auth (M4) and the client (M5) are next. The client is mobile-first.

## License

[Unlicense](LICENSE) — public domain.
