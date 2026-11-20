# boltbook — v2 plan

v1 is complete (§11 of the technical design). **Items 5–8 are built (2026-11-14)** — owned
pattern PDFs, bin and box labels, tiled PDF printing, and local envelope OCR. Items 12–21 were mapped
on **2026-11-15** from a list Aster asked for; §§22–23 were added on **2026-11-16**, after importing
a real inventory. The rest is **mapped, not started**. Nothing here is a promise; pick from it.

Each entry says what it touches, what it needs that does not exist yet, and the decision that
would have to be made first. Sizes are rough: **S** is an afternoon, **M** a day or two, **L** is
a week or more of real work.

Every remaining item is also a GitHub issue, labelled `v2`. In this document's order: 1 → #1, 2 → #2,
3 → #3, 4 → #4, 9 → #5, 10 → #6, 11 → #7, 12 → #8, 13 → #9, 14 → #10, 15 → #11, 16 → #12, 17 → #13,
18 → #14, 19 → #15, 20 → #16, 21 → #17, 22 → #18, 23 → #19.

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

## 3. Photos on every record — S

**What.** **Every record with a face can carry a photo** — fabric, thread, **notions**, tool,
pattern and project. Photos exist only for fabric today (`fabric_photo`,
`/api/fabrics/:id/photos`, and `PhotoField` wired only into the fabric branch of `StashScreen`), so
a notion, a spool, a hand tool or a pattern cover cannot be pictured at all. **Fabric and notions
are camera-first**; thread, tools, patterns and projects take an optional photo.

**Why now.** Spotted on a real import (2026-11-16): nothing but fabric could take a picture, and
notions are the second thing you most want to *see* — a button in the hand is easier to identify
than "Corozo 15 mm cream". The design brief already decided project photos (*"yes, and optional"*);
widening the table to every kind is the same migration, and worth doing before there is more than
one caller.

**Touches.** Generalise `fabric_photo` into `photo(entity_type, entity_id, position, content_type,
bytes, width_px, height_px)`; the migration copies the existing fabric rows. A generic photo route
keyed by entity type and id (the fabric path kept as an alias, so nothing that links to a fabric
photo breaks). `entity_type` through export and import, which currently hardcode `fabric_photo`.
`PhotoField` takes `entityType`/`entityId` instead of `fabricId`; `StashScreen` renders it for every
kind, with the camera-first flow extended to notions, and a row thumbnail for every kind (only
fabric rows draw one today). The pattern's **cover** is a photo; the owned PDF keeps its own
first-page thumbnail (§5) — two different things.

**Decisions.** Generalise rather than add a second table — leaning yes, as a migration that copies
the existing rows; `entity_type` is the taggable set, `fabric | thread | notion | tool | pattern |
project`. This table is also the base §18 needs for photo roles.

**Built:** no.

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

## 12. A fabric you can just read — S

**What.** Tapping a row opens a **detail screen** — the photos, every field, the tags, the cuts and
swatches, and the two or three things you would do next (Edit, Sew, Delete). Editing becomes a
button on that screen rather than the screen itself.

**Why now.** `design-brief.md` §3 already decides this (*"lists → detail"*), and §2 principle 3 says
the rest lives on the detail screen. Today the row opens `EntitySheet` in `mode: 'edit'`, so the
only way to read a fabric is the form that can change it. On a phone that is one stray tap from an
accidental edit, and it means the read path can never show what an editor cannot hold: the photos as
content rather than as a field, the derived numbers (remaining against original, price per metre,
shrinkage), and the links.

**Touches.** A fabric screen on its own route (`#/fabric/:id`, like `#/location/:name`), the row's
`onOpen`, an Edit action that raises the existing sheet, and the delete-with-undo that already
exists. No schema change and no API change — `GET /api/fabrics/:id` already returns everything.

**Decisions.** Fabric only, or all four stash kinds at once? The `KINDS` shape makes all four nearly
free; leaning all four, fabric first in the same change. Route or a sheet over the list? Leaning
route, because a detail should be linkable, back-buttonable, and survive a refresh.

---

## 13. Crop and rotate a photo in the app — M

**What.** Rotate in 90° steps and crop — free, plus the ratios photos here actually want (a selvedge
strip, a print square) — **before** upload, and on a photo already stored.

**Why now.** A photo taken at the shelf is usually wrong: turned a quarter, edge-on, half a table in
frame. And the swatch reader (18) is only as good as the crop it gets.

**Touches.** `preparePhoto` gains a crop rect and quarter-turns, so crop, rotate, downscale and EXIF
strip stay **one** re-encode and not two lossy passes. A cropper component: canvas, pointer-event
handles, a rotate button (pinch is a nicety, not v2). Replacing a photo means upload the new bytes
and delete the old id — the immutable cache key already makes that safe.

**Decisions.** Destructive replace, or store a transform and apply it at render? Leaning
destructive: one copy, the export stays a plain image, and there is no second source of truth to
keep in step. Caveat to protect: EXIF orientation must be **applied** on decode before any manual
rotation, or a phone photo comes back sideways twice — today's `drawImage` path gets that from the
browser, and the cropper must not regress it.

---

## 14. Repurchase link and artist — S

**What.** Two fabric fields: `repurchase_url` (where this came from, so it can be bought again) and
`artist` (who designed the print). `source` stays the supplier — the artist is a different question.

**Why now.** *"Can I get another two metres of this"* and *"whose print is this"* are the two
questions the record cannot answer, and both are one text field.

**Touches.** A migration (two `TEXT` columns) **and a rebuild of `fabric_fts`** — `artist` belongs in
the index because it is a word people search by, and external-content FTS5 cannot be altered in
place, so all three triggers are rewritten and the index repopulated. Field descriptors in
`client/fields.ts`; the link rendered on the detail screen with `rel="noopener noreferrer"`.

**Decisions.** Validate `repurchase_url` as `http(s)` only at **write** time — it is rendered as a
link, so `javascript:` must be refused before it is stored, not filtered at the click. Whether
`artist` spreads to thread and notions (no — they are not design objects).

---

## 15. Cuts: several lengths on one fabric — L

**What.** A fabric becomes the **cloth** — fibre, colour, print, width, care — and holds one or more
**cuts**: physical pieces with their own length, remaining length, price, acquisition date and wash
state. A 3 m bolt and a 2 m remnant of the same linen are one record with two cuts.

**Why now.** The stash already contains this and the schema cannot say it. Buy the same cloth twice
and today's options are two records — so *"do I have enough linen"* is answered per record and the
answer is a lie, which is exactly the failure brief §6 admits to — or one record whose length has no
provenance and whose price cannot be attributed to a piece.

**Touches.** This is the big one. A `fabric_cut` table; `length_mm`, `original_length_mm`,
`cost_minor` and `currency` move onto the cut and the fabric's totals become **derived**; migration 9
creates one cut per existing fabric and copies those values; `shortfall.ts` and the availability rule
keep reading a per-fabric total while consumption draws from cuts; `project_fabric.length_mm_used` is
per fabric, so a project has to say *which* cut it took; the yardage meter, the `?minLengthMm=`
filter and the list row all read the sum; export and import carry the new rows.

**Decisions.**

- **Which cut a project consumes.** Ask on the project, or draw oldest-first and show what was
  taken? Leaning: ask, defaulted to oldest-first — the cut is what the person physically cut, and
  the record should say so.
- **Stored totals or derived.** Leaning derived: a stored `fabric.length_mm` is a second truth that
  a cut edit can silently break.
- Can a cut move to another fabric? No — it is a different cloth.
- This is **why it is L**: it touches the allocation maths, the filters, the meter, the export and
  every shortfall test. It lands **alone**, not bundled with 16 and 17, even though those are just
  columns on it.

---

## 16. Price per cut — S (after 15)

**What.** Each cut carries its own `cost_minor` and `currency`, so a sale remnant and a full-price
bolt on the same cloth are told apart; the fabric shows a derived price per metre and what the whole
of it cost.

**Why now.** The moment a fabric has two cuts, one price on the fabric is wrong for both. And
*"what did this actually cost per metre"* is the number that decides whether to buy again.

**Touches.** Columns on `fabric_cut` (moved there by 15's migration), a derived rate in the
repository, display on the detail screen and in costing (§4).

**Decisions.** Show the price per metre or per yard? Follow the unit preference and show the other
nowhere — one number, in the units the person reads. A cut with a price and no length: show the
total, no rate. Price on both the fabric and its cuts? No — money has one home.

---

## 17. Pre- and post-wash length — S (after 15)

**What.** A cut records its length **before** its first wash and **after** it, plus the wash date.
The app shows the shrinkage — *3.00 m → 2.85 m, −5%* — and the remaining length is always a
post-wash number.

**Why now.** Linen and cotton shrink, and today one number has to be wrong either before the wash or
after it, so the shortfall inherits the error. This is the difference between a record that predicts
a garment and one that flatters it.

**Touches.** `length_pre_wash_mm`, `length_post_wash_mm`, `washed_on` on `fabric_cut`; a derived
percentage; the detail screen; a *not washed yet* state. `length_mm` (remaining) stays post-wash by
definition.

**Decisions.**

- **Which number the shortfall reads.** Post-wash, always.
- **An unwashed cut.** Remaining is the measured pre-wash length, **flagged unwashed** — it
  overstates what you have, and the UI must say so rather than quietly presenting it as usable.
- **`original_length_mm` is not `length_pre_wash_mm`.** One is what you were sold, the other what
  the cloth measures. Prefill pre-wash from original and let it be corrected.
- **A second wash.** Edit the post-wash number; no wash history in v2. A history table is the honest
  long-term shape and not worth the rows yet.

---

## 18. Colour swatches — M (L with the reader)

**What.** Three connected things:

1. A **strip of colour keys** on the fabric (up to 8) — the colours you would actually match
   against.
2. **Swatch photos** — a photo marked as being *of a colour* (a selvedge, a flat patch of print)
   rather than cloth in the world. A `role` on the photo record, using the generalization in §3
   rather than a second table.
3. **Reading a swatch photo into keys** — client-side canvas sampling plus a quantiser, giving 3–6
   hex keys the person can keep, rename or delete. Nothing is saved until they say so.

**Why now.** The real query is visual — *"the green one I could line this with"* — and the `colour`
text field answers it badly (`sage green`, `green`, `Green`). A hex key is the only form of colour a
filter can use, and it also lets the stash be scanned as a wall of swatches instead of a list of
names.

**Touches.** `fabric_swatch(id, fabric_id, position, hex, name, source_photo_id)`; the `role` column
from §3; a pure quantiser (`swatches.ts`, median-cut or k-means, unit-tested on fixed pixel arrays)
run in a worker for large images; a `#rrggbb` validator on the server; a colour filter on the stash
that matches by **OKLab ΔE**, not by string; export and import.

**Decisions.**

- **Hex only, or hex plus a name?** Leaning name optional and autofilled from the nearest entry in a
  small built-in vocabulary — no dependency, and the name is what makes it reachable in text search.
- **How honest about accuracy.** A phone photo has unknown white balance, so a swatch is a **memory
  aid and a filter key, not a colour-managed value**. Say it once, quietly, on the screen, and do
  not pretend otherwise. The white-balance view in §21 is the remedy; a grey card in frame would make
  it exact.
- **Per fabric or per cut?** Per fabric — the colour is the cloth. A dye lot is the one thing that
  varies per cut, and a note on the cut covers it if it ever matters.
- **If "parsing" meant the printed code on a swatch card** (`Kona 1234`), that is different and
  cheaper work: `ocr.ts` already exists, and reading a card's text is a second caller rather than a
  new engine.

---

## 19. Import a pattern from a URL — M (freesewing.eu included)

**What.** Paste a pattern page's URL and get the pattern form prefilled: name, brand or designer,
number, year, category, link, a description. Structured data first (JSON-LD `Product` /
`CreativeWork`, OpenGraph, microdata), then a conservative text pass. **A preview, never a write.**

**Why now.** The same win as the envelope scan (§8) for patterns that were never in front of a
camera — which is most of them, now that pattern pages are where patterns are found. FreeSewing is
the case worth naming: its designs are free, stable, and each has a page naming the designer, so the
import is *link, name, designer* — not a PDF.

**Touches.** `GET /api/import/url?url=`, returning a suggestion object and writing nothing; an
extractor (pure, unit-tested against saved fixtures — **no live network in the test suite**); the
client preview, reusing the v2b review shape; then the ordinary create. JSON-LD is found by a small
scanner and `JSON.parse`d, and `<meta>` tags by a regex pass — **no DOM parser, no dependency**,
because that is where the useful data is anyway.

**The real work is the fetch guard**, because this is the app making a request whose host the person
did not type:

- `https:` only, no credentials in the URL, no non-standard ports;
- resolve the hostname and refuse loopback, private, link-local, CGNAT, multicast and ULA addresses
  — **and re-check on every redirect**, with redirects capped;
- 5 s connect / 10 s total, a 2 MB body cap, `Accept: text/html`, no cookies, no proxy environment
  variables;
- one fetch at a time, rate-limited.

That list is the difference between a URL importer and an SSRF gadget aimed at the box's own network.
It is not optional, and it is why this is M and not S.

**Decisions.** Server fetch or browser fetch? Leaning server — the browser would hit CORS on nearly
every shop. Keep the raw HTML? No: the suggestion is what is stored. A URL that serves a **PDF**:
offer to store it as the pattern's owned file instead of scraping, since §5 already has the plumbing.
A failed scrape falls back to AI parsing (§20) automatically? No — an explicit second tap, and only
if §20 has been turned on: it changes what leaves the box, and while it is off the fallback does not
exist at all.

---

## 20. BYOK AI parsing for patterns — M/L

**What.** The person supplies **their own** model endpoint and key — an OpenAI-compatible base URL
(`/v1/chat/completions`), a model name and a key, which covers OpenAI, OpenRouter, Groq, and a local
Ollama, llama.cpp or vLLM — and **Read this pattern** sends one of: a page's extracted text, pasted
text, or an envelope or swatch-card photo. It returns the same suggestion object the envelope parser
produces (§8), reviewed before anything is saved.

**Not a headline, and never on by default.** This is the last item on the list on purpose, and it
should read that way in the product. Nothing in the app mentions it until the person turns it on in
Settings (*Assisted import*, off), and turning it off **removes the entry points** rather than hiding
them one level deeper. No badge, no "try AI", no model name in the chrome, no prompt suggestions, no
telemetry of any kind. The product path is typing it in, the envelope scan and URL import; this is
what you reach for when those cannot read the page. If someone never opens Settings they should
never learn it exists.

**Why now.** The local parser is deterministic and good at envelopes; it is bad at a blog post, a
shop page, a page in another language, or a photo of a pattern book's index. A model is the general
tool for exactly that — **as a fallback, not as the front door** — and BYOK keeps the cost and the
key the person's: no account, no subscription, the same reason the app exists.

**Touches.** `server/ai.ts` (fetch, prompt, JSON reply, timeout, one retry, no streaming); two
settings (base URL, model) behind the off switch, with the key read from the environment or a
dedicated `0600` file rather than a form field (see below); the review sheet from v2b, reused; tests
against a **local stub server**, so the suite never calls a model.

**Decisions — these are the ones that shape it.**

- **What leaves the box.** Text, or an image, goes to a third party the person chose. It must be
  **off by default, one action at a time, and named** — the review says which endpoint it will call
  before it calls it. v2b avoided this question by staying local; §20 re-opens it deliberately, and
  the brief's rule holds: this is a **disclosure-tier decision, not a technical one**.
- **Where the key lives.** There is no encryption at rest (ADR 0001), so a key stored in the app is
  a **plaintext key in `boltbook.db`, in every backup, and in every export**. Three ways: a settings
  field (convenient, and it puts a live credential in a zip you might hand to someone); browser
  storage sent per call (moves the secret to the client and needs `connect-src` and a per-request
  header); or **an environment variable, or a dedicated `0600` key file, that never enters the
  database and is never exported**. Leaning the last.
- **A local model counts as "nothing leaves the box"** — and it is the configuration to document
  first, because it keeps the premise intact.
- **The prompt is the contract.** The reply is parsed into the same typed suggestion object as the
  envelope scan, every field optional; junk in a reply degrades to *no suggestion*, never to a
  written record.
- **Cost and size.** Cap the input (a few thousand characters, or one downscaled image), 20 s
  timeout, show what was sent, and never retry in a way that could double a bill.
- **Not a design advisor.** The brief puts *AI style or design suggestions* out of scope. This is
  **extraction** — text and pixels into fields the person could have typed — and it must not grow
  into "what should I sew". Worth writing down before it drifts.

---

## 21. White balance across a fabric's photos — M

**What.** When a fabric has more than one photo, a **colour-match view** lines them up and brings
them into agreement. One photo is the **reference**; for every other photo the view proposes a
white-balance correction and previews it live, and you adjust it by hand — pick a neutral, then
temperature, tint and exposure — until the set reads as one piece of cloth. Nothing is applied until
you tap apply, and apply is reversible.

**Why now.** §18 says a swatch is a memory aid because a phone photo's white balance is unknown; the
same unknown makes two photos of one linen look like two different linens. The app's claim is that
the record matches the cloth, and a gallery where the green one looks grey undermines it. It is also
the only way to make swatch keys trustworthy without a grey card in frame.

**Touches.** Adjustment parameters on the photo row; a colour-match screen reachable from a fabric's
photos when there are two or more; a pure `whiteBalance.ts` (neutral sample → per-channel gain → a
3×3 matrix, unit-tested against known patches) and an SVG `feColourMatrix` filter per photo, applied
**everywhere** the photo is drawn — gallery thumb, detail, full view — and inside the swatch
quantiser, so the swatches agree with the pictures. Export carries the parameters.

**Decisions.**

- **Parameters, or re-encode?** Leaning parameters, applied at display: white balance is a judgement
  rather than a crop, so undo must be free and the original bytes should survive as the evidence. It
  also keeps any image engine off the server — which is exactly why §13 can be destructive and this
  cannot. Cost, stated: the raw `/api/fabrics/:id/photos/:photoId` bytes stay unadjusted, so anything
  outside the app sees the original.
- **Absolute or relative?** Leaning relative, with an explicit reference photo, because the goal is
  that a *set* agrees; the sliders then fine-tune against that target.
- **The proposal is a proposal.** A neutral sample — a tapped patch, with grey-world as a labelled
  fallback — may prefill the sliders, but **nothing is applied without a tap**. That is the "not
  fully automated" constraint, and it is a design rule rather than a nicety.
- **Which photos.** Any photo of the same fabric. One that is already right simply becomes the
  reference and gets no correction.
- **Re-reading swatches.** Changing an adjustment does not retroactively rewrite swatch keys already
  saved. The view offers a re-read; it does not do one.

**Done when.** Two photos of one fabric, taken in different light, can be brought to visibly the same
colour in the gallery and on the detail screen; the correction survives a reload and an export →
import; the quantiser reads the adjusted pixels; the matrix maths is unit-tested; checked at
390 × 844 and 1280 × 720.

---

## 22. A role on fabric — lining, interfacing and the rest — M

**What.** A **role** on a fabric — `garment | lining | interfacing | interlining | canvas | backing
| muslin | other` — so the cloth that is *not* the main cloth has a home: lining, fusible
interfacing, interlining, canvas, backing. It shares one vocabulary with `pattern_requirement.role`
(`main | lining | interfacing | other`), so **"interfacing" means one thing everywhere**, and it
becomes a stash filter (*"show me my linings"*) rather than a tag convention.

**Why now.** Found on a real import (2026-11-16), and the model currently disagrees with itself:

- `NotionKind` includes `interfacing` (`shared/model.ts:8`) and the brief files it under notions
  (`product-brief.md` §4).
- `RequirementRole` **also** includes `interfacing` (`shared/model.ts:7`).
- Notions are **count-based** (`quantity` + `unit`; the shortfall reports a notion with `unit: null`,
  `server/units.ts`), while fabric is **millimetres** with the yardage meter.

Roll/bolt interfacing — fusible tricot, woven, knit — is cut into pieces, has a width and a running
length: it is cloth, and today it has to be forced into a count-based notion to be recorded at all.
Lining is plainly a fabric — cloth by the metre — but has no first-class marker; only a tag says it
is a lining. Answering *"the lining I could line this with"* should not depend on everyone tagging
things the same way.

**Touches.** A `role` column on `fabric` (default `garment`) and one migration; a shared vocabulary
with `pattern_requirement.role`, mapping where the two differ (`main` ↔ `garment`); `?role=` on
`GET /api/fabrics`, shown on the row and the detail screen; export and import carry the column; a
line in the product brief. `NotionKind.interfacing` **stays**, for the **pack/sheet** form (fusible
web, pre-cut shoulder and chest pieces) where a count is right — existing interfacing notions keep
their kind, so there is no data migration of notions.

**Decisions.**

- **A role on fabric, or a separate entity?** Leaning a role column — lining and interfacing are
  cloth and want the length, the meter and the shortfall behaviour fabric already has.
- **What happens to `RequirementRole`?** Align to the one vocabulary, or keep the smaller set and
  map? Leaning align.
- **`muslin` / `toile`** is a role here, not an entity — it is fabric you allocated to a test
  garment.
- **Does the role replace fibre/colour search?** No; it is an extra filter over the same list.

**Done when.** A bolt of fusible interfacing is a fabric with `role: interfacing`, cut and consumed
by length, and appears under a role filter; a lining is found by `role: lining`, not only by a tag;
`pattern_requirement.role` and `fabric.role` share one vocabulary; export → import round-trips the
role; every existing shortfall test still passes.

---

## 23. Search across notions and projects too — S

**What.** `GET /api/search` ranks fabric, patterns, thread and tools, then passes over the tags.
**Notions and projects are not indexed at all** — the README says so. Add both, so a search finds
*"the brass 20 cm zip"* or *"the Archer shirt I made in linen"*, not only the fabric.

**Why now.** Found on a real import (2026-11-16): after entering notions there is no way to search
for one — you scroll. The stash you most need to search is the one holding the most small records,
and notions are exactly that. It is also inconsistent: a notion carries the same free text
(`name`, `colour`, `spec`, `location`, `notes`) the four indexed kinds do.

**Touches.** `notion_fts(name, colour, spec, location, notes)` and `project_fts(title, notes)`,
external-content and trigger-fed like the existing four (technical design §6); `SearchHit.type`
gains `'notion' | 'project'`; the tag second pass includes both. No new dependency, and the only
schema is the FTS tables and their triggers.

**Decisions.** **Projects are a second question** — a project is about what you *did*, not what you
*have*, so ranking it beside a bolt may surprise. Leaning: index it, return it **last**, and label it
clearly; if that reads wrong, index notions only. A hit's snippet comes from the record's own fields;
remaining length stays a fabric-only detail.

**Done when.** A notion and a project each turn up for a word in their own fields; a tag-only hit
still appears for both; the one-second bar holds at 100+ fabrics; endpoint tested and the screen
checked at 390 × 844 and 1280 × 720.

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
| AI style or design suggestions | Not the problem being solved. Reading a page or a photo into fields you could have typed (§20) is **extraction**, and it ships only as an optional, off-by-default path; advice stays out. |

---

## Suggested order

By value per unit of risk — the cheap, dependency-free items first, and the two that need a real
decision last:

1. Shopping list (1) · tag hygiene (2) · photos on every record (3) · costing (4) — the cheap,
   dependency-free work that is left
2. Pattern PDFs (5) · bin labels (6) — **built 2026-11-14**
3. Tiled printing (7) — **built 2026-11-14** (client-side)
4. Threadloop/Stash Hub import (9) · merge import (10)
5. Envelope OCR (8) — **built 2026-11-14** (local browser WASM)

### Added 2026-11-15 (12–21)

The same rule, with two constraints: **15 before 16 and 17**, because it is the table they are
columns on, and **13 before 18**, because the swatch reader is only as good as the crop it gets.

1. Detail screen (12) · repurchase link and artist (14) — S each; 12 closes a gap against the design
   brief rather than adding anything new
2. Crop and rotate (13) — M, and it unblocks 18
3. Cuts (15), then price per cut (16), then wash lengths (17) — the one schema shift here, landed
   alone; 16 and 17 are an afternoon each once 15 is in
4. Colour swatches (18) — M, with the reader as its second half
5. White balance (21) — M, and the other half of 18's accuracy caveat; after 18 if the swatches are to
   agree with the pictures from the first day
6. Pattern import from a URL (19) — M, where the fetch guard is most of the work
7. BYOK AI parsing (20) — M/L, off by default and invisible until enabled, and it does not start
   until the key-storage question in §20 is answered

### Added 2026-11-16 (22–23)

Found while importing a real inventory, and it belongs with the cheap end: **§3 (photos on every
record) first**, because the notion photo is the same table; then **§22 (the fabric role)**, which
is one column and one migration but touches the filters and every shortfall test — so it lands on
its own; then **§23 (search over notions and projects)**, which is the tables only — no new column
anywhere.

**None of 12–23 adds a runtime dependency.** The cropper is canvas, the quantiser and the colour
matrix are lines we own, the URL extractor reads JSON-LD and `<meta>` without a DOM, and the AI client
is `fetch`. The register in `docs/technical-design.md` §10 stays as it is — and if one of these does
drag a package in, it gets a row and a licence check before it lands, like everything else.

## Standing rule for all of it

Every new dependency gets a row in the register (`docs/technical-design.md` §10) and clears the
licence gate, and every runtime or library gets the EOL/CVE check the brief's directive requires.
No item above is allowed to weaken the verifications that already hold: **174 tests**, and a client
checked in a real browser at desktop and phone widths — with a screenshot for each surface.
