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

**M1 landed.** The store is real: `server/` (config, migrations, the fabric
repository, the Hono app, the entry point), `shared/model.ts` as the wire contract, and 11
passing tests. Fabrics have full CRUD and FTS5 search (`GET /api/search?q=`); `npm audit` is
clean on Node 26.13.1. Auth does not exist yet — the server binds localhost only. M2 (patterns
and notions) is next per the design's delivery plan. The client is mobile-first.

## License

[Unlicense](LICENSE) — public domain.
