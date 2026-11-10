/** The release version lives in package.json; the lockfile and the newest changelog entry must agree. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;
const HEADING = /^## (\S+) – (\d{4}-\d{2}-\d{2}) – \S.*$/;

function compare(a: string, b: string): number {
  const pa = SEMVER.exec(a)!.slice(1, 4).map(Number);
  const pb = SEMVER.exec(b)!.slice(1, 4).map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

const pkg = JSON.parse(read('package.json')) as { version: string };
const lock = JSON.parse(read('package-lock.json')) as {
  version: string;
  packages: Record<string, { version?: string }>;
};
const headings = read('RECENT_CHANGES.md')
  .split('\n')
  .filter((line) => line.startsWith('## '));

describe('release version', () => {
  it('is semantic and matches the lockfile', () => {
    expect(pkg.version).toMatch(SEMVER);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[''].version).toBe(pkg.version);
  });

  it('has a changelog entry “## <version> – <date> – <title>” at the top', () => {
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) expect(heading).toMatch(HEADING);
    expect(HEADING.exec(headings[0])![1]).toBe(pkg.version);
  });

  it('lists releases newest first, each version once, with dates not going forward', () => {
    const entries = headings.map((heading) => HEADING.exec(heading)!.slice(1, 3));
    for (const [version] of entries) expect(version).toMatch(SEMVER);
    for (let i = 1; i < entries.length; i++) {
      expect(compare(entries[i - 1][0], entries[i][0]), `${entries[i - 1][0]} after ${entries[i][0]}`).toBeGreaterThan(
        0,
      );
      expect(entries[i - 1][1] >= entries[i][1], `${entries[i - 1][0]} dated before ${entries[i][0]}`).toBe(true);
    }
  });
});
