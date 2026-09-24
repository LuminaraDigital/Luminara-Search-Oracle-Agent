import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  parseTokenFile,
  resolveIdentityTokens,
  mergeTokens,
} from '../scripts/check-forbidden-tokens.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_SRC = path.join(repoRoot, 'scripts', 'check-forbidden-tokens.mjs');

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-tokens-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string | Buffer) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

/** Stage a copy of the real script inside the temp repo, then git init. */
function setupTempRepo(tokenFileContent?: string) {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.copyFileSync(SCRIPT_SRC, path.join(root, 'scripts', 'check-forbidden-tokens.mjs'));
  fs.mkdirSync(path.join(root, '.githooks'), { recursive: true });
  if (tokenFileContent !== undefined) {
    fs.writeFileSync(path.join(root, '.githooks', 'forbidden-tokens.txt'), tokenFileContent, 'utf8');
  }
  const git = (cmd: string) =>
    execSync(cmd, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('git init -q');
  git('git config user.email test@example.com');
  git('git config user.name tester');
  git('git config commit.gpgsign false');
}

function runScript(args: string[], env: NodeJS.ProcessEnv = {}) {
  try {
    const out = execSync(`node scripts/check-forbidden-tokens.mjs ${args.join(' ')}`, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout: out, stderr: '' };
  } catch (err: any) {
    return {
      code: typeof err?.status === 'number' ? err.status : 1,
      stdout: (err?.stdout as string) || '',
      stderr: (err?.stderr as string) || '',
    };
  }
}

describe('parseTokenFile', () => {
  it('parses one token per line and trims whitespace', () => {
    const { tokens } = parseTokenFile('alpha\n  beta  \n');
    expect(tokens).toEqual(['alpha', 'beta']);
  });
  it('skips blank lines and full-line comments', () => {
    const { tokens } = parseTokenFile('# header\n\nalpha\n   \n# another\nbeta\n');
    expect(tokens).toEqual(['alpha', 'beta']);
  });
  it('strips trailing comments after a token', () => {
    const { tokens } = parseTokenFile('alpha # why forbidden\n');
    expect(tokens).toEqual(['alpha']);
  });
  it('handles CRLF line endings', () => {
    const { tokens } = parseTokenFile('alpha\r\nbeta\r\n');
    expect(tokens).toEqual(['alpha', 'beta']);
  });
  it('returns empty list for missing content', () => {
    const { tokens, warnings } = parseTokenFile(null as any);
    expect(tokens).toEqual([]);
    expect(warnings).toEqual([]);
  });
  it('ignores tokens shorter than 3 chars with a warning', () => {
    const { tokens, warnings } = parseTokenFile('ab\nabc\n');
    expect(tokens).toEqual(['abc']);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('ab');
  });
});

describe('resolveIdentityTokens', () => {
  it('reads USER/LOGNAME/USERNAME from env', () => {
    const toks = resolveIdentityTokens(
      { USER: 'alice', LOGNAME: 'alice', USERNAME: 'alicewin' } as any,
      { userInfo: () => ({ username: '' }) as any, homedir: () => '' } as any,
    );
    expect(toks).toContain('alice');
    expect(toks).toContain('alicewin');
  });
  it('falls back to os.userInfo().username', () => {
    const toks = resolveIdentityTokens({} as any, {
      userInfo: () => ({ username: 'osuser' }) as any,
      homedir: () => '',
    } as any);
    expect(toks).toContain('osuser');
  });
  it('takes the last path segment of os.homedir()', () => {
    const toks = resolveIdentityTokens({} as any, {
      userInfo: () => ({ username: '' }) as any,
      homedir: () => '/home/hduser',
    } as any);
    expect(toks).toContain('hduser');
  });
  it('degrades gracefully when os calls throw', () => {
    const toks = resolveIdentityTokens({ USER: 'envuser' } as any, {
      userInfo: () => {
        throw new Error('nope');
      },
      homedir: () => {
        throw new Error('nope');
      },
    } as any);
    expect(toks).toEqual(['envuser']);
  });
});

describe('mergeTokens', () => {
  it('merges and dedupes, list wins over identity for the same string', () => {
    const merged = mergeTokens(['alpha', 'beta', 'alpha'], ['beta', 'gamma']);
    expect(merged).toEqual([
      { token: 'alpha', source: 'list' },
      { token: 'beta', source: 'list' },
      { token: 'gamma', source: 'identity' },
    ]);
  });
  it('ignores empty/whitespace entries', () => {
    const merged = mergeTokens(['', '  ', 'alpha'], ['  ', 'beta']);
    expect(merged).toEqual([
      { token: 'alpha', source: 'list' },
      { token: 'beta', source: 'identity' },
    ]);
  });
});

describe('script in temp git repo', () => {
  it('detects a list token in a staged file (--staged)', () => {
    setupTempRepo('secretprojectname\n');
    write('src/a.ts', 'export const x = "secretprojectname";\n');
    execSync('git add src/a.ts', { cwd: root });
    const r = runScript(['--staged']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('src/a.ts:1');
    expect(r.stderr).toContain('secretprojectname');
    expect(r.stderr).toContain('list');
  });
  it('passes when staged files contain no tokens (--staged)', () => {
    setupTempRepo('secretprojectname\n');
    write('src/b.ts', 'export const x = "totally fine";\n');
    execSync('git add src/b.ts', { cwd: root });
    const r = runScript(['--staged']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('passed');
  });
  it('detects a token in a tracked file with --all', () => {
    setupTempRepo('secretprojectname\n');
    write('src/c.ts', 'const y = "secretprojectname";\n');
    execSync('git add .', { cwd: root });
    execSync('git commit -qm init', { cwd: root });
    const r = runScript(['--all']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('src/c.ts:1');
  });
  it('detects tokens in untracked non-ignored files with --all', () => {
    setupTempRepo('secretprojectname\n');
    write('src/d.ts', 'const z = "secretprojectname";\n');
    // Intentionally not staged/committed.
    const r = runScript(['--all']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('src/d.ts:1');
  });
  it('reports identity findings without disclosing the username value', () => {
    setupTempRepo(undefined);
    write('src/e.ts', 'const me = "jdoeidentity";\n');
    execSync('git add .', { cwd: root });
    const r = runScript(['--staged'], {
      USER: 'jdoeidentity',
      LOGNAME: '',
      USERNAME: '',
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('local username');
    expect(r.stderr).not.toContain('jdoeidentity');
    expect(r.stderr).toContain('identity');
  });
  it('skips files larger than 2 MB with a note', () => {
    setupTempRepo('needlestring\n');
    const big = Buffer.alloc(2 * 1024 * 1024 + 100, 97).toString('utf8') + ' needlestring';
    write('src/big.txt', big);
    execSync('git add .', { cwd: root });
    const r = runScript(['--staged']);
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).toContain('> 2 MB');
  });
  it('does not self-match the token list file', () => {
    setupTempRepo('secretprojectname\n');
    // Token file is committed/tracked, it contains the token by definition.
    execSync('git add .', { cwd: root });
    const r = runScript(['--staged']);
    expect(r.code).toBe(0);
  });
  it('exits 0 with a note when not inside a git work tree', () => {
    // Deliberately no git init: copy script into a plain directory.
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.copyFileSync(SCRIPT_SRC, path.join(root, 'scripts', 'check-forbidden-tokens.mjs'));
    const r = runScript(['--all']);
    expect(r.code).toBe(0);
    expect(r.stdout + r.stderr).toContain('not inside a git work tree');
  });
});
