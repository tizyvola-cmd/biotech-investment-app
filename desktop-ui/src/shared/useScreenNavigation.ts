import { useCallback, useState } from "react";
import type { AppScreen } from "../types";

const MAX_SCREEN_HISTORY = 24;

export type ScreenNavigation = {
  screen: AppScreen;
  /** Navigate to a tab; pushes the current tab onto the back stack. */
  navigateTo: (next: AppScreen) => void;
  goBack: () => void;
  canGoBack: boolean;
  /** Tab immediately before the current one (top of back stack). */
  previousScreen: AppScreen | null;
};

/**
 * App-level tab navigation with a back stack.
 * Use `navigateTo` everywhere instead of raw `setScreen` so the top-bar back arrow works.
 */
export function useScreenNavigation(initialScreen: AppScreen = "main"): ScreenNavigation {
  const [screen, setScreen] = useState<AppScreen>(initialScreen);
  const [backStack, setBackStack] = useState<AppScreen[]>([]);

  const navigateTo = useCallback((next: AppScreen) => {
    setScreen((current) => {
      if (next === current) return current;
      setBackStack((stack) => [...stack.slice(-(MAX_SCREEN_HISTORY - 1)), current]);
      return next;
    });
  }, []);

  const goBack = useCallback(() => {
    setBackStack((stack) => {
      if (stack.length === 0) return stack;
      const prev = stack[stack.length - 1]!;
      setScreen(prev);
      return stack.slice(0, -1);
    });
  }, []);

  const previousScreen = backStack.length > 0 ? backStack[backStack.length - 1]! : null;

  return {
    screen,
    navigateTo,
    goBack,
    canGoBack: backStack.length > 0,
    previousScreen,
  };
}
