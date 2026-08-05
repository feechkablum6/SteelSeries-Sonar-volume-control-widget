const test = require('node:test');
const assert = require('node:assert/strict');

const { createSyncGate, HOLD_TIMEOUT } = require('../sync-gate');

function createClock() {
    let current = 0;
    return {
        now: () => current,
        advance: milliseconds => { current += milliseconds; }
    };
}

test('runs one synchronization at a time', () => {
    const gate = createSyncGate();

    assert.equal(gate.tryStart(), true);
    assert.equal(gate.tryStart(), false, 'a pending run must not be duplicated');

    gate.finish();
    assert.equal(gate.tryStart(), true);
});

test('pauses synchronization while the user holds a control', () => {
    const clock = createClock();
    const gate = createSyncGate({ now: clock.now });

    gate.beginHold('slider');
    assert.equal(gate.tryStart(), false);

    gate.endHold('slider');
    assert.equal(gate.tryStart(), true);
});

test('releases a hold that was never ended', () => {
    const clock = createClock();
    const gate = createSyncGate({ now: clock.now });

    gate.beginHold('slider');
    clock.advance(HOLD_TIMEOUT + 1);

    assert.equal(
        gate.tryStart(),
        true,
        'a stuck hold must not freeze synchronization forever'
    );
});

test('keeps the hold alive while the user is still interacting', () => {
    const clock = createClock();
    const gate = createSyncGate({ now: clock.now });

    gate.beginHold('slider');
    clock.advance(HOLD_TIMEOUT - 1);
    gate.touchHold('slider');
    clock.advance(HOLD_TIMEOUT - 1);

    assert.equal(gate.tryStart(), false);
});

test('tracks holds of different kinds independently', () => {
    const clock = createClock();
    const gate = createSyncGate({ now: clock.now });

    gate.beginHold('slider');
    gate.beginHold('device');
    gate.endHold('slider');

    assert.equal(gate.tryStart(), false);

    gate.endHold('device');
    assert.equal(gate.tryStart(), true);
});

test('finishing a run that never started is harmless', () => {
    const gate = createSyncGate();

    gate.finish();

    assert.equal(gate.tryStart(), true);
});
