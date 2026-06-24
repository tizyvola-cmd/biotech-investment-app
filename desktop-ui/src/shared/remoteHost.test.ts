import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRemoteApiBase,
  isLocalDesktopShell,
  isRemoteDataMode,
  resolveApiBase,
  resolveProjectDataBase,
  setRemoteApiBase,
} from "./remoteHost";

function mockStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe("remoteHost Electron priority", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = mockStorage();
    vi.stubGlobal("localStorage", storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores stale VPS sn_api_base when Electron shell is present", () => {
    vi.stubGlobal("window", {
      supernova: {
        apiBase: "http://127.0.0.1:8765",
        projectDataBase: "project-data://local/",
      },
      localStorage: storage,
      dispatchEvent: vi.fn(),
    });

    setRemoteApiBase("http://91.99.15.48:8765");

    expect(getRemoteApiBase()).toBe("http://91.99.15.48:8765");
    expect(isRemoteDataMode()).toBe(false);
    expect(isLocalDesktopShell()).toBe(true);
    expect(resolveApiBase()).toBe("http://127.0.0.1:8765");
    expect(resolveProjectDataBase()).toBe("project-data://local/");
  });

  it("uses VPS when not in Electron shell", () => {
    vi.stubGlobal("window", {
      localStorage: storage,
      dispatchEvent: vi.fn(),
    });

    setRemoteApiBase("http://91.99.15.48:8765");

    expect(isRemoteDataMode()).toBe(true);
    expect(resolveApiBase()).toBe("http://91.99.15.48:8765");
    expect(resolveProjectDataBase()).toBe("http://91.99.15.48:8765/project-data/");
  });

  it("prefers VITE_API_BASE over stale VPS when Electron build without preload", () => {
    vi.stubGlobal("window", {
      localStorage: storage,
      dispatchEvent: vi.fn(),
    });
    vi.stubEnv("VITE_ELECTRON", "1");
    vi.stubEnv("VITE_API_BASE", "http://127.0.0.1:8765");

    setRemoteApiBase("http://91.99.15.48:8765");

    expect(resolveApiBase()).toBe("http://127.0.0.1:8765");
  });
});
