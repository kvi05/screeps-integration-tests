import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import Timeline from '../src/components/Timeline';

/**
 * Renders Timeline with sensible defaults + per-test overrides.
 * Returns the merged props (callbacks are vi.fn spies) + RTL utils.
 *
 * @param {Object} props
 * @returns {Object}
 */
function renderTimeline(props = {}) {
    const defaults = {
        connected: true,
        ended: false,
        serverState: 'paused',
        serverTick: 42,
        playing: true,
        tick: 10,
        maxTicks: 50,
        speed: 5,
        onTogglePlay: vi.fn(),
        onSeekTick: vi.fn(),
        onStepForward: vi.fn(),
        onStepBack: vi.fn(),
        onSetSpeed: vi.fn(),
        onRewind: vi.fn(),
        onSave: vi.fn(),
        onBackToScenarios: vi.fn(),
    };
    const merged = { ...defaults, ...props };
    const utils = render(React.createElement(Timeline, merged));
    return { ...merged, ...utils, props: merged };
}

/** @param {Object} utils @returns {HTMLInputElement} */
function scrubber(utils) {
    return utils.getByLabelText('Scrub timeline');
}

/** @param {Object} utils @returns {HTMLButtonElement} */
function rewindBtn(utils) {
    return utils.getByLabelText('Rewind server');
}

/** @param {Object} utils @returns {HTMLButtonElement} */
function saveBtn(utils) {
    return utils.getByLabelText('Save snapshot');
}

describe('Timeline', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    // ── Play / pause ──────────────────────────────────────────────

    it('shows Pause and calls onTogglePlay(false) when playing', () => {
        const utils = renderTimeline({ playing: true });
        fireEvent.click(utils.getByLabelText('Pause'));
        expect(utils.onTogglePlay).toHaveBeenCalledWith(false);
    });

    it('shows Play and calls onTogglePlay(true) when paused', () => {
        const utils = renderTimeline({ playing: false });
        fireEvent.click(utils.getByLabelText('Play'));
        expect(utils.onTogglePlay).toHaveBeenCalledWith(true);
    });

    it('disables play/pause without frames and without a controllable server', () => {
        const utils = renderTimeline({ connected: false, maxTicks: -1 });
        expect(utils.getByLabelText('Pause')).toBeDisabled();
    });

    // ── Steps ─────────────────────────────────────────────────────

    it('step back disabled at tick 0, enabled otherwise', () => {
        const utils = renderTimeline({ tick: 0 });
        expect(utils.getByLabelText('Step back one tick')).toBeDisabled();
        utils.rerender(React.createElement(Timeline, { ...utils.props, tick: 3 }));
        expect(utils.getByLabelText('Step back one tick')).not.toBeDisabled();
    });

    it('step back calls onStepBack', () => {
        const utils = renderTimeline({ tick: 5 });
        fireEvent.click(utils.getByLabelText('Step back one tick'));
        expect(utils.onStepBack).toHaveBeenCalled();
    });

    it('step forward in the past moves the cursor (calls onStepForward)', () => {
        const utils = renderTimeline({ tick: 10, maxTicks: 50 });
        const btn = utils.getByLabelText('Step forward +1 tick');
        expect(btn).not.toBeDisabled();
        fireEvent.click(btn);
        expect(utils.onStepForward).toHaveBeenCalled();
    });

    it('step forward at the edge steps the server when paused', () => {
        const utils = renderTimeline({ tick: 50, maxTicks: 50, serverState: 'paused' });
        const btn = utils.getByLabelText('Step server +1 tick');
        expect(btn).not.toBeDisabled();
        fireEvent.click(btn);
        expect(utils.onStepForward).toHaveBeenCalled();
    });

    it('step forward at the edge is disabled while the server is running', () => {
        const utils = renderTimeline({ tick: 50, maxTicks: 50, serverState: 'running' });
        expect(utils.getByLabelText('Step server +1 tick')).toBeDisabled();
    });

    it('step forward at the edge is disabled when the server is not controllable', () => {
        const utils = renderTimeline({ tick: 50, maxTicks: 50, ended: true });
        expect(utils.getByLabelText('Step server +1 tick')).toBeDisabled();
    });

    // ── Scrubber ──────────────────────────────────────────────────

    it('scrubbing calls onSeekTick with the requested value', () => {
        const utils = renderTimeline({ tick: 10, maxTicks: 50 });
        fireEvent.change(scrubber(utils), { target: { value: '25' } });
        expect(utils.onSeekTick).toHaveBeenCalledWith(25);
    });

    it('clamps scrubber value to the valid range', () => {
        const utils = renderTimeline({ tick: 99, maxTicks: 20 });
        expect(scrubber(utils).value).toBe('20');
    });

    it('scrubber follows the cursor when the app re-renders (autoscroll)', () => {
        const utils = renderTimeline({ tick: 10, maxTicks: 50 });
        expect(scrubber(utils).value).toBe('10');
        utils.rerender(React.createElement(Timeline, { ...utils.props, tick: 50 }));
        expect(scrubber(utils).value).toBe('50');
    });

    // ── Rewind / Save ─────────────────────────────────────────────

    it('rewind is disabled at the edge and enabled in the past', () => {
        const utils = renderTimeline({ tick: 50, maxTicks: 50 });
        expect(rewindBtn(utils)).toBeDisabled();
        utils.rerender(React.createElement(Timeline, { ...utils.props, tick: 25 }));
        expect(rewindBtn(utils)).not.toBeDisabled();
    });

    it('calls onRewind when rewind button clicked', () => {
        const utils = renderTimeline({ tick: 25, maxTicks: 50 });
        fireEvent.click(rewindBtn(utils));
        expect(utils.onRewind).toHaveBeenCalled();
    });

    it('save is enabled at the edge while the server is controllable', () => {
        const utils = renderTimeline({ tick: 50, maxTicks: 50 });
        expect(saveBtn(utils)).not.toBeDisabled();
        fireEvent.click(saveBtn(utils));
        expect(utils.onSave).toHaveBeenCalled();
    });

    it('save is disabled when the server is not controllable', () => {
        const utils = renderTimeline({ ended: true });
        expect(saveBtn(utils)).toBeDisabled();
    });

    // ── Speed ─────────────────────────────────────────────────────

    it('single speed selector has the unified ladder', () => {
        const utils = renderTimeline();
        const options = [...utils.getByLabelText('Speed').options].map((o) => Number(o.value));
        expect(options).toEqual([1, 5, 10, 20, 50, 1000]);
    });

    it('speed change calls onSetSpeed', () => {
        const utils = renderTimeline();
        fireEvent.change(utils.getByLabelText('Speed'), { target: { value: '50' } });
        expect(utils.onSetSpeed).toHaveBeenCalledWith(50);
    });

    it('speed step buttons move through the ladder', () => {
        const utils = renderTimeline({ speed: 10 });
        fireEvent.click(utils.getByTitle('Increase speed'));
        expect(utils.onSetSpeed).toHaveBeenCalledWith(20);
    });

    // ── Back ──────────────────────────────────────────────────────

    it('back button navigates to scenarios', () => {
        const utils = renderTimeline();
        fireEvent.click(utils.getByText('Scenarios'));
        expect(utils.onBackToScenarios).toHaveBeenCalled();
    });
});
