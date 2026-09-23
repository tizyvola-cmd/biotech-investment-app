/**
 * Public SuperNova landing — presentation desk.
 * Header switches Biotech/Medtech (violet) ↔ High-tech/AI coming soon (light aqua #0efdc8).
 * Hero + proof → Why → What it offers → Investor Insight → How it works → Methodology → Pricing → FAQ → Footer.
 * Auth panels preserved.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StoredTester } from "../sheet/testerSession";
import { consumeLandingPanelPreference } from "../shared/premiumAccess";
import { joinPremiumWaitlist, submitContactMessage } from "../api/testerFeedback";
import { HighTechComingSoonView } from "./HighTechComingSoonView";
import {
  HITECH_GREEN,
  HITECH_GREEN_RGB,
  HITECH_GREEN_SOFT,
} from "./hitechAccent";

type LandingPanel = "main" | "request" | "signin" | "pending" | "contact";
type LandingVertical = "biotech" | "tech";

export type AccessRequestPayload = {
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
  birthYear: number;
  edition: "biotech" | "tech" | "both";
  otherSpaces: string;
};

type Props = {
  mode: "loading" | "register" | "pending" | "revoked";
  tester: StoredTester | null;
  authBusy: boolean;
  authErr: string | null;
  onRequestAccess: (payload: AccessRequestPayload) => void;
  onSignIn: (email: string) => void;
  onRefresh: () => void;
  onSignOut: () => void;
  canEnter?: boolean;
  onEnter?: () => void;
};

function StarField({ vertical = "biotech" }: { vertical?: LandingVertical }) {
  const dots = useMemo(() => {
    const out: Array<{ left: string; top: string; size: number; opacity: number }> = [];
    for (let i = 0; i < 90; i += 1) {
      const seed = (i * 97) % 1000;
      out.push({
        left: `${(seed * 7) % 100}%`,
        top: `${(seed * 13) % 100}%`,
        size: 1 + (seed % 3),
        opacity: 0.15 + (seed % 45) / 100,
      });
    }
    return out;
  }, []);
  const tech = vertical === "tech";
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {dots.map((d, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white sn-landing-twinkle"
          style={{
            left: d.left,
            top: d.top,
            width: d.size,
            height: d.size,
            opacity: d.opacity,
            animationDelay: `${(i % 12) * 0.35}s`,
          }}
        />
      ))}
      {tech ? (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_55%_at_58%_36%,rgba(124,108,243,0.26),transparent_58%)]" />
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse 50% 42% at 38% 48%, rgba(${HITECH_GREEN_RGB},0.16), transparent 55%)`,
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(ellipse 40% 30% at 88% 12%, rgba(${HITECH_GREEN_RGB},0.10), transparent 50%)`,
            }}
          />
        </>
      ) : (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_55%_at_62%_38%,rgba(180,90,40,0.22),transparent_58%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_55%_45%_at_48%_42%,rgba(124,108,243,0.28),transparent_55%)]" />
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_40%_30%_at_85%_10%,rgba(243,196,81,0.08),transparent_50%)]" />
        </>
      )}
    </div>
  );
}

function VerticalSwitch({
  vertical,
  onSelect,
}: {
  vertical: LandingVertical;
  onSelect: (v: LandingVertical) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-white/[0.08] bg-white/[0.03] p-1">
      <button
        type="button"
        aria-pressed={vertical === "biotech"}
        onClick={() => onSelect("biotech")}
        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors ${
          vertical === "biotech"
            ? "bg-[rgba(155,140,255,0.18)] text-[#C4B8FF]"
            : "text-white/55 hover:text-white/80"
        }`}
      >
        Biotech/Medtech
      </button>
      <button
        type="button"
        aria-pressed={vertical === "tech"}
        onClick={() => onSelect("tech")}
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide transition-colors ${
          vertical === "tech"
            ? "bg-[rgba(14,253,200,0.12)]"
            : "text-white/45 hover:text-white/70"
        }`}
        style={vertical === "tech" ? { color: HITECH_GREEN } : undefined}
        title="Technology/AI — coming soon"
      >
        Technology/AI
        <span className="rounded-full border border-white/12 bg-white/[0.06] px-1.5 py-px text-[9px] font-bold uppercase tracking-wide text-white/50">
          Soon
        </span>
      </button>
    </div>
  );
}

function BrandMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`shrink-0 text-[#F3C451] ${className}`}>
      <path
        fill="currentColor"
        d="M12 2l1.2 5.4 4.8-2.8-2.2 5.1 5.4.6-4.6 2.7 3.2 4.4-5.2-1.5-.6 5.4-2.8-4.7-2.8 4.7-.6-5.4-5.2 1.5 3.2-4.4L2.8 10.3l5.4-.6L6 4.6l4.8 2.8L12 2z"
      />
    </svg>
  );
}

function CheckIcon({ tone = "muted" }: { tone?: "muted" | "gold" }) {
  const color = tone === "gold" ? "#F3C451" : "#97A2BA";
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0" fill="none">
      <path
        d="M4.5 10.5 8 14l7.5-8"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const JOBS = [
  {
    title: "Company & product file",
    tone: "violet" as const,
    body: "Rapid assessment of positioning: pipeline assets, commercial revenues, patent cliffs and strategies — scientific, financial and corporate in one card.",
    gloss: (
      <>
        In short: <span className="font-semibold text-[#C5CDDC]">one page instead of ten tabs.</span>
      </>
    ),
    icon: (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
    ),
  },
  {
    title: "Daily News",
    tone: "gold" as const,
    body: "Hourly digests on ★ names — press, filings, papers and FDA briefings — scored Clin / Fin / Access, then closed with an Investor Insight on product path and stock implication.",
    gloss: (
      <>
        <span className="font-semibold text-[#C5CDDC]">Investor Insight</span> = how to read the
        event, and what it may mean for growth of the shares — not a buy/sell order.
      </>
    ),
    icon: (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M5 5h14v14H5z" />
        <path d="M8 9h8M8 12h8M8 15h5" />
      </svg>
    ),
  },
  {
    title: "Inflection points",
    tone: "gold" as const,
    body: "Catalyst days — milestones where product and company destinies are rewritten. Watch the market warm or cool in the sensitive window before day 0.",
    gloss: (
      <>
        In short:{" "}
        <span className="font-semibold text-[#C5CDDC]">
          the calendar that matters, ranked by how hot it&apos;s getting.
        </span>
      </>
    ),
    icon: (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3.5" y="5" width="17" height="15" rx="2" />
        <path d="M3.5 10h17M8 3.5v3.5M16 3.5v3.5" />
      </svg>
    ),
  },
  {
    title: "EIS scoring",
    tone: "violet" as const,
    body: "EIS = how the market reacts to a news. Clinical, Financial and Access score the story — regulatory advance, corporate impact, market access.",
    gloss: (
      <>
        <span className="font-semibold text-[#C5CDDC]">EIS</span> = Event Impact Score — market
        price reaction after news. Separate from Soft BUY/SELL.
      </>
    ),
    icon: (
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 19V5M12 5l-3.5 3.5M12 5l3.5 3.5" />
        <path d="M5 19h14" />
      </svg>
    ),
  },
] as const;

const WHY_CARDS = [
  {
    vs: "vs. free FDA calendars",
    title: "We don't just list the date",
    body: "Every headline is read, scored on Clinical / Financial / Access, and mapped to the pipeline asset it belongs to — not a bare row in a spreadsheet.",
  },
  {
    vs: "vs. enterprise terminals",
    title: "Built for one ticker at 11pm",
    body: "Bloomberg- and Evaluate-class tools are built for institutional seats and six-figure budgets. SuperNova is built for the investor checking one name before a readout.",
  },
  {
    vs: "vs. a general AI chatbot",
    title: "Grounded, not guessed",
    body: "Scores and Investor Insights are anchored to SEC filings, trial registries and FDA briefing documents — not a plausible-sounding answer with no source.",
  },
] as const;

const FAQ_ITEMS = [
  {
    q: "Is this investment advice?",
    a: "No. SuperNova organizes public information and scores how significant it looks. Every decision — and every risk — stays yours.",
  },
  {
    q: "What is Investor Insight?",
    a: "On every News Brief, Investor Insight is the short closing read: first how the event moves the product’s path, then what it may imply for the company and for growth of the stock. Green / red / teal mark constructive, adverse or mixed framing — still not a buy or sell recommendation.",
  },
  {
    q: "Where does the data come from?",
    a: "SEC filings (8-K, 6-K, 10-Q), ClinicalTrials.gov, FDA briefing documents, company press releases and scientific literature.",
  },
  {
    q: "What's the difference between EIS and a stock rating?",
    a: "EIS isn't buy/sell. It reflects how the market reacts to news, while Clin / Fin / Access score the story itself on clinical, financial and market-access axes. Soft BUY/SELL is a separate, clearly labeled layer. Investor Insight sits on top of the brief to explain the event in plain language.",
  },
  {
    q: "When does Premium launch?",
    a: "Premium is in active development. Basic stays free regardless — join the early-access list to test Premium first, at no cost.",
  },
  {
    q: "Is Basic really free?",
    a: "Yes. Company files, daily scored news (with Investor Insight), and the near-term catalyst calendar are free — no card required for Basic access after operator approval.",
  },
] as const;

const BASIC_FEATURES = [
  {
    label: "Company & product intelligence",
    bold: "Deep Dive sheet per company",
    detail:
      "Scientific, financial and corporate in one place: pipeline positioning, commercial revenues, patent cliffs and strategies, competition and development timing — so you assess the company and its products fast.",
  },
  {
    label: "Daily News + Investor Insight",
    bold: "press, 8-K / 6-K, papers, FDA briefings — within ~1 hour",
    detail:
      "Material headlines are digested, scored (Clin / Fin / Access) and closed with Investor Insight: how to read the event, and the possible impact on product path and stock growth. FDA AdCom packages land highlighted.",
  },
  {
    label: "Inflection points",
    bold: "catalyst days in the next ~20 days",
    detail:
      "Milestones where product and company destinies are rewritten — trial readouts, FDA decisions, launches — and stocks reprice. Basic surfaces every name entering that near-term window.",
  },
  {
    label: "EIS scoring",
    bold: "market reaction + Clinical / Financial / Access",
    detail:
      "EIS reflects how the market reacts to news. Clin / Fin / Access score the story itself: regulatory advancement, corporate impact, and market access.",
  },
] as const;

const PREMIUM_FEATURES = [
  {
    label: "Longer horizon",
    bold: "catalyst calendar 6 months out",
    detail:
      "See inflection points beyond the next ~20 days — plan positioning and capital before the sensitive window opens.",
  },
  {
    label: "Full intelligence desk",
    bold: "Deep Dive for every name you track",
    detail:
      "Pipeline, revenues, patents and competition across your book — not only the tickers currently in the hot zone.",
  },
  {
    label: "Companies of interest",
    bold: "your own book against every catalyst day",
    detail:
      "Pin the names that matter; news, scores and milestones stay aligned to your list.",
  },
  {
    label: "Discovery",
    bold: "early disruptive products — before the crowd",
    detail:
      "FDA designations and scientific consensus to surface class-redefining assets — new modalities, undruggable targets, standout data — and follow them through development and the regulatory path.",
  },
] as const;

function ScrollTo({ id }: { id: string }) {
  const label =
    id === "product" ? "Product" : id === "faq" ? "FAQ" : id === "how-it-works" ? "How it works" : "Pricing";
  return (
    <button
      type="button"
      className="text-[13px] text-white/70 transition-colors hover:text-white"
      onClick={() => {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      {label}
    </button>
  );
}

/** Illustrative Deep Dive preview — stand-in until a real desk screenshot ships. */
function HeroProofCard() {
  return (
    <aside className="overflow-hidden rounded-2xl border border-white/[0.1] bg-[#121729]/95 shadow-[0_24px_60px_rgba(0,0,0,0.45)]">
      <div className="flex items-center gap-1.5 border-b border-white/[0.07] bg-[#0A0C14]/90 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-[#F87185]/80" />
        <span className="h-2 w-2 rounded-full bg-[#F3C451]/80" />
        <span className="h-2 w-2 rounded-full bg-[#34D399]/80" />
        <span className="ml-2 truncate text-[10px] text-[#5B6580]">supernova · Deep Dive preview</span>
      </div>
      <div className="space-y-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-white">ZNTL — Zentalis Pharmaceuticals</p>
            <p className="mt-0.5 text-[11px] text-[#97A2BA]">Oncology · azenosertib · Phase 2</p>
          </div>
          <span className="shrink-0 rounded-full border border-[#A79AFF]/40 bg-[#A79AFF]/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#C4B8FF]">
            Deep Dive
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/[0.07] bg-[#0A0C14]/70 px-3 py-2.5">
            <p className="text-[9px] font-bold uppercase tracking-wide text-[#5B6580]">Clinical path</p>
            <div className="mt-2 space-y-1.5 text-[11px]">
              <div className="flex justify-between gap-2 text-[#C5CDDC]">
                <span className="text-[#97A2BA]">Enrollment</span>
                <span>Complete</span>
              </div>
              <div className="flex justify-between gap-2 text-[#C5CDDC]">
                <span className="text-[#97A2BA]">Readout</span>
                <span>Q1 2027</span>
              </div>
              <div className="flex justify-between gap-2 text-[#C5CDDC]">
                <span className="text-[#97A2BA]">FDA filing</span>
                <span>Est. Q3 2027</span>
              </div>
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-[#0A0C14]/70 px-3 py-2.5">
            <p className="text-[9px] font-bold uppercase tracking-wide text-[#5B6580]">Financial</p>
            <div className="mt-2 space-y-1.5 text-[11px]">
              <div className="flex justify-between gap-2 text-[#C5CDDC]">
                <span className="text-[#97A2BA]">Cash runway</span>
                <span>~18 mo</span>
              </div>
              <div className="flex justify-between gap-2 text-[#C5CDDC]">
                <span className="text-[#97A2BA]">Patent cliff</span>
                <span>2034</span>
              </div>
              <div className="flex justify-between gap-2 text-[#C5CDDC]">
                <span className="text-[#97A2BA]">vs XBI (30d)</span>
                <span className="text-[#34D399]">+6.1%</span>
              </div>
            </div>
          </div>
        </div>
        <div className="space-y-2">
          {[
            { lab: "Clinical", w: "72%", color: "#9B8CFF" },
            { lab: "Financial", w: "34%", color: "#F3C451" },
            { lab: "Access", w: "18%", color: "#6B7280" },
          ].map((r) => (
            <div key={r.lab} className="flex items-center gap-2 text-[10px]">
              <span className="w-14 shrink-0 text-[#97A2BA]">{r.lab}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
                <div className="h-full rounded-full" style={{ width: r.w, background: r.color }} />
              </div>
              <span className="w-6 text-right tabular-nums text-[#C5CDDC]">{r.w.replace("%", "")}</span>
            </div>
          ))}
        </div>
        <p className="rounded-lg border border-[#F3C451]/30 bg-[#F3C451]/10 px-3 py-2 text-[11px] leading-snug text-[#F3C451]">
          Catalyst day in <span className="font-semibold text-white">34 days</span> — sensitive
          window warming ↑
        </p>
      </div>
      <p className="border-t border-white/[0.06] px-4 py-2 text-[10px] leading-snug text-[#5B6580]">
        Illustrative preview — not a live screenshot, not real-time.
      </p>
    </aside>
  );
}

function StoryBlock({
  step,
  eyebrow,
  title,
  body,
  bullets,
  draw,
  reverse = false,
}: {
  step: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  draw: ReactNode;
  reverse?: boolean;
}) {
  return (
    <article
      className={`grid items-center gap-8 lg:grid-cols-2 lg:gap-12 ${
        reverse ? "lg:[&>div:first-child]:order-2" : ""
      }`}
    >
      <div className="space-y-4">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#A79AFF]">
          <span className="mr-2 text-[#5B6580]">{step}</span>
          {eyebrow}
        </p>
        <h3 className="text-[1.45rem] font-semibold tracking-tight text-white sm:text-[1.65rem]">
          {title}
        </h3>
        <p className="text-[14px] leading-relaxed text-[#97A2BA]">{body}</p>
        <ul className="space-y-2.5">
          {bullets.map((b) => (
            <li key={b} className="flex gap-2.5 text-[13px] leading-snug text-[#C5CDDC]">
              <CheckIcon />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="min-w-0">{draw}</div>
    </article>
  );
}

/** Compact proof thumbs — screenshots kept tiny, not the hero. */
/** Single product glimpse — full Catalyst desk (kept compact). */
function ProofStrip() {
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <p className="text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5B6580]">
        Product glimpse · intelligence desk
      </p>
      <figure className="overflow-hidden rounded-xl border border-white/[0.08] bg-[#0A0C14]">
        <img
          src="/landing/catalyst-desk.png"
          alt="Next 20 Catalyst Days — Top News, headlines, and market indices on the Catalyst desk"
          className="block h-auto w-full max-h-[18rem] object-contain object-top sm:max-h-[22rem]"
          loading="lazy"
          decoding="async"
        />
      </figure>
    </div>
  );
}

function DrawSensitiveWindow() {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#121729]/90 p-5 sm:p-6">
      <svg viewBox="0 0 420 220" className="h-auto w-full" aria-hidden>
        <defs>
          <linearGradient id="snWarmCool" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.35" />
            <stop offset="55%" stopColor="#F3C451" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#F87185" stopOpacity="0.4" />
          </linearGradient>
        </defs>
        <text x="16" y="28" fill="#F3C451" fontSize="11" fontWeight="700" letterSpacing="1.5">
          T−20 → DAY 0
        </text>
        <text x="16" y="52" fill="#F3F5FA" fontSize="16" fontWeight="600">
          Sensitive window
        </text>
        <rect x="16" y="72" width="388" height="14" rx="7" fill="url(#snWarmCool)" />
        <circle cx="48" cy="79" r="5" fill="#38BDF8" />
        <circle cx="230" cy="79" r="6" fill="#F3C451" />
        <circle cx="388" cy="79" r="7" fill="#F87185" stroke="#F3F5FA" strokeWidth="1.5" />
        <text x="16" y="110" fill="#5B6580" fontSize="9">
          cool
        </text>
        <text x="200" y="110" fill="#5B6580" fontSize="9">
          warming
        </text>
        <text x="360" y="110" fill="#5B6580" fontSize="9">
          day 0
        </text>
        {[
          ["Momentum", "↑", 130],
          ["G-Trends", "+8%", 130],
          ["Vol", "+42%", 160],
          ["vs XBI", "+1.2%", 160],
        ].map(([lab, val, y], i) => (
          <g key={lab} transform={`translate(${16 + (i % 2) * 200} ${Number(y)})`}>
            <rect width="180" height="36" rx="8" fill="#0A0C14" stroke="rgba(52,211,153,0.35)" />
            <text x="12" y="22" fill="#C5CDDC" fontSize="11" fontWeight="600">
              {lab}
            </text>
            <text x="168" y="22" fill="#34D399" fontSize="11" fontWeight="700" textAnchor="end">
              {val}
            </text>
          </g>
        ))}
      </svg>
      <p className="mt-2 text-[11px] leading-relaxed text-[#97A2BA]">
        Indices show when attention builds or fades — often days before the event prints.
      </p>
    </div>
  );
}

function DrawNewsFlow() {
  const steps = [
    { n: "1", t: "Digest", d: "Paragraphs from the source" },
    { n: "2", t: "Score", d: "Clin · Fin · Access" },
    { n: "3", t: "Dates", d: "Catalysts & conferences" },
    { n: "4", t: "Mig", d: "Into Deep Dive — you decide" },
  ];
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#121729]/90 p-5 sm:p-6">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {steps.map((s) => (
          <div
            key={s.n}
            className="rounded-xl border border-white/[0.08] bg-[#0A0C14]/80 px-3 py-3 text-center"
          >
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#A79AFF]/45 text-[12px] font-bold text-[#A79AFF]">
              {s.n}
            </span>
            <p className="mt-2 text-[12px] font-semibold text-white">{s.t}</p>
            <p className="mt-1 text-[10px] leading-snug text-[#97A2BA]">{s.d}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <span className="rounded-full border border-white/12 px-2.5 py-1 text-[10px] text-[#97A2BA]">
          Clin +0.00
        </span>
        <span className="rounded-full bg-[#34D399] px-2.5 py-1 text-[10px] font-bold text-[#0B0D17]">
          Fin +0.15
        </span>
        <span className="rounded-full border border-white/12 px-2.5 py-1 text-[10px] text-[#97A2BA]">
          Access +0.00
        </span>
        <span className="rounded-full bg-gradient-to-b from-[#F3C451] to-[#E07A1A] px-2.5 py-1 text-[10px] font-bold text-[#0B0D17]">
          Mig → Deep Dive
        </span>
      </div>
      <p className="mt-3 text-center text-[11px] text-[#5B6580]">
        Soft BUY/SELL unchanged — news is context, not an order.
      </p>
    </div>
  );
}

function DrawDeepDive() {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-[#121729]/90 p-5 sm:p-6 space-y-4">
      <div className="inline-flex rounded-full border border-white/[0.1] bg-[#0A0C14] p-0.5">
        <span className="rounded-full bg-[#7C6CF3]/35 px-3 py-1 text-[10px] font-bold text-[#E8E4FF]">
          Clinical
        </span>
        <span className="rounded-full px-3 py-1 text-[10px] font-semibold text-[#97A2BA]">
          Financial
        </span>
      </div>
      <svg viewBox="0 0 420 160" className="h-auto w-full" aria-hidden>
        {/* Clinical path strip */}
        <text x="8" y="18" fill="#A79AFF" fontSize="10" fontWeight="700" letterSpacing="1">
          CLINICAL · PATH
        </text>
        <line x1="20" y1="48" x2="400" y2="48" stroke="rgba(255,255,255,0.12)" strokeWidth="2" />
        <line
          x1="120"
          y1="28"
          x2="120"
          y2="68"
          stroke="#F3C451"
          strokeWidth="1.5"
          strokeDasharray="3 2"
        />
        <text x="108" y="24" fill="#F3C451" fontSize="9" fontWeight="600">
          TODAY
        </text>
        <circle cx="280" cy="48" r="7" fill="#A79AFF" />
        <text x="252" y="78" fill="#C5CDDC" fontSize="10">
          Readout · CD
        </text>
        {/* Financial bars */}
        <text x="8" y="108" fill="#F3C451" fontSize="10" fontWeight="700" letterSpacing="1">
          FINANCIAL · REVENUE
        </text>
        <rect x="20" y="120" width="120" height="18" rx="4" fill="#34D399" opacity="0.85" />
        <rect x="150" y="126" width="72" height="12" rx="3" fill="#34D399" opacity="0.55" />
        <rect x="232" y="128" width="54" height="10" rx="3" fill="#34D399" opacity="0.4" />
        <text x="20" y="154" fill="#5B6580" fontSize="9">
          Brand Q / FY · patent cliff · line of therapy
        </text>
      </svg>
      <p className="text-[11px] leading-relaxed text-[#97A2BA]">
        Competition for the same indication, price vs XBI, volume synced to EIS — one card per
        company.
      </p>
    </div>
  );
}

function FieldShell({ children }: { children: ReactNode }) {
  return <div className="sn-landing-field-shell">{children}</div>;
}

function inferEdition(raw: string): "biotech" | "tech" | "both" {
  const s = raw.toLowerCase();
  const bio = /biotech|medtech|pharma|clinical|drug/.test(s);
  const tech = /\btech\b|\bai\b|hardware|software|semiconductor|crypto/.test(s);
  if (bio && tech) return "both";
  if (bio) return "biotech";
  if (tech) return "tech";
  return "both";
}

export function SupernovaLandingPage({
  mode,
  tester,
  authBusy,
  authErr,
  onRequestAccess,
  onSignIn,
  onRefresh,
  onSignOut,
  canEnter = false,
  onEnter,
}: Props) {
  const preferRequestRef = useRef(false);
  const premiumCardRef = useRef<HTMLElement | null>(null);
  const openPremiumRef = useRef(false);
  const [highlightPremium, setHighlightPremium] = useState(false);
  const [panel, setPanel] = useState<LandingPanel>(() => {
    const pref = consumeLandingPanelPreference();
    if (pref === "request") {
      preferRequestRef.current = true;
      return "request";
    }
    if (pref === "premium") {
      openPremiumRef.current = true;
      return "main";
    }
    if (mode === "pending") return "pending";
    return "main";
  });
  const [email, setEmail] = useState(tester?.email ?? "");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthYear, setBirthYear] = useState("");
  const [interestSpaces, setInterestSpaces] = useState("");
  const [signInEmail, setSignInEmail] = useState(tester?.email ?? "");
  const [waitlistEmail, setWaitlistEmail] = useState(tester?.email ?? "");
  const [waitlistBusy, setWaitlistBusy] = useState(false);
  const [waitlistErr, setWaitlistErr] = useState<string | null>(null);
  const [waitlistOk, setWaitlistOk] = useState(false);
  const [waitlistAlready, setWaitlistAlready] = useState(false);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const [vertical, setVertical] = useState<LandingVertical>("biotech");
  const [contactEmail, setContactEmail] = useState(tester?.email ?? "");
  const [contactFirst, setContactFirst] = useState("");
  const [contactLast, setContactLast] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactBusy, setContactBusy] = useState(false);
  const [contactErr, setContactErr] = useState<string | null>(null);
  const [contactOk, setContactOk] = useState(false);

  useEffect(() => {
    if (mode !== "pending") preferRequestRef.current = false;
  }, [mode]);

  useEffect(() => {
    if (!openPremiumRef.current) return;
    openPremiumRef.current = false;
    setHighlightPremium(true);
    const id = window.setTimeout(() => {
      premiumCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (mode === "loading") {
      setPanel("main");
      return;
    }
    if (mode === "pending") {
      if (preferRequestRef.current) {
        preferRequestRef.current = false;
        setPanel("request");
        return;
      }
      setPanel("pending");
    }
  }, [mode]);

  useEffect(() => {
    if (tester?.email) {
      setEmail(tester.email);
      setSignInEmail(tester.email);
      setWaitlistEmail((prev) => prev || tester.email);
    }
  }, [tester?.email]);

  const errLabel =
    authErr === "OWNER_ONLY"
      ? "This email cannot register here."
      : authErr === "INVITE_REQUIRED"
        ? "Invite code required."
        : authErr === "NETWORK" ||
            (authErr != null &&
              /failed to fetch|networkerror|load failed|fetch failed|aborterror|aborted|timed?\s*out/i.test(
                authErr,
              ))
          ? "Could not reach SuperNova (network/timeout). Refresh and try again — fill every field including Investment spaces."
          : authErr;

  const showMain = panel === "main" && mode !== "pending" && mode !== "revoked" && mode !== "loading";
  const showRequest = panel === "request" && mode !== "pending" && mode !== "revoked" && mode !== "loading";
  const showSignIn = panel === "signin" && mode !== "pending" && mode !== "revoked" && mode !== "loading";
  const showContact = panel === "contact" && mode !== "pending" && mode !== "revoked" && mode !== "loading";
  const hideChrome = showRequest;

  const goGetStarted = () => {
    if (canEnter && onEnter) {
      onEnter();
      return;
    }
    if (vertical === "tech" && !interestSpaces.trim()) {
      setInterestSpaces("High-tech, AI, Information technology");
    }
    setPanel("request");
  };

  const sendContact = () => {
    const em = contactEmail.trim();
    const fn = contactFirst.trim();
    const ln = contactLast.trim();
    const msg = contactMessage.trim();
    if (!em.includes("@") || em.length < 6) {
      setContactErr("Enter a valid email");
      return;
    }
    if (!fn || !ln) {
      setContactErr("First name and last name are required");
      return;
    }
    if (msg.length < 3) {
      setContactErr("Please write a short message");
      return;
    }
    setContactBusy(true);
    setContactErr(null);
    void submitContactMessage({
      email: em,
      first_name: fn,
      last_name: ln,
      message: msg,
    })
      .then(() => {
        setContactOk(true);
        setContactMessage("");
      })
      .catch((e) => {
        setContactErr(
          e instanceof Error ? e.message.slice(0, 160) : "Could not send. Try again.",
        );
      })
      .finally(() => setContactBusy(false));
  };

  const joinWaitlist = () => {
    const em = waitlistEmail.trim();
    if (!em.includes("@")) return;
    setWaitlistBusy(true);
    setWaitlistErr(null);
    void joinPremiumWaitlist(em)
      .then((res) => {
        setWaitlistOk(true);
        setWaitlistAlready(Boolean(res.already));
        setWaitlistPosition(typeof res.position === "number" ? res.position : null);
      })
      .catch((e) => {
        setWaitlistErr(
          e instanceof Error ? e.message.slice(0, 160) : "Could not join the waitlist. Try again.",
        );
      })
      .finally(() => setWaitlistBusy(false));
  };

  return (
    <div className="sn-landing relative min-h-screen overflow-x-hidden overflow-y-auto bg-[#07080F] text-[#F3F5FA]">
      <StarField vertical={vertical} />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 pb-12 pt-5 sm:px-8 lg:px-10">
        {hideChrome ? (
          <header className="sn-landing-bar relative z-20 flex items-center">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-[#F3F5FA] transition-colors hover:border-white/30 hover:bg-white/10"
              onClick={() => setPanel("main")}
              aria-label="Back to SuperNova"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.1">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 5.5 8.5 12l7 6.5" />
              </svg>
            </button>
          </header>
        ) : (
          <header className="sn-landing-bar flex flex-wrap items-center justify-between gap-3 sm:gap-4">
            <div className="flex items-center gap-3 sm:gap-4">
              <button
                type="button"
                className="flex items-center gap-2.5"
                onClick={() => {
                  setVertical("biotech");
                  setPanel("main");
                }}
              >
                <BrandMark className="h-[18px] w-[18px] sn-landing-brand-pulse" />
                <span className="text-[13px] font-bold tracking-[0.22em] uppercase text-white">
                  SUPERNOVA
                </span>
              </button>
              <VerticalSwitch
                vertical={vertical}
                onSelect={(v) => {
                  setVertical(v);
                  setPanel("main");
                }}
              />
            </div>
            <nav className="flex items-center gap-3 sm:gap-5 text-[13px]">
              {showMain && vertical === "biotech" ? (
                <>
                  <ScrollTo id="product" />
                  <ScrollTo id="pricing" />
                  <ScrollTo id="faq" />
                </>
              ) : null}
              {mode !== "pending" && mode !== "revoked" && mode !== "loading" ? (
                <button
                  type="button"
                  className={`transition-colors ${
                    showContact ? "text-white" : "text-white/70 hover:text-white"
                  }`}
                  onClick={() => {
                    setContactOk(false);
                    setContactErr(null);
                    setPanel("contact");
                  }}
                >
                  Contact
                </button>
              ) : null}
              {mode !== "pending" ? (
                <button
                  type="button"
                  className="text-white/70 transition-colors hover:text-white"
                  onClick={() => setPanel(showSignIn ? "main" : "signin")}
                >
                  Sign in
                </button>
              ) : null}
              <button
                type="button"
                className={`rounded-lg border px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                  vertical === "tech"
                    ? ""
                    : "border-white/15 bg-white/[0.06] text-white hover:bg-white/10"
                }`}
                style={
                  vertical === "tech"
                    ? {
                        borderColor: `rgba(${HITECH_GREEN_RGB},0.35)`,
                        backgroundColor: `rgba(${HITECH_GREEN_RGB},0.12)`,
                        color: HITECH_GREEN_SOFT,
                      }
                    : undefined
                }
                onClick={goGetStarted}
              >
                Get started
              </button>
            </nav>
          </header>
        )}

        <main className={`flex flex-1 flex-col ${hideChrome ? "mt-0" : "mt-8 sm:mt-12"}`}>
          {mode === "loading" ? <p className="text-sm text-white/60">Loading…</p> : null}

          {(panel === "pending" || mode === "pending") && mode !== "revoked" ? (
            <section className="mx-auto max-w-lg space-y-4 text-center sm:text-left">
              <p className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[#A79AFF]">
                Access requested
              </p>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Waiting for approval
              </h1>
              <p className="text-[15px] leading-relaxed text-white/70">
                Your request
                {tester?.email ? (
                  <>
                    {" "}
                    for <span className="font-medium text-white">{tester.email}</span>
                  </>
                ) : null}{" "}
                is pending operator approval. You cannot open the desk until it is granted. We will
                email you when access is approved — then Sign in with the same address.
              </p>
              <div className="flex flex-wrap justify-center gap-3 pt-2 sm:justify-start">
                <button
                  type="button"
                  disabled={authBusy}
                  className="rounded-lg border border-white/20 px-5 py-2.5 text-sm font-semibold text-white/90 hover:bg-white/5 disabled:opacity-50"
                  onClick={onRefresh}
                >
                  Check again
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-white/20 px-5 py-2.5 text-sm text-white/80 hover:bg-white/5"
                  onClick={() => {
                    onSignOut();
                    setPanel("main");
                  }}
                >
                  Use another email
                </button>
              </div>
            </section>
          ) : null}

          {mode === "revoked" ? (
            <section className="mx-auto max-w-lg space-y-4">
              <h1 className="text-3xl font-semibold tracking-tight">Access revoked</h1>
              <p className="text-[15px] text-white/70">
                This account can no longer open SuperNova. Contact the operator if you need access
                again.
              </p>
              <button
                type="button"
                className="rounded-lg border border-white/20 px-5 py-2.5 text-sm"
                onClick={onSignOut}
              >
                Back
              </button>
            </section>
          ) : null}

          {showMain && vertical === "tech" ? (
            <HighTechComingSoonView onBackBiotech={() => setVertical("biotech")} />
          ) : null}

          {showContact ? (
            <section className="mx-auto w-full max-w-lg space-y-5 sn-landing-fade-up">
              <div className="space-y-2 text-center sm:text-left">
                <p className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[#A79AFF]">
                  Contact
                </p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Write to SuperNova
                </h1>
                <p className="text-[15px] leading-relaxed text-white/70">
                  Send us a message — we read every note in the Access desk. Email, first name, last
                  name and your message each in its own field.
                </p>
              </div>
              {contactOk ? (
                <div className="space-y-4 rounded-xl border border-[#9B8CFF]/35 bg-[#9B8CFF]/10 px-4 py-4">
                  <p className="text-[14px] text-[#C4B8FF] leading-snug">
                    Message sent. We will get back to you at the email you provided.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-lg border border-white/20 px-4 py-2 text-[13px] font-semibold text-white/90 hover:bg-white/5"
                      onClick={() => {
                        setContactOk(false);
                        setContactMessage("");
                      }}
                    >
                      Send another
                    </button>
                    <button
                      type="button"
                      className="rounded-lg bg-[#9B8CFF] px-4 py-2 text-[13px] font-semibold text-[#0B0D17]"
                      onClick={() => setPanel("main")}
                    >
                      Back to home
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendContact();
                  }}
                >
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-white/55">
                      Email
                    </span>
                    <input
                      type="email"
                      name="contact-email"
                      autoComplete="email"
                      required
                      value={contactEmail}
                      onChange={(ev) => {
                        setContactEmail(ev.target.value);
                        setContactErr(null);
                      }}
                      placeholder="you@email.com"
                      className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/35 outline-none focus:border-[#9B8CFF]/55"
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-white/55">
                        First name
                      </span>
                      <input
                        type="text"
                        name="contact-first"
                        autoComplete="given-name"
                        required
                        value={contactFirst}
                        onChange={(ev) => {
                          setContactFirst(ev.target.value);
                          setContactErr(null);
                        }}
                        placeholder="First name"
                        className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/35 outline-none focus:border-[#9B8CFF]/55"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-white/55">
                        Last name
                      </span>
                      <input
                        type="text"
                        name="contact-last"
                        autoComplete="family-name"
                        required
                        value={contactLast}
                        onChange={(ev) => {
                          setContactLast(ev.target.value);
                          setContactErr(null);
                        }}
                        placeholder="Last name"
                        className="w-full rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/35 outline-none focus:border-[#9B8CFF]/55"
                      />
                    </label>
                  </div>
                  <label className="block space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-white/55">
                      Message
                    </span>
                    <textarea
                      name="contact-message"
                      required
                      rows={5}
                      value={contactMessage}
                      onChange={(ev) => {
                        setContactMessage(ev.target.value);
                        setContactErr(null);
                      }}
                      placeholder="Your message…"
                      className="w-full resize-y rounded-xl border border-white/15 bg-white/[0.06] px-3.5 py-2.5 text-[14px] text-white placeholder:text-white/35 outline-none focus:border-[#9B8CFF]/55 min-h-[8rem]"
                    />
                  </label>
                  {contactErr ? (
                    <p className="text-[12px] text-[#F87185]">{contactErr}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="submit"
                      disabled={contactBusy}
                      className="rounded-xl bg-[#9B8CFF] px-5 py-2.5 text-[14px] font-semibold text-[#0B0D17] shadow-[0_0_28px_rgba(155,140,255,0.35)] transition-[filter] hover:brightness-110 disabled:opacity-50"
                    >
                      {contactBusy ? "…" : "Send message"}
                    </button>
                    <button
                      type="button"
                      className="rounded-xl border border-white/20 px-5 py-2.5 text-[14px] font-semibold text-white/85 hover:bg-white/5"
                      onClick={() => setPanel("main")}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </section>
          ) : null}

          {showMain && vertical === "biotech" ? (
            <div className="space-y-24 sm:space-y-28">
              {/* ── Hero ── */}
              <section className="relative sn-landing-fade-up">
                <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)] lg:gap-12">
                  <div className="space-y-6">
                    <p className="inline-flex items-center gap-2 text-[11px] font-semibold tracking-[0.2em] uppercase text-[#C4B8FF]">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#F3C451] shadow-[0_0_8px_#F3C451]" />
                      Pharma &amp; Biotech intelligence · Private beta
                    </p>
                    <h1 className="text-[2.2rem] font-semibold leading-[1.08] tracking-tight sm:text-[2.85rem] lg:text-[3.05rem]">
                      See the company and its products clearly —{" "}
                      <span className="text-[#F3C451]">before</span> the market rewrites the story.
                    </h1>
                    <p className="max-w-xl text-[15px] leading-relaxed text-[#97A2BA] sm:text-[16px]">
                      SuperNova puts the science, the financials and the filings for a biotech in one
                      file, so you can size up a company and its pipeline in minutes. Then it watches
                      for{" "}
                      <span className="text-[#C5CDDC]">catalyst days</span> — the readouts and FDA
                      decisions that can flip the story and reprice the stock.
                    </p>
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="button"
                        className="rounded-xl bg-[#9B8CFF] px-5 py-2.5 text-[14px] font-semibold text-[#0B0D17] shadow-[0_0_36px_rgba(155,140,255,0.45)] transition-[filter,transform] hover:brightness-110 active:scale-[0.98]"
                        onClick={goGetStarted}
                      >
                        {canEnter && tester?.email
                          ? `Enter · ${tester.email}`
                          : canEnter
                            ? "Enter SuperNova"
                            : "Join free — Basic"}
                      </button>
                      <button
                        type="button"
                        className="rounded-xl border border-white/20 bg-transparent px-5 py-2.5 text-[14px] font-semibold text-white/90 transition-colors hover:bg-white/[0.05]"
                        onClick={() =>
                          document
                            .getElementById("how-it-works")
                            ?.scrollIntoView({ behavior: "smooth", block: "start" })
                        }
                      >
                        See how it works
                      </button>
                    </div>
                    <p className="text-[13px] text-[#5B6580]">
                      Free on Basic, no card needed · Not investment advice
                    </p>
                  </div>
                  <HeroProofCard />
                </div>
              </section>

              {/* ── Why SuperNova ── */}
              <section id="why" className="scroll-mt-24 space-y-6 sn-landing-fade-up">
                <div className="max-w-2xl space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#5B6580]">
                    Why SuperNova
                  </p>
                  <h2 className="text-[1.75rem] font-semibold tracking-tight text-white sm:text-[2rem]">
                    Not another calendar. Not an enterprise terminal.
                  </h2>
                  <p className="text-[14px] leading-relaxed text-[#97A2BA]">
                    Three things people already use for this job, and why SuperNova sits in the gap
                    between them.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {WHY_CARDS.map((card) => (
                    <aside
                      key={card.vs}
                      className="rounded-2xl border border-white/[0.08] bg-[#121729]/80 px-5 py-5"
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#A79AFF]">
                        {card.vs}
                      </p>
                      <h3 className="mt-2 text-[15px] font-semibold text-white">{card.title}</h3>
                      <p className="mt-2 text-[13px] leading-relaxed text-[#97A2BA]">{card.body}</p>
                    </aside>
                  ))}
                </div>
              </section>

              {/* ── What it does ── */}
              <section id="product" className="scroll-mt-24 space-y-6 sn-landing-fade-up">
                <div className="max-w-2xl space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#5B6580]">
                    What SuperNova offers
                  </p>
                  <h2 className="text-[1.75rem] font-semibold tracking-tight text-white sm:text-[2rem]">
                    Assess · monitor · anticipate — one desk
                  </h2>
                  <p className="text-[14px] leading-relaxed text-[#97A2BA]">
                    Start with company and product positioning. Stay current with scored news and
                    Investor Insight on each brief. Then watch the market warm or cool into catalyst
                    day 0. Soft BUY/SELL stays a separate layer.
                  </p>
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#121729]/80 backdrop-blur-sm">
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4">
                    {JOBS.map((job, i) => (
                      <div
                        key={job.title}
                        className={`space-y-3 px-5 py-6 ${
                          i > 0 ? "border-t border-white/[0.07] lg:border-t-0 lg:border-l" : ""
                        } ${i === 1 ? "sm:border-t-0 sm:border-l" : ""} ${
                          i === 2 ? "lg:border-l" : ""
                        }`}
                      >
                        <div
                          className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border ${
                            job.tone === "gold"
                              ? "border-[#F3C451]/45 text-[#F3C451]"
                              : "border-[#A79AFF]/45 text-[#A79AFF]"
                          }`}
                        >
                          {job.icon}
                        </div>
                        <p className="text-[15px] font-semibold text-white">{job.title}</p>
                        <p className="text-[12px] leading-relaxed text-[#97A2BA]">{job.body}</p>
                        <p className="text-[11px] leading-relaxed text-[#5B6580]">{job.gloss}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* ── Investor Insight ── */}
              <section id="investor-insight" className="scroll-mt-24 space-y-6 sn-landing-fade-up">
                <div className="max-w-2xl space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#5B6580]">
                    Investor Insight
                  </p>
                  <h2 className="text-[1.75rem] font-semibold tracking-tight text-white sm:text-[2rem]">
                    Every brief ends with a clear stock lens
                  </h2>
                  <p className="text-[14px] leading-relaxed text-[#97A2BA]">
                    After the digest and Clin / Fin / Access scores, SuperNova closes the News Brief
                    with Investor Insight — so you spend less time decoding the filing and more time
                    judging what it may mean for growth of the shares.
                  </p>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  {[
                    {
                      t: "Faster reading",
                      d: "Dense FDA packages, 8-Ks and press wire are reduced to a short path: what happened, what matters for the product, what is still open.",
                    },
                    {
                      t: "Product path first",
                      d: "The insight leads with regulatory and clinical advancement — approvals, safety files, partnerships, labeling — before any price talk.",
                    },
                    {
                      t: "Stock growth implication",
                      d: "Then it frames the possible impact on the company and the stock — constructive, adverse or mixed — without turning into a buy/sell order.",
                    },
                  ].map((card) => (
                    <aside
                      key={card.t}
                      className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-5 py-5"
                    >
                      <h3 className="text-[15px] font-semibold text-white">{card.t}</h3>
                      <p className="mt-2 text-[13px] leading-relaxed text-[#97A2BA]">{card.d}</p>
                    </aside>
                  ))}
                </div>
                <p className="text-[12px] leading-relaxed text-[#5B6580]">
                  Color on the Insight box marks framing only (green / red / teal). It is not Soft
                  BUY/SELL and not investment advice.
                </p>
              </section>

              {/* ── Product story ── */}
              <section
                id="how-it-works"
                className="scroll-mt-24 space-y-16 sm:space-y-20 sn-landing-fade-up"
              >
                <div className="mx-auto max-w-2xl space-y-2 text-center">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#5B6580]">
                    How it works
                  </p>
                  <h2 className="text-[1.75rem] font-semibold tracking-tight text-white sm:text-[2rem]">
                    Three moves. Clear every time.
                  </h2>
                  <p className="text-[14px] leading-relaxed text-[#97A2BA]">
                    Pharma intelligence first — then news — then the inflection points that reprice
                    the stock.
                  </p>
                </div>

                <StoryBlock
                  step="01"
                  eyebrow="Deep Dive · company file"
                  title="Position the company and its products"
                  body="Open any ticker and read scientific, financial and corporate context together: pipeline assets on their regulatory path, marketed brands with revenues and patent cliffs, competition and development timing. Rapid assessment of where the company stands — and where its products can go."
                  bullets={[
                    "Clinical: path, competition, charts vs market",
                    "Financial: product revenue, patent cliffs, scored filings",
                    "Same file from early development to commercial shelf",
                  ]}
                  draw={<DrawDeepDive />}
                />

                <StoryBlock
                  step="02"
                  eyebrow="Daily News · Investor Insight"
                  title="Digest → score → Insight → dates → Mig"
                  body="Fresh headlines on companies of interest open as a News Brief — press, SEC filings, papers and FDA briefing packages. SuperNova digests the source, assigns Clin / Fin / Access scores, and closes with Investor Insight: how to read the event, and the possible impact on product path and stock growth. You read it; Mig puts it in Deep Dive only when you choose."
                  bullets={[
                    "Investor Insight: product advancement first, then company & stock implication",
                    "Hourly refresh on ★ names · FDA briefings highlighted when materials publish",
                    "Soft BUY/SELL unchanged — Insight explains the event, it is not an order",
                  ]}
                  draw={<DrawNewsFlow />}
                  reverse
                />

                <StoryBlock
                  step="03"
                  eyebrow="Inflection points · catalyst days"
                  title="See the market warm or cool — before day 0"
                  body="Catalyst days are milestones where product and company destinies are rewritten — readouts, FDA decisions, launches — and stocks revalue. The rolling ~20-day window is the sensitive period when market shifts are expected."
                  bullets={[
                    "Clear indices: Momentum, G-Trends, volume, conviction, sentiment, vs XBI",
                    "Spot heating or cooling days before the event prints",
                    "Basic: next ~20 days · Premium: horizon out to 6 months",
                  ]}
                  draw={<DrawSensitiveWindow />}
                />

                <ProofStrip />
              </section>

              {/* ── Methodology & trust ── */}
              <section id="methodology" className="scroll-mt-24 sn-landing-fade-up">
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-start">
                  <div className="space-y-5">
                    <div className="space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#5B6580]">
                        How EIS actually works
                      </p>
                      <h2 className="text-[1.65rem] font-semibold tracking-tight text-white sm:text-[1.9rem]">
                        Three steps, not a black box
                      </h2>
                    </div>
                    <ol className="space-y-4">
                      {[
                        {
                          n: "1",
                          t: "Ingest",
                          d: "Press releases, SEC 8-K/6-K filings, scientific papers and FDA briefing packages, on the names you track.",
                        },
                        {
                          n: "2",
                          t: "Score + Insight",
                          d: 'Each story is scored on Clinical, Financial and Access using a fixed rubric — then Investor Insight explains the event and the possible impact on stock growth in plain language.',
                        },
                        {
                          n: "3",
                          t: "Calibrate",
                          d: "Scores are checked against how names actually moved, so the scale keeps meaning something over time.",
                        },
                      ].map((s) => (
                        <li key={s.n} className="flex gap-3">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#A79AFF]/40 bg-[#A79AFF]/12 text-[12px] font-bold text-[#C4B8FF]">
                            {s.n}
                          </span>
                          <div>
                            <p className="text-[14px] font-semibold text-white">{s.t}</p>
                            <p className="mt-0.5 text-[13px] leading-relaxed text-[#97A2BA]">{s.d}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <aside className="rounded-2xl border border-white/[0.1] bg-[#121729]/90 p-5 sm:p-6">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#5B6580]">
                      Important
                    </p>
                    <p className="mt-3 text-[13px] leading-relaxed text-[#97A2BA]">
                      SuperNova is an information and research tool. EIS and Soft BUY/SELL are
                      probabilistic estimates built from public data — not financial advice, and not
                      a recommendation to buy or sell any security. Always do your own research.
                    </p>
                  </aside>
                </div>
              </section>

              {/* ── Pricing ── */}
              <section id="pricing" className="scroll-mt-24 space-y-8 sn-landing-fade-up">
                <div className="mx-auto max-w-2xl space-y-3 text-center">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#5B6580]">
                    Pricing
                  </p>
                  <h2 className="text-[1.75rem] font-semibold tracking-tight text-white sm:text-[2.1rem]">
                    Basic is Free. Premium goes deeper and further.
                  </h2>
                  <p className="text-[14px] leading-relaxed text-[#97A2BA]">
                    Free and Basic are the same plan: company &amp; product intelligence, Daily News
                    and near-term inflection points. Premium extends the calendar, the book you
                    track, and early Discovery.
                  </p>
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  {/* Basic */}
                  <aside className="flex flex-col rounded-2xl border border-white/[0.1] bg-[#121729]/85 p-6 sm:p-7">
                    <span className="inline-flex w-fit rounded-full border border-white/15 bg-white/[0.05] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#C5CDDC]">
                      Basic
                    </span>
                    <p className="mt-4 text-[2rem] font-semibold tracking-tight text-white">Free</p>
                    <p className="text-[15px] font-semibold text-white">
                      EUR 0 <span className="font-medium text-[#97A2BA]">/ month</span>
                    </p>
                    <p className="mt-2 text-[13px] text-[#97A2BA]">
                      Basic = Free. Full Pharma intelligence desk at EUR 0 for the near term.
                    </p>
                    <ul className="mt-6 flex-1 space-y-4">
                      {BASIC_FEATURES.map((f) => (
                        <li key={f.label} className="flex gap-2.5 text-[13px] leading-snug text-[#C5CDDC]">
                          <CheckIcon />
                          <span className="min-w-0 space-y-1.5">
                            <span className="block">
                              <span className="font-semibold text-white">{f.label}</span>
                              {" — "}
                              {f.bold}
                            </span>
                            {"detail" in f && f.detail ? (
                              <span className="block text-[12px] leading-relaxed text-[#97A2BA]">
                                {f.detail}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="mt-8 w-full rounded-xl border border-white/20 px-4 py-3 text-[14px] font-semibold text-white transition-colors hover:bg-white/[0.06]"
                      onClick={goGetStarted}
                    >
                      Join free
                    </button>
                  </aside>

                  {/* Premium */}
                  <aside
                    ref={premiumCardRef}
                    className={`sn-landing-premium-card flex flex-col ${
                      highlightPremium ? "ring-2 ring-[#F3C451]/70 ring-offset-2 ring-offset-[#0B0D17]" : ""
                    }`}
                  >
                    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-[#F3C451] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#1A1406]">
                      <BrandMark className="h-3 w-3 !text-[#1A1406]" />
                      Premium — waitlist
                    </span>
                    <p className="mt-4 text-[2rem] font-semibold tracking-tight text-white">
                      Premium
                    </p>
                    <p className="mt-2 text-[13px] leading-relaxed text-[#97A2BA]">
                      Everything in Free / Basic, plus a longer inflection calendar, Discovery, and
                      your own tracked book across the full desk.
                    </p>
                    <p className="mt-3 rounded-lg border border-[#F3C451]/35 bg-[#F3C451]/10 px-3 py-2 text-[12px] leading-snug text-[#F3C451]">
                      In development — not available yet. Join the early-access list to test Premium
                      free as soon as it opens; Basic stays free either way.
                    </p>
                    <ul className="mt-6 flex-1 space-y-4">
                      {PREMIUM_FEATURES.map((f) => (
                        <li key={f.label} className="flex gap-2.5 text-[13px] leading-snug text-[#C5CDDC]">
                          <CheckIcon tone="gold" />
                          <span className="min-w-0 space-y-1.5">
                            <span className="block">
                              <span className="font-semibold text-white">{f.label}</span>
                              {" — "}
                              {f.bold}
                            </span>
                            {"detail" in f && f.detail ? (
                              <span className="block text-[12px] leading-relaxed text-[#97A2BA]">
                                {f.detail}
                              </span>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {waitlistOk ? (
                      <p className="mt-8 text-[13px] leading-snug text-[#34D399]">
                        {waitlistAlready
                          ? `You're already on the list${waitlistPosition ? ` (#${waitlistPosition})` : ""}.`
                          : `You're on the list${waitlistPosition ? ` (#${waitlistPosition})` : ""}.`}{" "}
                        We&apos;ll email you when Premium opens for early free testing. The operator
                        also sees your request in the Access tab and can grant full app access.
                      </p>
                    ) : (
                      <div className="mt-8 space-y-3">
                        <label className="block space-y-1.5">
                          <span className="text-[11px] font-semibold uppercase tracking-wide text-white/55">
                            Email for early access
                          </span>
                          <FieldShell>
                            <input
                              type="email"
                              className="sn-landing-field"
                              value={waitlistEmail}
                              onChange={(e) => setWaitlistEmail(e.target.value)}
                              placeholder="you@email.com"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") joinWaitlist();
                              }}
                            />
                          </FieldShell>
                        </label>
                        {waitlistErr ? (
                          <p className="text-[12px] text-[#F87185]">{waitlistErr}</p>
                        ) : null}
                        <button
                          type="button"
                          disabled={waitlistBusy || !waitlistEmail.trim().includes("@")}
                          className="w-full rounded-xl bg-[#F3C451] px-4 py-3 text-[14px] font-bold text-[#1A1406] shadow-[0_10px_28px_rgba(243,196,81,0.28)] transition-colors hover:bg-[#F6D36A] disabled:opacity-45"
                          onClick={joinWaitlist}
                        >
                          {waitlistBusy ? "…" : "Join the early-access list"}
                        </button>
                        <p className="text-[11px] leading-snug text-[#97A2BA] text-center">
                          Your request appears in the operator Access tab for approval.
                        </p>
                      </div>
                    )}
                  </aside>
                </div>
              </section>

              {/* ── FAQ ── */}
              <section id="faq" className="scroll-mt-24 space-y-6 sn-landing-fade-up">
                <div className="max-w-2xl space-y-2">
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#5B6580]">
                    FAQ
                  </p>
                  <h2 className="text-[1.75rem] font-semibold tracking-tight text-white sm:text-[2rem]">
                    Before you ask
                  </h2>
                </div>
                <div className="divide-y divide-white/[0.07] overflow-hidden rounded-2xl border border-white/[0.08] bg-[#121729]/80">
                  {FAQ_ITEMS.map((item) => (
                    <div key={item.q} className="space-y-2 px-5 py-5 sm:px-6">
                      <h3 className="text-[14px] font-semibold text-white">{item.q}</h3>
                      <p className="text-[13px] leading-relaxed text-[#97A2BA]">{item.a}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          ) : null}

          {showRequest ? (
            <section className="relative mx-auto w-full max-w-lg space-y-6 py-4">
              <div>
                <h1 className="text-[2rem] font-semibold tracking-tight text-[#F3F5FA]">
                  Request access
                </h1>
                <p
                  className="mt-3 inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.14em]"
                  style={
                    vertical === "tech"
                      ? {
                          borderColor: `rgba(${HITECH_GREEN_RGB},0.35)`,
                          backgroundColor: `rgba(${HITECH_GREEN_RGB},0.12)`,
                          color: HITECH_GREEN_SOFT,
                        }
                      : {
                          borderColor: "rgba(255,255,255,0.2)",
                          backgroundColor: "rgba(255,255,255,0.06)",
                          color: "#C5CDDC",
                        }
                  }
                >
                  {vertical === "tech"
                    ? "High-tech waitlist · Coming soon"
                    : "Basic membership · Free"}
                </p>
                <p className="mt-2 text-[15px] leading-snug text-[#97A2BA]">
                  {vertical === "tech"
                    ? "Leave your email for the Technology / AI desk. We’ll notify you when SuperNova High-tech opens — Biotech & Medtech is live today if you want to start there."
                    : "Submit your email to join the Basic (Free) beta. Access stays pending until the operator approves you — then you get an email and can Sign in. You get company & product intelligence, Daily News (including FDA briefings), and near-term inflection points."}
                </p>
              </div>
              <aside className="sn-landing-card w-full">
                <div className="space-y-4">
                  <label className="block space-y-2">
                    <span className="text-[13px] font-medium text-[#F3F5FA]">Email address</span>
                    <FieldShell>
                      <input
                        type="email"
                        required
                        className="sn-landing-field"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        autoComplete="email"
                        placeholder="name@example.com"
                      />
                    </FieldShell>
                  </label>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <label className="block space-y-2">
                      <span className="text-[13px] font-medium text-[#F3F5FA]">First name</span>
                      <FieldShell>
                        <input
                          className="sn-landing-field"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          autoComplete="given-name"
                          placeholder="Mario"
                          maxLength={60}
                          required
                        />
                      </FieldShell>
                    </label>
                    <label className="block space-y-2">
                      <span className="text-[13px] font-medium text-[#F3F5FA]">Last name</span>
                      <FieldShell>
                        <input
                          className="sn-landing-field"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          autoComplete="family-name"
                          placeholder="Rossi"
                          maxLength={60}
                          required
                        />
                      </FieldShell>
                    </label>
                  </div>
                  <label className="block space-y-2">
                    <span className="text-[13px] font-medium text-[#F3F5FA]">Year of birth</span>
                    <FieldShell>
                      <input
                        type="text"
                        inputMode="numeric"
                        className="sn-landing-field"
                        value={birthYear}
                        onChange={(e) =>
                          setBirthYear(e.target.value.replace(/\D/g, "").slice(0, 4))
                        }
                        autoComplete="bday-year"
                        placeholder="1990"
                        maxLength={4}
                        required
                      />
                    </FieldShell>
                  </label>
                  <label className="block space-y-2">
                    <span className="text-[13px] font-medium text-[#F3F5FA]">
                      Investment spaces of interest
                    </span>
                    <FieldShell>
                      <textarea
                        className="sn-landing-field min-h-[4.75rem] resize-none"
                        value={interestSpaces}
                        onChange={(e) => setInterestSpaces(e.target.value)}
                        placeholder="e.g. Biotech, Medtech, AI…"
                        required
                      />
                    </FieldShell>
                  </label>
                  {errLabel ? <p className="text-[12px] text-[#F87185]">{errLabel}</p> : null}
                  <button
                    type="button"
                    disabled={
                      authBusy ||
                      !email.trim().includes("@") ||
                      firstName.trim().length < 1 ||
                      lastName.trim().length < 1 ||
                      !/^(19|20)\d{2}$/.test(birthYear.trim()) ||
                      interestSpaces.trim().length < 2
                    }
                    className="mt-1 w-full rounded-xl bg-[#7C6CF3] px-4 py-3 text-[15px] font-semibold text-white shadow-[0_10px_32px_rgba(124,108,243,0.38)] transition-colors hover:bg-[#8B7CFF] disabled:opacity-45"
                    onClick={() => {
                      const em = email.trim();
                      const fn = firstName.trim();
                      const ln = lastName.trim();
                      const year = Number.parseInt(birthYear.trim(), 10);
                      const spaces = interestSpaces.trim();
                      const yMax = new Date().getFullYear() - 16;
                      const yMin = 1920;
                      if (
                        !em.includes("@") ||
                        !fn ||
                        !ln ||
                        !Number.isFinite(year) ||
                        year < yMin ||
                        year > yMax ||
                        spaces.length < 2
                      ) {
                        return;
                      }
                      onRequestAccess({
                        email: em,
                        displayName: `${fn} ${ln}`,
                        firstName: fn,
                        lastName: ln,
                        birthYear: year,
                        edition: inferEdition(spaces),
                        otherSpaces: spaces,
                      });
                    }}
                  >
                    {authBusy ? "…" : "Request Access"}
                  </button>
                  <p className="pt-0.5 text-center text-[12px] leading-snug text-[#5B6580]">
                    Tutti i campi sono obbligatori per richiedere l&apos;accesso.
                  </p>
                </div>
              </aside>
            </section>
          ) : null}

          {showSignIn ? (
            <section className="mx-auto grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,380px)]">
              <div className="min-w-0 space-y-4">
                <button
                  type="button"
                  className="text-[12px] text-white/50 hover:text-white/80"
                  onClick={() => setPanel("main")}
                >
                  ← Back to SuperNova
                </button>
                <p className="text-[11px] font-semibold tracking-[0.22em] uppercase text-[#A79AFF]">
                  Members
                </p>
                <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                  Sign in to SuperNova
                </h1>
                <p className="max-w-md text-[15px] leading-relaxed text-white/65">
                  Sign in only after the operator has approved your Request Access. Until then the
                  desk stays locked.
                </p>
              </div>
              <aside className="sn-landing-card w-full">
                <h2 className="text-lg font-semibold text-white">Sign in</h2>
                <p className="mt-1 text-[12px] text-white/55">Approved beta accounts only</p>
                <div className="mt-5 space-y-3">
                  <FieldShell>
                    <input
                      type="email"
                      required
                      className="sn-landing-field"
                      value={signInEmail}
                      onChange={(e) => setSignInEmail(e.target.value)}
                      autoComplete="email"
                      placeholder="name@example.com"
                      aria-label="Email address"
                    />
                  </FieldShell>
                  {errLabel ? <p className="text-[12px] text-rose-300">{errLabel}</p> : null}
                  <button
                    type="button"
                    disabled={authBusy || !signInEmail.trim().includes("@")}
                    className="w-full rounded-lg bg-[#7C6CF3] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_0_24px_rgba(124,58,237,0.35)] hover:brightness-110 disabled:opacity-50 transition-colors"
                    onClick={() => onSignIn(signInEmail.trim())}
                  >
                    {authBusy ? "…" : "Continue"}
                  </button>
                  <button
                    type="button"
                    className="w-full text-center text-[12px] text-white/50 hover:text-white/80"
                    onClick={() => setPanel("request")}
                  >
                    Need access? Request Access →
                  </button>
                </div>
              </aside>
            </section>
          ) : null}
        </main>

        {hideChrome ? null : (
          <footer className="mt-auto border-t border-white/10 pt-10 mt-16">
            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <BrandMark className="h-3.5 w-3.5" />
                  <span className="text-[12px] font-bold tracking-[0.18em] uppercase text-white/80">
                    Supernova
                  </span>
                </div>
                <p className="max-w-xs text-[13px] leading-relaxed text-white/45">
                  Pharma &amp; biotech intelligence — science, financials and catalyst timing in one
                  desk.
                </p>
              </div>
              <div className="space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">
                  Product
                </p>
                <button
                  type="button"
                  className="block text-[13px] text-white/55 transition-colors hover:text-white/85"
                  onClick={() =>
                    document.getElementById("product")?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  Company files
                </button>
                <button
                  type="button"
                  className="block text-[13px] text-white/55 transition-colors hover:text-white/85"
                  onClick={() =>
                    document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  Catalysts
                </button>
                <button
                  type="button"
                  className="block text-[13px] text-white/55 transition-colors hover:text-white/85"
                  onClick={() =>
                    document.getElementById("methodology")?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  EIS scoring
                </button>
              </div>
              <div className="space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">
                  Company
                </p>
                <button
                  type="button"
                  className="block text-[13px] text-white/55 transition-colors hover:text-white/85"
                  onClick={() => {
                    setContactOk(false);
                    setContactErr(null);
                    setPanel("contact");
                  }}
                >
                  Contact
                </button>
                <button
                  type="button"
                  className="block text-[13px] text-white/55 transition-colors hover:text-white/85"
                  onClick={() =>
                    document.getElementById("faq")?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  FAQ
                </button>
              </div>
              <div className="space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/40">
                  Legal
                </p>
                <button
                  type="button"
                  className="block text-[13px] text-white/55 transition-colors hover:text-white/85"
                  onClick={() =>
                    document.getElementById("methodology")?.scrollIntoView({ behavior: "smooth" })
                  }
                >
                  Disclaimer
                </button>
                <p className="text-[12px] text-white/35">Privacy &amp; Terms — coming soon</p>
              </div>
            </div>
            <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-5">
              <p className="text-[12px] text-white/40">
                © 2026 SuperNova. Not investment advice — see disclaimer.
              </p>
              <p className="text-[12px] text-white/40">Private Beta</p>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
