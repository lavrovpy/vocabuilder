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
  sourceLanguage: "en",
  targetLanguage: "uk",
}));

export const closeMainWindow = vi.fn(async () => {});

export const showToast = vi.fn(async (options: { title: string; message?: string; style?: string }) => ({
  ...options,
  hide: vi.fn(async () => {}),
  show: vi.fn(async () => {}),
}));

export const openExtensionPreferences = vi.fn(async () => {});

export const Action = Object.assign(
  vi.fn(() => null),
  {
    CopyToClipboard: vi.fn(() => null),
    Style: {
      Destructive: "destructive",
    },
  },
);

export const ActionPanel = vi.fn(() => null);

export const List = Object.assign(
  vi.fn(() => null),
  {
    EmptyView: vi.fn(() => null),
    Item: Object.assign(
      vi.fn(() => null),
      {
        Detail: Object.assign(
          vi.fn(() => null),
          {
            Metadata: Object.assign(
              vi.fn(() => null),
              {
                Label: vi.fn(() => null),
              },
            ),
          },
        ),
      },
    ),
    Section: vi.fn(() => null),
  },
);

export const Detail = vi.fn(() => null);

export const Icon = new Proxy(
  {},
  {
    get: (_target, prop) => String(prop),
  },
) as Record<string, string>;

export const Color = new Proxy(
  {},
  {
    get: (_target, prop) => String(prop),
  },
) as Record<string, string>;

export const Toast = {
  Style: {
    Animated: "animated",
    Failure: "failure",
    Success: "success",
  },
};

export const Keyboard = {
  Shortcut: {
    Common: {},
  },
};

export function useNavigation() {
  return {
    push: vi.fn(),
    pop: vi.fn(),
  };
}

export const environment = {
  supportPath: "/tmp/vocabuilder-test-support",
};
