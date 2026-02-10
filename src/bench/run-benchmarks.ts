/**
 * CLI entry point for running benchmarks.
 *
 * Usage:
 *   npx tsx src/bench/run-benchmarks.ts [detection|agent|all]
 *
 * Primary entry is via `npm run bench`, but this can be used directly.
 */

import { execSync } from 'node:child_process';

const suite = process.argv[2] ?? 'all';

const configFlag = '--config vitest.bench.config.ts';

const commands: Record<string, string> = {
  detection: `npx vitest run ${configFlag} detection`,
  agent: `npx vitest run ${configFlag} agent`,
  all: `npx vitest run ${configFlag}`,
};

const cmd = commands[suite];
if (!cmd) {
  console.error(`Unknown suite: ${suite}. Use: detection, agent, or all`);
  process.exit(1);
}

console.log(`Running benchmark suite: ${suite}`);
console.log(`Command: ${cmd}\n`);

try {
  execSync(cmd, { stdio: 'inherit', cwd: process.cwd() });
} catch {
  process.exit(1);
}
