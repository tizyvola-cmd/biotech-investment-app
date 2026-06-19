async function apiBase() {
  return window.supernova.getApiUrl();
}

async function api(path, options = {}) {
  const base = await apiBase();
  const headers = { ...(options.headers || {}) };
  const method = (options.method || "GET").toUpperCase();
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const token = await window.supernova.getApiToken?.();
    if (token) headers["X-SuperNova-Token"] = token;
  }
  const res = await fetch(`${base}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function setupTabs() {
  const tabs = document.querySelectorAll(".tab");
  const panels = {
    status: document.getElementById("panel-status"),
    charts: document.getElementById("panel-charts"),
  };
  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.tab;
      tabs.forEach((t) => t.classList.toggle("active", t === btn));
      Object.entries(panels).forEach(([key, el]) => {
        if (el) el.classList.toggle("active", key === id);
      });
      if (id === "charts" && window.SupernovaCharts) {
        window.SupernovaCharts.renderAll();
      }
    });
  });
}

async function refreshStatus() {
  const el = document.getElementById("status");
  try {
    const s = await api("/api/status");
    el.textContent = `Workbook: ${s.workbook || "—"} · aggiornato: ${
      s.workbook_mtime || "—"
    } · orchestrator: ${s.orchestrator_running ? "in corso" : "fermo"}`;
    const log = await api("/api/orchestrator/log?tail=3000");
    document.getElementById("log").textContent = log.log || "(vuoto)";
  } catch (e) {
    el.textContent = `Errore API: ${e.message}`;
  }
}

async function loadCharts() {
  const note = document.getElementById("charts-note");
  if (note) note.textContent = "Caricamento curve…";
  try {
    const data = await api("/api/charts/simulation");
    if (window.SupernovaCharts) {
      window.SupernovaCharts.setBundle(data);
    }
    document.querySelector('.tab[data-tab="charts"]')?.click();
  } catch (e) {
    if (note) note.textContent = `Errore: ${e.message}`;
  }
}

document.getElementById("btn-refresh")?.addEventListener("click", refreshStatus);
document.getElementById("btn-quick")?.addEventListener("click", async () => {
  try {
    const r = await api("/api/orchestrator/run?profile=quick", { method: "POST" });
    document.getElementById("status").textContent = JSON.stringify(r);
    setTimeout(refreshStatus, 2000);
  } catch (e) {
    document.getElementById("status").textContent = String(e);
  }
});
document.getElementById("btn-load-charts")?.addEventListener("click", loadCharts);

setupTabs();
if (window.SupernovaCharts) {
  window.SupernovaCharts.bindControls();
}

refreshStatus();
loadCharts();
