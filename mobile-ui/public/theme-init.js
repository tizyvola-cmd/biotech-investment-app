/** Eseguito in index.html prima del bundle — tema mobile dark/light. */

(function () {

  var KEY = "supernova-mobile-theme";

  try {

    var stored = localStorage.getItem(KEY);

    var theme = stored === "light" ? "light" : "dark";

    document.documentElement.setAttribute("data-theme", theme);

    if (theme === "dark") document.documentElement.classList.add("dark");

    else document.documentElement.classList.remove("dark");

  } catch (e) {

    document.documentElement.setAttribute("data-theme", "dark");

  }

})();

