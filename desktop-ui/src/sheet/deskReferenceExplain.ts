/**
 * Decision-desk reference windows — extract of the identified print, plus source.
 * Display only. Does not change deriveSuggestedAction / Soft BUY-SELL.
 */
import {
  edgarBrowseUrl,
  formatSilentMoneyTitle,
  isGenericSecItemTitle,
  type SmartMoneyEvent,
} from "./deskSmartMoney";
import {
  formatDeskEventDays,
  deskEventTypeShort,
  type DeskCalendarEvent,
  type DeskCalendarSource,
} from "./deskCalendarEvents";
import {
  clinicalDrugFromSimRow,
  clinicalNctFromSimRow,
  clinicalPhaseFromSimRow,
  clinicalStudyHrefFromSimRow,
  clinicalStudyTitleFromSimRow,
  usableProductName,
} from "./simRowClinicalMeta";
import { clinicalStudyMetaForDesk } from "./tickerEisSummary";
import { nctClinicalTrialsUrl } from "./cellLinks";
import type { ClinicalPreCdRecord } from "../api/supernova";
import {
  FDA_ADCOM_MATERIALS_URL,
  fdaBriefingFileAvailable,
  formatFdaScore,
  type FdaAdcomRow,
} from "./fdaAdcomCalendar";

export type DeskRefSection = {
  id: string;
  title: string;
  body: string[];
};

/** Structured Catalyst Event fields (type / product / study / phase / link). */
export type DeskReferenceField = {
  id: string;
  label: string;
  value: string;
  href?: string | null;
};

export type DeskReferenceDoc = {
  kicker: string;
  title: string;
  meta: string;
  href: string | null;
  hrefLabel: string;
  highlightId: string;
  sections: DeskRefSection[];
  fields?: DeskReferenceField[];
  /** Context for live CT.gov fill when study/link are empty. */
  ctgovEnrich?: {
    ticker: string;
    company?: string | null;
    eventDate?: string | null;
  } | null;
};

export function silentTopicId(kind: string | null | undefined): string {
  const k = String(kind ?? "").toLowerCase();
  if (k === "form4") return "form4";
  if (k === "13d" || k === "13g" || k === "13f") return "ownership";
  if (k === "call_skew") return "options";
  if (k === "short_cover") return "short";
  if (k === "cdmo") return "cdmo";
  if (
    k === "ceo_appointed" ||
    k === "cmo_appointed" ||
    k === "officer_appointed"
  ) {
    return "officer";
  }
  return "form4";
}

function fallbackSilentHref(ev: SmartMoneyEvent, ticker: string): {
  href: string | null;
  hrefLabel: string;
} {
  if (ev.href?.trim()) {
    return { href: ev.href.trim(), hrefLabel: ev.href_label?.trim() || "SEC" };
  }
  const tk = ticker.trim().toUpperCase();
  const k = String(ev.kind ?? "");
  if (k === "form4" && tk) return { href: edgarBrowseUrl(tk, "4"), hrefLabel: "SEC" };
  if (k === "13d" && tk) return { href: edgarBrowseUrl(tk, "SC 13D"), hrefLabel: "SEC" };
  if (k === "13f" && tk) return { href: edgarBrowseUrl(tk, "13F-HR"), hrefLabel: "SEC" };
  if (k === "short_cover") {
    return {
      href: "https://www.finra.org/finra-data/browse-catalog/equity-short-interest/current",
      hrefLabel: "FINRA",
    };
  }
  if (
    (k === "ceo_appointed" ||
      k === "cmo_appointed" ||
      k === "officer_appointed" ||
      k === "cdmo") &&
    tk
  ) {
    return { href: edgarBrowseUrl(tk, "8-K"), hrefLabel: "8-K" };
  }
  return { href: null, hrefLabel: "" };
}

function storyDate(iso: string | null | undefined, it: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  if (!m) return it ? "data non indicata" : "date not given";
  const monthsIt = [
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
  ];
  const monthsEn = [
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
  ];
  const month = Number(m[2]) - 1;
  return it
    ? `${Number(m[3])} ${monthsIt[month] ?? m[2]} ${m[1]}`
    : `${monthsEn[month] ?? m[2]} ${Number(m[3])}, ${m[1]}`;
}

function cleanDetail(raw: string | null | undefined): string {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!s || isGenericSecItemTitle(s)) return "";
  return s;
}

function silentExtract(ev: SmartMoneyEvent, ticker: string, it: boolean): string[] {
  const tk = ticker.trim().toUpperCase();
  const when = storyDate(ev.date, it);
  const kind = String(ev.kind ?? "");
  const who = String(ev.who ?? "").trim();
  const extra = cleanDetail(ev.detail);
  const left = /left|uscita|lasciat|resign|depart/i.test(`${ev.label} ${extra}`);

  if (kind === "form4") {
    const whoBit = /CMO/i.test(ev.label)
      ? it
        ? "il CMO"
        : "the CMO"
      : /CEO/i.test(ev.label)
        ? it
          ? "il CEO"
          : "the CEO"
        : it
          ? "un insider"
          : "an insider";
    const cluster = /cluster/i.test(ev.label);
    return [
      it
        ? `${when}: ${cluster ? `più insider, tra cui ${whoBit}, hanno` : `${whoBit} ha`} comprato azioni di ${tk}.`
        : `${when}: ${cluster ? `several insiders, including ${whoBit}, bought` : `${whoBit} bought`} ${tk} shares.`,
    ];
  }
  if (kind === "13d") {
    return [
      it
        ? `${when}: un nuovo azionista sopra il 5% ha dichiarato la posizione su ${tk}.`
        : `${when}: a new holder above 5% disclosed a position in ${tk}.`,
    ];
  }
  if (kind === "13f") {
    const fund = ev.label.replace(/\s+(accumulated|ha accumulato)$/i, "").trim();
    const named = fund && !/^specialist|^13f|^fondi/i.test(fund) ? fund : "";
    const pct = extra.includes("%") ? extra : "";
    return [
      it
        ? `${when}: ${named ? `${named} ha` : "un fondo biotech ha"} aumentato la posizione su ${tk}${pct ? ` (${pct})` : ""}.`
        : `${when}: ${named ? named : "a specialist biotech fund"} increased its ${tk} position${pct ? ` (${pct})` : ""}.`,
    ];
  }
  if (kind === "call_skew") {
    return [
      it
        ? `${when}: su ${tk} sono aumentate le scommesse sulle call (opzioni).`
        : `${when}: call bets on ${tk} increased (options).`,
    ];
  }
  if (kind === "short_cover") {
    return [
      it
        ? `${when}: gli short su ${tk} si stanno coprendo${extra ? ` (${extra})` : ""}.`
        : `${when}: shorts on ${tk} are covering${extra ? ` (${extra})` : ""}.`,
    ];
  }
  if (kind === "cdmo") {
    return [
      it
        ? `${when}: ${tk} ha scelto un nuovo produttore (CDMO)${extra ? ` — ${extra}` : ""}.`
        : `${when}: ${tk} chose a new manufacturer (CDMO)${extra ? ` — ${extra}` : ""}.`,
    ];
  }
  if (
    kind === "ceo_appointed" ||
    kind === "cmo_appointed" ||
    kind === "officer_appointed"
  ) {
    const role =
      kind === "ceo_appointed" ? "CEO" : kind === "cmo_appointed" ? "CMO" : it ? "dirigente" : "officer";
    if (who && left) {
      return [
        it
          ? `${when}: ${who} ha lasciato il ruolo di ${role} in ${tk}.`
          : `${when}: ${who} left the ${role} role at ${tk}.`,
      ];
    }
    if (who) {
      return [
        it
          ? `${when}: ${tk} ha nominato ${who} come ${role}.`
          : `${when}: ${tk} appointed ${who} as ${role}.`,
      ];
    }
    if (left) {
      return [
        it
          ? `${when}: un ${role} di ${tk} ha lasciato. Il nome non è nel riassunto che abbiamo.`
          : `${when}: a ${role} left ${tk}. The name is not in the summary we have.`,
      ];
    }
    return [
      it
        ? `${when}: ${tk} ha un nuovo ${role} (nomina o cambio). Il nome non è nel riassunto che abbiamo — aprilo dalla fonte.`
        : `${when}: ${tk} has a new ${role} (appointment or change). The name is not in the summary we have — open the source.`,
    ];
  }
  const title = formatSilentMoneyTitle(ev, it) || ev.label;
  return extra
    ? [`${when}: ${title}. ${extra}`]
    : [`${when}: ${title}.`];
}

export function silentMoneyReferenceDoc(
  ev: SmartMoneyEvent,
  ticker: string,
  it: boolean,
  _traces?: SmartMoneyEvent[] | null,
): DeskReferenceDoc {
  const highlightId = silentTopicId(ev.kind);
  const src = fallbackSilentHref(ev, ticker);
  const headline = formatSilentMoneyTitle(ev, it) || ev.label;
  return {
    kicker: it ? "Silent money" : "Silent money",
    title: `${ticker.trim().toUpperCase()} · ${headline}`,
    meta: storyDate(ev.date, it),
    href: src.href,
    hrefLabel: src.hrefLabel || (it ? "Apri la fonte" : "Open source"),
    highlightId,
    sections: [
      {
        id: highlightId,
        title: it ? "Cosa è successo" : "What happened",
        body: silentExtract(ev, ticker, it),
      },
    ],
  };
}

function sourceLabel(source: DeskCalendarSource, it: boolean): string {
  // sim_cd omitted from Source line — sheet provenance is internal chrome.
  if (source === "sim_cd") return "";
  if (source === "guidance") return it ? "guidance / calendario FDA" : "guidance / FDA calendar";
  if (source === "congress") return it ? "calendario congresso" : "congress calendar";
  if (source === "hypothesis") return it ? "ipotesi in attesa" : "pending hypothesis";
  if (source === "soft_buy") return it ? "Soft BUY (senza catalyst ≤10g)" : "Soft BUY (no ≤10d catalyst)";
  if (source === "g_trends") {
    return it ? "spike G-Trends >80%" : "G-Trends spike >80%";
  }
  return it ? "feed clinico" : "clinical feed";
}

function formatEventDateLong(iso: string, it: boolean): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return it ? `${m[3]}/${m[2]}/${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`;
}

function eventTypeDeep(type: string, it: boolean): string {
  if (type === "pdufa") {
    return it
      ? "PDUFA: data in cui la FDA dovrebbe decidere su un farmaco già depositato (approvazione, rinvio o rifiuto)."
      : "PDUFA: the date FDA is expected to decide on a filed drug (approval, delay, or rejection).";
  }
  if (type === "readout") {
    return it
      ? "Readout: pubblicazione o presentazione dei risultati del trial (comunicato, 8-K o congresso)."
      : "Readout: publication or presentation of trial results (press release, 8-K, or congress).";
  }
  if (type === "submission") {
    return it
      ? "Deposito: la società ha inviato (o sta per inviare) NDA/BLA alla FDA. Non è ancora una decisione."
      : "Submission: the company filed (or is about to file) an NDA/BLA with FDA. Not a decision yet.";
  }
  if (type === "approval") {
    return it
      ? "Approvazione: il farmaco è stato approvato, o la società guida una data di approvazione."
      : "Approval: the drug was approved, or the company is guiding an approval date.";
  }
  if (type === "conference_abstract") {
    return it
      ? "Congresso / abstract: data di invio abstract o di meeting. L’abstract può muovere il titolo prima della presentazione in sala."
      : "Congress / abstract: abstract-drop or meeting date. The abstract can move the stock before the hall session.";
  }
  if (type === "trial_study_completion") {
    return it
      ? "Fine studio: chiusura completa dopo la primary completion. Può arrivare mesi dopo i dati principali."
      : "Study completion: full close after primary completion. Can land months after the main data.";
  }
  if (type === "trial_primary_completion" || type === "cd") {
    return it
      ? "Completion Day: finestra di primary completion dello studio (dati primari attesi). Non è automaticamente un giorno di trading."
      : "Completion Day: primary completion window for the study (when primary data are expected). Not automatically a trading day.";
  }
  return it
    ? "Evento catalyst: vedi tipo e fonte sotto. Non è Soft BUY/SELL."
    : "Catalyst event: see type and source below. Not Soft BUY/SELL.";
}

function fullEventName(row: DeskCalendarEvent): string {
  const name = String(row.eventName ?? "").replace(/\s+/g, " ").trim();
  const title = String(row.eventTitle ?? "").replace(/\s+/g, " ").trim();
  if (name && title && !name.includes(title.replace(/…$/, ""))) {
    return `${title} · ${name}`;
  }
  return name || title || row.typeLabel || row.eventType;
}

function eventExtract(row: DeskCalendarEvent, it: boolean): string[] {
  const when = formatEventDateLong(row.eventDate, it);
  const days = formatDeskEventDays(row.daysUntil, it);
  const full = fullEventName(row);
  const firm = row.dateType === "actual"
    ? it
      ? "indicata come ufficiale / calendarizzata"
      : "marked official / calendared"
    : it
      ? "stimata (non un giorno di trading certo)"
      : "estimated (not a certain trading day)";
  const typeName = row.typeLabel || row.eventType;
  const srcBits: string[] = [];
  const srcName = sourceLabel(row.source, it);
  if (srcName) srcBits.push(srcName);
  if (row.referenceLabel) {
    srcBits.push(it ? `pagina ${row.referenceLabel}` : `${row.referenceLabel} page`);
  }
  if (row.referenceHref) srcBits.push(row.referenceHref);
  const out: string[] = [
    it
      ? `Evento: ${full}.`
      : `Event: ${full}.`,
    it
      ? `Titolo: ${row.ticker}. Data: ${when} (${days}). La data è ${firm}.`
      : `Ticker: ${row.ticker}. Date: ${when} (${days}). The date is ${firm}.`,
    it
      ? `Tipo di evento: ${typeName}. ${eventTypeDeep(row.eventType, it)}`
      : `Event type: ${typeName}. ${eventTypeDeep(row.eventType, it)}`,
  ];
  if (srcBits.length) {
    out.push(it ? `Source: ${srcBits.join(" · ")}.` : `Source: ${srcBits.join(" · ")}.`);
  }
  const quote = String(row.sourceQuote ?? "").replace(/\s+/g, " ").trim();
  if (quote && quote !== full) {
    out.push(it ? `Testo originale: ${quote}` : `Original text: ${quote}`);
  }
  if (row.congressName) {
    out.push(
      it
        ? `Congresso: ${row.congressName}.`
        : `Congress: ${row.congressName}.`,
    );
  }
  if (row.inBook) {
    out.push(
      it
        ? "Il titolo è già nel libro di questa sessione."
        : "This name is already in this session’s book.",
    );
  }
  return out;
}

function isCdLikeLabel(raw: string | null | undefined): boolean {
  const s = String(raw ?? "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return false;
  return /^(cd|primary\s*cd|completion\s*day|primary\s*completion(\s*day)?|trial_primary_completion)$/i.test(
    s,
  );
}

function completionDayLabel(it: boolean): string {
  return it ? "Completion Day" : "Completion Day";
}

function catalystTypeDisplay(row: DeskCalendarEvent, it: boolean): string {
  const kind = String(row.sourceKind ?? "").toLowerCase();
  if (kind === "fda_safety") return "FDA safety";
  if (kind === "fda_vote") return it ? "FDA AdCom / voto" : "FDA AdCom / vote";
  if (
    row.eventType === "trial_primary_completion" ||
    row.eventType === "cd" ||
    isCdLikeLabel(row.typeLabel) ||
    isCdLikeLabel(row.eventTitle) ||
    isCdLikeLabel(row.eventName)
  ) {
    return completionDayLabel(it);
  }
  let typeName = row.typeLabel || "";
  if (!typeName || /^other$/i.test(typeName) || isCdLikeLabel(typeName)) {
    const short = deskEventTypeShort(row, it);
    if (short === "CD" || isCdLikeLabel(short)) return completionDayLabel(it);
    typeName = short;
  }
  return typeName || "—";
}

function cleanProductCandidate(raw: string | null | undefined): string {
  const s = String(raw ?? "")
    .replace(/\s*[·|].*$/, "")
    .replace(/\s*fda[_\s-]?safety\s*$/i, "")
    .trim();
  if (!s || isCdLikeLabel(s) || /^—$/.test(s)) return "";
  return usableProductName(s);
}

export function eventReferenceDoc(
  row: DeskCalendarEvent,
  it: boolean,
  /** Deep Dive / Simulation sheet row — preferred source for product, study, phase, NCT link. */
  simRow?: Record<string, unknown> | null,
  /** Clinical pre-CD snapshot — fills study/phase/NCT when Simulation is sparse. */
  clinicalRecords?: ClinicalPreCdRecord[] | null,
  /** Company name for live CT.gov sponsor search when study is missing. */
  companyFallback?: string | null,
  /** FDA AdCom row for this ticker/date — briefing link + summary live here (not in FDA Brief column). */
  fdaHit?: FdaAdcomRow | null,
): DeskReferenceDoc {
  const highlightId = "details";
  const typeName = catalystTypeDisplay(row, it);
  const fromSimDrug = clinicalDrugFromSimRow(simRow ?? undefined);
  const fromSimStudy = clinicalStudyTitleFromSimRow(simRow ?? undefined);
  const fromSimPhase = clinicalPhaseFromSimRow(simRow ?? undefined);
  const fromSimNct = clinicalNctFromSimRow(simRow ?? undefined);
  const fromSimHref = clinicalStudyHrefFromSimRow(simRow ?? undefined);
  const fromClinical = clinicalStudyMetaForDesk(row.ticker, clinicalRecords, {
    cd: row.eventDate || row.rowKey?.split("|")[1],
    drugHint:
      cleanProductCandidate(row.product) ||
      cleanProductCandidate(fromSimDrug) ||
      null,
  });

  const product =
    cleanProductCandidate(row.product) ||
    cleanProductCandidate(fromSimDrug) ||
    cleanProductCandidate(row.eventTitle) ||
    "—";

  const clinicalNct = fromClinical?.nctId ?? null;
  const nct = fromSimNct || clinicalNct;

  let study =
    String(row.studyTitle || "").trim() ||
    fromSimStudy ||
    fromClinical?.studyTitle ||
    "";
  if (nct && study && !study.toUpperCase().includes(nct)) {
    study = `${study} · ${nct}`;
  } else if (!study && nct) {
    study = nct;
  }
  if (!study) study = "—";

  let phase =
    String(row.studyPhase || "").trim() ||
    fromSimPhase ||
    fromClinical?.studyPhase ||
    "";
  const kind = String(row.sourceKind ?? "").toLowerCase();
  if (!phase && kind === "fda_safety") {
    phase = it ? "Post-market / safety review" : "Post-market / safety review";
  }
  if (!phase) phase = "—";
  if (phase && !/^phase\b/i.test(phase)) {
    const compact = phase.replace(/\s+/g, "");
    if (/^phase\d/i.test(compact) || /^fase\d/i.test(compact)) {
      phase = phase.replace(/^(phase|fase)\s*/i, "Phase ");
    } else if (/^\d/.test(phase)) {
      phase = `Phase ${phase}`;
    } else if (/^PHASE/i.test(phase)) {
      phase = phase.replace(/^PHASE\s*/i, "Phase ");
    }
  }
  // PHASE3 → Phase 3
  phase = phase.replace(/^(Phase)\s*(\d)/i, "Phase $2");

  // Prefer real CT.gov / Link studio from Deep Dive; then clinical; then desk referenceHref.
  const detailHref =
    fromSimHref?.trim() ||
    fromClinical?.studyHref?.trim() ||
    row.studyHref?.trim() ||
    row.referenceHref?.trim() ||
    (nct ? nctClinicalTrialsUrl(nct) : null) ||
    null;
  const studyHref =
    (study !== "—"
      ? fromSimHref || fromClinical?.studyHref || row.studyHref?.trim() || null
      : null) || (nct ? nctClinicalTrialsUrl(nct) : null);

  const headlineParts = [typeName];
  if (product !== "—") headlineParts.push(product);
  else if (!isCdLikeLabel(row.eventName) && String(row.eventName || "").trim()) {
    headlineParts.push(String(row.eventName).trim());
  }
  const headline = headlineParts.join(" · ");

  const linkLabel = detailHref
    ? /clinicaltrials\.gov/i.test(detailHref)
      ? nct
        ? `CT.gov · ${nct}`
        : "CT.gov"
      : detailHref.replace(/^https?:\/\//i, "").slice(0, 64)
    : it
      ? "Non disponibile"
      : "Not available";

  const fields: DeskReferenceField[] = [
    {
      id: "type",
      label: it ? "Tipo di catalyst" : "Catalyst type",
      value: typeName || "—",
    },
    {
      id: "product",
      label: it ? "Prodotto" : "Product",
      value: product,
    },
    {
      id: "study",
      label: it ? "Studio clinico associato" : "Associated clinical study",
      value: study,
      href: study !== "—" ? studyHref : null,
    },
    {
      id: "phase",
      label: it ? "Fase di sviluppo" : "Development phase",
      value: phase,
    },
    {
      id: "link",
      label: it
        ? "Link dettaglio catalyst day"
        : "Catalyst day detail link",
      value: linkLabel,
      href: detailHref,
    },
  ];

  const brief = fdaHit?.briefing;
  const fdaFileOk = fdaBriefingFileAvailable(brief);
  const meetingHref = (fdaHit?.href || "").trim() || null;
  const materialsHref = (brief?.materialsUrl || "").trim() || null;
  const pdfHref = (brief?.pdfUrl || "").trim() || null;
  const briefingHref =
    pdfHref ||
    (materialsHref && materialsHref !== FDA_ADCOM_MATERIALS_URL
      ? materialsHref
      : null) ||
    meetingHref;
  if (fdaHit) {
    fields.push({
      id: "fda_briefing",
      label: it ? "Briefing FDA" : "FDA briefing",
      value: fdaFileOk
        ? scoreLabel(brief?.score, it)
        : it
          ? "Meeting AdCom (file non ancora pubblicato)"
          : "AdCom meeting (file not published yet)",
      href: briefingHref,
    });
  }

  const sections: DeskRefSection[] = [
    {
      id: "details",
      title: it ? "Note" : "Notes",
      body: eventExtract(
        {
          ...row,
          typeLabel: typeName,
          eventTitle: product !== "—" ? product : row.eventTitle,
          product: product !== "—" ? product : row.product,
          studyTitle: study !== "—" ? study : row.studyTitle,
          studyPhase: phase !== "—" ? phase : row.studyPhase,
          referenceHref: detailHref ?? row.referenceHref,
        },
        it,
      ),
    },
  ];

  if (fdaHit) {
    const summary = it
      ? brief?.summaryIt || brief?.summaryEn
      : brief?.summaryEn || brief?.summaryIt;
    const bullets = (it ? brief?.bulletsIt : brief?.bulletsEn) ?? [];
    const results = (it ? brief?.resultsIt : brief?.resultsEn) ?? [];
    const stats = (it ? brief?.statisticsIt : brief?.statisticsEn) ?? [];
    const conclusions =
      (it ? brief?.conclusionsIt : brief?.conclusionsEn) ?? [];
    const body: string[] = [];
    if (fdaHit.committee) {
      body.push(
        it
          ? `Comitato: ${fdaHit.committee}`
          : `Committee: ${fdaHit.committee}`,
      );
    }
    if (summary?.trim()) body.push(summary.trim());
    if (results.length) {
      body.push(it ? "Risultati:" : "Results:");
      for (const r of results.slice(0, 12)) {
        const t = String(r || "").trim();
        if (t) body.push(`• ${t}`);
      }
    }
    if (stats.length) {
      body.push(it ? "Statistiche:" : "Statistics:");
      for (const s of stats.slice(0, 12)) {
        const t = String(s || "").trim();
        if (t) body.push(`• ${t}`);
      }
    }
    if (conclusions.length) {
      body.push(it ? "Conclusioni:" : "Conclusions:");
      for (const c of conclusions.slice(0, 8)) {
        const t = String(c || "").trim();
        if (t) body.push(`• ${t}`);
      }
    }
    for (const b of bullets.slice(0, 6)) {
      const t = String(b || "").trim();
      if (t) body.push(`• ${t}`);
    }
    if (body.length <= 1) {
      body.push(
        it
          ? "Nessun summary briefing ancora — apri il link FDA sopra quando disponibile."
          : "No briefing summary yet — open the FDA link above when available.",
      );
    }
    sections.push({
      id: "fda_briefing",
      title: it ? "Briefing FDA (T−2)" : "FDA briefing (T−2)",
      body,
    });
  }

  return {
    kicker: it ? "Evento catalyst" : "Catalyst event",
    title: `${row.ticker} · ${headline}`,
    meta: [
      formatEventDateLong(row.eventDate, it),
      formatDeskEventDays(row.daysUntil, it),
      typeName,
    ]
      .filter(Boolean)
      .join(" · "),
    href: detailHref,
    hrefLabel:
      (detailHref && /clinicaltrials\.gov/i.test(detailHref)
        ? it
          ? "Apri referenza CT.gov"
          : "Open CT.gov reference"
        : row.referenceLabel?.trim()) ||
      (it ? "Apri referenza catalyst day" : "Open catalyst day reference"),
    highlightId,
    fields,
    sections,
    ctgovEnrich:
      study === "—" || !detailHref
        ? {
            ticker: row.ticker,
            company:
              companyFallback ||
              companyNameFromSimRowLoose(simRow) ||
              null,
            eventDate: row.eventDate,
          }
        : null,
  };
}

function scoreLabel(score: number | null | undefined, it: boolean): string {
  if (score != null && Number.isFinite(score)) {
    return it
      ? `File · score ${formatFdaScore(score)}`
      : `File · score ${formatFdaScore(score)}`;
  }
  return it ? "File briefing pubblicato" : "Published briefing file";
}

function companyNameFromSimRowLoose(
  simRow?: Record<string, unknown> | null,
): string {
  if (!simRow) return "";
  for (const k of ["Company", "company", "Nome", "Issuer"]) {
    const v = String(simRow[k] ?? "").trim();
    if (v && v !== "—") return v;
  }
  return "";
}

/** Merge a live CT.gov briefTitle / NCT into an already-open Catalyst Event doc. */
export function applyCtgovStudyToReferenceDoc(
  doc: DeskReferenceDoc,
  hit: {
    nctId: string;
    briefTitle: string;
    phase: string;
    href: string;
    approximate?: boolean;
  },
  it: boolean,
): DeskReferenceDoc {
  const title = String(hit.briefTitle ?? "").trim();
  const nct = String(hit.nctId ?? "")
    .trim()
    .toUpperCase();
  if (!title && !nct) return doc;
  let studyValue = title || nct;
  if (nct && title && !title.toUpperCase().includes(nct)) {
    studyValue = `${title} · ${nct}`;
  }
  if (hit.approximate) {
    studyValue = it
      ? `${studyValue} (studio CT.gov più vicino — CD stimata)`
      : `${studyValue} (nearest CT.gov study — CD estimated)`;
  }
  const phaseValue = String(hit.phase ?? "").trim();
  const href = hit.href || (nct ? nctClinicalTrialsUrl(nct) : null);
  const fields = (doc.fields ?? []).map((f) => {
    if (f.id === "study" && (f.value === "—" || !f.value)) {
      return { ...f, value: studyValue, href };
    }
    if (f.id === "phase" && (f.value === "—" || !f.value) && phaseValue) {
      return { ...f, value: phaseValue };
    }
    if (f.id === "link" && (!f.href || f.value === "Not available" || f.value === "Non disponibile")) {
      return {
        ...f,
        value: nct ? `CT.gov · ${nct}` : f.value,
        href,
      };
    }
    if (f.id === "product" && (f.value === "—" || isCdLikeLabel(f.value)) && title) {
      // Keep product empty of CD labels; don't overwrite with full study title.
      return f;
    }
    return f;
  });
  return {
    ...doc,
    fields,
    href: doc.href || href,
    hrefLabel:
      doc.href
        ? doc.hrefLabel
        : it
          ? "Apri referenza CT.gov"
          : "Open CT.gov reference",
    ctgovEnrich: null,
    title:
      /Primary CD|Completion Day · —/i.test(doc.title) && title
        ? doc.title.replace(/Primary CD|—\s*$/i, title.slice(0, 48))
        : doc.title,
  };
}
