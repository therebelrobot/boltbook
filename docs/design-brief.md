# boltbook — Design Brief

**Document version:** 1.0 · **Last updated:** 2026-11-14
**Companions:** `product-brief.md` (what and why), `technical-design.md` (how)
**Draws on:** `mobile-native`, `apple-design`, `emil-design-eng`, `gestures`
**Status:** proposed — no UI built yet.

This is the client's brief: how it looks, moves, and feels. The product brief says *what*
boltbook does; the technical design says *how*; this says what it should feel like to use,
and the rules that get it there. Where a rule and a preference disagree, the rule wins unless
there is a measured reason.

---

## 1. The feel

**Calm, quick and domestic** — a well-kept workbook, or a library card catalogue, not a
gamified tracker and not an enterprise dashboard. You open it at the shelf for ten seconds and
get an answer; you open it at the machine to record what you just bought.

Emotion to reinforce: **confident and unhurried.** Delight here is not confetti — it is the
quiet satisfaction of a list that is correct and a number that is right. Every decision below
serves that; anything that draws attention to itself instead of the fabric is wrong.

---

## 2. Principles (how to decide when unsure)

1. **Purpose.** Every field and control earns its place. The common path — *add a bolt*,
   *what is on hand* — is one tap from the shell; everything else is one level deeper.
2. **Agency.** Undo for anything reversible; a confirmation dialog only for the genuinely
   irreversible. Overusing confirmations trains people to tap through them.
3. **Simplicity, not minimalism.** A row shows what you scan for (name, fibre, remaining
   length, location). The rest lives on the detail screen. Trimming to nothing would make it
   harder, not simpler.
4. **Familiarity.** Bottom tabs, list → detail, swipe-to-delete with undo, pull-down to add.
   Nothing is invented that the platform already teaches.
5. **Craft.** Type, spacing, light/dark, safe areas, and the meter (§7) are deliberate, not
   default. Misalignment and broken rotation read as carelessness.
6. **Feedback, four kinds.** Status, completion, warning, error — and *validate inline*, not
   on submit.

---

## 3. Layout and navigation — mobile first

The phone at the shelf is the design; the desktop is an adaptation of the same source, not a
second design.

```
┌───────────────────────────────┐
│ header: title · primary action │  ← safe-area top, content scrolls under (§8)
├───────────────────────────────┤
│                               │
│   content (list, detail, form)│  ← the only scroll container
│                               │
├───────────────────────────────┤
│  Stash  Patterns  Projects  🔍 │  ← bottom tab bar, safe-area bottom
└───────────────────────────────┘
```

- **Shell height is `100dvh`** (not `vh`) so the tab bar is never under the URL bar.
- **Bottom tabs** for the four top-level places; **Settings** from the header, not a fifth tab.
- **Primary actions sit in the bottom half** — the reachable zone for a thumb. Nothing critical
  lives in the top corners.
- **Lists → detail.** Editors (fabric, pattern, project) open as full-height sheets on the
  phone; the same screens become a two-pane layout at ≥ 900 px, which is a reflow of one
  component tree, not a separate route set.
- **The tab bar is a translucent material** (§8) with content scrolling under it.

---

## 4. The mobile-native baseline — ship before the first component

The floor from `mobile-native`. It is not polish; it is what decides *installable app* versus
*website in a browser*.

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0a0a0a" />
<meta name="color-scheme" content="light dark" />
```

```css
html {
  -webkit-tap-highlight-color: transparent;   /* kill the grey tap flash */
  -webkit-text-size-adjust: 100%;             /* no font inflation in landscape */
  overscroll-behavior: none;                  /* no pull-to-refresh hijack */
}
input, textarea, select { font-size: 16px; }  /* no zoom-on-focus */
button, a, [role="button"] { touch-action: manipulation; }        /* no 300ms delay  */
button, [role="button"] { user-select: none; -webkit-user-select: none; } /* controls only */
@media (hover: hover) and (pointer: fine) { /* every :hover rule lives here */ }
```

**Never ship:** `user-scalable=no` / `maximum-scale=1`; ungated `:hover`; `100vh` on the shell;
press feedback on `click` only; `touchmove` + `preventDefault()` to stop overscroll;
`user-select: none` on `body`; `env(safe-area-inset-*)` without `viewport-fit=cover`; one
`theme-color` for both schemes.

---

## 5. Motion language

Governed by the `emil-design-eng` decision order and the `apple-design` spring model. Applied
to boltbook, where most screens are **scan-and-act** and should therefore be mostly still.

**Should it animate at all?**

| Surface | Frequency | Decision |
|---|---|---|
| Checking remaining yardage | many times/day | **no animation** — data, not a transition |
| Filtering / searching the stash | many times/day | **no animation** on results |
| Opening a fabric/pattern sheet | occasional | animate (sheet, below) |
| Saving a record | occasional | toast in, auto-out |
| Adding/removing a photo | occasional | small entrance, no bounce |
| Swipe-to-delete a row | occasional | spring on release + undo |

**Tokens** (define once, never fork a second curve):

```css
--ease-out:    cubic-bezier(0.23, 1, 0.32, 1);      /* enter / press — default */
--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1);     /* on-screen movement */
--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1);      /* full-width sheet, ~500ms */
```

**Durations:** press 100–160 ms · tooltips/popovers 125–200 ms · **sheets 200–500 ms** (the
documented exception) · everything else under 300 ms.

**Rules:**
- Feedback on **press**, not release: `transform: scale(0.97)` on `:active`, 160 ms `ease-out`.
- **Nothing enters from `scale(0)`** — start at `scale(0.95)` + `opacity: 0`.
- **Exit is faster than enter** (enter 250 ms, exit 200 ms).
- Popovers scale from their **trigger** (`transform-origin`); modals stay centred.
- Enter and exit on the **same axis**.
- Springs for anything a finger can grab; **CSS transitions, never keyframes**, for anything
  interruptible.
- `@media (prefers-reduced-motion: reduce)` → cross-fades only, no movement, no overshoot.

---

## 6. Gestures

From `gestures`: a gesture has two phases, and mixing them is the usual defect.

> **Finger down → tracking.** Position is the finger, 1:1. No easing, no spring, no duration.
> **Finger up → physics.** A spring seeded with the release velocity, or a CSS transition.

**Inventory (deliberately small):**

| Gesture | Where | Notes |
|---|---|---|
| Swipe-to-delete + undo | fabric / pattern / photo rows | dismiss on distance **or** velocity; settles along the row's own axis; undo toast |
| Drag-to-dismiss sheet | every editor sheet | **use Vaul** — do not hand-roll a drawer |
| Pull-down to add | top of the Stash list | optional; must not fight `overscroll-behavior` |
| Camera capture | fabric photo field | platform picker, not a custom UI |

Rules: hit targets **≥ 44 × 44 px** (grow a small one with an invisible `::before` hitbox);
`touch-action` set on the drag axis; **never a keyframe on a gesture surface**; no bounce on
something closed by a button (no force was applied), a little bounce on something flung;
rubber-band at edges instead of a hard stop; ignore extra fingers mid-drag. Swipe-to-delete
does **not** fight the scroll: a row only commits to a swipe after a ~10 px horizontal-intent
threshold, so a vertical scroll is never stolen.

---

## 7. Components

- **Adding a fabric is camera-first** — the primary action opens the camera, the photo leads the
  form (it sits above the fields, not below them), and every field is skippable, because a photo
  and a name is a valid bolt.
- **The fabric row** — swatch/photo thumb · name · `fibre · width` · **remaining length** ·
  location. The remaining length is the number the whole app exists to answer.
- **The yardage meter** — a thin bar: remaining against original, with the reserved slice
  (from active projects, technical design §8) marked distinctly. This is the one place a small
  amount of visual grammar earns its keep; it must stay legible at a glance and in reduced
  contrast.
- **The shortfall callout** — when a project needs more than is on hand: the metres short, as a
  calm warning. **No animation** — it is information, and it appears while the user is reading.
- **Finishing a project** may attach one optional photo of the made garment. Optional, never
  required, never blocking.
- **Chips** — fibre, tags. Tappable, with the tap target padded out to 44 px.
- **Tags are a shared vocabulary.** One tag field on every record type, with the tags already in
  use offered as one-tap chips (most-used first) so the set converges instead of sprawling.
  Tags can be filtered on, and a search finds a record by its tag.
- **Forms** — `inputmode="decimal"` for yardage, `inputmode="numeric"` for counts, 16 px inputs,
  inline validation, `enterkeyhint="done"`.
- **Empty states** — "No fabric yet. Take a photo of the first bolt, or type it in." Every list
  has one, and it carries the primary action.
- **Toasts** — Sonner-style: one `Toaster`, called from anywhere, `ease`, ~400 ms, pause when
  the tab is hidden.

---

## 8. Type, colour, materials

- **System font first** (`system-ui`); it already ships optical sizing and legibility tuning.
- **Tracking is size-specific** — tight headings (`-0.02em`), body near `0`. **Leading runs
  inversely to size.** Build hierarchy from weight + size + leading as a set, never size alone.
- **Spacing in `rem`** so a larger Dynamic Type setting scales the layout instead of breaking it.
- **Light and dark both designed**, with `theme-color` per scheme (the status bar must match the
  header, not the brand colour).
- **Translucent chrome**: header and tab bar as `backdrop-filter: blur()` layers with content
  scrolling under, and a **scroll-edge fade** instead of a 1 px divider. **Never stack a light
  translucent surface on another.** `prefers-reduced-transparency: reduce` → solid;
  `prefers-contrast: more` → defined borders.
- **Theme follows the system** (`prefers-color-scheme`). There is no in-app light/dark toggle in
  v1.
- **Units are a device preference.** Lengths are stored metric; the interface shows and accepts
  either metric or imperial (fabric in yards, width in inches, thread in yards), chosen in
  Settings and remembered on the device. The default follows the browser locale — `en-US` gets
  imperial. A length the user did not touch is sent back exactly as stored, so opening an editor
  and saving can never quietly move 2500 mm to 2496.

---

## 9. Edge cases — what to break first

Run the `break-ui` pass before any screen is called done, behind a "worst case" toggle:

- a fabric name long enough to wrap three lines, and one that is one character;
- unbreakable text (a URL as a name), non-Latin script, emoji, mixed direction;
- **zero** fabrics, and **1000+** (list performance — see the brief's one-second bar);
- a fabric with no photo, and one with ten;
- yardage of 0 m and of 300 m; a shortfall larger than the bolt;
- a location string used as a tag, a tag used as a location;
- the sheet open with the keyboard up, in landscape, on the smallest supported phone.

Each break found gets a fix or a documented decision, not a shrug.

---

## 10. Accessibility and target size

Targets ≥ 44 × 44 px; body contrast ≥ 4.5:1 in both schemes; **zoom is never disabled** (fix
the input font size instead); reduced-motion, reduced-transparency and higher-contrast all
honoured; Dynamic Type scales layout (`rem`/`em`, not fixed px); focus is visible and never
trapped; every control has an accessible name; the tab bar does not rely on colour alone.

---

## 11. Verification a phone must do

Device emulation cannot reproduce any of the following — these need real hardware, on a phone a
few years old, with the keyboard open, once in landscape, and once as an installed PWA:

sticky hover after tap · the grey tap flash · `dvh` versus the URL bar · input zoom-on-focus ·
the 300 ms tap delay · pull-to-refresh hijacking scroll · safe-area insets at the notch ·
the software keyboard covering a bottom-pinned field · status-bar colour per scheme.

`mobile-native`'s rule stands: **a fix that was only checked in DevTools is not a fix.**

---

## 12. Decisions

Resolved with the author, 2026-11-14:

| Question | Decision | Note |
|---|---|---|
| Add fabric: camera-first or form-first? | **Camera-first** | The primary action opens the camera; the form follows and every field is skippable — a photo and a name is a valid bolt. |
| Theme: system-only or a manual toggle? | **System only** | Follow `prefers-color-scheme`; no in-app toggle in v1. |
| Does swipe-to-delete fight the list scroll? | **No — the gesture stays** | Gate on horizontal intent (~10 px) so a vertical scroll is never stolen; keep the undo toast. |
| A photo of the finished garment? | **Yes, and optional** | One optional photo when a project reaches `done`; never required, never blocking. |
| Does a scanned storage label open a filter or a place? | **A place** | `#/location/<name>` lists every kind stored there; it answers "what is in this bin?" without first choosing a stash tab. |
| Tiled print: server or client? | **Client** | pdf.js rasterises in the browser; no pattern leaves the box and no server renderer enters the dependency register. |

---

## 13. Print

Print is a **different surface**, not a screen with a different stylesheet.

- **Paper is white and ink is black**, in both colour schemes. Do not print the dark theme. Use
  `print-color-adjust: exact` so the QR stays black and the dashed cut lines survive.
- **Labels**: 2 × 5 at 88 × 46 mm, 8 mm page padding, A4 or Letter — the same grid fits both. The
  QR is 34 mm at error-correction H; the centre mark is ≈3% of the code, well inside H's recovery.
  Name first, counts second, the app name as a small kicker. A dashed cut line, not a solid box.
- **Tiled print**: 100% physical scale (never "fit to page"), 10 mm default overlap, a 4 mm
  registration cross at each corner, and a **50 mm scale-check square on the first sheet**. Each
  sheet says where it belongs (`P1 · 1/5 · 1/5 · 1/25`) in 6 pt grey. Print at actual size, margins
  off; the hint says so.
- **The preview is a page, not a form.** On a phone a 210 mm page is wider than the viewport, so the
  preview scrolls from its left edge (`justify-content: safe center`) — never centring the overflow
  out of reach. The controls stay above it; on print they disappear.
- **Print never traps.** Escape or Close leaves the overlay; a sheet underneath does not also close
  on that Escape.
