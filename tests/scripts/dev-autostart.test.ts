import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const plist = fs.readFileSync('scripts/com.mediapilot.dev.plist', 'utf8');
const install = fs.readFileSync('scripts/install-dev-autostart.sh', 'utf8');

describe('dev server autostart', () => {
  it('starts the web server once at login on a fixed port, from a login shell', () => {
    expect(plist).toContain('<string>com.mediapilot.dev</string>');
    expect(plist).toContain('cd "__PROJECT_DIR__" || exit 1; exec npm run dev -- -p 3000');
    expect(plist).toContain('<string>/bin/zsh</string>');
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
    expect(plist).not.toContain('KeepAlive');
    expect(plist).toContain('__PROJECT_DIR__/logs/dev.log');
  });
  it('installs and uninstalls with launchctl', () => {
    expect(install).toContain('LABEL="com.mediapilot.dev"');
    expect(install).toContain('launchctl load -w "$PLIST"');
    expect(install).toContain('uninstall');
  });
});
