/** Eseguito in index.html prima del bundle — evita flash tema. */
(function () {
  var KEY = "supernova_theme";
  var APPEARANCE_KEY = "sn-theme";
  try {
    var stored = localStorage.getItem(KEY);
    var root = document.documentElement;
    root.classList.remove("dark", "theme-black", "theme-chiaro");
    // Product UI is SuperNova layout only — migrate violet/mint.
    localStorage.setItem(APPEARANCE_KEY, "supernova");
    root.setAttribute("data-theme", "supernova");
    if (stored === "light") {
      root.classList.add("theme-chiaro");
    } else if (stored === "black") {
      root.classList.add("dark", "theme-black");
    } else if (stored === "dark") {
      root.classList.add("dark");
    } else {
      // SuperNova desk is dark by default.
      root.classList.add("dark");
    }
  } catch (e) {
    /* ignore */
  }
})();
