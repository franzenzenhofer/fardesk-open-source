// Temp Claude homes that are disposed together at the end of a test.
import { createClaudeHome } from "./claudeHome.js";
import type { ClaudeHome } from "./claudeHome.js";

export type HomeTracker = { newHome(): ClaudeHome; disposeAll(): void };

export function trackHomes(): HomeTracker {
  const homes: ClaudeHome[] = [];
  return {
    newHome(): ClaudeHome {
      const home = createClaudeHome();
      homes.push(home);
      return home;
    },
    disposeAll(): void {
      for (const home of homes.splice(0)) home.dispose();
    },
  };
}
