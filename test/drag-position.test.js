const test = require('node:test');
const assert = require('node:assert/strict');

const { beginDrag, dragTarget } = require('../drag-position');

test('keeps the pointer anchored to the same widget point', () => {
    const session = beginDrag(
        { x: 100, y: 50 },
        { x: 20, y: 10 }
    );

    assert.deepEqual(session, { offsetX: 80, offsetY: 40 });
    assert.deepEqual(
        dragTarget({ x: 150, y: 80 }, session),
        { x: 70, y: 40 }
    );
});
