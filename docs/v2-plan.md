# boltbook — v2 plan

v1 is complete (§11 of the technical design). **Items 5–8 are built (2026-11-14)** — owned
pattern PDFs, bin and box labels, tiled PDF printing, and local envelope OCR. The rest is **mapped,
not started**. Nothing here is a promise; pick from it.

Each entry says what it touches, what it needs that does not exist yet, and the decision that
would have to be made first. Sizes are rough: **S** is an afternoon, **M** a day or two, **L** is
a week or more of real work.

---

## 1. Shopping list from a shortfall — S

**What.** A project already knows what it is short of. Turn that into a checklist: the shortfall
lines, grouped by what you would have to buy, printable and copyable as text.

**Why now.** It is nearly free — the shortfall rule and the view requirements already do the hard
part. It also closes the loop the brief opens: the app tells you what is missing, and then you can
act on it rather than remembering.

**Touches.** A new read-only endpoint (`GET /api/projects/:id/shopping-list`, or a `?format=text`
on the shortfall), one client screen, no schema change.

**Decisions.** Whether to group by supplier (we store `source` on fabric and thread, free text) or
simply list. Leaning: list, with the stored source shown when present.

---

## 2. Tag hygiene — S

**What.** Rename a tag, merge two tags, delete unused ones, and see counts.

**Why now.** The tag vocabulary converges by design, but it still drifts: `linen`, `Linen`,
`linnen`. Today the only fix is to edit every record.

**Touches.** Three endpoints on the existing `tag` repository (`PATCH /api/tags/:id`,
`POST /api/tags/:id/merge`, and the existing delete), plus a small management screen. The schema is
already right — `tag_link` makes a merge a reassignment.

**Decisions.** Whether merge should be offered when it would create a duplicate link (it should,
by ignoring the duplicate). No new risk.

---

## 3. Photos on projects — S

**What.** Attach photos to a project, not just fabric — most obviously the finished garment.

**Why now.** The design brief already decided this (*"yes, and optional"*), the schema has
projects, and the photo plumbing exists for fabric. It turns the inventory into a record of what
was made.

**Touches.** Generalise `fabric_photo` into a photo table keyed by entity type, or add a second
table. Generalising is cleaner and worth doing now, before there is more than one caller.

**Decisions.** Whether to generalise (`photo(entity_type, entity_id)`) — leaning yes, as a
migration that copies the existing rows.

---

## 4. Costing — S

**What.** What a project cost: the fabric, thread and notions allocated to it, from the stored
`cost_minor`, plus a running total of the stash's value.

**Why now.** We already store cost on fabric, thread and tools and never show it. Pure
presentation.

**Decisions.** Currency: `cost_minor` carries its own currency code per row, so a total across
mixed currencies is meaningless. Either total per currency or require one. Leaning: per currency,
stated.

---

## 5. Store pattern PDFs — M

**What.** Attach the actual PDF to a pattern, not just a link to one — with a page count and a
first-page thumbnail.

**Why now.** The brief deferred it as *"a v2 question"*, and it is the last thing keeping boltbook
from being the only place the pattern lives.

**Touches.** The photo plumbing again (blob + serve by id), a page-count read (needs a PDF parser —
a dependency), and thumbnail generation (needs a renderer, or the client can rasterise the first
page and upload that instead — **cheaper and no dependency**). Leaning: store the PDF, and let the
client upload a thumbnail it rendered itself.

**Decisions.** Whether PDFs are exportable with the rest (yes — they are records); the size cap.

**Built 2026-11-14.** Migration 8 adds `pattern_file`: one PDF per pattern, **25 MB** cap, the
bytes in the row (one file to back up), with `filename`, `page_count` and an optional client-rendered
thumbnail. `POST/GET/DELETE /api/patterns/:id/file` serve it by file id, inline, private and
immutable; replacing it changes the id, so the old URL can never serve stale bytes. Page count and
the first-page thumbnail are read in the browser with `pdfjs-dist`; a PDF that cannot be previewed
is still stored. The file and thumbnail travel in the export as `pattern-files/` entries and come
back byte-for-byte on restore. Tests: 11 in `test/pattern-files.test.ts`, plus export/import.

---

## 6. Bin and box labels — M

**What.** A printable sheet of labels for storage locations (and optionally per bolt): a QR that
opens the record, plus the human-readable name.

**Why now.** It closes the gap the whole app exists for — the last metre between "the app says Bin
A" and finding Bin A. It also gives the phone camera a second job.

**Touches.** QR generation (a small library, or ~60 lines hand-rolled — the format is a known
spec), a print stylesheet, and a route that hands deep links back into the client.

**Decisions.** Whether a scanned label deep-links to a *location* (a filter) or a specific record.
Leaning: both, with locations first.

**Built 2026-11-14.** Locations are derived from the free-text field across fabrics, thread, tools
and notions (`GET /api/locations`, case-folded counts). A label's QR carries an absolute
`#/location/<name>` URL and opens the new **location screen**, which lists every kind stored there —
the question the label exists to answer. QR generation is `qrcode-generator` (MIT, zero deps) at
error-correction **H** with a small centre mark (~3% of the area); OpenCV decoded the printed label
back to the exact URL. The sheet is 2 × 5 at 88 × 46 mm, 8 mm padding, and fits A4 and Letter;
Settings → Print storage labels. Per-record labels are deliberately still optional/later.

---

## 7. Tiled PDF printing — M/L

**What.** Take a pattern's PDF and print it across A4/Letter pages, taped together, with
registration marks and a scale-check square.

**Why now.** It is on the brief's v2 list and it is the one thing people still leave the app to do.

**Touches.** Either a server-side PDF library (pdf-lib or similar — a new dependency, licence and
CVE check required) or client-side canvas tiling into a print stylesheet. **Client-side keeps the
dependency register clean** and matches how the photos are already handled.

**Decisions.** Which way round to do it — this is the real decision in the item.

**Built 2026-11-14 — client-side.** `pdfjs-dist` is lazy-loaded only when a pattern PDF is opened.
Each PDF page is rendered at 100% physical scale and cut into sheet-sized tiles at 200/300/400 dpi;
the print sheet carries registration marks, a `P1 · 1/5 · 1/5 · 1/25` label, 10 mm default overlap
and a 50 mm scale-check square on the first sheet. The print overlay is a portal into `<body>`, so
`@media print` can hide the app; the `@page` size is swapped by a same-origin stylesheet because
`@page` cannot be selected by a class. Verified: the A0 fixture printed to **25 A4 pages at
210 × 297 mm** with the 50 mm square. No server renderer, and the PDF never leaves the box.

---

## 8. Pattern capture from a photo (envelope OCR) — L

**What.** Photograph a pattern envelope and prefill brand, number, size range and views.

**Why now.** It removes the most tedious data entry in the app.

**Touches.** OCR — a local model, or a third-party API.

**Decisions, and the reason this is L rather than M:** where the photo goes. A pattern envelope is
not sensitive, but sending images to a third party is a **disclosure-tier decision, not a
technical one** — it must be opt-in, off by default, and say plainly what leaves the box. A local
model (or a local OCR pass) avoids the question entirely at the cost of accuracy and size. Nothing
is built until that is answered.

**Built 2026-11-14 — local browser WASM.** Aster chose local OCR, and the WASM runs in the browser:
Tesseract.js 7 plus its SIMD+LSTM core and a 2.8 MB English `best_int` model, copied from
`node_modules` into `client/public/ocr/` by `scripts/copy-ocr-assets.mjs`. The engine is lazily
imported; the first scan loads ~9.6 MB and later scans use the browser cache. The photo is
downscaled and EXIF-stripped, read in a Web Worker, and never uploaded; the preview blob is revoked
and the raw text is not stored. The CSP gains only `'wasm-unsafe-eval'`, not `'unsafe-eval'`.

The pure parser (`client/envelope.ts`) suggests a brand (the big houses plus independent
companies), a number (including `M7969`-style house prefixes, excluding years), a numeric or alpha
size range, view letters (including OCR's `VIEWA/B`), format, category and a conservative name.
The review sheet shows the confidence and the raw text; low confidence is called out; nothing is
auto-saved. Saving creates the pattern and then the detected views; a failed view creation leaves a
complete pattern and a toast. Tests: 11 parser cases plus the CSP; a synthetic envelope in the real
client read at **88% confidence** and saved with **2 views**. The first scan's
`Estimating resolution as 511` console line is a Tesseract core log, not a failure.

---

## 9. Import from Threadloop / Stash Hub — M

**What.** Bring an existing library in from the tools this replaces.

**Why now.** It is the migration path, and it is on the brief's v2 list.

**Touches.** A mapping layer from their export format to this model, a **dry-run preview** that
shows what would be created and what could not be mapped, and the existing import plumbing.

**Decisions.** Their export formats are not a stable contract; the importer has to be best-effort
and must never half-write. Leaning: preview first, then a single transaction — exactly how
`importExport` already behaves.

---

## 10. Merge import — M

**What.** Today a restore **replaces** everything (§9 of the technical design). A merge would add
records from an export without discarding what is here.

**Why now.** It is the difference between "restore a backup" and "combine two stashes" — useful
after running two instances, or after a partial loss.

**Touches.** The same reader, with `INSERT … ON CONFLICT(id) DO UPDATE` instead of delete-then-insert,
and a decision for every conflict.

**Decisions.** What wins on a conflicting id — the export or the local record — and whether tags
union or replace. Leaning: the export wins (it is the thing being restored), tags union. This is the
first item where the answer is genuinely arguable, which is why it is not in v1.

---

## 11. Remote access, and *not* sync — S (documentation) / L (code)

**What.** The pull is the same stash on the phone and the laptop. Two ways:

- **Remote access** (small): the instance is already a web app behind a proxy. Reaching it over a
  VPN or a mesh network needs **no code** — only a documented recipe.
- **Sync** (large): a real replication protocol, conflict resolution, and an offline story.

**Recommendation.** Do the first, document the second as a non-goal for v2. boltbook's whole
premise is one box and one person; a sync protocol is a different product, and the honest version
of it would be a bigger conversation than a feature.

---

## Deliberately not v2

| Not doing | Why |
|---|---|
| Multi-user, sharing, roles | One person, one box — the premise, not an omission. |
| Hosted/cloud version | Same reason. |
| Native apps | The client is mobile-first and installable; a native shell buys nothing yet. |
| Sync/offline replication | See 11 — a different product. |
| Drafting or pattern editing | That is dressform. |
| Marketplace, social, feeds | The opposite of the point. |
| AI style or design suggestions | Not the problem being solved. |

---

## Suggested order

By value per unit of risk — the cheap, dependency-free items first, and the two that need a real
decision last:

1. Shopping list (1) · tag hygiene (2) · project photos (3) · costing (4) — the cheap, dependency-free
   work that is left
2. Pattern PDFs (5) · bin labels (6) — **built 2026-11-14**
3. Tiled printing (7) — **built 2026-11-14** (client-side)
4. Threadloop/Stash Hub import (9) · merge import (10)
5. Envelope OCR (8) — **built 2026-11-14** (local browser WASM)

## Standing rule for all of it

Every new dependency gets a row in the register (`docs/technical-design.md` §10) and clears the
licence gate, and every runtime or library gets the EOL/CVE check the brief's directive requires.
No item above is allowed to weaken the verifications that already hold: **174 tests**, and a client
checked in a real browser at desktop and phone widths — with a screenshot for each surface.
