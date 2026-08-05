// Ворота периодической синхронизации с Sonar.
// Решают две задачи: не запускать новый опрос поверх незавершённого и не
// обновлять элемент, который пользователь держит прямо сейчас. Удержание живёт
// не дольше HOLD_TIMEOUT: событие отпускания может не дойти (окно перекрыли,
// указатель ушёл за пределы виджета), а синхронизация не должна из-за этого
// остановиться навсегда.

const HOLD_TIMEOUT = 3000;

function createSyncGate(options = {}) {
    const now = options.now ?? (() => Date.now());
    const holdTimeout = options.holdTimeout ?? HOLD_TIMEOUT;
    const holds = new Map();
    let running = false;

    function isHeld() {
        const deadline = now() - holdTimeout;
        for (const [kind, touchedAt] of holds) {
            if (touchedAt <= deadline) holds.delete(kind);
        }
        return holds.size > 0;
    }

    return {
        tryStart() {
            if (running || isHeld()) return false;
            running = true;
            return true;
        },

        finish() {
            running = false;
        },

        beginHold(kind) {
            holds.set(kind, now());
        },

        touchHold(kind) {
            if (holds.has(kind)) holds.set(kind, now());
        },

        endHold(kind) {
            holds.delete(kind);
        },

        isHeld
    };
}

module.exports = { createSyncGate, HOLD_TIMEOUT };
