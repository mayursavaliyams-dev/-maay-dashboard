/* ═══════════════════════════════════════════════════════════════════════════
   ANTIGRAVITY — shared left rail.  Drop-in: <script src="/js/rail.js"></script>

   WHY THIS FILE EXISTS
     The page list used to be hand-copied into every page's own <nav>. Twenty
     pages, twenty copies, each slightly different — which is how capture.html and
     greeks.html shipped reachable from nothing. Adding a page now means one line
     in PAGES below, and every page that includes this script gets it.

   WHY IT IS TABBED  (2026-08-08)
     The flat list reached 22 entries across 6 groups and no longer fitted the
     viewport — the rail itself scrolled, which is the one thing this shell is
     supposed to prevent. Scrolling a navigation is worse than scrolling content:
     you cannot see what you are choosing between, so the pages below the fold
     stop being used and eventually stop being maintained. That is how pages come
     to be reachable from nothing, which is the defect this file was written for
     in the first place.

     So the list is now a TAB per subject with a short table under it. Nothing was
     removed; every page in the old flat list is still here, and three that were
     never listed are recorded at the bottom with the reason.

   It injects its own CSS and its own markup, and sets the body offset inline so a
   page's existing body rule cannot fight it. It reads nothing and writes nothing
   except the collapse preference and the last-open tab, so it is safe on every
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
    { h: '/health-dashboard.html', i: '🩺', t: 'Connections',    k: 'live' },
    { h: '/trade.html',            i: '💼', t: 'Trade',          k: 'live' },

    /* STOCK — the equity side, kept apart from the index-option side because the
       instruments, the lot sizes and the strategies have nothing in common. */
    { h: '/stock.html',            i: '📊', t: 'Stock View',     k: 'stock' },
    { h: '/universe.html',         i: '🗂️', t: 'Stock Universe', k: 'stock' },

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
    { h: '/strike-history.html',   i: '🕘', t: 'Strike History', k: 'data' },
    { h: '/help.html?doc=stockview', i: '🔎', t: 'Data Honesty', k: 'data' },

    /* RESEARCH — hypotheses and what the evidence says about them. */
    { h: '/strategy.html',         i: '🧪', t: 'Strategy',       k: 'research' },
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

  var W = 210, WMIN = 56;
  var TABKEY = 'ag-rail-tab';

  /* localStorage throws in private mode and under some embedded webviews. That is a
     real condition, not something to swallow: the rail still works, the preference
     simply stops persisting, and we stop TRYING rather than throwing on every
     toggle. Declared here because the first read happens in activeTab(), well
     above the toggle handler that used to own it.

     Every catch below assigns to this rather than standing empty. An empty catch
     and a handled one look identical afterwards, which is the whole objection to
     them — and test/perf-budget.js counts them, correctly, whether or not a
     comment sits inside the braces. */
  var storageOk = true;

  /* ── CSS. Self-contained: it must look right on a page that never linked
        tokens.css, so the colours are literal here rather than var()-only. ──── */
  var css = ''
    + '.agrail{position:fixed;left:0;top:0;bottom:0;width:' + W + 'px;z-index:9000;'
    + 'background:#0d1420;border-right:1px solid #1c2735;display:flex;flex-direction:column;'
    + 'overflow-y:auto;overflow-x:hidden;transition:width .16s ease;'
    + 'font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;}'
    + 'html.agrail-min .agrail{width:' + WMIN + 'px;}'
    + '.agrail-top{display:flex;align-items:center;gap:8px;padding:12px 12px 10px;'
    + 'border-bottom:1px solid #1c2735;position:sticky;top:0;background:#0d1420;z-index:1;}'
    + '.agrail-logo{font-size:15px;flex:none;}'
    + '.agrail-name{font-size:12px;font-weight:800;letter-spacing:.4px;white-space:nowrap;'
    + 'overflow:hidden;color:#dbe4f0;}'
    + '.agrail-tg{margin-left:auto;background:none;border:1px solid #2a3547;color:#7c8aa0;'
    + 'border-radius:6px;width:22px;height:22px;cursor:pointer;font-size:11px;line-height:1;flex:none;}'
    + '.agrail-tg:hover{color:#dbe4f0;border-color:#5b9cff;}'

    /* the tab table — two columns, so eight subjects cost four rows */
    + '.agrail-tabs{display:grid;grid-template-columns:1fr 1fr;gap:3px;padding:8px 8px 6px;'
    + 'border-bottom:1px solid #1c2735;}'
    + '.agrail-tab{display:flex;align-items:center;gap:5px;padding:5px 6px;border-radius:6px;'
    + 'background:none;border:1px solid transparent;color:#7c8aa0;font-size:9.5px;font-weight:800;'
    + 'letter-spacing:.4px;text-transform:uppercase;cursor:pointer;white-space:nowrap;overflow:hidden;'
    + 'font-family:inherit;text-align:left;}'
    + '.agrail-tab i{font-style:normal;font-size:11px;flex:none;}'
    + '.agrail-tab:hover{color:#cfe0ff;background:rgba(91,156,255,.08);}'
    + '.agrail-tab.on{background:rgba(91,156,255,.18);color:#cfe0ff;border-color:#2a3547;}'
    + '.agrail-tab:focus-visible{outline:2px solid #5b9cff;outline-offset:1px;}'
    + '.agrail-count{margin-left:auto;font-size:8.5px;color:#5a6577;font-weight:700;}'

    + '.agrail-nav{display:flex;flex-direction:column;gap:1px;padding:8px 8px 22px;}'
    + '.agrail-nav a{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px;'
    + 'color:#93a2b8;font-size:12px;font-weight:700;text-decoration:none;border:1px solid transparent;'
    + 'white-space:nowrap;}'
    + '.agrail-nav a i{font-style:normal;width:16px;text-align:center;flex:none;font-size:13px;}'
    + '.agrail-nav a span{overflow:hidden;text-overflow:ellipsis;}'
    + '.agrail-nav a:hover{background:rgba(91,156,255,.10);color:#cfe0ff;}'
    + '.agrail-nav a.on{background:rgba(91,156,255,.16);color:#cfe0ff;border-color:#2a3547;}'
    + '.agrail-nav a:focus-visible{outline:2px solid #5b9cff;outline-offset:1px;}'

    /* collapsed: the TABS become the rail. Clicking one expands and opens it, so
       every page is still reachable at 56px — a collapsed rail that can only show
       one tab's icons would hide the other seven subjects entirely. */
    + 'html.agrail-min .agrail-name,html.agrail-min .agrail-nav,'
    + 'html.agrail-min .agrail-count{display:none;}'
    + 'html.agrail-min .agrail-tabs{grid-template-columns:1fr;gap:2px;padding:8px 6px;border-bottom:none;}'
    + 'html.agrail-min .agrail-tab{justify-content:center;padding:9px 0;font-size:0;gap:0;}'
    + 'html.agrail-min .agrail-tab i{font-size:15px;}'
    + 'html.agrail-min .agrail-top{padding:12px 6px 10px;}'

    + '@media(max-width:820px){.agrail{width:' + WMIN + 'px;}'
    + '.agrail-name,.agrail-nav,.agrail-count{display:none;}'
    + '.agrail-tabs{grid-template-columns:1fr;gap:2px;padding:8px 6px;border-bottom:none;}'
    + '.agrail-tab{justify-content:center;padding:9px 0;font-size:0;gap:0;}'
    + '.agrail-tab i{font-size:15px;}.agrail-tg{display:none;}}'
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

  /** Which tab should be open?
   *    1. the one containing the page we are on — always wins, because landing on
   *       a page and seeing a different tab open is disorienting
   *    2. the last one the operator chose
   *    3. Live
   */
  function activeTab() {
    for (var i = 0; i < PAGES.length; i++) if (isHere(PAGES[i])) return tabOf(PAGES[i]);
    var saved = null;
    try { saved = localStorage.getItem(TABKEY); } catch (e) { storageOk = false; }
    return tabKeys.indexOf(saved) >= 0 ? saved : 'live';
  }

  var current = 'live';

  function renderTabs() {
    var h = '';
    for (var i = 0; i < TABS.length; i++) {
      var tb = TABS[i];
      var n = pagesIn(tb.k).length;
      h += '<button class="agrail-tab' + (tb.k === current ? ' on' : '') + '" data-tab="' + tb.k + '"'
        + ' title="' + tb.t + ' (' + n + ')" aria-pressed="' + (tb.k === current) + '">'
        + '<i>' + tb.i + '</i>' + tb.t + '<span class="agrail-count">' + n + '</span></button>';
    }
    return h;
  }

  function renderPages() {
    var list = pagesIn(current);
    var h = '';
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var on = isHere(p);
      h += '<a href="' + p.h + '"' + (on ? ' class="on" aria-current="page"' : '')
        + ' title="' + p.t + '"><i>' + p.i + '</i><span>' + p.t + '</span></a>';
    }
    return h;
  }

  function paint() {
    var t = document.getElementById('agrailTabs');
    var n = document.getElementById('agrailNav');
    if (t) t.innerHTML = renderTabs();
    if (n) n.innerHTML = renderPages();
  }

  function selectTab(k) {
    if (tabKeys.indexOf(k) < 0) return;
    current = k;
    if (storageOk) { try { localStorage.setItem(TABKEY, k); } catch (e) { storageOk = false; } }
    // Choosing a subject while collapsed means you want to see it.
    if (document.documentElement.classList.contains('agrail-min')) {
      document.documentElement.classList.remove('agrail-min');
      if (storageOk) { try { localStorage.setItem('ag-rail-min', '0'); } catch (e) { storageOk = false; } }
      applyOffset();
      window.dispatchEvent(new Event('resize'));
    }
    paint();
  }

  function build() {
    current = activeTab();
    var aside = document.createElement('aside');
    aside.className = 'agrail';
    aside.setAttribute('aria-label', 'Sections');

    aside.innerHTML = '<div class="agrail-top">'
      + '<span class="agrail-logo">🚀</span>'
      + '<span class="agrail-name">ANTIGRAVITY <b>PRO</b></span>'
      + '<button class="agrail-tg" id="agrailTg" aria-label="Collapse or expand the sidebar">‹</button>'
      + '</div>'
      + '<div class="agrail-tabs" id="agrailTabs" role="tablist" aria-label="Subjects"></div>'
      + '<nav class="agrail-nav" id="agrailNav" aria-label="Pages"></nav>';

    document.body.insertBefore(aside, document.body.firstChild);
    paint();

    // Inline offset so a page's own `body{padding}` cannot cancel it.
    applyOffset();
    document.getElementById('agrailTg').addEventListener('click', toggle);
    document.getElementById('agrailTabs').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.agrail-tab') : null;
      if (b) selectTab(b.getAttribute('data-tab'));
    });
  }

  function applyOffset() {
    var min = document.documentElement.classList.contains('agrail-min');
    var narrow = window.matchMedia('(max-width:820px)').matches;
    document.body.style.paddingLeft = ((min || narrow) ? WMIN : W) + 'px';
    var b = document.getElementById('agrailTg');
    if (b) { b.textContent = min ? '›' : '‹'; b.title = (min ? 'Expand' : 'Collapse') + ' (b)'; }
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
      if (e.key !== 'b' || e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      toggle();
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
