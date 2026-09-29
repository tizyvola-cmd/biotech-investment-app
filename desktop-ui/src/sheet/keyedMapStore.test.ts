import { describe, expect, it, vi } from "vitest";
import { createKeyedMapStore } from "./keyedMapStore";

describe("keyedMapStore", () => {
  it("notifies only the changed key subscribers", () => {
    const store = createKeyedMapStore<{ ticker: string; n: number }>();
    const a = vi.fn();
    const b = vi.fn();
    const global = vi.fn();
    store.subscribeKey("AAA", a);
    store.subscribeKey("BBB", b);
    store.subscribe(global);

    store.setMany({ AAA: { ticker: "AAA", n: 1 } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(0);
    expect(global).toHaveBeenCalledTimes(1);

    store.setMany({ BBB: { ticker: "BBB", n: 2 } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(global).toHaveBeenCalledTimes(2);

    // shallow-equal reprint does not notify
    store.setMany({ AAA: { ticker: "AAA", n: 1 } });
    expect(a).toHaveBeenCalledTimes(1);
    expect(global).toHaveBeenCalledTimes(2);
  });

  it("keeps memory writes while UI notifications are paused", () => {
    const store = createKeyedMapStore<{ ticker: string; n: number }>();
    const a = vi.fn();
    store.subscribeKey("AAA", a);
    store.setMany({ AAA: { ticker: "AAA", n: 1 } });
    expect(a).toHaveBeenCalledTimes(1);

    store.setNotifyEnabled(false);
    store.setMany({ AAA: { ticker: "AAA", n: 2 } });
    expect(store.get("AAA")?.n).toBe(2);
    expect(a).toHaveBeenCalledTimes(1);

    store.setNotifyEnabled(true);
    expect(store.flushPending()).toBe(1);
    expect(a).toHaveBeenCalledTimes(2);
  });

  it("preserves prior object identity on equal reprints", () => {
    const store = createKeyedMapStore<{ ticker: string; n: number }>();
    const first = { ticker: "AAA", n: 1 };
    store.setMany({ AAA: first });
    store.setMany({ AAA: { ticker: "AAA", n: 1 } });
    expect(store.get("AAA")).toBe(first);
  });
});
