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
  | "gain_note";

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
    dry_run?: boolean;
  };
  mvp_doc: string;
  defaults: { predictions: string; tracking: string };
};
