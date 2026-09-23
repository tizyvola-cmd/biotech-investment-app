"""
Taxonomy-based intrinsic news scoring (Clin / Fin / Societaria / Market Access).

The model classifies events + magnitude params only; scores are computed
deterministically from config/eis_event_taxonomy.json (never free sentiment).
Complementary to EIS_market (price reaction) — does not replace it.
"""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger("supernova.eis_taxonomy_scoring")

_ROOT = Path(__file__).resolve().parent
_DEFAULT_TAXONOMY_PATH = _ROOT / "config" / "eis_event_taxonomy.json"

DIMENSIONS = ("clinical", "financial", "corporate", "market_access")

SCORE_FIELD = {
    "clinical": "clinical_score",
    "financial": "financial_score",
    "corporate": "corporate_score",
    "market_access": "market_access_score",
}

# Bump when offline press patterns change so Daily News re-fills sticky 0.0 rows.
HEURISTIC_REV = 8  # scientific publication + company affiliation boost

COMPANY_AFFILIATION_MODIFIER_ID = "company_affiliation_match"
CLIN_SCIENTIFIC_PUBLICATION_ID = "CLIN_SCIENTIFIC_PUBLICATION"

# Compact keyword → event_id hints for offline / Press path (no LLM).
# Only high-precision phrases; ambiguous text → no match → score 0.
_HEURISTIC_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "clinical_endpoint_primario_centrato_significativo",
        re.compile(
            r"(?i)\b(met (?:the )?primary endpoint|primary endpoint (?:was )?met|"
            r"meeting (?:the )?primary endpoint|"
            r"statistically significant.{0,40}primary|"
            r"reduced the risk of .{0,80} by \d{1,2}(?:\.\d+)?\s*%|"
            r"hazard ratio\s*(?:\[?hr\]?\s*)?[=:]?\s*0\.\d+"
            r")"
        ),
    ),
    (
        "clinical_endpoint_primario_mancato",
        re.compile(
            r"(?i)\b(failed to meet (?:the )?primary|did not meet (?:the )?primary|"
            r"missed (?:the )?primary endpoint|primary endpoint (?:was )?not met)\b"
        ),
    ),
    (
        "clinical_endpoint_secondario_centrato",
        re.compile(
            r"(?i)\b(secondary endpoint.{0,40}(met|achieved|significant))\b"
        ),
    ),
    (
        "clinical_endpoint_secondario_mancato",
        re.compile(
            r"(?i)\b(secondary endpoint.{0,40}(not met|failed|did not))\b"
        ),
    ),
    (
        "clinical_risultati_topline_interim_positivi",
        re.compile(
            r"(?i)\b(positive topline|topline results.{0,40}(positive|showed|meeting|met)|"
            r"positive.{0,40}topline|"
            r"interim results.{0,30}(positive|encouraging|favorable))\b"
        ),
    ),
    (
        "clinical_trial_fermato_sospeso_per_sicurezza",
        re.compile(
            r"(?i)\b(clinical hold|trial (?:was )?(?:paused|halted|suspended).{0,40}safety|"
            r"paused following a safety)\b"
        ),
    ),
    (
        "clinical_trial_interrotto_per_futilita",
        re.compile(
            r"(?i)\b(discontinued due to futility|stopped for futility|futility)\b"
        ),
    ),
    (
        "clinical_evento_avverso_serio_black_box_warning",
        re.compile(
            r"(?i)\b(black[- ]box|boxed warning|serious adverse event led|"
            r"drug[- ]related death)\b"
        ),
    ),
    (
        "clinical_profilo_di_sicurezza_favorevole_confermato",
        re.compile(
            r"(?i)\b(no new safety signals|well tolerated|favorable safety profile|"
            r"no serious treatment[- ]related)\b"
        ),
    ),
    (
        "clinical_breakthrough_therapy_designation_concessa",
        re.compile(r"(?i)\b(breakthrough therapy designation|granted breakthrough)\b"),
    ),
    (
        "clinical_fast_track_priority_review_concessa",
        re.compile(
            r"(?i)\b(fast[- ]track designation|priority review|granted fast[- ]track)\b"
        ),
    ),
    (
        "clinical_orphan_drug_designation_concessa",
        re.compile(r"(?i)\b(orphan (?:drug )?designation|granted orphan)\b"),
    ),
    (
        "clinical_complete_response_letter_crl_ricevuta",
        re.compile(r"(?i)\b(complete response letter|\bcrl\b)\b"),
    ),
    (
        "clinical_approvazione_fda_ema",
        # Real approval grant — FDA/EMA/MHRA/PMDA/NMPA (China) and clear
        # "China / NMPA approval" headlines. Not "post-approval registry".
        # Also CHMP positive opinion / EU committee recommend-for-approval
        # (pre-Commission grant — still the key EU regulatory catalyst).
        re.compile(
            r"(?i)(?:"
            r"\b(?:fda|ema|mhra|pmda|nmpa)\s+approv(?:ed|es)\s+(?:the\s+)?"
            r"(?:nda|bla|snda|sbla|maa|supplement|application|drug|product|"
            r"indication|therapy|treatment|formulation)\b"
            r"|\breceived\s+(?:fda|ema|mhra|pmda|nmpa)\s+approval\b"
            r"|\b(?:fda|ema|nmpa)\s+approval\s+(?:for|of)\b"
            r"|\bapproval\s+granted\s+by\s+(?:the\s+)?"
            r"(?:fda|ema|mhra|pmda|nmpa|china(?:'s)?\s+nmpa)\b"
            r"|\b(?:china(?:'s)?\s+)?nmpa\s+(?:has\s+)?approv(?:ed|es|al)\b"
            r"|\bwins?\s+china\s+approval\b"
            r"|\bchina\s+approval\s+for\b"
            r"|\bapprov(?:ed|al)\s+in\s+china\b"
            r"|\bchmp\b.{0,40}(?:positive\s+opinion|recommends?|recommended)"
            r"|\b(?:positive\s+opinion|recommended\s+for\s+approval).{0,40}\bchmp\b"
            r"|\beu\s+committee\s+recommends?\b"
            r"|\brecommended\s+for\s+approval\s+in\s+the\s+eu\b"
            r")"
        ),
    ),
    (
        "clinical_label_expansion_approvata",
        re.compile(
            r"(?i)\b(expanded indication|label expansion|additional indication approved)\b"
        ),
    ),
    (
        "clinical_arruolamento_completato_in_linea_coi_tempi",
        re.compile(
            r"(?i)\b(completed enrollment|enrollment (?:is |was )?complete|"
            r"fully enrolled)\b"
        ),
    ),
    (
        "clinical_fine_completamento_studio_clinico_senza_risultati",
        re.compile(
            r"(?i)\b(?:"
            # Ops completion only — exclude "successfully completed" (→ STUDY_SUCCESS).
            r"(?<!successfully\s)completed\s+the\s+(?:phase\s*[1234]\w*\s+)?"
            r"(?:clinical\s+)?(?:study|trial)"
            r"|study\s+(?:has\s+been\s+|was\s+)?completed"
            r"|trial\s+(?:has\s+been\s+|was\s+)?completed"
            r"|last\s+patient\s+last\s+visit|\blplv\b"
            r"|database\s+lock"
            r")\b"
        ),
    ),
    (
        "clinical_successo_a_fine_studio_esito_positivo",
        re.compile(
            r"(?i)\b(?:"
            r"successfully\s+completed\s+the\s+(?:phase\s*[1234]\w*\s+)?"
            r"(?:clinical\s+)?(?:study|trial)"
            r"|(?:study|trial)\s+(?:was\s+)?successful"
            r"|positive\s+(?:study|trial)\s+(?:results?|outcome|readout)"
            r"|met\s+(?:its\s+|all\s+)?(?:study\s+)?objectives?"
            r"|achieved\s+(?:its\s+)?(?:primary\s+)?(?:study\s+)?objectives?"
            # Press wire: OS / survival wins without "primary endpoint" wording
            r"|(?:extends?|improv(?:es|ed|ing)?|prolongs?)\s+(?:overall\s+)?survival"
            r"|survival\s+(?:benefit|advantage|extension|improvement)"
            r"|(?:overall\s+survival|\bos\b)\s+(?:benefit|improvement|extension|advantage)"
            r"|superior\s+(?:overall\s+)?survival"
            r"|(?:phase\s*[1234]\w*.{0,40})?(?:extends?|improv(?:es|ed))\s+survival"
            r")\b"
        ),
    ),
    (
        "clinical_insuccesso_a_fine_studio",
        re.compile(
            r"(?i)\b(?:"
            r"(?:study|trial)\s+failed"
            r"|failed\s+(?:the\s+)?(?:phase\s*[1234]\w*\s+)?(?:study|trial)"
            r"|failed\s+to\s+achieve\s+(?:its\s+)?(?:study\s+)?objectives?"
            r"|negative\s+(?:study|trial)\s+(?:results?|outcome|readout)"
            r"|unsuccessful\s+(?:phase\s*[1234]\w*\s+)?(?:study|trial)"
            r")\b"
        ),
    ),
    (
        "clinical_milestone_dosing_first_last_patient_subject_dosed",
        re.compile(
            r"(?i)\b(?:"
            r"(?:first|1st|last|final)\s+(?:patient|subject)s?\s+"
            r"(?:(?:has|have|was|were)\s+(?:been\s+)?)?dos(?:ed|ing)"
            r"|dos(?:ed|ing)\s+(?:the\s+)?(?:first|1st|last|final)\s+(?:patient|subject)s?"
            r"|first[- ]patient[- ]dos(?:ed|ing)"
            r"|last[- ](?:patient|subject)[- ]dos(?:ed|ing)"
            r"|finish(?:es|ed)?\s+dosing"
            r"|complet(?:es|ed|ing)?\s+dosing"
            r"|dosing\s+(?:is\s+|was\s+)?complete"
            r")\b"
        ),
    ),
    (
        # Catalyst scheduled, not yet occurred — low weight, only surfaces the name.
        "clinical_readout_attesa_con_finestra_dichiarata",
        re.compile(
            r"(?i)(?:"
            r"\b(?:topline|top[-\s]line|interim|pivotal|primary|"
            r"phase\s*(?:1|2|3|i{1,3}))\b[^.]{0,60}"
            r"\b(?:data|results?|readout)\b[^.]{0,40}"
            r"\b(?:expected|anticipated|due|on\s+track|guided|to\s+be\s+reported)\b"
            r"|\b(?:expects?|anticipates?|on\s+track)\s+to\s+"
            r"(?:report|announce|release)\b[^.]{0,40}"
            r"\b(?:topline|data|results?|readout)\b"
            r")"
        ),
    ),
    (
        "financial_earnings_sopra_consenso",
        re.compile(
            r"(?i)\b(earnings beat|revenue (?:above|beat) consensus|beat consensus)\b"
        ),
    ),
    (
        "financial_earnings_sotto_consenso",
        re.compile(
            r"(?i)\b(earnings miss|missed consensus|revenue below consensus)\b"
        ),
    ),
    (
        "financial_earnings_risultati_trimestrali",
        # Quarterly / annual P&L facts — key financial info even without beat/miss.
        re.compile(
            r"(?i)(?:"
            r"\b(?:net\s+)?revenue\b.{0,40}\$"
            r"|\breported\s+(?:net\s+)?(?:revenue|loss|income|earnings)\b"
            r"|\b(?:gross\s+margin|operating\s+expenses?|net\s+loss|net\s+income)\b"
            r"|\bcash\s+(?:and\s+cash\s+equivalents|position|balance)\b.{0,20}\$"
            r"|\bearnings\s+per\s+share\b|\b\d+\s+cents?\s+per\s+share\b"
            r"|\b(?:first|second|third|fourth)\s+quarter\s+of\s+20\d{2}\b"
            r"|\bQ[1-4]\s*20\d{2}\b.{0,80}\b(?:revenue|earnings|net\s+loss)\b"
            r")"
        ),
    ),
    (
        "financial_guidance_alzata",
        re.compile(r"(?i)\b(raised (?:full[- ]year )?guidance|guidance raise)\b"),
    ),
    (
        "financial_guidance_tagliata_ritirata",
        re.compile(
            r"(?i)\b(lowered guidance|cut guidance|withdrew.{0,20}guidance|"
            r"guidance (?:cut|withdrawn))\b"
        ),
    ),
    (
        "financial_finanziamento_non_dilutivo_grant_milestone_royalty",
        re.compile(
            r"(?i)\b(milestone payment|non[- ]dilutive|royalty (?:payment|financing)|"
            r"received a \$\d|\bgrant (?:of|award))\b"
        ),
    ),
    (
        "financial_offerta_azionaria_dilutiva_utilizzo_shelf",
        re.compile(
            r"(?i)\b((?:public|follow[- ]on|registered direct|at[- ]the[- ]market)\s+offering|"
            r"(?:equity|share|stock|common stock)\s+offering|priced a.{0,40}offering|"
            r"dilutive (?:financ|offering)|"
            r"(?:path to |opens path to )?raise(?:s)? (?:cash|capital))\b"
        ),
    ),
    (
        "financial_shelf_registration_depositato_nessun_utilizzo",
        # "off-the-shelf" is an allogeneic-therapy term, never a financing event.
        re.compile(
            r"(?i)(?:"
            r"\bshelf\s+registration(?:\s+statement)?\b"
            r"|\b(?:filed|files|filing)\s+(?:a|an|its|a\s+new)?\s*"
            r"(?:\$?[\d.,]+\s*(?:million|billion)\s+)?shelf\b"
            r"|\b\d{1,3}[-\s]month\s+shelf\b"
            r"|(?<!off-the-)(?<!off\sthe\s)\bshelf\b"
            r"(?=.{0,80}\b(?:financing|offering|registration|"
            r"at[-\s]the[-\s]market|atm)\b)"
            r")"
        ),
    ),
    (
        "financial_going_concern_doubt_dichiarato",
        re.compile(r"(?i)\b(going concern|substantial doubt)\b"),
    ),
    (
        "financial_runway_di_cassa_esteso_dichiarazione_esplicita",
        re.compile(
            r"(?i)\b(cash runway (?:extended|to 20\d{2}|into 20\d{2})|"
            r"runway (?:extended|extends) to)\b"
        ),
    ),
    (
        "financial_runway_di_cassa_12_mesi_segnalato",
        re.compile(
            r"(?i)\b(cash runway (?:of |less than |under )?\d{1,2}\s*months|"
            r"runway.{0,20}<\s*12|less than 12 months of cash)\b"
        ),
    ),
    (
        "corporate_m_a_annunciata_come_target_con_premio",
        re.compile(
            r"(?i)\b(to be acquired|enter(?:ed|s)? into a definitive.{0,30}acquisition|"
            r"acquisition of .{0,60}for \$|agree(?:d|s)? to (?:be )?acquir|"
            r"agreed to acquire|to acquire .{0,40}for \$|"
            r"cash tender offer|tender offer)\b"
        ),
    ),
    (
        "corporate_m_a_completata",
        re.compile(
            r"(?i)\b(completed the acquisition|acquisition (?:has )?closed|"
            r"closing of the (?:acquisition|merger))\b"
        ),
    ),
    (
        "corporate_m_a_terminata_fallita",
        re.compile(
            r"(?i)\b(terminated the (?:merger|acquisition)|deal terminated|"
            r"merger agreement terminated)\b"
        ),
    ),
    (
        "corporate_assunzione_dirigente_chiave_track_record_forte",
        re.compile(
            r"(?i)\b(appoint(?:ed|s)? .{0,40}(ceo|cfo|cmo|chief)|named .{0,30}as (?:ceo|cfo))\b"
        ),
    ),
    (
        "corporate_uscita_dirigente_chiave_non_pianificata",
        re.compile(
            r"(?i)\b((?:ceo|cfo|cmo) (?:resign|step(?:s|ped)? down)|"
            r"unexpected (?:departure|resignation))\b"
        ),
    ),
    (
        "corporate_partnership_licensing_firmata_con_upfront_payment",
        re.compile(
            r"(?i)\b(licensing agreement|license agreement|collaboration agreement|"
            r"strategic partnership).{0,80}(upfront|\$\d)\b|"
            r"\b(upfront (?:payment|of) \$)\b"
        ),
    ),
    (
        "corporate_partnership_licensing_terminata",
        re.compile(
            r"(?i)\b(terminated (?:the )?(?:license|collaboration|partnership)|"
            r"license agreement terminated)\b"
        ),
    ),
    (
        "corporate_brevetto_concesso",
        re.compile(r"(?i)\b(patent (?:granted|issued)|issued a patent)\b"),
    ),
    (
        "corporate_causa_ip_vinta",
        re.compile(r"(?i)\b(won (?:the )?patent (?:case|litigation)|jury verdict.{0,30}favor)\b"),
    ),
    (
        "corporate_causa_ip_persa",
        re.compile(r"(?i)\b(lost (?:the )?patent|patent (?:invalidated|held invalid))\b"),
    ),
    (
        "CORP_LITIGATION_FILED",
        re.compile(
            r"(?i)\b("
            r"lawsuits?\s+add\s+legal\s+overhang|legal\s+overhang|"
            r"patent\s+infringement\s+(?:suit|lawsuit|complaint)|"
            r"(?:class\s+action|securities)\s+(?:lawsuit|complaint)\s+filed|"
            r"lawsuit(?:s)?\s+(?:filed|against)|"
            r"sued\s+over|files?\s+(?:a\s+)?lawsuit|"
            r"litigation\s+(?:overhang|risk)"
            r")\b"
        ),
    ),
    (
        "corporate_notice_di_delisting_non_compliance",
        re.compile(
            r"(?i)\b(nasdaq.{0,40}delist|notice of delisting|non[- ]compliance notice|"
            r"fail(?:ed|ure) to (?:meet|satisfy) .{0,30}listing)\b"
        ),
    ),
    (
        "market_access_decisione_di_copertura_payer_favorevole",
        re.compile(
            r"(?i)\b(positive coverage|coverage decision|payer coverage|"
            r"national coverage)\b"
        ),
    ),
    (
        "market_access_decisione_di_copertura_restrittiva",
        re.compile(
            r"(?i)\b(coverage denial|restrictive coverage|not covered by|"
            r"coverage restricted)\b"
        ),
    ),
    (
        "market_access_valutazione_hta_favorevole_nice_icer",
        re.compile(
            r"(?i)\b(nice\b(?!.{0,40}not\s+(?:to\s+)?recommend).{0,40}\brecommend|"
            r"icer.{0,30}(cost[- ]effective|favorable))\b"
        ),
    ),
    (
        "market_access_valutazione_hta_sfavorevole",
        re.compile(
            r"(?i)\b(nice.{0,40}not\s+(?:to\s+)?recommend|"
            r"icer.{0,30}(not cost|unfavorable))\b"
        ),
    ),
    (
        "market_access_inclusione_in_formulario",
        re.compile(
            r"(?i)\b(added .{0,40}to (?:the )?(?:\w+\s+){0,4}formulary|"
            r"formulary (?:inclusion|addition)|included (?:in|on) (?:the )?formulary)\b"
        ),
    ),
    (
        "market_access_esclusione_downgrade_di_tier_da_formulario",
        re.compile(
            r"(?i)\b(removed from (?:the )?formulary|formulary (?:exclusion|downgrade)|"
            r"tier (?:downgrade|increase))\b"
        ),
    ),
    (
        "market_access_approvazione_di_un_competitor_aumenta_concorrenza",
        re.compile(
            r"(?i)\b(competitor (?:approved|approval)|rival .{0,40}approved|"
            r"fda approved .{0,40}compet)\b"
        ),
    ),
]

_PHASE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # Most specific / highest phase first — first match wins.
    (
        "fase_trial_post_marketing_real_world_study",
        re.compile(
            r"(?i)\b(?:post[- ](?:marketing|approval|market)|real[- ]world|"
            r"phase\s*(?:4|iv)\s+post)\b"
        ),
    ),
    (
        "fase_trial_fase_4",
        re.compile(r"(?i)\bphase\s*(?:4|iv)[ab]?\b"),
    ),
    (
        "fase_trial_registrational_confirmatory",
        re.compile(r"(?i)\b(registrational|confirmatory)\b"),
    ),
    (
        "fase_trial_fase_3_pivotal",
        re.compile(r"(?i)\bphase\s*(?:3|iii)[ab]?\b|\bpivotal\b"),
    ),
    ("fase_trial_fase_2", re.compile(r"(?i)\bphase\s*(?:2|ii)[ab]?\b")),
    ("fase_trial_fase_1", re.compile(r"(?i)\bphase\s*(?:1|i)[ab]?\b")),
]

_PVALUE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "significativita_statistica_p_0_01",
        re.compile(r"(?i)\bp\s*[<<=]\s*0\.0[0-9]"),
    ),
    (
        "significativita_statistica_p_0_05_soglia_standard",
        re.compile(r"(?i)\bp\s*[<<=]\s*0\.05\b|\bstatistically significant\b"),
    ),
    (
        "significativita_statistica_trend_non_significativo",
        re.compile(r"(?i)\b(trend(?:ing)? toward|not (?:statistically )?significant|n\.?s\.?)\b"),
    ),
]

_ENDPOINT_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("gerarchia_endpoint_primario", re.compile(r"(?i)\bprimary endpoint\b")),
    ("gerarchia_endpoint_secondario", re.compile(r"(?i)\bsecondary endpoint\b")),
    (
        "gerarchia_endpoint_esplorativo_post_hoc",
        re.compile(r"(?i)\b(exploratory|post[- ]hoc)\b"),
    ),
]

_SURPRISE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    (
        "aspettativa_di_mercato_sorpresa",
        re.compile(r"(?i)\b(surprise|unexpected|above (?:expectations|estimates))\b"),
    ),
    (
        "aspettativa_di_mercato_atteso_gia_prezzato",
        re.compile(r"(?i)\b(as expected|in[- ]line|already priced|widely expected)\b"),
    ),
]


@lru_cache(maxsize=4)
def load_taxonomy(path: str | None = None) -> dict[str, Any]:
    p = Path(path) if path else _DEFAULT_TAXONOMY_PATH
    raw = json.loads(p.read_text(encoding="utf-8"))
    if not isinstance(raw, dict) or not raw.get("events"):
        raise ValueError(f"invalid taxonomy at {p}")
    return raw


def taxonomy_version(path: str | None = None) -> int:
    return int(load_taxonomy(path).get("version") or 1)


def resolve_taxonomy_id(raw_id: str | None, *, path: str | None = None) -> str | None:
    """Map legacy snake_case ids (and Excel aliases) onto current catalog ids."""
    if not raw_id:
        return None
    eid = str(raw_id).strip()
    if not eid:
        return None
    tax = load_taxonomy(path)
    aliases = tax.get("id_aliases") or {}
    # Resolve once or twice (legacy → CLIN_* → still CLIN_*)
    for _ in range(2):
        nxt = aliases.get(eid)
        if not nxt or nxt == eid:
            break
        eid = str(nxt)
    return eid


def events_by_id(path: str | None = None) -> dict[str, dict[str, Any]]:
    return {e["id"]: e for e in load_taxonomy(path)["events"]}


def modifiers_by_id(path: str | None = None) -> dict[str, dict[str, Any]]:
    return {m["id"]: m for m in load_taxonomy(path)["modifiers"]}


def events_for_dimension(dimension: str, path: str | None = None) -> list[dict[str, Any]]:
    return [e for e in load_taxonomy(path)["events"] if e.get("dimension") == dimension]


def clamp_score(v: float, *, lo: float = -3.0, hi: float = 3.0) -> float:
    if v != v:  # NaN
        return 0.0
    return max(lo, min(hi, round(float(v), 2)))


def compute_dimension_score(
    event_id: str | None,
    modifier_ids: list[str] | None = None,
    *,
    path: str | None = None,
) -> dict[str, Any]:
    """
    Deterministic: base_weight(event) × Π(modifiers) clamped to [-3, +3].
    Unknown event_id → review flag, score 0.
    """
    tax = load_taxonomy(path)
    scale = tax.get("score_scale") or {}
    lo = float(scale.get("min", -3.0))
    hi = float(scale.get("max", 3.0))
    ev_map = events_by_id(path)
    mod_map = modifiers_by_id(path)

    if not event_id:
        return {
            "score": 0.0,
            "event_id": None,
            "event_type": None,
            "base_weight": 0.0,
            "modifiers_applied": [],
            "multiplier_product": 1.0,
            "review_flag": False,
            "unclassified": True,
        }

    event_id = resolve_taxonomy_id(event_id, path=path) or event_id
    ev = ev_map.get(event_id)
    if not ev:
        return {
            "score": 0.0,
            "event_id": event_id,
            "event_type": None,
            "base_weight": 0.0,
            "modifiers_applied": [],
            "multiplier_product": 1.0,
            "review_flag": True,
            "review_reason": "event_not_in_taxonomy",
            "unclassified": False,
        }

    base = float(ev.get("base_weight") or 0.0)
    dim = str(ev.get("dimension") or "")
    applied: list[dict[str, Any]] = []
    product = 1.0
    for mid in modifier_ids or []:
        mid = resolve_taxonomy_id(str(mid).strip(), path=path) or str(mid).strip()
        mod = mod_map.get(mid)
        if not mod:
            continue
        applies = mod.get("applies_to") or []
        if applies and dim not in applies:
            continue
        mult = float(mod.get("multiplier") or 1.0)
        product *= mult
        applied.append(
            {
                "id": mid,
                "category": mod.get("category"),
                "modifier": mod.get("modifier"),
                "multiplier": mult,
            }
        )

    raw = base * product
    return {
        "score": clamp_score(raw, lo=lo, hi=hi),
        "event_id": event_id,
        "event_type": ev.get("event_type"),
        "dimension": dim,
        "base_weight": base,
        "modifiers_applied": applied,
        "multiplier_product": round(product, 4),
        "raw_score": round(raw, 4),
        "review_flag": False,
        "unclassified": False,
    }


def _empty_dim_result(dimension: str) -> dict[str, Any]:
    return {
        "dimension": dimension,
        "score": 0.0,
        "event_id": None,
        "event_type": None,
        "evidence": None,
        "modifiers_applied": [],
        "review_flag": False,
        "unclassified": True,
    }


def _infer_modifier_ids(text: str, dimension: str) -> list[str]:
    blob = text or ""
    found: list[str] = []
    if dimension == "clinical":
        for mid, rx in _PHASE_PATTERNS:
            if rx.search(blob):
                found.append(mid)
                break
        for mid, rx in _PVALUE_PATTERNS:
            if rx.search(blob):
                found.append(mid)
                break
        for mid, rx in _ENDPOINT_PATTERNS:
            if rx.search(blob):
                found.append(mid)
                break
    for mid, rx in _SURPRISE_PATTERNS:
        if rx.search(blob):
            found.append(mid)
            break
    return found


_INCIDENTAL_CLIN_ON_EARNINGS = frozenset(
    {
        "CLIN_APPROVAL_GRANTED",
        "CLIN_LABEL_EXPANSION",
        "CLIN_PRIMARY_MET",
        "CLIN_PRIMARY_MISSED",
        "CLIN_SECONDARY_MET",
        "CLIN_SECONDARY_MISSED",
        "CLIN_TOPLINE_POSITIVE",
        "CLIN_STUDY_SUCCESS",
        "CLIN_STUDY_FAILED",
        "CLIN_STUDY_COMPLETED",
        "CLIN_SAFETY_CONFIRMED",
        "CLIN_ENROLLMENT_COMPLETED",
        "CLIN_DOSING_MILESTONE",
        "CLIN_READOUT_GUIDED",
    }
)

_EARNINGS_PNL_RE = re.compile(
    r"(?i)\b(?:net\s+revenue|gross\s+margin|net\s+loss|cash\s+position|"
    r"earnings\s+per\s+share|operating\s+expenses?|"
    r"Q[1-4]\s*20\d{2}.{0,40}(?:revenue|net\s+loss|earnings))\b"
)

# Price-action / market-wrap press (AD HOC, close prints, % slide) — not a clinical catalyst.
_STOCK_TAPE_HEAD_RE = re.compile(
    r"(?i)\b(?:"
    r"stock\s+(?:heads?|finished|closed|fell|rose|slides?|gains?|drops?|tumbles?|rall(?:y|ies))|"
    r"shares?\s+(?:fell|rose|slide|gain|drop|tumble)|"
    r"(?:\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s+percent)\s+slide|"
    r"slide\s+(?:into|after|on)|"
    r"heads?\s+into\s+the\s+open|"
    r"into\s+the\s+open\s+after|"
    r"finished\s+at|closed\s+at|"
    r"pre[- ]?market|after[- ]?hours"
    r")\b"
)

_EVENT_ID_DIM_PREFIX: tuple[tuple[str, str], ...] = (
    ("CLIN_", "clinical"),
    ("FIN_", "financial"),
    ("CORP_", "corporate"),
    ("ACCESS_", "market_access"),
)


def _is_stock_tape_market_wrap(text: str) -> bool:
    """True when the article lead is a stock-price / index wrap, not a drug catalyst."""
    blob = text or ""
    head = blob.split("\n", 1)[0][:320]
    if _STOCK_TAPE_HEAD_RE.search(head):
        return True
    # AD HOC / tape publishers often put the move in the title line.
    if re.search(r"(?i)\bad[- ]?hoc\s+news\b", head) and re.search(
        r"(?i)\b(?:percent|%|nasdaq|nyse|s&p|market\s+cap)\b",
        blob[:900],
    ):
        return True
    return False


def _reconcile_misplaced_event_dimensions(
    by_dim: dict[str, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """
    AI sometimes parks CLIN_* under corporate (or FIN_* under clinical).
    Move each hit to the dimension implied by its event_id prefix.
    """
    out: dict[str, dict[str, Any]] = {
        k: dict(v) if isinstance(v, dict) else v for k, v in by_dim.items()
    }
    for dim in list(DIMENSIONS):
        block = out.get(dim)
        if not isinstance(block, dict):
            continue
        eid = str(block.get("event_id") or "").strip().upper()
        if not eid:
            continue
        target = None
        for pref, d in _EVENT_ID_DIM_PREFIX:
            if eid.startswith(pref):
                target = d
                break
        if not target or target == dim:
            continue
        tgt = out.get(target) if isinstance(out.get(target), dict) else _empty_dim_result(target)
        tgt_eid = str(tgt.get("event_id") or "").strip()
        cur_abs = abs(float(block.get("score") or 0))
        tgt_abs = abs(float(tgt.get("score") or 0)) if tgt_eid else -1.0
        if tgt_eid and tgt_abs >= cur_abs:
            out[dim] = {
                **_empty_dim_result(dim),
                "classification_method": "dimension_reconcile_drop",
            }
            continue
        moved = dict(block)
        moved["dimension"] = target
        prev_m = str(block.get("classification_method") or "ai")
        moved["classification_method"] = f"{prev_m}+dim_reconcile"
        out[target] = moved
        out[dim] = {
            **_empty_dim_result(dim),
            "classification_method": "dimension_reconcile_moved",
        }
    return out


def _approval_is_lead_line(blob: str) -> bool:
    """True only when the *title/lead line* is an approval catalyst."""
    head = (blob or "").split("\n", 1)[0][:280]
    return bool(
        re.search(
            r"(?i)\b(?:fda|ema|mhra|pmda|nmpa)\s+approv(?:ed|es|al)\b|"
            r"\breceived\s+(?:fda|ema|mhra|pmda|nmpa)\s+approval\b|"
            r"\bwins?\s+china\s+approval\b|"
            r"\bchina\s+approval\s+for\b|"
            r"\bapprov(?:ed|al)\s+in\s+(?:china|japan|eu|europe|us|u\.s\.)\b|"
            r"\bregulatory\s+approval\s+(?:of|for)\b|"
            r"\bjapan(?:ese)?\s+(?:regulatory\s+)?approval\b",
            head,
        )
    )


def _suppress_incidental_clinical_on_stock_tape(
    by_dim: dict[str, dict[str, Any]],
    text: str,
) -> dict[str, dict[str, Any]]:
    """
    Stock-tape / % slide wraps often mention an old or secondary approval as *reason*
    for the move. That must not light the Clin thermometer as if the article were an
    approval catalyst (BIIB AD HOC «1.6% slide» + Leqembi Japan mention).
    """
    blob = text or ""
    out = {k: dict(v) if isinstance(v, dict) else v for k, v in by_dim.items()}
    if not _is_stock_tape_market_wrap(blob):
        return out
    if _clinical_readout_is_headline(blob) or _approval_is_lead_line(blob):
        return out
    for dim in list(out.keys()):
        block = out.get(dim) if isinstance(out.get(dim), dict) else {}
        eid = str(block.get("event_id") or "").strip().upper()
        if not eid:
            continue
        if eid in _INCIDENTAL_CLIN_ON_EARNINGS or eid.startswith("CLIN_"):
            out[dim] = {
                **_empty_dim_result(dim if dim in DIMENSIONS else "clinical"),
                "classification_method": "stock_tape_clinical_suppress",
            }
    return out


def _postprocess_dimension_hits(
    by_dim: dict[str, dict[str, Any]],
    text: str,
    *,
    path: str | None = None,
) -> dict[str, dict[str, Any]]:
    """Shared cleanup after heuristic or AI classification."""
    out = _reconcile_misplaced_event_dimensions(by_dim)
    out = _suppress_incidental_approval_on_earnings(out, text, path=path)
    out = _suppress_incidental_clinical_on_stock_tape(out, text)
    return out


def _clinical_readout_is_headline(blob: str) -> bool:
    """True when the *lead line* is a clinical readout / approval, not a P&L wrap."""
    head = (blob or "").split("\n", 1)[0][:280]
    return bool(
        re.search(
            r"(?i)\b(?:"
            r"primary\s+endpoint|"
            r"topline\s+results?|"
            r"phase\s*[123i]{1,3}.{0,48}(?:results?|data|readout|met|missed)|"
            r"(?:fda|ema|nmpa)\s+approv|"
            r"wins?\s+china\s+approval|"
            r"china\s+approval|"
            r"approv(?:ed|al)\s+in\s+china|"
            r"\bcrl\b|"
            r"pivotal\s+(?:trial|study)\s+(?:met|missed|succeeded|failed)"
            r")\b",
            head,
        )
    )


def _suppress_incidental_approval_on_earnings(
    by_dim: dict[str, dict[str, Any]],
    text: str,
    *,
    path: str | None = None,
) -> dict[str, dict[str, Any]]:
    """
    When the key information is an earnings / P&L report, drop clinical FDA /
    endpoint hits that came from product history (post-approval registry) or
    AI brief filler ("primary endpoint MET" next to revenue tables).
    """
    blob = text or ""
    out = {k: dict(v) if isinstance(v, dict) else v for k, v in by_dim.items()}
    fin_id = str((out.get("financial") or {}).get("event_id") or "")
    clin_id = str((out.get("clinical") or {}).get("event_id") or "")
    earnings_hit = fin_id.startswith("FIN_EARNINGS") or bool(_EARNINGS_PNL_RE.search(blob))
    approval_is_headline = bool(
        re.search(
            r"(?i)\b(?:fda|ema|nmpa)\s+approv(?:ed|es|al)\s+(?:for|of|the)\b|"
            r"\breceived\s+(?:fda|ema|nmpa)\s+approval\b|"
            r"\bwins?\s+china\s+approval\b|"
            r"\bchina\s+approval\s+for\b|"
            r"\bapprov(?:ed|al)\s+in\s+china\b",
            blob[:280],
        )
    )
    clinical_lead = _clinical_readout_is_headline(blob)
    if (
        earnings_hit
        and clin_id in _INCIDENTAL_CLIN_ON_EARNINGS
        and not approval_is_headline
        and not clinical_lead
    ):
        out["clinical"] = _empty_dim_result("clinical")

    # P&L facts present but financial dim missed (e.g. AI only tagged clinical).
    if earnings_hit and not str((out.get("financial") or {}).get("event_id") or ""):
        try:
            m = _EARNINGS_PNL_RE.search(blob)
            scored = compute_dimension_score("FIN_EARNINGS_REPORTED", [], path=path)
            out["financial"] = {
                **scored,
                "dimension": "financial",
                "evidence": (m.group(0) if m else "earnings")[:240],
                "classification_method": "heuristic_earnings_reconcile",
            }
        except Exception:
            pass
    return out


def classify_heuristic(text: str, *, path: str | None = None) -> dict[str, Any]:
    """Offline classification: first matching high-precision pattern per dimension."""
    blob = text or ""
    ev_map = events_by_id(path)
    by_dim: dict[str, dict[str, Any]] = {d: _empty_dim_result(d) for d in DIMENSIONS}
    review: list[dict[str, Any]] = []

    matched_ids: list[str] = []
    for event_id_raw, rx in _HEURISTIC_PATTERNS:
        event_id = resolve_taxonomy_id(event_id_raw, path=path) or event_id_raw
        if event_id not in ev_map:
            continue
        m = rx.search(blob)
        if not m:
            continue
        matched_ids.append(event_id)
        dim = str(ev_map[event_id]["dimension"])
        # Keep strongest |base_weight| if multiple hits in same dimension
        prev = by_dim[dim]
        prev_w = abs(float(ev_map.get(prev.get("event_id") or "", {}).get("base_weight") or 0))
        cur_w = abs(float(ev_map[event_id].get("base_weight") or 0))
        if prev.get("event_id") and cur_w < prev_w:
            continue
        mods = _infer_modifier_ids(blob, dim)
        # Enrollment is a fixed procedural chip — do not damp/amplify with Phase ×.
        if event_id == "CLIN_ENROLLMENT_COMPLETED":
            mods = [
                mid
                for mid in mods
                if "trial_phase" not in str(mid).lower() and "fase_trial" not in str(mid).lower()
            ]
        scored = compute_dimension_score(event_id, mods, path=path)
        by_dim[dim] = {
            **scored,
            "dimension": dim,
            "evidence": (m.group(0) or "")[:240],
            "classification_method": "heuristic",
        }

    by_dim = _postprocess_dimension_hits(by_dim, blob, path=path)

    return {
        "dimensions": by_dim,
        "review_flags": review,
        "classification_method": "heuristic",
        "taxonomy_version": taxonomy_version(path),
        "matched_event_ids": matched_ids,
    }


def _compact_event_catalog(path: str | None = None) -> str:
    """Runtime catalog for the prompt — sourced from config, not hardcoded."""
    lines: list[str] = []
    for dim in DIMENSIONS:
        lines.append(f"## {dim}")
        for e in events_for_dimension(dim, path):
            lines.append(
                f"- {e['id']}: {e['event_type']} (base={e['base_weight']})"
            )
    return "\n".join(lines)


def _compact_modifier_catalog(path: str | None = None) -> str:
    lines: list[str] = []
    for m in load_taxonomy(path)["modifiers"]:
        lines.append(
            f"- {m['id']}: {m['category']} / {m['modifier']} (×{m['multiplier']}) "
            f"applies={','.join(m.get('applies_to') or [])}"
        )
    return "\n".join(lines)


def build_classification_prompt(text: str, *, path: str | None = None) -> str:
    clip = re.sub(r"\s+", " ", (text or "")).strip()[:12_000]
    return (
        "You are a biotech event classifier. Do NOT judge how positive/negative the text is.\n"
        "For each dimension (clinical, financial, corporate, market_access), pick AT MOST ONE "
        "event_id from the fixed catalog below if clearly present. If none fit, set event_id to null.\n"
        "If something important happened but NO catalog id fits, add it under review_flags "
        "(do not invent ids).\n"
        "Also list applicable modifier_ids from the modifier catalog when evidenced in the text.\n"
        "Return ONLY one JSON object:\n"
        "{"
        '"clinical":{"event_id":string|null,"modifier_ids":[string],"evidence":string|null},'
        '"financial":{"event_id":string|null,"modifier_ids":[string],"evidence":string|null},'
        '"corporate":{"event_id":string|null,"modifier_ids":[string],"evidence":string|null},'
        '"market_access":{"event_id":string|null,"modifier_ids":[string],"evidence":string|null},'
        '"review_flags":[{"dimension":string|null,"note":string,"evidence":string|null}]'
        "}\n"
        "Rules:\n"
        "- Never output a numeric sentiment/score.\n"
        "- evidence must be a short verbatim quote from SOURCE (or null).\n"
        "- Prefer null over a forced nearest match.\n\n"
        f"EVENT CATALOG (from config v{taxonomy_version(path)}):\n"
        f"{_compact_event_catalog(path)}\n\n"
        f"MODIFIER CATALOG:\n{_compact_modifier_catalog(path)}\n\n"
        f"SOURCE:\n{clip}"
    )


def _parse_classification_json(raw: str) -> dict[str, Any] | None:
    if not raw:
        return None
    blob = raw.strip()
    if blob.startswith("```"):
        blob = re.sub(r"^```(?:json)?\s*", "", blob)
        blob = re.sub(r"\s*```$", "", blob)
    try:
        start = blob.find("{")
        end = blob.rfind("}")
        if start >= 0 and end > start:
            blob = blob[start : end + 1]
        obj = json.loads(blob)
    except Exception:
        return None
    return obj if isinstance(obj, dict) else None


def classify_with_ai(text: str, *, path: str | None = None) -> dict[str, Any] | None:
    prompt = build_classification_prompt(text, path=path)
    try:
        from ai_provider import call_ai

        raw = call_ai(
            prompt,
            system=(
                "Return valid JSON only. Classify events from the fixed catalog. "
                "Never invent scores or event ids."
            ),
            max_tokens=900,
            task="summary",
        )
    except Exception as exc:
        logger.debug("taxonomy AI classify failed: %s", exc)
        return None
    obj = _parse_classification_json(raw or "")
    if not obj:
        return None

    ev_map = events_by_id(path)
    by_dim: dict[str, dict[str, Any]] = {}
    review: list[dict[str, Any]] = []

    for dim in DIMENSIONS:
        block = obj.get(dim) if isinstance(obj.get(dim), dict) else {}
        event_id = block.get("event_id")
        if event_id is not None:
            event_id = str(event_id).strip() or None
        event_id = resolve_taxonomy_id(event_id, path=path)
        if event_id and event_id not in ev_map:
            review.append(
                {
                    "dimension": dim,
                    "note": f"model returned unknown event_id={block.get('event_id')}",
                    "evidence": block.get("evidence"),
                    "review_reason": "event_not_in_taxonomy",
                }
            )
            by_dim[dim] = {
                **_empty_dim_result(dim),
                "review_flag": True,
                "review_reason": "event_not_in_taxonomy",
                "evidence": (str(block.get("evidence") or "")[:240] or None),
                "classification_method": "ai",
            }
            continue
        mods_raw = block.get("modifier_ids") or []
        mods = [str(x).strip() for x in mods_raw if str(x).strip()] if isinstance(mods_raw, list) else []
        # Drop unknown modifiers silently (don't invent multipliers)
        mod_map = modifiers_by_id(path)
        mods = [
            m
            for m in (resolve_taxonomy_id(m, path=path) or m for m in mods)
            if m in mod_map
        ]
        scored = compute_dimension_score(event_id, mods, path=path)
        by_dim[dim] = {
            **scored,
            "dimension": dim,
            "evidence": (str(block.get("evidence") or "")[:240] or None),
            "classification_method": "ai",
        }

    for flag in obj.get("review_flags") or []:
        if isinstance(flag, dict) and (flag.get("note") or flag.get("evidence")):
            review.append(
                {
                    "dimension": flag.get("dimension"),
                    "note": str(flag.get("note") or "")[:240],
                    "evidence": (str(flag.get("evidence") or "")[:240] or None),
                    "review_reason": "unlisted_event",
                }
            )

    return {
        "dimensions": by_dim,
        "review_flags": review,
        "classification_method": "ai",
        "taxonomy_version": taxonomy_version(path),
    }


def _provisional_eis_from_dimensions(by_dim: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """
    Card EIS badge: reproducible proxy from taxonomy scores (NOT EIS_market).
    Maps strongest signed dimension score [-3,+3] → sentiment [-2,+2] → compute_eis.
    """
    from prediction.event_impact_score import compute_eis

    best = 0.0
    for d in DIMENSIONS:
        s = float((by_dim.get(d) or {}).get("score") or 0.0)
        if abs(s) > abs(best):
            best = s
    # Map [-3,+3] → [-2,+2]
    sentiment = clamp_score(best * (2.0 / 3.0), lo=-2.0, hi=2.0)
    return compute_eis(
        delta_p_1d=None,
        delta_p_3d=None,
        vol_ratio=None,
        sentiment=sentiment,
    )


def classification_to_score_fields(
    classified: dict[str, Any],
) -> dict[str, Any]:
    by_dim = classified.get("dimensions") or {}
    out: dict[str, Any] = {
        "taxonomy_version": classified.get("taxonomy_version"),
        "taxonomy_method": classified.get("classification_method"),
        "taxonomy_review_flags": classified.get("review_flags") or [],
        "taxonomy_dimensions": {},
    }
    notes_bits: list[str] = []
    for dim in DIMENSIONS:
        block = by_dim.get(dim) or _empty_dim_result(dim)
        field = SCORE_FIELD[dim]
        out[field] = float(block.get("score") or 0.0)
        slim = {
            "score": out[field],
            "event_id": block.get("event_id"),
            "event_type": block.get("event_type"),
            "evidence": block.get("evidence"),
            "modifiers_applied": block.get("modifiers_applied") or [],
            "base_weight": block.get("base_weight"),
            "multiplier_product": block.get("multiplier_product"),
            "review_flag": bool(block.get("review_flag")),
            "unclassified": bool(block.get("unclassified")),
            "classification_method": block.get("classification_method"),
        }
        # Attach Excel benchmark importance (−100…+100): outcome-specific rows
        # already encode event type + outcome (Ph3 MET +85 vs MISSED −75).
        if slim.get("event_id") and not slim.get("unclassified"):
            try:
                from catalyst_benchmark import importance_for_taxonomy

                ev_txt = " ".join(
                    str(x)
                    for x in (
                        block.get("evidence"),
                        block.get("event_type"),
                        classified.get("text_snippet"),
                    )
                    if x
                )
                imp = importance_for_taxonomy(
                    str(slim["event_id"]),
                    text=ev_txt,
                )
                if imp is not None:
                    slim["thermometer_importance"] = float(imp)
                    slim["benchmark_label"] = None
                    try:
                        from catalyst_benchmark import match_benchmark_event

                        hit = match_benchmark_event(
                            ev_txt or str(slim["event_id"]),
                            taxonomy_event_id=str(slim["event_id"]),
                            min_score=0.45 if ev_txt else 0.99,
                        )
                        if hit:
                            slim["benchmark_label"] = hit.get("label")
                            slim["benchmark_id"] = hit.get("id")
                    except Exception:
                        pass
            except Exception:
                pass
        out["taxonomy_dimensions"][dim] = slim
        if slim["event_type"] and slim["evidence"]:
            notes_bits.append(f"{slim['event_type']}: {slim['evidence']}")
        elif slim["review_flag"]:
            notes_bits.append(f"{dim}: da rivedere")

    eis = _provisional_eis_from_dimensions(by_dim)
    # Fake 0.0 from all-unclassified looks like a scored neutral event on Daily News.
    all_empty = all(
        bool((by_dim.get(d) or {}).get("unclassified")) for d in DIMENSIONS
    )
    if all_empty:
        out["eis_score"] = None
        out["eis"] = None
    else:
        out["eis_score"] = eis.get("score")
        out["eis"] = eis
    out["heuristic_rev"] = HEURISTIC_REV

    # Keep market_access_notes for existing UI tooltip
    acc = out["taxonomy_dimensions"].get("market_access") or {}
    if acc.get("event_type"):
        out["market_access_notes"] = (
            f"{acc.get('event_type')}"
            + (f" — {acc['evidence']}" if acc.get("evidence") else "")
        )[:240]
    elif acc.get("review_flag"):
        out["market_access_notes"] = "Market access: da rivedere (evento fuori tassonomia)"
    else:
        out["market_access_notes"] = "No market-access event classified"

    out["taxonomy_audit"] = "; ".join(notes_bits)[:500] if notes_bits else None
    return out


def score_article_dimensions(
    text: str,
    *,
    use_ai: bool = False,
    path: str | None = None,
) -> dict[str, Any]:
    """
    Main entry: classify then score. AI optional; always falls back to heuristic.
    Thermometer axes follow the key information in the article (clin and/or fin).
    """
    classified: dict[str, Any] | None = None
    if use_ai and len((text or "").strip()) >= 40:
        classified = classify_with_ai(text, path=path)
    if not classified:
        classified = classify_heuristic(text, path=path)
    else:
        dims = classified.get("dimensions")
        if isinstance(dims, dict):
            classified = {
                **classified,
                "dimensions": _postprocess_dimension_hits(dims, text or "", path=path),
            }
    return classification_to_score_fields(classified)


def _clinical_block(scored: dict[str, Any]) -> dict[str, Any]:
    dims = scored.get("taxonomy_dimensions")
    if not isinstance(dims, dict):
        return {}
    block = dims.get("clinical")
    return block if isinstance(block, dict) else {}


def ensure_paper_clinical_baseline(
    scored: dict[str, Any],
    *,
    text: str = "",
    path: str | None = None,
) -> dict[str, Any]:
    """
    Peer-reviewed product papers with no stronger clinical hit still get a
    CLIN_SCIENTIFIC_PUBLICATION baseline so they contribute to Σ Clin.
    """
    out = dict(scored)
    clin = _clinical_block(out)
    if clin.get("event_id") and not clin.get("unclassified"):
        return out
    blob = (text or "").strip()
    if len(blob) < 40:
        return out
    scored_dim = compute_dimension_score(
        CLIN_SCIENTIFIC_PUBLICATION_ID, [], path=path
    )
    dims = dict(out.get("taxonomy_dimensions") or {})
    dims["clinical"] = {
        **scored_dim,
        "dimension": "clinical",
        "evidence": (blob[:180] + ("…" if len(blob) > 180 else "")),
        "classification_method": "paper_baseline",
        "unclassified": False,
    }
    out["taxonomy_dimensions"] = dims
    out["clinical_score"] = float(scored_dim.get("score") or 0.0)
    # Refresh provisional EIS if everything else was empty
    if out.get("eis_score") is None:
        proxy = _provisional_eis_from_dimensions(
            {d: (dims.get(d) or _empty_dim_result(d)) for d in DIMENSIONS}
        )
        out["eis_score"] = proxy.get("score")
        out["eis"] = proxy
    audit = str(out.get("taxonomy_audit") or "").strip()
    note = "scientific publication (product paper baseline)"
    out["taxonomy_audit"] = f"{audit}; {note}".strip("; ")[:500] if audit else note
    return out


def apply_company_affiliation_boost(
    scored: dict[str, Any],
    *,
    company_affiliated: bool,
    path: str | None = None,
) -> dict[str, Any]:
    """
    Higher clinical weight when author affiliation matches the company name.
    Uses taxonomy modifier company_affiliation_match (×1.5).
    """
    out = dict(scored)
    out["company_affiliated"] = bool(company_affiliated)
    if not company_affiliated:
        return out

    clin = _clinical_block(out)
    event_id = clin.get("event_id") or CLIN_SCIENTIFIC_PUBLICATION_ID
    if clin.get("unclassified") and not clin.get("event_id"):
        event_id = CLIN_SCIENTIFIC_PUBLICATION_ID

    mods_existing = [
        str(m.get("id"))
        for m in (clin.get("modifiers_applied") or [])
        if isinstance(m, dict) and m.get("id")
    ]
    if COMPANY_AFFILIATION_MODIFIER_ID in mods_existing:
        return out

    mods = [*mods_existing, COMPANY_AFFILIATION_MODIFIER_ID]
    scored_dim = compute_dimension_score(str(event_id), mods, path=path)
    dims = dict(out.get("taxonomy_dimensions") or {})
    prev = dict(clin) if clin else {}
    dims["clinical"] = {
        **prev,
        **scored_dim,
        "dimension": "clinical",
        "evidence": prev.get("evidence"),
        "classification_method": prev.get("classification_method") or "affiliation_boost",
        "unclassified": False,
    }
    out["taxonomy_dimensions"] = dims
    out["clinical_score"] = float(scored_dim.get("score") or 0.0)
    audit = str(out.get("taxonomy_audit") or "").strip()
    note = "company affiliation ×1.5"
    out["taxonomy_audit"] = f"{audit}; {note}".strip("; ")[:500] if audit else note
    return out


def score_scientific_paper(
    text: str,
    *,
    company_affiliated: bool = False,
    use_ai: bool = False,
    path: str | None = None,
) -> dict[str, Any]:
    """
    Score a scientific article into clinical (and other dims if present).
    Always assigns at least CLIN_SCIENTIFIC_PUBLICATION; affiliated authors
    get the company_affiliation_match multiplier on clinical.
    """
    blob = (text or "").strip()
    scored = score_article_dimensions(blob, use_ai=use_ai, path=path)
    scored = ensure_paper_clinical_baseline(scored, text=blob, path=path)
    scored = apply_company_affiliation_boost(
        scored, company_affiliated=company_affiliated, path=path
    )
    scored["is_paper"] = True
    return scored


def score_tip_for_dimension(row: dict[str, Any], dimension: str) -> str | None:
    """Human-readable tooltip from saved taxonomy_dimensions."""
    dims = row.get("taxonomy_dimensions")
    if not isinstance(dims, dict):
        return None
    block = dims.get(dimension)
    if not isinstance(block, dict):
        return None
    parts: list[str] = []
    if block.get("event_type"):
        parts.append(str(block["event_type"]))
    if block.get("evidence"):
        parts.append(f"«{block['evidence']}»")
    if block.get("review_flag"):
        parts.append("⚠ da rivedere")
    mods = block.get("modifiers_applied") or []
    if mods:
        parts.append(
            "mods: "
            + ", ".join(
                f"{m.get('modifier')}×{m.get('multiplier')}"
                for m in mods
                if isinstance(m, dict)
            )
        )
    return " · ".join(parts) if parts else None


# ── 8-K filing classifier (classification + extraction only; scores elsewhere) ──

EIGHT_K_SYSTEM_PROMPT = """\
You are a financial/clinical filing classifier for a biotech investment platform.
Your job is CLASSIFICATION AND EXTRACTION ONLY. You never assign a sentiment score
or a numeric value yourself — that is computed separately by deterministic code
from the event IDs and magnitude signals you extract.

For each of the four dimensions below, decide whether the filing text describes
an event matching one of the fixed event IDs listed for that dimension. Use ONLY
an ID from the list provided — never invent a new one and never paraphrase an ID.
If no event in a dimension is described, return null for that dimension. If the
filing describes something dimension-relevant that does NOT match any listed ID,
return "UNCLASSIFIED" for that dimension and explain why in unclassified_notes —
do not force it into the closest existing ID.

DIMENSIONS AND ALLOWED EVENT IDs:

Clinical: {clinical_ids}
Financial: {financial_ids}
Corporate: {corporate_ids}
Market Access: {access_ids}

For whichever dimension(s) you classify (not null/UNCLASSIFIED), also extract these
magnitude signals when present in the text (use null when not stated — do not guess):
- trial_phase: one of "phase1" | "phase2" | "phase3" | "phase4" | "registrational" | "post_market" | null
- statistical_significance: one of "p<0.01" | "p<0.05" | "trend_only" | null
- endpoint_type: one of "primary" | "secondary" | "exploratory" | null
- amount_pct_market_cap: one of "under_5" | "5_to_20" | "over_20" | null
  (only if you can reasonably estimate this from the dollar amount stated and
  general knowledge of the company's scale; otherwise null — do not fabricate)
- surprise_vs_expected: one of "expected" | "surprise" | null

Always extract a verbatim evidence_quote (a direct sentence or clause from the
source text, not paraphrased) supporting each non-null classification.

Finally, write a narrative_summary in English (2–4 short paragraphs of discursive
prose — not bullet points, not labeled fields) that a biotech investor would read
on a news card. Prefer this structure when the facts are in the filing:
1) Company (exchange: TICKER) + what was announced (e.g. registered direct offering)
   with hard numbers (shares, price, warrants, gross proceeds, expected closing).
2) Use of proceeds and any lock-up / standstill / placement-agent terms stated.
3) End with one line: "Source: 8-K {{Company}}, {{filing date}}, SEC EDGAR"
Cover only what is actually reported — do not speculate about market reaction
and do not invent numbers. If the filing is not an offering, still write English
prose covering the material Items.

Output strict JSON matching this schema (no prose outside the JSON):

{{
  "items_detected": ["1.01", "7.01"],
  "classifications": {{
    "clinical":      {{ "event_id": string|null, "evidence_quote": string|null, "magnitude": {{}} }},
    "financial":     {{ "event_id": string|null, "evidence_quote": string|null, "magnitude": {{}} }},
    "corporate":     {{ "event_id": string|null, "evidence_quote": string|null, "magnitude": {{}} }},
    "market_access": {{ "event_id": string|null, "evidence_quote": string|null, "magnitude": {{}} }}
  }},
  "unclassified_notes": [ "string describing any dimension-relevant content that matched no ID" ],
  "narrative_summary": "string"
}}
"""

_MAGNITUDE_TO_MODIFIER: dict[str, dict[str, str]] = {
    "trial_phase": {
        "phase1": "trial_phase_phase1",
        "phase2": "trial_phase_phase2",
        "phase3": "trial_phase_phase3",
        "phase4": "trial_phase_phase4",
        "registrational": "trial_phase_registrational",
        "post_market": "trial_phase_post_market",
    },
    "statistical_significance": {
        "p<0.01": "statistical_significance_p_lt_0_01",
        "p<0.05": "statistical_significance_p_lt_0_05",
        "trend_only": "statistical_significance_trend_only",
    },
    "endpoint_type": {
        "primary": "endpoint_type_primary",
        "secondary": "endpoint_type_secondary",
        "exploratory": "endpoint_type_exploratory",
    },
    "amount_pct_market_cap": {
        "under_5": "amount_pct_market_cap_under_5",
        "5_to_20": "amount_pct_market_cap_5_to_20",
        "over_20": "amount_pct_market_cap_over_20",
    },
    "surprise_vs_expected": {
        "expected": "surprise_vs_expected_expected",
        "surprise": "surprise_vs_expected_surprise",
    },
}

_ITEM_LABELS = {
    "1.01": "Entry into Material Agreement",
    "1.02": "Termination of Material Agreement",
    "2.01": "Acquisition / Disposition of Assets",
    "2.02": "Results of Operations / Financial Condition",
    "2.03": "Creation of Direct Financial Obligation",
    "2.04": "Triggering Events That Accelerate Obligations",
    "2.05": "Costs Associated with Exit / Disposal",
    "2.06": "Material Impairments",
    "3.01": "Notice of Delisting / Failure to Satisfy Listing Rule",
    "3.02": "Unregistered Sales of Equity Securities",
    "3.03": "Material Modification to Rights of Security Holders",
    "4.01": "Changes in Registrant's Certifying Accountant",
    "4.02": "Non-Reliance on Previously Issued Financial Statements",
    "5.02": "Departure / Election of Directors or Officers",
    "5.03": "Amendments to Articles / Bylaws",
    "5.07": "Submission of Matters to a Vote of Security Holders",
    "7.01": "Regulation FD Disclosure",
    "8.01": "Other Events",
    "9.01": "Financial Statements and Exhibits",
}

# English event labels for news cards. The taxonomy config keeps Italian
# `event_type` strings because the IT UI renders them directly.
_EVENT_TYPE_EN: dict[str, str] = {
    "CLIN_PRIMARY_MET": "Primary endpoint met (significant)",
    "CLIN_PRIMARY_MISSED": "Primary endpoint missed",
    "CLIN_SECONDARY_MET": "Secondary endpoint met",
    "CLIN_SECONDARY_MISSED": "Secondary endpoint missed",
    "CLIN_TOPLINE_POSITIVE": "Positive topline / interim results",
    "CLIN_TRIAL_HALTED_SAFETY": "Trial halted on safety",
    "CLIN_TRIAL_DISCONTINUED_FUTILITY": "Trial discontinued for futility",
    "CLIN_SERIOUS_AE": "Serious adverse event / black box warning",
    "CLIN_SAFETY_CONFIRMED": "Favorable safety profile confirmed",
    "CLIN_BTD_GRANTED": "Breakthrough Therapy Designation granted",
    "CLIN_FASTTRACK_PRIORITY": "Fast Track / Priority Review granted",
    "CLIN_ORPHAN_GRANTED": "Orphan Drug Designation granted",
    "CLIN_CRL_RECEIVED": "Complete Response Letter (CRL) received",
    "CLIN_APPROVAL_GRANTED": "FDA / EMA approval",
    "CLIN_LABEL_EXPANSION": "Label expansion approved",
    "CLIN_ENROLLMENT_COMPLETED": "Enrollment completed (on schedule)",
    "CLIN_STUDY_COMPLETED": "Study completed (no outcome stated)",
    "CLIN_STUDY_SUCCESS": "Study success (positive outcome)",
    "CLIN_STUDY_FAILED": "Study failure",
    "CLIN_DOSING_MILESTONE": "Dosing milestone (first / last patient dosed)",
    "CLIN_READOUT_GUIDED": "Readout expected with guided window",
    "FIN_EARNINGS_BEAT": "Earnings above consensus",
    "FIN_EARNINGS_MISS": "Earnings below consensus",
    "FIN_GUIDANCE_RAISED": "Guidance raised",
    "FIN_GUIDANCE_CUT": "Guidance cut / withdrawn",
    "FIN_NONDILUTIVE_FUNDING": "Non-dilutive funding (grant / milestone / royalty)",
    "FIN_DILUTIVE_OFFERING": "Dilutive equity offering / shelf takedown",
    "FIN_SHELF_FILED": "Shelf registration filed (no takedown)",
    "FIN_DEBT_REFINANCED": "Debt refinanced on favorable terms",
    "FIN_COVENANT_BREACH": "Covenant breach / default risk",
    "FIN_RATING_UPGRADE": "Credit rating upgrade",
    "FIN_RATING_DOWNGRADE": "Credit rating downgrade",
    "FIN_GOING_CONCERN": "Going-concern doubt disclosed",
    "FIN_RUNWAY_EXTENDED": "Cash runway extended",
    "FIN_RUNWAY_SHORT": "Cash runway under 12 months flagged",
    "CORP_MNA_TARGET_PREMIUM": "M&A target (announced at a premium)",
    "CORP_MNA_TARGET_DISTRESSED": "M&A target (distressed valuation)",
    "CORP_MNA_COMPLETED": "M&A completed",
    "CORP_MNA_TERMINATED": "M&A terminated / failed",
    "CORP_EXEC_HIRE": "Key executive hire",
    "CORP_EXEC_DEPARTURE": "Unplanned key executive departure",
    "CORP_PARTNERSHIP_SIGNED": "Partnership / licensing signed (with upfront)",
    "CORP_PARTNERSHIP_TERMINATED": "Partnership / licensing terminated",
    "CORP_PATENT_GRANTED": "Patent granted",
    "CORP_LITIGATION_WON": "Litigation / IP case won",
    "CORP_LITIGATION_LOST": "Litigation / IP case lost",
    "CORP_INSIDER_BUYING": "Material insider buying",
    "CORP_INSIDER_SELLING": "Material insider selling (unplanned)",
    "CORP_DELISTING_NOTICE": "Delisting / non-compliance notice",
    "ACCESS_PAYER_FAVORABLE": "Favorable payer coverage decision",
    "ACCESS_PAYER_RESTRICTIVE": "Restrictive payer coverage decision",
    "ACCESS_HTA_FAVORABLE": "Favorable HTA assessment (NICE / ICER)",
    "ACCESS_HTA_UNFAVORABLE": "Unfavorable HTA assessment",
    "ACCESS_FORMULARY_INCLUSION": "Formulary inclusion",
    "ACCESS_FORMULARY_EXCLUSION": "Formulary exclusion / tier downgrade",
    "ACCESS_REIMBURSEMENT_CODE": "New reimbursement code assigned",
    "ACCESS_PATIENT_PROGRAM": "Patient access program launched",
    "ACCESS_COMPETITOR_APPROVED": "Competitor approval (increased competition)",
    "ACCESS_COMPETITOR_WITHDRAWN": "Competitor withdrawn from market",
    "ACCESS_PRICING_PRESSURE": "Pricing pressure / PBM rebate demands",
    "ACCESS_PRICE_FAVORABLE": "Favorable list price achieved",
}


def event_type_en(event_id: str | None, fallback: str | None = None) -> str:
    """English label for a taxonomy event; humanizes IDs added after this map."""
    eid = str(event_id or "").strip().upper()
    if eid in _EVENT_TYPE_EN:
        return _EVENT_TYPE_EN[eid]
    if eid:
        words = re.sub(r"^(?:CLIN|FIN|CORP|ACCESS)_", "", eid).replace("_", " ").lower()
        if words.strip():
            return words[:1].upper() + words[1:]
    return str(fallback or "").strip()


def taxonomy_ids_for_prompt(dimension: str, *, path: str | None = None) -> str:
    ids = [e["id"] for e in events_for_dimension(dimension, path)]
    return ", ".join(ids)


def build_8k_system_prompt(*, path: str | None = None) -> str:
    return EIGHT_K_SYSTEM_PROMPT.format(
        clinical_ids=taxonomy_ids_for_prompt("clinical", path=path),
        financial_ids=taxonomy_ids_for_prompt("financial", path=path),
        corporate_ids=taxonomy_ids_for_prompt("corporate", path=path),
        access_ids=taxonomy_ids_for_prompt("market_access", path=path),
    )


def build_8k_user_message(
    *,
    ticker: str,
    filing_date: str,
    event_date: str | None = None,
    items_list: list[str] | None = None,
    body_text: str,
    exhibit_text: str | None = None,
) -> str:
    items = items_list or detect_8k_items(body_text)
    body = re.sub(r"\s+", " ", (body_text or "")).strip()[:14_000]
    exhibit = re.sub(r"\s+", " ", (exhibit_text or "")).strip()[:10_000] or "none attached"
    return (
        f"Filing: {ticker} — 8-K filed {filing_date}, "
        f"period of report {event_date or filing_date}\n"
        f"Items pre-detected by regex: {', '.join(items) if items else '(none)'}\n\n"
        f"--- FILING BODY ---\n{body}\n\n"
        f"--- ATTACHED EXHIBIT TEXT (if any, e.g. EX-99.1) ---\n{exhibit}"
    )


def detect_8k_items(text: str) -> list[str]:
    found: list[str] = []
    seen: set[str] = set()
    for m in re.finditer(r"\bItem\s+(\d\.\d{2})\b", text or "", flags=re.I):
        item = m.group(1)
        if item not in seen:
            seen.add(item)
            found.append(item)
    return found


def magnitude_to_modifier_ids(magnitude: dict[str, Any] | None) -> list[str]:
    if not isinstance(magnitude, dict):
        return []
    out: list[str] = []
    for key, mapping in _MAGNITUDE_TO_MODIFIER.items():
        raw = magnitude.get(key)
        if raw is None:
            continue
        mid = mapping.get(str(raw).strip())
        if mid:
            out.append(mid)
    return out


def _split_8k_body_and_exhibit(bundle: str) -> tuple[str, str]:
    """Heuristic split when primary + Ex-99 are concatenated with blank lines."""
    text = bundle or ""
    # EX-99 / press release often starts after a clear exhibit marker
    m = re.search(
        r"(?is)(?:\n\s*){2,}(?:exhibit\s+99|ex[-_]?99|press\s+release)\b",
        text,
    )
    if m and m.start() > 400:
        return text[: m.start()].strip(), text[m.start() :].strip()
    # Fallback: first 45% body, rest exhibit-ish
    if len(text) > 6000:
        cut = len(text) // 2
        return text[:cut].strip(), text[cut:].strip()
    return text, ""


def _title_from_8k_classification(
    items: list[str],
    by_dim: dict[str, dict[str, Any]],
    narrative: str,
) -> str:
    # Prefer strongest scored dimension event_type
    best_type = ""
    best_abs = -1.0
    for dim in DIMENSIONS:
        block = by_dim.get(dim) or {}
        eid = block.get("event_id")
        if not eid:
            continue
        score = abs(float(block.get("score") or 0.0))
        if score >= best_abs:
            best_abs = score
            best_type = event_type_en(str(eid), block.get("event_type"))
    item = ""
    for cand in ("7.01", "8.01", "2.02", "1.01", "5.02", "3.01"):
        if cand in items:
            item = cand
            break
    if not item and items:
        item = items[0]
    label = _ITEM_LABELS.get(item, f"Item {item}" if item else "8-K")
    if best_type:
        return f"{label}: {best_type}"[:200]
    # First sentence of narrative
    sent = re.split(r"(?<=[.!?])\s+", (narrative or "").strip())
    head = (sent[0] if sent else narrative or label).strip()
    return f"{label}: {head}"[:200] if head and head != label else label[:200]


def _fill_empty_dims_from_heuristic(
    classified: dict[str, Any],
    text: str,
    *,
    path: str | None = None,
) -> dict[str, Any]:
    """If a dimension has no event_id, adopt a high-precision heuristic match."""
    dims = classified.get("dimensions")
    if not isinstance(dims, dict) or not (text or "").strip():
        return classified
    heur = classify_heuristic(text, path=path)
    h_dims = heur.get("dimensions") if isinstance(heur.get("dimensions"), dict) else {}
    for dim in DIMENSIONS:
        cur = dims.get(dim) if isinstance(dims.get(dim), dict) else {}
        if cur.get("event_id"):
            continue
        hit = h_dims.get(dim) if isinstance(h_dims.get(dim), dict) else {}
        if not hit.get("event_id"):
            continue
        dims[dim] = {
            **hit,
            "classification_method": "heuristic_fill",
        }
    return classified


_ATM_RE = re.compile(
    r"(?i)\b(?:at[-\s]?the[-\s]?market|ATM)\b.{0,40}\b(?:offering|sales?\s+agreement|equity)\b"
    r"|\b(?:ATM|at[-\s]?the[-\s]?market)\s+(?:facility|program|agreement)\b"
)
_BOARD_HIRE_RE = re.compile(
    r"(?i)\b(?:appoint(?:ed|ment)|elected|joined\s+the\s+board|"
    r"board\s+of\s+directors|independent\s+director|class\s+[i1-3]+\s+director)\b"
)
_REAL_APPROVAL_RE = re.compile(
    r"(?i)\b(?:fda|ema|mhra|pmda|nmpa)\s+(?:granted\s+)?(?:approval|clearance)\b"
    r"|\breceived\s+(?:fda|ema)\s+approval\b"
    r"|\bapproved\s+(?:the|its)\s+(?:nda|bla|drug|product)\b"
)


def _prefer_atm_over_shelf(
    classified: dict[str, Any],
    text: str,
    *,
    path: str | None = None,
) -> dict[str, Any]:
    """
    ATM sales agreements are dilutive offerings, not inert shelf filings.
    CHRS 2026-08-28: title FIN_SHELF_FILED (weight 0) while body was ATM $50M.
    """
    dims = classified.get("dimensions")
    if not isinstance(dims, dict):
        return classified
    fin = dims.get("financial") if isinstance(dims.get("financial"), dict) else {}
    eid = str(fin.get("event_id") or "")
    if eid not in {"FIN_SHELF_FILED", "financial_shelf_registration_depositato_nessun_utilizzo"}:
        return classified
    if not _ATM_RE.search(text or ""):
        return classified
    dil_id = resolve_taxonomy_id("FIN_DILUTIVE_OFFERING", path=path) or "FIN_DILUTIVE_OFFERING"
    scored = compute_dimension_score(dil_id, [], path=path)
    dims["financial"] = {
        **scored,
        "dimension": "financial",
        "evidence": (fin.get("evidence") or "ATM sales agreement")[:240],
        "classification_method": "atm_shelf_correct",
    }
    return classified


def _suppress_incidental_clinical_on_board_hire(
    classified: dict[str, Any],
    text: str,
) -> dict[str, Any]:
    """
    Board/director appointment 8-Ks often mention future BLA/regulatory plans.
    Do not keep CLIN_APPROVAL_GRANTED (score ±3) unless real approval language.
    COCP 2026-08-17: Clin=3.0 on a director hire 7.01.
    """
    dims = classified.get("dimensions")
    if not isinstance(dims, dict):
        return classified
    clin = dims.get("clinical") if isinstance(dims.get("clinical"), dict) else {}
    eid = str(clin.get("event_id") or "")
    if eid not in {"CLIN_APPROVAL_GRANTED", "CLIN_LABEL_EXPANSION"}:
        return classified
    blob = text or ""
    if not _BOARD_HIRE_RE.search(blob):
        return classified
    if _REAL_APPROVAL_RE.search(blob):
        return classified
    dims["clinical"] = {
        **_empty_dim_result("clinical"),
        "classification_method": "board_hire_clinical_suppress",
    }
    return classified


def classify_8k_filing_result(
    obj: dict[str, Any],
    *,
    path: str | None = None,
) -> dict[str, Any]:
    """Turn model JSON into scored dimensions (deterministic weights)."""
    ev_map = events_by_id(path)
    classifications = obj.get("classifications") if isinstance(obj.get("classifications"), dict) else {}
    by_dim: dict[str, dict[str, Any]] = {}
    review: list[dict[str, Any]] = []

    for note in obj.get("unclassified_notes") or []:
        if str(note or "").strip():
            review.append(
                {
                    "dimension": None,
                    "note": str(note)[:240],
                    "evidence": None,
                    "review_reason": "unlisted_event",
                }
            )

    for dim in DIMENSIONS:
        block = classifications.get(dim) if isinstance(classifications.get(dim), dict) else {}
        raw_id = block.get("event_id")
        if raw_id is not None:
            raw_id = str(raw_id).strip() or None
        if raw_id and raw_id.upper() == "UNCLASSIFIED":
            review.append(
                {
                    "dimension": dim,
                    "note": "UNCLASSIFIED by model",
                    "evidence": (str(block.get("evidence_quote") or "")[:240] or None),
                    "review_reason": "unlisted_event",
                }
            )
            by_dim[dim] = {
                **_empty_dim_result(dim),
                "review_flag": True,
                "review_reason": "unlisted_event",
                "evidence": (str(block.get("evidence_quote") or "")[:240] or None),
                "classification_method": "ai_8k",
            }
            continue
        event_id = resolve_taxonomy_id(raw_id, path=path)
        if event_id and event_id not in ev_map:
            review.append(
                {
                    "dimension": dim,
                    "note": f"model returned unknown event_id={raw_id}",
                    "evidence": (str(block.get("evidence_quote") or "")[:240] or None),
                    "review_reason": "event_not_in_taxonomy",
                }
            )
            by_dim[dim] = {
                **_empty_dim_result(dim),
                "review_flag": True,
                "review_reason": "event_not_in_taxonomy",
                "evidence": (str(block.get("evidence_quote") or "")[:240] or None),
                "classification_method": "ai_8k",
            }
            continue
        mods = magnitude_to_modifier_ids(block.get("magnitude") if isinstance(block.get("magnitude"), dict) else None)
        if event_id == "CLIN_ENROLLMENT_COMPLETED":
            mods = [
                mid
                for mid in mods
                if "trial_phase" not in str(mid).lower() and "fase_trial" not in str(mid).lower()
            ]
        scored = compute_dimension_score(event_id, mods, path=path)
        by_dim[dim] = {
            **scored,
            "dimension": dim,
            "evidence": (str(block.get("evidence_quote") or "")[:240] or None),
            "classification_method": "ai_8k",
            "magnitude": block.get("magnitude") if isinstance(block.get("magnitude"), dict) else None,
        }

    items = [str(x) for x in (obj.get("items_detected") or []) if str(x).strip()]
    narrative = str(obj.get("narrative_summary") or "").strip()
    return {
        "dimensions": by_dim,
        "review_flags": review,
        "classification_method": "ai_8k",
        "taxonomy_version": taxonomy_version(path),
        "items_detected": items,
        "narrative_summary": narrative,
        "title": _title_from_8k_classification(items, by_dim, narrative),
    }


def classify_8k_filing(
    *,
    ticker: str,
    filing_date: str,
    text: str,
    event_date: str | None = None,
    path: str | None = None,
) -> dict[str, Any] | None:
    """
    AI classification of an 8-K bundle. Returns scored fields + narrative.
    Falls back to dilutive-offering heuristic when the model is unavailable.
    """
    body, exhibit = _split_8k_body_and_exhibit(text or "")
    bundle = f"{body}\n{exhibit}".strip()
    if len(bundle) < 80:
        return None
    items = detect_8k_items(bundle)
    system = build_8k_system_prompt(path=path)
    user = build_8k_user_message(
        ticker=ticker,
        filing_date=filing_date,
        event_date=event_date,
        items_list=items,
        body_text=body,
        exhibit_text=exhibit,
    )
    obj: dict[str, Any] | None = None
    try:
        from ai_provider import call_ai

        raw = call_ai(
            user,
            system=system,
            max_tokens=1800,
            task="summary",
        )
        obj = _parse_classification_json(raw or "")
    except Exception as exc:
        logger.debug("8-K classify AI failed %s: %s", ticker, exc)
        obj = None

    if not obj:
        obj = heuristic_8k_classification_obj(
            text=bundle,
            items=items,
            ticker=ticker,
            filing_date=filing_date,
            event_date=event_date,
        )
    if not obj:
        return None

    classified = classify_8k_filing_result(obj, path=path)
    # 8-K Item 7.01 often wraps a clinical PR (e.g. first/last patient dosed)
    # while the model leaves clinical empty — fill from high-precision heuristics.
    classified = _fill_empty_dims_from_heuristic(classified, bundle, path=path)
    classified = _prefer_atm_over_shelf(classified, bundle, path=path)
    classified = _suppress_incidental_clinical_on_board_hire(classified, bundle)
    if obj.get("_heuristic"):
        classified["classification_method"] = "heuristic_8k"
    # Surface heuristic_fill in the overall method for dossier observability.
    dims_after = classified.get("dimensions") or {}
    if any(
        isinstance(b, dict) and b.get("classification_method") == "heuristic_fill"
        for b in dims_after.values()
    ):
        root = str(classified.get("classification_method") or "ai_8k")
        if "heuristic_fill" not in root:
            classified["classification_method"] = f"{root}+heuristic_fill"
    scored = classification_to_score_fields(classified)
    scored["narrative_summary"] = classified.get("narrative_summary")
    scored["title"] = classified.get("title")
    scored["items_detected"] = classified.get("items_detected") or items
    scored["taxonomy_method"] = classified.get("classification_method") or "ai_8k"
    scored["taxonomy_classification"] = {
        "items_detected": scored["items_detected"],
        "classifications": {
            dim: {
                "event_id": ((classified.get("dimensions") or {}).get(dim) or {}).get(
                    "event_id"
                ),
                "evidence_quote": ((classified.get("dimensions") or {}).get(dim) or {}).get(
                    "evidence"
                ),
                "magnitude": ((classified.get("dimensions") or {}).get(dim) or {}).get(
                    "magnitude"
                ),
            }
            for dim in DIMENSIONS
        },
        "unclassified_notes": [
            str(x.get("note") or "")
            for x in (classified.get("review_flags") or [])
            if isinstance(x, dict) and x.get("note")
        ],
        "narrative_summary": classified.get("narrative_summary"),
    }
    # Prefer richer English offering narrative when facts are extractable.
    en_narrative = format_dilutive_offering_summary(
        text=bundle,
        ticker=ticker,
        filing_date=filing_date,
        event_date=event_date,
    )
    fin_id = (
        ((scored.get("taxonomy_dimensions") or {}).get("financial") or {}).get("event_id")
        if isinstance(scored.get("taxonomy_dimensions"), dict)
        else None
    )
    if en_narrative and (
        fin_id == "FIN_DILUTIVE_OFFERING"
        or not scored.get("narrative_summary")
        or len(str(scored.get("narrative_summary") or "")) < 280
        or _looks_like_italian_lede(str(scored.get("narrative_summary") or ""))
    ):
        scored["narrative_summary"] = en_narrative
        scored["taxonomy_classification"]["narrative_summary"] = en_narrative
        # Card title: first line of English header (TICKER — date)
        head = en_narrative.split("\n", 1)[0].strip()
        if head:
            scored["title"] = head[:200]
    return scored


def _looks_like_italian_lede(text: str) -> bool:
    t = (text or "").strip().lower()
    if not t:
        return False
    return bool(
        re.search(
            r"(ha comunicato|offerta azionaria|proventi lordi|collocator|"
            r"fonte:\s*8-k|evento datato|capitale circolante|"
            r"azioni ordinarie|redenzione delle azioni|"
            r"\b(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|"
            r"settembre|ottobre|novembre|dicembre)\b)",
            t,
        )
    )


def _looks_like_english_lede(text: str) -> bool:
    """Kept for callers; English ledes are the desired default now."""
    t = (text or "").strip()
    if not t:
        return True
    return bool(
        re.match(
            r"(?i)^(on\s+\w+|the\s+company\s+(?:issued|announced)|item\s+\d|"
            r"regulation\s+fd|this\s+current\s+report|[A-Z]{1,6}\s+[—–-])",
            t,
        )
    ) and not _looks_like_italian_lede(t)


def heuristic_8k_classification_obj(
    *,
    text: str,
    items: list[str] | None = None,
    ticker: str = "",
    filing_date: str = "",
    event_date: str | None = None,
) -> dict[str, Any] | None:
    """Offline JSON classification for common 8-K financing patterns."""
    blob = text or ""
    detected = list(items or detect_8k_items(blob))
    is_offering = bool(
        re.search(
            r"(?i)\b(registered\s+direct|public\s+offering|follow[- ]on\s+offering|"
            r"priced\s+(?:a|an|its).{0,40}offering|securities\s+purchase\s+agreement|"
            r"common\s+stock\s+offering|equity\s+offering)\b",
            blob,
        )
    )
    if not is_offering:
        return None

    evidence = None
    m = re.search(
        r"(?i)(?:gross\s+proceeds.{0,80}approximately\s+\$[\d.,]+\s*million|"
        r"approximately\s+\$[\d.,]+\s*million,?\s*before\s+deducting\s+Placement\s+Agent)",
        blob,
    )
    if m:
        evidence = re.sub(r"\s+", " ", m.group(0)).strip()[:240]
    if not evidence:
        m2 = re.search(r"(?i)registered\s+direct\s+offering.{0,80}", blob)
        evidence = re.sub(r"\s+", " ", (m2.group(0) if m2 else "registered direct offering")).strip()[
            :240
        ]

    notes: list[str] = []
    if re.search(r"(?i)Series\s+A\s+Convertible\s+Preferred|redemption\s+of\s+Series", blob):
        notes.append(
            "Use of proceeds includes redemption of Series A Convertible Preferred Stock "
            "— no dedicated event ID for this in the current taxonomy"
        )

    narrative = format_dilutive_offering_summary(
        text=blob,
        ticker=ticker,
        filing_date=filing_date,
        event_date=event_date,
    ) or (
        f"Dilutive equity offering (registered direct / equity offering) "
        f"for {ticker or 'the company'}."
    )

    if "7.01" not in detected and re.search(r"(?i)Item\s+7\.01", blob):
        detected.append("7.01")
    if "1.01" not in detected and re.search(r"(?i)Item\s+1\.01", blob):
        detected.append("1.01")

    empty = {"event_id": None, "evidence_quote": None, "magnitude": {}}
    return {
        "items_detected": detected or ["7.01"],
        "classifications": {
            "clinical": dict(empty),
            "financial": {
                "event_id": "FIN_DILUTIVE_OFFERING",
                "evidence_quote": evidence,
                "magnitude": {
                    "amount_pct_market_cap": None,
                    "surprise_vs_expected": None,
                },
            },
            "corporate": dict(empty),
            "market_access": dict(empty),
        },
        "unclassified_notes": notes,
        "narrative_summary": narrative,
        "_heuristic": True,
    }


def _italian_date_long(iso: str | None) -> str | None:
    """Legacy helper — prefer `_english_date_long` for investor summaries."""
    raw = str(iso or "").strip()[:10]
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", raw):
        return None
    y, m, d = raw.split("-")
    months = (
        "",
        "gennaio",
        "febbraio",
        "marzo",
        "aprile",
        "maggio",
        "giugno",
        "luglio",
        "agosto",
        "settembre",
        "ottobre",
        "novembre",
        "dicembre",
    )
    try:
        return f"{int(d)} {months[int(m)]} {y}"
    except Exception:
        return raw


def _english_date_long(iso: str | None) -> str | None:
    raw = str(iso or "").strip()[:10]
    if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}", raw):
        return None
    y, m, d = raw.split("-")
    months = (
        "",
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    )
    try:
        return f"{months[int(m)]} {int(d)}, {y}"
    except Exception:
        return raw


def _company_name_from_8k(text: str) -> str | None:
    m2 = re.search(
        r"(?i)(?:COMPANY\s+CONFORMED\s+NAME):\s*([^\n\r]{4,80})",
        text or "",
    )
    if m2:
        return re.sub(r"\s+", " ", m2.group(1)).strip(" ,.")
    m = re.search(
        r"(?i)\b(NeOnc\s+Technologies\s+Holdings(?:,?\s*Inc\.?)?)\b",
        text or "",
    )
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip(" ,.")
    m = re.search(
        r"(?i)\b([A-Z][A-Za-z0-9.&']+(?:\s+[A-Z][A-Za-z0-9.&']+){0,5}\s+"
        r"(?:Holdings|Therapeutics|Pharmaceuticals|Sciences)),\s*Inc\.?\b",
        text or "",
    )
    if m:
        name = re.sub(r"\s+", " ", m.group(1)).strip(" ,.")
        # Reject Item-title bleed ("…Agreement On September… Holdings, Inc")
        if re.search(r"(?i)\b(agreement|item\s+\d|entry into|regulation\s+fd)\b", name):
            return None
        if len(name) > 80:
            return None
        return name
    return None


def format_dilutive_offering_summary(
    *,
    text: str,
    ticker: str = "",
    filing_date: str = "",
    event_date: str | None = None,
) -> str | None:
    """
    English investor card for registered-direct / equity offerings.
    Returns None when the filing does not look like a dilutive offering.
    """
    blob = text or ""
    if not re.search(
        r"(?i)\b(registered\s+direct|securities\s+purchase\s+agreement|"
        r"priced\s+(?:a|an|its).{0,40}offering|common\s+stock\s+offering)\b",
        blob,
    ):
        return None

    tk = (ticker or "").strip().upper()
    company = _company_name_from_8k(blob) or (tk or "The company")
    company = re.sub(
        r"(?i)^(January|February|March|April|May|June|July|August|September|"
        r"October|November|December)\s+\d{1,2},?\s+20\d{2}\s+",
        "",
        company,
    ).strip()
    company = re.sub(r"^20\d{2}-\d{2}-\d{2}\s+", "", company).strip()
    file_en = _english_date_long(filing_date) or filing_date or ""
    event_en = _english_date_long(event_date) if event_date else None

    shares = None
    m = re.search(
        r"(?i)(?:offering and sale of an )?aggregate of\s+([\d,]+)\s+shares?"
        r"\s*(?:\([^)]{0,40}Shares[^)]{0,20}\))?\s+of\s+(?:the\s+Company.?s\s+)?"
        r"common\s+stock",
        blob,
    )
    if m:
        shares = m.group(1)

    price = None
    m = re.search(
        r"(?i)combined\s+(?:offering|purchase)\s+price\s+of\s+\$\s*([\d.]+)\s+per\s+"
        r"(?:Share|share)",
        blob,
    )
    if not m:
        m = re.search(
            r"(?i)exercise\s+price\s+of\s+\$\s*([\d.]+)\s+per\s+share",
            blob,
        )
    if m:
        price = m.group(1)
        try:
            if float(price) < 0.01:
                m2 = re.search(
                    r"(?i)combined\s+(?:offering|purchase)\s+price\s+of\s+\$\s*([\d.]+)",
                    blob,
                )
                if m2 and float(m2.group(1)) >= 0.01:
                    price = m2.group(1)
        except Exception:
            pass

    prefunded = None
    m = re.search(
        r"(?i)Pre[- ]Funded\s+Warrants?[^.]{0,100}purchase\s+up\s+to\s+([\d,]+)\s+shares?",
        blob,
    )
    if m:
        prefunded = m.group(1)

    warrants = None
    m = re.search(
        r"(?i)warrants?\s+to\s+purchase\s+up\s+to\s+(?:an\s+aggregate\s+of\s+)?"
        r"([\d,]+)\s+shares?\s+of\s+Common\s+Stock\s*\([^)]{0,20}Warrants",
        blob,
    )
    if not m:
        m = re.search(
            r"(?i)accompanying\s+warrants?\s+to\s+purchase\s+up\s+to\s+"
            r"(?:an\s+aggregate\s+of\s+)?([\d,]+)",
            blob,
        )
    if m:
        warrants = m.group(1)

    proceeds = None
    m = re.search(
        r"(?i)gross\s+proceeds.{0,120}approximately\s+\$\s*([\d.,]+)\s*million",
        blob,
    )
    if not m:
        m = re.search(
            r"(?i)approximately\s+\$\s*([\d.,]+)\s*million,?\s*before\s+deducting",
            blob,
        )
    if m:
        proceeds = m.group(1).replace(",", ".")

    closing = None
    m = re.search(
        r"(?i)(?:expected\s+to\s+close|closing).{0,40}(?:on\s+)?"
        r"((?:January|February|March|April|May|June|July|August|September|"
        r"October|November|December)\s+\d{1,2},?\s+20\d{2})",
        blob,
    )
    if m:
        closing = m.group(1).replace("  ", " ").strip()

    use = None
    m = re.search(
        r"(?i)use\s+the\s+net\s+proceeds\s+from\s+the\s+Offering\s+for\s+([^\.]{20,220})",
        blob,
    )
    if m:
        use = re.sub(r"\s+", " ", m.group(1)).strip().rstrip(" ,;")

    lockup = bool(
        re.search(r"(?is)(?:90|ninety)[-\s]?day.{0,80}lock[- ]?up", blob)
        or re.search(r"(?is)lock[- ]?up.{0,80}(?:90|ninety)[-\s]?day", blob)
        or re.search(
            r"(?is)Lock[- ]Up Agreements?.{0,600}period of\s+(?:90|ninety)\s+days?",
            blob,
        )
    )
    standstill = bool(
        re.search(r"(?i)(?:30|thirty)[-\s]?day", blob)
        and re.search(r"(?i)registration\s+statement|Form\s+S-8", blob)
    )
    agents: list[str] = []
    if re.search(r"(?i)Roth\s+Capital", blob):
        agents.append("Roth Capital Partners")
    if re.search(r"(?i)A\.G\.P|Alliance\s+Global\s+Partners", blob):
        agents.append("A.G.P./Alliance Global Partners")
    fee = None
    m = re.search(
        r"(?i)([\d.]+)\s*%\s*(?:of\s+)?(?:the\s+)?(?:aggregate\s+)?gross\s+proceeds",
        blob,
    )
    if m:
        fee = m.group(1)
    strike = price
    prefunded_strike = None
    m = re.search(
        r"(?i)pre[- ]funded\s+warrant\s+exercise\s+price\s+of\s+\$\s*([\d.]+)",
        blob,
    )
    if m:
        prefunded_strike = m.group(1)

    header_bits = [tk or company]
    if file_en:
        header_bits.append(file_en)
    header = " — ".join(header_bits)
    if event_en and event_en != file_en:
        header = f"{header} (event date {event_en})"

    name = company + (f" (Nasdaq: {tk})" if tk else "")
    core = f"{name} announced a registered direct offering"
    if shares and price:
        core += (
            f": sale of {shares} shares of common stock at ${price}/share "
            "with accompanying warrants"
        )
        if prefunded:
            core += f", plus {prefunded} pre-funded warrants"
        if warrants:
            core += f" and {warrants} additional warrants"
    elif shares:
        core += f": sale of {shares} shares of common stock"
    if proceeds:
        core += (
            f", for gross proceeds of approximately ${proceeds} million "
            "before placement-agent fees"
        )
    core += "."
    if closing:
        core += f" Closing was expected on {closing}."

    bits: list[str] = [core]

    p2: list[str] = []
    if use:
        p2.append(f"Net proceeds are intended for {use}.")
    wbits: list[str] = []
    if strike:
        wbits.append(
            f"Warrants have a ${strike} exercise price "
            "(immediately exercisable, five-year term)"
            if re.search(r"(?i)five[-\s]?year|5[-\s]?year", blob)
            else f"Warrants have a ${strike} exercise price "
            "(immediately exercisable, multi-year term)"
        )
    if prefunded_strike:
        wbits.append(f"pre-funded warrant exercise price ${prefunded_strike}")
    if wbits:
        p2.append(", ".join(wbits) + ".")
    if lockup:
        p2.append(
            "The CEO and Chief Medical Officer agreed to a 90-day lock-up from closing"
            if re.search(r"(?i)Chief\s+Medical\s+Officer|CEO", blob)
            else "Company officers agreed to a 90-day lock-up from closing"
        )
        if standstill:
            p2[-1] += (
                "; the company may not issue new shares or file a registration "
                "statement for 30 days (except Form S-8)"
            )
        p2[-1] += "."
    if agents:
        fee_bit = f", {fee}% of gross proceeds" if fee else ""
        p2.append(f"Placement agents: {' and '.join(agents)}{fee_bit}.")
    if p2:
        bits.append(" ".join(p2))

    fonte_date = file_en or filing_date or ""
    bits.append(f"Source: 8-K {company}, {fonte_date}, SEC EDGAR")

    body = "\n\n".join(bits)
    return f"{header}\n\n{body}".strip()


# Backward-compatible alias (summaries are English).
format_dilutive_offering_summary_it = format_dilutive_offering_summary
