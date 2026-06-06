export function normalizeGeminiModelId(model: string): string {
  return model.trim().replace(/^models\//, "");
}
