import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const WEB = resolve(ROOT, 'web-frontend');
const NODE = process.execPath;
const VITE = resolve(WEB, 'node_modules', 'vite', 'bin', 'vite.js');
const ELECTRON_BUILDER = resolve(ROOT, 'node_modules', 'electron-builder', 'cli.js');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status);
  }
}

run(NODE, [VITE, 'build'], { cwd: WEB });
run(NODE, [ELECTRON_BUILDER, '--dir']);
run(NODE, [resolve(ROOT, 'scripts', 'embed-icon.js')]);
run(NODE, [ELECTRON_BUILDER, '--win', '--prepackaged', resolve(ROOT, 'release', 'win-unpacked')]);
