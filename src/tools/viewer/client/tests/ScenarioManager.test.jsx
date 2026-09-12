import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import ScenarioManager from '../src/components/ScenarioManager';

// Mock API client — ScenarioManager tests focus on the Snapshots tab and the Run All / Stop All toolbar
vi.mock('../src/api/client', () => ({
    getScenarios: vi.fn(),
    postRun: vi.fn(),
    postRunAll: vi.fn(),
    postStopAll: vi.fn(),
    getSnapshots: vi.fn(),
    postRunFromSnapshot: vi.fn(),
    deleteSnapshot: vi.fn(),
}));

// Import the mocked module for assertions
import { getScenarios, postRun, postRunFromSnapshot, getSnapshots, postRunAll, postStopAll } from '../src/api/client';

const SCENARIOS = [
    {
        name: 'smoke-empty',
        file: 'examples/scenarios/smoke-empty.scenario.js',
        size: 100,
        modified: '2026-08-15T10:00:00.000Z',
    },
    {
        name: 'world-spawn',
        file: 'examples/scenarios/world-spawn.scenario.js',
        size: 200,
        modified: '2026-08-15T11:00:00.000Z',
    },
];

const SNAPSHOTS = [
    {
        file: 'smoke-empty-t42.json',
        size: 1024,
        modified: '2026-08-15T10:00:00.000Z',
        tick: 42,
        scenario: 'smoke-empty',
    },
    {
        file: 'world-spawn-t10.json',
        size: 2048,
        modified: '2026-08-15T11:00:00.000Z',
        tick: 10,
        scenario: 'world-spawn',
    },
];

/**
 * Renders ScenarioManager with a mocked API.
 * @param {Object} props
 * @returns {Object}
 */
function renderManager(props = {}) {
    const onNavigateToViewer = props.onNavigateToViewer || vi.fn();
    const utils = render(React.createElement(ScenarioManager, { onNavigateToViewer }));
    return { ...utils, onNavigateToViewer };
}

/** Selects a scenario in the list by clicking its name cell */
async function selectScenario(name) {
    await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
    fireEvent.click(screen.getByText(name));
}

/** Switches to the Snapshots tab */
function openSnapshotsTab() {
    fireEvent.click(screen.getByRole('button', { name: 'Snapshots' }));
}

describe('ScenarioManager Snapshots tab', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.clearAllMocks();
        getScenarios.mockResolvedValue({ scenarios: SCENARIOS });
        getSnapshots.mockResolvedValue({ snapshots: SNAPSHOTS });
        postRunFromSnapshot.mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('shows Main/Snapshots tabs when scenario selected', async () => {
        renderManager();
        // No tabs before a scenario is selected
        expect(screen.queryByRole('button', { name: 'Snapshots' })).not.toBeInTheDocument();

        await selectScenario('smoke-empty');
        expect(screen.getByRole('button', { name: 'Main' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Snapshots' })).toBeInTheDocument();
    });

    it('switches to Snapshots tab on click', async () => {
        renderManager();
        await selectScenario('smoke-empty');
        openSnapshotsTab();
        await waitFor(() => expect(getSnapshots).toHaveBeenCalled());
        await waitFor(() => expect(screen.getByText('smoke-empty-t42.json')).toBeInTheDocument());
    });

    it('lists snapshots filtered by selected scenario', async () => {
        renderManager();
        await selectScenario('smoke-empty');
        openSnapshotsTab();
        await waitFor(() => expect(screen.getByText('smoke-empty-t42.json')).toBeInTheDocument());
        expect(screen.queryByText('world-spawn-t10.json')).not.toBeInTheDocument();
    });

    it('calls launch on Launch button click', async () => {
        renderManager();
        await selectScenario('smoke-empty');
        openSnapshotsTab();
        await waitFor(() => expect(screen.getByText('smoke-empty-t42.json')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
        await waitFor(() => expect(postRunFromSnapshot).toHaveBeenCalledWith('smoke-empty-t42.json'));
    });

    it('navigates to viewer after launch', async () => {
        const { onNavigateToViewer } = renderManager();
        await selectScenario('smoke-empty');
        openSnapshotsTab();
        await waitFor(() => expect(screen.getByText('smoke-empty-t42.json')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
        await waitFor(() => expect(onNavigateToViewer).toHaveBeenCalled());
    });

    it('launches directly from a picked local snapshot file (not persisted)', async () => {
        const { onNavigateToViewer, container } = renderManager();
        await selectScenario('smoke-empty');
        openSnapshotsTab();
        await waitFor(() => expect(screen.getByText('smoke-empty-t42.json')).toBeInTheDocument());

        const snapshot = {
            version: '2.0',
            meta: { tick: 5, scenario: 'smoke-empty.scenario.js' },
            db: { 'rooms.objects': [] },
            env: { gameTime: 5 },
        };
        const file = new File([JSON.stringify(snapshot)], 'local.json', { type: 'application/json' });
        // jsdom's File lacks .text() (present in real browsers) — stub it
        file.text = () => Promise.resolve(JSON.stringify(snapshot));
        const input = container.querySelector('input[type="file"]');
        expect(input).not.toBeNull();
        fireEvent.change(input, { target: { files: [file] } });

        await waitFor(() =>
            expect(postRunFromSnapshot).toHaveBeenCalledWith(
                expect.objectContaining({ meta: { tick: 5, scenario: 'smoke-empty.scenario.js' } }),
            ),
        );
        await waitFor(() => expect(onNavigateToViewer).toHaveBeenCalled());
    });

    it('shows empty state when there are no snapshots', async () => {
        getSnapshots.mockResolvedValue({ snapshots: [] });
        renderManager();
        await selectScenario('smoke-empty');
        openSnapshotsTab();
        await waitFor(() => expect(screen.getByText('No snapshots for this scenario.')).toBeInTheDocument());
    });

    it('shows a failure message when snapshots cannot be loaded', async () => {
        getSnapshots.mockRejectedValueOnce(new Error('boom'));
        renderManager();
        await selectScenario('smoke-empty');
        openSnapshotsTab();
        await waitFor(() => expect(screen.getByText(/Failed to load snapshots/)).toBeInTheDocument());
    });
});

describe('ScenarioManager Run All / Stop All', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        sessionStorage.clear();
        vi.clearAllMocks();
        getScenarios.mockResolvedValue({ scenarios: SCENARIOS });
        postRunAll.mockResolvedValue({ ok: true });
        postStopAll.mockResolvedValue({ ok: true });
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.restoreAllMocks();
    });

    it('Run All posts a single run-all request and marks all scenarios pending', async () => {
        renderManager();
        const runAllBtn = await waitFor(() => screen.getByRole('button', { name: /Run All/i }));
        fireEvent.click(runAllBtn);

        await waitFor(() => expect(postRunAll).toHaveBeenCalledTimes(1));
        // Both scenarios flip to the pending state
        await waitFor(() => expect(screen.getAllByText('Pending')).toHaveLength(2));
        expect(postRun).not.toHaveBeenCalled();
    });

    it('ignores repeated Run All clicks while a restart is in flight', async () => {
        let resolveRunAll;
        postRunAll.mockImplementation(() => new Promise((res) => (resolveRunAll = res)));
        renderManager();
        const runAllBtn = await waitFor(() => screen.getByRole('button', { name: /Run All/i }));

        fireEvent.click(runAllBtn);
        fireEvent.click(runAllBtn);

        resolveRunAll({ ok: true });
        await waitFor(() => expect(runAllBtn).toBeEnabled());
        expect(postRunAll).toHaveBeenCalledTimes(1);
    });

    it('disables Run All while the restart request is in flight', async () => {
        let resolveRunAll;
        postRunAll.mockImplementation(() => new Promise((res) => (resolveRunAll = res)));
        renderManager();
        const runAllBtn = await waitFor(() => screen.getByRole('button', { name: /Run All/i }));

        fireEvent.click(runAllBtn);
        expect(runAllBtn).toBeDisabled();

        resolveRunAll({ ok: true });
        await waitFor(() => expect(runAllBtn).toBeEnabled());
    });

    it('Stop All posts stop-all and marks active runs as skipped', async () => {
        renderManager();
        const runAllBtn = await waitFor(() => screen.getByRole('button', { name: /Run All/i }));
        fireEvent.click(runAllBtn);
        await waitFor(() => expect(screen.getAllByText('Pending')).toHaveLength(2));

        const stopAllBtn = screen.getByRole('button', { name: /Stop All/i });
        expect(stopAllBtn).toBeEnabled();
        fireEvent.click(stopAllBtn);

        await waitFor(() => expect(postStopAll).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.getAllByText('Skipped')).toHaveLength(2));
        // Persisted like the SSE-driven status updates
        const saved = JSON.parse(sessionStorage.getItem('sit-scenario-statuses') || '{}');
        expect(saved).toEqual({ 'smoke-empty': 'skip', 'world-spawn': 'skip' });
    });

    it('Stop All is disabled when no scenario is pending or running', async () => {
        renderManager();
        const stopAllBtn = await waitFor(() => screen.getByRole('button', { name: /Stop All/i }));
        expect(stopAllBtn).toBeDisabled();
    });
});
