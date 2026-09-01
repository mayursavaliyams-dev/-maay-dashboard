/* ═══════════════════════════════════════════════════════════════════════════
   ANTIGRAVITY — shared left rail.  Drop-in: <script src="/js/rail.js"></script>

   WHY THIS FILE EXISTS
     The page list used to be hand-copied into every page's own <nav>. Twenty
     pages, twenty copies, each slightly different — which is how capture.html and
     greeks.html shipped reachable from nothing. Adding a page now means one line
     in PAGES below, and every page that includes this script gets it.

   WHY IT IS FULLY OPEN  (2026-08-24)
     The tabbed rail hid pages inside subjects. The owner asked for every section
     to be visible at once: no "inside", no category click before opening a page.
     The rail is therefore an always-open grouped index. It may scroll as a rail,
     but no page is hidden behind a selected tab.

   It injects its own CSS and its own markup, and sets the body offset inline so a
   page's existing body rule cannot fight it. It reads nothing and writes nothing
   except the collapse preference, so it is safe on every
   page including the read-only research ones.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__agRail) return;                 // never inject twice
  window.__agRail = true;

  /* ── the tabs. Order is the order they appear. ────────────────────────────── */
  var TABS = [
    { k: 'live',     i: '⌂',  t: 'Live' },
    { k: 'stock',    i: '📊', t: 'Stock' },
    { k: 'options',  i: '⛓',  t: 'Options' },
    { k: 'charts',   i: '📈', t: 'Charts' },
    { k: 'engines',  i: '🤖', t: 'Engines' },
    { k: 'data',     i: '🗄',  t: 'Data' },
    { k: 'research', i: '🔬', t: 'Research' },
    { k: 'learn',    i: '📖', t: 'Learn' }
  ];

  /* ── the ONE list. Add a page here and it appears everywhere. ───────────────
        `k` is the tab it belongs to. A page with no `k`, or with a `k` naming no
        tab, is shown under Live rather than disappearing — an unreachable page is
        the failure this file exists to prevent, and a typo in a tab key must not
        be able to cause one. */
  var PAGES = [
    /* LIVE — what is happening now, and whether we are actually connected.
       Health sits here rather than in its own group because the connection state
       is the first thing you need when the dashboard looks wrong: the question
       "is this number stale?" is answered by the feed, not by the number. */
    { h: '/dashboard.html',        i: '⌂',  t: 'Command',        k: 'live' },
    { h: '/readiness.html',        i: '🛡️', t: 'Readiness',      k: 'live', s: 'Blocked' },
    { h: '/health-dashboard.html', i: '🩺', t: 'Connections',    k: 'live' },
    { h: '/trade.html',            i: '💼', t: 'Trade',          k: 'live', s: 'Paper' },

    /* STOCK — the equity side, kept apart from the index-option side because the
       instruments, the lot sizes and the strategies have nothing in common. */
    { h: '/stock.html',            i: '📊', t: 'Stock View',     k: 'stock' },
    { h: '/universe.html',         i: '🗂️', t: 'Stock Universe', k: 'stock', s: 'Research' },

    /* OPTIONS — every page whose subject is a strike, a chain or a Greek.
       These were previously scattered across Live, Research and Charts, so
       comparing OI against a heatmap against a payoff meant crossing three
       groups for pages that all describe the same option chain. */
    { h: '/capture.html',          i: '🎯', t: 'Buy Low → Sell High', k: 'options' },
    { h: '/greeks.html',           i: 'Δ',  t: 'Greeks → P&L',   k: 'options' },
    { h: '/oi.html',               i: '🧱', t: 'OI Analysis',    k: 'options' },
    { h: '/pop.html',              i: '🎲', t: 'PoP Seller',     k: 'options' },
    { h: '/payoff.html',           i: '📐', t: 'Payoff',         k: 'options' },
    { h: '/heatmap.html',          i: '🗺️', t: 'Heatmap',        k: 'options' },
    { h: '/signal-heatmap.html',   i: '🔥', t: 'Signal Heatmap', k: 'options' },
    { h: '/ami-heatmap.html',      i: '🧭', t: 'AMI Heatmap',    k: 'options' },
    { h: '/pattern-signals.html',  i: '🕯️', t: 'Patterns',       k: 'options' },

    /* CHARTS — price, drawn. */
    { h: '/chart.html',            i: '📈', t: 'Chart',          k: 'charts' },
    { h: '/charts4.html',          i: '▦',  t: '4 Charts',       k: 'charts' },

    /* ENGINES — the things that decide, as opposed to the things that display. */
    { h: '/agents.html',           i: '🤖', t: 'AI Agents',      k: 'engines' },
    { h: '/ai-report.html',        i: '▣',  t: 'AI Report',      k: 'engines', s: 'Deep' },
    { h: '/quant.html',            i: '⚡', t: 'Quant Center',   k: 'engines' },
    { h: '/strangle-monitor.html', i: '🎚️', t: 'Strangle',       k: 'engines' },
    { h: '/signals4.html',         i: '✅', t: '4 Engines',      k: 'engines' },

    /* DATA — what was recorded, and how far it can be trusted.
       Separate from Research on purpose: Data is what we HAVE, Research is what
       we CONCLUDE from it. Mixing them is how a gap in the archive turns into a
       backtest result nobody questions. This tab is thin — two pages — and that
       is an honest reflection of the fact that the warehouse has no UI yet, not
       a placeholder to be padded out. */
    { h: '/screener.html',         i: '🔍', t: 'Screener',      k: 'data' },
    { h: '/market-data.html',      i: '▦',  t: 'Market Data',   k: 'data' },
    { h: '/strike-history.html',   i: '🕘', t: 'Strike History', k: 'data' },
    { h: '/help.html?doc=stockview', i: '🔎', t: 'Data Honesty', k: 'data' },

    /* RESEARCH — hypotheses and what the evidence says about them. */
    { h: '/strategy.html',         i: '🧪', t: 'Strategy',       k: 'research' },
    { h: '/stock.html?tab=propicks', i: '📊', t: 'ProPicks',     k: 'research', s: 'Research' },
    { h: '/help.html?doc=strategies', i: '🎯', t: 'Strategy Guide', k: 'research' },

    /* LEARN */
    { h: '/help.html',             i: '📖', t: 'User Manual',    k: 'learn' },
    { h: '/help.html?doc=whatsinside', i: '🧭', t: 'What Is In The Bot', k: 'learn' }
  ];

  /* Pages deliberately absent from the rail, recorded so their absence is a
     decision rather than an oversight:
       login.html        — pre-auth; the rail must not appear before sign-in
       command.html      — superseded by dashboard.html
       command-pro.html  — superseded by dashboard.html
     test/ui-shell.test.js asserts this list stays the complete set. */

  var W = 276, WMIN = 64;

  /* localStorage throws in private mode and under some embedded webviews. That is a
     real condition, not something to swallow: the rail still works, the preference
     simply stops persisting, and we stop TRYING rather than throwing on every
     toggle.

     Every catch below assigns to this rather than standing empty. An empty catch
     and a handled one look identical afterwards, which is the whole objection to
     them — and test/perf-budget.js counts them, correctly, whether or not a
     comment sits inside the braces. */
  var storageOk = true;

  /* ── CSS. Self-contained: it must look right on a page that never linked
        tokens.css, so the colours are literal here rather than var()-only. ──── */
  var css = ''
    + '.agrail{position:fixed;left:0;top:0;bottom:0;width:' + W + 'px;z-index:9000;'
    + 'background:linear-gradient(180deg,#08111d 0%,#0a1320 52%,#07101a 100%);'
    + 'border-right:1px solid rgba(91,156,255,.18);display:flex;flex-direction:column;'
    + 'overflow-y:auto;overflow-x:hidden;transition:width .16s ease;box-shadow:14px 0 34px rgba(0,0,0,.22);'
    + 'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}'
    + 'html.agrail-min .agrail{width:' + WMIN + 'px;}'
    + '.agrail-top{display:flex;align-items:center;gap:10px;padding:15px 12px 13px;'
    + 'border-bottom:1px solid rgba(255,255,255,.06);position:sticky;top:0;'
    + 'background:rgba(8,17,29,.95);backdrop-filter:blur(12px);z-index:1;}'
    + '.agrail-logo{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;'
    + 'font-size:16px;flex:none;background:linear-gradient(135deg,#3ad0e0,#ffc24b);box-shadow:0 8px 20px rgba(58,208,224,.16);}'
    + '.agrail-name{font-size:11px;font-weight:950;letter-spacing:.3px;white-space:nowrap;'
    + 'overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1;color:#f3f7ff;text-shadow:0 0 18px rgba(91,156,255,.18);}'
    + '.agrail-name b{color:#8fc2ff;font-weight:950;}'
    + '.agrail-actions{margin-left:auto;display:flex;align-items:center;gap:6px;flex:none;}'
    + '.agrail-btn,.agrail-tg{background:#0b1626;border:1px solid rgba(91,156,255,.28);color:#9fb4cf;'
    + 'border-radius:8px;width:28px;height:28px;cursor:pointer;font-size:14px;line-height:1;flex:none;}'
    + '.agrail-btn{display:grid;place-items:center;text-decoration:none;font-size:13px;}'
    + '.agrail-btn:hover,.agrail-tg:hover{color:#ffffff;border-color:#3ad0e0;background:#0f2135;}'
    + '.agrail-btn:focus-visible,.agrail-tg:focus-visible{outline:2px solid #5b9cff;outline-offset:1px;}'

    /* fully-open group navigation: every section is visible at once */
    + '.agrail-nav{display:flex;flex-direction:column;gap:8px;padding:9px 8px 18px;}'
    + '.agrail-group{display:grid;grid-template-columns:1fr 1fr;gap:4px;}'
    + '.agrail-section{grid-column:1/-1;display:grid;grid-template-columns:24px 1fr auto;align-items:center;gap:6px;'
    + 'padding:2px 4px;color:#7f94b0;font-size:9.5px;font-weight:950;letter-spacing:.11em;text-transform:uppercase;}'
    + '.agrail-section i{font-style:normal;width:20px;height:20px;border-radius:6px;display:grid;place-items:center;'
    + 'font-size:12px;background:rgba(255,255,255,.035);color:#a6bdd8;}'
    + '.agrail-section b{font-family:ui-monospace,Consolas,monospace;color:#52677f;font-size:10px;}'
    + '.agrail-nav a{position:relative;display:flex;align-items:center;gap:7px;min-width:0;min-height:34px;padding:6px 8px 6px 30px;border-radius:8px;'
    + 'color:#a3b7d1;font-size:10.6px;font-weight:780;text-decoration:none;border:1px solid transparent;'
    + 'white-space:normal;background:rgba(255,255,255,.014);}'
    + '.agrail-nav a i{font-style:normal;width:20px;height:20px;border-radius:6px;display:grid;place-items:center;'
    + 'flex:none;font-size:12px;background:rgba(255,255,255,.04);position:absolute;left:6px;}'
    + '.agrail-nav a span{overflow:visible;min-width:0;line-height:1.12;}'
    + '.agrail-status{margin-left:auto;border-radius:999px;padding:0;width:7px;height:7px;overflow:hidden;text-indent:0;font-size:0;line-height:0;flex:none;'
    + 'color:#9fb4cf;background:rgba(255,255,255,.18);border:1px solid rgba(255,255,255,.08);}'
    + '.agrail-status.blocked{color:#ffb9c6;background:rgba(255,84,112,.12);border-color:rgba(255,84,112,.22);}'
    + '.agrail-status.paper{color:#f0dcae;background:rgba(255,194,75,.11);border-color:rgba(255,194,75,.22);}'
    + '.agrail-status.research{color:#aee9f2;background:rgba(58,208,224,.10);border-color:rgba(58,208,224,.20);}'
    + '.agrail-nav a:hover{background:rgba(91,156,255,.10);color:#eaf2ff;border-color:rgba(91,156,255,.18);}'
    + '.agrail-nav a:hover i{background:rgba(91,156,255,.14);}'
    + '.agrail-nav a.on{background:linear-gradient(90deg,rgba(255,194,75,.16),rgba(58,208,224,.10));'
    + 'color:#ffffff;border-color:rgba(255,194,75,.24);}'
    + '.agrail-nav a.on::after{content:"";position:absolute;right:8px;width:6px;height:6px;border-radius:50%;background:#ffc24b;}'
    + '.agrail-nav a.on i{background:rgba(255,194,75,.16);}'
    + '.agrail-nav a:focus-visible{outline:2px solid #5b9cff;outline-offset:1px;}'

    + 'html.agrail-min .agrail-name,html.agrail-min .agrail-nav{display:none;}'
    + 'html.agrail-min .agrail-top{padding:10px 7px 11px;flex-direction:column;gap:8px;}'
    + 'html.agrail-min .agrail-logo{width:32px;height:32px;}'
    + 'html.agrail-min .agrail-actions{margin-left:0;flex-direction:column;gap:6px;}'
    + 'html.agrail-min .agrail-btn,html.agrail-min .agrail-tg{display:grid;width:34px;height:34px;}'

    + '@media(max-width:820px){.agrail{width:' + WMIN + 'px;}'
    + '.agrail-name,.agrail-nav{display:none;}'
    + '.agrail-top{padding:10px 7px 11px;flex-direction:column;gap:8px;}'
    + '.agrail-actions{margin-left:0;flex-direction:column;gap:6px;}'
    + '.agrail-logo{width:32px;height:32px;}.agrail-btn,.agrail-tg{display:grid;width:34px;height:34px;}}'
    + '@media (prefers-reduced-motion: reduce){.agrail{transition:none;}}';

  function injectCss() {
    var s = document.createElement('style');
    s.id = 'agrail-css';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function currentPath() {
    var p = location.pathname;
    if (p === '/' || p === '') return '/dashboard.html';   // Command is the home page
    return p;
  }

  /** Does this entry describe the page we are on?
   *  Compared on pathname AND query, because /help.html?doc=strategies and
   *  /help.html are different destinations rendered by the same file — matching
   *  on pathname alone would light up four entries at once. */
  function isHere(entry) {
    var q = location.pathname + location.search;
    return entry.h === q || (entry.h === currentPath() && !location.search);
  }

  var tabKeys = TABS.map(function (x) { return x.k; });
  function tabOf(p) { return tabKeys.indexOf(p.k) >= 0 ? p.k : 'live'; }
  function pagesIn(k) { return PAGES.filter(function (p) { return tabOf(p) === k; }); }

  function renderPages() {
    var h = '';
    for (var g = 0; g < TABS.length; g++) {
      var tab = TABS[g];
      var list = pagesIn(tab.k);
      if (!list.length) continue;
      h += '<section class="agrail-group">'
        + '<div class="agrail-section"><i>' + tab.i + '</i><span>' + tab.t + '</span><b>' + list.length + '</b></div>';
      for (var i = 0; i < list.length; i++) {
        var p = list[i];
        var on = isHere(p);
        h += '<a href="' + p.h + '"' + (on ? ' class="on" aria-current="page"' : '')
          + ' title="' + p.t + '"><i>' + p.i + '</i><span>' + p.t + '</span>'
          + (p.s ? '<em class="agrail-status ' + p.s.toLowerCase() + '">' + p.s + '</em>' : '')
          + '</a>';
      }
      h += '</section>';
    }
    return h;
  }

  function paint() {
    var n = document.getElementById('agrailNav');
    if (n) n.innerHTML = renderPages();
  }

  function build() {
    var aside = document.createElement('aside');
    aside.className = 'agrail';
    aside.setAttribute('aria-label', 'Navigation');

    aside.innerHTML = '<div class="agrail-top">'
      + '<span class="agrail-logo">🚀</span>'
      + '<span class="agrail-name">ANTIGRAVITY <b>PRO</b></span>'
      + '<div class="agrail-actions">'
      + '<a class="agrail-btn" id="agrailCommand" href="/dashboard.html" aria-label="Open Command dashboard" title="Command">⌂</a>'
      + '<button class="agrail-btn" id="agrailFull" aria-label="Toggle fullscreen" title="Fullscreen (f)">⛶</button>'
      + '<button class="agrail-tg" id="agrailTg" aria-label="Collapse or expand the sidebar" title="Collapse or expand">‹</button>'
      + '</div>'
      + '</div>'
      + '<nav class="agrail-nav" id="agrailNav" aria-label="Pages"></nav>';

    document.body.insertBefore(aside, document.body.firstChild);
    paint();

    // Inline offset so a page's own `body{padding}` cannot cancel it.
    applyOffset();
    document.getElementById('agrailTg').addEventListener('click', toggle);
    document.getElementById('agrailFull').addEventListener('click', toggleFullscreen);
    document.addEventListener('fullscreenchange', applyFullscreenState);
    applyFullscreenState();
  }

  function applyOffset() {
    var min = document.documentElement.classList.contains('agrail-min');
    var narrow = window.matchMedia('(max-width:820px)').matches;
    document.body.style.paddingLeft = ((min || narrow) ? WMIN : W) + 'px';
    var b = document.getElementById('agrailTg');
    if (b) { b.textContent = min ? '›' : '‹'; b.title = (min ? 'Expand' : 'Collapse') + ' (b)'; }
  }

  function applyFullscreenState() {
    var b = document.getElementById('agrailFull');
    if (!b) return;
    var on = !!document.fullscreenElement;
    b.textContent = on ? '↙' : '⛶';
    b.title = on ? 'Exit fullscreen (f)' : 'Fullscreen (f)';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        if (document.exitFullscreen) document.exitFullscreen();
      } else {
        var el = document.documentElement;
        if (el.requestFullscreen) el.requestFullscreen();
      }
    } catch (e) {
      // Fullscreen can be refused by the browser or embedding shell; the button stays harmless.
    }
  }

  function toggle() {
    var min = document.documentElement.classList.toggle('agrail-min');
    if (storageOk) {
      try { localStorage.setItem('ag-rail-min', min ? '1' : '0'); }
      catch (e) { storageOk = false; }
    }
    applyOffset();
    // let any canvas on the page resize to the new width
    window.dispatchEvent(new Event('resize'));
  }

  function init() {
    try {
      if (localStorage.getItem('ag-rail-min') === '1') document.documentElement.classList.add('agrail-min');
    } catch (e) { storageOk = false; }        // no persistence available — rail still works
    injectCss();
    build();
    window.addEventListener('resize', applyOffset);
    document.addEventListener('keydown', function (e) {
      if ((e.key !== 'b' && e.key !== 'f') || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'b') toggle();
      if (e.key === 'f') toggleFullscreen();
    });
  }

  /* The index ticker rides along with the rail.

     It could have been a <script> tag on each page — which is exactly how the
     navigation itself came to exist in twenty divergent copies, two of which
     shipped reachable from nothing. One loader, one place to change it. The
     ticker positions itself against the rail's own body padding, so it must
     load after the rail has set that. */
  function loadTicker() {
    if (document.getElementById('agtk-js')) return;
    var s = document.createElement('script');
    s.id = 'agtk-js';
    s.src = '/js/ticker.js';
    s.defer = true;
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); loadTicker(); });
  else { init(); loadTicker(); }
})();
