/* bookSHelf page-plugin wrapper for Tracing Paper. Appended after the core by build.py.
 *
 * Manifest entry config (written by the page build):
 *   { "presets": [ ...preset objects... ] }
 * It opens the tool in a dialog from any link or element in the page (and adds a floating button when config.fab is true):
 *   <a href="#tracing-paper">  or  <a href="#tracing-paper:parallel">   (the part after the colon picks a preset)
 *   <button data-tracing-paper data-tracing-preset="parallel">
 *   <div class="tp-inline" data-tracing-preset="parallel"></div>    the tool, built into the page right where the div sits
 * A page without the plugin just has a harmless in-page link and an empty div.
 */
(function () {
  "use strict";
  window.BookshelfPlugins.register("tracing-paper", {
    mount: function (_slot, config) {
      config = config || {};
      document.documentElement.classList.add("tp-page-themed");   // follow the page's own light/dark choice, not the OS
      var presets = config.presets && config.presets.length ? config.presets : (window.TRACING_PAPER_PRESETS || []);
      var isOpen = false;
      function open(id) {
        if (isOpen) return;
        isOpen = true;
        window.TracingPaper.openModal({ presets: presets, preset: id, onClose: function () { isOpen = false; } });
      }
      var inlineHosts = document.querySelectorAll(".tp-inline");
      for (var i = 0; i < inlineHosts.length; i++) {
        var h = inlineHosts[i];
        if (h.getAttribute("data-tp-mounted")) continue;
        h.setAttribute("data-tp-mounted", "1");
        window.TracingPaper.mount(h, { presets: presets, preset: h.getAttribute("data-tracing-preset") || undefined });
      }
      if (config.fab) {                       // a floating button is opt-in: pages with the tool inline do not need one
        var fab = document.createElement("button");
        fab.type = "button"; fab.className = "tp-btn tp-fab"; fab.textContent = "Tracing paper";
        fab.addEventListener("click", function () { open(); });
        document.body.appendChild(fab);
      }
      document.addEventListener("click", function (ev) {
        var t = ev.target.closest && ev.target.closest('a[href^="#tracing-paper"], [data-tracing-paper]');
        if (!t) return;
        ev.preventDefault();
        var id = t.getAttribute("data-tracing-preset");
        if (!id && t.getAttribute("href")) { var m = t.getAttribute("href").match(/^#tracing-paper(?::(.+))?$/); id = m && m[1]; }
        open(id || undefined);
      });
    },
  });
})();
