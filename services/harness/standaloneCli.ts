#!/usr/bin/env node
/**
 * Luminara Archy: Standalone CLI Runner
 * Execute from terminal: node services/harness/standaloneCli.ts <group> <action> [args] [--flags]
 */

import { commandRouterService } from './commandRouterService.ts';

async function main() {
  const rawArgs = process.argv.slice(2);
  const commandLine = rawArgs.join(' ');

  try {
    const result = await commandRouterService.executeCommandLine(commandLine);
    if (result.format === 'json' || rawArgs.includes('--json')) {
      console.log(result.output);
    } else {
      console.log(result.output);
      console.log(`\n[Luminara Archy] Executed in ${result.executionTimeMs}ms (${result.status})`);
    }
    process.exit(result.status === 'error' ? 1 : 0);
  } catch (err: any) {
    console.error(`[Luminara Archy Error] ${err?.message || err}`);
    process.exit(1);
  }
}

if (typeof process !== 'undefined' && process.argv) {
  main();
}
