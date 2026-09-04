/**
 * @file Shared viewer limits — single source of truth for storage budgets.
 *
 * Responsibility:
 *   Named constants for browser-storage budgets so the persist logic (App)
 *   and the quota display (ResourcesPanel) never drift apart.
 */

/**
 * Persist budget for the recording saved to sessionStorage on scenario end /
 * page hide (App.persistRecording).
 *
 * Current Firefox allows ~50 MB per origin (older browsers: ~5 MB — a hard
 * browser limitation, not something we can detect portably). 45 MB leaves
 * headroom under the ~50 MB quota. The quota shrink path in persistRecording
 * estimates a fitting frame count directly from this budget instead of
 * halving from the full buffer (halving a ~190 MB buffer ran up to 8 huge
 * JSON.stringify calls and froze the reload).
 *
 * Used by:
 * - `App.jsx` — persistRecording budget + quota-fallback estimate
 * - `ResourcesPanel.jsx` — sessionStorage quota display
 */
export const PERSIST_BUDGET_CHARS = 45 * 1024 * 1024;
