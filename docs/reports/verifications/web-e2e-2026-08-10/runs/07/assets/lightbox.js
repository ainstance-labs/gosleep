/* agentic-report-creator — screenshot lightbox
 * Vanilla DOM. No dependencies, no external globals. Works offline from file://.
 *
 * Markup contract (produced by the report renderer):
 *   <img class="shot-img"
 *        src="assets/plan-shipped-light.png"
 *        alt="Shipped Plan header"
 *        data-lightbox-group="finding-1"        <- siblings share a group
 *        data-caption="Shipped Plan header"      <- optional; falls back to alt
 *        data-full="assets/plan-shipped-full.png"><- optional hi-res; falls back to src
 *
 * Behavior:
 *   - click a thumbnail            -> open overlay on that image
 *   - Left / Right arrow buttons   -> walk siblings within the SAME group (wraps)
 *   - ArrowLeft / ArrowRight keys  -> same
 *   - Escape, click-outside, [x]   -> close
 *   - focus is trapped while open and restored to the thumbnail on close
 */
(function () {
  "use strict";

  function init() {
    var thumbs = Array.prototype.slice.call(
      document.querySelectorAll("[data-lightbox-group]")
    );
    if (!thumbs.length) return;

    // Group thumbnails by their data-lightbox-group value, preserving DOM order.
    var groups = {};
    thumbs.forEach(function (el) {
      var g = el.getAttribute("data-lightbox-group");
      (groups[g] = groups[g] || []).push({
        src: el.getAttribute("data-full") || el.getAttribute("src"),
        caption: el.getAttribute("data-caption") || el.getAttribute("alt") || "",
      });
    });

    // Build the overlay once and reuse it.
    var overlay = document.createElement("div");
    overlay.className = "lb-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-hidden", "true");
    overlay.innerHTML =
      '<button class="lb-close" type="button" aria-label="Close">✕</button>' +
      '<button class="lb-btn lb-prev" type="button" aria-label="Previous">‹</button>' +
      '<button class="lb-btn lb-next" type="button" aria-label="Next">›</button>' +
      '<figure class="lb-figure">' +
      '<img class="lb-img" alt="">' +
      '<figcaption class="lb-caption">' +
      '<span class="lb-text"></span><span class="lb-counter"></span>' +
      "</figcaption></figure>";
    document.body.appendChild(overlay);

    var imgEl = overlay.querySelector(".lb-img");
    var textEl = overlay.querySelector(".lb-text");
    var counterEl = overlay.querySelector(".lb-counter");
    var prevBtn = overlay.querySelector(".lb-prev");
    var nextBtn = overlay.querySelector(".lb-next");
    var closeBtn = overlay.querySelector(".lb-close");
    var figure = overlay.querySelector(".lb-figure");

    var current = [];    // active group array
    var index = 0;       // active index within the group
    var lastFocused = null;

    function render() {
      var item = current[index];
      if (!item) return;
      imgEl.src = item.src;
      imgEl.alt = item.caption;
      textEl.textContent = item.caption;
      var multi = current.length > 1;
      counterEl.textContent = multi ? index + 1 + " / " + current.length : "";
      prevBtn.hidden = !multi;
      nextBtn.hidden = !multi;
    }

    function open(groupName, startIndex) {
      current = groups[groupName] || [];
      if (!current.length) return;
      index = startIndex || 0;
      lastFocused = document.activeElement;
      render();
      overlay.classList.add("open");
      overlay.setAttribute("aria-hidden", "false");
      document.body.style.overflow = "hidden";
      document.addEventListener("keydown", onKey);
      closeBtn.focus();
    }

    function close() {
      overlay.classList.remove("open");
      overlay.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      document.removeEventListener("keydown", onKey);
      imgEl.src = "";
      if (lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    }

    function step(delta) {
      if (current.length < 2) return;
      index = (index + delta + current.length) % current.length;
      render();
    }

    function onKey(e) {
      switch (e.key) {
        case "Escape":     close(); break;
        case "ArrowLeft":  step(-1); break;
        case "ArrowRight": step(1);  break;
        case "Tab":        trapFocus(e); break;
      }
    }

    // Keep Tab focus cycling among the overlay's own controls.
    function trapFocus(e) {
      var focusables = [closeBtn, prevBtn, nextBtn].filter(function (b) {
        return !b.hidden;
      });
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      var active = document.activeElement;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      else if (focusables.indexOf(active) === -1) { e.preventDefault(); first.focus(); }
    }

    // Wire the thumbnails. Plain <img> is not keyboard-focusable, so make each
    // thumbnail a focusable button-like control: click OR Enter/Space opens it,
    // and focus can then be restored to it on close.
    thumbs.forEach(function (el) {
      var g = el.getAttribute("data-lightbox-group");
      var idxInGroup = groups[g].findIndex(function (it) {
        return it.src === (el.getAttribute("data-full") || el.getAttribute("src"));
      });
      var start = idxInGroup < 0 ? 0 : idxInGroup;
      el.style.cursor = "zoom-in";
      if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "0");
      if (!el.hasAttribute("role")) el.setAttribute("role", "button");
      el.addEventListener("click", function () { open(g, start); });
      el.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(g, start); }
      });
    });

    // Overlay controls.
    prevBtn.addEventListener("click", function () { step(-1); });
    nextBtn.addEventListener("click", function () { step(1); });
    closeBtn.addEventListener("click", close);
    // Click-outside: closing only when the backdrop (not the image/figure) is hit.
    overlay.addEventListener("click", function (e) {
      if (!figure.contains(e.target) && e.target !== figure) close();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
