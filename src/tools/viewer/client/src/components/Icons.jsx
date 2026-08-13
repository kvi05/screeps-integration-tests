/**
 * @file Icons — lightweight SVG icon system for the viewer UI.
 *
 * All icons inherit `currentColor` and accept standard SVG props.
 * Stroke-based (Lucide-style) for a clean, modern look.
 *
 * @module components/Icons
 */

/**
 * Base wrapper — all icons share the same viewBox and stroke style.
 * @param {Object} props
 * @param {number} [props.size=18]
 * @param {string} [props.className]
 * @param {React.SVGProps<SVGSVGElement>} [props.rest]
 * @param {React.ReactNode} props.children
 */
function Icon({ size = 18, className = '', children, ...rest }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            {...rest}
        >
            {children}
        </svg>
    );
}

export const PlayIcon = (p) => (
    <Icon {...p}>
        <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />
    </Icon>
);

export const PauseIcon = (p) => (
    <Icon {...p}>
        <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
        <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" stroke="none" />
    </Icon>
);

export const StepForwardIcon = (p) => (
    <Icon {...p}>
        <polygon points="5 4 15 12 5 20 5 4" fill="currentColor" stroke="none" />
        <line x1="19" y1="5" x2="19" y2="19" strokeWidth="2.5" />
    </Icon>
);

export const StepBackIcon = (p) => (
    <Icon {...p}>
        <polygon points="19 4 9 12 19 20 19 4" fill="currentColor" stroke="none" />
        <line x1="5" y1="5" x2="5" y2="19" strokeWidth="2.5" />
    </Icon>
);

export const SkipBackIcon = (p) => (
    <Icon {...p}>
        <polygon points="19 4 9 12 19 20 19 4" fill="currentColor" stroke="none" />
        <line x1="5" y1="5" x2="5" y2="19" strokeWidth="2.5" />
    </Icon>
);

export const ChevronLeftIcon = (p) => (
    <Icon {...p}>
        <polyline points="15 18 9 12 15 6" />
    </Icon>
);

export const ChevronRightIcon = (p) => (
    <Icon {...p}>
        <polyline points="9 18 15 12 9 6" />
    </Icon>
);

export const ChevronDownIcon = (p) => (
    <Icon {...p}>
        <polyline points="6 9 12 15 18 9" />
    </Icon>
);

export const ChevronUpIcon = (p) => (
    <Icon {...p}>
        <polyline points="18 15 12 9 6 15" />
    </Icon>
);

export const SearchIcon = (p) => (
    <Icon {...p}>
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </Icon>
);

export const XIcon = (p) => (
    <Icon {...p}>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </Icon>
);

export const ActivityIcon = (p) => (
    <Icon {...p}>
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </Icon>
);

export const MapIcon = (p) => (
    <Icon {...p}>
        <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
        <line x1="8" y1="2" x2="8" y2="18" />
        <line x1="16" y1="6" x2="16" y2="22" />
    </Icon>
);

export const TerminalIcon = (p) => (
    <Icon {...p}>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
    </Icon>
);

export const BoxIcon = (p) => (
    <Icon {...p}>
        <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
    </Icon>
);

export const ZapIcon = (p) => (
    <Icon {...p}>
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" stroke="none" />
    </Icon>
);

export const FilmIcon = (p) => (
    <Icon {...p}>
        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
        <line x1="7" y1="2" x2="7" y2="22" />
        <line x1="17" y1="2" x2="17" y2="22" />
        <line x1="2" y1="12" x2="22" y2="12" />
        <line x1="2" y1="7" x2="7" y2="7" />
        <line x1="2" y1="17" x2="7" y2="17" />
        <line x1="17" y1="17" x2="22" y2="17" />
        <line x1="17" y1="7" x2="22" y2="7" />
    </Icon>
);

export const ArrowLeftIcon = (p) => (
    <Icon {...p}>
        <line x1="19" y1="12" x2="5" y2="12" />
        <polyline points="12 19 5 12 12 5" />
    </Icon>
);

export const CheckIcon = (p) => (
    <Icon {...p}>
        <polyline points="20 6 9 17 4 12" />
    </Icon>
);

export const AlertCircleIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
    </Icon>
);

export const ClockIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
    </Icon>
);

export const RefreshCwIcon = (p) => (
    <Icon {...p}>
        <polyline points="23 4 23 10 17 10" />
        <polyline points="1 20 1 14 7 14" />
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </Icon>
);

export const MaximizeIcon = (p) => (
    <Icon {...p}>
        <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
    </Icon>
);

export const LayersIcon = (p) => (
    <Icon {...p}>
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
    </Icon>
);

export const GridIcon = (p) => (
    <Icon {...p}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
    </Icon>
);

export const SlidersIcon = (p) => (
    <Icon {...p}>
        <line x1="4" y1="21" x2="4" y2="14" />
        <line x1="4" y1="10" x2="4" y2="3" />
        <line x1="12" y1="21" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12" y2="3" />
        <line x1="20" y1="21" x2="20" y2="16" />
        <line x1="20" y1="12" x2="20" y2="3" />
        <line x1="1" y1="14" x2="7" y2="14" />
        <line x1="9" y1="8" x2="15" y2="8" />
        <line x1="17" y1="16" x2="23" y2="16" />
    </Icon>
);

export const TargetIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="6" />
        <circle cx="12" cy="12" r="2" fill="currentColor" />
    </Icon>
);

export const PowerIcon = (p) => (
    <Icon {...p}>
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
        <line x1="12" y1="2" x2="12" y2="12" />
    </Icon>
);

export const GaugeIcon = (p) => (
    <Icon {...p}>
        <path d="M12 14l4-4" />
        <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </Icon>
);

export const FilterIcon = (p) => (
    <Icon {...p}>
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </Icon>
);

export const CopyIcon = (p) => (
    <Icon {...p}>
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Icon>
);

export const ChevronRightCircleIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="9 18 15 12 9 6" />
    </Icon>
);

export const ChevronDownCircleIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <polyline points="6 9 12 15 18 9" />
    </Icon>
);

export const MousePointerIcon = (p) => (
    <Icon {...p}>
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    </Icon>
);

export const InfoIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="16" x2="12" y2="12" />
        <line x1="12" y1="8" x2="12.01" y2="8" />
    </Icon>
);

export const TrendingUpIcon = (p) => (
    <Icon {...p}>
        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
        <polyline points="17 6 23 6 23 12" />
    </Icon>
);

export const CpuIcon = (p) => (
    <Icon {...p}>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <rect x="9" y="9" width="6" height="6" />
        <line x1="9" y1="1" x2="9" y2="4" />
        <line x1="15" y1="1" x2="15" y2="4" />
        <line x1="9" y1="20" x2="9" y2="23" />
        <line x1="15" y1="20" x2="15" y2="23" />
        <line x1="20" y1="9" x2="23" y2="9" />
        <line x1="20" y1="14" x2="23" y2="14" />
        <line x1="1" y1="9" x2="4" y2="9" />
        <line x1="1" y1="14" x2="4" y2="14" />
    </Icon>
);

export const RocketIcon = (p) => (
    <Icon {...p}>
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </Icon>
);

export const EyeIcon = (p) => (
    <Icon {...p}>
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
        <circle cx="12" cy="12" r="3" />
    </Icon>
);

export const WifiIcon = (p) => (
    <Icon {...p}>
        <path d="M5 12.55a11 11 0 0 1 14.08 0" />
        <path d="M1.42 9a16 16 0 0 1 21.16 0" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
    </Icon>
);

export const WifiOffIcon = (p) => (
    <Icon {...p}>
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
    </Icon>
);

export const DownloadIcon = (p) => (
    <Icon {...p}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
    </Icon>
);

export const BookmarkIcon = (p) => (
    <Icon {...p}>
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </Icon>
);

export const SettingsIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Icon>
);

export const CircleIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" />
    </Icon>
);

export const CircleDotIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
    </Icon>
);

export const ListIcon = (p) => (
    <Icon {...p}>
        <line x1="8" y1="6" x2="21" y2="6" />
        <line x1="8" y1="12" x2="21" y2="12" />
        <line x1="8" y1="18" x2="21" y2="18" />
        <line x1="3" y1="6" x2="3.01" y2="6" />
        <line x1="3" y1="12" x2="3.01" y2="12" />
        <line x1="3" y1="18" x2="3.01" y2="18" />
    </Icon>
);

export const PlayCircleIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" fill="currentColor" stroke="none" />
    </Icon>
);

export const MonitorIcon = (p) => (
    <Icon {...p}>
        <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
    </Icon>
);

export const CompassIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" fill="currentColor" />
    </Icon>
);

export const HashIcon = (p) => (
    <Icon {...p}>
        <line x1="4" y1="9" x2="20" y2="9" />
        <line x1="4" y1="15" x2="20" y2="15" />
        <line x1="10" y1="3" x2="8" y2="21" />
        <line x1="16" y1="3" x2="14" y2="21" />
    </Icon>
);

export const DatabaseIcon = (p) => (
    <Icon {...p}>
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </Icon>
);

export const SignalIcon = (p) => (
    <Icon {...p}>
        <path d="M2 20h.01" />
        <path d="M7 20v-4" />
        <path d="M12 20v-8" />
        <path d="M17 20V8" />
        <path d="M22 4v16" />
    </Icon>
);

export const PauseCircleIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <rect x="9" y="7" width="3" height="10" rx="1" fill="currentColor" stroke="none" />
        <rect x="14" y="7" width="3" height="10" rx="1" fill="currentColor" stroke="none" />
    </Icon>
);

export const FastForwardIcon = (p) => (
    <Icon {...p}>
        <polygon points="13 4 13 20 4 12 13 4" fill="currentColor" stroke="none" />
        <polygon points="22 4 22 20 13 12 22 4" fill="currentColor" stroke="none" />
    </Icon>
);

export const RewindIcon = (p) => (
    <Icon {...p}>
        <polygon points="11 4 11 20 20 12 11 4" fill="currentColor" stroke="none" />
        <polygon points="2 4 2 20 11 12 2 4" fill="currentColor" stroke="none" />
    </Icon>
);

export const InboxIcon = (p) => (
    <Icon {...p}>
        <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
        <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </Icon>
);

export const PackageIcon = (p) => (
    <Icon {...p}>
        <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
        <line x1="12" y1="22.08" x2="12" y2="12" />
    </Icon>
);

export const FlagIcon = (p) => (
    <Icon {...p}>
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
        <line x1="4" y1="22" x2="4" y2="15" />
    </Icon>
);

export const MinusIcon = (p) => (
    <Icon {...p}>
        <line x1="5" y1="12" x2="19" y2="12" />
    </Icon>
);

export const PlusIcon = (p) => (
    <Icon {...p}>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </Icon>
);

export const Maximize2Icon = (p) => (
    <Icon {...p}>
        <polyline points="15 3 21 3 21 9" />
        <polyline points="9 21 3 21 3 15" />
        <line x1="21" y1="3" x2="14" y2="10" />
        <line x1="3" y1="21" x2="10" y2="14" />
    </Icon>
);

export const FocusIcon = (p) => (
    <Icon {...p}>
        <path d="M3 7V5a2 2 0 0 1 2-2h2" />
        <path d="M17 3h2a2 2 0 0 1 2 2v2" />
        <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
        <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
        <circle cx="12" cy="12" r="3" />
    </Icon>
);

export const CrosshairIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="10" />
        <line x1="22" y1="12" x2="18" y2="12" />
        <line x1="6" y1="12" x2="2" y2="12" />
        <line x1="12" y1="6" x2="12" y2="2" />
        <line x1="12" y1="22" x2="12" y2="18" />
    </Icon>
);

export const RadioIcon = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="2" fill="currentColor" />
        <path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14" />
    </Icon>
);

export const LoaderIcon = (p) => (
    <Icon {...p}>
        <line x1="12" y1="2" x2="12" y2="6" />
        <line x1="12" y1="18" x2="12" y2="22" />
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
        <line x1="2" y1="12" x2="6" y2="12" />
        <line x1="18" y1="12" x2="22" y2="12" />
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
    </Icon>
);

export const SparklesIcon = (p) => (
    <Icon {...p}>
        <path
            d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3L12 3z"
            fill="currentColor"
            stroke="none"
        />
    </Icon>
);

export const ClockIcon2 = ClockIcon;
