const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

function localRequires(fileName) {
    const source = fs.readFileSync(path.join(projectRoot, fileName), 'utf8');
    return [...source.matchAll(/require\('\.\/([\w-]+)'\)/g)]
        .map(match => `${match[1]}.js`);
}

test('ships every local module the widget loads at runtime', () => {
    const packaged = new Set(
        require(path.join(projectRoot, 'package.json')).build.files
    );
    const entryPoints = ['main.js', 'renderer.js'];
    const pending = [...entryPoints];
    const seen = new Set(entryPoints);

    while (pending.length > 0) {
        const fileName = pending.pop();
        for (const dependency of localRequires(fileName)) {
            assert.ok(
                packaged.has(dependency),
                `${dependency} is required by ${fileName} but missing from build.files`
            );
            if (!seen.has(dependency)) {
                seen.add(dependency);
                pending.push(dependency);
            }
        }
    }
});
