/* ═══════════════════════════════════════════════════════════════════════════
   ANTIGRAVITY — keep a page inside one screen.  <script src="/js/fit.js"></script>

   WHY THIS FILE EXISTS
     Measured on the owner's 2560x1330 panel, eleven of twenty-two pages ran past
     the viewport — trade.html at 12.5 screens, agents.html at 9.7. The header,
     the instrument selector and the column headings all scrolled away, so the
     number you were reading had no label above it.

   WHAT IT DOES
     Mark the page's data region with data-fit. That region is bounded to exactly
     the space the viewport has left, and scrolls inside itself when it holds more
     than a screen. Everything above it and below it stays put, and the page itself
     stops scrolling.

   WHY NOT height:100dvh AND flexbox
     Because the pages differ. Each has its own header, its own controls, its own
     footer note, and several are laid out by JS after data arrives. Measuring what
     is actually there beats asserting a structure none of them share.

   HONEST LIMIT
     A table of seven hundred strikes is longer than any screen. This does not
     shrink it — it moves the scrolling from the page into the table, which is the
     difference between losing the headings and keeping them.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.__agFit) return;
  window.__agFit = true;

  var MIN = 320;          // below this a region is unreadable; better to let the page scroll
  var pending = false;

  function region() { return document.querySelector('[data-fit]'); }

  function apply() {
    pending = false;
    var g = region();
    if (!g) return;

    // Nothing here is measured from the region's own height, so the cap is never
    // lifted to take a reading. An earlier version did lift it, and paid for it:
    // clearing the cap resized the body, the observer below fired, the cap was
    // cleared again, and the region spent much of its life unbounded.
    var had = g.style.maxHeight;
    var top = g.getBoundingClientRect().top + (window.scrollY || 0);

    // Everything after the region still needs its space. That is not just the
    // region's own next siblings: it is every following sibling at every level up
    // to the body, plus each ancestor's bottom padding and margin. Counting only
    // the immediate parent left four pages short by exactly the body's padding.
    var below = 0;
    for (var node = g; node && node !== document.body && node.parentElement; node = node.parentElement) {
      for (var el = node.nextElementSibling; el; el = el.nextElementSibling) {
        var r = el.getBoundingClientRect();
        if (!r.height) continue;
        var cs = getComputedStyle(el);
        below += r.height + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
      }
      below += parseFloat(getComputedStyle(node).marginBottom) || 0;
      below += parseFloat(getComputedStyle(node.parentElement).paddingBottom) || 0;
    }
    below += parseFloat(getComputedStyle(document.body).marginBottom) || 0;

    var h = Math.max(MIN, Math.round(window.innerHeight - top - below));
    var next = h + 'px';
    if (next === had) return;                 // unchanged: write nothing, so the observer stays quiet
    g.style.maxHeight = next;
    g.style.overflowY = 'auto';
    g.style.overflowX = 'hidden';
    /* A scroll container only clips absolutely positioned descendants when it is
       also their containing block. Left static, greeks.html still scrolled 727px:
       the sr-only <caption> elements inside the chain table were positioned against
       the document, sat two thousand pixels down at their static position, and
       stretched the page even though nothing visible was down there. */
    if (getComputedStyle(g).position === 'static') g.style.position = 'relative';
  }

  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(apply);
  }

  function init() {
    if (!region()) return;                  // page did not opt in
    apply();
    window.addEventListener('resize', schedule);
    // Live pages rebuild their controls as data arrives, which moves the region's
    // top edge. Watching the body catches that without polling.
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(schedule);
      ro.observe(document.body);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
