/**
 * @file ObjectInspector — click on canvas → list objects at tile → detailed properties.
 *
 * Adapted from screeps-dojo (MIT) ObjectInspector.tsx.
 *
 * @component
 */

import { useState, useMemo } from 'react';

/**
 * @param {Object} props
 * @param {import('../api/types').FrameObject[]} props.objects — all objects at the clicked tile
 * @param {string|null} props.selectedId — currently selected object _id
 * @param {(id:string|null) => void} props.onSelect
 * @param {Object<string,boolean>} props.typeFilter — visible types
 * @param {(filter:Object<string,boolean>) => void} props.onTypeFilterChange
 * @param {string} props.searchQuery
 * @param {(q:string) => void} props.onSearchChange
 */
export default function ObjectInspector({
    objects = [],
    selectedId,
    onSelect,
    typeFilter = {},
    onTypeFilterChange,
    searchQuery = '',
    onSearchChange,
}) {
    const [expanded, setExpanded] = useState(true);

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

    const toggleType = (type) => {
        onTypeFilterChange({ ...typeFilter, [type]: typeFilter[type] === false ? true : false });
    };

    if (!objects.length) {
        return (
            <div className="object-inspector empty">
                <div className="panel-header">Object Inspector</div>
                <div className="panel-empty">Click on a tile to inspect objects</div>
            </div>
        );
    }

    return (
        <div className="object-inspector">
            <div className="panel-header" onClick={() => setExpanded(!expanded)}>
                Object Inspector {expanded ? '▼' : '▶'}
                <span className="object-count">{objects.length} objects</span>
            </div>

            {expanded && (
                <>
                    {/* Search */}
                    <div className="inspector-search">
                        <input
                            type="text"
                            placeholder="Search by id/name/type..."
                            value={searchQuery}
                            onChange={(e) => onSearchChange(e.target.value)}
                        />
                    </div>

                    {/* Type filter */}
                    <div className="inspector-type-filter">
                        {allTypes.map((type) => (
                            <label key={type} className="type-checkbox">
                                <input
                                    type="checkbox"
                                    checked={typeFilter[type] !== false}
                                    onChange={() => toggleType(type)}
                                />
                                {type}
                            </label>
                        ))}
                    </div>

                    {/* Object list */}
                    <div className="inspector-object-list">
                        {filteredObjects.map((obj) => (
                            <div
                                key={obj._id}
                                className={`inspector-object-item ${obj._id === selectedId ? 'selected' : ''}`}
                                onClick={() => onSelect(obj._id === selectedId ? null : obj._id)}
                            >
                                <span className="object-type-badge">{obj.type}</span>
                                <span className="object-id">{obj._id}</span>
                                {obj.name && <span className="object-name">({obj.name})</span>}
                            </div>
                        ))}
                    </div>

                    {/* Detail view */}
                    {selectedObj && (
                        <div className="inspector-detail">
                            <div className="detail-title">
                                {selectedObj.type}: {selectedObj.name || selectedObj._id}
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
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
