/**
 * LLM crawler readiness: pass / fail / not_measured only.
 * No numeric score. Missing fetches stay not_measured.
 */

export type LlmCrawlerStatus = 'pass' | 'fail' | 'not_measured';

export interface LlmCrawlerCheck {
  id: 'llms_txt' | 'ai_bot_directives';
  label: string;
  status: LlmCrawlerStatus;
  detail: string;
}

export interface LlmCrawlerReport {
  checks: LlmCrawlerCheck[];
}

export interface LlmCrawlerSnapshot {
  llmsTxt: string | null;
  llmsHttpStatus: number | null;
  robotsTxt: string | null;
  robotsHttpStatus: number | null;
}

/** Citation crawlers we treat as intentional allow/block signals. */
export const LLM_CRAWLER_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ClaudeBot',
  'PerplexityBot',
  'Google-Extended',
] as const;

export function unevaluatedLlmCrawlerReport(reason = 'LLM crawler files were not fetched.'): LlmCrawlerReport {
  return {
    checks: [
      { id: 'llms_txt', label: 'llms.txt', status: 'not_measured', detail: reason },
      { id: 'ai_bot_directives', label: 'AI crawler directives', status: 'not_measured', detail: reason },
    ],
  };
}

type RobotGroup = { allow: string[]; disallow: string[] };

function parseRobots(text: string): Map<string, RobotGroup> {
  const groups = new Map<string, RobotGroup>();
  let agents: string[] = [];
  let rules: RobotGroup | null = null;

  const flush = () => {
    if (!rules || agents.length === 0) {
      agents = [];
      rules = null;
      return;
    }
    for (const agent of agents) {
      const key = agent.toLowerCase();
      const prev = groups.get(key) || { allow: [], disallow: [] };
      groups.set(key, {
        allow: [...prev.allow, ...rules.allow],
        disallow: [...prev.disallow, ...rules.disallow],
      });
    }
    agents = [];
    rules = null;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) {
      flush();
      continue;
    }
    const sep = line.indexOf(':');
    if (sep < 0) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();
    if (field === 'user-agent') {
      if (rules) flush();
      agents.push(value || '*');
      continue;
    }
    if (field !== 'allow' && field !== 'disallow') continue;
    if (!rules) rules = { allow: [], disallow: [] };
    if (agents.length === 0) agents = ['*'];
    rules[field].push(value);
  }
  flush();
  return groups;
}

function blocksRoot(group: RobotGroup | undefined): boolean {
  if (!group) return false;
  const allowsRoot = group.allow.some((rule) => rule === '/' || rule === '/*');
  if (allowsRoot) return false;
  return group.disallow.some((rule) => rule === '/' || rule === '/*');
}

function botBlocked(groups: Map<string, RobotGroup>, bot: string): boolean {
  const specific = groups.get(bot.toLowerCase());
  if (specific) return blocksRoot(specific);
  return blocksRoot(groups.get('*'));
}

export function evaluateLlmCrawlerReadiness(snapshot: LlmCrawlerSnapshot | null | undefined): LlmCrawlerReport {
  if (!snapshot) return unevaluatedLlmCrawlerReport();

  const llms: LlmCrawlerCheck = {
    id: 'llms_txt',
    label: 'llms.txt',
    status: 'not_measured',
    detail: 'llms.txt was not fetched.',
  };
  if (snapshot.llmsHttpStatus === 404 || (snapshot.llmsTxt !== null && snapshot.llmsTxt.trim() === '')) {
    llms.status = 'fail';
    llms.detail = 'llms.txt was not found at the site root.';
  } else if (snapshot.llmsTxt && snapshot.llmsTxt.trim().length > 0 && (snapshot.llmsHttpStatus === 200 || snapshot.llmsHttpStatus === null)) {
    llms.status = 'pass';
    llms.detail = 'llms.txt is present. Google Search may ignore it. Other agents can still quote it.';
  } else if (snapshot.llmsHttpStatus != null) {
    llms.status = 'not_measured';
    llms.detail = `llms.txt fetch returned HTTP ${snapshot.llmsHttpStatus}. Presence was not measured.`;
  }

  const bots: LlmCrawlerCheck = {
    id: 'ai_bot_directives',
    label: 'AI crawler directives',
    status: 'not_measured',
    detail: 'robots.txt was not fetched.',
  };
  if (snapshot.robotsHttpStatus === 404 || (snapshot.robotsTxt !== null && snapshot.robotsTxt.trim() === '')) {
    bots.status = 'pass';
    bots.detail = 'No robots.txt was found. Common AI crawlers are not blocked by a robots rule.';
  } else if (snapshot.robotsTxt && snapshot.robotsTxt.trim().length > 0) {
    const groups = parseRobots(snapshot.robotsTxt);
    const blocked = LLM_CRAWLER_BOTS.filter((bot) => botBlocked(groups, bot));
    if (blocked.length === 0) {
      bots.status = 'pass';
      bots.detail = 'GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, and Google-Extended are not blocked at /.';
    } else {
      bots.status = 'fail';
      bots.detail = `robots.txt blocks ${blocked.join(', ')} at /.`;
    }
  } else if (snapshot.robotsHttpStatus != null) {
    bots.status = 'not_measured';
    bots.detail = `robots.txt fetch returned HTTP ${snapshot.robotsHttpStatus}. Directives were not measured.`;
  }

  return { checks: [llms, bots] };
}
