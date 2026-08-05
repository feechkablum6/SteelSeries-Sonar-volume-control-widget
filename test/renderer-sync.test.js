const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function readRendererSource() {
    return fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
}

test('ends a slider interaction even when the pointer leaves the widget', () => {
    const source = readRendererSource();

    assert.doesNotMatch(
        source,
        /addEventListener\('mousedown'/,
        'mouse events cannot report a release that happens outside the window'
    );
    for (const eventName of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture']) {
        assert.ok(
            source.includes(`'${eventName}'`),
            `the slider must handle ${eventName} to release the sync hold`
        );
    }
});

test('drives synchronization through the shared gate', () => {
    const source = readRendererSource();

    assert.match(source, /require\('\.\/sync-gate'\)/);
    assert.match(source, /syncGate\.tryStart\(\)/);
    assert.match(source, /syncGate\.finish\(\)/);
    assert.doesNotMatch(
        source,
        /let isUserDragging/,
        'the stale drag latch must be gone'
    );
});
