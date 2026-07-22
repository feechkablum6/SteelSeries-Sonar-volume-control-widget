const {
    moveWithCollisions,
    isPositionFree,
    findNearestFreePosition
} = require('./desktop-layout');

class DesktopHost {
    constructor(native, options = {}) {
        this.native = native;
        this.gap = options.gap ?? 0;
        this.windowHandle = null;
        this.desktop = null;
        this.position = null;
        this.size = null;
        this.iconRects = [];
    }

    connect(windowHandle, desiredPosition, size) {
        const desktop = this.native.findDesktop();
        if (!desktop) return false;

        const iconRects = this.native.readIconRects(desktop);
        if (!Array.isArray(iconRects)) return false;

        const position = findNearestFreePosition(
            desiredPosition,
            size,
            iconRects,
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
        return true;
    }

    refresh() {
        if (!this.windowHandle || !this.position || !this.size) return false;

        const desktop = this.native.findDesktop();
        if (!desktop) return false;

        const iconRects = this.native.readIconRects(desktop);
        if (!Array.isArray(iconRects)) return false;

        const desktopChanged = !this.desktop ||
            !this.native.sameHandle(this.desktop.parent, desktop.parent) ||
            !this.native.sameHandle(this.desktop.listView, desktop.listView);

        let position = this.position;
        if (!isPositionFree(position, this.size, iconRects, this.gap)) {
            position = findNearestFreePosition(
                position,
                this.size,
                iconRects,
                desktop.bounds,
                this.gap
            );
            if (!position) return false;
        }

        const applied = desktopChanged
            ? this.native.attachWindow(this.windowHandle, desktop, position, this.size)
            : this.positionsEqual(position, this.position) ||
                this.native.moveWindow(this.windowHandle, desktop, position, this.size);

        if (!applied) return false;

        this.desktop = desktop;
        this.position = position;
        this.iconRects = iconRects;
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
            this.iconRects,
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

function createWindowsDesktopNative(koffi) {
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');

    const api = {
        FindWindowA: user32.func('FindWindowA', 'void*', ['str', 'str']),
        FindWindowExA: user32.func('FindWindowExA', 'void*', ['void*', 'void*', 'str', 'str']),
        GetClientRect: user32.func('GetClientRect', 'int', ['void*', 'void*']),
        GetWindowRect: user32.func('GetWindowRect', 'int', ['void*', 'void*']),
        MapWindowPoints: user32.func('MapWindowPoints', 'int', ['void*', 'void*', 'void*', 'uint']),
        GetWindowThreadProcessId: user32.func('GetWindowThreadProcessId', 'uint32', ['void*', 'void*']),
        SendMessageA: user32.func('SendMessageA', 'intptr_t', ['void*', 'uint32', 'uintptr_t', 'intptr_t']),
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

    function readIconRects(desktop) {
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

        try {
            const count = Number(api.SendMessageA(
                desktop.listView,
                constants.LVM_GETITEMCOUNT,
                0,
                0n
            ));
            const rects = [];
            const localRect = Buffer.alloc(16);

            for (let index = 0; index < count; index += 1) {
                localRect.fill(0);
                if (!api.WriteProcessMemory(
                    processHandle,
                    remoteRect,
                    localRect,
                    localRect.length,
                    0n
                )) continue;

                const success = api.SendMessageA(
                    desktop.listView,
                    constants.LVM_GETITEMRECT,
                    index,
                    remoteRect
                );
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
            api.VirtualFreeEx(processHandle, remoteRect, 0, constants.MEM_RELEASE);
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
    createWindowsDesktopNative
};
