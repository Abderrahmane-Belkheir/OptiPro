import { ApiError } from "../services/apiClient";

/** Checked before every push: when false, inserts stay local with `synced = false`. */
export const syncFlag = { push: true };

/**
 * Runs `push` — a call to the backend followed by marking the local row(s) synced — and reports
 * whether it all went through. It never throws: a row that couldn't be sent simply stays
 * `synced = false` for a later attempt, and being offline (status 0) is expected, so it isn't
 * logged. Anything else (the backend refused the row, the config is wrong) is.
 */
export async function tryPush(label: string, push: () => Promise<void>): Promise<boolean> {
  if (!syncFlag.push) return false;
  try {
    await push();
    return true;
  } catch (err) {
    if (!(err instanceof ApiError && err.status === 0)) {
      console.warn(`[sync] ${label} not sent to the backend: ${err instanceof Error ? err.message : String(err)}`);
    }
    return false;
  }
}
