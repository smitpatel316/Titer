// The feedback dialogs' event bus (seq 453, 2.0 launch): Help ▸ Send
// Feedback and Help ▸ What's New open dialogs that live in the shell,
// so the menu (which has no React state) reaches them through window
// events — the same shape as the other `*_CHANGED_EVENT` buses in this
// folder (`window.dispatchEvent(new Event(...))` + `addEventListener`,
// with the listener returning its unsubscribe).
//
// The bus also owns the support address: Titer's help/support mailbox
// (Smit, voice Nov 24 ~18:10 PT) is smit@muse.ai — Atlas's Muse Mail
// box — so support mail goes to Atlas directly.

/** Titer's help/support mailbox: Atlas's Muse Mail box. */
export const SUPPORT_EMAIL = "smit@muse.ai";

/** Fired when the Send Feedback dialog should open. */
export const OPEN_SEND_FEEDBACK_EVENT = "titer:open-send-feedback";

/** Fired when the What's New dialog should open. */
export const OPEN_WHATS_NEW_EVENT = "titer:open-whats-new";

/** Open the Send Feedback dialog (Help ▸ Send Feedback, or the startup
 *  guide's feedback button). A no-op where there is no window. */
export function openSendFeedback(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_SEND_FEEDBACK_EVENT));
}

/** Listen for Send Feedback requests. Returns the unsubscribe. */
export function onSendFeedbackRequest(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(OPEN_SEND_FEEDBACK_EVENT, handler);
  return () => window.removeEventListener(OPEN_SEND_FEEDBACK_EVENT, handler);
}

/** Open the What's New dialog (Help ▸ What's New). A no-op where there
 *  is no window. */
export function openWhatsNew(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_WHATS_NEW_EVENT));
}

/** Listen for What's New requests. Returns the unsubscribe. */
export function onWhatsNewRequest(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(OPEN_WHATS_NEW_EVENT, handler);
  return () => window.removeEventListener(OPEN_WHATS_NEW_EVENT, handler);
}
