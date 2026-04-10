/**
 * Post-build script: embed the custom icon into all DroidConsole .exe files
 * using rcedit. This is needed because signAndEditExecutable is disabled
 * (Windows symlink permission error prevents winCodeSign extraction).
 */
import { rcedit } from 'rcedit';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const ICO = resolve(ROOT, 'assets', 'icon.ico');
// Only edit the unpacked app .exe — NSIS installers and portable .exe files
// have payloads appended after the PE structure. rcedit strips those payloads,
// corrupting the installer (shrinks from ~80 MB to ~300 KB).
const TARGETS = [
  resolve(ROOT, 'release', 'win-unpacked', 'DroidConsole.exe'),
];

async function main() {
  if (!existsSync(ICO)) {
    console.error('Icon not found:', ICO);
    process.exit(1);
  }

  for (const exe of TARGETS) {
    if (!existsSync(exe)) {
      console.log('Skipping (not found):', exe);
      continue;
    }
    try {
      await rcedit(exe, { icon: ICO });
      console.log('Icon embedded:', exe);
    } catch (err) {
      console.error('Failed to embed icon in', exe, ':', err.message);
    }
  }
}

main();
