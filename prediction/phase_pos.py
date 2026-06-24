"""
Phase Probability of Success (PoS) — prior bayesiano per fase clinica.

Fonte primaria: BIO/Informa/QLS "Clinical Development Success Rates 2011-2020"
Calibrazione empirica: dati storici interni (|actual|>=10pp, N=161 eventi binari confermati).

Valori usati (media industria + empirici dataset):
  Phase 1 : 63%  (industria 65%, empirico 63%)
  Phase 2 : 41%  (industria 38%, empirico 41%)
  Phase 3 : 65%  (industria 60%, empirico 72% — usato valore conservativo)
  Phase 4 : 78%  (industria 75%, empirico 80%)

Il contributo al net score è proporzionale alla distanza da 50%:
  score = clamp(round((pos - 0.50) * _POS_K), -2, +2)
  con _POS_K = 6  →  frange: <38% → -1, 38-45% → -1/0, 55-67% → +1, >67% → +1/+2
"""
from __future__ import annotations

# ── Tabella PoS per ph_num intero ────────────────────────────────────────────
_PHASE_POS: dict[int, float] = {
    1: 0.63,   # Phase 1/Early Phase 1 — safety readout, ~63% positivo
    2: 0.41,   # Phase 2 — efficacy preliminare, ~41% positivo (prior bearish)
    3: 0.65,   # Phase 3 — pivotal, ~65% positivo (prior leggermente bullish)
    4: 0.78,   # Phase 4 / post-approval — ~78% positivo (prior bullish)
}

_POS_K = 6  # Moltiplicatore: (pos − 0.50) × K → score intero [-2, +2]


def get_phase_pos(ph_num: int | None) -> float | None:
    """
    Restituisce P(catalyst positivo) per la fase data, o None se sconosciuta.

    >>> get_phase_pos(2)
    0.41
    >>> get_phase_pos(None) is None
    True
    """
    if ph_num is None:
        return None
    try:
        return _PHASE_POS.get(int(ph_num))
    except (TypeError, ValueError):
        return None


def phase_pos_score(ph_num: int | None) -> tuple[int, float | None]:
    """
    Calcola il contributo al net score dalla PoS di fase.

    Restituisce ``(score, pos)`` dove:
    - ``score`` è intero in [-2, +2]: positivo = bull, negativo = bear
    - ``pos`` è la probabilità usata (o None se fase sconosciuta)

    Esempi::

        phase_pos_score(1)  →  (+1, 0.63)   # Phase 1: prior leggermente bullish
        phase_pos_score(2)  →  (-1, 0.41)   # Phase 2: prior bearish
        phase_pos_score(3)  →  (+1, 0.65)   # Phase 3: prior leggermente bullish
        phase_pos_score(4)  →  (+2, 0.78)   # Phase 4: prior bullish
        phase_pos_score(None) → (0, None)   # sconosciuta: neutro
    """
    pos = get_phase_pos(ph_num)
    if pos is None:
        return 0, None
    raw = (pos - 0.50) * _POS_K
    score = max(-2, min(2, int(round(raw))))
    return score, pos


def phase_pos_label(ph_num: int | None) -> str:
    """Stringa leggibile del prior PoS, per le note del modello."""
    score, pos = phase_pos_score(ph_num)
    if pos is None:
        return ""
    pct = f"{pos:.0%}"
    if score >= 2:
        return f"PoS Ph{ph_num}={pct} (prior ↑↑)"
    if score == 1:
        return f"PoS Ph{ph_num}={pct} (prior ↑)"
    if score == -1:
        return f"PoS Ph{ph_num}={pct} (prior ↓)"
    if score <= -2:
        return f"PoS Ph{ph_num}={pct} (prior ↓↓)"
    return f"PoS Ph{ph_num}={pct} (neutro)"


if __name__ == "__main__":
    import sys, io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    print("Phase PoS -- tabella contributi:")
    for ph in [1, 2, 3, 4]:
        s, p = phase_pos_score(ph)
        print(f"  Phase {ph}: PoS={p:.0%}  score={s:+d}  label={phase_pos_label(ph)}")
