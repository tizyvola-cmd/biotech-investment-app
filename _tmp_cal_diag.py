#!/usr/bin/env python3
import json, re
from datetime import date, datetime
from collections import Counter
from pathlib import Path

today = date(2026, 9, 19)
NEAR = 30
ROOT = Path("/opt/biotech/data")


def days_until(iso):
    if not iso or len(iso) < 10:
        return None
    try:
        d = datetime.strptime(iso[:10], "%Y-%m-%d").date()
    except Exception:
        return None
    return (d - today).days


def span_days(s, e):
    if not e:
        return None
    if not s or s == e:
        return 0
    try:
        a = datetime.strptime(s[:10], "%Y-%m-%d").date()
        b = datetime.strptime(e[:10], "%Y-%m-%d").date()
    except Exception:
        return None
    return (b - a).days


def pin(s, e):
    d_end = days_until(e or s)
    if d_end is None or d_end < 0 or d_end > NEAR:
        return False
    sp = span_days(s, e)
    if sp is None:
        return True
    if sp <= 45:
        return True
    d_start = days_until(s)
    return d_start is not None and d_start >= 0


def anchor(s, e):
    ds = days_until(s)
    if ds is not None and ds >= 0 and s:
        return s[:10]
    return (e or s or "9999")[:10]


def within180(s, e):
    d_end = days_until(e or s)
    if d_end is None or d_end < 0:
        return False
    d_start = days_until(s or e)
    if s and e and s != e:
        return d_start is None or d_start <= 180
    return d_start is not None and d_start >= 0 and d_start <= 180


def q_range(label):
    s = (label or "").strip()
    m = re.match(r"^Q([1-4])\s*(20\d{2})$", s, re.I)
    if m:
        q = int(m.group(1))
        y = m.group(2)
        sm = (q - 1) * 3 + 1
        em = sm + 2
        ed = 30 if em in (4, 6, 9, 11) else (28 if em == 2 else 31)
        return f"{y}-{sm:02d}-01", f"{y}-{em:02d}-{ed}"
    m = re.match(r"^(?:2H|H2)\s*(20\d{2})$", s, re.I)
    if m:
        return f"{m.group(1)}-07-01", f"{m.group(1)}-12-31"
    m = re.match(r"^(?:1H|H1)\s*(20\d{2})$", s, re.I)
    if m:
        return f"{m.group(1)}-01-01", f"{m.group(1)}-06-30"
    return None, None


g = json.loads((ROOT / "guidance_calendar_snapshot.json").read_text(encoding="utf-8"))["events"]
sec = json.loads((ROOT / "catalyst_calendar_snapshot.json").read_text(encoding="utf-8"))["entries"]
events = []
for ev in g:
    events.append({**ev, "origin": "g"})
for e in sec:
    et = str(e.get("event_type") or "").lower()
    ws = we = None
    if e.get("date_precision") == "exact_date" and e.get("date_value"):
        ws = we = e["date_value"][:10]
    elif e.get("window_label"):
        ws, we = q_range(e["window_label"])
    if not we:
        continue
    events.append(
        {
            "ticker": e["ticker"],
            "window_start": ws,
            "window_end": we,
            "event_type": et,
            "origin": "sec",
            "window_label": e.get("window_label"),
        }
    )

fut = [ev for ev in events if within180(ev.get("window_start"), ev.get("window_end"))]
print("merged within 180", len(fut), "of", len(events))
fut.sort(
    key=lambda ev: (
        0 if pin(ev.get("window_start"), ev.get("window_end")) else 1,
        anchor(ev.get("window_start"), ev.get("window_end")),
    )
)
print("TOP 20 after pin+anchor:")
for ev in fut[:20]:
    print(
        f"  pin={pin(ev.get('window_start'), ev.get('window_end'))} "
        f"anc={anchor(ev.get('window_start'), ev.get('window_end'))} "
        f"{ev.get('ticker')} {ev.get('window_start')}->{ev.get('window_end')} "
        f"{ev.get('event_type')} {ev.get('origin')} {ev.get('window_label') or ''}"
    )
for i, ev in enumerate(fut):
    if anchor(ev.get("window_start"), ev.get("window_end")) > "2026-09-30":
        print(
            "first after Sep30 at",
            i,
            ev.get("ticker"),
            anchor(ev.get("window_start"), ev.get("window_end")),
        )
        break
c = Counter(anchor(ev.get("window_start"), ev.get("window_end"))[:7] for ev in fut)
print("by anchor month", dict(sorted(c.items())))
wl = Counter(
    e.get("window_label") or ("exact:" + str(e.get("date_value"))) for e in sec
)
print("SEC labels", wl.most_common(20))
# OLD sort by window_start — what user saw
old = sorted(fut, key=lambda ev: ev.get("window_start") or "9999")
print("OLD sort TOP 12 (by window_start):")
for ev in old[:12]:
    print(
        f"  {ev.get('ticker')} {ev.get('window_start')}->{ev.get('window_end')} "
        f"{ev.get('event_type')} {ev.get('origin')}"
    )
print("first start>=2026-10 old sort index", next((i for i,ev in enumerate(old) if (ev.get('window_start') or '')>='2026-10'), None))
