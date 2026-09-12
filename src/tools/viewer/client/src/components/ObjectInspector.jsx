/**
 * @file ObjectInspector — click on canvas → list objects at tile → detailed properties.
 *
 * Features:
 * - OI-1: Click tile → list objects
 * - OI-2: Click object → detail panel
 * - OI-4: Filter by type (chips)
 * - OI-5: Search by id/name
 * - OI-6: Selected object highlight (via selectedId prop → canvas)
 * - OI-3 (future): Edit properties inline
 *
 * @component
 */

import { useState, useMemo, useEffect, useRef } from 'react';
import { MousePointerIcon, SearchIcon, ChevronDownIcon, ChevronRightIcon, TargetIcon, CopyIcon } from './Icons';
import MemoryTree from './MemoryTree';
import { getMemoryAtTick } from '../api/client';

/** @type {Object<string,string>} */
const TYPE_COLORS = {
    creep: 'var(--type-creep)',
    source: 'var(--type-source)',
    controller: 'var(--type-controller)',
    mineral: 'var(--type-mineral)',
    resource: 'var(--type-resource)',
    constructionSite: 'var(--type-construction)',
    spawn: 'var(--type-structure)',
    extension: 'var(--type-structure)',
    tower: 'var(--type-structure)',
    storage: 'var(--type-structure)',
    terminal: 'var(--type-structure)',
    link: 'var(--type-structure)',
    lab: 'var(--type-structure)',
    factory: 'var(--type-structure)',
    powerSpawn: 'var(--type-structure)',
    container: 'var(--type-structure)',
    road: 'var(--type-structure)',
    rampart: 'var(--type-structure)',
    constructedWall: 'var(--type-structure)',
};

function getTypeColor(type) {
    return TYPE_COLORS[type] || 'var(--type-default)';
}

/**
 * @param {Object} props
 * @param {import('../api/types').FrameObject[]} props.objects — all objects at the clicked tile
 * @param {string|null} props.selectedId — currently selected object _id
 * @param {(id:string|null) => void} props.onSelect
 * @param {Object<string,boolean>} props.typeFilter — visible types
 * @param {(filter:Object<string,boolean>) => void} props.onTypeFilterChange
 * @param {string} props.searchQuery
 * @param {(q:string) => void} props.onSearchChange
 * @param {number} [props.currentTick] — current scrubber tick for Memory fetch
 */
export default function ObjectInspector({
    objects = [],
    selectedId,
    onSelect,
    typeFilter = {},
    onTypeFilterChange,
    searchQuery = '',
    onSearchChange,
    currentTick = 0,
}) {
    const [expanded, setExpanded] = useState(true);

    // Memory fetching state
    const [memoryData, setMemoryData] = useState(/** @type {Object|null} */ (null));
    const [memoryLoading, setMemoryLoading] = useState(false);
    const [memoryError, setMemoryError] = useState(/** @type {string|null} */ (null));
    /** @type {React.MutableRefObject<{tick:number, bot:string}|null>} */
    const lastFetchRef = useRef(null);

    // Collect all unique types from objects
    const allTypes = useMemo(() => {
        const types = new Set();
        for (const obj of objects) {
            types.add(obj.type || 'unknown');
        }
        return [...types].sort();
    }, [objects]);

    // Filter objects by type and search
    const filteredObjects = useMemo(() => {
        return objects.filter((obj) => {
            const type = obj.type || 'unknown';
            if (typeFilter[type] === false) return false;
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const matchId = (obj._id || '').toLowerCase().includes(q);
                const matchName = (obj.name || '').toLowerCase().includes(q);
                const matchType = type.toLowerCase().includes(q);
                if (!matchId && !matchName && !matchType) return false;
            }
            return true;
        });
    }, [objects, typeFilter, searchQuery]);

    const selectedObj = useMemo(
        () => filteredObjects.find((o) => o._id === selectedId) || null,
        [filteredObjects, selectedId],
    );

    // Determine the bot username from the selected object
    const selectedBot = useMemo(() => {
        if (!selectedObj) return null;
        return selectedObj.user || null;
    }, [selectedObj]);

    // Fetch Memory when selected object or tick changes
    useEffect(() => {
        if (!selectedBot || currentTick === undefined) {
            setMemoryError(null);
            // Keep memoryData — it stays valid for when the user reselects
            // the same bot at the same tick.
            return;
        }
        // Avoid refetch if we already have this data
        const prev = lastFetchRef.current;
        if (prev && prev.tick === currentTick && prev.bot === selectedBot) {
            return;
        }
        // New bot/tick — clear stale data before fetching
        setMemoryData(null);
        setMemoryError(null);
        let cancelled = false;
        setMemoryLoading(true);
        getMemoryAtTick(currentTick, selectedBot)
            .then((data) => {
                if (cancelled) return;
                setMemoryData(data);
                lastFetchRef.current = { tick: currentTick, bot: selectedBot };
                setMemoryLoading(false);
            })
            .catch((err) => {
                if (cancelled) return;
                setMemoryError(err.message || 'Failed to fetch memory');
                setMemoryData(null);
                setMemoryLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [selectedBot, currentTick]);

    const toggleType = (type) => {
        onTypeFilterChange({ ...typeFilter, [type]: typeFilter[type] === false ? true : false });
    };

    if (!objects.length) {
        return (
            <div className="object-inspector">
                <div className="panel-header">
                    <MousePointerIcon size={16} />
                    Object Inspector
                </div>
                <div className="panel-empty">
                    <TargetIcon size={48} className="empty-icon" />
                    <div className="empty-title">No object selected</div>
                    <div className="empty-hint">
                        Click on any tile in the world to inspect the objects sitting on it
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="object-inspector">
            <div className="panel-header" onClick={() => setExpanded(!expanded)}>
                {expanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
                <MousePointerIcon size={16} />
                Object Inspector
                <span className="panel-count">{objects.length}</span>
            </div>

            {expanded && (
                <>
                    {/* Search */}
                    <div className="inspector-search">
                        <SearchIcon size={14} className="search-icon" />
                        <input
                            type="text"
                            placeholder="Search by id, name, type..."
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                    </div>

                    {/* Type filter chips */}
                    {allTypes.length > 1 && (
                        <div className="inspector-type-filter">
                            {allTypes.map((type) => (
                                <label
                                    key={type}
                                    className={`type-chip ${typeFilter[type] !== false ? 'active' : ''}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        toggleType(type);
                                    }}
                                >
                                    <span className="chip-dot" style={{ background: getTypeColor(type) }} />
                                    {type}
                                </label>
                            ))}
                        </div>
                    )}

                    {/* Object list */}
                    <div className="inspector-object-list">
                        {filteredObjects.map((obj) => (
                            <div
                                key={obj._id}
                                className={`inspector-object-item ${obj._id === selectedId ? 'selected' : ''}`}
                                onClick={() => onSelect(obj._id === selectedId ? null : obj._id)}
                            >
                                <span
                                    className="object-type-badge"
                                    style={{
                                        background: `${getTypeColor(obj.type)}22`,
                                        color: getTypeColor(obj.type),
                                    }}
                                >
                                    {obj.type}
                                </span>
                                <span className="object-id">{obj._id}</span>
                                {obj.name && <span className="object-name">({obj.name})</span>}
                            </div>
                        ))}
                        {filteredObjects.length === 0 && (
                            <div className="panel-empty" style={{ padding: '24px' }}>
                                <div className="empty-hint">No objects match the current filter</div>
                            </div>
                        )}
                    </div>

                    {/* Detail view */}
                    {selectedObj && (
                        <div className="inspector-detail">
                            <div className="detail-header">
                                <span
                                    className="object-type-badge detail-type-badge"
                                    style={{
                                        background: `${getTypeColor(selectedObj.type)}22`,
                                        color: getTypeColor(selectedObj.type),
                                    }}
                                >
                                    {selectedObj.type}
                                </span>
                                <span className="detail-title">{selectedObj.name || selectedObj._id}</span>
                                <div className="detail-actions">
                                    <button
                                        className="icon-btn"
                                        title="Copy id to clipboard"
                                        onClick={() => navigator.clipboard?.writeText(selectedObj._id)}
                                        style={{ width: 26, height: 26 }}
                                    >
                                        <CopyIcon size={14} />
                                    </button>
                                </div>
                            </div>
                            <table className="detail-table">
                                <tbody>
                                    {Object.entries(selectedObj)
                                        .filter(([k]) => k !== '_id' && k !== 'type')
                                        .map(([key, value]) => (
                                            <tr key={key}>
                                                <td className="detail-key">{key}</td>
                                                <td className="detail-value">
                                                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>

                            {/* Memory section */}
                            {selectedBot && (
                                <div className="inspector-memory">
                                    <div className="memory-header">
                                        <span className="memory-title">Memory — {selectedBot}</span>
                                        <span className="memory-tick">tick {currentTick}</span>
                                    </div>
                                    {memoryLoading && <div className="memory-loading">Loading memory...</div>}
                                    {memoryError && <div className="memory-error">{memoryError}</div>}
                                    {!memoryLoading && !memoryError && memoryData === null && (
                                        <div className="memory-empty">
                                            No Memory data available for tick {currentTick}
                                        </div>
                                    )}
                                    {!memoryLoading && !memoryError && memoryData !== null && (
                                        <div className="memory-tree-container">
                                            <MemoryTree data={memoryData} label="Memory" />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
