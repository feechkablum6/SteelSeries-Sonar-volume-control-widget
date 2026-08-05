const {
    moveWithCollisions,
    isPositionFree,
    findNearestFreePosition
} = require('./desktop-layout');

function reservedRectsFromDisplays(displays) {
    const reservedRects = [];

    for (const display of displays ?? []) {
        const bounds = display?.bounds;
        const workArea = display?.workArea;
        if (!bounds || !workArea || bounds.width <= 0 || bounds.height <= 0) continue;

        const boundsRight = bounds.x + bounds.width;
        const boundsBottom = bounds.y + bounds.height;
        const workLeft = Math.min(Math.max(workArea.x, bounds.x), boundsRight);
        const workTop = Math.min(Math.max(workArea.y, bounds.y), boundsBottom);
        const workRight = Math.min(
            Math.max(workArea.x + workArea.width, bounds.x),
            boundsRight
        );
        const workBottom = Math.min(
            Math.max(workArea.y + workArea.height, bounds.y),
            boundsBottom
        );

        if (workTop > bounds.y) {
            reservedRects.push({
                x: bounds.x,
                y: bounds.y,
                width: bounds.width,
                height: workTop - bounds.y
            });
        }
        if (workBottom < boundsBottom) {
            reservedRects.push({
                x: bounds.x,
                y: workBottom,
                width: bounds.width,
                height: boundsBottom - workBottom
            });
        }
        if (workLeft > bounds.x && workBottom > workTop) {
            reservedRects.push({
                x: bounds.x,
                y: workTop,
                width: workLeft - bounds.x,
                height: workBottom - workTop
            });
        }
        if (workRight < boundsRight && workBottom > workTop) {
            reservedRects.push({
                x: workRight,
                y: workTop,
                width: boundsRight - workRight,
                height: workBottom - workTop
            });
        }
    }

    return reservedRects;
}

class DesktopHost {
    constructor(native, options = {}) {
        this.native = native;
        this.gap = options.gap ?? 0;
        this.windowHandle = null;
        this.desktop = null;
        this.position = null;
        this.size = null;
        this.iconRects = [];
        this.reservedRects = [];
    }

    async connect(windowHandle, desiredPosition, size) {
        const desktop = this.native.findDesktop();
        if (!desktop) return false;

        const iconRects = await this.native.readIconRects(desktop);
        if (!Array.isArray(iconRects)) return false;
        const reservedRects = this.native.readReservedRects?.(desktop) ?? [];
        if (!Array.isArray(reservedRects)) return false;
        const obstacles = [...iconRects, ...reservedRects];

        const position = findNearestFreePosition(
            desiredPosition,
            size,
            obstacles,
            desktop.bounds,
            this.gap
        );
        if (!position) return false;

        if (!this.native.attachWindow(windowHandle, desktop, position, size)) {
            return false;
        }

        this.windowHandle = windowHandle;
        this.desktop = desktop;
        this.position = position;
        this.size = size;
        this.iconRects = iconRects;
        this.reservedRects = reservedRects;
        return true;
    }

    // Проверка привязки дешёвая (несколько FindWindowEx), поэтому выполняется
    // часто. Снимок значков стоит N кросс-процессных сообщений Explorer, поэтому
    // запрашивается только при смене рабочего стола и по редкому расписанию.
    async refresh(options = {}) {
        const rescanIcons = options.rescanIcons ?? true;
        if (!this.windowHandle || !this.position || !this.size) return false;

        const desktop = this.native.findDesktop();
        if (!desktop) return false;

        const desktopChanged = !this.desktop ||
            !this.native.sameHandle(this.desktop.parent, desktop.parent) ||
            !this.native.sameHandle(this.desktop.listView, desktop.listView);

        // При смене окна рабочего стола (Win+D, перезапуск Explorer) перепривязать
        // виджет к новому родителю немедленно, с последней известной позицией —
        // SetParent/SetWindowPos синхронны, и окно снова становится кликабельным
        // за миллисекунды. Тяжёлый readIconRects (N кросс-процессных
        // LVM_GETITEMRECT) идёт после и лишь корректирует позицию при перекрытии.
        if (desktopChanged) {
            if (!this.native.attachWindow(this.windowHandle, desktop, this.position, this.size)) {
                return false;
            }
            this.desktop = desktop;
        }

        if (!rescanIcons && !desktopChanged) {
            this.desktop = desktop;
            return true;
        }

        const iconRects = await this.native.readIconRects(desktop);
        if (!Array.isArray(iconRects)) return false;
        const reservedRects = this.native.readReservedRects?.(desktop) ?? [];
        if (!Array.isArray(reservedRects)) return false;
        const obstacles = [...iconRects, ...reservedRects];

        let position = this.position;
        if (!isPositionFree(position, this.size, obstacles, this.gap)) {
            position = findNearestFreePosition(
                position,
                this.size,
                obstacles,
                desktop.bounds,
                this.gap
            );
            if (!position) return false;
        }

        if (!this.positionsEqual(position, this.position) &&
            !this.native.moveWindow(this.windowHandle, desktop, position, this.size)) {
            return false;
        }

        this.desktop = desktop;
        this.position = position;
        this.iconRects = iconRects;
        this.reservedRects = reservedRects;
        return true;
    }

    moveTowards(targetPosition) {
        if (!this.windowHandle || !this.desktop || !this.position || !this.size) {
            return this.position;
        }

        const nextPosition = moveWithCollisions(
            this.position,
            targetPosition,
            this.size,
            [...this.iconRects, ...this.reservedRects],
            this.desktop.bounds,
            this.gap
        );

        if (this.positionsEqual(nextPosition, this.position)) return this.position;
        if (!this.native.moveWindow(
            this.windowHandle,
            this.desktop,
            nextPosition,
            this.size
        )) {
            return this.position;
        }

        this.position = nextPosition;
        return this.position;
    }

    getPosition() {
        return this.position ? { ...this.position } : null;
    }

    positionsEqual(first, second) {
        return first.x === second.x && first.y === second.y;
    }
}

// Предел ожидания одного сообщения Explorer и всего обхода значков (мс)
const MESSAGE_TIMEOUT = 1000;
const SNAPSHOT_TIMEOUT = 3000;

function createWindowsDesktopNative(koffi, options = {}) {
    const now = options.now ?? (() => Date.now());
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');

    const api = {
        FindWindowA: user32.func('FindWindowA', 'void*', ['str', 'str']),
        FindWindowExA: user32.func('FindWindowExA', 'void*', ['void*', 'void*', 'str', 'str']),
        GetClientRect: user32.func('GetClientRect', 'int', ['void*', 'void*']),
        GetWindowRect: user32.func('GetWindowRect', 'int', ['void*', 'void*']),
        MapWindowPoints: user32.func('MapWindowPoints', 'int', ['void*', 'void*', 'void*', 'uint']),
        GetWindowThreadProcessId: user32.func('GetWindowThreadProcessId', 'uint32', ['void*', 'void*']),
        SendMessageTimeoutA: user32.func(
            'SendMessageTimeoutA',
            'intptr_t',
            ['void*', 'uint32', 'uintptr_t', 'intptr_t', 'uint32', 'uint32', 'void*']
        ),
        GetWindowLongA: user32.func('GetWindowLongA', 'long', ['void*', 'int']),
        SetWindowLongA: user32.func('SetWindowLongA', 'long', ['void*', 'int', 'long']),
        SetWindowLongPtrA: user32.func('SetWindowLongPtrA', 'intptr_t', ['void*', 'int', 'intptr_t']),
        SetParent: user32.func('SetParent', 'void*', ['void*', 'void*']),
        GetParent: user32.func('GetParent', 'void*', ['void*']),
        GetWindow: user32.func('GetWindow', 'void*', ['void*', 'uint']),
        SetWindowPos: user32.func('SetWindowPos', 'int', ['void*', 'void*', 'int', 'int', 'int', 'int', 'uint']),
        IsWindow: user32.func('IsWindow', 'int', ['void*']),
        OpenProcess: kernel32.func('OpenProcess', 'void*', ['uint32', 'int', 'uint32']),
        VirtualAllocEx: kernel32.func('VirtualAllocEx', 'void*', ['void*', 'void*', 'size_t', 'uint32', 'uint32']),
        VirtualFreeEx: kernel32.func('VirtualFreeEx', 'int', ['void*', 'void*', 'size_t', 'uint32']),
        ReadProcessMemory: kernel32.func('ReadProcessMemory', 'int', ['void*', 'void*', 'void*', 'size_t', 'void*']),
        WriteProcessMemory: kernel32.func('WriteProcessMemory', 'int', ['void*', 'void*', 'void*', 'size_t', 'void*']),
        CloseHandle: kernel32.func('CloseHandle', 'int', ['void*'])
    };

    const constants = {
        GWL_STYLE: -16,
        GWL_EXSTYLE: -20,
        GWLP_HWNDPARENT: -8,
        GW_HWNDPREV: 3,
        GW_OWNER: 4,
        WS_CHILD: 0x40000000,
        WS_POPUP: 0x80000000,
        WS_EX_TOPMOST: 0x00000008,
        WS_EX_TOOLWINDOW: 0x00000080,
        WS_EX_APPWINDOW: 0x00040000,
        WS_EX_NOACTIVATE: 0x08000000,
        SWP_NOACTIVATE: 0x0010,
        SWP_NOZORDER: 0x0004,
        SWP_NOOWNERZORDER: 0x0200,
        SWP_SHOWWINDOW: 0x0040,
        SWP_FRAMECHANGED: 0x0020,
        SMTO_ABORTIFHUNG: 0x0002,
        PROCESS_RIGHTS: 0x0438,
        MEM_COMMIT_RESERVE: 0x3000,
        MEM_RELEASE: 0x8000,
        PAGE_READWRITE: 0x04,
        LVM_GETITEMCOUNT: 0x1004,
        LVM_GETITEMRECT: 0x100e
    };

    function toAddress(value) {
        if (value == null) return 0n;
        if (typeof value === 'bigint') return value;
        if (typeof value === 'number') return BigInt(value);
        if (Buffer.isBuffer(value)) {
            return value.length >= 8
                ? value.readBigUInt64LE(0)
                : BigInt(value.readUInt32LE(0));
        }
        return koffi.address(value);
    }

    function readRect(buffer) {
        const left = buffer.readInt32LE(0);
        const top = buffer.readInt32LE(4);
        const right = buffer.readInt32LE(8);
        const bottom = buffer.readInt32LE(12);
        return {
            x: left,
            y: top,
            width: right - left,
            height: bottom - top
        };
    }

    // Ответ Explorer ограничен по времени: зависший shell иначе блокирует
    // рабочий поток Koffi навсегда, и виджет больше никогда не перепривязывается
    // к рабочему столу. SMTO_ABORTIFHUNG прекращает ожидание, как только
    // Windows считает окно-получатель зависшим. null означает недоставку.
    function sendDesktopMessage(windowHandle, message, wParam, lParam) {
        return new Promise(resolve => {
            const resultBuffer = Buffer.alloc(8);
            api.SendMessageTimeoutA.async(
                windowHandle,
                message,
                wParam,
                lParam,
                constants.SMTO_ABORTIFHUNG,
                MESSAGE_TIMEOUT,
                resultBuffer,
                (error, delivered) => {
                    if (error || !delivered) {
                        resolve(null);
                        return;
                    }
                    resolve(Number(resultBuffer.readBigInt64LE(0)));
                }
            );
        });
    }

    function findChild(parent, className, title = null) {
        return toAddress(api.FindWindowExA(parent, 0n, className, title));
    }

    function desktopFromParent(parent) {
        if (!parent) return null;
        const defView = findChild(parent, 'SHELLDLL_DefView');
        if (!defView) return null;
        const listView = findChild(defView, 'SysListView32', 'FolderView') ||
            findChild(defView, 'SysListView32');
        if (!listView) return null;

        const rectBuffer = Buffer.alloc(16);
        if (!api.GetClientRect(listView, rectBuffer)) return null;
        api.MapWindowPoints(listView, 0n, rectBuffer, 2);

        return {
            parent,
            shellParent: parent,
            defView,
            listView,
            bounds: readRect(rectBuffer)
        };
    }

    function findDesktop() {
        const progman = toAddress(api.FindWindowA('Progman', null));
        const progmanDesktop = desktopFromParent(progman);
        if (progmanDesktop) return progmanDesktop;

        let worker = 0n;
        while (true) {
            worker = toAddress(api.FindWindowExA(0n, worker, 'WorkerW', null));
            if (!worker) break;
            const workerDesktop = desktopFromParent(worker);
            if (workerDesktop) return workerDesktop;
        }
        return null;
    }

    async function readIconRects(desktop) {
        if (!desktop?.listView || !api.IsWindow(desktop.listView)) return null;

        const pidBuffer = Buffer.alloc(4);
        api.GetWindowThreadProcessId(desktop.listView, pidBuffer);
        const processId = pidBuffer.readUInt32LE(0);
        if (!processId) return null;

        const processHandle = toAddress(api.OpenProcess(
            constants.PROCESS_RIGHTS,
            0,
            processId
        ));
        if (!processHandle) return null;

        const remoteRect = toAddress(api.VirtualAllocEx(
            processHandle,
            0n,
            16,
            constants.MEM_COMMIT_RESERVE,
            constants.PAGE_READWRITE
        ));
        if (!remoteRect) {
            api.CloseHandle(processHandle);
            return null;
        }

        // Недоставленное по таймауту сообщение может дойти до Explorer позже и
        // записать результат в этот буфер, поэтому освобождать его в таком
        // случае нельзя: 16 байт остаются занятыми до перезапуска Explorer.
        let remoteRectReleasable = true;

        try {
            const count = await sendDesktopMessage(
                desktop.listView,
                constants.LVM_GETITEMCOUNT,
                0,
                0n
            );
            if (count === null) {
                remoteRectReleasable = false;
                console.error('Explorer did not answer the desktop icon query in time');
                return null;
            }
            const rects = [];
            const localRect = Buffer.alloc(16);
            const deadline = now() + SNAPSHOT_TIMEOUT;

            for (let index = 0; index < count; index += 1) {
                // Медленный, но живой Explorer не должен занимать рабочий поток
                // весь обход: неполный список значков хуже прежнего, поэтому
                // снимок отбрасывается целиком и повторяется по расписанию.
                if (now() > deadline) {
                    console.error('Desktop icon snapshot exceeded its time budget');
                    return null;
                }
                localRect.fill(0);
                if (!api.WriteProcessMemory(
                    processHandle,
                    remoteRect,
                    localRect,
                    localRect.length,
                    0n
                )) continue;

                const success = await sendDesktopMessage(
                    desktop.listView,
                    constants.LVM_GETITEMRECT,
                    index,
                    remoteRect
                );
                if (success === null) {
                    remoteRectReleasable = false;
                    console.error('Explorer did not answer the desktop icon query in time');
                    return null;
                }
                if (!success) continue;

                if (!api.ReadProcessMemory(
                    processHandle,
                    remoteRect,
                    localRect,
                    localRect.length,
                    0n
                )) continue;

                api.MapWindowPoints(desktop.listView, 0n, localRect, 2);
                const rect = readRect(localRect);
                if (rect.width > 0 && rect.height > 0) rects.push(rect);
            }

            return rects;
        } finally {
            if (remoteRectReleasable) {
                api.VirtualFreeEx(processHandle, remoteRect, 0, constants.MEM_RELEASE);
            }
            api.CloseHandle(processHandle);
        }
    }

    function setStyles(windowHandle) {
        const style = api.GetWindowLongA(windowHandle, constants.GWL_STYLE);
        const popupStyle = (style | constants.WS_POPUP) & ~constants.WS_CHILD;
        api.SetWindowLongA(windowHandle, constants.GWL_STYLE, popupStyle);

        const exStyle = api.GetWindowLongA(windowHandle, constants.GWL_EXSTYLE);
        const desktopStyle = (
            (exStyle | constants.WS_EX_TOOLWINDOW | constants.WS_EX_NOACTIVATE) &
            ~constants.WS_EX_TOPMOST &
            ~constants.WS_EX_APPWINDOW
        );
        api.SetWindowLongA(windowHandle, constants.GWL_EXSTYLE, desktopStyle);
    }

    function moveWindow(windowHandle, desktop, position, size) {
        if (!desktop?.parent || !api.IsWindow(desktop.parent)) return false;
        return Boolean(api.SetWindowPos(
            windowHandle,
            0n,
            Math.round(position.x),
            Math.round(position.y),
            size.width,
            size.height,
            constants.SWP_NOACTIVATE |
                constants.SWP_NOZORDER |
                constants.SWP_NOOWNERZORDER |
                constants.SWP_SHOWWINDOW
        ));
    }

    function attachWindow(windowHandleValue, desktop, position, size) {
        const windowHandle = toAddress(windowHandleValue);
        if (!windowHandle || !desktop?.parent || !api.IsWindow(desktop.parent)) {
            return false;
        }

        if (toAddress(api.GetParent(windowHandle))) api.SetParent(windowHandle, 0n);
        setStyles(windowHandle);
        api.SetWindowLongPtrA(
            windowHandle,
            constants.GWLP_HWNDPARENT,
            desktop.parent
        );
        if (toAddress(api.GetWindow(windowHandle, constants.GW_OWNER)) !== desktop.parent) {
            return false;
        }

        const windowAboveOwner = toAddress(api.GetWindow(
            desktop.parent,
            constants.GW_HWNDPREV
        ));
        return Boolean(api.SetWindowPos(
            windowHandle,
            windowAboveOwner,
            Math.round(position.x),
            Math.round(position.y),
            size.width,
            size.height,
            constants.SWP_NOACTIVATE |
                constants.SWP_NOOWNERZORDER |
                constants.SWP_SHOWWINDOW |
                constants.SWP_FRAMECHANGED
        ));
    }

    return {
        findDesktop,
        readIconRects,
        readReservedRects: () => reservedRectsFromDisplays(options.getDisplays?.() ?? []),
        attachWindow,
        moveWindow: (windowHandle, desktop, position, size) => moveWindow(
            toAddress(windowHandle), desktop, position, size
        ),
        sameHandle: (left, right) => toAddress(left) === toAddress(right),
        getWindowRect: (windowHandle) => {
            const rectBuffer = Buffer.alloc(16);
            return api.GetWindowRect(toAddress(windowHandle), rectBuffer)
                ? readRect(rectBuffer)
                : null;
        },
        getParent: (windowHandle) => {
            const handle = toAddress(windowHandle);
            return toAddress(api.GetWindow(handle, constants.GW_OWNER)) ||
                toAddress(api.GetParent(handle));
        }
    };
}

module.exports = {
    DesktopHost,
    createWindowsDesktopNative,
    reservedRectsFromDisplays
};
