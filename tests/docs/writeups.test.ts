import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const read = (path: string) => readFileSync(path, 'utf8');

function sections(markdown: string, marker: string): string[] {
  return markdown.split('\n' + marker).slice(1);
}

it('E100 write-ups present and within limits', () => {
  for (const path of ['REVIEW.md', 'DECISIONS.md', 'README.md', 'ai-logs']) expect(existsSync(path)).toBe(true);

  const answers = sections(read('DECISIONS.md'), '## ');
  expect(answers).toHaveLength(6);
  for (const answer of answers) {
    const body = answer.split('\n').slice(1).join(' ');
    expect(body.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(150);
  }

  const findings = sections(read('REVIEW.md'), '### ');
  expect(findings.length).toBeGreaterThan(0);
  for (const finding of findings) {
    expect(finding).toContain('**Scenario:**');
    expect(finding).toContain('**Fix:**');
  }

  const readme = read('README.md');
  for (const heading of ['## Run', '## Tests', '## Known issues', '## What next']) expect(readme).toContain(heading);

  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
  expect(tracked.filter(line => /^\.env(\.local)?$/.test(line))).toEqual([]);
});
