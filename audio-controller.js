// audio-controller.js
// Модуль для управления громкостью через SteelSeries Sonar API

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

// Отключить проверку SSL
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const CORE_PROPS_PATH = path.join(
    process.env.ProgramData || 'C:\\ProgramData',
    'SteelSeries',
    'SteelSeries Engine 3',
    'coreProps.json'
);

// Маппинг каналов UI на API
const CHANNEL_MAPPING = {
    'master': { apiPath: 'masters', apiName: null },
    'game': { apiPath: 'devices', apiName: 'game' },
    'chat': { apiPath: 'devices', apiName: 'chatRender' },
    'media': { apiPath: 'devices', apiName: 'media' },
    'aux': { apiPath: 'devices', apiName: 'aux' },
    'mic': { apiPath: 'devices', apiName: 'chatCapture' }
};

let webServerAddress = null;
let isInitialized = false;

/**
 * HTTP запрос
 */
function httpRequest(url, method = 'GET') {
    return new Promise((resolve, reject) => {
        const isHttps = url.startsWith('https');
        const lib = isHttps ? https : http;
        
        const req = lib.request(url, { method, rejectUnauthorized: false }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, data }));
        });
        req.on('error', reject);
        req.setTimeout(2000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.end();
    });
}

/**
 * Инициализация — получить webServerAddress
 */
async function initialize() {
    if (isInitialized && webServerAddress) return true;

    try {
        if (!fs.existsSync(CORE_PROPS_PATH)) {
            console.error('coreProps.json not found');
            return false;
        }

        const coreProps = JSON.parse(fs.readFileSync(CORE_PROPS_PATH, 'utf8'));
        const baseUrl = `https://${coreProps.ggEncryptedAddress}`;

        const subAppsRes = await httpRequest(baseUrl + '/subApps');
        if (subAppsRes.status !== 200) return false;

        const subApps = JSON.parse(subAppsRes.data);
        const sonar = subApps.subApps?.sonar;

        if (!sonar?.isEnabled || !sonar?.isRunning) {
            console.error('Sonar is not enabled or not running');
            return false;
        }

        webServerAddress = sonar.metadata?.webServerAddress;
        if (!webServerAddress) return false;

        isInitialized = true;
        console.log('Sonar API initialized:', webServerAddress);
        return true;
    } catch (error) {
        console.error('Failed to initialize Sonar API:', error.message);
        return false;
    }
}

/**
 * Получить все данные громкости
 */
async function getVolumeData() {
    if (!await initialize()) return null;

    try {
        const res = await httpRequest(webServerAddress + '/volumeSettings/classic');
        if (res.status !== 200) return null;
        return JSON.parse(res.data);
    } catch (error) {
        console.error('Failed to get volume data:', error.message);
        return null;
    }
}

/**
 * Получить громкость канала
 */
async function getVolume(channelId) {
    const data = await getVolumeData();
    if (!data) return null;

    const mapping = CHANNEL_MAPPING[channelId];
    if (!mapping) return null;

    try {
        if (mapping.apiPath === 'masters') {
            return Math.round(data.masters.classic.volume * 100);
        } else {
            return Math.round(data.devices[mapping.apiName].classic.volume * 100);
        }
    } catch {
        return null;
    }
}

/**
 * Установить громкость канала
 */
async function setVolume(channelId, volume) {
    if (!await initialize()) return false;

    const mapping = CHANNEL_MAPPING[channelId];
    if (!mapping) return false;

    const normalizedVolume = Math.max(0, Math.min(100, volume)) / 100;

    try {
        let url;
        if (mapping.apiPath === 'masters') {
            url = `${webServerAddress}/volumeSettings/classic/master/Volume/${normalizedVolume}`;
        } else {
            url = `${webServerAddress}/volumeSettings/classic/${mapping.apiName}/Volume/${normalizedVolume}`;
        }

        const res = await httpRequest(url, 'PUT');
        return res.status === 200;
    } catch (error) {
        console.error(`Failed to set volume for ${channelId}:`, error.message);
        return false;
    }
}

/**
 * Получить состояние mute канала
 */
async function getMute(channelId) {
    const data = await getVolumeData();
    if (!data) return null;

    const mapping = CHANNEL_MAPPING[channelId];
    if (!mapping) return null;

    try {
        if (mapping.apiPath === 'masters') {
            return data.masters.classic.muted;
        } else {
            return data.devices[mapping.apiName].classic.muted;
        }
    } catch {
        return null;
    }
}

/**
 * Установить состояние mute канала
 */
async function setMute(channelId, muted) {
    if (!await initialize()) return false;

    const mapping = CHANNEL_MAPPING[channelId];
    if (!mapping) return false;

    try {
        let url;
        if (mapping.apiPath === 'masters') {
            url = `${webServerAddress}/volumeSettings/classic/master/Mute/${muted}`;
        } else {
            url = `${webServerAddress}/volumeSettings/classic/${mapping.apiName}/Mute/${muted}`;
        }

        const res = await httpRequest(url, 'PUT');
        return res.status === 200;
    } catch (error) {
        console.error(`Failed to set mute for ${channelId}:`, error.message);
        return false;
    }
}

/**
 * Проверить доступность Sonar
 */
async function checkSonarAvailability() {
    return await initialize();
}

/**
 * Получить chatMix данные
 */
async function getChatMix() {
    if (!await initialize()) return null;

    try {
        const res = await httpRequest(webServerAddress + '/chatMix');
        if (res.status !== 200) return null;
        return JSON.parse(res.data);
    } catch {
        return null;
    }
}

/**
 * Установить chatMix баланс (-1 до 1)
 */
async function setChatMix(balance) {
    if (!await initialize()) return false;

    const clampedBalance = Math.max(-1, Math.min(1, balance));

    try {
        const url = `${webServerAddress}/chatMix?balance=${clampedBalance}`;
        const res = await httpRequest(url, 'PUT');
        return res.status === 200;
    } catch {
        return false;
    }
}

/**
 * Получить список аудио устройств с их ролями
 */
async function getAudioDevices() {
    if (!await initialize()) return [];

    try {
        const res = await httpRequest(webServerAddress + '/audioDevices');
        if (res.status !== 200) return [];
        return JSON.parse(res.data);
    } catch {
        return [];
    }
}

/**
 * Получить полное состояние для синхронизации (громкости + устройства)
 */
async function getFullState() {
    if (!await initialize()) return null;

    try {
        const [volumeRes, devicesRes] = await Promise.all([
            httpRequest(webServerAddress + '/volumeSettings/classic'),
            httpRequest(webServerAddress + '/audioDevices')
        ]);

        const result = {
            volumes: null,
            devices: []
        };

        if (volumeRes.status === 200) {
            result.volumes = JSON.parse(volumeRes.data);
        }

        if (devicesRes.status === 200) {
            result.devices = JSON.parse(devicesRes.data);
        }

        return result;
    } catch (error) {
        console.error('Failed to get full state:', error.message);
        return null;
    }
}

module.exports = {
    initialize,
    getVolumeData,
    getVolume,
    setVolume,
    getMute,
    setMute,
    checkSonarAvailability,
    getChatMix,
    setChatMix,
    getAudioDevices,
    getFullState,
    CHANNEL_MAPPING
};
