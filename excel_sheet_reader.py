"""
Lettura read-only dei fogli ``biotech_orchestrated_output.xlsx`` per l'API SuperNova / desktop-ui.
"""
from __future__ import annotations

import re
import time
from datetime import date, datetime
from pathlib import Path
from typing import Any
from zipfile import BadZipFile

from orchestrator_io_paths import FINAL_XLSX

_XLSX_PK_MAGIC = b"PK"
_WORKBOOK_BUSY_IT = "Workbook non valido o in scrittura. Chiudi Excel e riprova."
_WORKBOOK_BUSY_EN = "Workbook invalid or being written. Close Excel and try again."


class WorkbookReadError(Exception):
    """Workbook assente, bloccato da Excel, corrotto o in salvataggio."""

    def __init__(
        self,
        path: str | Path,
        *,
        status_code: int = 503,
        cause: str | None = None,
    ) -> None:
        self.path = str(path)
        self.status_code = status_code
        self.message_it = _WORKBOOK_BUSY_IT
        self.message_en = _WORKBOOK_BUSY_EN
        self.cause = cause
        super().__init__(f"{_WORKBOOK_BUSY_IT} Path: {self.path}")

    def as_detail(self) -> dict[str, Any]:
        detail: dict[str, Any] = {
            "message": self.message_en,
            "message_it": self.message_it,
            "path": self.path,
        }
        if self.cause:
            detail["cause"] = self.cause
        return detail


def _preflight_xlsx(path: Path) -> None:
    """Verifica che il file esista, non sia vuoto e abbia magic ZIP (xlsx)."""
    if not path.is_file():
        raise WorkbookReadError(path, status_code=503, cause="missing")
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise WorkbookReadError(path, status_code=503, cause=str(exc)) from exc
    if size <= 0:
        raise WorkbookReadError(path, status_code=503, cause="empty_file")
    try:
        with path.open("rb") as fh:
            head = fh.read(4)
    except PermissionError as exc:
        raise WorkbookReadError(path, status_code=409, cause="permission_denied") from exc
    except OSError as exc:
        raise WorkbookReadError(path, status_code=503, cause=str(exc)) from exc
    if not head.startswith(_XLSX_PK_MAGIC):
        raise WorkbookReadError(path, status_code=503, cause="not_xlsx_zip")


def _load_workbook_readonly(path: Path):
    """Apre il workbook con preflight, retry breve su BadZipFile (salvataggio in corso)."""
    return _load_workbook(path, read_only=True)


def _load_workbook(path: Path, *, read_only: bool) -> Any:
    """Apre il workbook con preflight, retry breve su BadZipFile (salvataggio in corso)."""
    import openpyxl

    _preflight_xlsx(path)
    last: BaseException | None = None
    for attempt in range(2):
        try:
            return openpyxl.load_workbook(path, read_only=read_only, data_only=True)
        except PermissionError as exc:
            raise WorkbookReadError(path, status_code=409, cause="permission_denied") from exc
        except BadZipFile as exc:
            last = exc
            if attempt == 0:
                time.sleep(0.5)
                _preflight_xlsx(path)
                continue
            raise WorkbookReadError(path, status_code=503, cause="bad_zip") from exc
    if last is not None:
        raise WorkbookReadError(path, status_code=503, cause="bad_zip") from last
    raise WorkbookReadError(path, status_code=503, cause="load_failed")


def _json_cell(v: Any) -> Any:
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, float):
        if v != v:
            return None
        if v == int(v):
            return int(v)
        return round(v, 6)
    return v


def _hyperlink_url(cell: Any) -> str | None:
    """URL esterno da ``cell.hyperlink`` (openpyxl), se presente."""
    hl = getattr(cell, "hyperlink", None)
    if hl is None:
        return None
    for attr in ("target", "location"):
        raw = getattr(hl, attr, None)
        if not raw:
            continue
        url = str(raw).strip()
        if not url or url.startswith("#"):
            continue
        if url.startswith("www."):
            return f"https://{url}"
        if url.startswith(("http://", "https://", "mailto:")):
            return url
    return None


def _export_cell_value(cell: Any) -> Any:
    """
    Valore JSON per una cella Excel: scalare oppure ``{"text": "...", "href": "..."}``
    se c'è un hyperlink (es. colonna «Elenco 8‑K (SEC EDGAR)»).
    """
    url = _hyperlink_url(cell)
    val = _json_cell(cell.value)
    if not url:
        return val
    text = str(val).strip() if val is not None else ""
    if not text:
        text = url
    return {"text": text, "href": url}


def _cik_int_from_cell_value(val: Any) -> int | None:
    """CIK numerico da scalare o ``{text, href}`` (colonna CIK SEC K-8)."""
    if isinstance(val, dict):
        val = val.get("text")
    if val is None:
        return None
    digits = re.sub(r"\D", "", str(val))
    if not digits:
        return None
    try:
        n = int(digits)
    except ValueError:
        return None
    return n if n > 0 else None


def _sec_edgar_browse_8k_url(cik_int: int) -> str:
    return (
        "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany"
        f"&CIK={cik_int}&type=8-K&owner=exclude&count=100"
    )


def _sec_submissions_json_url(cik_int: int) -> str:
    return f"https://data.sec.gov/submissions/CIK{str(cik_int).zfill(10)}.json"


def _normalize_col_key(name: str) -> str:
    return re.sub(r"[\s_\-]+", "_", str(name or "").strip().lower())


def _is_sec_elenco_8k_column(name: str) -> bool:
    key = _normalize_col_key(name).replace("_", " ")
    return "elenco" in key and "8" in key


def _is_sec_cik_column(name: str) -> bool:
    key = _normalize_col_key(name)
    return key.startswith("cik")


def _enrich_sec_k8_row_links(rec: dict[str, Any]) -> None:
    """Fallback ``{text,href}`` da CIK se snapshot/Excel ha solo testo."""
    cik_int: int | None = None
    for hdr, val in rec.items():
        if _is_sec_cik_column(hdr):
            cik_int = _cik_int_from_cell_value(val)
            if cik_int:
                break
    if not cik_int:
        return
    for hdr, val in list(rec.items()):
        if isinstance(val, dict) and val.get("href"):
            continue
        if _is_sec_elenco_8k_column(hdr):
            text = str(val or "").strip() or "Elenco 8‑K (SEC)"
            if text in ("—", "-", ""):
                continue
            rec[hdr] = {"text": text, "href": _sec_edgar_browse_8k_url(cik_int)}
        elif _is_sec_cik_column(hdr):
            text = str(val or "").strip()
            if not text or text in ("—", "-"):
                continue
            rec[hdr] = {"text": text, "href": _sec_submissions_json_url(cik_int)}


def _trim_phantom_col_headers(headers: list[str]) -> list[str]:
    """Rimuove ``col_N`` finali da lettura eccessiva di colonne Excel."""
    out = list(headers)
    while out and re.fullmatch(r"col_\d+", out[-1].strip(), re.IGNORECASE):
        out.pop()
    return out


_NCT_VALUE_RE = re.compile(r"^NCT\d{8,}$", re.IGNORECASE)
_NCT_COL_KEYS = frozenset(
    {"nct_id", "nctid", "nct_number", "nct", "study_id", "nct id"}
)


def _is_nct_column(name: str) -> bool:
    key = _normalize_col_key(name)
    return key in _NCT_COL_KEYS or key.startswith("nct")


def _nct_clinicaltrials_url(nct: str) -> str | None:
    s = str(nct or "").strip().upper()
    if _NCT_VALUE_RE.match(s):
        return f"https://clinicaltrials.gov/study/{s}"
    return None


def _scalar_to_nct_link(val: Any) -> Any:
    """Scala o ``{text,href}`` per colonna NCT (CSV / valori senza hyperlink Excel)."""
    if isinstance(val, dict) and val.get("href"):
        return val
    if val is None:
        return None
    text = str(val).strip()
    if not text or text in ("—", "-", "N/D"):
        return _json_cell(val)
    url = _nct_clinicaltrials_url(text)
    if url:
        return {"text": text, "href": url}
    return _json_cell(val)


def _export_nct_cell_value(cell: Any) -> Any:
    """Come ``_export_cell_value`` con fallback URL CT.gov da testo ``NCT…``."""
    val = _export_cell_value(cell)
    if isinstance(val, dict) and val.get("href"):
        return val
    text = ""
    if isinstance(val, dict):
        text = str(val.get("text") or "").strip()
    elif val is not None:
        text = str(val).strip()
    if not text:
        return val
    url = _nct_clinicaltrials_url(text)
    if url:
        return {"text": text, "href": url}
    return val


def _load_clinical_from_xlsx(p: Path) -> tuple[list[dict[str, Any]], list[str], str | None]:
    import openpyxl

    try:
        wb = openpyxl.load_workbook(p, read_only=False, data_only=True)
    except Exception as exc:
        return [], [], f"Lettura {p.name} fallita: {exc}"
    try:
        ws = wb.active
        header_cells = next(
            ws.iter_rows(min_row=1, max_row=1, min_col=1, max_col=80, values_only=False),
            (),
        )
        headers: list[str] = []
        for i, cell in enumerate(header_cells):
            raw = cell.value
            if raw is None and not headers:
                continue
            label = str(raw or "").strip() or f"col_{i + 1}"
            headers.append(label)
        while headers and not headers[-1].strip():
            headers.pop()
        if not headers:
            return [], [], f"{p.name}: intestazioni assenti"

        nct_indices = {i for i, h in enumerate(headers) if _is_nct_column(h)}
        rows: list[dict[str, Any]] = []
        max_row = int(ws.max_row or 1)
        for row_cells in ws.iter_rows(
            min_row=2,
            max_row=max_row,
            min_col=1,
            max_col=len(headers),
            values_only=False,
        ):
            rec: dict[str, Any] = {}
            empty = True
            for ci, hdr in enumerate(headers):
                cell = row_cells[ci] if ci < len(row_cells) else None
                if _is_nct_column(hdr):
                    val = _export_nct_cell_value(cell) if cell is not None else None
                else:
                    val = _json_cell(cell.value if cell is not None else None)
                if val not in (None, "", "—", "-"):
                    empty = False
                rec[hdr] = val
            if not empty:
                rows.append(rec)
        return rows, headers, None
    finally:
        wb.close()


def list_workbook_sheets(*, xlsx_path: str | Path | None = None) -> dict[str, Any]:
    path = Path(xlsx_path or FINAL_XLSX)
    if not path.is_file():
        return {"sheets": [], "path": str(path), "error": "workbook_missing"}
    wb = _load_workbook_readonly(path)
    try:
        return {"sheets": list(wb.sheetnames), "path": str(path)}
    finally:
        wb.close()


def read_sheet_table(
    sheet_name: str,
    *,
    xlsx_path: str | Path | None = None,
    header_row: int = 1,
    max_rows: int = 5000,
    max_cols: int = 80,
) -> dict[str, Any]:
    """Foglio generico: prima riga dati = ``header_row``, righe sotto = record."""
    path = Path(xlsx_path or FINAL_XLSX)
    if not path.is_file():
        return {
            "sheet": sheet_name,
            "columns": [],
            "rows": [],
            "error": f"Workbook assente: {path}",
        }
    wb = _load_workbook_readonly(path)
    try:
        if sheet_name not in wb.sheetnames:
            return {
                "sheet": sheet_name,
                "columns": [],
                "rows": [],
                "error": f"Foglio «{sheet_name}» non trovato",
                "available": list(wb.sheetnames),
            }
        ws = wb[sheet_name]
        headers: list[str] = []
        for c in range(1, max_cols + 1):
            raw = ws.cell(row=header_row, column=c).value
            if raw is None and c > 1 and not headers:
                continue
            label = str(raw or "").strip() or f"col_{c}"
            headers.append(label)
        while headers and not headers[-1].strip():
            headers.pop()

        rows: list[dict[str, Any]] = []
        end = min(int(ws.max_row or header_row), header_row + max_rows)
        for rn in range(header_row + 1, end + 1):
            rec: dict[str, Any] = {}
            empty = True
            for ci, hdr in enumerate(headers, start=1):
                val = _json_cell(ws.cell(row=rn, column=ci).value)
                if val not in (None, "", "—", "-"):
                    empty = False
                rec[hdr] = val
            if not empty:
                rows.append(rec)
        return {
            "sheet": sheet_name,
            "columns": headers,
            "rows": rows,
            "row_count": len(rows),
            "path": str(path),
        }
    finally:
        wb.close()


def _is_simulation_link_studio_column(name: str) -> bool:
    return _normalize_col_key(name).replace("_", " ") == "link studio"


def _enrich_simulation_row_links(rec: dict[str, Any]) -> None:
    """Fallback URL CT.gov su «Link studio» da NCT se manca hyperlink Excel."""
    nct_val = rec.get("NCT")
    nct_link = _scalar_to_nct_link(nct_val)
    if nct_link and not (isinstance(nct_val, dict) and nct_val.get("href")):
        rec["NCT"] = nct_link

    link_val = rec.get("Link studio")
    if isinstance(link_val, dict) and link_val.get("href"):
        return
    if not nct_link or not isinstance(nct_link, dict):
        return
    text = ""
    if link_val is not None:
        text = str(link_val if not isinstance(link_val, dict) else link_val.get("text") or "").strip()
    if not text or text in ("—", "-", "N/D"):
        text = str(nct_link.get("text") or "Studio CT.gov").strip()
    rec["Link studio"] = {"text": text, "href": nct_link["href"]}


def read_simulation_table(*, xlsx_path: str | Path | None = None) -> dict[str, Any]:
    """Foglio «Simulation» — header riga 3, dati da riga 4 (``SIMULATION_36_HEADERS``)."""
    from data_orchestrator import SIMULATION_36_HEADERS

    path = Path(xlsx_path or FINAL_XLSX)
    if not path.is_file():
        return {
            "sheet": "Simulation",
            "columns": list(SIMULATION_36_HEADERS),
            "rows": [],
            "error": f"Workbook assente: {path}",
        }
    wb = _load_workbook(path, read_only=False)
    try:
        if "Simulation" not in wb.sheetnames:
            return {
                "sheet": "Simulation",
                "columns": list(SIMULATION_36_HEADERS),
                "rows": [],
                "error": "Foglio Simulation assente",
                "available": list(wb.sheetnames),
            }
        ws = wb["Simulation"]
        headers = list(SIMULATION_36_HEADERS)
        ncols = len(headers)
        rows: list[dict[str, Any]] = []
        for rn in range(4, int(ws.max_row or 0) + 1):
            tk = str(ws.cell(row=rn, column=1).value or "").strip().upper()
            if not tk or tk in ("—", "-", "N/D"):
                continue
            rec: dict[str, Any] = {}
            empty = True
            for ci, hdr in enumerate(headers, start=1):
                if ci > ncols:
                    break
                cell = ws.cell(row=rn, column=ci)
                if _is_simulation_link_studio_column(hdr):
                    val = _export_cell_value(cell)
                elif _is_nct_column(hdr):
                    val = _export_nct_cell_value(cell)
                else:
                    val = _json_cell(cell.value)
                if val not in (None, "", "—", "-"):
                    empty = False
                rec[hdr] = val
            if not empty:
                _enrich_simulation_row_links(rec)
                rows.append(rec)
        return {
            "sheet": "Simulation",
            "columns": headers,
            "rows": rows,
            "row_count": len(rows),
            "path": str(path),
        }
    finally:
        wb.close()


def read_simulation_table_from_snapshot() -> dict[str, Any]:
    """Legge ``data/simulation_sheet_snapshot.json`` (nessun accesso Excel)."""
    from data_orchestrator import SIMULATION_36_HEADERS
    from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON

    snap = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
    if not snap.is_file():
        return {
            "sheet": "Simulation",
            "columns": list(SIMULATION_36_HEADERS),
            "rows": [],
            "error": "Snapshot Simulation assente. Esegui refresh sul desktop.",
            "source": "snapshot_missing",
        }
    try:
        import json

        doc = json.loads(snap.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return {
            "sheet": "Simulation",
            "columns": list(SIMULATION_36_HEADERS),
            "rows": [],
            "error": f"Snapshot Simulation non leggibile: {exc}",
            "source": "snapshot_invalid",
        }
    if not isinstance(doc, dict):
        return {
            "sheet": "Simulation",
            "columns": list(SIMULATION_36_HEADERS),
            "rows": [],
            "error": "Snapshot Simulation non valido",
            "source": "snapshot_invalid",
        }
    out = dict(doc)
    out["source"] = "snapshot"
    if "sheet" not in out:
        out["sheet"] = "Simulation"
    return out


def read_simulation_table_cached(*, xlsx_path: str | Path | None = None) -> dict[str, Any]:
    """
    Preferisce Excel; se workbook bloccato/illeggibile usa snapshot JSON.
    """
    try:
        payload = read_simulation_table(xlsx_path=xlsx_path)
        if payload.get("rows") or not payload.get("error"):
            payload["source"] = "workbook"
            return payload
    except WorkbookReadError:
        snap = read_simulation_table_from_snapshot()
        if snap.get("rows"):
            snap["workbook_note"] = _WORKBOOK_BUSY_IT
            return snap
        raise
    err = str(payload.get("error") or "")
    if payload.get("rows"):
        payload["source"] = "workbook"
        return payload
    snap = read_simulation_table_from_snapshot()
    if snap.get("rows"):
        snap["workbook_note"] = err or "Dati da snapshot (Excel non disponibile)."
        return snap
    return payload


def _find_accuracy_header_row(ws, max_scan: int = 8) -> int:
    for rn in range(1, max_scan + 1):
        v = str(ws.cell(row=rn, column=1).value or "").strip().lower()
        if v == "ticker":
            return rn
    return 3


def _find_financial_header_row(ws, max_scan: int = 5) -> int:
    """Riga intestazione: cella «symbol» (save_final_outputs → riga 1)."""
    for rn in range(1, max_scan + 1):
        for c in range(1, 60):
            v = str(ws.cell(row=rn, column=c).value or "").strip().lower()
            if v == "symbol":
                return rn
    return 1


def _financial_data_start_row(ws, header_row: int, sym_col: int) -> int:
    """Dati da riga 4 (dopo descrizioni riga 2 e μ/σ riga 3); fallback se layout compatto."""
    for offset in (3, 1, 2):
        r = header_row + offset
        tk = str(ws.cell(row=r, column=sym_col).value or "").strip().upper()
        if tk and tk not in ("—", "-", "N/D", "SYMBOL") and not tk.startswith("Μ") and not tk.startswith("μ"):
            if _TICKER_LIKE_RE.match(tk):
                return r
    return header_row + 3


_TICKER_LIKE_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,9}$")

# Cache in-process: path → (mtime, payload) — Financial / Accuracy pesanti su xlsx grandi.
_FINANCIAL_TABLE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_ACCURACY_TABLE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def _read_financial_table_fast(ws, *, path: Path, default_cols: list[str]) -> dict[str, Any]:
    """Lettura Financial con ``iter_rows(values_only=True)`` (read_only openpyxl)."""
    sheet = "Financial"
    hdr_row = _find_financial_header_row(ws)
    headers: list[str] = []
    sym_col = 1
    max_hdr_col = 40
    header_vals = next(
        ws.iter_rows(
            min_row=hdr_row,
            max_row=hdr_row,
            min_col=1,
            max_col=max_hdr_col,
            values_only=True,
        ),
        (),
    )
    for ci, raw in enumerate(header_vals or (), start=1):
        if raw is None and ci > 1 and not headers:
            continue
        label = str(raw or "").strip() or f"col_{ci}"
        headers.append(label)
        if label.lower() == "symbol":
            sym_col = ci
    while headers and not str(headers[-1]).strip():
        headers.pop()
    if not headers:
        headers = list(default_cols)

    max_col = len(headers)
    data_start = _financial_data_start_row(ws, hdr_row, sym_col)
    try:
        sheet_end = int(ws.max_row or data_start)
    except (TypeError, ValueError):
        sheet_end = data_start + 5000
    end = min(sheet_end, data_start + 5000)

    rows: list[dict[str, Any]] = []
    sym_ix = sym_col - 1
    for values in ws.iter_rows(
        min_row=data_start,
        max_row=end,
        min_col=1,
        max_col=max_col,
        values_only=True,
    ):
        if not values:
            continue
        row_vals = list(values)
        if sym_ix >= len(row_vals):
            continue
        tk = str(row_vals[sym_ix] or "").strip().upper()
        if not tk or tk in ("—", "-", "N/D") or tk.startswith("μ") or tk.startswith("Μ"):
            continue
        if not _TICKER_LIKE_RE.match(tk):
            continue
        rec: dict[str, Any] = {}
        empty = True
        for ci, hdr in enumerate(headers):
            val = _json_cell(row_vals[ci] if ci < len(row_vals) else None)
            if val not in (None, "", "—", "-"):
                empty = False
            rec[hdr] = val
        if not empty:
            rows.append(rec)

    return {
        "sheet": sheet,
        "columns": headers or default_cols,
        "rows": rows,
        "row_count": len(rows),
        "path": str(path),
        "header_row": hdr_row,
        "data_start_row": data_start,
    }


def read_financial_table(*, xlsx_path: str | Path | None = None) -> dict[str, Any]:
    """
    Foglio «Financial» — header riga 1, descrizioni riga 2, stats riga 3, dati da riga 4.
    Allineato a ``save_final_outputs`` in data_orchestrator.
    """
    from data_orchestrator import _COL_ORDERED

    path = Path(xlsx_path or FINAL_XLSX)
    sheet = "Financial"
    default_cols = [c for c in _COL_ORDERED]
    if not path.is_file():
        return {
            "sheet": sheet,
            "columns": default_cols,
            "rows": [],
            "error": f"Workbook assente: {path}",
        }
    wb = _load_workbook_readonly(path)
    try:
        if sheet not in wb.sheetnames:
            return {
                "sheet": sheet,
                "columns": default_cols,
                "rows": [],
                "error": f"Foglio «{sheet}» non trovato",
                "available": list(wb.sheetnames),
            }
        ws = wb[sheet]
        return _read_financial_table_fast(ws, path=path, default_cols=default_cols)
    finally:
        wb.close()


def _load_financial_snapshot_json() -> dict[str, Any] | None:
    """Lettura istantanea da ``data/financial_sheet_snapshot.json`` se presente."""
    from orchestrator_io_paths import FINANCIAL_SHEET_SNAPSHOT_JSON

    snap = Path(FINANCIAL_SHEET_SNAPSHOT_JSON)
    if not snap.is_file():
        return None
    try:
        import json

        data = json.loads(snap.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("rows"), list):
            data.setdefault("row_count", len(data["rows"]))
            data["snapshot_path"] = str(snap)
            return data
    except Exception:
        return None
    return None


def _write_financial_snapshot_json(payload: dict[str, Any]) -> None:
    from orchestrator_io_paths import DATA_DIR, FINANCIAL_SHEET_SNAPSHOT_JSON

    snap = Path(FINANCIAL_SHEET_SNAPSHOT_JSON)
    snap.parent.mkdir(parents=True, exist_ok=True)
    import json

    out = dict(payload)
    out.pop("snapshot_path", None)
    snap.write_text(json.dumps(out, ensure_ascii=False, default=str), encoding="utf-8")


def read_financial_table_cached(*, xlsx_path: str | Path | None = None) -> dict[str, Any]:
    """
    Financial per l'API desktop: snapshot JSON (istantaneo) se aggiornato,
    altrimenti Excel (``iter_rows``) + cache in memoria + riscrittura snapshot.
    """
    path = Path(xlsx_path or FINAL_XLSX)
    from orchestrator_io_paths import FINANCIAL_SHEET_SNAPSHOT_JSON

    snap_path = Path(FINANCIAL_SHEET_SNAPSHOT_JSON)
    snap = _load_financial_snapshot_json()
    if snap is not None:
        if not path.is_file():
            return snap
        try:
            snap_m = snap_path.stat().st_mtime
            xlsx_m = path.stat().st_mtime
            if snap_m >= xlsx_m - 1.0:
                return snap
        except OSError:
            return snap

    if not path.is_file():
        return read_financial_table(xlsx_path=xlsx_path)

    key = str(path.resolve())
    mtime = path.stat().st_mtime
    hit = _FINANCIAL_TABLE_CACHE.get(key)
    if hit and hit[0] == mtime:
        return hit[1]

    payload = read_financial_table(xlsx_path=path)
    _FINANCIAL_TABLE_CACHE[key] = (mtime, payload)
    if payload.get("rows") and not payload.get("error"):
        try:
            _write_financial_snapshot_json(payload)
        except OSError:
            pass
    return payload


def export_financial_snapshot(*, xlsx_path: str | Path | None = None) -> dict[str, Any]:
    """CLI: rigenera ``data/financial_sheet_snapshot.json`` da Excel."""
    payload = read_financial_table(xlsx_path=xlsx_path)
    if payload.get("rows") and not payload.get("error"):
        _write_financial_snapshot_json(payload)
        print(
            f"[Financial snapshot] OK - {payload.get('row_count', 0)} righe -> "
            f"data/financial_sheet_snapshot.json",
            flush=True,
        )
    else:
        print(f"[Financial snapshot] KO — {payload.get('error', 'nessuna riga')}", flush=True)
    return payload


def merge_yf_into_financial_snapshot() -> dict[str, Any]:
    """Merges any tickers present in yf.json but missing from the financial snapshot.

    Called after a New Bio IPO scan so that newly added companies appear in the
    Financial table immediately, without waiting for a full orchestrator run.
    Returns a dict with ``added`` (list of tickers inserted) and ``total`` row count.
    """
    import json

    from orchestrator_io_paths import FINANCIAL_SHEET_SNAPSHOT_JSON

    # Load current snapshot
    snap_path = Path(FINANCIAL_SHEET_SNAPSHOT_JSON)
    if snap_path.is_file():
        try:
            snap_data = json.loads(snap_path.read_text(encoding="utf-8"))
        except Exception:
            snap_data = {}
    else:
        snap_data = {}

    existing_rows: list[dict] = snap_data.get("rows") or []
    existing_symbols: set[str] = {
        str(r.get("symbol", "")).strip().upper() for r in existing_rows if r.get("symbol")
    }
    columns: list[str] = list(snap_data.get("columns") or [])

    # Load yf.json
    try:
        import fetch_yfinance as _yf

        yf_map = _yf.load_existing_yf_json()  # {TICKER: {...}}
    except Exception as exc:
        return {"error": str(exc), "added": [], "total": len(existing_rows)}

    # Map yf fields → financial snapshot column names
    _FIELD_MAP = {
        "symbol": "symbol",
        "companyName": "companyName",
        "sector": "sector",
        "industry": "industry",
        "marketCap": "marketCap",
        "beta": "beta",
        "currentPrice": "currentPrice",
        "previousClose": "last_close",
        "dailyChange_%": "dailyChange_%",
        "currency": "currency",
        "country": "country",
        "website": "website",
        "enterpriseValue": "enterpriseValue",
    }

    added: list[str] = []
    for sym, yf_rec in yf_map.items():
        if sym in existing_symbols:
            continue
        new_row: dict[str, Any] = {}
        for yf_key, snap_col in _FIELD_MAP.items():
            if yf_key in yf_rec:
                new_row[snap_col] = yf_rec[yf_key]
        # Ensure symbol is always set
        new_row["symbol"] = sym
        existing_rows.append(new_row)
        existing_symbols.add(sym)
        # Register any new column names
        for col in new_row:
            if col not in columns:
                columns.append(col)
        added.append(sym)

    if not added:
        return {"added": [], "total": len(existing_rows)}

    merged: dict[str, Any] = {
        **snap_data,
        "rows": existing_rows,
        "row_count": len(existing_rows),
        "columns": columns,
    }
    merged.pop("snapshot_path", None)
    snap_path.parent.mkdir(parents=True, exist_ok=True)
    snap_path.write_text(json.dumps(merged, ensure_ascii=False, default=str), encoding="utf-8")
    # ``cp1252`` consoles (Windows default) can't encode the U+2192 arrow; use
    # ASCII fallback to avoid UnicodeEncodeError during background refreshes.
    try:
        print(
            f"[Financial snapshot] merged {len(added)} new IPO ticker(s): {added} "
            f"-> total {len(existing_rows)} rows",
            flush=True,
        )
    except UnicodeEncodeError:
        print(
            f"[Financial snapshot] merged {len(added)} new IPO tickers, total "
            f"{len(existing_rows)} rows",
            flush=True,
        )
    return {"added": added, "total": len(existing_rows)}


def sync_yf_quotes_into_financial_snapshot() -> dict[str, Any]:
    """Aggiorna prezzi/metriche Yahoo sulle righe già presenti in ``financial_sheet_snapshot.json``."""
    import json

    from orchestrator_io_paths import FINANCIAL_SHEET_SNAPSHOT_JSON

    snap_path = Path(FINANCIAL_SHEET_SNAPSHOT_JSON)
    if not snap_path.is_file():
        return {"error": "financial snapshot missing", "updated": 0, "total": 0}

    try:
        snap_data = json.loads(snap_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"error": str(exc), "updated": 0, "total": 0}

    rows: list[dict] = snap_data.get("rows") or []
    if not rows:
        return {"updated": 0, "total": 0}

    try:
        import fetch_yfinance as _yf

        yf_map = _yf.load_existing_yf_json()
    except Exception as exc:
        return {"error": str(exc), "updated": 0, "total": len(rows)}

    _QUOTE_FIELDS = {
        "companyName": "companyName",
        "sector": "sector",
        "industry": "industry",
        "marketCap": "marketCap",
        "enterpriseValue": "enterpriseValue",
        "beta": "beta",
        "currentPrice": "currentPrice",
        "previousClose": "last_close",
        "dailyChange_%": "dailyChange_%",
        "currency": "currency",
        "country": "country",
        "website": "website",
    }

    updated = 0
    for row in rows:
        sym = str(row.get("symbol") or "").strip().upper()
        if not sym:
            continue
        yf_rec = yf_map.get(sym)
        if not yf_rec:
            continue
        changed = False
        for yf_key, snap_col in _QUOTE_FIELDS.items():
            if yf_key not in yf_rec:
                continue
            val = yf_rec[yf_key]
            if row.get(snap_col) != val:
                row[snap_col] = val
                changed = True
        if changed:
            updated += 1

    if updated:
        merged: dict[str, Any] = {
            **snap_data,
            "rows": rows,
            "row_count": len(rows),
        }
        merged.pop("snapshot_path", None)
        snap_path.write_text(json.dumps(merged, ensure_ascii=False, default=str), encoding="utf-8")
        print(
            f"[Financial snapshot] synced quotes for {updated}/{len(rows)} tickers",
            flush=True,
        )

    return {"updated": updated, "total": len(rows)}


def _accuracy_data_start_row(ws, header_row: int) -> int:
    """Prima riga dati dopo intestazione (col. A = ticker)."""
    for offset in (1, 2, 3):
        r = header_row + offset
        row_vals = next(
            ws.iter_rows(
                min_row=r,
                max_row=r,
                min_col=1,
                max_col=1,
                values_only=True,
            ),
            (),
        )
        tk = str((row_vals[0] if row_vals else None) or "").strip().upper()
        if tk and tk not in ("—", "-", "N/D", "TICKER") and _TICKER_LIKE_RE.match(tk):
            return r
    return header_row + 1


def _read_accuracy_table_fast(ws, *, path: Path, max_cols: int = 72) -> dict[str, Any]:
    """Lettura Accuracy con ``iter_rows`` (evita centinaia di ms per cella)."""
    sheet = "Accuracy"
    hdr_row = _find_accuracy_header_row(ws)
    header_vals = next(
        ws.iter_rows(
            min_row=hdr_row,
            max_row=hdr_row,
            min_col=1,
            max_col=max_cols,
            values_only=True,
        ),
        (),
    )
    headers: list[str] = []
    for ci, raw in enumerate(header_vals or (), start=1):
        if raw is None and ci > 1 and not headers:
            continue
        label = str(raw or "").strip() or f"col_{ci}"
        headers.append(label)
    while headers and not str(headers[-1]).strip():
        headers.pop()
    if not headers:
        headers = [f"col_{i}" for i in range(1, max_cols + 1)]

    max_col = len(headers)
    data_start = _accuracy_data_start_row(ws, hdr_row)
    try:
        sheet_end = int(ws.max_row or data_start)
    except (TypeError, ValueError):
        sheet_end = data_start + 8000
    end = min(sheet_end, data_start + 8000)

    rows: list[dict[str, Any]] = []
    for values in ws.iter_rows(
        min_row=data_start,
        max_row=end,
        min_col=1,
        max_col=max_col,
        values_only=True,
    ):
        if not values:
            continue
        row_vals = list(values)
        tk = str(row_vals[0] or "").strip().upper()
        if not tk or tk in ("—", "-", "N/D"):
            continue
        if tk.startswith("───") or tk.startswith("TOTALE") or tk.startswith("METRICHE"):
            continue
        if not _TICKER_LIKE_RE.match(tk):
            continue
        rec: dict[str, Any] = {}
        empty = True
        for ci, hdr in enumerate(headers):
            val = _json_cell(row_vals[ci] if ci < len(row_vals) else None)
            if val not in (None, "", "—", "-"):
                empty = False
            rec[hdr] = val
        if not empty:
            rows.append(rec)

    return {
        "sheet": sheet,
        "columns": headers,
        "rows": rows,
        "row_count": len(rows),
        "path": str(path),
        "header_row": hdr_row,
        "data_start_row": data_start,
    }


def read_accuracy_v4_v5_summary(
    *, json_path: str | Path | None = None
) -> dict[str, Any]:
    """Riepilogo MAE v4/v5 da ``data/accuracy_v4_v5_summary.json``."""
    from orchestrator_io_paths import DATA_DIR

    p = Path(json_path or DATA_DIR) / "accuracy_v4_v5_summary.json"
    if json_path and str(json_path).endswith(".json"):
        p = Path(json_path)
    if not p.is_file():
        return {"summary": None, "path": str(p), "error": "File riepilogo assente"}
    import json

    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"summary": None, "path": str(p), "error": str(exc)}
    return {"summary": data, "path": str(p)}


def read_accuracy_table(*, xlsx_path: str | Path | None = None) -> dict[str, Any]:
    """Foglio «Accuracy» — intestazione (col. A = Ticker), lettura ``iter_rows``."""
    path = Path(xlsx_path or FINAL_XLSX)
    sheet = "Accuracy"
    if not path.is_file():
        out = {"sheet": sheet, "columns": [], "rows": [], "error": f"Workbook assente: {path}"}
        out["v4_v5_summary"] = read_accuracy_v4_v5_summary().get("summary")
        return out
    wb = _load_workbook_readonly(path)
    try:
        if sheet not in wb.sheetnames:
            out = {
                "sheet": sheet,
                "columns": [],
                "rows": [],
                "error": f"Foglio «{sheet}» non trovato",
                "available": list(wb.sheetnames),
            }
            out["v4_v5_summary"] = read_accuracy_v4_v5_summary().get("summary")
            return out
        ws = wb[sheet]
        out = _read_accuracy_table_fast(ws, path=path)
        out["v4_v5_summary"] = read_accuracy_v4_v5_summary().get("summary")
        return out
    finally:
        wb.close()


def _load_accuracy_snapshot_json() -> dict[str, Any] | None:
    from orchestrator_io_paths import ACCURACY_SHEET_SNAPSHOT_JSON

    snap = Path(ACCURACY_SHEET_SNAPSHOT_JSON)
    if not snap.is_file():
        return None
    try:
        import json

        data = json.loads(snap.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("rows"), list):
            data.setdefault("row_count", len(data["rows"]))
            data["snapshot_path"] = str(snap)
            return data
    except Exception:
        return None
    return None


def _write_accuracy_snapshot_json(payload: dict[str, Any]) -> None:
    from orchestrator_io_paths import ACCURACY_SHEET_SNAPSHOT_JSON

    snap = Path(ACCURACY_SHEET_SNAPSHOT_JSON)
    snap.parent.mkdir(parents=True, exist_ok=True)
    import json

    out = dict(payload)
    out.pop("snapshot_path", None)
    snap.write_text(json.dumps(out, ensure_ascii=False, default=str), encoding="utf-8")


def read_accuracy_table_cached(*, xlsx_path: str | Path | None = None) -> dict[str, Any]:
    """
    Accuracy per API desktop: snapshot JSON se aggiornato, altrimenti Excel veloce
    + cache in memoria + riscrittura snapshot.
    """
    path = Path(xlsx_path or FINAL_XLSX)
    from orchestrator_io_paths import ACCURACY_SHEET_SNAPSHOT_JSON

    snap_path = Path(ACCURACY_SHEET_SNAPSHOT_JSON)
    snap = _load_accuracy_snapshot_json()
    if snap is not None:
        if not path.is_file():
            return snap
        try:
            if snap_path.stat().st_mtime >= path.stat().st_mtime - 1.0:
                return snap
        except OSError:
            return snap

    if not path.is_file():
        return read_accuracy_table(xlsx_path=xlsx_path)

    key = str(path.resolve())
    mtime = path.stat().st_mtime
    hit = _ACCURACY_TABLE_CACHE.get(key)
    if hit and hit[0] == mtime:
        return hit[1]

    payload = read_accuracy_table(xlsx_path=path)
    _ACCURACY_TABLE_CACHE[key] = (mtime, payload)
    if payload.get("rows") and not payload.get("error"):
        try:
            _write_accuracy_snapshot_json(payload)
        except OSError:
            pass
    return payload


def _write_simulation_snapshot_json(payload: dict[str, Any]) -> None:
    from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON

    snap = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
    snap.parent.mkdir(parents=True, exist_ok=True)
    import json

    out = dict(payload)
    out.pop("snapshot_path", None)
    snap.write_text(json.dumps(out, ensure_ascii=False, default=str), encoding="utf-8")


def export_simulation_charts_snapshot(
    *,
    xlsx_path: str | Path | None = None,
    past_pred_path: str | Path | None = None,
) -> dict[str, Any]:
    """Snapshot JSON curve Simulation (stesso motore del foglio «Simulation — grafici»)."""
    from dpg_lab_data import build_simulation_lab_bundle
    from orchestrator_io_paths import SIMULATION_CHARTS_SNAPSHOT_JSON

    payload = build_simulation_lab_bundle(
        xlsx_path=xlsx_path,
        past_pred_path=past_pred_path,
    )
    n_series = len(payload.get("series") or {})
    if n_series > 0 and not payload.get("note"):
        snap = Path(SIMULATION_CHARTS_SNAPSHOT_JSON)
        snap.parent.mkdir(parents=True, exist_ok=True)
        import json

        snap.write_text(json.dumps(payload, ensure_ascii=False, default=str), encoding="utf-8")
        print(
            f"[Simulation charts snapshot] OK — {n_series} serie -> "
            f"data/simulation_charts_snapshot.json",
            flush=True,
        )
    else:
        print(
            f"[Simulation charts snapshot] KO — {payload.get('note', 'nessuna serie')}",
            flush=True,
        )
    return payload


def export_simulation_snapshot(*, xlsx_path: str | Path | None = None) -> dict[str, Any]:
    """CLI: rigenera ``data/simulation_sheet_snapshot.json`` da Excel."""
    payload = read_simulation_table(xlsx_path=xlsx_path)
    if payload.get("rows") and not payload.get("error"):
        _write_simulation_snapshot_json(payload)
        print(
            f"[Simulation snapshot] OK - {payload.get('row_count', 0)} righe -> "
            f"data/simulation_sheet_snapshot.json",
            flush=True,
        )
    else:
        print(f"[Simulation snapshot] KO - {payload.get('error', 'nessuna riga')}", flush=True)
    return payload


def _looks_like_ticker(sym: str) -> bool:
    s = (sym or "").strip().upper()
    if not s or s.startswith("──"):
        return False
    if " " in s or "TOTALE" in s or "PORTAFOGLIO" in s:
        return False
    return bool(re.match(r"^[A-Z][A-Z0-9.\-]{0,9}$", s))


def tickers_from_simulation_payload(sim_payload: dict[str, Any] | None) -> list[str]:
    """Ticker unici dal foglio Simulation (esclude righe riepilogo)."""
    out: list[str] = []
    seen: set[str] = set()
    for row in (sim_payload or {}).get("rows") or []:
        if not isinstance(row, dict):
            continue
        t = str(row.get("Ticker") or row.get("ticker") or "").strip().upper()
        if not _looks_like_ticker(t) or t in seen:
            continue
        seen.add(t)
        out.append(t)
    return sorted(out)


def _load_clinical_records() -> tuple[list[dict[str, Any]], list[str], str | None]:
    """Legge ``biotech_clinical_openfda`` (XLSX preferito per hyperlink NCT, poi CSV)."""
    from orchestrator_io_paths import CLINICAL_CSV, CLINICAL_XLSX

    xlsx_p = Path(CLINICAL_XLSX)
    if xlsx_p.is_file():
        rows, cols, err = _load_clinical_from_xlsx(xlsx_p)
        if rows or not err:
            return rows, cols, err
        if err:
            return [], [], err

    csv_p = Path(CLINICAL_CSV)
    if not csv_p.is_file():
        return [], [], "File clinical assente (biotech_clinical_openfda.csv/xlsx)"

    try:
        import pandas as pd_mod
    except ImportError:
        return [], [], "pandas non disponibile per leggere clinical CSV"

    try:
        df = pd_mod.read_csv(csv_p, dtype=str, low_memory=False)
        df.columns = [str(c).strip() for c in df.columns]
        rows = df.where(df.notna(), None).to_dict(orient="records")
        cols = list(df.columns)
        nct_cols = [c for c in cols if _is_nct_column(c)]
        for rec in rows:
            for k, v in list(rec.items()):
                if k in nct_cols:
                    rec[k] = _scalar_to_nct_link(v)
                else:
                    rec[k] = _json_cell(v)
        return rows, cols, None
    except Exception as exc:
        return [], [], f"Lettura {csv_p.name} fallita: {exc}"


def _norm_nct_id(v) -> str | None:
    if v is None:
        return None
    s = str(v).strip().upper().replace(" ", "")
    m = re.match(r"^(NCT\d{8,})", s)
    return m.group(1) if m else None


def _norm_date_key(v) -> str | None:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    if not s or s in ("—", "-", "N/D"):
        return None
    head = s[:10]
    if len(head) == 10 and head[4] == "-" and head[7] == "-":
        return head
    if "/" in s[:6]:
        parts = s.replace(".", "/").split("/")
        if len(parts) == 3 and len(parts[2]) == 4:
            try:
                d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
                return date(y, m, d).isoformat()
            except (ValueError, TypeError):
                pass
    try:
        return date.fromisoformat(s[:10]).isoformat()
    except ValueError:
        return None


def _study_href_from_cell(v: Any) -> str | None:
    if isinstance(v, dict):
        href = v.get("href")
        if isinstance(href, str) and href.strip().startswith("http"):
            return href.strip()
        text = str(v.get("text") or "").strip()
        nct = _norm_nct_id(text)
        if nct:
            return f"https://clinicaltrials.gov/study/{nct}"
    nct = _norm_nct_id(v)
    if nct:
        return f"https://clinicaltrials.gov/study/{nct}"
    return None


def _days_from_today_iso(iso: str | None) -> int | None:
    if not iso:
        return None
    try:
        cd = date.fromisoformat(iso[:10])
    except ValueError:
        return None
    return (cd - date.today()).days


# Prossimo catalyst Simulation visibile in Clinical: solo CD futuro entro ~2 mesi.
CLINICAL_MAX_CD_DAYS = 120
CLINICAL_HOT_CD_DAYS = 60
CLINICAL_CD_MATCH_TOLERANCE_DAYS = 7

_CANONICAL_CLINICAL_CD_COLS = (
    "primary_completion_date",
    "completion_date",
    "estimated_completion_date",
)


def _clinical_row_canonical_cd(row: dict[str, Any], cd_cols: list[str]) -> str | None:
    """Primary completion prima (allineato a «Completion Date» Simulation)."""
    for col in _CANONICAL_CLINICAL_CD_COLS:
        if col in cd_cols:
            iso = _norm_date_key(row.get(col))
            if iso:
                return iso
    for col in cd_cols:
        iso = _norm_date_key(row.get(col))
        if iso:
            return iso
    return None


def _dates_match_catalyst(iso_a: str | None, iso_b: str | None, *, tolerance: int = CLINICAL_CD_MATCH_TOLERANCE_DAYS) -> bool:
    if not iso_a or not iso_b:
        return False
    if iso_a == iso_b:
        return True
    try:
        a = date.fromisoformat(iso_a[:10])
        b = date.fromisoformat(iso_b[:10])
    except ValueError:
        return False
    return abs((a - b).days) <= tolerance


def _pick_simulation_cd_row(rows: list[dict[str, Any]]) -> dict[str, Any] | None:
    """CD catalyst per ticker: prossimo evento futuro entro CLINICAL_MAX_CD_DAYS."""
    best_future: tuple[int, dict[str, Any]] | None = None
    for row in rows:
        if not isinstance(row, dict):
            continue
        iso = _norm_date_key(row.get("Completion Date"))
        if not iso:
            continue
        days = _days_from_today_iso(iso)
        if days is None or days < 0 or days > CLINICAL_MAX_CD_DAYS:
            continue
        if best_future is None or days < best_future[0]:
            best_future = (days, row)
    return best_future[1] if best_future else None


def _build_simulation_cd_catalog(sim_rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    by_ticker: dict[str, list[dict[str, Any]]] = {}
    for row in sim_rows:
        if not isinstance(row, dict):
            continue
        tk = str(row.get("Ticker") or row.get("ticker") or "").strip().upper()
        if not _looks_like_ticker(tk):
            continue
        by_ticker.setdefault(tk, []).append(row)
    catalog: dict[str, dict[str, Any]] = {}
    for tk, rows in by_ticker.items():
        pick = _pick_simulation_cd_row(rows)
        if not pick:
            continue
        iso = _norm_date_key(pick.get("Completion Date"))
        study_href = _study_href_from_cell(pick.get("Link studio")) or _study_href_from_cell(
            pick.get("NCT") or pick.get("nct")
        )
        nct = (
            _norm_nct_id(pick.get("NCT") or pick.get("nct"))
            or _norm_nct_id(pick.get("Link studio"))
            or (_norm_nct_id(study_href) if study_href else None)
        )
        catalog[tk] = {
            "ticker": tk,
            "completion_date": iso,
            "completion_date_display": str(pick.get("Completion Date") or iso or ""),
            "nct": nct,
            "company": str(pick.get("Società") or pick.get("Nome") or pick.get("Company") or "").strip(),
            "study_href": study_href or (f"https://clinicaltrials.gov/study/{nct}" if nct else None),
            "days_to_cd": _days_from_today_iso(iso),
        }
    return catalog


def _clinical_row_matches_catalyst(
    row: dict[str, Any],
    entry: dict[str, Any],
    *,
    nct_col: str | None,
    cd_cols: list[str],
) -> bool:
    days_to = entry.get("days_to_cd")
    target_cd = entry.get("completion_date")
    if not target_cd:
        return False
    try:
        cd_days = int(days_to) if days_to is not None else None
    except (TypeError, ValueError):
        cd_days = None
    if cd_days is None or cd_days < 0 or cd_days > CLINICAL_MAX_CD_DAYS:
        return False

    canon = _clinical_row_canonical_cd(row, cd_cols)
    if not canon or not _dates_match_catalyst(canon, target_cd):
        return False

    row_days = _days_from_today_iso(canon)
    if row_days is None or row_days < 0 or row_days > CLINICAL_MAX_CD_DAYS:
        return False

    if entry.get("nct") and nct_col:
        cn = _norm_nct_id(row.get(nct_col))
        if cn and cn != entry.get("nct"):
            return False
    return True


def _clinical_match_score(
    row: dict[str, Any],
    entry: dict[str, Any],
    *,
    nct_col: str | None,
    cd_cols: list[str],
) -> float:
    score = 0.0
    canon = _clinical_row_canonical_cd(row, cd_cols)
    target = entry.get("completion_date")
    if canon and target:
        try:
            diff = abs((date.fromisoformat(canon[:10]) - date.fromisoformat(str(target)[:10])).days)
            score += max(0.0, 40.0 - float(diff))
        except ValueError:
            pass
    if entry.get("nct") and nct_col:
        cn = _norm_nct_id(row.get(nct_col))
        if cn == entry.get("nct"):
            score += 100.0
        elif cn:
            score -= 80.0
    return score


def _pick_best_clinical_rows_per_ticker(
    rows: list[dict[str, Any]],
    cd_catalog: dict[str, dict[str, Any]],
    *,
    nct_col: str | None,
    cd_cols: list[str],
) -> list[dict[str, Any]]:
    best: dict[str, tuple[float, dict[str, Any]]] = {}
    for r in rows:
        tk = str(r.get("ticker") or r.get("Ticker") or "").strip().upper()
        entry = cd_catalog.get(tk)
        if not entry or not _clinical_row_matches_catalyst(r, entry, nct_col=nct_col, cd_cols=cd_cols):
            continue
        sc = _clinical_match_score(r, entry, nct_col=nct_col, cd_cols=cd_cols)
        prev = best.get(tk)
        if prev is None or sc > prev[0]:
            best[tk] = (sc, r)
    return [v[1] for tk, v in sorted(best.items(), key=lambda x: x[0])]


def read_clinical_for_simulation(
    *,
    xlsx_path: str | Path | None = None,
    tickers: list[str] | None = None,
) -> dict[str, Any]:
    """
    Righe clinical/OpenFDA per ticker in Simulation, solo studi allineati alla
  Completion Date (e NCT se presente) del foglio Simulation.
    """
    sim = read_simulation_table(xlsx_path=xlsx_path)
    sim_err = sim.get("error")
    ticker_list = [t.upper() for t in (tickers or tickers_from_simulation_payload(sim))]
    ticker_set = set(ticker_list)

    all_rows, columns, clin_err = _load_clinical_records()
    if clin_err and not all_rows:
        return {
            "sheet": "Clinical_OpenFDA",
            "columns": [],
            "rows": [],
            "tickers": ticker_list,
            "error": clin_err,
            "simulation_error": sim_err,
        }

    tk_col = next(
        (c for c in ("ticker", "Ticker", "symbol", "Symbol") if c in columns),
        None,
    )
    if not tk_col:
        return {
            "sheet": "Clinical_OpenFDA",
            "columns": columns,
            "rows": [],
            "tickers": ticker_list,
            "error": "Colonna ticker non trovata nel file clinical",
            "simulation_error": sim_err,
        }

    if not ticker_set:
        return {
            "sheet": "Clinical_OpenFDA",
            "columns": columns,
            "rows": [],
            "tickers": [],
            "error": "Nessun ticker in Simulation",
            "simulation_error": sim_err,
        }

    cd_catalog = _build_simulation_cd_catalog(sim.get("rows") or [])
    nct_col = next((c for c in columns if str(c).lower() in ("nct_id", "nctid", "nct")), None)
    cd_cols = [
        c
        for c in columns
        if "completion" in str(c).lower() and "date" in str(c).lower()
    ]
    if "estimated_completion_date" in columns and "estimated_completion_date" not in cd_cols:
        cd_cols.append("estimated_completion_date")

    filtered = _pick_best_clinical_rows_per_ticker(
        [r for r in all_rows if str(r.get(tk_col) or "").strip().upper() in ticker_set],
        cd_catalog,
        nct_col=nct_col,
        cd_cols=cd_cols,
    )

    priority = [
        "ticker",
        "nct_id",
        "brief_title",
        "phase",
        "overall_status",
        "primary_completion_date",
        "completion_date",
        "estimated_completion_date",
        "query_company",
        "Modality",
        "sponsor_match",
        "source",
    ]
    ordered_cols = [c for c in priority if c in columns]
    ordered_cols += [c for c in columns if c not in ordered_cols]

    return {
        "sheet": "Clinical_OpenFDA",
        "columns": ordered_cols,
        "rows": filtered,
        "row_count": len(filtered),
        "tickers": sorted(cd_catalog.keys()),
        "simulation_error": sim_err,
        "simulation_cd_by_ticker": cd_catalog,
        "filter_note": (
            f"Solo ticker Simulation con CD entro {CLINICAL_MAX_CD_DAYS} gg · "
            f"match primary_completion_date (±{CLINICAL_CD_MATCH_TOLERANCE_DAYS} gg) e NCT se presente"
        ),
    }


def _write_clinical_simulation_snapshot_json(payload: dict[str, Any]) -> None:
    from orchestrator_io_paths import CLINICAL_SIMULATION_SNAPSHOT_JSON

    snap = Path(CLINICAL_SIMULATION_SNAPSHOT_JSON)
    snap.parent.mkdir(parents=True, exist_ok=True)
    import json

    out = dict(payload)
    out.pop("snapshot_path", None)
    snap.write_text(json.dumps(out, ensure_ascii=False, default=str), encoding="utf-8")


_SEC_K8_SHEET = "SEC K-8"


def _find_ticker_header_row(ws, max_scan: int = 8) -> int:
    for rn in range(1, max_scan + 1):
        v = str(ws.cell(row=rn, column=1).value or "").strip().lower()
        if v == "ticker":
            return rn
    return 3


def _tickers_from_simulation_snapshot_file() -> list[str]:
    """Ticker Simulation da JSON già esportato (evita riapertura workbook)."""
    from orchestrator_io_paths import SIMULATION_SHEET_SNAPSHOT_JSON

    p = Path(SIMULATION_SHEET_SNAPSHOT_JSON)
    if not p.is_file():
        return []
    try:
        import json

        doc = json.loads(p.read_text(encoding="utf-8"))
        return tickers_from_simulation_payload(doc)
    except (OSError, json.JSONDecodeError):
        return []


def read_sec_k8_table(
    *,
    xlsx_path: str | Path | None = None,
    ticker_filter: set[str] | None = None,
) -> dict[str, Any]:
    """Foglio «SEC K-8» — header con «Ticker» (di solito riga 3), dati sotto."""
    path = Path(xlsx_path or FINAL_XLSX)
    if not path.is_file():
        return {
            "sheet": _SEC_K8_SHEET,
            "columns": [],
            "rows": [],
            "error": f"Workbook assente: {path}",
        }
    # read_only=False: openpyxl non espone cell.hyperlink in modalità read-only.
    wb = _load_workbook(path, read_only=False)
    try:
        if _SEC_K8_SHEET not in wb.sheetnames:
            return {
                "sheet": _SEC_K8_SHEET,
                "columns": [],
                "rows": [],
                "error": f"Foglio «{_SEC_K8_SHEET}» assente — esegui refresh profilo sec_k8",
                "available": list(wb.sheetnames),
            }
        ws = wb[_SEC_K8_SHEET]
        hdr_row = _find_ticker_header_row(ws)
        header_vals = next(
            ws.iter_rows(
                min_row=hdr_row,
                max_row=hdr_row,
                min_col=1,
                max_col=20,
                values_only=True,
            ),
            (),
        )
        headers: list[str] = []
        for raw in header_vals:
            if raw is None and not headers:
                continue
            label = str(raw or "").strip() or f"col_{len(headers) + 1}"
            headers.append(label)
        while headers and not headers[-1].strip():
            headers.pop()
        headers = _trim_phantom_col_headers(headers)
        if not headers:
            headers = ["Ticker"]

        ncols = len(headers)
        rows: list[dict[str, Any]] = []
        max_row = int(ws.max_row or hdr_row)
        end = min(max_row, hdr_row + 12_000)
        for row_cells in ws.iter_rows(
            min_row=hdr_row + 1,
            max_row=end,
            min_col=1,
            max_col=ncols,
        ):
            tk = str((row_cells[0].value if row_cells else "") or "").strip().upper()
            if not tk or tk in ("—", "-", "N/D") or not _looks_like_ticker(tk):
                continue
            if ticker_filter is not None and tk not in ticker_filter:
                continue
            rec: dict[str, Any] = {}
            empty = True
            for ci, hdr in enumerate(headers):
                cell = row_cells[ci] if ci < len(row_cells) else None
                val = _export_cell_value(cell) if cell is not None else None
                if val not in (None, "", "—", "-"):
                    empty = False
                rec[hdr] = val
            if not empty:
                _enrich_sec_k8_row_links(rec)
                rows.append(rec)
        return {
            "sheet": _SEC_K8_SHEET,
            "columns": headers,
            "rows": rows,
            "row_count": len(rows),
            "path": str(path),
        }
    finally:
        wb.close()


def read_sec_k8_for_simulation(
    *,
    xlsx_path: str | Path | None = None,
    tickers: list[str] | None = None,
) -> dict[str, Any]:
    """Righe SEC K-8 solo per ticker presenti in Simulation."""
    sim_err: str | None = None
    ticker_list = [t.upper() for t in (tickers or []) if t]
    if not ticker_list:
        ticker_list = _tickers_from_simulation_snapshot_file()
    if not ticker_list:
        sim = read_simulation_table(xlsx_path=xlsx_path)
        sim_err = sim.get("error")
        ticker_list = tickers_from_simulation_payload(sim)
    ticker_set = set(ticker_list)

    full = read_sec_k8_table(xlsx_path=xlsx_path, ticker_filter=ticker_set)
    columns = full.get("columns") or []
    all_rows = full.get("rows") or []
    k8_err = full.get("error")

    if k8_err and not all_rows:
        return {
            "sheet": _SEC_K8_SHEET,
            "columns": columns,
            "rows": [],
            "tickers": ticker_list,
            "error": k8_err,
            "simulation_error": sim_err,
        }

    if not ticker_set:
        return {
            "sheet": _SEC_K8_SHEET,
            "columns": columns,
            "rows": [],
            "tickers": [],
            "error": "Nessun ticker in Simulation",
            "simulation_error": sim_err,
        }

    return {
        "sheet": _SEC_K8_SHEET,
        "columns": columns,
        "rows": all_rows,
        "row_count": len(all_rows),
        "tickers": ticker_list,
        "simulation_error": sim_err,
    }


def _write_sec_k8_simulation_snapshot_json(payload: dict[str, Any]) -> None:
    from orchestrator_io_paths import SEC_K8_SIMULATION_SNAPSHOT_JSON

    snap = Path(SEC_K8_SIMULATION_SNAPSHOT_JSON)
    snap.parent.mkdir(parents=True, exist_ok=True)
    import json

    out = dict(payload)
    out.pop("snapshot_path", None)
    snap.write_text(json.dumps(out, ensure_ascii=False, default=str), encoding="utf-8")


def export_sec_k8_simulation_snapshot(
    *,
    xlsx_path: str | Path | None = None,
    tickers: list[str] | None = None,
) -> dict[str, Any]:
    """CLI: ``data/sec_k8_simulation_snapshot.json`` (SEC K-8 filtrato su Simulation)."""
    print("[SEC K-8 simulation snapshot] Lettura foglio (solo ticker Simulation)…", flush=True)
    ticker_list = tickers or _tickers_from_simulation_snapshot_file()
    payload = read_sec_k8_for_simulation(xlsx_path=xlsx_path, tickers=ticker_list)
    if payload.get("rows") and not payload.get("error"):
        _write_sec_k8_simulation_snapshot_json(payload)
        print(
            f"[SEC K-8 simulation snapshot] OK — {payload.get('row_count', 0)} righe, "
            f"{len(payload.get('tickers') or [])} ticker -> "
            f"data/sec_k8_simulation_snapshot.json",
            flush=True,
        )
    else:
        print(
            f"[SEC K-8 simulation snapshot] KO — {payload.get('error', 'nessuna riga')}",
            flush=True,
        )
    return payload


def export_clinical_simulation_snapshot(*, xlsx_path: str | Path | None = None) -> dict[str, Any]:
    """CLI: ``data/clinical_simulation_snapshot.json`` (clinical filtrato su Simulation)."""
    payload = read_clinical_for_simulation(xlsx_path=xlsx_path)
    if payload.get("rows") and not payload.get("error"):
        _write_clinical_simulation_snapshot_json(payload)
        print(
            f"[Clinical simulation snapshot] OK — {payload.get('row_count', 0)} righe, "
            f"{len(payload.get('tickers') or [])} ticker -> "
            f"data/clinical_simulation_snapshot.json",
            flush=True,
        )
    else:
        print(
            f"[Clinical simulation snapshot] KO — {payload.get('error', 'nessuna riga')}",
            flush=True,
        )
    return payload


def export_sds_snapshot(*, fetch_fmp: bool = True, fetch_cluster_a: bool = True) -> dict[str, Any]:
    """Rigenera ``data/sds_snapshot.json`` (Supernova Distance Score cohort)."""
    from orchestrator_io_paths import DATA_DIR
    from prediction.sds_data import refresh_sds_cohort_full, sync_sds_after_simulation

    if fetch_fmp or fetch_cluster_a:
        result = refresh_sds_cohort_full(fetch_fmp=fetch_fmp, fetch_cluster_a=fetch_cluster_a)
    else:
        result = sync_sds_after_simulation(fetch_fmp=False, fetch_cluster_a=False)
    doc = result["doc"]
    path = str(Path(DATA_DIR) / "sds_snapshot.json")
    added = result.get("added_tickers") or []
    print(
        f"[SDS snapshot] {result.get('mode')} OK — {doc.get('n', 0)} ticker · "
        f"fmp={doc.get('fmp_fetched')} added={added or '—'} -> {path}",
        flush=True,
    )
    return doc


def export_desktop_snapshots(
    *,
    xlsx_path: str | Path | None = None,
    essential_only: bool = False,
) -> dict[str, Any]:
    """
    Esporta snapshot JSON per la UI desktop (lettura locale, senza API).
    Scrive anche ``desktop_data_manifest.json`` con timestamp.

    ``essential_only`` (refresh giornaliero veloce): solo Simulation + curve —
    salta Accuracy/Clinical/Financial e i rebuild cohort/outcomes (post-pipeline).
    """
    from datetime import datetime, timezone
    from orchestrator_io_paths import DESKTOP_DATA_MANIFEST_JSON, FINAL_XLSX

    path = Path(xlsx_path or FINAL_XLSX)
    results: dict[str, Any] = {}
    sim_tickers: list[str] = []
    if essential_only:
        steps: tuple[tuple[str, Any], ...] = (
            ("simulation", export_simulation_snapshot),
            ("simulation_charts", export_simulation_charts_snapshot),
        )
    else:
        steps = (
            ("simulation", export_simulation_snapshot),
            ("simulation_charts", export_simulation_charts_snapshot),
            ("clinical_simulation", export_clinical_simulation_snapshot),
            ("sec_k8_simulation", export_sec_k8_simulation_snapshot),
            ("accuracy", export_accuracy_snapshot),
            ("financial", export_financial_snapshot),
        )
    for name, fn in steps:
        print(f"[Desktop snapshots] {name}…", flush=True)
        try:
            if name == "sec_k8_simulation":
                results[name] = fn(xlsx_path=path, tickers=sim_tickers or None)
            else:
                results[name] = fn(xlsx_path=path)
            if name == "simulation" and results[name].get("rows"):
                sim_tickers = tickers_from_simulation_payload(results[name])
        except Exception as exc:
            print(f"[Desktop snapshots] {name} ERRORE: {exc}", flush=True)
            results[name] = {"error": str(exc), "rows": []}

    print("[Desktop snapshots] sds_cohort…", flush=True)
    try:
        from prediction.sds_data import refresh_sds_cohort_full, sync_sds_after_simulation

        if essential_only:
            # Nuovi entranti: FMP una tantum. Ricalcolo C+E su tutta la coorte in post_refresh (live signals).
            sds_result = sync_sds_after_simulation(fetch_fmp=True, fetch_cluster_a=True)
        else:
            sds_result = refresh_sds_cohort_full(fetch_fmp=True, fetch_cluster_a=True)
        results["sds_cohort"] = sds_result["doc"]
        if sds_result.get("added_tickers"):
            results["sds_cohort_added"] = sds_result["added_tickers"]
    except Exception as exc:
        print(f"[Desktop snapshots] sds_cohort ERRORE: {exc}", flush=True)
        results["sds_cohort"] = {"error": str(exc)}

    if not essential_only:
        print("[Desktop snapshots] investment_decision_cohort…", flush=True)
        try:
            from prediction.investment_decision_cohort import write_investment_decision_cohort

            results["investment_decision_cohort"] = write_investment_decision_cohort()
        except Exception as exc:
            print(f"[Desktop snapshots] investment_decision_cohort ERRORE: {exc}", flush=True)
            results["investment_decision_cohort"] = {"error": str(exc)}

        print("[Desktop snapshots] investment_sim_outcomes…", flush=True)
        try:
            from prediction.investment_sim_outcomes import write_investment_sim_outcomes

            results["investment_sim_outcomes"] = write_investment_sim_outcomes()
        except Exception as exc:
            print(f"[Desktop snapshots] investment_sim_outcomes ERRORE: {exc}", flush=True)
            results["investment_sim_outcomes"] = {"error": str(exc)}

    wb_m = None
    try:
        if path.is_file():
            wb_m = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).isoformat()
    except OSError:
        pass

    manifest = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "workbook_mtime": wb_m,
        "workbook": str(path),
        "sheets": {
            k: {
                "row_count": (v or {}).get("row_count"),
                "error": (v or {}).get("error"),
            }
            for k, v in results.items()
        },
    }
    Path(DESKTOP_DATA_MANIFEST_JSON).write_text(
        __import__("json").dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print("[Desktop snapshots] Manifest -> data/desktop_data_manifest.json", flush=True)
    return {"manifest": manifest, "sheets": results}


def export_accuracy_snapshot(*, xlsx_path: str | Path | None = None) -> dict[str, Any]:
    """CLI: rigenera ``data/accuracy_sheet_snapshot.json`` da Excel."""
    payload = read_accuracy_table(xlsx_path=xlsx_path)
    if payload.get("rows") and not payload.get("error"):
        _write_accuracy_snapshot_json(payload)
        print(
            f"[Accuracy snapshot] OK - {payload.get('row_count', 0)} righe -> "
            f"data/accuracy_sheet_snapshot.json",
            flush=True,
        )
    else:
        print(f"[Accuracy snapshot] KO — {payload.get('error', 'nessuna riga')}", flush=True)
    return payload
