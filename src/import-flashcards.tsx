import { Action, ActionPanel, Form, showToast, Toast, popToRoot, useNavigation } from "@raycast/api";
import { useState } from "react";
import { useLanguagePair } from "./hooks/useLanguagePair";
import LanguageConfigError from "./components/LanguageConfigError";
import { readAndParseImportFile, ImportFormat } from "./lib/import";
import { importTranslations } from "./lib/storage";

export default function ImportFlashcards(props: { onImportComplete?: () => void }) {
  const langResult = useLanguagePair();
  const { pop } = useNavigation();
  const [isLoading, setIsLoading] = useState(false);

  if (!langResult.pair) {
    return <LanguageConfigError message={langResult.error ?? "Invalid language configuration."} />;
  }

  const pair = langResult.pair;

  async function handleSubmit(values: { file: string[]; format: string }) {
    const filePaths = values.file;
    if (!filePaths || filePaths.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: "No file selected" });
      return;
    }

    const filePath = filePaths[0];
    const format = (values.format || "auto") as ImportFormat;

    setIsLoading(true);
    try {
      const translations = await readAndParseImportFile(filePath, format);
      if (translations.length === 0) {
        await showToast({
          style: Toast.Style.Failure,
          title: "No cards found",
          message: "The file contains no valid flashcard entries.",
        });
        return;
      }

      const result = await importTranslations(translations, pair);
      if (!result) {
        await showToast({
          style: Toast.Style.Failure,
          title: "Storage is corrupted",
          message: "Import skipped to avoid overwriting existing data.",
        });
        return;
      }

      const message =
        result.skipped > 0
          ? `${result.imported} imported, ${result.skipped} duplicates skipped`
          : `${result.imported} cards imported`;

      await showToast({ style: Toast.Style.Success, title: "Import complete", message });
      if (props.onImportComplete) {
        props.onImportComplete();
        pop();
      } else {
        await popToRoot();
      }
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Import failed",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      navigationTitle={`Import → ${pair.source.name} → ${pair.target.name}`}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Import Flashcards" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Import Flashcards"
        text={`Import flashcards into your ${pair.source.name} → ${pair.target.name} vocabulary. Supports Anki TSV exports and VocaBuilder JSON files.`}
      />
      <Form.FilePicker id="file" title="File" allowMultipleSelection={false} canChooseDirectories={false} />
      <Form.Dropdown id="format" title="Format" defaultValue="auto">
        <Form.Dropdown.Item value="auto" title="Auto-detect" />
        <Form.Dropdown.Item value="anki" title="Anki TSV" />
        <Form.Dropdown.Item value="json" title="VocaBuilder JSON" />
      </Form.Dropdown>
    </Form>
  );
}
