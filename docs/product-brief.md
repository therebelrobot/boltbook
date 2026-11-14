# boltbook — Product Brief

**Document version:** 1.0 · **Last updated:** 2026-11-14
**Companion:** `technical-design.md` (not yet written)
**Tier:** Lightweight (`rrf-00-triage`) — provisional

---

## 1. The problem

A sewer owns more than they remember.

Fabric bought on a whim, a pattern book from three years ago, the interfacing that is
*definitely* in a box somewhere — the inventory lives in memory, in a notes app, in a
screenshot, or in three places at once. When a new project starts, the first question is
*do I already have this?* and the honest answer is *I think so, but I'd have to look.*

Threadloop and Stash Hub solved this — as hosted, account-based services. They want your
fabric on their server, your patterns in their database, your habit in their subscription.
For someone who already runs their own box, that is the wrong trade: the data is small, the
domain is private, and the value is the record, not the network.

dressform solves the neighbouring problem — drafting and designing a pattern. It does not,
and should not, remember what you own.

### 5 Whys

| # | Question | Answer |
|---|---|---|
| 1 | Why does a project start with "did I buy that already?" | The stash is physical and unindexed. |
| 2 | Why is it unindexed? | Nothing records it at the moment of acquisition, in a place that is searchable later. |
| 3 | Why nothing? | The tools that do this — Threadloop, Stash Hub — are hosted SaaS with an account. |
| 4 | Why does hosted matter? | The stash and the pattern library are private, personal and permanent; a subscription is a recurring risk to owning your own record. |
| 5 | Why not use the SaaS anyway? | The data is tiny and local, the user already self-hosts, and the whole point is to *own* it. |

**Root cause:** the record of what you own has no home that is both private and durable.
Notes apps have no structure; spreadsheets have structure but no photographs, no links, no
search worth using; SaaS has all of it but hands your record to someone else.

---

## 2. Who this is for

**Primary and only user: one person.** Single user, one box.

Specified well enough to publish — the repo is public, Unlicense — but v1 is a personal
tool. A public launch would be a separate initiative with its own triage.

---

## 3. The journey

**Before**

1. Start a project. Think *I have a linen that would work.*
2. Search a notes app, a photo roll, a shelf. Find three candidates, none measured.
3. Buy more linen, because measuring is harder than buying.
4. Later: find the first linen, unused.

Cost: duplicate purchases, forgotten fabric, and patterns bought twice.

**After**

1. Open boltbook. Filter the stash by fibre = linen, weight = mid, ≥ 2 m available.
2. Pick a bolt; see its yardage, width, colour, and which patterns it already fits.
3. Link it to a pattern; boltbook shows the yardage the view needs and what is left over.
4. Sew. Mark the project done; the yardage comes off the bolt.

Cost: seconds, and the record stays true.

---

## 4. Scope

Fabric and patterns are both first-class from day one, linked.

### In, v1 — the stash (fabric)

- Fabric items: fibre/content, weight, colour/print, yardage (length + width), source or
  supplier, cost, date acquired, storage location, care, notes, one or more photos.
- Remnants: a bolt splits as it is used; remaining yardage is tracked.
- Search and filter: fibre, weight, colour, available yardage, location, tags.

### In, v1 — patterns

- Pattern items: brand/maker, number, name, format (paper envelope / PDF / book), size range,
  difficulty, category, source, year, notes, tags, link.
- **Views:** a pattern has one or more views (A/B/C), each with its own yardage requirement
  and notions.
- Attach files: a pattern links to a PDF or scans. The record holds the link and a page
  count; it is not a file host.
- Marked *tried and true*: a pattern known to fit.

### In, v1 — notions

- A simple notion inventory: thread, buttons, zippers, interfacing, elastic, trims —
  quantity and location.

### In, v1 — the linkage

- Allocate fabric (and notions) to a pattern view → a **project**: planned, cutting, sewing,
  done.
- A view lists the yardage it needs; the allocation names what is short before the project
  starts.

### In, v1 — the app

- One sign-in, single user: a one-time setup token to claim the instance, then a passphrase
  (optional TOTP) — the same shape as the author's other self-hosted tools.
- One container behind a reverse proxy with an edge access layer; hostname and port are
  deployment configuration and stay out of the repo.
- Local storage; export/backup of everything in one file.
- Works on the phone at the shelf and on the desktop at the machine.

### In, v2

- Pattern envelope/front photo OCR → prefill brand, number, sizes.
- Tiled PDF print at scale (A4/Letter) from an attached PDF.
- Shopping list from a project's shortfalls.
- Barcode/QR labels for storage bins.
- Import from a Threadloop or Stash Hub export.

### Out

| Not doing | Reason |
|---|---|
| Drafting or designing a pattern | That is dressform. boltbook never draws a piece or drafts a garment. |
| **Encryption at rest** | Lower-stakes than a journal or therapy log. The boundary is the box, the proxy and the sign-in; the SQLite file is plaintext. See §5. |
| Multi-user, accounts, sharing, sync | One user, one box. |
| A hosted or cloud version, native mobile apps | Browser only. |
| Shopping or a marketplace | The opposite of the point. |
| AI style or design suggestions | Not the problem being solved. |
| Sewing instruction or technique | A different product (the sewing skill). |
| Public social profiles, feeds, following | Private by default. |

---

## 5. Technical context

Detail and rationale live in `technical-design.md`, still to be written. Shape so far:

- **Auth is the house model.** The resonate/reframe pattern: `BOLTBOOK_SETUP_TOKEN` (random,
  logged at start) claims a fresh instance exactly once; then a passphrase session (12+
  characters, optional TOTP) with a `__Host-` `HttpOnly` `Secure` `SameSite=Strict` cookie
  whose random token is held server-side only as a SHA-256 hash; every state-changing request
  carries a custom header and a same-origin `Origin`. Reuse this rather than invent a fourth
  variant.
- **No encryption at rest — decided 2026-11-14.** resonate and reframe wrap the database
  (AES-256-GCM envelope, key derived from the passphrase via scrypt). boltbook does not: the
  stash and pattern library are lower stakes, and the box, the proxy and the sign-in are the
  boundary. The consequence, stated so it is not a surprise: `boltbook.db` and every backup
  of it are plaintext. This is an ADR to write before the schema lands.
- **Data is SQLite on a volume** — one file to back up.
- **One container** behind a reverse proxy (TLS, HSTS) with an edge access layer in front.
  The hostname and port are deployment configuration and stay out of the repo; a file that
  needs one reads `example.com` or `<docker-host>`.
- **Node 26 LTS**, TypeScript strict. Unlicense.

---

## 6. What "found" means here

Stated plainly, because this is the likely source of disappointment.

boltbook can only answer *do I have this?* if the record was written when the fabric
arrived. It is a memory aid, not a sensor: it does not know what is on the shelf, only what
you told it. A stash that is not entered is invisible to the search, and a yardage that is
not decremented is wrong. The tool narrows the search. It does not close it.

---

## 7. Success criteria

Given/When/Then. UAT judges against these.

### Handoff

- **Given** this brief and the technical design, **when** an implementing agent reads them
  start to finish, **then** it can name every entity, state every relationship between
  fabric, pattern, notion and project, and say what v1 excludes — without a follow-up
  question.

### v1 — the record

- **Given** a fabric item with a photo, fibre and yardage, **when** it is saved and the app
  reopened, **then** every field and the photo are identical to the state at save.
- **Given** a pattern with three views, **when** it is opened, **then** each view's yardage
  requirement and notions are shown separately.
- **Given** a project linking a pattern view to a fabric, **when** the fabric is short of the
  view's requirement, **then** the shortfall is named in metres before the project starts.

### v1 — the search

- **Given** a stash of 100+ fabrics, **when** it is filtered by fibre and minimum available
  yardage, **then** the result appears in under a second.
- **Given** a question like *the linen I could line this jacket with*, **when** it is typed
  into search, **then** matching fabrics are ranked by relevance and show their remaining
  yardage.

### v1 — the instance

- **Given** a fresh container, **when** it starts, **then** it prints one setup token and the
  instance cannot be claimed without it.
- **Given** a claimed instance, **when** a request lacks the session, **then** it is refused
  and no data is in the response.
- **Given** a project is completed, **when** the fabric is decremented, **then** the stash
  total drops by the used amount and the remainder is preserved.

---

## 8. Open questions

- Tier: Lightweight or Comprehensive? *(provisional: Lightweight.)*
- Port and host: deployment-specific; not recorded in the repo.
- Does a pattern *own* its attached PDF, or link to one already on disk?
- Do notions belong in v1, or is fabric + patterns + the link enough to start?
