# 094 — The 79 Silent Catches, Triaged

**Phase 3B of docs/086, completed 2026-08-12.** Categorisation only. **No
behaviour was changed**, deliberately: categorising a catch and changing it are
two different commits, and doing both at once is how a tidy-up alters something
nobody reviewed.

Machine-readable: `catch-triage.json` · enforced by `test/catch-triage.test.js`
· `node scripts/catch-triage.js --assert`

---

## The count, and why it moved

| | |
|---|---|
| A grep for `catch (_) {}` said | **55** |
| Parsing found | **82** |
| After the retention and connector fixes | **79** |

The grep matched three literal spellings. The extra 27 were `catch(e){}`, catches
whose body is only a comment, catches spanning lines, and catches containing a
bare `return`. Same defect, different clothes.

---

## Where they landed

| Category | Count | Meaning |
|---|---|---|
| **EXPECTED-OPTIONAL** | **59** | the failure is a normal state and the fallback IS the design |
| **LOGGED** | **20** | it should say something and does not |
| **TODO-TRIAGE** | **0** | none left undecided |

### EXPECTED-OPTIONAL — 59

Not "probably fine". Each group has a reason that survives being read back:

- **price read with a cached fallback** (8) — the cache is the answer when the
  feed is quiet. Three of the sites already say so in their own comments.
- **optional engine status** (19) — an engine that is off has no status, and that
  is a fact rather than a failure.
- **derived data with a documented fallback** (7) — previous day, default DTE,
  default strike step, each stated beside the catch.
- **the crash guard's own log write** (1) — `server.js:70` writes the crash log
  from *inside* the crash handler. A throw here loses the original error to a
  second one about logging it.
- **notification delivery** (2) — a missed Telegram message must never take down
  a monitor, and the inner catch already logs the reason.
- **registry expiry** (2) — `safeExpiry` is the fail-closed path: an unknown
  expiry leaves the concentration check UNEVALUABLE and the order **blocks**.
- **feature detection** (5), **file-missing-is-normal** (3), **numeric
  derivation** (7), **best-effort cache write** (3), **per-engine independence**
  (2) — emergency-stop disables each engine in its own `try` so one missing
  engine cannot prevent the others being stopped.

### LOGGED — 20, and these are the ones worth changing

**`persistedStateSilentlyReverts` — 9.** The group that made the triage worth
doing. Lines 3952, 4219, 4235, 6993, 7012, 7021, 7039, 7041, 7042.

Each reads or writes a file that carries state across a restart: engine config
overrides, VRP history, signal-paper positions, signal-health calibration. A
failure here does not lose a tick — **it reverts a setting the operator chose,
silently, and the system then runs a configuration nobody selected.**

That is the same shape as the daily trade counter resetting on restart
(docs/089 §1C), and it is invisible for the same reason: the system reports its
state correctly, and its state is wrong.

**`backgroundWorkThatCanStop` — 6.** Consolidation, learner credit assignment,
outcome logging. If these stop, nothing breaks visibly and the data they produce
simply thins out — indistinguishable from a quiet market.

**`networkFetch` — 3.** Repeated failures are the signature of an expired token,
a rate limit, or a dead port. None of those announces itself.

**`patternDetection` — 1.** `server.js:1325` binds `catch (err)` and then discards
`err`. An intention that was never finished.

**`absentVersusUnreadable` — 1.** `server.js:964` wraps the opt-candles archive
read. The inner catch already handles a bad file, so this one fires only on the
directory — and cannot tell *"no archive yet, first run"* from *"the directory
exists and cannot be read"*. The first is normal; the second silently reduces the
caller to today's bars, and thinner history looks exactly like a quieter market.

---

## Why the categories are a sidecar, not comments

`catch-triage.json`, not 79 annotations in `server.js`.

- Annotating 79 sites is a large diff with **no behaviour change** to a file whose
  dependency mechanism is construction order — churn with a risk attached.
- A data file **cannot** change behaviour, which enforces the rule this triage
  was written under.
- Line numbers rot, so the script reports **DRIFT** when a category points at a
  line that no longer holds a silent catch. A stale entry is never dropped
  silently: a category that outlives the code it described reads as a decision.

The loader also fails closed. An unreadable `catch-triage.json` **throws** rather
than yielding an empty map — otherwise a failed read would report all 79 as
uncategorised, and a reader would conclude the work was never done.

---

## What is NOT claimed

- **No catch was changed.** Every one still swallows exactly what it swallowed
  before. This is a map, not a repair.
- **The 59 are a judgement**, made from each catch's enclosing statements and its
  documented fallback. They are grouped so the judgement can be re-argued as a
  group rather than re-derived one at a time.
- **Only `server.js`.** Other files have silent catches; `perf-budget`'s ratchet
  counts 112 across the repository and 71 of them are here. The remaining 41 sit
  across 18 files and are untouched.

## Next, when it is next

Take `persistedStateSilentlyReverts` first — nine catches, one commit, each
gaining a line that names the file and the errno. That is the group where silence
costs a setting rather than a tick.
