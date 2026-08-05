const AUTO_LAUNCH_NAME = 'SonarGlassWidget';

function createAutoLaunchController(app, options = {}) {
    const platform = options.platform ?? process.platform;
    const environment = options.environment ?? process.env;
    const executablePath = options.executablePath ??
        environment.PORTABLE_EXECUTABLE_FILE ??
        app.getPath('exe');
    const query = {
        path: executablePath,
        args: []
    };

    return {
        isEnabled() {
            if (platform !== 'win32') return false;
            const settings = app.getLoginItemSettings(query);
            return typeof settings.executableWillLaunchAtLogin === 'boolean'
                ? settings.executableWillLaunchAtLogin
                : Boolean(settings.openAtLogin);
        },

        setEnabled(enabled) {
            if (platform !== 'win32') return;
            app.setLoginItemSettings({
                openAtLogin: Boolean(enabled),
                ...query,
                name: AUTO_LAUNCH_NAME
            });
        }
    };
}

function createWidgetMenuTemplate({ autoLaunch, quit }) {
    return [
        {
            label: 'Запускать вместе с ПК',
            type: 'checkbox',
            checked: autoLaunch.isEnabled(),
            click: menuItem => autoLaunch.setEnabled(menuItem.checked)
        },
        { type: 'separator' },
        {
            label: 'Закрыть',
            click: quit
        }
    ];
}

module.exports = {
    AUTO_LAUNCH_NAME,
    createAutoLaunchController,
    createWidgetMenuTemplate
};
