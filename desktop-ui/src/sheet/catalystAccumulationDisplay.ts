import type { CatalystAccumulationRow } from "../api/supernova";

export type SilentMoneyCell = {
  label: string;
  sub?: string;
  tone: "up" | "down" | "flat" | "none";
  tip: string;
  href?: string;
};

export type GovFlagCell = {
  label: string;
  tone: "down" | "none" | "warn";
  tip: string;
};

function fmtUsd(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function fmtDate(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? "").slice(0, 10));
  return m ? `${m[3]}/${m[2]}` : "";
}

/** Desk-compact: 13D(/A) → Activist >5%, 13G(/A) → Inst. >5%. */
function abbreviateSchedule13DeskLabel(formOrLabel: string, it: boolean): string {
  const u = formOrLabel.toUpperCase();
  if (u.includes("13D") || /BENEFICIAL\s+OWNER/.test(u)) {
    return it ? "Attivista >5%" : "Activist >5%";
  }
  return it ? "Istituz. >5%" : "Inst. >5%";
}

function inferSchedule13Form(
  silentLabel: string | null | undefined,
  silentKind: string | null | undefined,
): string | null {
  const blob = `${silentLabel || ""} ${silentKind || ""}`.toUpperCase();
  if (blob.includes("13D")) return "13D";
  if (blob.includes("13G")) return "13G";
  if (silentKind === "13d") return "13D";
  if (silentKind === "13g") return "13G";
  return null;
}

/**
 * Strict Silent money: Form 4 officer buy or 13D/13G fund stake that moves
 * before the catalyst is public. Not Soft BUY/SELL.
 */
export function formatSilentMoneyCell(
  row: CatalystAccumulationRow | null | undefined,
  it: boolean,
  loading: boolean,
): SilentMoneyCell {
  if (loading && !row) {
    return {
      label: "…",
      tone: "none",
      tip: it ? "Caricamento insider…" : "Loading insider…",
    };
  }
  if (!row || (!row.silent_kind && !(row.buy_count_30d ?? 0) && !row.filing_13d)) {
    return {
      label: "—",
      tone: "none",
      tip: it
        ? "Nessun insider o fondo ha accumulato azioni di recente (Form 4 / 13D / 13G)."
        : "No recent insider or fund accumulation (Form 4 / 13D / 13G).",
    };
  }

  const date = fmtDate(row.silent_date || row.lead_date || row.date_13d);
  const kind = row.silent_kind || (row.filing_13d ? "13d" : "form4");

  if (kind === "form4" || (row.buy_count_30d ?? 0) > 0) {
    const role = row.lead_role || "officer";
    const label = row.silent_label
      ? row.silent_label
      : role === "CEO" || role === "CMO"
        ? row.cluster_buy
          ? it
            ? `${role}: cluster di acquisti`
            : `${role} cluster bought shares`
          : it
            ? `${role} ha acquistato azioni`
            : `${role} bought shares`
        : it
          ? "Insider hanno acquistato azioni"
          : "Insiders bought shares";
    const net = row.insider_net_buy_30d;
    const subParts = [
      date,
      net != null && net > 0 ? fmtUsd(net) : null,
      row.cluster_buy ? "cluster" : null,
    ].filter(Boolean);
    const who = row.lead_name || row.silent_who;
    const tip = it
      ? [
          `Cosa significa «${label}»: un dirigente/insider ha comprato azioni della propria società sul mercato (dichiarato in Form 4 SEC).`,
          who ? `Persona: ${who}.` : null,
          role && role !== "officer" ? `Ruolo: ${role}.` : null,
          date ? `Data: ${date}.` : null,
          net != null && net > 0 ? `Importo netto ~30g: ${fmtUsd(net)}.` : null,
          row.cluster_buy
            ? "«Cluster» = più insider hanno comprato nello stesso periodo."
            : null,
          "Segnale precoce: chi è vicino all’azienda sa più del mercato. Non è Soft BUY/SELL.",
        ]
          .filter(Boolean)
          .join(" ")
      : [
          `What «${label}» means: an executive/insider bought their own company’s shares on the open market (SEC Form 4).`,
          who ? `Person: ${who}.` : null,
          role && role !== "officer" ? `Role: ${role}.` : null,
          date ? `Date: ${date}.` : null,
          net != null && net > 0 ? `~30d net buy: ${fmtUsd(net)}.` : null,
          row.cluster_buy
            ? "«Cluster» = several insiders bought in the same period."
            : null,
          "Early tell: people close to the company know more than the market. Not Soft BUY/SELL.",
        ]
          .filter(Boolean)
          .join(" ");
    return {
      label,
      sub: subParts.join(" · ") || undefined,
      tone: "up",
      href: row.silent_href || row.lead_link || undefined,
      tip,
    };
  }

  const form = row.form_13d || inferSchedule13Form(row.silent_label, row.silent_kind) || "13D";
  const who = row.silent_who || row.who_13d;
  const label = abbreviateSchedule13DeskLabel(form, it);
  const pct = row.silent_pct ?? row.pct_13d;
  const isActivist = form.toUpperCase().includes("13D") || /BENEFICIAL\s+OWNER/i.test(form);
  const tip = it
    ? [
        isActivist
          ? `Cosa significa «${label}»: filing SEC 13D — un investitore (spesso attivista) dichiara una partecipazione superiore al 5% e può influenzare la società.`
          : `Cosa significa «${label}»: filing SEC 13G — un fondo istituzionale passivo dichiara una partecipazione superiore al 5% (di solito senza intento attivista).`,
        who ? `Soggetto: ${who}.` : null,
        pct != null ? `Quota: ${pct.toFixed(1)}%.` : null,
        date ? `Data: ${date}.` : null,
        "Segnale di accumulo istituzionale prima che il mercato se ne accorga. Non è Soft BUY/SELL.",
      ]
        .filter(Boolean)
        .join(" ")
    : [
        isActivist
          ? `What «${label}» means: SEC Schedule 13D — an investor (often activist) discloses a stake above 5% and may seek influence.`
          : `What «${label}» means: SEC Schedule 13G — a passive institutional fund discloses a stake above 5% (usually no activist intent).`,
        who ? `Filer: ${who}.` : null,
        pct != null ? `Stake: ${pct.toFixed(1)}%.` : null,
        date ? `Date: ${date}.` : null,
        "Institutional accumulation tell before the market notices. Not Soft BUY/SELL.",
      ]
        .filter(Boolean)
        .join(" ");
  return {
    label,
    sub: [date, pct != null ? `${pct.toFixed(1)}%` : null].filter(Boolean).join(" · ") || undefined,
    tone: "up",
    href: row.silent_href || row.link_13d || undefined,
    tip,
  };
}

/** @deprecated use formatSilentMoneyCell */
export function formatAccumulationCell(
  row: CatalystAccumulationRow | null | undefined,
  it: boolean,
  loading: boolean,
): SilentMoneyCell {
  return formatSilentMoneyCell(row, it, loading);
}

/**
 * Extract a human-readable role from the server gov_label.
 * Server formats: "Jane Roe left (CMO)", "Officer left (CFO)", "John appointed (CEO)"
 */
function extractGovRole(rawLabel: string): string | null {
  const m = /\(([^)]+)\)\s*$/.exec(rawLabel);
  return m ? m[1].trim() : null;
}

/** Classify a role string into Executive / Operational / Board. */
function classifyRole(role: string | null, it: boolean): string {
  if (!role) return it ? "Dirigente" : "Executive";
  const u = role.toUpperCase();
  if (/\bCEO\b|\bCFO\b|\bCOO\b|\bCMO\b|\bCSO\b|\bCTO\b|\bCBO\b|\bCHIEF\b|\bPRESIDENT\b/.test(u))
    return role;
  if (/\bDIRECTOR\b|\bBOARD\b|\bCHAIR/.test(u))
    return it ? "Board" : "Board";
  if (/\bVP\b|\bSVP\b|\bEVP\b|\bGENERAL\s+COUNSEL\b|\bSECRETARY\b/.test(u))
    return role;
  return role;
}

/** Display only — officer departure / appointment. Not Soft BUY/SELL. */
export function formatGovFlagCell(
  row: CatalystAccumulationRow | null | undefined,
  it: boolean,
  loading: boolean,
): GovFlagCell {
  if (!row || !row.governance_flag) {
    return {
      label: loading ? "…" : "—",
      tone: "none",
      tip: loading
        ? it
          ? "Gov flag in caricamento."
          : "Gov flag loading."
        : it
          ? "Nessuna uscita/nomina dirigenziale nel lookback. Fonte: SEC. Non è Soft BUY/SELL."
          : "No executive exit/appointment in lookback. Source: SEC. Not Soft BUY/SELL.",
    };
  }
  const ddmm = fmtDate(row.gov_date);
  const raw = (row.gov_label || "").trim();
  const role = extractGovRole(raw) || null;
  const roleName = classifyRole(role, it);

  let label: string;
  if (row.officer_departure) {
    label = it
      ? `${roleName} uscito`
      : `${roleName} Left`;
  } else {
    label = it
      ? `Nuovo ${roleName}`
      : `New ${roleName}`;
  }
  if (ddmm) label = `${label} · ${ddmm}`;

  return {
    label,
    tone: row.officer_departure ? "down" : "warn",
    tip: it
      ? `${row.officer_departure ? "Uscita" : "Nomina"} dirigenziale${ddmm ? ` del ${ddmm}` : ""}${
          raw ? ` — ${raw}` : ""
        }. Fonte: SEC 8-K. Non è Soft BUY/SELL.`
      : `Executive ${row.officer_departure ? "departure" : "appointment"}${ddmm ? ` on ${ddmm}` : ""}${
          raw ? ` — ${raw}` : ""
        }. Source: SEC 8-K. Not Soft BUY/SELL.`,
  };
}
