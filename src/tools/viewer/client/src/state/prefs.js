/**
 * @file User preferences persisted to localStorage.
 *
 * Responsibility:
 *   Manages viewer preferences (speed, visual toggles, console filters)
 *   with localStorage persistence.
 *
 * @module state/prefs
 */

const STORAGE_KEY = 'sit-viewer-prefs';

/** @type {{speed:number, showMiniMap:boolean, showConsole:boolean, consoleFilter:string}} */
const DEFAULTS = {
    speed: 1000,
    showMiniMap: false,
    showConsole: true,
    consoleFilter: 'all',
};

/**
 * Load preferences from localStorage, falling back to defaults.
 * @returns {typeof DEFAULTS}
 */
export function loadPrefs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            return { ...DEFAULTS, ...JSON.parse(raw) };
        }
    } catch {
        /* corrupted — use defaults */
    }
    return { ...DEFAULTS };
}

/**
 * Save preferences to localStorage.
 * @param {Partial<typeof DEFAULTS>} patch
 */
export function savePrefs(patch) {
    try {
        const current = loadPrefs();
        const merged = { ...current, ...patch };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch {
        /* storage full or unavailable — ignore */
    }
}
