# boltbook — Technical Design

**Document version:** 1.0 · **Last updated:** 2026-11-14
**Companion:** `product-brief.md`, `adr/0001-no-encryption-at-rest.md`
**Status:** proposed — nothing below is built yet.

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
  export.ts        build the zip (json + photos)
  staticAssets.ts  read dist/client into an allow-list at startup
client/
  main.tsx  App.tsx  router.ts  api.ts  styles.css  useCollection.ts
  fields.ts        field descriptors per entity, so every editor is one component
  format.ts        display helpers (pure, unit-tested)
  units.ts         metric ↔ imperial (pure, unit-tested)
  photo.ts         downscale + EXIF strip, client-side
  components/      AppShell, Sheet (drag-to-dismiss), EntitySheet, PhotoField, Toast
  screens/         Access, Stash, Patterns, Projects, Search, Settings
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
       length_mm, original_length_mm, source, cost_minor, currency,
       acquired_on, location, care, notes, created_at, updated_at)

fabric_photo(id PK, fabric_id FK→fabric ON DELETE CASCADE, position,
             content_type, bytes BLOB, width_px, height_px)

pattern(id PK, brand, number, name, format, size_min, size_max, difficulty,
        category, source, year, tried_and_true INTEGER, link_url, notes,
        created_at, updated_at)

pattern_view(id PK, pattern_id FK→pattern ON DELETE CASCADE, label,
             description, position)

pattern_requirement(id PK, pattern_view_id FK→pattern_view ON DELETE CASCADE,
                    role, fabric_width_mm, length_mm, note)
                    -- role: main | lining | interfacing | other

notion(id PK, name, kind, colour, spec, quantity REAL, unit, location,
       notes, created_at, updated_at)
       -- kind: button | zipper | interfacing | elastic | trim | other

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

project_fabric(project_id FK, fabric_id FK, length_mm_used INTEGER,
               PRIMARY KEY(project_id, fabric_id))

project_notion(project_id FK, notion_id FK, quantity_used REAL,
               PRIMARY KEY(project_id, notion_id))

tag(id PK, name UNIQUE)
tag_link(tag_id FK, entity_type, entity_id, PRIMARY KEY(tag_id, entity_type, entity_id))
         -- entity_type: fabric | pattern | project

account(singleton_id INTEGER PK CHECK(=1), created_at, scrypt_n, scrypt_r, scrypt_p,
        passphrase_salt BLOB, passphrase_hash BLOB,
        totp_secret TEXT NULL, totp_last_accepted_counter INTEGER)
        -- no recovery columns and no wrapped key: nothing is encrypted (adr/0001)

audit_log(id INTEGER PK AUTOINCREMENT, at, event, ip_address, user_agent)
```

`length_mm` on `fabric` is **remaining**; `original_length_mm` is what was bought.
`project_fabric.length_mm_used` is the record of what each project took.

Indexes: `fabric(fibre)`, `fabric(location)`, `pattern(brand)`, `project(status)`,
`pattern_view(pattern_id)`, plus the FTS tables in §6.

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
POST   /api/fabrics/:id/photos        multipart, one photo
DELETE /api/fabrics/:id/photos/:photoId
GET    /api/fabrics/:id/photos/:photoId   raw bytes, immutable cache

GET/POST        /api/patterns
GET/PUT/DELETE  /api/patterns/:id
POST/PUT/DELETE /api/patterns/:id/views[/:viewId]
POST/PUT/DELETE /api/patterns/:id/views/:viewId/requirements[/:reqId]

GET/POST        /api/notions
GET/PUT/DELETE  /api/notions/:id

GET/POST        /api/projects
GET/PUT/DELETE  /api/projects/:id
PUT             /api/projects/:id/allocations   { fabrics[], notions[] }

GET/POST        /api/tags
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

`GET /api/search?q=` runs a ranked `BM25` `MATCH` and returns hits with the entity type, a
title, the best snippet, and — for fabric — remaining `length_mm`. Free text is tokenised and
each word is quoted as a prefix term (`"linen"*` joined by `AND`), so user punctuation can never
be read as FTS5 syntax.

**Tags are a second pass, not an FTS column.** FTS5 tables here are external-content, so a
`tags` column would have to be a real column on the source table — and every tag write would then
have to re-index the owning record. Instead, `searchAll` unions the FTS hits with the records
whose *tags* match any token (`repository/tags.searchByTag`), de-duplicating by entity and
setting the snippet to `tags: …`. FTS covers the fields; the union covers the labels. At a
personal scale this is simpler than maintaining five tag-indexing trigger sets, and it is honest
about what matched.

## 7. Photos and files

Photos are **rows**, not files, so the whole record is one file to copy. **Built 2026-11-14.**

- One image per request, sent as **raw bytes** with the image's own `Content-Type` (not
  multipart) — `POST /api/fabrics/:id/photos`. Accepted types are JPEG, PNG and WebP; the body
  is capped at 8 MB, and a fabric holds at most **20** photos.
- Dimensions ride in `?widthPx=&heightPx=` so the client can reserve the right box before the
  image loads (the design brief forbids layout shift).
- Served by id with a long `immutable` cache — **the id is the cache key**, so a replaced photo
  gets a new id and never serves stale bytes.
- **Downscale and EXIF/GPS stripping are the client's job**, not the server's; the server accepts
  what it is given and only enforces type and size. The client half arrives with M5.
- Attached **pattern PDFs are links, not uploads** (v1): the row stores a URL or a path on the
  box. Owning pattern binaries is a v2 question.

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

`node:sqlite` is built into Node 26 — no dependency, no native build. Per the standing
directive, the **EOL and CVE check runs at M1** across this list before any of it is installed;
Node itself is 26 LTS (verified 2026-11-14). All licences above are compatible with Unlicense.

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
| M7 | Ship | Dockerfile (multi-stage), compose, reverse proxy notes, deploy |

Auth (M4) could land before M1's later parts; the plan keeps it early enough that nothing ships
unauthenticated.

## 12. Verification

- **Unit (`node --import tsx --test test/*.test.ts`):** `shortfall.ts` (short, exact, reserved,
  too-narrow, done-decrements), migration runner (idempotent, versioned), auth (wrong passphrase,
  wrong setup token, replay-protected TOTP, session expiry), search query building.
- **Integration:** each API route with an in-memory database (`:memory:`), asserting status and
  body shape from `shared/model.ts`.
- **Lossless record:** create a fabric with a photo, read it back, byte-compare the photo.
- **Instance:** a fresh `:memory:` app prints one setup token; `POST /api/setup` twice fails the
  second time; an unauthenticated `/api/*` read is refused with no data.
- **Perf:** a 100+ fabric stash filters under a second (brief §7).

## 13. Open decisions

- **Photos as rows** (BLOB) versus files on disk — leaning rows for one-file backup; confirmed
  only if typical photos keep the DB reasonable.
- **Pattern PDFs**: link-only in v1 (as above) or store the file.
- **Pattern source**: free-text, or a curated list of houses (Simplicity, McCall's, …)?
