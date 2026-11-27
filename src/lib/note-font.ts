// The note-font hook (seq 225 remainder F16): an Info sheet or floating
// note reads the stored note font and re-reads it when the Preferences
// dialog changes it. Kept apart from preferences.ts so that module stays
// pure (figure.ts and format.ts import it).
import * as React from "react";
import { loadNoteFont, NOTE_FONT_CHANGED_EVENT, noteFontFamily, type NoteFont } from "./preferences";

/** The note font for a component: re-reads when the dialog changes it. */
export function useNoteFont(): string {
  const [font, setFont] = React.useState<NoteFont>(loadNoteFont);
  React.useEffect(() => {
    const onChange = () => setFont(loadNoteFont());
    window.addEventListener(NOTE_FONT_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(NOTE_FONT_CHANGED_EVENT, onChange);
  }, []);
  return noteFontFamily(font);
}
