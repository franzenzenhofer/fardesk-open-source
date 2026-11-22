// Claude Code's own blocking dialogs, passed through to the phone. The daemon never decides when one shows:
// Claude Code sends it (SDK `onUserDialog`), the phone answers it, the answer goes back unchanged.
// The only knowledge kept here is which answers each dialog kind accepts, as Claude Code defines them.

/** The cold-cache dialog: the conversation was idle long enough that resuming it re-reads (and re-bills) the whole context. */
export const COLD_RESUME_QUOTA = "cold_resume_quota";

const RESUME = "resume";
const NEW_CONVERSATION = "new_conversation";
const COMPACT = "compact";
const DISMISS = "dismiss";

/** The dialog kinds the daemon declares to Claude Code (SDK `supportedDialogKinds`). */
export const SUPPORTED_DIALOG_KINDS: string[] = [COLD_RESUME_QUOTA];

/** The answers valid for this dialog, or null for a kind the daemon does not support. "compact" only when Claude Code offers a summary. */
export function dialogChoices(dialogKind: string, payload: Record<string, unknown>): string[] | null {
  if (dialogKind !== COLD_RESUME_QUOTA) return null;
  return payload["offersSummary"] === true ? [RESUME, NEW_CONVERSATION, COMPACT, DISMISS] : [RESUME, NEW_CONVERSATION, DISMISS];
}
