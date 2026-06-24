/** Eseguito in index.html prima del bundle — evita flash tema. */
(function () {
  var KEY = "supernova_theme";
  var APPEARANCE_KEY = "sn-theme";
  try {
    var stored = localStorage.getItem(KEY);
    var root = document.documentElement;
    root.classList.remove("dark", "theme-black", "theme-chiaro");
    var appearance = localStorage.getItem(APPEARANCE_KEY) === "mint" ? "mint" : "violet";
    root.setAttribute("data-theme", appearance);
    if (stored === "light") {
      root.classList.add("theme-chiaro");
    } else if (stored === "black") {
      root.classList.add("dark", "theme-black");
    } else if (stored === "dark") {
      root.classList.add("dark");
    } else {
      var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) root.classList.add("dark");
      else root.classList.add("theme-chiaro");
    }
  } catch (e) {
    /* ignore */
  }
})();
