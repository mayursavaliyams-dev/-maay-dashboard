/* heartbeat — which components are alive, which stopped, and which were never here.
   docs/093 §1.

   WHY
     Nothing in this system reports that it is alive. Feed-failure detection
     latency cannot be measured because there is nothing to measure against, the
     drills in docs/073 cannot be rehearsed because there is no signal to wait
     for, and "the feed died at 11:04" is currently discovered by looking at a
     chart.

   THE DISTINCTION THIS FILE EXISTS FOR

     ALIVE    beat within its own declared interval
     STALE    beat, but not recently enough — with the age and the promise
     NEVER    no record at all: this component has not run since the file existed
     UNKNOWN  the heartbeat store itself could not be read

     `NEVER` and `STALE` are different facts and must never merge. A component
     that has never registered is usually a deployment mistake — a process that
     was not started, a name that was misspelled. A component that registered and
     went quiet is an incident. Reporting both as "not alive" sends the operator
     hunting for the wrong thing at the worst moment.

     `UNKNOWN` is the one that matters most and is easiest to get wrong. If the
     store cannot be read, the honest answer is not "everything is dead" and
     certainly not "everything is fine" — it is that we cannot tell, and a caller
     that treats it as either is asserting something it did not observe.

   EACH COMPONENT DECLARES ITS OWN INTERVAL
     A capture loop beating every 300s and a server beating every 15s are both
     healthy; a single global threshold would call one of them dead. Staleness is
     judged against what the component promised, and the promise is stored beside
     the beat so a reader needs nothing else.

   ON DURABILITY
     Beats are written atomically through safe-write, one file for all
     components, read-modify-write. At this cadence (seconds, not milliseconds)
     the cost is irrelevant and the alternative — one file per component — makes
     "which are missing" a directory listing that cannot tell an absent component
     from a deleted file. */
'use strict';

const fs = require('fs');
const path = require('path');
const { writeFileAtomicSync, readJsonSync } = require('./safe-write');

const DEFAULT_FILE = path.join(__dirname, 'data', 'heartbeats.json');

/* Grace multiplier: a component is STALE once it is this many times its own
   declared interval past its last beat. 2.5 tolerates one missed beat plus
   jitter without tolerating two — a single dropped beat on a 300s loop is
   ordinary, and two in a row is not. */
const GRACE = 2.5;

class Heartbeat {
  /**
   * @param file  where beats live
   * @param now   () => epoch ms
   */
  constructor({ file = DEFAULT_FILE, now = Date.now } = {}) {
    this.file = file;
    this.now = now;
  }

  _read() {
    try {
      const j = readJsonSync(this.file, { fallback: null });
      if (j === null) return { ok: true, beats: {} };         // never written yet
      if (!j || typeof j.beats !== 'object' || j.beats === null || Array.isArray(j.beats)) {
        return { ok: false, beats: {}, error: 'heartbeat file has the wrong shape' };
      }
      return { ok: true, beats: j.beats };
    } catch (e) {
      /* Unreadable is NOT empty. An empty object here would report every
         component as NEVER, which reads as "nothing was ever deployed" — a
         confident claim built on a failed read. */
      return { ok: false, beats: {}, error: `${e.code || 'ERR'}: ${e.message}` };
    }
  }

  /** Record a beat.
   *
   *  @param name         component name — stable across restarts, it is the key
   *  @param intervalMs   how often this component PROMISES to beat. Staleness is
   *                      judged against this and nothing else.
   *  @param meta         small free-form object, e.g. { instrument, mode }
   *
   *  Returns { ok, seq, error }. A failed beat is reported, never swallowed: a
   *  heartbeat that silently stops being written is indistinguishable from a
   *  component that stopped, which is the failure this module exists to prevent.
   */
  beat(name, { intervalMs, meta = null } = {}) {
    if (!name || typeof name !== 'string') throw new Error('heartbeat: a component name is required');
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(`heartbeat: ${name} must declare a positive intervalMs — without it, staleness has nothing to be judged against`);
    }

    const state = this._read();
    if (!state.ok) {
      /* Refusing to write over a store we could not read. Overwriting would
         discard every other component's record on the strength of one bad read. */
      return { ok: false, seq: null, error: `refusing to write over an unreadable store: ${state.error}` };
    }

    const prev = state.beats[name];
    const at = this.now();
    const rec = {
      at,
      atISO: new Date(at).toISOString(),
      intervalMs,
      seq: (prev && Number.isFinite(prev.seq) ? prev.seq : 0) + 1,
      pid: process.pid,
      /* firstSeen survives restarts, so "this component has been up for 3 days"
         and "it restarted 40 seconds ago" are distinguishable. A pid change with
         seq continuing is exactly the signature of a restart. */
      firstSeen: (prev && prev.firstSeen) || at,
      meta: meta || null,
    };

    const beats = { ...state.beats, [name]: rec };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      writeFileAtomicSync(this.file, JSON.stringify({
        updatedAt: new Date(at).toISOString(), beats,
      }, null, 2));
    } catch (e) {
      return { ok: false, seq: rec.seq, error: `${e.code || 'ERR'}: ${e.message}` };
    }
    return { ok: true, seq: rec.seq, error: null };
  }

  /** Status of every component, plus any `expected` that have never beaten.
   *
   *  @param expected  names that SHOULD be present. Without this, a component
   *                   that never started is invisible — the store simply has no
   *                   row for it, and an absent row reads as an absent problem.
   */
  status(expected = []) {
    const state = this._read();
    const now = this.now();

    if (!state.ok) {
      return {
        ok: false,
        error: state.error,
        /* null, not [] and not a list of dead components. We do not know. */
        components: null,
        summary: null,
        operatorAction: 'The heartbeat store could not be read. This screen cannot tell you what is running; check the processes directly.',
      };
    }

    const names = new Set([...Object.keys(state.beats), ...expected]);
    const components = [];

    for (const name of [...names].sort()) {
      const b = state.beats[name];
      if (!b) {
        components.push({
          name, state: 'NEVER', ageMs: null, intervalMs: null, seq: null, pid: null,
          reason: 'no beat has ever been recorded for this component — it has not run, or it is registering under a different name',
        });
        continue;
      }
      const ageMs = now - b.at;
      const limit = b.intervalMs * GRACE;
      components.push({
        name,
        state: ageMs <= limit ? 'ALIVE' : 'STALE',
        ageMs,
        ageSec: Math.round(ageMs / 1000),
        intervalMs: b.intervalMs,
        graceMs: Math.round(limit),
        seq: b.seq,
        pid: b.pid,
        upSinceISO: new Date(b.firstSeen).toISOString(),
        lastBeatISO: b.atISO,
        meta: b.meta,
        reason: ageMs <= limit
          ? null
          : `last beat ${Math.round(ageMs / 1000)}s ago; this component promised every ${Math.round(b.intervalMs / 1000)}s`,
      });
    }

    const count = (s) => components.filter((c) => c.state === s).length;
    return {
      ok: true,
      error: null,
      at: new Date(now).toISOString(),
      components,
      summary: {
        alive: count('ALIVE'),
        stale: count('STALE'),
        never: count('NEVER'),
        total: components.length,
      },
      /* Deliberately not a single boolean. "Is everything healthy" collapses
         NEVER and STALE into one answer, which is the merge this module exists
         to prevent. A caller that wants one number should say which of the two
         it is willing to ignore. */
      healthy: count('STALE') === 0 && count('NEVER') === 0,
    };
  }

  /** Start beating on a timer. Returns a stop function.
   *
   *  The first beat is IMMEDIATE, not after one interval. A component that beats
   *  only after its first interval is indistinguishable from a dead one for that
   *  whole period — and for the capture loop that period is five minutes. */
  start(name, { intervalMs, meta = null, log = console } = {}) {
    const once = () => {
      const r = this.beat(name, { intervalMs, meta: typeof meta === 'function' ? meta() : meta });
      if (!r.ok) log.warn?.(`[heartbeat] ${name}: ${r.error}`);
    };
    once();
    const timer = setInterval(once, intervalMs);
    if (timer.unref) timer.unref();      // never hold the process open
    return () => clearInterval(timer);
  }
}

module.exports = { Heartbeat, GRACE, DEFAULT_FILE };
