# 059 — Navigation Architecture for 100+ Research Modules

**ANTIGRAVITY PRO · Chief Product Architect design document**
**Date:** 2026-07-29 · **Status:** DESIGN ONLY — no production code written
**Scope:** navigation, module registry, module page contract, dashboard, scalability to 100+ modules

---

## 0. How to read this document

Every factual claim carries an evidence grade. Grades are never merged; a Verified
number and an Estimated one are not averaged into one figure.

| Grade | Meaning |
|---|---|
| **Verified** | Observed directly on this system and reproduced |
| **Measured** | Produced by an instrument or count in this repo, today |
| **Estimated** | Reasoned from partial evidence |
| **Opinion** | A judgement call, held loosely, reversible |
| **Unknown** | Not established — and left that way |

Recommendations carry a severity class:

| Class | Meaning |
|---|---|
| **S1** | Correctness or safety. Ship before anything built on top of it |
| **S2** | Structural. Cheap now, expensive after 40 more modules |
| **S3** | Quality of life. Real value, no compounding cost |
| **S4** | Deferred by decision, with the reason recorded |

---

# Part 1 — Ground truth: what exists today

Everything below was counted in this repository on 2026-07-29. **Grade: Measured.**

| Dimension | Count |
|---|---|
| HTML pages in `public/` | **25** |
| Pages listed in the navigation rail | **24** (in **5** groups) |
| Pages reachable but *not* listed | 3 (`command.html`, `command-pro.html`, `login.html`) |
| `/api` routes in `server.js` | **140** |
| Root-level `.js` modules | **95** |
| **Modules with no page of their own** | **94 of 95** |
| Test suites | 70 |
| Documents in `docs/` | 123 |
| `server.js` length | 7,079 lines |

## 1.1 The finding that shapes everything below

**94 of 95 modules are invisible from the navigation.** A sample of what a user
cannot reach today: `signal-engine`, `signal-health`, `meta-label`, `gex-skew`,
`option-warehouse`, `pop-seller`, `event-engine`, `crash-analyzer`,
`engine-verdict`, `smart-money`, `vol-context`, `payoff-engine`, `ops-health`,
`confirmed-signals`, `agents-engine`, `gamma-blast-engine`, `bounce-engine`,
`execution-engine`, `afternoon-engine`.

**Grade: Measured.**

Two clarifications that matter for the design, because the raw number overstates
the problem:

- Not all 94 are *destinations*. Many are libraries — `charges.js`, `safe-write.js`,
  `loop-guard.js`, `instrument-guard.js` — with no user-facing surface and no
  business appearing in a menu. **Grade: Verified** (I wrote three of them.)
- Several *are* destinations whose output is buried inside another page's tab
  rather than owning a route. `signal-health` and `gex-skew` are the clearest
  cases. **Grade: Measured** (docs/051-058 record their wiring.)

So the true statement is not "94 modules are missing from the menu". It is:

> **There is no mechanism that decides which modules belong in the menu, and no
> mechanism that notices when a new one is added.** The menu is a hand-written
> array of 24 entries in `public/js/rail.js`.

That is the actual defect. It is **S2 — structural**: harmless at 24 entries,
unrecoverable at 124.

## 1.2 The precedent this design should follow

This repo already solved a structurally identical problem twice, and both
solutions work:

1. **`rail.js` itself.** The page list used to be hand-copied into every page's
   own `<nav>` — 20 pages, 20 divergent copies, which is how `capture.html` and
   `greeks.html` shipped reachable from nothing. One array replaced 175 duplicate
   links. **Grade: Verified.**
2. **`repo-integrity.test.js`.** It fails the build when `server.js` requires a
   file that is not git-tracked. It caught `instrument-guard.js` within minutes of
   that file being created. **Grade: Verified** — it happened today.

The pattern in both: *one source of truth, plus a test that fails when reality
drifts from it.* This design extends that pattern rather than inventing a new one.

---

# Part 2 — The central design decision

## 2.1 Problem

The brief says: "Every new engine should automatically appear in navigation. No
manual menu editing."

Taken literally, this means auto-discovery: scan the filesystem, list what is
found. Applied to today's repo that produces a menu of **95 items**, most of which
are libraries. At 200 modules it produces a menu of 200. It replaces a curated
menu with an unusable one.

Taken as intent, it means something achievable and better: **it must be impossible
to add a module and have it silently fail to appear.**

Those are different requirements and only the second one is buildable.

## 2.2 Options considered

| Option | How it works | Verdict |
|---|---|---|
| **A. Hand-written registry** | A list, maintained by hand | Rejected — this is the current defect with extra steps. It drifts the first busy week |
| **B. Pure auto-discovery** | Filesystem scan is the menu | Rejected — 95 items today, no categories, no ordering, no way to express that `safe-write.js` is not a destination |
| **C. Convention-based** | A module is a destination if it exports a magic symbol | Rejected — invisible coupling. The rule lives nowhere a reader can find it, and a typo silently removes a module from the product |
| **D. Declared registry + discovery audit** | Each module declares its own registry block; a test enumerates every module and fails on any that declares neither a registry entry nor an explicit exemption | **Recommended** |

## 2.3 Recommendation — Option D

**A module's registry entry lives with the module, not in a central file.** The
registry is *assembled* at boot by reading those declarations; it is not
*authored* anywhere.

The "no manual menu editing" requirement is then satisfied precisely:

- You never edit a menu. There is no menu file.
- You do declare, once, in the module you just wrote, what it is and where it
  belongs. That is not menu maintenance — it is the module describing itself,
  the same way it already declares its exports.
- **A module that declares nothing fails the build.** Not a warning. A failure,
  with the module's name and the two ways to fix it: add a registry block, or add
  it to the exemption list with a reason.

**Severity: S2.** **Grade of the reasoning: Opinion**, but grounded in two
Verified precedents in this same repo (§1.2).

## 2.4 The exemption list is the honest part

Every architecture that claims "everything appears automatically" quietly has an
exemption mechanism. Making it explicit and *reasoned* is what keeps it from
becoming a dumping ground:

```
EXEMPT (illustrative schema, not code)
  module: safe-write.js
  reason: library — atomic file writes; no user-facing surface
  reviewed: 2026-07-29
```

A reviewer can read the exemption list and see 60 libraries with 60 one-line
reasons. That is auditable. A silent convention is not.

---

# Part 3 — Top-level navigation

## 3.1 The section budget, and why it is fixed forever

**Eleven sections. This number never grows.** Growth happens in categories, tags
and modules — never in the top level.

Rationale: a top-level menu is the one surface every user must hold in memory. A
12th section costs every user forever; a 60th module in an existing section costs
nobody anything, because nobody browses a 60-item list — they search it (§7).

> **Redesign trigger:** if a genuinely new module cannot be placed in any of the
> eleven sections, that is the signal to revisit this document — not to add a
> twelfth section.

## 3.2 The eleven sections

| # | Section | The question it answers | Primary user |
|---|---|---|---|
| 1 | **Dashboard** | What is happening right now, and what needs me? | Everyone |
| 2 | **Market** | What is the market doing? | Trader |
| 3 | **Research** | What have we learned, and how confident are we? | Researcher |
| 4 | **Trading** | What positions and orders exist? | Trader |
| 5 | **Risk** | What can hurt us, and what is the brake? | Risk owner |
| 6 | **AI** | What are the models saying, and are they right? | Researcher |
| 7 | **Analytics** | How did we actually do? | Everyone |
| 8 | **Historical Data** | What do we have, and is it intact? | Researcher / ops |
| 9 | **System** | Is the platform healthy? | Ops |
| 10 | **Administration** | Who can do what, and what changed? | Admin |
| 11 | **Developer** | How do I extend this? | Developer |

## 3.3 Ordering principle

Sections are ordered by **decreasing frequency of use**, not by importance.
Dashboard and Market are opened dozens of times a day; Developer is opened
weekly. Ordering by importance would put Risk at the top and cost every user a
scan past it a hundred times a day.

**Grade: Opinion.** This is the ordering used by Bloomberg's function menu and by
every trading terminal I would consider a reference. It is reversible.

## 3.4 Sections are permission-scoped, not permission-hidden

The existing RBAC is `viewer < trader < admin` (`auth.js`, `AUTH_ENABLED`
default off). **Grade: Measured** — docs/roadmap records this.

Design rule: a section the current role cannot use is shown **disabled with the
required role named**, not hidden.

*Why.* A hidden section teaches the user the platform does not have the feature.
They then ask for it to be built. A disabled section reading "Administration —
requires admin" teaches them the true fact: it exists and they lack the role.
Hiding is appropriate only where the *existence* of the section is itself
sensitive, which is not the case for any of the eleven.

---

# Part 4 — Menu hierarchy

## 4.1 Depth limit: two levels, never three

```
Section  →  Module
```

Categories exist in the registry and drive grouping *within* a section, but they
are rendered as **headings inside a flat list**, not as expandable folders.

*Why not three levels.* Every level of nesting is a click, and a click is a place
to get lost. Bloomberg does not nest deeply; it flattens and gives you a command
line. At 100+ modules, three-level nesting would mean 5-deep breadcrumbs and users
who navigate by muscle memory to one leaf and never discover the rest.

**Severity of getting this wrong: S2.**

## 4.2 The full hierarchy

Modules already built are marked ✅ (**Measured**, from §1). Modules named in the
brief but not yet built are marked ○.

### 1 · Dashboard
- ✅ Command Centre — `dashboard.html`
- ○ Fleet View — all engines, one grid (§8)
- ○ Latest Discoveries
- ○ Pending Validation

### 2 · Market
*Category: Live*
- ✅ Signal Heatmap · ✅ AMI Heatmap · ✅ OI Analysis · ✅ Heatmap
- ✅ Stock View · ✅ Chart · ✅ 4 Charts · ✅ Patterns
*Category: Chain*
- ○ Option Chain Engine · ○ Strike Behaviour · ○ Expiry Behaviour
- ○ Liquidity Engine · ○ Order Flow

### 3 · Research
*Category: Structure*
- ○ Trend Engine · ○ Market Structure · ○ Regime Engine
*Category: Volatility*
- ○ Volatility Engine · ○ IV Engine · ✅ Vol Context (exists, unrouted)
*Category: Derivatives*
- ○ Greeks Engine (✅ `greeks.html` is the calculator; the *engine* is separate)
- ○ Dealer Gamma Engine · ✅ GEX / Skew (exists, unrouted)
*Category: Probability*
- ✅ PoP Seller · ○ Probability Engine · ✅ Payoff · ✅ Strategy
*Category: Behaviour*
- ✅ Buy Low → Sell High · ✅ Strike History · ○ Pattern Engine
*Category: Paper*
- ○ Paper Trading Research
*Category: Reports*
- ○ Research Reports · ○ Academic Library · ○ Validation Reports

### 4 · Trading
- ✅ Trade Desk · ✅ Strangle Monitor · ✅ 4 Engines
- ○ Order Blotter · ○ Position Book · ○ Execution Quality

### 5 · Risk
- ○ Risk Engine (unified) · ○ Exposure · ○ Halt State & Brakes
- ○ Margin · ○ Event Risk · ○ Stress / Scenario

### 6 · AI
- ✅ AI Agents · ○ AI Dataset · ○ Model Registry
- ○ Prediction Scorecard · ○ Feature Store

### 7 · Analytics
- ✅ Quant Center · ○ Backtest Reports · ○ Forward-Test Ledger
- ○ Attribution · ○ Cost Analysis

### 8 · Historical Data
- ○ Historical Database · ○ Warehouse Browser · ○ Data Quality & Gaps
- ○ Coverage Map · ○ Ingestion Log

### 9 · System
- ✅ Health · ○ Engine Control · ○ Logs · ○ Storage
- ○ Rate Limits & Broker Governance · ○ Scheduler

### 10 · Administration
- ○ Users & Roles · ○ Audit Trail · ○ Configuration · ○ Instrument Registry

### 11 · Developer
- ✅ User Manual · ✅ Strategy Guide · ✅ Data Honesty
- ○ Module Registry Browser · ○ API Explorer · ○ Test & Evidence Index

## 4.3 Migration of the three unlisted pages

**Grade: Measured** — `command.html` and `command-pro.html` are reachable but
unlisted; `dashboard.html` is documented as their superset.

Recommendation: **redirect, do not delete.** A stale bookmark that 404s teaches
the user the platform is broken; one that lands on the successor with a one-line
note teaches them where things moved. `login.html` stays correctly unlisted — it
is pre-auth and must not advertise the app's pages to a stranger.

**Severity: S3.**

---

# Part 5 — Module Registry design

## 5.1 Where it lives

**Distributed declaration, assembled at boot.** Each module carries its own
registry block; a loader collects them; a test enforces completeness. No central
list to edit.

## 5.2 Schema

*Illustrative shape — a design artifact, not an implementation.*

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | slug | ✅ | Stable forever. Renaming the display name must not break favourites, links or audit history |
| `name` | string | ✅ | Display name |
| `section` | enum(11) | ✅ | From §3.2. Enum, not free text — free text is how a twelfth section appears by accident |
| `category` | string | ✅ | Grouping heading inside the section |
| `tags` | string[] | | Cross-cutting: `expiry`, `banknifty`, `paper`, `intraday` |
| `route` | path | ✅ for destinations | Absent ⇒ headless module, appears in the Registry Browser but not the menu |
| `apiRoutes` | path[] | | Which of the 140 `/api` routes this module owns (§5.6) |
| `version` | semver | ✅ | |
| `status` | enum | ✅ | `experimental` · `forward-testing` · `production` · `deprecated` · `retired` |
| `health` | enum | ✅ | See §5.3 — **five** states, not three |
| `evidence` | enum | ✅ | `Verified` · `Measured` · `Estimated` · `Opinion` · `Unknown` — see §5.4 |
| `dependencies` | id[] | ✅ | Other module `id`s. Enables the graph in §5.5 |
| `dataSources` | string[] | ✅ | `upstox-live`, `nse-bhavcopy`, `yahoo`, `internal-warehouse` |
| `permissions` | role | ✅ | `viewer` \| `trader` \| `admin` — maps to existing RBAC, does not invent a parallel one |
| `owner` | string | ✅ | A module with no owner is a module nobody will fix |
| `description` | string | ✅ | One sentence. What it answers, not how it works |
| `docs` | path[] | | Links into `docs/` — 123 documents exist and are currently unlinked from the UI |
| `tests` | path[] | | Links into `test/` — the evidence trail |
| `lastResearchRun` | timestamp | | Set by the module, never by the menu |

## 5.3 Health has five states, and this is load-bearing

| State | Meaning | Colour |
|---|---|---|
| `healthy` | Checked, and passing | Green |
| `degraded` | Checked, running, something is wrong | Amber |
| `failed` | Checked, and not working | Red |
| `unknown` | **No health check exists, or it has not run** | Grey |
| `disabled` | Deliberately off | Dim |

**The critical one is `unknown`.** A three-state model forces "we did not check"
to be rendered as green. That is the dashboard form of `null → 0`, and it is the
single most dangerous thing a status board can do: it converts absence of
information into a positive claim of safety.

**Severity: S1.** This is a correctness rule, not a styling preference. It is the
same rule already enforced in `stock.html` (a blank means *not reported*, never
zero) and in `instrument-guard.js` (an unknown instrument is refused, never
substituted). **Grade: Verified** — both shipped today.

Staleness is separate from health. A module `healthy` at 09:15 and not run since
is **not** healthy at 15:30. The registry stores `lastRun`; the UI derives
freshness and shows `healthy · 6h stale`, never a bare green dot.

## 5.4 Evidence grade belongs in the navigation itself

This is the recommendation I would defend hardest, and it is specific to this
product rather than generic terminal design.

This platform's stated differentiator is **honest, backtested, white-box signals**
(recorded in the competitive research). A navigation that renders a module with a
600-day backtest identically to one validated on a single day silently destroys
that differentiator at the exact moment a user is choosing what to trust.

So: **every module carries a visible evidence badge in the menu, in the module
header, and in search results.**

| Badge | Meaning | Precedent in this repo |
|---|---|---|
| **V** Verified | Observed and reproduced | Instrument registry — broker-verified |
| **M** Measured | Backed by a run in this repo | Strangle: 129 trades, 91% win, 600 days |
| **E** Estimated | Reasoned from partial evidence | Trend-Ride option leg |
| **O** Opinion | Judgement | PoP Seller ranking |
| **?** Unknown | Not established | Gamma-Blast — no backtest is possible yet |

**Grade of the underlying evidence facts: Measured** — all four examples are from
docs/057.

Two hard rules:
1. **Grades never merge.** A module with one Verified input and one Unknown input
   is **Unknown**, not "mostly verified". The weakest link sets the grade.
2. **Unknown is not a failure state.** Gamma-Blast is Unknown *and correct* —
   the data to grade it does not exist yet. The badge describes evidence, not
   quality.

**Severity: S2.**

## 5.5 The dependency graph is the payoff

Once `dependencies` is populated, three things become possible that are impossible
today:

- **Blast radius.** "`option-warehouse` is degraded — 7 modules depend on it."
  Today, answering that means reading 95 files.
- **Honest cascading health.** A module whose dependency is `unknown` cannot
  itself be better than `degraded`. This falls out of the graph automatically.
- **Cycle detection at build time.** A current architecture document records
  **0 import cycles**. That is a property worth keeping, and a graph plus a test
  keeps it. **Grade: Measured.**

## 5.6 Route ownership — the reason `server.js` is 7,079 lines

**140 `/api` routes; no route is attributed to a module.** **Grade: Measured.**

Registering `apiRoutes` per module makes two failures visible that are invisible
today: an **orphan route** (belongs to nothing — the mechanism by which a 7,079-line
file accumulates) and a **duplicate claim** (two modules believe they own one route).

**Severity: S2.** This is also the natural first step toward decomposing
`server.js`, which is a separate project not proposed here.

---

# Part 6 — Every module page: the standard shell

## 6.1 Principle

Every module page renders inside **one shell** that the module does not control.
The module supplies content; the shell supplies identity, status and evidence.

*Why.* A per-page status block is a per-page opportunity to omit the awkward
parts. If the shell owns the evidence badge, a module with Unknown evidence
cannot quietly render as though it were Measured — and the author does not have
to remember to be honest.

## 6.2 Zones

```
┌──────────────────────────────────────────────────────────────────────────┐
│ BREADCRUMB   Research › Volatility › IV Engine        [☆] [⌘K] [?] [⚙]   │
├──────────────────────────────────────────────────────────────────────────┤
│ IDENTITY   IV Engine   v2.3.1                                            │
│            ● healthy · 4m ago   [M Measured]   [forward-testing]         │
│            Source: upstox-live, internal-warehouse                       │
├──────────────────────────────────────────────────────────────────────────┤
│ ALERTS     ⚠ 1 warning — 2 strikes missing from the 14:20 snapshot       │
├──────────────────────────────────────────────────────────────────────────┤
│ [Overview] [Charts] [Metrics] [Evidence] [Performance] [Deps] [Logs]     │
├──────────────────────────────────────────────────────────────────────────┤
│                          MODULE CONTENT                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

## 6.3 The seven tabs

| Tab | Contents | Non-negotiable rule |
|---|---|---|
| **Overview** | What it answers, current output, last research run | States what the module does **not** do |
| **Charts** | Visual output | Every axis labelled with units and source |
| **Metrics** | Numbers, with the window each was computed over | A number without its window is not a number |
| **Evidence** | **Verified facts / Unknown facts** (§6.4) | The two lists are never merged |
| **Performance** | Latency, call counts, cost, cache hit rate | Cost is shown even when it is fine |
| **Dependencies** | Upstream and downstream, with their health | Cascading health is shown, not hidden |
| **Logs** | Errors and warnings, newest first | Empty reads "no errors recorded since <time>", never blank |

## 6.4 The Evidence tab — the product's spine

Two lists, side by side, never merged:

**Verified facts** — each with what was measured, the sample size, the window, and
a link to the test or document that proves it.

**Unknown facts** — each with why it is unknown and **what would resolve it.**

An Unknown with no path to resolution is a research backlog item that has not been
written down. Forcing the "what would resolve this" field turns the Unknown list
into the research roadmap.

Worked example, from real recorded state (**Grade: Measured**, docs/054):

> **Unknown:** the hero-zero base rate.
> **Why:** restarts erased the morning of every session before 2026-07-08; the
> single clean day (67% ≥2×) was one down-move, so PE 100% / CE 0% — effective n≈1.
> **Resolves when:** 20 clean sessions starting by 09:20, scored per-side, net of costs.

That is a better research plan than most research plans, and it is a *side effect*
of the page contract.

## 6.5 Two failure modes the shell must prevent

1. **The all-green board.** If every module reads `healthy`, either the platform is
   perfect or the checks are not real. The shell must show, on the Fleet View, how
   many modules have **no health check at all** — the `unknown` count is the honesty
   metric of the whole system.
2. **The stale-but-green module.** Health without recency is a claim about the past
   presented as a claim about the present. Freshness is always rendered next to
   health, never separately.

---

# Part 7 — Navigation mechanics at 100+ modules

## 7.1 The core insight

**Above roughly 40 modules, browsing stops being the primary interface.** This is
what every institutional terminal converged on: Bloomberg's four-letter mnemonic
plus `<GO>` is not a shortcut bolted onto a menu — it *is* the interface, and the
menu is for discovery and for people who do not yet know what exists.

So the design has two interfaces with different jobs:

| Interface | Job | Users |
|---|---|---|
| **Tree** (rail) | Discovery. "What does this platform have?" | New users, browsing |
| **Quick Jump** (`⌘K` / `Ctrl-K`) | Retrieval. "Take me to IV Engine." | Everyone, daily |

Building only the tree produces a platform that is exhausting at 100 modules.
Building only the palette produces one nobody can learn.

## 7.2 Quick Jump requirements

- Opens on `Ctrl-K` / `⌘K` from **anywhere**, including inside inputs, with `Esc` to close
- Searches `name`, `id`, `tags`, `category`, `description`, and **route aliases**
- Fuzzy, ranked: exact `id` > name prefix > tag > description
- **Ranks by personal frequency.** A user who opens the Strangle Monitor forty
  times a week should get it first for "st" — usage is the best relevance signal
  and it is free
- Shows health, freshness and **evidence badge** on every result — so the choice
  of what to trust is made *before* the click, not after
- Works with zero results: "No module matches 'xyz'. 3 documents do." — search
  spans `docs/` too, because 123 documents exist and are currently unlinked
- **Never navigates on a single keystroke.** Enter commits

## 7.3 Favourites and Recents

- **Favourites** — user-pinned, appear above all sections, reorderable. Stored per
  user, keyed on module `id` (§5.2), so renaming a module does not orphan them
- **Recents** — last 8, automatic, **never mixed into Favourites**. Automatic and
  deliberate lists must look different, or the user stops trusting both

## 7.4 Tags — the cross-cutting axis

Categories are a tree and therefore force a single parent. Tags are a graph.
A module about BANKNIFTY expiry-day gamma belongs to one category and to the tags
`banknifty`, `expiry`, `gamma`, `intraday`.

Tag pages (`/tag/expiry`) are the answer to "show me everything about expiry
behaviour", which no tree can answer.

## 7.5 Breadcrumbs

`Section › Category › Module`, every element clickable, always present. With a
two-level tree the breadcrumb is never longer than three elements — which is the
second reason for the two-level limit in §4.1.

## 7.6 Keyboard model

| Key | Action |
|---|---|
| `Ctrl-K` | Quick Jump |
| `g` then `d` / `m` / `r` / `t` | Go to Dashboard / Market / Research / Trading |
| `b` | Collapse or expand the rail *(already implemented — **Grade: Verified**)* |
| `[` `]` | Previous / next module within the section |
| `1`–`7` | Switch tab within a module page |
| `f` | Toggle favourite |
| `?` | Keyboard help |
| `Esc` | Close overlay |

Single-letter shortcuts must be suppressed inside inputs. `rail.js` already does
this correctly for `b` — **Grade: Verified** — and that guard is the pattern to
reuse.

## 7.7 Dark mode

**Dark is the default and the design target.** This is a decision already taken and
implemented via `tokens.css`. **Grade: Verified.** A light theme is **S4 —
deferred**: it is a genuine accessibility feature, and it doubles the surface of
every colour decision on a platform where colour carries meaning (green/red is
P&L, amber is warning, grey is *unknown*). Deferred with the reason recorded, not
forgotten.

## 7.8 Mobile

**Honest scope statement:** this platform is built for a 32-inch 2560×1330 display
and every page is measured against it. **Grade: Verified.**

A 100-module research terminal is not a phone product, and pretending otherwise
produces 100 unusable phone pages. The recommendation is a **deliberate subset**:

| Tier | Target | Content |
|---|---|---|
| **Full** | ≥1400 px | Everything |
| **Compact** | 900–1400 px | Everything; denser, rail collapsed |
| **Mobile** | <900 px | Dashboard, Fleet View, alerts, Quick Jump, read-only module Overview + Evidence |

Mobile answers "is everything all right?" and "what did we learn?" — not "let me
rebuild a payoff diagram".

**Severity: S3.**

---

# Part 8 — Dashboard architecture

## 8.1 The question it answers

Not "what data do we have" — that is every other page. The Dashboard answers:

> **What needs me right now, and what has changed since I last looked?**

A dashboard that shows sixteen healthy panels every day trains the user to stop
reading it. The design must be **exception-first**.

## 8.2 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ROW 1 — NEEDS ATTENTION        (empty state: "Nothing needs attention.  │
│         failed · degraded · stale · halted · unknown-health              │
│         Every module checked and fresh as of 15:31.")                    │
├──────────────────┬──────────────────┬───────────────────────────────────┤
│ ROW 2  FLEET     │  RESEARCH        │  DATA & STORAGE                   │
│  running / stopped│  runs today      │  warehouse size, growth/day       │
│  by section      │  pending validation│ coverage %, gaps, last ingest    │
│  unknown-health ⚠│  latest discoveries│ AI dataset rows, last built     │
├──────────────────┼──────────────────┼───────────────────────────────────┤
│ ROW 3  SYSTEM    │  PERFORMANCE     │  EVIDENCE LEDGER                  │
│  uptime, memory  │  p50/p95 latency │  V / M / E / O / ? module counts  │
│  broker calls,   │  slowest routes  │  what moved grade this week       │
│  429s, hit rate  │  cache hit rate  │  forward-test gate: n/30          │
└──────────────────┴──────────────────┴───────────────────────────────────┘
```

## 8.3 Panels that are non-obvious and worth the space

**Unknown-health count.** The number of modules with no working health check. If
this is not on the dashboard, it is nobody's job and it grows forever.

**Evidence ledger.** How many modules sit at each grade, and what changed grade
this week. This makes research progress *visible as a number* — a module moving
Unknown → Measured is the platform's actual output, and today nothing records it.

**Forward-test gate.** Already exists in substance: *"INSUFFICIENT — only 22/30
forward trades."* **Grade: Measured**, docs/057. It belongs on the front page,
because it is the one number standing between paper and real money.

**Broker call governance.** Refusals, hit rate, cooldowns. **Grade: Verified** —
these counters exist and were the subject of the 458→0 fix. A literal `0` in a
stats object is as dangerous as a silent catch, and the dashboard is where a
suspicious zero gets noticed.

## 8.4 Latest Discoveries — define it or it becomes a blog

A "discovery" needs a definition or the panel fills with noise. Proposed:

> A **discovery** is a recorded change in an evidence grade, or a validated result
> that contradicts a previously held one.

Both are machine-detectable from the registry. Under that definition, today's
genuine discoveries would include: *NIFTY multi-confirm intraday has no edge
(PF 0.94 over 1,200 trades)* and *pop-seller had NIFTY/SENSEX expiry weekdays
swapped*. **Grade: Measured**, both recorded.

Negative results appear here. A platform that only publishes discoveries that
worked is not a research platform.

---

# Part 9 — Folder structure

*Target structure. Presented as design; migration is a separate exercise.*

```
public/
  index.html                 shell — rail, quick jump, breadcrumb, theme
  css/  tokens.css           the palette (exists)
  js/
    rail.js                  renders FROM the registry (today: a hand-written array)
    registry-client.js       fetches and caches the assembled registry
    quick-jump.js            ⌘K palette
    module-shell.js          identity · health · evidence · tabs (§6)
    fit.js                   viewport fitter (exists)
  modules/
    <section>/<module-id>.html
      market/signal-heatmap.html
      research/iv-engine.html
      risk/exposure.html

modules/                     server side, one folder per module
  <module-id>/
    index.js                 the module
    registry.js              its own registry declaration (§5.2)
    routes.js                the /api routes it owns (§5.6)
    health.js                its own health check
    README.md                what it answers, and what it does not

registry/
  loader                     assembles declarations at boot
  exemptions                 libraries, each with a written reason (§2.4)
  schema                     the contract in §5.2

docs/                        123 documents — linked from module pages, not orphaned
test/                        70 suites — linked from Evidence tabs
```

**Two rules that make this structure hold:**

1. **A module owns its page, its routes, its health check and its docs.** Today
   they are spread across `server.js` (7,079 lines), `public/`, `docs/` and
   `test/` with nothing connecting them. **Grade: Measured.**
2. **The registry never imports the modules it lists.** Registry declarations are
   data. If loading the registry executes 100 modules, the menu becomes the
   slowest and most fragile thing in the platform.

---

# Part 10 — Auto-navigation strategy

## 10.1 The pipeline

```
module declares  →  loader assembles  →  validator checks  →  nav renders
                                              │
                                              └──►  BUILD FAILS on:
                                                    · module with no declaration
                                                      and no exemption
                                                    · route in a page that no
                                                      module claims
                                                    · dependency on an unknown id
                                                    · duplicate route claim
                                                    · section outside the enum
```

## 10.2 What "no manual menu editing" means precisely

| Action | Menu editing required? |
|---|---|
| Add a module with a registry block | **None** — it appears |
| Add a module with no registry block | **Build fails**, naming it and both fixes |
| Rename a module's display name | **None** — `id` is stable, favourites survive |
| Move a module to another section | Change one field in that module |
| Add a library | Add one exemption line with a reason |
| Add a 12th top-level section | **Blocked by the enum** — deliberately (§3.1) |

## 10.3 Health and freshness are pulled, never pushed

Modules do not push status into the navigation. The navigation asks. A module that
crashes cannot report itself as failed — but a navigation that asks and gets
nothing correctly renders `unknown`.

This is the same fail-closed shape as `instrument-guard.js`: absence produces a
refusal to claim, not a default. **Grade: Verified.**

## 10.4 Cost budget

The registry is assembled once at boot and cached client-side with an ETag. Health
is polled on **one** schedule for the whole fleet, not one poll per module — 100
modules polling independently is 100× the load for the same information.

A prior measurement is directly relevant: **262 requests/minute cost 3.2% CPU at
p95 3 ms**, and a shared client scheduler was measured and then *withdrawn* as
unnecessary at that scale. **Grade: Measured.** At 100 modules that calculus
changes, and this is the point where the shared scheduler becomes justified — a
recommendation I withdrew once on evidence and am reinstating on different
evidence, at a different scale.

---

# Part 11 — Scalability to 100+ modules

## 11.1 What scales, and what must not

| Grows freely | Fixed forever |
|---|---|
| Modules | 11 sections |
| Categories | 2 levels of depth |
| Tags | 1 shell |
| Docs, tests | 1 registry schema |

## 11.2 Load points at 100+ and their answers

| Pressure | Answer |
|---|---|
| Rail too long to scan | Sections collapse; Quick Jump becomes primary; recents float up |
| Search returns 40 results | Rank by personal frequency, then evidence grade |
| Health polling storm | One fleet-wide poll (§10.4) |
| Registry payload grows | Ship menu fields only; module detail on demand |
| Nobody knows what is new | "New this week" section, driven by registry `firstSeen` |
| Modules rot | **Staleness is a first-class state.** Not run in 90 days ⇒ `stale` on the Fleet View. Without this, a 100-module platform becomes a museum with a search box |

## 11.3 The 20-year view

Three things will outlive every implementation choice in this document:

1. **The stable `id`.** Favourites, audit trails, deep links and research citations
   all key on it. Names, routes and layouts will change many times; `id` must not.
2. **The evidence grade.** File formats and frameworks are replaceable. A ledger
   recording what was believed, on what evidence, and when it changed, is the
   institutional memory — the thing that stops the same disproved idea being
   rebuilt every third year.
3. **The exemption list with written reasons.** In ten years it is the only record
   of *why* a module was not a destination. Reasons decay far more slowly than code.

---

# Part 12 — UX guidelines

1. **A blank means "not reported". It never means zero.** Already enforced in
   `stock.html`. **Grade: Verified.** Extend it to every module page.
2. **Grey is a real colour and it means Unknown.** Green/amber/red is a
   three-state model and this system has five (§5.3).
3. **Freshness always sits beside health.** `healthy · 6h stale`.
4. **Evidence grade is visible wherever a module name is.** Menu, search, header,
   breadcrumb.
5. **No page scrolls the document.** The existing ratchet is 24/24 pages at 0 px on
   2560×1330. **Grade: Verified.** Content scrolls inside its own bounded region.
6. **Dominant text ≥13 px.** Existing ratchet, 24/24. **Grade: Verified.**
7. **Colour never carries meaning alone.** Green plus ▲, red plus ▼ — roughly 1 in
   12 men has a colour vision deficiency, and a P&L board that is only colour is
   unreadable to them.
8. **Numbers carry their window.** "91% win" is not a fact; "91% over 129 trades,
   600 days" is.
9. **Empty states are sentences.** "No errors recorded since 09:15" — never a
   blank panel, which is indistinguishable from a broken one.
10. **Destructive actions state what will happen, then require confirmation.** A
    button labelled "Reset" must say what it resets.
11. **Every module page is deep-linkable, including its tab.**
12. **Nothing loads on hover.** Hover is not intent.
13. **Latency is shown, not hidden.** A slow panel says it is loading and how long
    it usually takes.

---

# Part 13 — Institutional best practices adopted

| Practice | Source | How it appears here |
|---|---|---|
| Command line as the real interface | Bloomberg `<GO>` | Quick Jump `⌘K` (§7.2) |
| Stable mnemonic identity | Bloomberg function codes | Stable `id` (§5.2) |
| Fixed top level, deep content | Eikon | 11 sections, never 12 (§3.1) |
| One shell for every module | FactSet | Module shell (§6) |
| Provenance beside every number | All four references | Data source + evidence grade in the header |
| Research is an artefact, not a chat | Jane Street internal | Evidence tab, Validation Reports, discovery = grade change (§8.4) |
| Negative results published | Academic practice | Discoveries include disproofs (§8.4) |
| Health is pulled, not self-declared | SRE practice | §10.3 |
| Registry-driven navigation | Every platform past ~50 modules | §5, §10 |

**One place this design deliberately departs from Bloomberg:** Bloomberg does not
tell you how confident it is. This platform does, on every module, in the menu.
That is the product difference, and the navigation is where it is either expressed
or lost.

---

# Part 14 — Final recommended navigation

```
🚀 ANTIGRAVITY PRO                    [⌘K Quick Jump]   [☆ 4]   [● 31 of 34 healthy]

★ FAVOURITES         Command · Strangle · Signal Heatmap · IV Engine
🕘 RECENT            Stock View · GEX Skew · Backtest Reports

1  DASHBOARD         Command Centre · Fleet View · Discoveries · Pending Validation
2  MARKET            Live · Chain · Instruments
3  RESEARCH          Structure · Volatility · Derivatives · Probability ·
                     Behaviour · Paper · Reports
4  TRADING           Desk · Engines · Orders · Positions
5  RISK              Risk Engine · Exposure · Halts · Margin · Events · Stress
6  AI                Agents · Dataset · Models · Scorecard · Features
7  ANALYTICS         Quant Center · Backtests · Forward Tests · Attribution · Costs
8  HISTORICAL DATA   Database · Warehouse · Quality · Coverage · Ingestion
9  SYSTEM            Health · Engines · Logs · Storage · Broker · Scheduler
10 ADMINISTRATION    Users · Audit · Configuration · Instrument Registry
11 DEVELOPER         Manual · Strategy Guide · Data Honesty · Registry · API · Tests

                                          ⚠ 3 modules have no health check
```

That last line is the one I would fight to keep. It is the platform admitting what
it does not know, on the surface every user sees first — and it is the difference
between a status board and an honest one.

---

# Part 15 — Recommended sequence

Ordered by dependency, not by visibility. **Nothing here is production code; this
is the order in which the design should be implemented.**

| # | Step | Severity | Why here |
|---|---|---|---|
| 1 | Registry schema + loader + **completeness test** | **S2** | Everything else reads from it. The test is what makes it stay true |
| 2 | Declare the existing 25 pages + exempt the libraries | **S2** | Turns a 24-line array into real data; the exemption list is written once, honestly |
| 3 | `rail.js` renders from the registry | **S2** | Same menu, different source. Reversible, and the first irreversible-feeling step that is not |
| 4 | Five-state health + freshness | **S1** | Correctness. Do not build a fleet view on a three-state model |
| 5 | Module shell with Evidence tab | **S2** | The product's spine; every later module inherits honesty by default |
| 6 | Quick Jump | **S3** | The moment the tree stops scaling, this is already there |
| 7 | Fleet View + unknown-health count | **S2** | The dashboard's exception row |
| 8 | Route ownership for the 140 routes | **S2** | Makes orphans visible; opens the door to splitting `server.js` |
| 9 | Tags, favourites, recents | **S3** | Comfort, once the substance exists |
| 10 | Mobile subset | **S3** | Last. It is a subset of a thing that must exist first |

---

## Summary

The platform does not have a menu problem. It has a **discoverability contract**
problem: 94 of 95 modules are invisible, and there is no mechanism that would
notice a 96th. **Grade: Measured.**

The fix is not a bigger menu. It is a registry that each module writes into
itself, a build that fails when a module declares nothing, and a shell that
renders every module's health, freshness and **evidence grade** whether or not its
author wanted it shown.

Do that, and 100 modules is a data problem rather than a redesign. Skip it, and
the twenty-fifth hand-written menu entry is already the beginning of the last
navigation this platform will be able to change cheaply.
