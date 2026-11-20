# boltbook — Technical Design

**Document version:** 1.3 · **Last updated:** 2026-11-20
**Companion:** `product-brief.md`, `adr/0001-no-encryption-at-rest.md`
**Status:** v1 built; v2 in progress — pattern PDFs, storage labels, tiled printing, local
envelope OCR (v2-plan §5–§8) and photos on every record (§3) are built.

---

## 1. Shape

One container, one process, one port. The Hono server serves the API under `/api/*` and the
built React client (a static allow-list, no directory traversal) for everything else. There is
no second service and no database server.

```
browser ── TLS ──▶ reverse proxy ──▶ boltbook container
                                        ├─ Hono app  (/api/*)
                                        ├─ static client
                                        └─ data/  (boltbook.db, photos sidecar-free: photos are rows)
```

This mirrors `resonate` and `reframe` exactly, minus the vault: no envelope encryption, so no
data key and no locked/unlocked split in the read path (see ADR 0001).

### Mobile-first

The primary device is the phone held at the shelf, mid-project; the desktop is the second
target. That is a constraint on the client, not a later polish pass — the full set (layout,
the mobile-native baseline, motion, gestures, components) is in `docs/design-brief.md`, and
in outline:

- **Bottom navigation** across the top-level places (Stash, Patterns, Projects, Search), with
  Settings reachable from the header — one-handed reach, nothing critical in the top corners.
- **Touch-first**: targets ≥ 44 px, spacing that survives a thumb, and no hover-only or
  right-click affordances. Every action has a tap path.
- **Camera capture** for fabric photos (`<input type="file" accept="image/*"
  capture="environment">`), downscaled client-side before upload (§7).
- **Viewport correctness**: `dvh` not `vh`; safe-area insets for the notch; input `font-size`
  ≥ 16 px so iOS does not zoom on focus; deliberate `touch-action` and tap-highlight.
- **Installable**: web manifest, `apple-mobile-web-app-capable`, icon — it sits on the home
  screen, like `reframe`.
- **Fast on a phone**: lists paginate or virtualize, and the §6 filter path must meet the brief's
  one-second bar on a mid-range phone, not only on the machine.

## 2. Modules

```
server/
  main.ts          process entry: config, database, static assets, serve
  config.ts        environment → ServerConfig (validated, defaults)
  database.ts      node:sqlite handle, pragmas, migrations
  schemas.ts       zod schemas for every request body
  app.ts           Hono app: middleware, guards, routes, error mapping
  auth.ts          setup / login / logout / passphrase / TOTP
  sessions.ts      in-memory SessionStore (random token; SHA-256 kept)
  rateLimiter.ts   unlock attempts, per IP
  repositories/
    fabrics.ts  patterns.ts  notions.ts  projects.ts  tags.ts  audit.ts
  shortfall.ts     the allocation maths (pure, no I/O)
  locations.ts     distinct storage locations + counts, for the label sheet
  export.ts        build the zip (json + photos + pattern files)
  staticAssets.ts  read dist/client into an allow-list at startup
client/
  main.tsx  App.tsx  router.ts  api.ts  styles.css  useCollection.ts
  fields.ts        field descriptors per entity, so every editor is one component
  format.ts        display helpers (pure, unit-tested)
  units.ts         metric ↔ imperial (pure, unit-tested)
  photo.ts         downscale + EXIF strip, client-side
  pdf.ts           pdf.js: page count, first-page thumbnail, tiled raster
  tiling.ts        paper and tile geometry (pure, unit-tested)
  qr.ts            QR matrix and label URLs (pure, unit-tested)
  ocr.ts           Tesseract WASM in a Web Worker: progress, cancel
  envelope.ts      envelope text → suggested fields (pure, unit-tested)
  components/      AppShell, Sheet, EntitySheet, PhotoField, PatternFileField,
                   PrintOverlay, QrSvg, Toast
  screens/         Access, Stash, Patterns, Projects, Search, Settings,
                   Labels, Location, TiledPrint
shared/
  model.ts         types shared by server and client (the wire contract)
test/
```

Server extras beyond the repositories: `staticAssets.ts` (the built client as an allow-list) and
`units.ts` (the wire unit mode, §5).

The split is the house split: `server/` never imports `client/`; both import `shared/`.

## 3. Data model

Plaintext SQLite via `node:sqlite` (`DatabaseSync`), WAL, `foreign_keys = ON`. Migrations are
an ordered `string[]` keyed off `PRAGMA user_version`, run in a transaction — the same
mechanism as `reframe/server/database.ts`.

Conventions: ids are random UUIDv4 text; lengths are **integer millimetres**; money is
`cost_minor INTEGER` + `currency TEXT`; dates are ISO-8601 text; timestamps are ISO-8601 UTC.
Metric is canonical — §5 gives the imperial mode for API callers, and the client converts for
display.

```
fabric(id PK, name, fibre, weight, colour, print_type, width_mm,
       source, location, care, notes, artist, repurchase_url,
       created_at, updated_at)
       -- BUILT 2026-11-20 (migration 11): artist + repurchase_url; the FTS
       -- index was rebuilt for artist (a link, not a question: the URL is not
       -- indexed). role (garment | lining | …) is planned (v2-plan §22) and
       -- stays out of the index — it is a filter.
       -- BUILT 2026-11-20 (migration 12, v2-plan §15): the lengths, price and
       -- acquisition date moved OFF the fabric onto fabric_cut; the fabric is
       -- the cloth, and every total is a SUM over its cuts.

fabric_cut(id PK, fabric_id FK→fabric ON DELETE CASCADE, position,
           length_mm, original_length_mm, cost_minor, currency,
           acquired_on, created_at, updated_at)
           -- the physical piece: the 3 m bolt, or the 2 m remnant of the same
           -- linen. A cut cannot move to another fabric; the last cut cannot
           -- be deleted (a fabric keeps at least one piece). There is no
           -- stored fabric-level length: the meter, the row, the filter and
           -- the shortfall all read the SUM over cuts. Wash state is
           -- v2-plan §17 (pre/post-wash), not built yet.

fabric_photo(id PK, fabric_id FK→fabric ON DELETE CASCADE, position,
             content_type, bytes BLOB, width_px, height_px)
             -- BUILT 2026-11-20 (migration 9, v2-plan §3): generalised to
             -- photo(id, entity_type, entity_id, position, content_type, bytes BLOB,
             --       width_px, height_px, created_at) — every record can carry a photo.
             -- entity_id carries no FK (it addresses six tables), so each repository
             -- deletes a record's photos explicitly; the fabric routes remain as an
             -- alias. Existing rows were copied byte-for-byte with entity_type='fabric'.

pattern(id PK, brand, number, name, format, size_min, size_max, difficulty,
        category, source, year, tried_and_true INTEGER, link_url, notes,
        created_at, updated_at)

pattern_view(id PK, pattern_id FK→pattern ON DELETE CASCADE, label,
             description, position)

pattern_requirement(id PK, pattern_view_id FK→pattern_view ON DELETE CASCADE,
                    role, fabric_width_mm, length_mm, note)
                    -- role: main | lining | interfacing | other
                    --       (v2: one vocabulary with fabric.role — v2-plan §22)

notion(id PK, name, kind, colour, spec, quantity REAL, unit, location,
       notes, created_at, updated_at)
       -- kind: button | zipper | interfacing | elastic | trim | other
       --       (`interfacing` here is the pre-cut pack; roll/bolt interfacing is a fabric role)

thread(id PK, name, brand, colour, colour_code, fibre, weight, spools,
       length_m, original_length_m, needle_size, location, source,
       cost_minor, currency, acquired_on, notes, created_at, updated_at)

tool(id PK, name, category, brand, spec, quantity, location,
     needs_attention INTEGER, acquired_on, cost_minor, currency, notes,
     created_at, updated_at)
     -- category: cutting | measuring | pressing | machine | marking | needles_pins | other

project(id PK, title, pattern_view_id FK→pattern_view NULL, status,
        started_on, finished_on, notes, created_at, updated_at)
        -- status: planned | cutting | sewing | done | abandoned

project_cut(project_id FK→project ON DELETE CASCADE,
            cut_id FK→fabric_cut ON DELETE CASCADE, length_mm_used INTEGER,
            PRIMARY KEY(project_id, cut_id))
            -- BUILT 2026-11-20 (migration 12, v2-plan §15): replaces
            -- project_fabric. A project names the cut it took — the piece the
            -- person physically cut — and consuming decrements only that cut.
            -- What other active projects reserve is summed per cut.

project_notion(project_id FK, notion_id FK, quantity_used REAL,
               PRIMARY KEY(project_id, notion_id))

tag(id PK, name UNIQUE)
tag_link(tag_id FK, entity_type, entity_id, PRIMARY KEY(tag_id, entity_type, entity_id))
         -- entity_type: fabric | pattern | project

pattern_file(id PK, pattern_id FK→pattern UNIQUE ON DELETE CASCADE,
             filename, content_type, page_count,
             pdf_bytes BLOB, thumbnail_content_type, thumbnail_bytes BLOB,
             thumbnail_width_px, thumbnail_height_px, created_at, updated_at)
             -- one owned PDF per pattern; byte size is LENGTH(pdf_bytes)

account(singleton_id INTEGER PK CHECK(=1), created_at, scrypt_n, scrypt_r, scrypt_p,
        passphrase_salt BLOB, passphrase_hash BLOB,
        totp_secret TEXT NULL, totp_last_accepted_counter INTEGER)
        -- no recovery columns and no wrapped key: nothing is encrypted (adr/0001)

audit_log(id INTEGER PK AUTOINCREMENT, at, event, ip_address, user_agent)
```

`length_mm` on `fabric_cut` is that piece's **remaining**; `original_length_mm` is what it was
bought as. The fabric has no length of its own: every total — the meter, the row, the
`?minLengthMm=` filter, the search hit — is a `SUM` over its cuts, derived, never stored.
`project_cut.length_mm_used` is the record of what each project took, and of which piece.

Indexes: `fabric(fibre)`, `fabric(location)`, `fabric_cut(fabric_id, position)`, `pattern(brand)`,
`project(status)`, `pattern_view(pattern_id)`, plus the FTS tables in §6.

## 4. Identity, auth, access

Single user. The house auth model, minus the vault. **Built at M4.**

- **Claim.** `POST /api/setup` succeeds once. It is refused while an `account` row exists. It
  requires `setupToken` to equal `config.setupToken` (`BOLTBOOK_SETUP_TOKEN`; generated from
  `randomBytes` and printed to the log once if unset — never returned over the wire).
- **Sign-in.** `POST /api/login` with passphrase (12+ chars) and, if enrolled, a TOTP code.
  Passphrase verified against a scrypt hash (params stored on the `account` row, so they can be
  raised later without a migration). TOTP is RFC 6238, replay-protected by
  `totp_last_accepted_counter`.
- **Session.** `__Host-boltbook_session` when `cookieSecure`, else `boltbook_session`:
  `HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`. The cookie carries a 256-bit random token;
  only its SHA-256 lives in the in-memory `SessionStore`, so a heap dump is not replayable.
  Idle timeout and absolute max, both from config.
- **State-changing guard.** Every non-GET `/api/*` request must carry `x-boltbook-request: 1`
  and, if `Origin` is present, it must equal the configured public origin. A browser cannot send
  that header cross-site without a preflight the server never grants.
- **Rate limit.** Failed unlocks per IP, with `Retry-After`; a burst across many IPs
  locks everyone out for a window.
- **Audit.** `audit_log` records the security events — claimed, signed in, sign-in failed,
  signed out, passphrase changed, authenticator enabled/disabled — read at `GET /api/audit`.
- **Lost passphrase.** No recovery code (there is no key to recover). The documented reset is
  `npm run reset-passphrase -- --yes`, which clears the `account` row on the database file;
  restart and re-claim with the setup token. The records are untouched.

Global hardening headers (CSP, `X-Frame-Options: DENY`, `no-referrer`, HSTS when secure,
`X-Robots-Tag: noindex`) are set on every response, as in `reframe`.

The CSP is `script-src 'self' 'wasm-unsafe-eval'`. The narrower WASM token exists only so the local
envelope OCR can compile its same-origin core; it does **not** allow `eval`, inline script or a
remote script. `test/ocr.test.ts` asserts the token is present and that `'unsafe-eval'` is not.

## 5. API surface

```
GET    /api/status                    { claimed, signedIn, totpEnabled, idleMinutes }
POST   /api/setup        { setupToken, passphrase }
POST   /api/login        { passphrase, totpCode? }
POST   /api/logout
POST   /api/passphrase   { currentPassphrase, newPassphrase }
POST   /api/totp/begin | /api/totp/confirm | /api/totp/disable

GET    /api/fabrics                   list + filters (?fibre=&minLengthMm=&location=&tag=)
POST   /api/fabrics
GET    /api/fabrics/:id
PUT    /api/fabrics/:id
DELETE /api/fabrics/:id
POST   /api/fabrics/:id/cuts           add a piece
PUT    /api/fabrics/:id/cuts/:cutId    the piece's lengths, price, acquisition
DELETE /api/fabrics/:id/cuts/:cutId   refused on the last cut (409)
POST   /api/photos/:entityType/:entityId        multipart, one photo
DELETE /api/photos/:entityType/:entityId/:photoId
GET    /api/photos/:entityType/:entityId/:photoId   raw bytes, immutable cache
       -- entityType ∈ fabric | thread | notion | tool | pattern | project
       -- the older /api/fabrics/:id/photos… paths remain as an alias

GET/POST        /api/patterns
GET/PUT/DELETE  /api/patterns/:id
POST/PUT/DELETE /api/patterns/:id/views[/:viewId]
POST/PUT/DELETE /api/patterns/:id/views/:viewId/requirements[/:reqId]
POST   /api/patterns/:id/file               raw PDF, ?filename=&pageCount=
POST   /api/patterns/:id/file/:fileId/thumbnail
GET    /api/patterns/:id/file/:fileId       inline PDF, private immutable cache
GET    /api/patterns/:id/file/:fileId/thumbnail
DELETE /api/patterns/:id/file

GET/POST        /api/notions
GET/PUT/DELETE  /api/notions/:id

GET/POST        /api/projects
GET/PUT/DELETE  /api/projects/:id
PUT             /api/projects/:id/allocations   { fabrics[], notions[] }

GET/POST        /api/tags
GET    /api/locations                 distinct locations + record counts
GET    /api/search?q=
GET    /api/export                    application/zip
GET    /api/audit
```

Errors are `{ error, message }` with a stable `error` code; validation errors add `issues`.

### Units on the wire

**Storage is canonical metric** — integer millimetres for fabric, requirements and allocations;
metres for thread — so nothing is lossy and the schema never carries a unit.

A caller may then work in imperial. `?units=imperial` on any read **renames** each measure to its
unit-suffixed form and converts it (`lengthMm` → `lengthYd`, `widthMm` → `widthIn`), and writes
accept those same names:

```sh
# how much linen is left?
curl -s 'http://<docker-host>/api/fabrics?units=imperial' -H 'x-boltbook-request: 1'
#   → { "name": "Washed linen", "lengthYd": 2.73, "widthIn": 55.12, … }

# add three yards
curl -s -X POST 'http://<docker-host>/api/fabrics' -H 'content-type: application/json' \
     -H 'x-boltbook-request: 1' -d '{"name":"Linen","lengthYd":3}'
```

The rename is the point: `lengthMm: 2.73` would be a lie, and a script that forgot the query
flag could not misread `lengthYd`. Supplying **both** names for one measure is a `400` rather
than a silent preference. Metric is the default, so nothing existing changes.

Shortfall lines carry their own `unit` (`"yd"`, or `null` for a count), so a converted number is
never left standing alone. The web client does not use this mode — it converts locally for
display and talks metric, so it can render a record without a second round trip (design brief §8).


## 6. Search

SQLite **FTS5** — verified present in Node 26.13.1's bundled SQLite (3.54.1) at M1, so the
`LIKE` fallback is not needed. External-content indexes over the source tables, kept current by
triggers:

- `fabric_fts(name, fibre, colour, print_type, location, notes)` — built at M1.
- `pattern_fts(brand, number, name, category, notes)` — built at M2.
- `thread_fts(brand, name, colour, colour_code, fibre, notes)` — built at M2b.
- `tool_fts(name, brand, category, spec, notes)` — built at M2b.

**v2 (planned).** `notion_fts(name, colour, spec, location, notes)` and `project_fts(title, notes)`,
so search covers all six record kinds — notions and projects are not indexed today
([v2-plan §23](v2-plan.md)).

**Built 2026-11-20 (migration 10, v2-plan §23).** `notion_fts(name, colour, spec, location, notes)`
and `project_fts(title, notes)`, trigger-fed and backfilled by the migration itself — a record that
existed before the migration is indexed by it, not only ones written after. Projects come last in
the result order on purpose: a project is about what you did, not what you have, and the client
labels every hit with its type. The tag second pass covers all six kinds.

`GET /api/search?q=` runs a ranked `BM25` `MATCH` and returns hits with the entity type, a
title, the best snippet, and — for fabric — remaining `length_mm`. Free text is tokenised and
each word is quoted as a prefix term (`"linen"*` joined by `AND`), so user punctuation can never
be read as FTS5 syntax.

**Tags are a second pass, not an FTS column.** FTS5 tables here are external-content, so a
`tags` column would have to be a real column on the source table — and every tag write would then
have to re-index the owning record. Instead, `searchAll` unions the FTS hits with the records
whose *tags* match any token (`repository/tags.searchByTag`), de-duplicating by entity and
setting the snippet to `tags: …`. FTS covers the fields; the union covers the labels. At a
personal scale this is simpler than maintaining tag-indexing trigger sets, and it is honest
about what matched.

## 7. Photos and files

Photos are **rows**, not files, so the whole record is one file to copy. **Built 2026-11-14.**

**v2 (planned).** The table generalises from `fabric_photo` to
`photo(entity_type, entity_id, …)`, so **every record** — fabric, thread, notions, tool, pattern and
project — can carry a photo, with fabric and notions camera-first and the rest optional; the fabric
routes stay as an alias. One migration copies the existing rows ([v2-plan §3](v2-plan.md)).

- One image per request, sent as **raw bytes** with the image's own `Content-Type` (not
  multipart) — `POST /api/fabrics/:id/photos`. Accepted types are JPEG, PNG and WebP; the body
  is capped at 8 MB, and a fabric holds at most **20** photos.
- Dimensions ride in `?widthPx=&heightPx=` so the client can reserve the right box before the
  image loads (the design brief forbids layout shift).
- Served by id with a long `immutable` cache — **the id is the cache key**, so a replaced photo
  gets a new id and never serves stale bytes.
- **Downscale and EXIF/GPS stripping are the client's job**, not the server's; the server accepts
  what it is given and only enforces type and size. The client half arrives with M5.

### Owned pattern PDFs and print (v2, built 2026-11-14)

A pattern can now **own** its PDF instead of linking to one. It is one row
(`pattern_file`), for the same reason photos are rows: the record is one database file to back up.
The cap is **25 MB** — a full A0 pattern with instructions — and the accepted type is
`application/pdf` only. Replacing a file deletes the old row and inserts a new one, so the file id
changes and the `immutable` cache key can never serve stale bytes.

**The server does not parse or render PDFs.** Page count and the first-page thumbnail are read in
the browser with `pdfjs-dist`, then sent as metadata (`?pageCount=`) and a 2 MB JPEG/PNG
thumbnail. That keeps the dependency register free of a server-side PDF engine, and no pattern
ever leaves the box. The same lazy-loaded pdf.js module drives **tiled printing**: the PDF page is
rasterised at the chosen DPI in sheet-sized tiles, with overlap, registration marks, page labels
and a 50 mm scale-check square. The browser's print dialog does not tile; the stylesheet only has
to place one image per page.

- `GET /api/patterns/:id/file/:fileId` is `Content-Disposition: inline`, `private`,
  `immutable`, so the native viewer opens it in a tab (iOS included).
- The thumbnail is an optional second request; a PDF that cannot be previewed is still stored.
- The label sheet reads `GET /api/locations` (distinct free-text locations with counts) and
  renders one QR per location at error-correction **H**, with a small centre mark (≈3% of the
  area, well inside H's 30% recovery). The QR carries an absolute `#/location/<name>` URL, so a
  scanned label works from another device on the same instance.
- Labels are **2 × 5 at 88 × 46 mm** on A4 or Letter, 8 mm page padding; both papers fit the
  same grid. The print overlay is rendered into `<body>` (a portal), so the print stylesheet can
  hide the app without hiding the sheet being printed. `@page` size is swapped as a same-origin
  stylesheet (`/print-a4.css` / `/print-letter.css`), because `@page` cannot be selected by a
  class.
- Pattern files are part of the one-zip export as `pattern-files/<id>.pdf` and
  `pattern-files/thumbs/<id>.<ext>`; restore matches the metadata rows to those entries the same
  way it matches photos.

### Envelope scan (v2, built 2026-11-14)

The v2 item that used to need a disclosure decision is now local: **Tesseract compiled to
WebAssembly**, running in a Web Worker in the browser. There is no third-party OCR and no image
upload.

- `preparePhoto` downscales and re-encodes the phone photo (stripping EXIF) before OCR; the blob is
  handed to the worker in memory and revoked when the review closes.
- The worker, SIMD+LSTM core and 2.8 MB English `best_int` model are copied from `node_modules` by
  `scripts/copy-ocr-assets.mjs` at `predev:client`/`prebuild:client` into
  `client/public/ocr/` (gitignored). `tesseract.js` is dynamically imported, so the initial bundle
  is unaffected. The first scan downloads ~9.6 MB; later scans use the browser cache.
- The allow-list `workerPath`/`corePath`/`langPath` are same-origin; `workerBlobURL:false` keeps the
  worker under the `worker-src` fallback to `script-src 'self'`.
- The parser (`client/envelope.ts`) is pure: brands (the big houses plus independent companies),
  pattern numbers (including house prefixes such as `M7969`, excluding years), numeric/alpha size
  ranges, view letters (including OCR's `VIEWA/B`), format (PDF/book/envelope), a category keyword,
  and a conservative name heuristic. Every result is a suggestion; the review sheet shows the
  confidence and the raw text, and low confidence is called out.
- **Nothing is auto-saved.** The photo is not attached to the record; the raw text is shown but not
  stored. Saving creates the pattern, then any view letters it found; a failed view creation leaves
  a complete pattern and a toast, not a half-written record.
- The scan is cancellable (`worker.terminate()`), the preview URL is revoked, and the progress sheet
  is a normal sheet with a Close/Escape path. The photo is read on the device; the copy says so.
- The Docker build stage copies `scripts/` and asserts the generated OCR/pdf.js assets exist in
  `dist/`, so a source-only build cannot ship a UI whose OCR 404s.

## 8. Allocation and shortfall

The one piece of real domain logic, kept pure in `server/shortfall.ts` so it is tested without a
database. **Built at M3.**

A project allocates *what it will use* — fabric (millimetres), thread (metres) and notions
(count) — each an amount that may be `null` ("allocated, amount unknown"). Against that:

1. **Available** = the stash's remaining amount **minus what other active projects have
   reserved**. Active means `planned`, `cutting` or `sewing`; `done` and `abandoned` reserve
   nothing, so two live projects cannot each count the same metre.
2. A claim is **short** when `amount > available`, reported in the claim's own unit and never
   negative.
3. **Too narrow** is separate from short: when the project's pattern view states a required fabric
   width and the chosen fabric is narrower, it is a **warning**, not a shortfall — a garment can
   be pieced.
4. On a project reaching **done** the stash is decremented **once** (`consumed`), by the allocated
   amounts, and the reservation stops counting. Moving off `done` does not undo the cut — the
   cloth is already cut.

The rule the UI must honour: an amount can be allocated without being consumed, and *what is
left* always means **remaining minus reserved**.

`GET /api/projects/:id/shortfall` returns the lines; allocations are set wholesale with
`PUT /api/projects/:id/allocations`.

## 9. Export and backup

**Built at M6.**

- `GET /api/export` streams a zip: **`boltbook.json`** with every table, and **`photos/<id>.<ext>`**
  with the image bytes. The bytes are entries rather than base64 in the JSON — base64 would
  inflate every photo by a third for no gain, and a zip of files is what a person can actually
  open. `fabric_photo` rows keep their metadata plus a `file` pointer to match them up.
- **Credentials are never exported.** The `account` table (passphrase hash, authenticator secret)
  is excluded: an export is your records, and restoring one should never carry a hash with it.
- The export is recorded in the audit log, and offered from Settings as a download.
- **Backup is a file copy**: `npm run backup -- ./backups` settles the write-ahead log
  (`wal_checkpoint(TRUNCATE)`) and copies `boltbook.db`. Because there is no encryption, the copy
  is readable with any SQLite tool — a deliberate property (ADR 0001), not an oversight.
- **Restore is `POST /api/import?mode=replace`** (and Settings → Restore). It **replaces every
  record** — merge was considered and deferred to [v2](v2-plan.md) §10, because a restore should
  reproduce a known state and a half-merged stash is harder to reason about than a replaced one.
  Asking for `mode=replace` by name is the guard, so a stray POST cannot wipe a stash.
  - Two things are deliberately **not** restored: `account` (never exported) and `audit_log` —
    the log belongs to this instance and should record that an import happened, not be
    overwritten by another box's history.
  - The whole restore is one transaction. A malformed export rolls back and changes nothing.
  - Photo bytes come from the `photos/` entries, matched to their metadata rows by filename.

## 10. Dependency register

Every third-party package needs a row here before it lands (repo `AGENTS.md`). Starting point is
the set already proven in `resonate`/`reframe`; exact pins, no floating majors.

| Package | Pin | Licence | Why |
|---|---|---|---|
| `hono` | 4.13.18 | MIT | HTTP router, middleware |
| `@hono/node-server` | 2.1.8 | MIT | Node adapter, `getConnInfo` |
| `zod` | 4.6.7 | MIT | Request validation → typed handlers |
| `react` / `react-dom` | 19.3.0 | MIT | Client |
| `vite` | 8.3.2 | MIT | Client build/dev |
| `@vitejs/plugin-react` | 6.1.2 | MIT | JSX transform |
| `esbuild` | 0.28.2 | MIT | Server bundle |
| `tsx` | 4.23.15 | MIT | Dev watch, test loader |
| `typescript` | 7.0.2 | Apache-2.0 | Typecheck |
| `@types/node` | ^26 | MIT | Node 26 types |
| `pdfjs-dist` | 6.5.438 | Apache-2.0 | Page count, first-page thumbnail and tiled raster (client, lazy) |
| `qrcode-generator` | 2.0.4 | MIT | QR matrices for storage labels |
| `tesseract.js` | 7.0.0 | Apache-2.0 | Local envelope OCR (client, lazy) |
| `tesseract.js-core` | 7.0.0 | Apache-2.0 | WASM OCR core (SIMD+LSTM), transitive |
| `@tesseract.js-data/eng` | 1.0.0 | MIT | English traineddata (build-time asset) |

`node:sqlite` is built into Node 26 — no dependency, no native build. Per the standing
directive, the **EOL and CVE check runs at M1** across this list before any of it is installed;
Node itself is 26 LTS (verified 2026-11-14). All licences above are compatible with Unlicense.

**v2 additions (2026-11-14).** `qrcode-generator` is zero-dependency and ships its own types.
`pdfjs-dist` is 37 MB unpacked because it carries the CMaps, standard fonts and wasm used by
unusual PDFs; the client imports it **dynamically** (pattern path only), and the Vite build splits
a ~444 KB chunk plus a 1.27 MB worker. The assets are copied to `client/public/pdfjs/` by
`scripts/copy-pdfjs-assets.mjs` on `predev:client`/`prebuild:client` and served same-origin. The
optional `@napi-rs/canvas` is only for pdf.js's Node legacy build, which the app does not use.
`npm audit` is clean, and both licences clear the Unlicense gate. The browser build is checked
against `script-src 'self' 'wasm-unsafe-eval'`; the worker is same-origin and no `eval` path is used.

**OCR additions (2026-11-14).** `tesseract.js` 7 is a runtime dependency (a ~17 KB lazy chunk; the
engine itself is the worker/WASM assets). Its core is transitive; `@tesseract.js-data/eng` is a
**devDependency** only because the 2.8 MB `best_int` English model is copied into
`client/public/ocr/lang/` at build time. The browser never fetches from a CDN. Total first-scan
assets are ~9.6 MB (109 KB worker, 3.8 MB core wrapper, 2.8 MB WASM, 2.9 MB model); the model is
cached in IndexedDB by Tesseract. The CSP gains `'wasm-unsafe-eval'` for the core; it is not a
general eval grant. `npm audit` is clean and the licences (Apache-2.0 for the engine/core, MIT for
the data package) clear the Unlicense gate.

**M1 outcome.** Installed and `npm audit`-clean. The starting pins were raised to the current
releases after the audit: `zod` 4.6.5 carried **GHSA-mrhx-c7xc-m3w5** (high, memory exhaustion
validating oversized constrained collections), and `hono` 4.13.13 carried advisories — both are
now at the versions above. The client deps (`react`, `react-dom`, `vite`, `@vitejs/plugin-react`)
land at M5.

## 11. Delivery plan

| # | Milestone | Done when |
|---|---|---|
| M0 | Scaffold | repo, brief, ADR, design brief, this doc — **done** |
| M1 | Store | migrations, repositories, fabrics CRUD API, FTS5 verdict, dep EOL/CVE check — **done** |
| M2 | Patterns + notions | patterns with views and requirements; notions inventory; CRUD APIs — **done** |
| M2b | Thread + tools | thread and tool tables and APIs, by request — **done** |
| M3 | Projects | projects, allocation across fabric/thread/notions, `shortfall.ts` with unit tests — **done** |
| M4 | Auth | setup/login/logout/passphrase/TOTP, sessions, rate limit, guards — **done** |
| M4b | Photos | fabric_photo, raw-bytes upload, serve by id, delete, cascade — **done** |
| M5 | Client | React + Vite, mobile-first: shell, access, stash with camera-first photos, patterns, projects with allocation, search, settings, units — **done** |
| M5b | Tags + views editor | tag store, routes, filters and tag search; the pattern views/requirements editor in the client — **done** |
| M6 | Export + backup | zip export from the API and Settings, `npm run backup` — **done** |
| M7 | Ship | Dockerfile (multi-stage), compose, CI + GHCR publish workflows, deployment notes — **done** |
| v2a | Pattern files + print | migration 8, owned PDF + thumbnail, `/api/locations`, QR labels, location screen, client-side tiled print — **done** |
| v2b | Envelope scan | local Tesseract WASM in a Worker, envelope parser, review-before-save, view suggestions — **done** |
| v2 | Beyond v1 | The rest: shopping list, tag hygiene, photos on every record, costing, imports, the fabric role — scoped in `v2-plan.md` |

Auth (M4) could land before M1's later parts; the plan keeps it early enough that nothing ships
unauthenticated.

## 12. Verification

- **Unit (`node --import tsx --test test/*.test.ts`):** `shortfall.ts` (short, exact, reserved,
  too-narrow, done-decrements), migration runner (idempotent, versioned), auth (wrong passphrase,
  wrong setup token, replay-protected TOTP, session expiry), search query building.
- **Integration:** each API route with an in-memory database (`:memory:`), asserting status and
  body shape from `shared/model.ts`.
- **Pattern files:** upload/read/delete, the 25 MB and type caps, a bad page count, the thumbnail
  by file id, replacement changing the id (and invalidating the old URL), cascade on pattern
  delete, and export → import with byte-identical PDF and thumbnail bytes.
- **Locations and geometry:** distinct locations fold case and blank strings; the shortfall and
  report counts are honest; tiled-print geometry is pure (`planTiles`) and tested at A4, Letter,
  A3→A4 and A0→A4; the QR matrix, quiet zone and absolute label URL are tested without a DOM.
- **Lossless record:** create a fabric with a photo, read it back, byte-compare the photo.
- **Instance:** a fresh `:memory:` app prints one setup token; `POST /api/setup` twice fails the
  second time; an unauthenticated `/api/*` read is refused with no data.
- **Perf:** a 100+ fabric stash filters under a second (brief §7).
- **Envelope OCR (v2b):** `test/envelope.test.ts` covers brands, house-prefixed numbers, years
  that must not become numbers, numeric and alpha size ranges, views (including OCR's `VIEWA/B`),
  format, category, the name heuristic, and empty/noisy text; `test/ocr.test.ts` asserts the CSP
  allows WASM without `'unsafe-eval'`.
- **Browser (v2a, 2026-11-14):** an A0 test PDF uploaded through the real client, previewed and
  printed to **25 A4 pages at 210 × 297 mm**, with the 50 mm check square; a storage-label QR
  decoded by OpenCV back to `…/#/location/Bin A`; the location screen, labels and tiled sheet
  checked at 1280 × 720 and 390 × 844.
- **Browser (v2b, 2026-11-14):** a synthetic envelope scanned through the real client in a local
  Tesseract worker: 88% confidence, `Hinterland Shirt` / `Sew Liberated` / `1234` / `pdf` / `shirt`
  / sizes 0–18 / views A, B, then saved and read back with **2 views**; the review checked at
  1280 × 720 and 390 × 844. 174 tests, `tsc` clean, `npm audit` clean.

## 13. Open decisions

- **Photos as rows** (BLOB) versus files on disk — leaning rows for one-file backup; confirmed
  only if typical photos keep the DB reasonable.
- **Pattern PDFs — resolved 2026-11-14.** The pattern owns the file; it is a row, exported with the
  record, capped at 25 MB. Page count and thumbnail are client-rendered, so no server PDF parser.
- **Tiled printing — resolved 2026-11-14.** Client-side pdf.js, 100% physical scale, A4/Letter,
  10 mm default overlap; no server renderer and no pattern data leaves the box.
- **Envelope OCR — resolved 2026-11-14.** Local browser WASM (Tesseract.js) in a worker; no third
  party and no upload. The photo is discarded after review, the raw text is not stored, and every
  result is a suggestion the person confirms. The engine is lazy-loaded; the CSP gains only
  `'wasm-unsafe-eval'`.
- **Pattern source**: free-text, or a curated list of houses (Simplicity, McCall's, …)?
- **Open, added 2026-11-15** (each debated in `v2-plan.md`): whether a fabric's totals are stored or
  derived once cuts land (§15); the colour-swatch honesty caveat — a phone photo is not a
  colour-managed value (§18); the SSRF guard, which is a requirement rather than a decision (§19);
  and where a BYOK model key lives, given there is no encryption at rest (§20).
- **Open, added 2026-11-16:** the fabric **role** vocabulary, and whether `RequirementRole` aligns to
  it outright — one word ("interfacing") currently means a fabric and a counted notion at once
  (`v2-plan.md` §22).
