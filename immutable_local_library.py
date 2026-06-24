# -*- coding: utf-8 -*-
"""
Libreria locale «immutabile» — dati che, una volta ottenuti, non cambiano identità storica:

  • **RAM (sessione):** parse JSON / piccole strutture ricaricate solo se il file su disco cambia (`mtime`).
  • **Disco:** inventario degli artefatti attesi (`data/` pickle, JSON, XLSX) — a ogni run si *verifica*,
    senza rifare download: elenco cosa è già coperto vs cosa un fetcher dovrebbe ancora ottenere.

Non sostituisce i fetcher: coordina reuse e diagnostica.

Env:
  IMMUTABLE_LIBRARY=0       — skip report in orchestrator (default attivo).
  IMMUTABLE_LIBRARY_QUIET=1 — meno stdout.
  ORCH_SKIP_IMMUTABLE_INDEX=1 — usato da ``data_orchestrator``: salta la scrittura di
                                ``immutable_library_index.json`` (solo log console; meno I/O disco).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterable

from orchestrator_io_paths import DATA_DIR

DEFAULT_DATA_DIR = Path(DATA_DIR)
INDEX_SNAPSHOT_NAME = "immutable_library_index.json"

# File «canonici» prodotti/consultati dalla pipeline principale (path relativi a data/).
CANONICAL_RELATIVE_FILES: tuple[str, ...] = (
    "yf.json",
    "finnhub.json",
    "variations.json",
    "biotech_clinical_openfda.xlsx",
    "biotech_symbols.json",
    "model_calibration_state.json",
    "model_historical_input_library.json",
)

# Opzionale: artefatti spesso presenti dopo run completi / retro.
COMMON_OPTIONAL_RELATIVE: tuple[str, ...] = (
    "biotech_orchestrated_output.json",
    "biotech_orchestrated_output.xlsx",
    "pred_calibration.json",
    "sec_company_tickers.json",
    "past_catalyst_predictions.json",
)


def _quiet() -> bool:
    return os.environ.get("IMMUTABLE_LIBRARY_QUIET", "").strip() in ("1", "true", "yes")


def enabled_for_orchestrator() -> bool:
    return os.environ.get("IMMUTABLE_LIBRARY", "").strip() not in ("0", "false", "no")


# ── RAM sessione (invalidazione per mtime — niente TTL «magico») ─────────────


class SessionRamCache:
    """Singolo dict per-processo: (path_resolve, mtime) → oggetto già caricato."""

    __slots__ = ("_blob", "_json")

    def __init__(self) -> None:
        self._json: dict[tuple[str, float], Any] = {}
        self._blob: dict[tuple[str, float], Any] = {}

    def load_json(self, path: Path) -> Any:
        p = path.resolve()
        st = p.stat()
        key = (str(p), st.st_mtime)
        hit = self._json.get(key)
        if hit is not None:
            return hit
        # Elimina chiavi stale stesso path
        stale = [k for k in self._json if k[0] == str(p) and k[1] != st.st_mtime]
        for k in stale:
            del self._json[k]
        raw = json.loads(p.read_text(encoding="utf-8"))
        self._json[key] = raw
        return raw

    def load_bytes_keyed(self, path: Path) -> bytes:
        p = path.resolve()
        st = p.stat()
        key = (str(p), st.st_mtime)
        if key in self._blob:
            return self._blob[key]
        stale = [k for k in self._blob if k[0] == str(p) and k[1] != st.st_mtime]
        for k in stale:
            del self._blob[k]
        b = p.read_bytes()
        self._blob[key] = b
        return b


_SESSION: SessionRamCache | None = None


def ram() -> SessionRamCache:
    global _SESSION
    if _SESSION is None:
        _SESSION = SessionRamCache()
    return _SESSION


def load_json_memo(path: str | Path) -> Any:
    """JSON decodificato una volta per (file, revisione disco)."""
    return ram().load_json(Path(path))


# ── Verifica disco: cosa c’è, cosa manca, quante serie prezzi ────────────────


def _safe_exists(root: Path, rel: str) -> bool:
    try:
        return (root / rel).is_file()
    except OSError:
        return False


def verify_canonical_files(data_dir: str | Path = DEFAULT_DATA_DIR) -> tuple[list[str], list[str]]:
    """(presenti, assenti) come path relativi a ``data_dir``."""
    root = Path(data_dir)
    ok: list[str] = []
    miss: list[str] = []
    for rel in CANONICAL_RELATIVE_FILES:
        if _safe_exists(root, rel):
            ok.append(rel)
        else:
            miss.append(rel)
    return ok, miss


def count_price_pickles(data_dir: str | Path = DEFAULT_DATA_DIR) -> dict[str, int]:
    pc = Path(data_dir) / "price_cache"
    out = {"pickles_close": 0, "pickles_cv": 0}
    try:
        for p in pc.iterdir():
            if not p.is_file():
                continue
            name = p.name.lower()
            if name.endswith("_cv.pkl"):
                out["pickles_cv"] += 1
            elif name.endswith(".pkl"):
                out["pickles_close"] += 1
    except FileNotFoundError:
        pass
    return out


def missing_price_slices(
    tickers: Iterable[str],
    periods: Iterable[str],
    data_dir: str | Path = DEFAULT_DATA_DIR,
) -> list[tuple[str, str]]:
    """Lista (ticker, period) senza pickle close (solo verifica nome file come `_pcache_path`)."""
    root = Path(data_dir) / "price_cache"
    need: list[tuple[str, str]] = []
    for tk_raw in tickers:
        tk = str(tk_raw).strip().upper().replace("/", "_").replace("\\", "_")
        safe = tk.replace("^", "_IDX_")
        for per in periods:
            path = root / f"{safe}_{per}.pkl"
            if not path.is_file():
                need.append((tk_raw.strip().upper(), str(per)))
    return need


def write_snapshot(
    data_dir: str | Path = DEFAULT_DATA_DIR,
    *,
    extra_tickers_to_check: list[str] | None = None,
    price_periods: tuple[str, ...] = ("5y", "3y", "2y"),
    canonical_ok_miss: tuple[list[str], list[str]] | None = None,
    pickle_counts: dict[str, int] | None = None,
) -> dict[str, Any]:
    """Scrive `data/immutable_library_index.json` con riepilogo (debug / audit locale)."""
    root = Path(data_dir)
    if canonical_ok_miss is not None:
        pres, absent = canonical_ok_miss
    else:
        pres, absent = verify_canonical_files(root)
    if pickle_counts is not None:
        pc = dict(pickle_counts)
    else:
        pc = count_price_pickles(root)
    missing_slices: list[tuple[str, str]] = []
    if extra_tickers_to_check:
        missing_slices = missing_price_slices(
            extra_tickers_to_check,
            price_periods,
            root,
        )

    opt_pres = [rel for rel in COMMON_OPTIONAL_RELATIVE if _safe_exists(root, rel)]

    snap: dict[str, Any] = {
        "schema": 1,
        "canonical_ok": pres,
        "canonical_missing": absent,
        "optional_present": opt_pres,
        "price_pickles_counts": pc,
        "missing_price_slices_sample": [{"ticker": t, "period": p} for t, p in missing_slices[:200]],
        "missing_price_slices_truncated": len(missing_slices) > 200,
    }
    outp = root / INDEX_SNAPSHOT_NAME
    outp.parent.mkdir(parents=True, exist_ok=True)
    outp.write_text(json.dumps(snap, ensure_ascii=False, indent=2), encoding="utf-8")
    return snap


def verify_and_report_startup(
    data_dir: str | Path = DEFAULT_DATA_DIR,
    *,
    extra_tickers_to_check: list[str] | None = None,
    price_periods: tuple[str, ...] = ("5y", "3y"),
    write_index: bool = True,
    verbose: bool = True,
) -> dict[str, Any]:
    """
    Chiamata consigliata all’ingresso dell’orchestrator: stampa sintesi + opzionale snapshot JSON.

    Scarica solo la logica dei fetcher; qui **nessuna** HTTP: solo stato locale.
    """
    root = Path(data_dir)
    pres, absent = verify_canonical_files(root)
    pc = count_price_pickles(root)
    snap_part: dict[str, Any] = {
        "canonical_ok_count": len(pres),
        "canonical_missing_count": len(absent),
        "canonical_missing": absent,
        **pc,
    }
    ms: list[tuple[str, str]] = []
    if extra_tickers_to_check:
        ms = missing_price_slices(extra_tickers_to_check, price_periods, root)
        snap_part["missing_price_pairs"] = len(ms)

    full: dict[str, Any] = {**snap_part, "index_written": False}
    if write_index:
        write_snapshot(
            root,
            extra_tickers_to_check=extra_tickers_to_check,
            price_periods=price_periods,
            canonical_ok_miss=(pres, absent),
            pickle_counts=pc,
        )
        full["index_written"] = True
        full["index_path"] = str((root / INDEX_SNAPSHOT_NAME).resolve())

    if verbose and not _quiet():
        q = pc["pickles_close"] + pc["pickles_cv"]
        print(
            "[ImmutableLibrary] Artefatti locali · "
            f"file canonici OK {len(pres)}/{len(CANONICAL_RELATIVE_FILES)} · "
            f"pickles price_cache={q}",
            flush=True,
        )
        if absent:
            print(
                "[ImmutableLibrary] Da ottenere (fetch / merge): "
                + ", ".join(absent),
                flush=True,
            )
        else:
            print(
                "[ImmutableLibrary] Nessun file canonico obbligatorio mancante — "
                "i downloader verificheranno solo gap incrementali.",
                flush=True,
            )
        if extra_tickers_to_check and ms:
            print(
                f"[ImmutableLibrary] Serie prezzo mancanti (campione richiesto): {len(ms)} coppie "
                f"ticker×period → verranno coperte da `_yf_batch_close` / fetch.",
                flush=True,
            )
        elif extra_tickers_to_check:
            print(
                "[ImmutableLibrary] Serie prezzo già coperte per i ticker passati nel check.",
                flush=True,
            )

    return full


if __name__ == "__main__":
    verify_and_report_startup()
