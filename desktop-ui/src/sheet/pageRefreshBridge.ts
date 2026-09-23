/**
 * Bridge so AppTopBar can run the current page Refresh (Catalyst desk).
 * Soft BUY/SELL unchanged — display chrome only.
 */
type RefreshFn = () => void | Promise<void>;

type PageRefreshState = {
  handler: RefreshFn | null;
  loading: boolean;
  tooltip?: string;
};

let state: PageRefreshState = {
  handler: null,
  loading: false,
};

const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function registerPageRefresh(next: {
  handler: RefreshFn | null;
  loading?: boolean;
  tooltip?: string;
}): () => void {
  state = {
    handler: next.handler,
    loading: Boolean(next.loading),
    tooltip: next.tooltip,
  };
  emit();
  return () => {
    if (state.handler === next.handler) {
      state = { handler: null, loading: false };
      emit();
    }
  };
}

export function setPageRefreshLoading(loading: boolean): void {
  if (state.loading === loading) return;
  state = { ...state, loading };
  emit();
}

export function getPageRefreshState(): PageRefreshState {
  return state;
}

export function subscribePageRefresh(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function runRegisteredPageRefresh(): Promise<void> {
  const h = state.handler;
  if (!h) return;
  await h();
}
