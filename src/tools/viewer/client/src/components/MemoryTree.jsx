/**
 * @file MemoryTree — collapsible JSON tree for displaying bot Memory
 *   in the Object Inspector.
 *
 * Features:
 * - Recursively renders JSON objects/arrays as expandable trees
 * - Primitives shown inline with type-appropriate styling
 * - Search highlight (future)
 * - Copy path to clipboard (future)
 *
 * @component
 */

import { useState } from 'react';
import { ChevronRightIcon, ChevronDownIcon } from './Icons';

/**
 * @param {Object} props
 * @param {*} props.data — the JSON value to render
 * @param {string} [props.label] — optional label for root node
 * @param {boolean} [props.defaultExpanded=true] — start expanded
 * @param {number} [props.depth=0] — current nesting depth (internal)
 */
export default function MemoryTree({ data, label, defaultExpanded = true, depth = 0 }) {
    const [expanded, setExpanded] = useState(defaultExpanded && depth < 3);

    if (data === null || data === undefined) {
        return (
            <span className="mt-null" style={{ paddingLeft: depth * 16 }}>
                {label !== undefined && <span className="mt-key">{label}: </span>}
                <span className="mt-null-val">null</span>
            </span>
        );
    }

    if (typeof data !== 'object') {
        const typeClass =
            typeof data === 'string' ? 'mt-string' : typeof data === 'number' ? 'mt-number' : 'mt-boolean';
        const displayVal = typeof data === 'string' ? `"${data}"` : String(data);
        return (
            <span className={typeClass} style={{ paddingLeft: depth * 16 }}>
                {label !== undefined && <span className="mt-key">{label}: </span>}
                <span className="mt-val">{displayVal}</span>
            </span>
        );
    }

    const isArray = Array.isArray(data);
    const entries = isArray ? data.map((v, i) => [String(i), v]) : Object.entries(data);
    const isEmpty = entries.length === 0;
    const bracket = isArray ? ['[', ']'] : ['{', '}'];

    if (isEmpty) {
        return (
            <span className="mt-empty" style={{ paddingLeft: depth * 16 }}>
                {label !== undefined && <span className="mt-key">{label}: </span>}
                <span className="mt-bracket">
                    {bracket[0]}
                    {bracket[1]}
                </span>
            </span>
        );
    }

    return (
        <div className="mt-node" style={{ paddingLeft: depth * 16 }}>
            <div className="mt-header" onClick={() => setExpanded(!expanded)}>
                <span className="mt-toggle">
                    {expanded ? <ChevronDownIcon size={12} /> : <ChevronRightIcon size={12} />}
                </span>
                {label !== undefined && <span className="mt-key">{label}: </span>}
                <span className="mt-bracket">
                    {bracket[0]}
                    {!expanded && (
                        <span className="mt-preview">
                            {' '}
                            {entries.length} {isArray ? 'items' : 'keys'}
                        </span>
                    )}
                </span>
            </div>
            {expanded && (
                <div className="mt-children">
                    {entries.map(([key, value]) => (
                        <div key={key} className="mt-entry">
                            <MemoryTree
                                data={value}
                                label={isArray ? `[${key}]` : key}
                                defaultExpanded={depth < 2}
                                depth={depth + 1}
                            />
                        </div>
                    ))}
                </div>
            )}
            {expanded && (
                <div style={{ paddingLeft: depth * 16 }}>
                    <span className="mt-bracket">{bracket[1]}</span>
                </div>
            )}
        </div>
    );
}
