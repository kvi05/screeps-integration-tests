import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import StatePanel from '../src/components/StatePanel';

// Mock API client — we test StatePanel behavior against these calls
vi.mock('../src/api/client', () => ({
    getSnapshots: vi.fn(),
    postSaveSnapshot: vi.fn(),
    postLoadSnapshot: vi.fn(),
    postRestoreTick: vi.fn(),
    getSnapshotFile: vi.fn(),
    deleteSnapshot: vi.fn(),
}));

// Import the mocked module for assertions
import {
    getSnapshots,
    postSaveSnapshot,
    postLoadSnapshot,
    postRestoreTick,
    getSnapshotFile,
    deleteSnapshot,
} from '../src/api/client';

const SNAPSHOTS = [
    {
        file: 'smoke-empty-t42.json',
        size: 1024,
        modified: '2026-08-15T10:00:00.000Z',
        tick: 42,
        scenario: 'smoke-empty',
    },
    { file: 'other-t10.json', size: 2048, modified: '2026-08-15T11:00:00.000Z', tick: 10, scenario: 'other-scenario' },
    { file: 'legacy.json', size: 512, modified: '2026-08-15T09:00:00.000Z' },
];

/**
 * Renders StatePanel with sensible defaults + per-test overrides.
 * @param {Object} props
 * @returns {Object}
 */
function renderStatePanel(props = {}) {
    const defaults = {
        scenario: 'smoke-empty',
        serverTick: 42,
        connected: true,
        ended: false,
        disabled: false,
        sseError: null,
        onClearError: vi.fn(),
    };
    const merged = { ...defaults, ...props };
    const utils = render(React.createElement(StatePanel, merged));
    return { ...utils, props: merged };
}

describe('StatePanel', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
        getSnapshots.mockResolvedValue({ snapshots: SNAPSHOTS });
        postSaveSnapshot.mockResolvedValue({ ok: true });
        postLoadSnapshot.mockResolvedValue({ ok: true });
        postRestoreTick.mockResolvedValue({ ok: true });
        getSnapshotFile.mockResolvedValue({ db: {}, env: { gameTime: 42 } });
        deleteSnapshot.mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('shows rewind range when connected', () => {
        renderStatePanel({ connected: true, serverTick: 42 });
        expect(screen.getByText(/Ticks 1–41 available for rewind/)).toBeInTheDocument();
    });

    it('shows the real rewind range based on replayBuffer', () => {
        // Server keeps sit:snap:<N> for the last replayBuffer ticks,
        // and rewind targets must be strictly before the current tick.
        renderStatePanel({ connected: true, serverTick: 1500, replayBuffer: 1000 });
        expect(screen.getByText(/Ticks 501–1499 available for rewind/)).toBeInTheDocument();
    });

    it('clamps rewind range start to 1 near the beginning', () => {
        renderStatePanel({ connected: true, serverTick: 50, replayBuffer: 1000 });
        expect(screen.getByText(/Ticks 1–49 available for rewind/)).toBeInTheDocument();
    });

    it('falls back to the full range when replayBuffer is unknown', () => {
        renderStatePanel({ connected: true, serverTick: 42, replayBuffer: 0 });
        expect(screen.getByText(/Ticks 1–41 available for rewind/)).toBeInTheDocument();
    });

    it('shows no rewind range at tick 0', () => {
        renderStatePanel({ connected: true, serverTick: 0, replayBuffer: 1000 });
        expect(screen.getByText('—')).toBeInTheDocument();
        expect(screen.queryByText(/available for rewind/)).not.toBeInTheDocument();
    });

    it('hides rewind range when not connected', () => {
        renderStatePanel({ connected: false });
        expect(screen.getByText('—')).toBeInTheDocument();
        expect(screen.queryByText(/available for rewind/)).not.toBeInTheDocument();
    });

    // ─── Rewind control ──────────────────────────────────────

    it('shows rewind input defaulting to serverTick - 1', () => {
        renderStatePanel({ serverTick: 42 });
        expect(screen.getByLabelText('Rewind target tick')).toHaveValue(41);
    });

    it('auto-follows the server tick while untouched', () => {
        const utils = renderStatePanel({ serverTick: 42 });
        utils.rerender(React.createElement(StatePanel, { ...utils.props, serverTick: 60 }));
        expect(screen.getByLabelText('Rewind target tick')).toHaveValue(59);
    });

    it('keeps a manually typed value while the server advances', () => {
        const utils = renderStatePanel({ serverTick: 42 });
        fireEvent.change(screen.getByLabelText('Rewind target tick'), { target: { value: '10' } });
        utils.rerender(React.createElement(StatePanel, { ...utils.props, serverTick: 60 }));
        expect(screen.getByLabelText('Rewind target tick')).toHaveValue(10);
    });

    it('calls postRestoreTick on Rewind click', async () => {
        renderStatePanel({ serverTick: 42 });
        fireEvent.click(screen.getByRole('button', { name: 'Rewind' }));
        await waitFor(() => expect(postRestoreTick).toHaveBeenCalledWith(41));
    });

    it('shows an error when the target is not before the current tick', async () => {
        renderStatePanel({ serverTick: 42 });
        fireEvent.change(screen.getByLabelText('Rewind target tick'), { target: { value: '50' } });
        fireEvent.click(screen.getByRole('button', { name: 'Rewind' }));
        await waitFor(() => expect(screen.getByText(/Cannot rewind to tick 50/)).toBeInTheDocument());
        expect(postRestoreTick).not.toHaveBeenCalled();
    });

    it('shows an error for targets outside the rewind buffer', async () => {
        renderStatePanel({ serverTick: 1500, replayBuffer: 1000 });
        fireEvent.change(screen.getByLabelText('Rewind target tick'), { target: { value: '100' } });
        fireEvent.click(screen.getByRole('button', { name: 'Rewind' }));
        await waitFor(() => expect(screen.getByText(/outside the rewind buffer/)).toBeInTheDocument());
        expect(postRestoreTick).not.toHaveBeenCalled();
    });

    it('disables rewind control when not connected', () => {
        renderStatePanel({ connected: false });
        expect(screen.getByRole('button', { name: 'Rewind' })).toBeDisabled();
        expect(screen.getByLabelText('Rewind target tick')).toBeDisabled();
    });

    it('lists saved snapshots for current scenario', async () => {
        renderStatePanel({ scenario: 'smoke-empty' });
        await waitFor(() => expect(screen.getByText('smoke-empty-t42.json')).toBeInTheDocument());
    });

    it('filters snapshots by scenario name', async () => {
        renderStatePanel({ scenario: 'smoke-empty' });
        await waitFor(() => expect(screen.getByText('smoke-empty-t42.json')).toBeInTheDocument());
        // Other-scenario snapshots are hidden, and snapshots without
        // meta.scenario cannot be matched to a run — hidden as well.
        expect(screen.queryByText('other-t10.json')).not.toBeInTheDocument();
        expect(screen.queryByText('legacy.json')).not.toBeInTheDocument();
    });

    it('shows a failure message when the snapshot list cannot be loaded', async () => {
        getSnapshots.mockRejectedValueOnce(new Error('boom'));
        renderStatePanel({ scenario: 'smoke-empty' });
        await waitFor(() => expect(screen.getByText(/Failed to load snapshots/)).toBeInTheDocument());
    });

    it('shows snapshot metadata (tick, size)', async () => {
        renderStatePanel({ scenario: 'smoke-empty' });
        await waitFor(() => expect(screen.getByText('smoke-empty-t42.json')).toBeInTheDocument());
        expect(screen.getByText(/Tick 42/)).toBeInTheDocument();
        expect(screen.getByText(/1\.0 KB/)).toBeInTheDocument();
    });

    it('calls load on Load button click', async () => {
        renderStatePanel({ scenario: 'smoke-empty' });
        await waitFor(() => expect(screen.getByText('smoke-empty-t42.json')).toBeInTheDocument());
        // Exact name 'Load' targets the list item button, not 'Load from File...'
        fireEvent.click(screen.getAllByRole('button', { name: 'Load' })[0]);
        await waitFor(() => expect(postLoadSnapshot).toHaveBeenCalled());
    });

    it('calls delete on Delete button click', async () => {
        renderStatePanel({ scenario: 'smoke-empty' });
        await waitFor(() => expect(screen.getByText('smoke-empty-t42.json')).toBeInTheDocument());
        fireEvent.click(screen.getAllByRole('button', { name: /Delete/ })[0]);
        await waitFor(() => expect(deleteSnapshot).toHaveBeenCalledWith('smoke-empty-t42.json'));
        // List refreshes after delete
        await waitFor(() => expect(getSnapshots).toHaveBeenCalledTimes(2));
    });

    it('shows save button (enabled when connected)', () => {
        const connected = renderStatePanel({ connected: true });
        expect(connected.getByRole('button', { name: /Save Snapshot/ })).not.toBeDisabled();
    });

    it('disables save button when not connected', () => {
        const disconnected = renderStatePanel({ connected: false });
        expect(disconnected.getByRole('button', { name: /Save Snapshot/ })).toBeDisabled();
    });

    it('disables save button when the scrubber is not at the edge', () => {
        const notAtEdge = renderStatePanel({ atEdge: false });
        expect(notAtEdge.getByRole('button', { name: /Save Snapshot/ })).toBeDisabled();
    });

    it('shows the current scenario label above the snapshot list', async () => {
        renderStatePanel({ scenario: 'smoke-empty' });
        await waitFor(() => expect(screen.getByText('smoke-empty-t42.json')).toBeInTheDocument());
        expect(screen.getByText('smoke-empty')).toBeInTheDocument();
    });
});
