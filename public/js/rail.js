/* ═══════════════════════════════════════════════════════════════════════════
   ANTIGRAVITY — shared left rail.  Drop-in: <script src="/js/rail.js"></script>

   WHY THIS FILE EXISTS
     The page list used to be hand-copied into every page's own <nav>. Twenty
     pages, twenty copies, each slightly different — which is how capture.html and
     greeks.html shipped reachable from nothing. Adding a page now means one line
     in PAGES below, and every page that includes this script gets it.

   It injects its own CSS and its own markup, and sets the body offset inline so a
   page's existing body rule cannot fight it. It reads nothing and writes nothing
   except the collapse preference, so it is safe on every page including the
   read-only research ones.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__agRail) return;                 // never inject twice
  window.__agRail = true;

  /* ── the ONE list. Add a page here and it appears everywhere. ─────────────── */
  var PAGES = [
    { g: 'Live' },
    { h: '/dashboard.html',      i: '⌂',  t: 'Command' },
    { h: '/signal-heatmap.html', i: '🔥', t: 'Signal Heatmap' },
    { h: '/ami-heatmap.html',    i: '🧭', t: 'AMI Heatmap' },
    { h: '/oi.html',             i: '🧱', t: 'OI Analysis' },
    { h: '/heatmap.html',        i: '🗺️', t: 'Heatmap' },

    { g: 'Research' },
    { h: '/capture.html',        i: '🎯', t: 'Buy Low → Sell High' },
    { h: '/greeks.html',         i: 'Δ',  t: 'Greeks → P&L' },
    { h: '/strike-history.html', i: '🕘', t: 'Strike History' },
    { h: '/pop.html',            i: '🎲', t: 'PoP Seller' },
    { h: '/strategy.html',       i: '🧪', t: 'Strategy' },
    { h: '/payoff.html',         i: '📐', t: 'Payoff' },

    { g: 'Charts' },
    { h: '/chart.html',          i: '📈', t: 'Chart' },
    { h: '/charts4.html',        i: '▦',  t: '4 Charts' },
    { h: '/pattern-signals.html',i: '🕯️', t: 'Patterns' },

    { g: 'Engines' },
    { h: '/agents.html',         i: '🤖', t: 'AI Agents' },
    { h: '/quant.html',          i: '⚡', t: 'Quant Center' },
    { h: '/signals4.html',       i: '✅', t: '4 Engines' },
    { h: '/trade.html',          i: '💼', t: 'Trade' },
    { h: '/health-dashboard.html', i: '🩺', t: 'Health' }
  ];

  var W = 210, WMIN = 56;

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
    + '.agrail-logo{font-size:1rem;flex:none;}'
    + '.agrail-name{font-size:.66rem;font-weight:800;letter-spacing:.4px;white-space:nowrap;'
    + 'overflow:hidden;color:#dbe4f0;}'
    + '.agrail-tg{margin-left:auto;background:none;border:1px solid #2a3547;color:#7c8aa0;'
    + 'border-radius:6px;width:22px;height:22px;cursor:pointer;font-size:.7rem;line-height:1;flex:none;}'
    + '.agrail-tg:hover{color:#dbe4f0;border-color:#5b9cff;}'
    + '.agrail-nav{display:flex;flex-direction:column;gap:1px;padding:8px 8px 22px;}'
    + '.agrail-grp{font-size:.5rem;font-weight:800;letter-spacing:1px;text-transform:uppercase;'
    + 'color:#5a6577;padding:12px 8px 4px;white-space:nowrap;}'
    + '.agrail-nav a{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px;'
    + 'color:#93a2b8;font-size:.68rem;font-weight:700;text-decoration:none;border:1px solid transparent;'
    + 'white-space:nowrap;}'
    + '.agrail-nav a i{font-style:normal;width:16px;text-align:center;flex:none;font-size:.8rem;}'
    + '.agrail-nav a span{overflow:hidden;text-overflow:ellipsis;}'
    + '.agrail-nav a:hover{background:rgba(91,156,255,.10);color:#cfe0ff;}'
    + '.agrail-nav a.on{background:rgba(91,156,255,.16);color:#cfe0ff;border-color:#2a3547;}'
    + '.agrail-nav a:focus-visible{outline:2px solid #5b9cff;outline-offset:1px;}'
    + 'html.agrail-min .agrail-name,html.agrail-min .agrail-grp,'
    + 'html.agrail-min .agrail-nav a span{display:none;}'
    + 'html.agrail-min .agrail-nav a{justify-content:center;padding:9px 0;}'
    + 'html.agrail-min .agrail-top{padding:12px 6px 10px;}'
    + '@media(max-width:820px){.agrail{width:' + WMIN + 'px;}'
    + '.agrail-name,.agrail-grp,.agrail-nav a span{display:none;}'
    + '.agrail-nav a{justify-content:center;padding:9px 0;}.agrail-tg{display:none;}}'
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

  function build() {
    var here = currentPath();
    var aside = document.createElement('aside');
    aside.className = 'agrail';
    aside.setAttribute('aria-label', 'Sections');

    var html = '<div class="agrail-top">'
      + '<span class="agrail-logo">🚀</span>'
      + '<span class="agrail-name">ANTIGRAVITY <b>PRO</b></span>'
      + '<button class="agrail-tg" id="agrailTg" aria-label="Collapse or expand the sidebar">‹</button>'
      + '</div><nav class="agrail-nav" aria-label="Pages">';

    for (var k = 0; k < PAGES.length; k++) {
      var p = PAGES[k];
      if (p.g) { html += '<div class="agrail-grp">' + p.g + '</div>'; continue; }
      var on = (p.h === here);
      html += '<a href="' + p.h + '"' + (on ? ' class="on" aria-current="page"' : '')
            + ' title="' + p.t + '"><i>' + p.i + '</i><span>' + p.t + '</span></a>';
    }
    aside.innerHTML = html + '</nav>';
    document.body.insertBefore(aside, document.body.firstChild);

    // Inline offset so a page's own `body{padding}` cannot cancel it.
    applyOffset();
    document.getElementById('agrailTg').addEventListener('click', toggle);
  }

  function applyOffset() {
    var min = document.documentElement.classList.contains('agrail-min');
    var narrow = window.matchMedia('(max-width:820px)').matches;
    document.body.style.paddingLeft = ((min || narrow) ? WMIN : W) + 'px';
    var b = document.getElementById('agrailTg');
    if (b) { b.textContent = min ? '›' : '‹'; b.title = (min ? 'Expand' : 'Collapse') + ' (b)'; }
  }

  // localStorage throws in private mode and under some embedded webviews. That is a
  // real condition, not something to swallow: the rail still works, the preference
  // simply stops persisting, and we stop trying rather than throwing on every toggle.
  var storageOk = true;

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

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
