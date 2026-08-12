/* ═══════════════════════════════════════════════════════════════════════════
   ANTIGRAVITY — the index ticker strip. Loaded by rail.js, so it appears on
   every page that has the rail without twenty-five separate <script> tags.

   WHAT IT SHOWS
     Every index the instrument registry knows — six today — in one compact row:
     name, price, change and percent, with an EXPIRY badge on whichever index
     expires today. Small type on purpose: six indices have to fit one line, and
     this strip is a glance, not a reading surface. The rest of the app keeps its
     larger type.

   THE RULES IT KEEPS
     · A missing price renders as an em dash. It never renders as 0, and it never
       renders as a flat market. If the feed itself failed, the strip says so —
       six blanks and a broken feed must not look the same.
     · Three of the six indices are watched but NOT traded by any engine here.
       They are dimmed and marked, because a price beside a name otherwise implies
       this system trades it.
     · One request serves the whole strip, and the server caches it. Every open
       tab polling six indices separately is the traffic shape that caused 458
       rate-limit refusals before the connector took over its own call rate.
     · It does not poll when the market is closed, when the tab is hidden, or
       when it is collapsed. A strip nobody is looking at should cost nothing.

   LAYOUT SAFETY
     The strip is FIXED, and it shifts the page down by its own height via
     body padding-top. That keeps it out of document flow entirely, so a page's
     own layout maths cannot be broken by it — the same approach rail.js already
     uses for its left offset.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__agTicker) return;
  window.__agTicker = true;

  var H = 30;                       // strip height, px
  var POLL_MS = 5000;
  var KEY = 'ag-ticker-open';

  /* ── CSS. Literal colours, because this must look right on a page that never
        linked tokens.css — the same reason rail.js does it. ─────────────────── */
  var css = ''
    + '.agtk{position:fixed;top:0;right:0;height:' + H + 'px;z-index:8900;display:flex;'
    + 'align-items:center;gap:0;background:#0b111a;border-bottom:1px solid #1a2536;'
    + 'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden;}'
    + '.agtk-scroll{display:flex;align-items:center;gap:18px;padding:0 12px;overflow-x:auto;'
    + 'flex:1;scrollbar-width:none;}'
    + '.agtk-scroll::-webkit-scrollbar{display:none;}'
    + '.agtk-i{display:flex;align-items:baseline;gap:6px;white-space:nowrap;flex:none;}'
    + '.agtk-n{font-size:10.5px;font-weight:800;letter-spacing:.5px;color:#cfe0ff;}'
    + '.agtk-p{font-size:11.5px;font-weight:700;color:#e6edf6;'
    + 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}'
    + '.agtk-c{font-size:10.5px;font-weight:700;'
    + 'font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;}'
    + '.agtk-c.up{color:#26d0a0;} .agtk-c.dn{color:#ff5470;} .agtk-c.na{color:#5a6577;}'
    + '.agtk-i.off .agtk-n{color:#7c8aa0;} .agtk-i.off .agtk-p{color:#8d9ab0;}'
    + '.agtk-x{font-size:8.5px;font-weight:900;letter-spacing:.6px;padding:1px 4px;border-radius:3px;'
    + 'background:rgba(255,84,112,.16);color:#ff5470;border:1px solid rgba(255,84,112,.4);}'
    + '.agtk-w{font-size:8.5px;font-weight:800;letter-spacing:.4px;padding:1px 4px;border-radius:3px;'
    + 'background:#131c29;color:#6d7a92;border:1px solid #222e40;}'
    + '.agtk-err{font-size:10.5px;color:#ffc24b;padding:0 12px;white-space:nowrap;}'
    + '.agtk-tg{flex:none;width:26px;height:100%;background:none;border:0;border-left:1px solid #1a2536;'
    + 'color:#7c8aa0;cursor:pointer;font-size:10px;line-height:1;}'
    + '.agtk-tg:hover{color:#cfe0ff;}'
    + 'html.agtk-shut .agtk{width:26px;left:auto;}'
    + 'html.agtk-shut .agtk-scroll,html.agtk-shut .agtk-err{display:none;}'
    + '@media print{.agtk{display:none !important;}}';

  /* localStorage throws in private mode and under some embedded webviews. That is a
     real condition, not something to swallow: the strip still works, the collapse
     preference simply stops persisting, and we stop trying rather than throwing on
     every toggle. Same handling as rail.js, for the same reason. */
  var storageOk = true;
  var open = true;
  try { open = localStorage.getItem(KEY) !== '0'; } catch (e) { storageOk = false; }

  var el, scroll, tg, timer = null, lastJSON = '';

  function build() {
    var s = document.createElement('style');
    s.id = 'agtk-css'; s.textContent = css;
    document.head.appendChild(s);

    el = document.createElement('div');
    el.className = 'agtk';
    el.setAttribute('aria-label', 'Index prices');
    el.innerHTML = '<div class="agtk-scroll" id="agtkScroll"><span class="agtk-err">loading indices…</span></div>'
                 + '<button class="agtk-tg" id="agtkTg" aria-label="Hide or show the index strip">▾</button>';
    document.body.appendChild(el);
    scroll = document.getElementById('agtkScroll');
    tg = document.getElementById('agtkTg');
    tg.addEventListener('click', toggle);

    if (!open) document.documentElement.classList.add('agtk-shut');
    applyOffset();
    window.addEventListener('resize', applyOffset);
  }

  /* The strip starts where the rail ends, and pushes the page down by its own
     height. Read from the rail's own constant rather than duplicating it: the
     rail sets body padding-left, so that value IS the rail width. */
  function applyOffset() {
    var left = parseFloat(getComputedStyle(document.body).paddingLeft) || 0;
    el.style.left = left + 'px';
    document.body.style.paddingTop = H + 'px';
    /* Published as a variable so a page that sizes itself against the viewport —
       `height: calc(100vh - 90px)` and the like — can subtract the strip instead
       of overflowing by exactly its height. Pages that do not use it are
       unaffected; pages that do stay correct when the strip is collapsed,
       because the value goes to 0px. */
    document.documentElement.style.setProperty('--agtk-h', H + 'px');
    tg.textContent = document.documentElement.classList.contains('agtk-shut') ? '▴' : '▾';
  }

  function toggle() {
    var shut = document.documentElement.classList.toggle('agtk-shut');
    if (storageOk) {
      try { localStorage.setItem(KEY, shut ? '0' : '1'); }
      catch (e) { storageOk = false; }
    }
    applyOffset();
    if (!shut) load();                       // it was hidden and is now visible
    schedule();
  }

  /* ── formatting. Every one of these returns a dash for null, never a zero. ── */
  function num(v, d) {
    if (v === null || v === undefined || !isFinite(v)) return null;
    return Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function render(d) {
    if (!d || !d.ok) {
      scroll.innerHTML = '<span class="agtk-err">index feed unavailable' +
        (d && d.error ? ' — ' + esc(d.error) : '') + '</span>';
      return;
    }
    var html = (d.indices || []).map(function (i) {
      var px = num(i.price, 2);
      var chg = num(i.change, 2), pct = num(i.changePct, 2);
      var up = i.change !== null && i.change >= 0;

      // The change cell: a real value, or an explicit blank. Never a zero
      // standing in for "we do not know".
      var cell = (chg === null)
        ? '<span class="agtk-c na">—</span>'
        : '<span class="agtk-c ' + (up ? 'up' : 'dn') + '">' + (up ? '▲ +' : '▼ ')
          + esc(chg.replace('-', '')) + (pct === null ? '' : ' (' + (up ? '+' : '') + esc(pct) + '%)') + '</span>';

      return '<span class="agtk-i' + (i.traded ? '' : ' off') + '"'
        + ' title="' + esc(i.inst) + (i.traded ? ' — traded by this system' : ' — watched, not traded by any engine here')
        + (i.expiryToday ? ' · expires today' : '') + '">'
        + '<span class="agtk-n">' + esc(i.inst) + '</span>'
        + (i.expiryToday ? '<span class="agtk-x">EXPIRY</span>' : '')
        + (i.traded ? '' : '<span class="agtk-w">WATCH</span>')
        + '<span class="agtk-p">' + (px === null ? '—' : esc(px)) + '</span>'
        + cell + '</span>';
    }).join('');

    // A partial feed is stated, not hidden: four of six quoted is different from
    // six of six, and the difference is invisible if you only show what arrived.
    if (d.quoted < d.total) {
      html += '<span class="agtk-err">' + d.quoted + ' of ' + d.total + ' quoted</span>';
    }
    scroll.innerHTML = html || '<span class="agtk-err">no indices configured</span>';
  }

  function load() {
    return fetch('/api/indices', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        // Re-render only when something changed, so a strip that is not moving
        // does not fight the user's horizontal scroll position every 5 seconds.
        var sig = JSON.stringify(d.indices);
        if (sig !== lastJSON) { lastJSON = sig; render(d); }
      })
      .catch(function (e) {
        scroll.innerHTML = '<span class="agtk-err">index feed unreachable — ' + esc(e.message) + '</span>';
      });
  }

  /* Poll only when it is worth polling. Outside 09:10–15:40 IST, on a weekend,
     with the tab hidden, or collapsed, nothing is fetched — the last values stay
     on screen rather than being blanked, because the last close is still true. */
  function shouldPoll() {
    if (document.hidden) return false;
    if (document.documentElement.classList.contains('agtk-shut')) return false;
    var ist = new Date(Date.now() + (new Date().getTimezoneOffset() + 330) * 60000);
    var day = ist.getDay();
    if (day === 0 || day === 6) return false;
    var m = ist.getHours() * 60 + ist.getMinutes();
    return m >= 550 && m <= 940;                    // 09:10 → 15:40
  }

  function schedule() {
    if (timer) return;
    timer = setInterval(function () { if (shouldPoll()) load(); }, POLL_MS);
  }

  function init() {
    build();
    load();                                         // once, always — even after hours
    schedule();
    document.addEventListener('visibilitychange', function () { if (shouldPoll()) load(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
