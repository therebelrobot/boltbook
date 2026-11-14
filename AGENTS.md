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
| `docs/adr/` | Decisions that are hard to reverse |

None exist yet — this is a scaffold. Write the brief before the code.

## Conventions

TypeScript strict, Node 26 (LTS, exact pin in `.nvmrc`). Import paths carry no extension.
npm. Unlicense. Hostnames in every file read `example.com` or `<docker-host>`. Nothing in CI
pushes commits, tags, or releases. New third-party packages get a row in the dependency
register in `docs/technical-design.md` and must clear the licence gate.

## Where the work is

`docs/technical-design.md` is the plan and the status once it exists; until then the README's
**Status** section is the truth.
