/**
 * US epidemiology snippets for Product Summary indication bullets.
 * Prefer trial disease_soc when present; else curated SEER / ACS-class ranges.
 * Display only — not Soft BUY/SELL.
 */
export type IndicationEpiStats = {
  usaPrevalence: string | null;
  /** 5-year relative survival (or clear stage-specific note). */
  fiveYearSurvival: string | null;
  /** Median OS / prognosis on SoC when 5y relative is not the right frame. */
  lifeExpectancy: string | null;
  source: string | null;
};

type EpiRule = {
  /** Match against normalized indication text. */
  re: RegExp;
  usaPrevalence: string;
  fiveYearSurvival: string;
  lifeExpectancy?: string;
  source: string;
};

/**
 * Curated public-stat ranges (SEER Stat Facts / ACS). Keep wording approximate
 * and cite the class of source — numbers move with each SEER release.
 */
const EPI_RULES: EpiRule[] = [
  {
    re: /\b(hnscc|head\s*(and|&)\s*neck\s*(squamous\s*)?(cell\s*)?(carcinoma|cancer)|oral\s+cavity\s*(and|&)\s*pharynx|oropharyn|hypopharyn|laryn(x|geal)\s+scc)\b/i,
    usaPrevalence:
      "~461k living with oral cavity & pharynx cancer (SEER 2023; closest HNSCC proxy)",
    fiveYearSurvival:
      "~70% 5-year relative (all stages, SEER 2016–2022); distant ~26%",
    lifeExpectancy:
      "Stage-dependent: localized ~89% 5y relative vs distant ~26% (oral cavity/pharynx)",
    source: "SEER Cancer Stat Facts — Oral Cavity & Pharynx",
  },
  {
    re: /\b(nsclc|non[-\s]?small\s*cell\s*lung|lung\s+adenocarcinoma)\b/i,
    usaPrevalence:
      "~654k living with lung & bronchus cancer (SEER 2022); NSCLC ~80–85% of lung ca",
    fiveYearSurvival:
      "~27% 5-year relative lung & bronchus all stages; localized ~65%, distant ~9%",
    lifeExpectancy: "Metastatic NSCLC median OS often ~1–2y on modern SoC (regimen-dependent)",
    source: "SEER Cancer Stat Facts — Lung & Bronchus",
  },
  {
    re: /\b(sclc|small\s*cell\s*lung)\b/i,
    usaPrevalence: "SCLC ~10–15% of US lung cancers (~20–30k new cases/yr)",
    fiveYearSurvival: "~8–12% 5-year relative overall; extensive-stage typically <5–10%",
    lifeExpectancy: "Extensive-stage median OS often ~10–13 months on current SoC",
    source: "SEER / ACS lung cancer subsets",
  },
  {
    re: /\b(tnbc|triple[-\s]?negative\s*breast|breast\s+cancer)\b/i,
    usaPrevalence: "~4.1M women living with breast cancer (SEER 2022)",
    fiveYearSurvival: "~91% 5-year relative (female breast, all stages); distant ~31%",
    source: "SEER Cancer Stat Facts — Female Breast",
  },
  {
    re: /\b(ovarian|fallopian|primary\s+peritoneal)\b/i,
    usaPrevalence: "~236k living with ovarian cancer (SEER 2022)",
    fiveYearSurvival: "~51% 5-year relative all stages; distant ~31%",
    lifeExpectancy: "Platinum-resistant recurrent median OS often ~12 months classically",
    source: "SEER Cancer Stat Facts — Ovary",
  },
  {
    re: /\b(pancreatic|pdac)\b/i,
    usaPrevalence: "~95k living with pancreatic cancer (SEER 2022)",
    fiveYearSurvival: "~13% 5-year relative all stages; distant ~3%",
    lifeExpectancy: "Metastatic median OS often ~6–12 months on SoC",
    source: "SEER Cancer Stat Facts — Pancreas",
  },
  {
    re: /\b(colorectal|crc|colon\s+cancer|rectal\s+cancer)\b/i,
    usaPrevalence: "~1.4M living with colorectal cancer (SEER 2022)",
    fiveYearSurvival: "~65% 5-year relative all stages; distant ~13%",
    source: "SEER Cancer Stat Facts — Colon & Rectum",
  },
  {
    re: /\b(melanoma)\b/i,
    usaPrevalence: "~1.4M living with melanoma of the skin (SEER 2022)",
    fiveYearSurvival: "~94% 5-year relative all stages; distant ~35%",
    source: "SEER Cancer Stat Facts — Melanoma of the Skin",
  },
  {
    re: /\b(prostate)\b/i,
    usaPrevalence: "~3.5M living with prostate cancer (SEER 2022)",
    fiveYearSurvival: "~97% 5-year relative all stages; distant ~34%",
    source: "SEER Cancer Stat Facts — Prostate",
  },
  {
    re: /\b(renal\s+cell|kidney\s+cancer|rcc)\b/i,
    usaPrevalence: "~630k living with kidney & renal pelvis cancer (SEER 2022)",
    fiveYearSurvival: "~78% 5-year relative all stages; distant ~18%",
    source: "SEER Cancer Stat Facts — Kidney & Renal Pelvis",
  },
  {
    re: /\b(urothelial|bladder\s+cancer)\b/i,
    usaPrevalence: "~700k+ living with bladder cancer (SEER-class estimate)",
    fiveYearSurvival: "~78% 5-year relative all stages; distant ~8%",
    source: "SEER Cancer Stat Facts — Urinary Bladder",
  },
  {
    re: /\b(hepatocellular|hcc|liver\s+cancer)\b/i,
    usaPrevalence: "~105k living with liver & IBD cancer (SEER 2022)",
    fiveYearSurvival: "~22% 5-year relative all stages; distant ~3%",
    source: "SEER Cancer Stat Facts — Liver & Intrahepatic Bile Duct",
  },
  {
    re: /\b(gastric|stomach\s+cancer)\b/i,
    usaPrevalence: "~120k living with stomach cancer (SEER 2022)",
    fiveYearSurvival: "~36% 5-year relative all stages; distant ~7%",
    source: "SEER Cancer Stat Facts — Stomach",
  },
  {
    re: /\b(esophageal|oesophageal)\b/i,
    usaPrevalence: "~50k living with esophageal cancer (SEER 2022)",
    fiveYearSurvival: "~22% 5-year relative all stages; distant ~6%",
    source: "SEER Cancer Stat Facts — Esophagus",
  },
  {
    re: /\b(glioblastoma|gbm|glioma)\b/i,
    usaPrevalence: "GBM ~15k new US cases/yr; prevalence low (short survival)",
    fiveYearSurvival: "GBM 5-year survival typically ~5–7%",
    lifeExpectancy: "Newly diagnosed GBM median OS often ~12–18 months on SoC",
    source: "ACS / CBTRUS-class published ranges",
  },
  {
    re: /\b(aml|acute\s+myeloid\s+leukemia)\b/i,
    usaPrevalence: "~70k living with AML (SEER-class)",
    fiveYearSurvival: "~32% 5-year relative (all ages; age-dependent)",
    source: "SEER Cancer Stat Facts — Acute Myeloid Leukemia",
  },
  {
    re: /\b(mm\b|multiple\s+myeloma)\b/i,
    usaPrevalence: "~180k living with myeloma (SEER 2022)",
    fiveYearSurvival: "~61% 5-year relative",
    source: "SEER Cancer Stat Facts — Myeloma",
  },
  {
    re: /\b(molluscum(\s+contagiosum)?)\b/i,
    usaPrevalence:
      "~5–11% of US children under 15 affected at some point (common pediatric skin infection; not a SEER cancer)",
    fiveYearSurvival: "Self-limited viral infection — survival not applicable",
    lifeExpectancy: "Usually resolves spontaneously over months to a few years",
    source: "Pediatric dermatology / CDC-class molluscum estimates",
  },
  {
    // Keep after specific solid tumors — catch-all CT.gov basket terms.
    re: /\b(metastatic\s+solid\s+tumou?rs?|advanced\s+solid\s+tumou?rs?|solid\s+tumou?rs?\b|solid\s+malignanc)/i,
    usaPrevalence:
      "Umbrella CT.gov term — not one disease. All-sites US cancer prevalence ~18M living (ACS/SEER class)",
    fiveYearSurvival:
      "All-sites ~69% 5-year relative (all stages); metastatic solid tumors are site-specific and usually much lower",
    lifeExpectancy:
      "Prognosis driven by primary site + line of therapy — use the named tumor when available",
    source: "ACS Cancer Facts & Figures / SEER all-sites (basket caveat)",
  },
];

function clean(s: string | null | undefined): string | null {
  const t = String(s ?? "").trim();
  if (!t || /^n\/?d\.?$/i.test(t) || t === "—") return null;
  return t;
}

function emptyStats(): IndicationEpiStats {
  return {
    usaPrevalence: null,
    fiveYearSurvival: null,
    lifeExpectancy: null,
    source: null,
  };
}

/** Match curated SEER/ACS-class ranges for a free-text indication. */
export function lookupIndicationEpidemiology(
  indication: string | null | undefined,
): IndicationEpiStats {
  const raw = clean(indication);
  if (!raw) return emptyStats();
  for (const rule of EPI_RULES) {
    if (rule.re.test(raw)) {
      return {
        usaPrevalence: rule.usaPrevalence,
        fiveYearSurvival: rule.fiveYearSurvival,
        lifeExpectancy: rule.lifeExpectancy ?? null,
        source: rule.source,
      };
    }
  }
  return emptyStats();
}

function diseaseNamesOverlap(a: string, b: string): boolean {
  const na = a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const nb = b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  const wa = new Set(na.split(/\s+/).filter((w) => w.length > 3));
  const wb = nb.split(/\s+/).filter((w) => w.length > 3);
  if (!wa.size || !wb.length) return false;
  const hit = wb.filter((w) => wa.has(w)).length;
  return hit >= Math.min(2, wb.length);
}

export type DiseaseSocEpiInput = {
  disease?: string | null;
  usa_prevalence?: string | null;
  life_expectancy?: string | null;
  five_year_survival?: string | null;
  source_note?: string | null;
};

/**
 * Merge curated epi with trial disease_soc (and optional product-level prevalence)
 * when the disease label matches this indication bullet.
 */
export function resolveIndicationEpidemiology(
  indication: string,
  opts?: {
    diseaseSocs?: DiseaseSocEpiInput[] | null;
    briefingPrevalence?: string | null;
    briefingIndication?: string | null;
  },
): IndicationEpiStats {
  const curated = lookupIndicationEpidemiology(indication);
  let usaPrevalence = curated.usaPrevalence;
  let fiveYearSurvival = curated.fiveYearSurvival;
  let lifeExpectancy = curated.lifeExpectancy;
  let source = curated.source;

  for (const soc of opts?.diseaseSocs ?? []) {
    const disease = clean(soc.disease);
    if (!disease || !diseaseNamesOverlap(indication, disease)) continue;
    usaPrevalence = clean(soc.usa_prevalence) || usaPrevalence;
    fiveYearSurvival = clean(soc.five_year_survival) || fiveYearSurvival;
    lifeExpectancy = clean(soc.life_expectancy) || lifeExpectancy;
    source = clean(soc.source_note) || source || "Trial disease SoC extract";
  }

  const briefInd = clean(opts?.briefingIndication);
  const briefPrev = clean(opts?.briefingPrevalence);
  if (
    briefPrev &&
    (!usaPrevalence ||
      (briefInd && diseaseNamesOverlap(indication, briefInd)))
  ) {
    if (!usaPrevalence || (briefInd && diseaseNamesOverlap(indication, briefInd))) {
      usaPrevalence = usaPrevalence || briefPrev;
      if (briefInd && diseaseNamesOverlap(indication, briefInd)) {
        usaPrevalence = briefPrev;
        source = source || "Product briefing";
      }
    }
  }

  return { usaPrevalence, fiveYearSurvival, lifeExpectancy, source };
}

export type ProductIndicationRow = {
  label: string;
  epi: IndicationEpiStats;
};

export function buildProductIndicationRows(
  labels: string[],
  opts?: {
    diseaseSocs?: DiseaseSocEpiInput[] | null;
    briefingPrevalence?: string | null;
    briefingIndication?: string | null;
  },
): ProductIndicationRow[] {
  return labels.map((label) => ({
    label,
    epi: resolveIndicationEpidemiology(label, opts),
  }));
}
