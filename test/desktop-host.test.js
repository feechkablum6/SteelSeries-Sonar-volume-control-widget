const test = require('node:test');
const assert = require('node:assert/strict');

const { DesktopHost } = require('../desktop-host');

function createNative(overrides = {}) {
    const calls = [];
    const desktop = {
        parent: 'progman-1',
        listView: 'list-1',
        bounds: { x: 0, y: 0, width: 300, height: 100 }
    };

    return {
        calls,
        desktop,
        findDesktop: () => desktop,
        readIconRects: () => [{ x: 0, y: 0, width: 100, height: 100 }],
        attachWindow: (windowHandle, foundDesktop, position, size) => {
            calls.push(['attach', windowHandle, foundDesktop.parent, position, size]);
            return true;
        },
        moveWindow: (windowHandle, foundDesktop, position, size) => {
            calls.push(['move', windowHandle, foundDesktop.parent, position, size]);
            return true;
        },
        sameHandle: (left, right) => left === right,
        ...overrides
    };
}

test('connects to the desktop and relocates away from an icon', () => {
    const native = createNative();
    const host = new DesktopHost(native, { gap: 0 });

    const connected = host.connect(
        'widget',
        { x: 0, y: 0 },
        { width: 100, height: 100 }
    );

    assert.equal(connected, true);
    assert.deepEqual(host.getPosition(), { x: 100, y: 0 });
    assert.deepEqual(native.calls[0], [
        'attach',
        'widget',
        'progman-1',
        { x: 100, y: 0 },
        { width: 100, height: 100 }
    ]);
});

test('moves the widget against icon walls', () => {
    const native = createNative({
        readIconRects: () => [{ x: 150, y: 0, width: 50, height: 100 }]
    });
    const host = new DesktopHost(native);
    host.connect('widget', { x: 0, y: 0 }, { width: 100, height: 100 });

    const position = host.moveTowards({ x: 250, y: 0 });

    assert.deepEqual(position, { x: 50, y: 0 });
    assert.deepEqual(native.calls.at(-1).slice(0, 4), [
        'move', 'widget', 'progman-1', { x: 50, y: 0 }
    ]);
});

test('reattaches when Explorer replaces the desktop window', () => {
    let activeDesktop = {
        parent: 'progman-1',
        listView: 'list-1',
        bounds: { x: 0, y: 0, width: 300, height: 100 }
    };
    const native = createNative({
        findDesktop: () => activeDesktop,
        readIconRects: () => []
    });
    const host = new DesktopHost(native);
    host.connect('widget', { x: 100, y: 0 }, { width: 100, height: 100 });

    activeDesktop = {
        parent: 'progman-2',
        listView: 'list-2',
        bounds: { x: 0, y: 0, width: 300, height: 100 }
    };
    const refreshed = host.refresh();

    assert.equal(refreshed, true);
    assert.deepEqual(native.calls.at(-1).slice(0, 3), [
        'attach', 'widget', 'progman-2'
    ]);
});

test('moves to a free position when a new icon overlaps the widget', () => {
    let iconRects = [];
    const native = createNative({ readIconRects: () => iconRects });
    const host = new DesktopHost(native);
    host.connect('widget', { x: 100, y: 0 }, { width: 100, height: 100 });

    iconRects = [{ x: 100, y: 0, width: 100, height: 100 }];
    host.refresh();

    assert.deepEqual(host.getPosition(), { x: 0, y: 0 });
    assert.deepEqual(native.calls.at(-1).slice(0, 4), [
        'move', 'widget', 'progman-1', { x: 0, y: 0 }
    ]);
});
