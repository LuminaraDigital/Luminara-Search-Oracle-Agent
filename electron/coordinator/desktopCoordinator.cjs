'use strict';

/**
 * Hermes-Class Desktop Coordinator (Stage 4)
 * Runs inside the Electron main process (and is unit-testable in pure Node).
 *
 * Responsibilities:
 * 1. Browser Profile Isolation & Local Patchright Crawler Supervision (`127.0.0.1:3001`)
 * 2. Allowlisted MCP Client Bridge + OS keychain (`safeStorage`) secret broker
 * 3. Persistent Routine Daemon with Hermes `no-agent` deterministic probe mode
 *    (zero LLM token burn when checks pass; escalates only on drift/failure)
 *
 * Security Invariants:
 * - Never exposes arbitrary shell or `child_process` execution to the renderer.
 * - Sanitizes all profile names to prevent path traversal.
 * - Zero em dashes in user-facing strings.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

const ALLOWED_DESKTOP_MCP_CONNECTORS = new Set([
  'wordpress_com_mcp',
  'gobuildwp_mcp',
  'respira_mcp',
  'instawp_mcp',
  'wix_mcp',
  'squarespace_injection',
  'webflow_api',
  'github_pr',
  'wpcom_mcp',
  'gobuildwp',
  'respira_wp',
  'luminara_mcp',
]);

const FORBIDDEN_MCP_TOOLS = new Set([
  'execute-php',
  'wp_execute_php',
  'sql-query',
  'wp_sql_query',
  'delete-plugin',
  'delete-theme',
  'install-plugin',
  'install-theme',
  'eval-js',
  'shell-exec',
]);

function isSafePublicRoutineUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
    if (parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.startsWith('[') ||
      /^\d+$/.test(host) ||
      host.startsWith('10.') ||
      host.startsWith('192.168.') ||
      host.startsWith('169.254.') ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      !host.includes('.')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitizes a browser profile identifier and resolves it inside `<userDataDir>/browser-profiles/<safeId>`.
 */
function resolveBrowserProfileDir(userDataDir, profileId) {
  if (typeof userDataDir !== 'string' || !userDataDir.trim()) {
    throw new Error('userDataDir is required');
  }
  const rawId = typeof profileId === 'string' ? profileId.trim() : '';
  const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId || safeId.length > 64) {
    throw new Error('Invalid browser profile identifier. Use 1-64 alphanumeric, dash, or underscore characters.');
  }
  const baseDir = path.resolve(userDataDir, 'browser-profiles');
  const resolved = path.resolve(baseDir, safeId);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('Browser profile path escaped base directory');
  }
  return {
    profileId: safeId,
    profilePath: resolved,
  };
}

/**
 * Validates a desktop MCP tool invocation request against the connector & tool allowlist.
 */
function validateDesktopMcpInvocation(payload) {
  if (!payload || typeof payload !== 'object') {
    return { allowed: false, reason: 'Invalid MCP invocation payload.' };
  }
  const connectorId = String(payload.connectorId || '').trim();
  const toolName = String(payload.toolName || '').trim();

  if (!ALLOWED_DESKTOP_MCP_CONNECTORS.has(connectorId)) {
    return {
      allowed: false,
      reason: `Connector '${connectorId}' is not in the desktop MCP allowlist.`,
    };
  }

  if (!toolName || FORBIDDEN_MCP_TOOLS.has(toolName.toLowerCase())) {
    return {
      allowed: false,
      reason: `Tool '${toolName}' is blocked by the desktop security policy.`,
    };
  }

  if (payload.isWriteOperation && payload.userConfirmed !== true) {
    return {
      allowed: false,
      reason: 'Desktop write MCP operations require explicit user confirmation (userConfirmed: true).',
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

/**
 * Evaluates a Hermes-style `no-agent` deterministic probe result.
 * When the probe matches expectations, 0 LLM tokens are spent (`llmEscalated: false`).
 * When drift or failure occurs, `llmEscalated: true` signals the coordinator to wake the agent.
 */
function evaluateNoAgentRoutineProbe(routine, probeObservation) {
  const nowIso = new Date().toISOString();
  const expectedStatus = routine.expectedStatus ?? 200;
  const requiredSubstrings = Array.isArray(routine.requiredSubstrings)
    ? routine.requiredSubstrings
    : [];

  const statusMatches = probeObservation.status === expectedStatus;
  const missingSubstrings = requiredSubstrings.filter(
    (sub) => !String(probeObservation.body || '').includes(sub),
  );

  const healthy = statusMatches && missingSubstrings.length === 0;

  return {
    routineId: routine.id,
    mode: routine.mode || 'no-agent',
    checkedAt: nowIso,
    healthy,
    llmEscalated: !healthy,
    tokensUsed: 0,
    driftReason: healthy
      ? null
      : !statusMatches
        ? `Expected HTTP ${expectedStatus} but received ${probeObservation.status}`
        : `Missing expected content: ${missingSubstrings.join(', ')}`,
  };
}

/**
 * Creates an in-memory + optional safeStorage-backed Desktop Coordinator instance.
 */
function createDesktopCoordinator(options = {}) {
  const userDataDir = options.userDataDir || path.join(process.cwd(), '.luminara-desktop-data');
  const crawlerPort = options.crawlerPort || 3001;
  const safeStorage = options.safeStorage || null;
  const fetchFn = options.fetchFn || (typeof fetch === 'function' ? fetch : null);
  const persistToDisk = options.persistToDisk === true;
  const spawnFn = options.spawnFn || childProcess.spawn;
  const crawlerScriptPath =
    options.crawlerScriptPath || path.resolve(__dirname, '..', '..', 'crawler', 'server.mjs');

  const routinesFilePath = path.join(userDataDir, 'routines.json');
  const secretsFilePath = path.join(userDataDir, 'secrets.json');

  /** @type {Map<string, object>} */
  const routines = new Map();
  /** @type {Map<string, string>} */
  const encryptedSecrets = new Map();
  let crawlerChild = null;

  if (persistToDisk) {
    try {
      if (fs.existsSync(routinesFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(routinesFilePath, 'utf8'));
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item.id === 'string') routines.set(item.id, item);
          }
        }
      }
      if (fs.existsSync(secretsFilePath)) {
        const parsed = JSON.parse(fs.readFileSync(secretsFilePath, 'utf8'));
        if (parsed && typeof parsed === 'object') {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string') encryptedSecrets.set(k, v);
          }
        }
      }
    } catch {
      // Ignore corrupt persistence files on startup
    }
  }

  function flushDiskState() {
    if (!persistToDisk) return;
    try {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.writeFileSync(routinesFilePath, JSON.stringify(Array.from(routines.values()), null, 2), 'utf8');
      fs.writeFileSync(secretsFilePath, JSON.stringify(Object.fromEntries(encryptedSecrets.entries()), null, 2), 'utf8');
    } catch {
      // Best-effort disk persistence
    }
  }

  let crawlerStatus = {
    port: crawlerPort,
    endpoint: `http://127.0.0.1:${crawlerPort}`,
    healthy: false,
    lastCheckedAt: null,
    pid: null,
  };

  async function checkCrawlerHealth() {
    const checkedAt = new Date().toISOString();
    if (!fetchFn) {
      crawlerStatus = {
        ...crawlerStatus,
        healthy: false,
        lastCheckedAt: checkedAt,
      };
      return crawlerStatus;
    }
    try {
      const res = await fetchFn(`http://127.0.0.1:${crawlerPort}/health`);
      crawlerStatus = {
        ...crawlerStatus,
        healthy: Boolean(res && res.ok),
        lastCheckedAt: checkedAt,
      };
    } catch {
      crawlerStatus = {
        ...crawlerStatus,
        healthy: false,
        lastCheckedAt: checkedAt,
      };
    }
    return crawlerStatus;
  }

  async function superviseCrawler(opts = {}) {
    const status = await checkCrawlerHealth();
    if (status.healthy || opts.spawnIfDown !== true) {
      return status;
    }
    if (!crawlerChild && typeof spawnFn === 'function') {
      try {
        crawlerChild = spawnFn(process.execPath, [crawlerScriptPath], {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            HOST: '127.0.0.1',
            PORT: String(crawlerPort),
          },
          stdio: 'ignore',
          windowsHide: true,
        });
        crawlerStatus = {
          ...crawlerStatus,
          pid: crawlerChild && crawlerChild.pid ? crawlerChild.pid : null,
        };
        if (crawlerChild && typeof crawlerChild.on === 'function') {
          crawlerChild.on('exit', () => {
            crawlerChild = null;
            crawlerStatus = { ...crawlerStatus, pid: null, healthy: false };
          });
        }
      } catch {
        crawlerChild = null;
      }
    }
    return crawlerStatus;
  }

  function stopCrawler() {
    if (crawlerChild && typeof crawlerChild.kill === 'function') {
      try {
        crawlerChild.kill();
      } catch {
        // ignore
      }
      crawlerChild = null;
      crawlerStatus = { ...crawlerStatus, pid: null, healthy: false };
    }
    return { stopped: true };
  }

  function storeSecret(key, plainTextValue) {
    if (typeof key !== 'string' || !key.trim()) {
      throw new Error('Secret key is required');
    }
    if (typeof plainTextValue !== 'string') {
      throw new Error('Secret value must be a string');
    }
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()) {
      const buf = safeStorage.encryptString(plainTextValue);
      encryptedSecrets.set(key.trim(), buf.toString('base64'));
      flushDiskState();
      return { key: key.trim(), stored: true, encrypted: true, encryptedWithOsKeychain: true };
    }
    // Fallback obfuscation when OS keychain is unavailable in headless test environments
    const encoded = Buffer.from(plainTextValue, 'utf8').toString('base64');
    encryptedSecrets.set(key.trim(), `b64:${encoded}`);
    flushDiskState();
    return { key: key.trim(), stored: true, encrypted: false, encryptedWithOsKeychain: false };
  }

  function hasSecret(key) {
    return encryptedSecrets.has(String(key || '').trim());
  }

  function upsertRoutine(spec) {
    if (!spec || typeof spec.name !== 'string' || !spec.name.trim()) {
      throw new Error('Routine name is required');
    }
    if (!isSafePublicRoutineUrl(spec.targetUrl)) {
      throw new Error('Routine targetUrl must be a public http(s) URL (private/loopback hosts blocked)');
    }
    const id = spec.id || `rt_${crypto.randomUUID()}`;
    const record = {
      id,
      name: spec.name.trim(),
      targetUrl: spec.targetUrl.trim(),
      mode: spec.mode === 'agent' ? 'agent' : 'no-agent',
      intervalMinutes: Number(spec.intervalMinutes) > 0 ? Number(spec.intervalMinutes) : 60,
      expectedStatus: Number(spec.expectedStatus) > 0 ? Number(spec.expectedStatus) : 200,
      requiredSubstrings: Array.isArray(spec.requiredSubstrings) ? spec.requiredSubstrings : [],
      enabled: spec.enabled !== false,
      lastRunAt: null,
      lastResult: null,
      tokensSavedRuns: 0,
    };
    routines.set(id, record);
    flushDiskState();
    return record;
  }

  function listRoutines() {
    return Array.from(routines.values());
  }

  async function runRoutineOnce(routineId, mockObservation) {
    const routine = routines.get(routineId);
    if (!routine) {
      throw new Error(`Unknown routine: ${routineId}`);
    }

    let observation = mockObservation;
    if (!observation) {
      if (!fetchFn) {
        observation = { status: 0, body: '' };
      } else {
        try {
          const response = await fetchFn(routine.targetUrl, { redirect: 'manual' });
          if (response && response.url && !isSafePublicRoutineUrl(response.url)) {
            observation = { status: 0, body: 'redirect_to_private_host_blocked' };
          } else {
            const body = await response.text();
            observation = { status: response.status, body };
          }
        } catch (err) {
          observation = { status: 0, body: err instanceof Error ? err.message : 'fetch_error' };
        }
      }
    }

    const evaluation = evaluateNoAgentRoutineProbe(routine, observation);
    routine.lastRunAt = evaluation.checkedAt;
    routine.lastResult = evaluation;
    if (evaluation.healthy && routine.mode === 'no-agent') {
      routine.tokensSavedRuns += 1;
    }
    routines.set(routineId, routine);
    flushDiskState();
    return evaluation;
  }

  function getStatus() {
    return {
      crawler: crawlerStatus,
      routineCount: routines.size,
      allowedMcpConnectors: Array.from(ALLOWED_DESKTOP_MCP_CONNECTORS),
      storedSecretKeys: Array.from(encryptedSecrets.keys()),
    };
  }

  return {
    getStatus,
    checkCrawlerHealth,
    superviseCrawler,
    stopCrawler,
    resolveProfile: (profileId) => resolveBrowserProfileDir(userDataDir, profileId),
    validateMcpCall: validateDesktopMcpInvocation,
    storeSecret,
    hasSecret,
    upsertRoutine,
    listRoutines,
    runRoutineOnce,
  };
}

module.exports = {
  ALLOWED_DESKTOP_MCP_CONNECTORS,
  FORBIDDEN_MCP_TOOLS,
  resolveBrowserProfileDir,
  validateDesktopMcpInvocation,
  evaluateNoAgentRoutineProbe,
  createDesktopCoordinator,
};
