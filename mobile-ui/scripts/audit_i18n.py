#!/usr/bin/env python3
"""Audit mobile-ui/src/i18n.ts EN/IT pairs."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src" / "i18n.ts"
text = SRC.read_text(encoding="utf-8")

# Match key: { en: "...", it: "..." } — multiline values not supported
pat = re.compile(
    r'"([^"]+)":\s*\{\s*en:\s*"((?:[^"\\]|\\.)*)"\s*,\s*it:\s*"((?:[^"\\]|\\.)*)"\s*\}',
    re.MULTILINE,
)

entries: list[tuple[str, str, str]] = []
for m in pat.finditer(text):
    entries.append((m.group(1), m.group(2), m.group(3)))

print(f"Parsed {len(entries)} i18n entries\n")

# Allowed identical (brand, acronyms, tickers placeholders)
ALLOW_IDENTICAL = re.compile(
    r"^(SuperNova|Piggy Bank|Dashboard|Trades|Opportunities|Portfolio|Menu|Online|English|Italiano|"
    r"Buy \$|Capital \$|Rec\.|Cap\.|CD|ROI|PPI|MII|SDS|EIS|SEC|API|SMTP|PWA|JSON|Tester|"
    r"Hold|Buy|Review|Sell|Target|Gain|Refresh|WhatsApp|Safari|Chrome|Android|iPhone|"
    r"EIS · \{ticker\}|Regulatory · \{ticker\}|Curve · \{ticker\}|Curves · \{ticker\}|"
    r"EIS detail · \{ticker\}|Snapshot · \{date\}|Volume|Feed|Reg|Rescue space|"
    r"Similarity \{pct\}%|Market vs model slopes|Charts|Finestra|Window|\{.*\}.*)$",
    re.I,
)

ITALIAN_MARKERS = re.compile(
    r"\b(il|lo|la|un|una|del|della|dei|per|con|che|non|sono|questo|quando|dalla|dal|nel|nella|"
    r"oppure|verifica|impossibile|nessun|apri|chiudi|salva|indietro|impostazioni|lingua|"
    r"caricamento|aggiorna|posizioni|capitale|guadagno|perdita|investito|disponibile|"
    r"simulazione|obbligatorio|codice|invito|approvato|schermata|grafici|curva|mercato|"
    r"oggi|piano|reale|finestra|ingresso|segnali|rilevati|analizzato|fonte|evento|clinico|"
    r"regolatorio|dettaglio|colonna|riga|pendenza|traiettoria|modello|ipotesi|percorso|"
    r"storico|attuale|similitudine|assi|dati|trattegg|ricalibr|poligono|arco|keyword|"
    r"rischio|favorevole|entro|giorni|societ|invest|aperte|chiuse|riepilogo|budget|"
    r"aggiungi|rimuovi|elimina|conferma|annulla|riprova|copia|connessione|errore|avviso|"
    r"nota|suggerimento|opzionale|richiesto|scarica|cerca|filtra|mostra|nascondi|tutti|"
    r"nessuno|schermata|varianza|legame|mercato|correlazione|inversa|raro|company|specific|"
    r"segnale|mantieni|posizione|aperta|basso|uscita|attivo|elevato|moderato|neutro|"
    r"profilo|leggermente|pareggio|liquidit|altri|indicatori|indicatore|catalizzatori|"
    r"approvazioni|nessuna|news|recente|regolatorio|reg)\b",
    re.I,
)

ENGLISH_IN_IT = re.compile(
    r"\b(the|and|with|your|this|that|when|from|for|are|was|were|has|have|will|should|"
    r"could|please|enter|click|open|close|save|back|settings|language|loading|refresh|"
    r"offline|failed|error|success|warning|note|hint|optional|required|unavailable|"
    r"available|positions|capital|budget|simulation|tester|invite|approved|pending|"
    r"revoked|download|upload|copy|link|email|password|token|connect|retry|cancel|"
    r"confirm|delete|remove|add|edit|update|search|filter|sort|show|hide|more|less|"
    r"all|none|yes|no|ensure|could not|unavailable|missing|detected|signals|"
    r"scanned|recent|filings|snapshot|source|clinical|feed|regulatory|score|"
    r"recommendation|polygon|similarity|axes|missing data|current|target|window|"
    r"historical|planned|actual|gain|today|market|model|slopes|trajectory|"
    r"hypothetical|entry|dashed|recalibrated|blend|charts|curves|render|"
    r"strong|more|cleaner|inverse|correlation|rare|check|active|exit|signal|"
    r"breakeven|positive|catalysts|approvals|quantifiable|indicators|rollup|"
    r"summary|neutral|reaction|price|volume|impact|detail|breakdown|"
    r"portfolio|opportunity|opportunities|dashboard|trades|piggy|bank|"
    r"hold|review|sell|buy|size|capital|invested|available|refreshing|updated)\b",
    re.I,
)

identical: list[tuple[str, str]] = []
en_is_italian: list[tuple[str, str]] = []
it_is_english: list[tuple[str, str]] = []
it_equals_en_sentence: list[tuple[str, str]] = []

for key, en, it in entries:
    if en == it:
        if len(en) > 4 and not ALLOW_IDENTICAL.match(en.strip()):
            identical.append((key, en))
    if ITALIAN_MARKERS.search(en) and not ITALIAN_MARKERS.search(it):
        en_is_italian.append((key, en))
    # IT should not be mostly English when EN is different
    if en != it and ENGLISH_IN_IT.search(it):
        en_words = len(re.findall(r"[a-zA-Z]+", en))
        it_en_hits = len(ENGLISH_IN_IT.findall(it))
        if it_en_hits >= 2 or (en_words <= 6 and it_en_hits >= 1 and not re.search(r"[àèéìòù]", it, re.I)):
            it_is_english.append((key, it))

print("=== Identical EN=IT (needs review / translate IT) ===")
for k, v in identical:
    print(f"  {k}: {v[:100]}")
print(f"  ({len(identical)} items)\n")

print("=== EN field looks Italian ===")
for k, v in en_is_italian:
    print(f"  {k}: {v[:100]}")
print(f"  ({len(en_is_italian)} items)\n")

print("=== IT field looks English (when EN differs) ===")
for k, v in it_is_english:
    print(f"  {k}: {v[:100]}")
print(f"  ({len(it_is_english)} items)\n")
