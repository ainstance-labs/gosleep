/* GoSleep audit dashboard — findings filter + section scrollspy.
 * Vanilla, no dependencies, no network. The theme toggle is wired by the
 * inline <head> script so it works before this file loads.
 * Localised strings come from window.ARC_I18N (set per page).
 */
(function () {
  "use strict";

  var T = (window.ARC_I18N || {});
  var txt = function (k, fallback) { return T[k] != null ? T[k] : fallback; };

  /* ------------------------------------------------------------------ *
   * 1. Findings filter
   * ------------------------------------------------------------------ */
  function initFilters() {
    var root = document.getElementById("findings-list");
    if (!root) return;

    var cards = Array.prototype.slice.call(root.querySelectorAll(".finding"));
    var buttons = Array.prototype.slice.call(document.querySelectorAll(".filter[data-facet]"));
    var search = document.getElementById("finding-search");
    var status = document.getElementById("filter-status");
    var empty = document.getElementById("no-results");
    var reset = document.getElementById("filter-reset");

    /* state: facet -> Set of active values ("" = all) */
    var state = { sev: new Set(), zone: new Set(), epic: new Set(), pillar: new Set() };
    var query = "";

    function matches(card) {
      if (state.sev.size && !state.sev.has(card.dataset.severity)) return false;
      if (state.zone.size && !state.zone.has(card.dataset.zone)) return false;
      if (state.pillar.size && !state.pillar.has(card.dataset.pillar)) return false;
      if (state.epic.size) {
        var eps = (card.dataset.epic || "").split(" ").filter(Boolean);
        var hit = eps.some(function (e) { return state.epic.has(e); });
        if (!hit) return false;
      }
      if (query && (card.dataset.search || "").indexOf(query) === -1) return false;
      return true;
    }

    function apply() {
      var shown = 0;
      for (var i = 0; i < cards.length; i++) {
        var ok = matches(cards[i]);
        cards[i].hidden = !ok;
        if (ok) shown++;
      }
      if (status) {
        status.innerHTML = "<b>" + shown + "</b> / " + cards.length + " " +
          txt("shown", "shown");
      }
      if (empty) empty.hidden = shown !== 0;
      if (reset) reset.hidden = !(query || state.sev.size || state.zone.size ||
        state.epic.size || state.pillar.size);
    }

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var facet = btn.dataset.facet, value = btn.dataset.value;
        var set = state[facet];
        if (!set) return;
        if (set.has(value)) { set.delete(value); btn.setAttribute("aria-pressed", "false"); }
        else { set.add(value); btn.setAttribute("aria-pressed", "true"); }
        apply();
      });
    });

    if (search) {
      search.addEventListener("input", function () {
        query = search.value.trim().toLowerCase();
        apply();
      });
    }

    if (reset) {
      reset.addEventListener("click", function () {
        Object.keys(state).forEach(function (k) { state[k].clear(); });
        query = "";
        if (search) search.value = "";
        buttons.forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
        apply();
      });
    }

    /* Deep links: #finding-42 or ?sev=CRITICAL must reveal their target. */
    function revealHashTarget() {
      var h = location.hash;
      if (!h || h.indexOf("#finding-") !== 0) return;
      var el = document.querySelector(h);
      if (el && el.hidden) {
        Object.keys(state).forEach(function (k) { state[k].clear(); });
        query = "";
        if (search) search.value = "";
        buttons.forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
        apply();
        el.scrollIntoView();
      }
    }
    window.addEventListener("hashchange", revealHashTarget);

    apply();
    revealHashTarget();
  }

  /* ------------------------------------------------------------------ *
   * 2. Section scrollspy for the sticky nav
   * ------------------------------------------------------------------ */
  function initScrollspy() {
    var links = Array.prototype.slice.call(document.querySelectorAll(".section-nav a[href^='#']"));
    if (!links.length) return;
    var targets = links
      .map(function (a) {
        var el = document.getElementById(a.getAttribute("href").slice(1));
        return el ? { link: a, el: el } : null;
      })
      .filter(Boolean);
    if (!targets.length) return;

    var ticking = false;
    function update() {
      ticking = false;
      var y = window.scrollY + 150;
      var active = targets[0];
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].el.offsetTop <= y) active = targets[i];
      }
      links.forEach(function (a) { a.classList.remove("is-active"); });
      active.link.classList.add("is-active");
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    update();
  }

  function boot() { initFilters(); initScrollspy(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else { boot(); }
})();
