const VK_ESCAPE = 0x1b;
const WH_KEYBOARD_LL = 13;
const WH_MOUSE_LL = 14;
const WM_KEYDOWN = 0x0100;
const WM_SYSKEYDOWN = 0x0104;
const MOUSE_DOWN_MESSAGES = new Set([
    0x0201,
    0x0204,
    0x0207,
    0x020b
]);
const windowsNativeCache = new WeakMap();

class GlobalInputMonitor {
    constructor(native, options) {
        this.native = native;
        this.ownerProcessId = options.ownerProcessId;
        this.onDismiss = options.onDismiss;
        this.onError = options.onError || (message => console.error(message));
        this.defer = options.defer || setImmediate;
        this.subscriptions = [];
        this.dismissPending = false;
    }

    start() {
        if (this.isActive()) return true;

        try {
            this.subscriptions.push(
                this.native.installPointerMonitor(targetProcessId => {
                    if (targetProcessId !== this.ownerProcessId) {
                        this.requestDismiss('outside-click');
                    }
                })
            );
            this.subscriptions.push(
                this.native.installKeyboardMonitor(virtualKey => {
                    if (virtualKey === VK_ESCAPE) this.requestDismiss('escape');
                })
            );
            return true;
        } catch (error) {
            this.stop();
            this.onError(`Failed to start global input monitor: ${error.message}`);
            return false;
        }
    }

    stop() {
        const subscriptions = this.subscriptions;
        this.subscriptions = [];
        this.dismissPending = false;

        subscriptions.forEach(subscription => {
            if (!subscription) return;
            try {
                this.native.uninstall(subscription);
            } catch (error) {
                this.onError(`Failed to stop global input monitor: ${error.message}`);
            }
        });
    }

    isActive() {
        return this.subscriptions.length > 0;
    }

    requestDismiss(reason) {
        if (this.dismissPending || !this.isActive()) return;
        this.dismissPending = true;
        this.defer(() => {
            if (!this.isActive()) return;
            this.stop();
            this.onDismiss(reason);
        });
    }
}

function createWindowsGlobalInputNative(koffi) {
    const cached = windowsNativeCache.get(koffi);
    if (cached) return cached;

    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');
    const Point = koffi.struct('GlobalInputPoint', {
        x: 'int32',
        y: 'int32'
    });
    const MouseHookStruct = koffi.struct('GlobalMouseHookStruct', {
        pt: Point,
        mouseData: 'uint32',
        flags: 'uint32',
        time: 'uint32',
        extraInfo: 'uintptr_t'
    });
    const KeyboardHookStruct = koffi.struct('GlobalKeyboardHookStruct', {
        virtualKey: 'uint32',
        scanCode: 'uint32',
        flags: 'uint32',
        time: 'uint32',
        extraInfo: 'uintptr_t'
    });
    const HookProc = koffi.proto(
        'intptr_t __stdcall GlobalInputHookProc(int code, uintptr_t message, void *data)'
    );
    const HookProcPointer = koffi.pointer(HookProc);
    const api = {
        SetWindowsHookExW: user32.func(
            'SetWindowsHookExW',
            'void*',
            ['int', HookProcPointer, 'void*', 'uint32']
        ),
        CallNextHookEx: user32.func(
            'CallNextHookEx',
            'intptr_t',
            ['void*', 'int', 'uintptr_t', 'void*']
        ),
        UnhookWindowsHookEx: user32.func(
            'UnhookWindowsHookEx',
            'int',
            ['void*']
        ),
        WindowFromPoint: user32.func('WindowFromPoint', 'void*', [Point]),
        GetWindowThreadProcessId: user32.func(
            'GetWindowThreadProcessId',
            'uint32',
            ['void*', 'void*']
        ),
        GetModuleHandleW: kernel32.func('GetModuleHandleW', 'void*', ['str16'])
    };
    const moduleHandle = api.GetModuleHandleW(null);

    function installHook(hookType, callbackBody) {
        const callback = koffi.register((code, message, data) => {
            try {
                if (code >= 0) callbackBody(Number(message), data);
            } catch (error) {
                console.error('Global input hook callback failed:', error.message);
            }
            return api.CallNextHookEx(0n, code, message, data);
        }, HookProcPointer);

        const handle = api.SetWindowsHookExW(hookType, callback, moduleHandle, 0);
        if (!handle) {
            koffi.unregister(callback);
            throw new Error(`SetWindowsHookExW failed for hook ${hookType}`);
        }
        return { handle, callback };
    }

    const native = {
        installPointerMonitor(handler) {
            return installHook(WH_MOUSE_LL, (message, data) => {
                if (!MOUSE_DOWN_MESSAGES.has(message)) return;
                const mouse = koffi.decode(data, MouseHookStruct);
                const targetWindow = api.WindowFromPoint(mouse.pt);
                const processIdBuffer = Buffer.alloc(4);
                if (targetWindow) {
                    api.GetWindowThreadProcessId(targetWindow, processIdBuffer);
                }
                handler(processIdBuffer.readUInt32LE(0));
            });
        },

        installKeyboardMonitor(handler) {
            return installHook(WH_KEYBOARD_LL, (message, data) => {
                if (message !== WM_KEYDOWN && message !== WM_SYSKEYDOWN) return;
                const keyboard = koffi.decode(data, KeyboardHookStruct);
                handler(keyboard.virtualKey);
            });
        },

        uninstall(subscription) {
            try {
                if (subscription.handle) api.UnhookWindowsHookEx(subscription.handle);
            } finally {
                if (subscription.callback) koffi.unregister(subscription.callback);
            }
        }
    };
    windowsNativeCache.set(koffi, native);
    return native;
}

module.exports = {
    GlobalInputMonitor,
    createWindowsGlobalInputNative,
    VK_ESCAPE
};
