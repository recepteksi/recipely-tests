import fs from 'fs';
import path from 'path';
import type { Reporter, TestCase, TestResult, FullResult, Suite } from '@playwright/test/reporter';

/**
 * Custom Playwright reporter for the Recipely suite.
 *
 * At the END of every run it prints failing tests as a LIST. Each row carries a
 * ready-to-paste `claude` command that, when run, starts Claude fixing that
 * test/selector. A combined command at the bottom fixes every failure at once.
 *
 * Outputs:
 *  - Console (colored list)
 *  - test-results/failures.md   (Markdown table — one column = claude command)
 *  - test-results/failures.json (machine-readable)
 */

interface Failure {
  project: string;
  title: string;
  loc: string;
  error: string;
  claudeCmd: string;
}

const stripAnsi = (s: unknown): string => String(s || '').replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');

function firstErrorLine(error: { message?: string; value?: string } | undefined): string {
  const msg = stripAnsi((error && (error.message || error.value)) || '').trim();
  const line = msg.split('\n').map((l) => l.trim()).filter(Boolean)[0] || 'Unknown error';
  return line.slice(0, 160);
}

function projectNameOf(test: TestCase): string {
  let s: Suite | undefined = test.parent;
  while (s) {
    try {
      const p = s.project?.();
      if (p && p.name) return p.name;
    } catch {
      /* climb */
    }
    s = s.parent;
  }
  return 'default';
}

export default class ClaudeReporter implements Reporter {
  private failures: Failure[] = [];
  private passed = 0;
  private skipped = 0;
  private flaky = 0;
  private _bulkCmd = '';

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'passed') {
      if (result.retry > 0) this.flaky++;
      else this.passed++;
      return;
    }
    if (result.status === 'skipped') {
      this.skipped++;
      return;
    }
    // failed | timedOut | interrupted — record only the final attempt.
    if (test.outcome && test.outcome() === 'flaky') return;
    if (typeof test.retries === 'number' && result.retry < test.retries) return;

    const file = path.relative(process.cwd(), test.location.file);
    const loc = `${file}:${test.location.line}`;
    const project = projectNameOf(test);
    const title = test.title;
    const error = firstErrorLine(result.error);

    const prompt =
      `Recipely Playwright test failed. Project: ${project}. Location: ${loc}. ` +
      `Test: "${title}". Error: ${error}. ` +
      `Inspect the test or the helpers/recipely.ts selector and fix it. ` +
      `If the app behavior is wrong, note it instead of changing the test to pass.`;
    const claudeCmd = `claude "${prompt.replace(/"/g, '\\"')}"`;

    this.failures.push({ project, title, loc, error, claudeCmd });
  }

  private _buildBulkCommand(): string {
    const list = this.failures
      .map((f, i) => `${i + 1}) [${f.project}] ${f.loc} "${f.title}" -> ${f.error}`)
      .join(' ');
    const prompt =
      `The following ${this.failures.length} Recipely Playwright tests failed; ` +
      `review each, find the root cause, fix the test/helper (or report a real app ` +
      `bug), then re-run the affected project to verify: ${list}`;
    return `claude "${prompt.replace(/"/g, '\\"')}"`;
  }

  onEnd(_result: FullResult): void {
    const C = {
      red: (s: string) => `\x1b[31m${s}\x1b[0m`,
      green: (s: string) => `\x1b[32m${s}\x1b[0m`,
      yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
      cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
      dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
      bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
    };

    console.log('\n' + C.bold('═'.repeat(70)));
    console.log(
      C.bold('  TEST SUMMARY  ') +
        C.green(`${this.passed} passed`) +
        '  ·  ' +
        C.red(`${this.failures.length} failed`) +
        '  ·  ' +
        C.yellow(`${this.flaky} flaky`) +
        '  ·  ' +
        C.dim(`${this.skipped} skipped`),
    );
    console.log(C.bold('═'.repeat(70)));

    let bulkCmd = '';
    if (this.failures.length === 0) {
      console.log(C.green('\n  ✓ All tests passed — nothing to fix.\n'));
    } else {
      console.log(C.bold(C.red('\n  FAILED TESTS (with fix commands)\n')));
      this.failures.forEach((f, i) => {
        console.log(C.red(`  ${i + 1}. ${f.title}`));
        console.log(`     ${C.dim('Project:')} ${f.project}`);
        console.log(`     ${C.dim('Location:')} ${C.cyan(f.loc)}`);
        console.log(`     ${C.dim('Error   :')} ${f.error}`);
        console.log(`     ${C.dim('Fix     :')} ${C.yellow(f.claudeCmd)}`);
        console.log('');
      });

      bulkCmd = this._buildBulkCommand();
      console.log(C.bold(C.cyan('  ⚡ BULK FIX — resolve every failure with one command:\n')));
      console.log('  ' + C.yellow(bulkCmd) + '\n');
    }
    this._bulkCmd = bulkCmd;

    try {
      const outDir = path.join(process.cwd(), 'test-results');
      fs.mkdirSync(outDir, { recursive: true });

      const md =
        `# Failed Test List\n\n` +
        `_Generated: ${new Date().toISOString()}_\n\n` +
        `Summary: **${this.passed} passed**, **${this.failures.length} failed**, ` +
        `**${this.flaky} flaky**, ${this.skipped} skipped.\n\n` +
        (this.failures.length === 0
          ? '✅ Nothing to fix.\n'
          : `| # | Project | Test | Location | Error | Fix (claude command) |\n` +
            `|---|---------|------|----------|-------|----------------------|\n` +
            this.failures
              .map(
                (f, i) =>
                  `| ${i + 1} | ${f.project} | ${f.title.replace(/\|/g, '\\|')} | \`${f.loc}\` | ${f.error.replace(/\|/g, '\\|')} | \`${f.claudeCmd.replace(/\|/g, '\\|')}\` |`,
              )
              .join('\n') +
            '\n\n## ⚡ Bulk fix (resolve all failures with one command)\n\n' +
            '```bash\n' + this._bulkCmd + '\n```\n');

      fs.writeFileSync(path.join(outDir, 'failures.md'), md);
      fs.writeFileSync(
        path.join(outDir, 'failures.json'),
        JSON.stringify(
          {
            passed: this.passed,
            failed: this.failures.length,
            flaky: this.flaky,
            skipped: this.skipped,
            failures: this.failures,
          },
          null,
          2,
        ),
      );
      if (this.failures.length) {
        console.log(C.dim(`  → Saved: test-results/failures.md  (+ .json)\n`));
      }
    } catch (e) {
      console.log('Could not write failures.md:', (e as Error).message);
    }
  }
}
