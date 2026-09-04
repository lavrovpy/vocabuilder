import { vi } from "vitest";

const store = new Map<string, string>();

export const LocalStorage = {
  getItem: vi.fn(async (key: string) => store.get(key) ?? undefined),
  setItem: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  removeItem: vi.fn(async (key: string) => {
    store.delete(key);
  }),
  clear: vi.fn(async () => {
    store.clear();
  }),
  _store: store,
};

export const getPreferenceValues = vi.fn(() => ({
  geminiApiKey: "test-api-key",
  geminiApiBaseUrl: "https://generativelanguage.googleapis.com",
  sourceLanguage: "en",
  targetLanguage: "uk",
  translationModel: "gemini-3.5-flash",
  ttsModel: "gemini-3.1-flash-tts-preview",
}));

export const environment = {
  supportPath: "/tmp/vocabuilder-test-support",
};

// colors.ts reads Color.Blue etc. at module load — Proxy keeps that working
// without enumerating every Raycast color name. It must reproduce the real
// "raycast-<kebab>" token, not the member name: posPill() interpolates the value
// straight into a ?raycast-tintColor= URL, so a mock returning "Blue" would let a
// broken tint slip through green tests.
export const Color = new Proxy(
  {},
  {
    get: (_target, prop) =>
      `raycast-${String(prop)
        .replace(/([a-z])([A-Z])/g, "$1-$2")
        .toLowerCase()}`,
  },
) as Record<string, string>;

export const Toast = {
  Style: { Animated: "animated", Failure: "failure", Success: "success" },
};

export const showToast = vi.fn(async () => ({ hide: vi.fn(async () => {}) }));

// Placeholders: imported by .tsx files but only accessed inside render/handler
// bodies, which tests never invoke. Exist so the import statement resolves.
export const Action = {} as never;
export const ActionPanel = {} as never;
export const List = {} as never;
export const Detail = {} as never;
export const Icon = new Proxy({}, { get: (_target, name) => name }) as never;
export const Keyboard = {} as never;
export const closeMainWindow = vi.fn(async () => {});
export const openExtensionPreferences = vi.fn(async () => {});
export const useNavigation = () => ({ push: vi.fn(), pop: vi.fn() });
