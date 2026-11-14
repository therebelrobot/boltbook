# Agent notes

Read these before changing anything.

boltbook keeps what a sewer already owns — the fabric stash and the pattern library. It is
not a drafting tool; dressform drafts, boltbook catalogues. If a change starts drawing a
pattern piece or drafting a garment, it belongs in the other project.

## The documents (as they land)

| Document | Owns |
|---|---|
| `docs/product-brief.md` | Why this exists, the scope, what v1 is and is not |
| `docs/technical-design.md` | Modules, the data model, the seams, delivery plan |
| `docs/design-brief.md` | How the client looks, moves and feels — the mobile-first rules |
| `docs/deployment.md` | Running the container: environment, proxy, backups, upgrades |
| `docs/v2-plan.md` | What comes after v1 — scoped, costed, ordered |
| `docs/adr/` | Decisions that are hard to reverse |

The brief, the technical design and the design brief are written, and `docs/adr/` holds the
decisions. The brief leads; when a design doc and the brief disagree, the brief wins and the
design is corrected.

## Conventions

TypeScript strict, Node 26 (LTS, exact pin in `.nvmrc`). Import paths carry no extension.
npm. Unlicense. Hostnames in every file read `example.com` or `<docker-host>`; no real
hostname, service port, or provider name goes in this repo — it is public. Nothing in CI
pushes commits, tags, or releases. New third-party packages get a row in the dependency
register in `docs/technical-design.md` and must clear the licence gate.

**Mobile-first.** The primary device is the phone at the shelf; the desktop is the second
target. Design the client narrow first, with touch targets, bottom navigation, and camera
capture for photos. A layout that only works wide is not done.

## Where the work is

`docs/technical-design.md` is the plan and the status once it exists; until then the README's
**Status** section is the truth.
