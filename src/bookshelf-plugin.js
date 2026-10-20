/* bookSHelf page-plugin wrapper for Tracing Paper. Appended after the core by build.py.
 *
 * Manifest entry config (written by the page build):
 *   { "presets": [ ...preset objects... ] }
 * It adds a floating "Tracing paper" button, and opens the tool from any link or element in the page:
 *   <a href="#tracing-paper">  or  <a href="#tracing-paper:parallel">   (the part after the colon picks a preset)
 *   <button data-tracing-paper data-tracing-preset="parallel">
 * A page without the plugin just has a harmless in-page link.
 */
(function () {
  "use strict";
  window.BookshelfPlugins.register("tracing-paper", {
    mount: function (_slot, config) {
      config = config || {};
      var presets = config.presets && config.presets.length ? config.presets : (window.TRACING_PAPER_PRESETS || []);
      var isOpen = false;
      function open(id) {
        if (isOpen) return;
        isOpen = true;
        window.TracingPaper.openModal({ presets: presets, preset: id, onClose: function () { isOpen = false; } });
      }
      var fab = document.createElement("button");
      fab.type = "button"; fab.className = "tp-btn tp-fab"; fab.textContent = "Tracing paper";
      fab.addEventListener("click", function () { open(); });
      document.body.appendChild(fab);
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
