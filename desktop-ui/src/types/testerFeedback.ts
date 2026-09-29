export type TesterFeedbackModule =
  | "dashboard"
  | "simulation"
  | "decisionLab"
  | "catalystFeed"
  | "portfolio"
  | "opportunities";

export type TesterFeedbackKind =
  | "session_ping"
  | "prediction_outcome"
  | "slope_error"
  | "signal_feedback"
  | "catalyst_label"
  | "gain_note"
  | "ui_error";

export type TesterFeedbackSource = "mobile" | "desktop" | "api";

export type TesterMeta = {
  tester_id: string;
  display_name: string;
  email?: string;
  invite_code?: string;
  status?: "pending" | "approved" | "revoked" | string;
  source?: string;
  created_at?: string;
  last_seen_at?: string;
  status_updated_at?: string;
  approval_email_sent_at?: string;
  event_count?: number;
  session_ping_count?: number;
  events_in_store?: number;
  usage_minutes_today?: number;
  /** UTC yesterday session minutes (session_ping). */
  usage_minutes_yesterday?: number;
  /** % change today vs yesterday (null when both zero). */
  usage_minutes_delta_pct?: number | null;
  usage_minutes_total?: number;
  /** Premium unlocks Calendar, Discovery, companies-of-interest enroll. */
  premium?: boolean;
  ui_error_count?: number;
  last_ui_error_at?: string | null;
  last_ui_error_label?: string | null;
  last_ui_error_message?: string | null;
  open_ui_issue_id?: string | null;
  open_ui_issue_at?: string | null;
  /** Present on register / status responses */
  allowed?: boolean;
  interest_edition?: "biotech" | "tech" | "both" | string;
  interest_other?: string;
  first_name?: string;
  last_name?: string;
  birth_year?: number | null;
  last_owner_reply_at?: string;
  owner_reply?: {
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    to?: string;
    from?: string;
    gmail_compose_url?: string;
  };
  portfolio?: {
    open_positions?: number;
    closed_positions?: number;
    open_capital_eur?: number;
    store_path?: string;
    updated_at?: string | null;
  } | null;
  approval_email?: {
    ok?: boolean;
    skipped?: boolean;
    reason?: string;
    to?: string;
    welcome_url?: string | null;
  };
};

export type TesterFeedbackEvent = {
  id: string;
  tester_id: string;
  source: TesterFeedbackSource;
  module: TesterFeedbackModule;
  kind: TesterFeedbackKind;
  ticker: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

export type TesterFeedbackSummary = {
  schema_version: number;
  updated_at: string | null;
  store_path: string;
  tester_count: number;
  events_total: number;
  active_testers_24h: number;
  active_testers_7d: number;
  pending_testers?: number;
  approved_testers?: number;
  revoked_testers?: number;
  by_status?: Record<string, number>;
  by_module: Record<string, number>;
  by_kind: Record<string, number>;
  testers: TesterMeta[];
  recent_events: TesterFeedbackEvent[];
  recent_ui_errors?: TesterFeedbackEvent[];
  /** Open user UI issues for Access admin queue (not yet Resolved). */
  open_ui_issues?: TesterFeedbackEvent[];
  open_ui_issue_count?: number;
  ui_error_count?: number;
  ui_error_count_24h?: number;
  ui_error_count_all?: number;
  valid_modules: string[];
  valid_kinds: string[];
};

export type TesterFeedbackConfig = {
  schema_version: number;
  store_path: string;
  valid_modules: string[];
  valid_kinds: string[];
  invite_required?: boolean;
  approval_email?: {
    smtp_configured?: boolean;
    mobile_public_url?: string | null;
    desktop_public_url?: string | null;
    owner_notify_email?: string | null;
    gmail_reply_email?: string | null;
    dry_run?: boolean;
  };
  mvp_doc: string;
  defaults: { predictions: string; tracking: string };
};

export type TesterSimPosition = {
  ticker: string;
  name: string | null;
  completion_date: string;
  state: "open" | "closed";
  invested_at: string | null;
  sold_at: string | null;
  buy_price_usd: number | null;
  capital_eur: number;
  current_price_usd: number | null;
  value_eur?: number;
  open_pnl_eur?: number;
  open_pnl_pct?: number | null;
  closed_value_eur?: number;
  closed_pnl_eur?: number;
  closed_pnl_pct?: number | null;
  signal_up_now: boolean;
  unavailable?: boolean;
};

export type TesterSimTotals = {
  buys_count: number;
  open_count: number;
  closed_count: number;
  open_capital_eur: number;
  open_gain_eur: number;
  open_gain_pct: number | null;
  closed_gain_eur: number;
  total_gain_eur: number;
  aligned_buys: number;
  follow_rate_pct: number | null;
};

export type TesterSimRow = {
  tester_id: string;
  email: string;
  display_name: string;
  status: string;
  sim_updated_at: string | null;
  last_seen_at: string | null;
  totals: TesterSimTotals;
  positions: TesterSimPosition[];
};

export type TesterSimAggregate = {
  tester_count: number;
  testers_with_activity: number;
  total_open_positions: number;
  total_closed_positions: number;
  total_open_capital_eur: number;
  total_open_gain_eur: number;
  total_open_gain_pct: number | null;
  total_closed_gain_eur: number;
  total_gain_eur: number;
  avg_follow_rate_pct: number | null;
};

export type TesterSimMonitor = {
  generated_at: string;
  sim_snapshot_available: boolean;
  aggregate: TesterSimAggregate;
  testers: TesterSimRow[];
};
