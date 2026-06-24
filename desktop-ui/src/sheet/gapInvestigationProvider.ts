import type {
  GapContextFinding,
  GapContextProvider,
  GapEvent,
} from "./gapInvestigationTypes";

/** Placeholder until real news / 8-K provider (brief Phase 2b). */
export class StubGapContextProvider implements GapContextProvider {
  async investigate(event: GapEvent): Promise<GapContextFinding> {
    // TODO: sostituire con provider reale (web search / news API / EDGAR) — vedi brief Fase 2b.
    return {
      ticker: event.ticker,
      hasSpecificNews: false,
      newsType: "unknown",
      summary: null,
      sourceUrl: null,
      confidence: "low",
    };
  }
}

let defaultProvider: GapContextProvider = new StubGapContextProvider();

export function getGapContextProvider(): GapContextProvider {
  return defaultProvider;
}

export function setGapContextProvider(provider: GapContextProvider): void {
  defaultProvider = provider;
}
