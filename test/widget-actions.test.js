const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const modulePath = path.join(projectRoot, 'widget-actions.js');

test('provides actions for auto launch and quitting', () => {
    assert.equal(
        fs.existsSync(modulePath),
        true,
        'widget-actions.js should provide the context-menu behavior'
    );

    const {
        createAutoLaunchController,
        createWidgetMenuTemplate
    } = require(modulePath);
    let openAtLogin = true;
    const writes = [];
    const app = {
        getPath: name => {
            assert.equal(name, 'exe');
            return 'C:\\Apps\\Sonar Glass Widget.exe';
        },
        getLoginItemSettings: options => {
            assert.deepEqual(options, {
                path: 'C:\\Apps\\Sonar Glass Widget.exe',
                args: []
            });
            return {
                openAtLogin,
                executableWillLaunchAtLogin: openAtLogin
            };
        },
        setLoginItemSettings: settings => {
            writes.push(settings);
            openAtLogin = settings.openAtLogin;
        }
    };
    const autoLaunch = createAutoLaunchController(app, { platform: 'win32' });
    let quitCalls = 0;
    const template = createWidgetMenuTemplate({
        autoLaunch,
        quit: () => {
            quitCalls += 1;
        }
    });

    assert.equal(template.length, 3);
    assert.deepEqual(
        template.map(item => item.label || item.type),
        ['Запускать вместе с ПК', 'separator', 'Закрыть']
    );
    assert.equal(template[0].type, 'checkbox');
    assert.equal(template[0].checked, true);

    template[0].click({ checked: false });
    assert.deepEqual(writes, [{
        openAtLogin: false,
        path: 'C:\\Apps\\Sonar Glass Widget.exe',
        args: [],
        name: 'SonarGlassWidget'
    }]);

    template[2].click();
    assert.equal(quitCalls, 1);
});

test('shows auto launch as disabled when Windows Startup Apps disabled the entry', () => {
    const {
        createAutoLaunchController,
        createWidgetMenuTemplate
    } = require(modulePath);
    const app = {
        getPath: () => 'C:\\Apps\\Sonar Glass Widget.exe',
        getLoginItemSettings: () => ({
            openAtLogin: true,
            executableWillLaunchAtLogin: false
        }),
        setLoginItemSettings: () => {}
    };
    const template = createWidgetMenuTemplate({
        autoLaunch: createAutoLaunchController(app, { platform: 'win32' }),
        quit: () => {}
    });

    assert.equal(template[0].checked, false);
});

test('uses the outer portable executable for auto launch', () => {
    const { createAutoLaunchController } = require(modulePath);
    const writes = [];
    const app = {
        getPath: () => {
            throw new Error('temporary unpacked executable must not be used');
        },
        getLoginItemSettings: options => ({
            openAtLogin: options.path === 'D:\\Portable\\Sonar Glass Widget.exe',
            executableWillLaunchAtLogin: true
        }),
        setLoginItemSettings: settings => writes.push(settings)
    };
    const controller = createAutoLaunchController(app, {
        platform: 'win32',
        environment: {
            PORTABLE_EXECUTABLE_FILE: 'D:\\Portable\\Sonar Glass Widget.exe'
        }
    });

    assert.equal(controller.isEnabled(), true);
    controller.setEnabled(true);
    assert.equal(writes[0].path, 'D:\\Portable\\Sonar Glass Widget.exe');
});

test('wires the actions to the widget context menu and packaged files', () => {
    const mainSource = fs.readFileSync(path.join(projectRoot, 'main.js'), 'utf8');
    const packageJson = JSON.parse(
        fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
    );

    assert.match(mainSource, /webContents\.on\('context-menu'/);
    assert.ok(packageJson.build.files.includes('widget-actions.js'));
});
