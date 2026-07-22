const test = require('node:test');
const assert = require('node:assert/strict');

const {
    rectsOverlap,
    clampPosition,
    moveWithCollisions,
    findNearestFreePosition
} = require('../desktop-layout');

test('touching rectangle edges do not count as overlap', () => {
    const left = { x: 0, y: 0, width: 100, height: 100 };
    const right = { x: 100, y: 0, width: 100, height: 100 };

    assert.equal(rectsOverlap(left, right), false);
});

test('clamps the widget to the virtual desktop bounds', () => {
    const bounds = { x: -1920, y: 0, width: 3840, height: 1080 };
    const size = { width: 450, height: 300 };

    assert.deepEqual(
        clampPosition({ x: 1800, y: -50 }, size, bounds),
        { x: 1470, y: 0 }
    );
});

test('stops at an icon wall while moving right', () => {
    const result = moveWithCollisions(
        { x: 0, y: 0 },
        { x: 300, y: 0 },
        { width: 100, height: 100 },
        [{ x: 250, y: 0, width: 100, height: 100 }],
        { x: 0, y: 0, width: 800, height: 600 }
    );

    assert.deepEqual(result, { x: 150, y: 0 });
});

test('slides along an icon wall instead of entering it', () => {
    const result = moveWithCollisions(
        { x: 100, y: 100 },
        { x: 250, y: 250 },
        { width: 50, height: 50 },
        [{ x: 200, y: 100, width: 100, height: 100 }],
        { x: 0, y: 0, width: 800, height: 600 }
    );

    assert.deepEqual(result, { x: 150, y: 250 });
});

test('stops at an icon wall while moving left', () => {
    const result = moveWithCollisions(
        { x: 350, y: 0 },
        { x: 100, y: 0 },
        { width: 100, height: 100 },
        [{ x: 200, y: 0, width: 100, height: 100 }],
        { x: 0, y: 0, width: 800, height: 600 }
    );

    assert.deepEqual(result, { x: 300, y: 0 });
});

test('finds the nearest free position after the icon layout changes', () => {
    const result = findNearestFreePosition(
        { x: 0, y: 0 },
        { width: 100, height: 100 },
        [{ x: 0, y: 0, width: 100, height: 100 }],
        { x: 0, y: 0, width: 300, height: 100 }
    );

    assert.deepEqual(result, { x: 100, y: 0 });
});

test('returns null when the desktop has no free position', () => {
    const result = findNearestFreePosition(
        { x: 0, y: 0 },
        { width: 100, height: 100 },
        [{ x: 0, y: 0, width: 100, height: 100 }],
        { x: 0, y: 0, width: 100, height: 100 }
    );

    assert.equal(result, null);
});
