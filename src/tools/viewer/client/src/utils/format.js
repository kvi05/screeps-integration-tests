/**
 * @file Shared display formatting helpers for viewer components.
 *
 * Responsibility:
 *   Human-readable formatting of byte sizes and durations, shared by
 *   ScenarioManager and StatePanel instead of duplicating implementations.
 */

/**
 * Format a byte size into a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format a duration in milliseconds into a short human-readable string.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
    if (ms == null) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${m}m ${s}s`;
}
