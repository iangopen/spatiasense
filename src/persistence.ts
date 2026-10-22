import { ROUNDS_KEY, appendRound, parseRounds, serializeRounds, type ParseOutcome } from "./core/storage";
import type { RoundRecord } from "./core/types";

/** Thin localStorage wrapper. All parsing/validation lives in core/storage. */
export function loadRounds(): ParseOutcome {
  let raw: string | null;
  try {
    raw = localStorage.getItem(ROUNDS_KEY);
  } catch {
    return { rounds: [], problems: ["Browser storage is unavailable; history can't be loaded."] };
  }
  return parseRounds(raw);
}

/** Returns false if the round could not be saved (storage blocked or full). */
export function saveRound(round: RoundRecord): boolean {
  try {
    // Keep unreadable rounds out of what we write back; they were already reported on load.
    const { rounds } = loadRounds();
    localStorage.setItem(ROUNDS_KEY, serializeRounds(appendRound(rounds, round)));
    return true;
  } catch {
    return false;
  }
}

/** The JSON "Copy my data" puts on the clipboard: every readable stored round. */
export function exportJson(): string {
  return serializeRounds(loadRounds().rounds);
}

/** Copies text to the clipboard. False when the browser refuses (the caller shows the text instead). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
