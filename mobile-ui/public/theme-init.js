/** Runs before the Vite bundle — theme + one-shot stale-build bust. */

(function () {
  var KEY = "supernova-mobile-theme";
  var BUILD = "2026.08.09-mobile-v28-no-tabs";
  var BUILD_KEY = "sn_mobile_build_stamp";

  try {
    var stored = localStorage.getItem(KEY);
    var theme = stored === "light" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    if (theme === "dark") document.documentElement.classList.add("dark");
    else document.documentElement.classList.remove("dark");
  } catch (e) {
    document.documentElement.setAttribute("data-theme", "dark");
  }

  // If Simple Browser / PWA still has an old shell, wipe SW + Cache API once.
  try {
    if (localStorage.getItem(BUILD_KEY) === BUILD) return;
    localStorage.setItem(BUILD_KEY, BUILD);
    var busted = sessionStorage.getItem("sn_mobile_bust_" + BUILD);
    if (busted === "1") return;
    sessionStorage.setItem("sn_mobile_bust_" + BUILD, "1");

    var tasks = [];
    if ("serviceWorker" in navigator) {
      tasks.push(
        navigator.serviceWorker.getRegistrations().then(function (regs) {
          return Promise.all(regs.map(function (r) { return r.unregister(); }));
        })
      );
    }
    if (typeof caches !== "undefined" && caches.keys) {
      tasks.push(
        caches.keys().then(function (keys) {
          return Promise.all(keys.map(function (k) { return caches.delete(k); }));
        })
      );
    }
    Promise.all(tasks)
      .catch(function () {})
      .then(function () {
        var url = new URL(window.location.href);
        url.searchParams.set("_snb", BUILD.slice(-12));
        window.location.replace(url.toString());
      });
  } catch (e2) {
    /* ignore */
  }
})();
