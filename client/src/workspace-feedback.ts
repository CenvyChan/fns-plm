// Deliberate allowlist: a generic role=status may be a warning, progress or durable result.
export const transientFeedbackSelector = [
  '.iw-alert.iw-success', '.connector-notice', '.bpmn-notice',
  '.fd-notice', '.fvp-notice', '[data-feedback="transient"]',
].join(',')
export const persistentFeedbackSelector = [
  '.dr-migration-import', '.dr-import-result', '[data-feedback="persistent"]',
  '[role="alert"]', '.iw-error', '.iw-alert-error',
].join(',')
export function feedbackDuration(text: string): number {
  // Longer messages get reading time; no message vanishes in less than six seconds.
  return Math.min(16000, Math.max(6000, text.length * 120))
}
