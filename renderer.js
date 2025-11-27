// renderer.js
// Handles UI interactions for the volume mixer with real audio control

const { ipcRenderer } = require('electron');

// Сопоставление index канала с его ID (5 каналов, без master)
const CHANNEL_IDS = ['game', 'chat', 'media', 'aux', 'mic'];

// Маппинг API role на channelId
const ROLE_TO_CHANNEL = {
    'game': 'game',
    'chatRender': 'chat',
    'media': 'media',
    'aux': 'aux',
    'chatCapture': 'mic'
};

// Флаг для предотвращения обновления во время перетаскивания слайдера
let isUserDragging = false;

// Интервал синхронизации (мс)
const SYNC_INTERVAL = 500;

document.addEventListener('DOMContentLoaded', async () => {
    const channels = document.querySelectorAll('.channel');

    // Проверить доступность Sonar
    const availabilityResult = await ipcRenderer.invoke('audio:check-availability');
    if (!availabilityResult.success || !availabilityResult.available) {
        console.error('SteelSeries Sonar не найден! Убедитесь, что GG запущен.');
    }

    channels.forEach((channel, index) => {
        const channelId = CHANNEL_IDS[index];
        channel.dataset.channelId = channelId;
        setupChannel(channel, channelId);
    });

    // Загрузить начальное состояние
    await syncWithSonar();

    // Запустить периодическую синхронизацию
    setInterval(syncWithSonar, SYNC_INTERVAL);
});

/**
 * Синхронизация с Sonar API
 */
async function syncWithSonar() {
    if (isUserDragging) return;

    try {
        const result = await ipcRenderer.invoke('audio:get-full-state');
        if (!result.success || !result.state) return;

        const { volumes, devices } = result.state;
        
        // Обновить громкости и mute
        if (volumes?.devices) {
            updateVolumesFromState(volumes.devices);
        }

        // Обновить названия устройств
        if (devices?.length > 0) {
            updateDeviceNames(devices);
        }
    } catch (error) {
        console.error('Sync error:', error);
    }
}

/**
 * Обновить громкости из состояния API
 */
function updateVolumesFromState(devicesData) {
    const channels = document.querySelectorAll('.channel');
    
    channels.forEach((channel) => {
        const channelId = channel.dataset.channelId;
        const apiName = getApiNameForChannel(channelId);
        if (!apiName || !devicesData[apiName]) return;

        const data = devicesData[apiName].classic;
        if (!data) return;

        const slider = channel.querySelector('.vertical-slider');
        const volDisplay = channel.querySelector('.device-vol');
        const muteBtn = channel.querySelector('.mute-icon-btn');
        const muteIcon = muteBtn?.querySelector('.material-icons-round');

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
    });
}

/**
 * Обновить названия устройств
 */
function updateDeviceNames(devices) {
    devices.forEach(device => {
        const channelId = ROLE_TO_CHANNEL[device.role];
        if (!channelId) return;

        const channel = document.querySelector(`.channel[data-channel-id="${channelId}"]`);
        if (!channel) return;

        const deviceNameEl = channel.querySelector('.device-name');
        if (deviceNameEl && device.friendlyName) {
            // Сократить название если слишком длинное
            const shortName = shortenDeviceName(device.friendlyName);
            if (deviceNameEl.textContent !== shortName) {
                deviceNameEl.textContent = shortName;
                deviceNameEl.title = device.friendlyName; // Полное имя в tooltip
            }
        }
    });
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
        // Начало перетаскивания
        slider.addEventListener('mousedown', () => { isUserDragging = true; });
        slider.addEventListener('touchstart', () => { isUserDragging = true; });
        
        // Конец перетаскивания
        slider.addEventListener('mouseup', () => { isUserDragging = false; });
        slider.addEventListener('touchend', () => { isUserDragging = false; });
        slider.addEventListener('mouseleave', () => { isUserDragging = false; });

        // Обработка изменения громкости
        slider.addEventListener('input', async (e) => {
            const value = parseInt(e.target.value);
            volDisplay.textContent = `${value}%`;

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
