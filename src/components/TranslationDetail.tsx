import { List } from "@raycast/api";
import { buildTextTranslationDetailMarkdown, buildTranslationDetailMarkdown, withTtsHint } from "../lib/markdown";
import { Translation } from "../lib/types";

type TranslationDetailInput = Pick<
  Translation,
  "type" | "word" | "translation" | "partOfSpeech" | "example" | "exampleTranslation"
>;

export function buildDetailMarkdown(item: TranslationDetailInput, originalInput?: string): string {
  const body =
    item.type === "text"
      ? buildTextTranslationDetailMarkdown(item.word, item.translation)
      : buildTranslationDetailMarkdown(item, originalInput);
  return withTtsHint(body);
}

interface TranslationDetailProps {
  item: Translation;
  originalInput?: string;
}

export function TranslationDetail({ item, originalInput }: TranslationDetailProps) {
  return <List.Item.Detail markdown={buildDetailMarkdown(item, originalInput)} />;
}
