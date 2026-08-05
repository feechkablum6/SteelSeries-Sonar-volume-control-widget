// renderer.js
// Handles UI interactions for the volume mixer with real audio control

const { ipcRenderer } = require('electron');
const { buildDeviceRouting, orderDevicesForPicker } = require('./device-routing');
const { createSyncGate } = require('./sync-gate');

// Сопоставление index канала с его ID (5 каналов, без master)
const CHANNEL_IDS = ['game', 'chat', 'media', 'aux', 'mic'];

// Синхронизация не запускается поверх незавершённой и не перебивает элемент,
// который пользователь держит прямо сейчас.
const syncGate = createSyncGate();

let isDeviceSwitching = false;
let deviceRouting = null;
let activeDeviceChannel = null;

// Кэш элементов каналов: channelId -> { slider, volDisplay, muteBtn, muteIcon, deviceNameEl }.
// Заполняется один раз в DOMContentLoaded, чтобы не делать querySelector*
// каждые 500 мс в updateVolumesFromState/updateDeviceNames.
const channelCache = new Map();

// Интервал синхронизации (мс)
const SYNC_INTERVAL = 1000;

ipcRenderer.on('device-picker:dismiss', () => closeDevicePicker());

document.addEventListener('DOMContentLoaded', async () => {
    const channels = document.querySelectorAll('.channel');
    setupDesktopDrag();
    setupDevicePicker();

    // Привязать каналы и повесить обработчики кликов/инпутов синхронно —
    // до любых await, чтобы виджет реагировал на клики с первого пэйнта.
    // set-volume/set-mute сами вызывают initialize(), поэтому безопасны
    // даже тогда, когда Sonar ещё не готов.
    channels.forEach((channel, index) => {
        const channelId = CHANNEL_IDS[index];
        channel.dataset.channelId = channelId;
        setupChannel(channel, channelId);
        channelCache.set(channelId, {
            slider: channel.querySelector('.vertical-slider'),
            volDisplay: channel.querySelector('.device-vol'),
            muteBtn: channel.querySelector('.mute-icon-btn'),
            muteIcon: channel.querySelector('.mute-icon-btn')?.querySelector('.material-icons-round'),
            deviceNameEl: channel.querySelector('.device-name')
        });
    });

    // Проверить доступность Sonar — только диагностика в консоль,
    // она не должна гейтить взаимодействие с виджетом.
    const availabilityResult = await ipcRenderer.invoke('audio:check-availability');
    if (!availabilityResult.success || !availabilityResult.available) {
        console.error('SteelSeries Sonar не найден! Убедитесь, что GG запущен.');
    }

    // Загрузить начальное состояние
    await syncWithSonar();

    // Запустить периодическую синхронизацию
    setInterval(syncWithSonar, SYNC_INTERVAL);
});

function setupDesktopDrag() {
    const dragRegion = document.querySelector('.drag-region');
    if (!dragRegion) return;

    let activePointerId = null;
    let pendingPoint = null;
    let animationFrame = null;

    const sendPendingPoint = () => {
        animationFrame = null;
        if (!pendingPoint) return;
        ipcRenderer.send('desktop:drag-move', pendingPoint);
        pendingPoint = null;
    };

    const finishDrag = () => {
        if (activePointerId === null) return;
        if (animationFrame !== null) {
            cancelAnimationFrame(animationFrame);
            sendPendingPoint();
        }
        activePointerId = null;
        dragRegion.classList.remove('dragging');
        ipcRenderer.send('desktop:drag-end');
    };

    dragRegion.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || activePointerId !== null) return;
        activePointerId = event.pointerId;
        dragRegion.setPointerCapture(event.pointerId);
        dragRegion.classList.add('dragging');
        ipcRenderer.send('desktop:drag-start', { x: event.screenX, y: event.screenY });
        event.preventDefault();
    });

    dragRegion.addEventListener('pointermove', (event) => {
        if (event.pointerId !== activePointerId) return;
        pendingPoint = { x: event.screenX, y: event.screenY };
        if (animationFrame === null) {
            animationFrame = requestAnimationFrame(sendPendingPoint);
        }
    });

    dragRegion.addEventListener('pointerup', finishDrag);
    dragRegion.addEventListener('pointercancel', finishDrag);
    dragRegion.addEventListener('lostpointercapture', finishDrag);
}

/**
 * Синхронизация с Sonar API
 */
async function syncWithSonar() {
    if (isDeviceSwitching || !syncGate.tryStart()) return;

    try {
        const result = await ipcRenderer.invoke('audio:get-full-state');
        if (!result.success || !result.state) return;

        const { volumes, devices, redirections } = result.state;

        // Обновить громкости и mute
        if (volumes?.devices) {
            updateVolumesFromState(volumes.devices);
        }

        deviceRouting = buildDeviceRouting(devices, redirections);
        updateDeviceNames(deviceRouting);
    } catch (error) {
        console.error('Sync error:', error);
    } finally {
        syncGate.finish();
    }
}

/**
 * Обновить громкости из состояния API
 */
function updateVolumesFromState(devicesData) {
    for (const [channelId, refs] of channelCache) {
        const apiName = getApiNameForChannel(channelId);
        if (!apiName || !devicesData[apiName]) continue;

        const data = devicesData[apiName].classic;
        if (!data) continue;

        const { slider, volDisplay, muteBtn, muteIcon } = refs;

        // Обновить слайдер (только если пользователь не перетаскивает)
        if (slider && volDisplay) {
            const newVolume = Math.round(data.volume * 100);
            if (parseInt(slider.value) !== newVolume) {
                slider.value = newVolume;
                volDisplay.textContent = `${newVolume}%`;
            }
        }

        // Обновить состояние mute
        if (muteBtn && muteIcon) {
            const isMuted = data.muted;
            const currentlyMuted = muteBtn.classList.contains('muted');

            if (isMuted !== currentlyMuted) {
                if (isMuted) {
                    muteBtn.classList.add('muted');
                    muteIcon.textContent = 'volume_off';
                    muteBtn.style.color = 'rgba(255, 80, 80, 0.9)';
                } else {
                    muteBtn.classList.remove('muted');
                    muteIcon.textContent = 'volume_up';
                    muteBtn.style.color = '';
                }
            }
        }
    }
}

/**
 * Обновить названия устройств
 */
function updateDeviceNames(routing) {
    for (const [channelId, refs] of channelCache) {
        const { deviceNameEl } = refs;
        if (!deviceNameEl || deviceNameEl.dataset.error === 'true') continue;

        const selectedDevice = routing?.[channelId]?.selectedDevice;
        const fullName = selectedDevice?.friendlyName || 'Не выбрано';
        const shortName = shortenDeviceName(fullName);

        if (deviceNameEl.textContent !== shortName) {
            deviceNameEl.textContent = shortName;
        }
        if (deviceNameEl.title !== fullName) {
            deviceNameEl.title = fullName;
        }
    }
}

function setupDevicePicker() {
    const picker = document.querySelector('.device-picker');
    if (!picker) return;

    document.querySelectorAll('.device-name').forEach(button => {
        button.setAttribute('aria-expanded', 'false');
        button.addEventListener('click', event => {
            event.stopPropagation();
            const channelId = button.closest('.channel')?.dataset.channelId;
            if (!channelId) return;

            if (activeDeviceChannel === channelId) {
                closeDevicePicker();
                return;
            }
            openDevicePicker(channelId, button);
        });
    });

    picker.addEventListener('pointerdown', event => event.stopPropagation());
    document.addEventListener('pointerdown', event => {
        if (!event.target.closest('.device-picker, .device-name')) closeDevicePicker();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeDevicePicker();
    });
}

function openDevicePicker(channelId, anchor) {
    const picker = document.querySelector('.device-picker');
    const list = picker?.querySelector('.device-picker-list');
    if (!picker || !list) return;

    closeDevicePicker();
    activeDeviceChannel = channelId;
    anchor.setAttribute('aria-expanded', 'true');
    renderDeviceOptions(channelId, list);

    picker.classList.add('open');
    picker.setAttribute('aria-hidden', 'false');
    ipcRenderer.send('device-picker:opened');
    const anchorRect = anchor.getBoundingClientRect();
    const pickerWidth = 205;
    const left = Math.max(5, Math.min(window.innerWidth - pickerWidth - 5, anchorRect.left));
    const top = Math.min(window.innerHeight - picker.offsetHeight - 5, anchorRect.bottom + 5);
    picker.style.left = `${left}px`;
    picker.style.top = `${Math.max(5, top)}px`;
}

function renderDeviceOptions(channelId, list) {
    list.replaceChildren();
    const route = deviceRouting?.[channelId];
    const devices = orderDevicesForPicker(route);

    if (devices.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'device-picker-empty';
        empty.textContent = 'Нет доступных устройств';
        list.appendChild(empty);
        return;
    }

    devices.forEach(device => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'device-picker-option';
        option.textContent = device.friendlyName;
        option.title = device.friendlyName;
        option.setAttribute('role', 'menuitemradio');
        const isSelected = device.id === route.selectedDeviceId;
        option.classList.toggle('selected', isSelected);
        option.setAttribute('aria-checked', String(isSelected));
        option.addEventListener('click', () => selectAudioDevice(channelId, device.id));
        list.appendChild(option);
    });
}

function closeDevicePicker() {
    const picker = document.querySelector('.device-picker');
    const wasOpen = picker?.classList.contains('open') || false;
    document.querySelectorAll('.device-name[aria-expanded="true"]').forEach(button => {
        button.setAttribute('aria-expanded', 'false');
    });
    picker?.classList.remove('open');
    picker?.setAttribute('aria-hidden', 'true');
    activeDeviceChannel = null;
    if (wasOpen) ipcRenderer.send('device-picker:closed');
}

async function selectAudioDevice(channelId, deviceId) {
    if (isDeviceSwitching) return;
    const channel = document.querySelector(`.channel[data-channel-id="${channelId}"]`);
    const deviceNameEl = channel?.querySelector('.device-name');

    isDeviceSwitching = true;
    if (deviceNameEl) deviceNameEl.disabled = true;

    try {
        const result = await ipcRenderer.invoke('audio:set-device', channelId, deviceId);
        if (!result.success) throw new Error(result.error || 'Sonar отклонил переключение');
        closeDevicePicker();
    } catch (error) {
        console.error(`Error setting device for ${channelId}:`, error);
        if (deviceNameEl) {
            deviceNameEl.dataset.error = 'true';
            deviceNameEl.textContent = 'Ошибка';
            deviceNameEl.title = error.message;
            setTimeout(() => {
                delete deviceNameEl.dataset.error;
                syncWithSonar();
            }, 1200);
        }
    } finally {
        isDeviceSwitching = false;
        if (deviceNameEl) deviceNameEl.disabled = false;
    }

    await syncWithSonar();
}

/**
 * Сократить название устройства
 */
function shortenDeviceName(name) {
    // Убрать "(SteelSeries Sonar Virtual Audio Device)" и подобное
    let short = name.replace(/\s*\([^)]*Virtual[^)]*\)/gi, '');
    short = short.replace(/\s*\([^)]*Audio[^)]*\)/gi, '');
    short = short.trim();
    
    if (short.length > 20) {
        short = short.substring(0, 18) + '...';
    }
    return short || name.substring(0, 18) + '...';
}

/**
 * Получить API имя для канала
 */
function getApiNameForChannel(channelId) {
    const mapping = {
        'game': 'game',
        'chat': 'chatRender',
        'media': 'media',
        'aux': 'aux',
        'mic': 'chatCapture'
    };
    return mapping[channelId];
}

function setupChannel(channel, channelId) {
    const slider = channel.querySelector('.vertical-slider');
    const volDisplay = channel.querySelector('.device-vol');
    const muteBtn = channel.querySelector('.mute-icon-btn');
    const muteIcon = muteBtn.querySelector('.material-icons-round');

    if (slider && volDisplay) {
        // Пока слайдер удерживают, синхронизация не перебивает его значение.
        // Указательные события доводятся браузером до конца даже когда кнопку
        // отпустили за пределами виджета, поэтому удержание не залипает.
        const holdKind = `slider:${channelId}`;
        const releaseHold = () => syncGate.endHold(holdKind);

        slider.addEventListener('pointerdown', () => syncGate.beginHold(holdKind));
        slider.addEventListener('pointerup', releaseHold);
        slider.addEventListener('pointercancel', releaseHold);
        slider.addEventListener('lostpointercapture', releaseHold);

        // Обработка изменения громкости
        slider.addEventListener('input', async (e) => {
            const value = parseInt(e.target.value);
            volDisplay.textContent = `${value}%`;
            syncGate.touchHold(holdKind);

            try {
                await ipcRenderer.invoke('audio:set-volume', channelId, value);
            } catch (error) {
                console.error(`Error setting volume for ${channelId}:`, error);
            }
        });
    }

    if (muteBtn && muteIcon) {
        muteBtn.addEventListener('click', async () => {
            const isMuted = muteBtn.classList.toggle('muted');

            if (isMuted) {
                muteIcon.textContent = 'volume_off';
                muteBtn.style.color = 'rgba(255, 80, 80, 0.9)';
            } else {
                muteIcon.textContent = 'volume_up';
                muteBtn.style.color = '';
            }

            try {
                const result = await ipcRenderer.invoke('audio:set-mute', channelId, isMuted);
                if (!result.success) {
                    muteBtn.classList.toggle('muted');
                }
            } catch (error) {
                console.error(`Error setting mute for ${channelId}:`, error);
            }
        });
    }
}
