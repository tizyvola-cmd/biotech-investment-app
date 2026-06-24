#!/usr/bin/env python3
"""
Aggiunge al file biotech_clinical_openfda.csv le righe mancanti per i ticker
della tabella Simulation che hanno un NCT ID ma non hanno ancora match nella vista
Clinical_OpenFDA.

Per ogni ticker mancante:
 - chiama ClinicalTrials.gov API v2 con il NCT ID
 - aggiunge una riga con completion_date = CD della sim table (garantisce il match)
 - non duplica righe già presenti con lo stesso (ticker, nct_id)
"""
from __future__ import annotations

import csv
import io
import json
import os
import sys
import urllib.request
import urllib.parse
from datetime import datetime

CSV_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "data", "biotech_clinical_openfda.csv")

# Dati estratti dalla tabella Simulation (ticker → NCT, CD, company, sponsor, sponsorRel)
MISSING = [
    {"ticker": "CNSP",  "nct": "NCT04602624", "cd": "2026-05-27", "company": "CNS Pharmaceuticals, Inc.",           "phase": "PHASE2",          "sponsor": "Supernus Pharmaceuticals, Inc.",                               "sponsor_rel": "correlated company/subsidiary"},
    {"ticker": "ANIK",  "nct": "NCT04640298", "cd": "2026-05-31", "company": "Anika Therapeutics, Inc.",            "phase": "",                "sponsor": "Anika Therapeutics, Inc.",                                     "sponsor_rel": "direct sponsor"},
    {"ticker": "HURA",  "nct": "NCT06940440", "cd": "2026-05-31", "company": "TuHURA Biosciences, Inc.",            "phase": "",                "sponsor": "TuHURA Biosciences, Inc.",                                     "sponsor_rel": "direct sponsor"},
    {"ticker": "IRWD",  "nct": "NCT00948818", "cd": "2026-05-31", "company": "Ironwood Pharmaceuticals, Inc.",      "phase": "PHASE3",          "sponsor": "Forest Laboratories",                                          "sponsor_rel": "correlated company/subsidiary"},
    {"ticker": "CLRB",  "nct": "NCT02952508", "cd": "2026-06-22", "company": "Cellectar Biosciences, Inc.",         "phase": "PHASE1",          "sponsor": "Cellectar Biosciences, Inc.",                                  "sponsor_rel": "correlated company/subsidiary"},
    {"ticker": "PBYI",  "nct": "NCT04886531", "cd": "2026-06-22", "company": "Puma Biotechnology, Inc.",            "phase": "PHASE2",          "sponsor": "Ruth O'Regan",                                                 "sponsor_rel": "correlated company/subsidiary"},
    {"ticker": "VYGR",  "nct": "NCT00231946", "cd": "2026-06-22", "company": "Voyager Therapeutics, Inc.",          "phase": "PHASE3",          "sponsor": "",                                                             "sponsor_rel": "correlated company/subsidiary"},
    {"ticker": "AGIO",  "nct": "NCT07055243", "cd": "2026-06-30", "company": "Agios Pharmaceuticals, Inc.",         "phase": "PHASE2",          "sponsor": "University Health Network, Toronto",                           "sponsor_rel": "collaborator"},
    {"ticker": "BCAB",  "nct": "NCT04918186", "cd": "2026-06-30", "company": "BioAtla, Inc.",                       "phase": "PHASE1 | PHASE2", "sponsor": "Canadian Cancer Trials Group",                                 "sponsor_rel": "direct sponsor"},
    {"ticker": "ENGNW", "nct": "NCT04752722", "cd": "2026-06-30", "company": "enGene Therapeutics Inc.",            "phase": "PHASE1 | PHASE2", "sponsor": "enGene, Inc.",                                                 "sponsor_rel": "correlated company/subsidiary"},
    {"ticker": "IBRX",  "nct": "NCT04340596", "cd": "2026-06-30", "company": "ImmunityBio, Inc.",                   "phase": "PHASE1 | PHASE2", "sponsor": "National Institute of Allergy and Infectious Diseases (NIAID)", "sponsor_rel": "direct sponsor"},
    {"ticker": "KPTI",  "nct": "NCT02436707", "cd": "2026-06-30", "company": "Karyopharm Therapeutics Inc.",        "phase": "PHASE1",          "sponsor": "Canadian Cancer Trials Group",                                 "sponsor_rel": "collaborator"},
    {"ticker": "OLMA",  "nct": "NCT06016738", "cd": "2026-06-30", "company": "Olema Pharmaceuticals, Inc.",         "phase": "PHASE3",          "sponsor": "Olema Pharmaceuticals, Inc.",                                  "sponsor_rel": "direct sponsor"},
    {"ticker": "PLSE",  "nct": "NCT07287176", "cd": "2026-06-30", "company": "Pulse Biosciences, Inc.",             "phase": "",                "sponsor": "Pulse Biosciences, Inc.",                                      "sponsor_rel": "direct sponsor"},
    {"ticker": "SVA",   "nct": "NCT07418229", "cd": "2026-06-30", "company": "Sinovac Biotech Ltd.",                "phase": "PHASE4",          "sponsor": "Sinovac Biotech Co., Ltd",                                    "sponsor_rel": "correlated company/subsidiary"},
    {"ticker": "TELA",  "nct": "NCT05736848", "cd": "2026-06-30", "company": "TELA Bio, Inc.",                      "phase": "",                "sponsor": "Tela Bio Inc",                                                 "sponsor_rel": "direct sponsor"},
]

CT_API = "https://clinicaltrials.gov/api/v2/studies/{nct}?fields=NCTId,BriefTitle,OfficialTitle,OverallStatus,StudyType,Phase,Condition,InterventionName,LeadSponsorName,LeadSponsorClass,CollaboratorName,LastUpdatePostDate,StartDate,PrimaryCompletionDate,CompletionDate"


def fetch_ct_study(nct_id: str) -> dict:
    """Chiama ClinicalTrials.gov API v2 e restituisce i campi principali."""
    url = CT_API.format(nct=nct_id)
    req = urllib.request.Request(url, headers={"User-Agent": "SuperNova/1.0"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"  [WARN] API error per {nct_id}: {e}", file=sys.stderr)
        return {}

    proto = data.get("protocolSection", {})
    ident  = proto.get("identificationModule", {})
    status = proto.get("statusModule", {})
    desc   = proto.get("descriptionModule", {})
    design = proto.get("designModule", {})
    sponsor_mod = proto.get("sponsorCollaboratorsModule", {})
    cond   = proto.get("conditionsModule", {})
    interv = proto.get("armsInterventionsModule", {})

    phases = design.get("phases", [])
    phase_str = " | ".join(phases) if phases else ""

    conditions = cond.get("conditions", [])
    cond_str = " | ".join(conditions[:5])

    interventions = [i.get("name", "") for i in interv.get("interventions", [])[:5]]
    interv_str = " | ".join(filter(None, interventions))

    collaborators = [c.get("name", "") for c in sponsor_mod.get("collaborators", [])[:3]]
    collab_str = " | ".join(filter(None, collaborators))

    lead = sponsor_mod.get("leadSponsor", {})

    return {
        "brief_title":            ident.get("briefTitle", ""),
        "official_title":         ident.get("officialTitle", ""),
        "overall_status":         status.get("overallStatus", ""),
        "study_type":             design.get("studyType", ""),
        "phase":                  phase_str,
        "conditions":             cond_str,
        "interventions":          interv_str,
        "lead_sponsor":           lead.get("name", ""),
        "lead_sponsor_class":     lead.get("class", ""),
        "collaborators":          collab_str,
        "last_update_posted_date": status.get("lastUpdatePostDateStruct", {}).get("date", ""),
        "start_date":             status.get("startDateStruct", {}).get("date", ""),
        "primary_completion_date": status.get("primaryCompletionDateStruct", {}).get("date", ""),
        "completion_date_ct":     status.get("completionDateStruct", {}).get("date", ""),
    }


def load_existing_keys(csv_path: str) -> set[tuple[str, str]]:
    """Carica le coppie (ticker, nct_id) già presenti nel CSV."""
    keys: set[tuple[str, str]] = set()
    if not os.path.isfile(csv_path):
        return keys
    with open(csv_path, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            tk  = row.get("ticker", "").strip().upper()
            nct = row.get("nct_id", "").strip().upper()
            if tk and nct:
                keys.add((tk, nct))
    return keys


def main() -> int:
    existing = load_existing_keys(CSV_PATH)
    print(f"[clinical] CSV esistente: {len(existing)} coppie (ticker, nct_id)")

    # Leggi header del CSV corrente
    with open(CSV_PATH, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []

    new_rows: list[dict] = []

    for entry in MISSING:
        tk  = entry["ticker"].upper()
        nct = entry["nct"].upper()
        key = (tk, nct)

        if key in existing:
            print(f"  [SKIP] {tk} / {nct} già presente")
            continue

        print(f"  [FETCH] {tk} / {nct} …", end=" ", flush=True)
        ct = fetch_ct_study(nct)

        # La completion_date che usiamo è quella della tabella Simulation
        # (garantisce il match con clinicalRowMatchesCatalyst)
        completion_date = entry["cd"]

        # Preferisci phase dalla API se disponibile, altrimenti usa quella della sim
        phase = ct.get("phase") or entry["phase"]

        row: dict[str, str] = {f: "" for f in fieldnames}
        row.update({
            "source":                  "clinicaltrials",
            "query_company":           entry["company"],
            "nct_id":                  nct,
            "brief_title":             ct.get("brief_title", ""),
            "official_title":          ct.get("official_title", ""),
            "overall_status":          ct.get("overall_status", ""),
            "study_type":              ct.get("study_type", ""),
            "phase":                   phase,
            "conditions":              ct.get("conditions", ""),
            "interventions":           ct.get("interventions", ""),
            "lead_sponsor":            ct.get("lead_sponsor") or entry["sponsor"],
            "lead_sponsor_class":      ct.get("lead_sponsor_class", ""),
            "responsible_party_type":  "",
            "responsible_party_org":   "",
            "collaborators":           ct.get("collaborators", ""),
            "last_update_posted_date": ct.get("last_update_posted_date", ""),
            "start_date":              ct.get("start_date", ""),
            "primary_completion_date": ct.get("primary_completion_date", ""),
            "completion_date":         completion_date,   # ← CD della sim table
            "ticker":                  tk,
            "company_match":           "sim_table_nct",
            "sponsor_match":           entry["sponsor_rel"],
        })

        new_rows.append(row)
        brief = ct.get("brief_title", "—")[:60]
        print(f"OK  [{ct.get('overall_status','?')}]  {brief}")

    if not new_rows:
        print("[clinical] Nessuna riga nuova da aggiungere.")
        return 0

    # Appendi al CSV
    with open(CSV_PATH, "a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        for row in new_rows:
            writer.writerow(row)

    print(f"\n[clinical] Aggiunte {len(new_rows)} righe a {CSV_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
