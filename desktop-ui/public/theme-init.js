/** Eseguito in index.html prima del bundle — evita flash tema. */
(function () {
  var KEY = "supernova_theme";
  try {
    var stored = localStorage.getItem(KEY);
    var root = document.documentElement;
    root.classList.remove("dark", "theme-black");
    if (stored === "light") {
      /* chiaro */
    } else if (stored === "black") {
      root.classList.add("dark", "theme-black");
    } else if (stored === "dark") {
      root.classList.add("dark");
    } else {
      var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) root.classList.add("dark");
    }
  } catch (e) {
    /* ignore */
  }
})();
