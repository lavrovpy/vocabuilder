import { Keyboard } from "@raycast/api";

// Every chord stays anchored on cmd. Bare opt+<letter> is macOS's compose layer
// (Polish Pro opt+o -> ó, US opt+e -> dead-key acute), and all three commands are
// Lists whose search bar holds focus while the user types foreign words.
export const SHORTCUTS = {
  toggleLanguages: { modifiers: ["cmd", "shift"], key: "t" },
  openHistory: { modifiers: ["cmd", "shift"], key: "h" },
  copyTranslation: { modifiers: ["cmd"], key: "c" },

  // TODO: two free letters from ⌘⇧B E F G I J L M N R U V X Y Z.
  // ⌘⇧J is spoken for below; ⌘⇧K/W/P are avoided as reserved siblings.
  pronounceWord: { modifiers: ["cmd", "shift"], key: "l" },
  pronounceTranslation: { modifiers: ["cmd", "shift"], key: "r" },

  exportJson: { modifiers: ["cmd", "shift"], key: "j" },
  exportAnki: { modifiers: ["cmd", "shift"], key: "a" },
  exportQuizlet: { modifiers: ["cmd", "shift"], key: "q" },

  // TODO: adopt Keyboard.Shortcut.Common.Remove / .RemoveAll (⌃D / ⌃⇧D) instead?
  deleteEntry: { modifiers: ["cmd"], key: "d" },
  clearAllHistory: { modifiers: ["cmd", "shift"], key: "d" },

  rateAgain: { modifiers: [], key: "1" },
  rateEasy: { modifiers: [], key: "2" },
} satisfies Record<string, Keyboard.Shortcut>;
