/**
 * LLM crawler readiness: pass / fail / not_measured only.
 * Structure hints are not a score. Missing fetches stay not_measured.
 */

export type LlmCrawlerStatus = 'pass' | 'fail' | 'not_measured';

export type LlmCrawlerCheckId =
  | 'llms_txt'
  | 'llms_structure'
  | 'ai_bot_directives'
  | 'cite_paths'
  | 'ai_txt';

export interface LlmCrawlerCheck {
  id: LlmCrawlerCheckId;
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
  /** Omitted when this snapshot was taken before optional ai.txt fetches. */
  aiTxt?: string | null;
  aiHttpStatus?: number | null;
}

/** Citation crawlers we treat as intentional allow/block signals. */
export const LLM_CRAWLER_BOTS = [
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'ClaudeBot',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'Google-Extended',
  'Applebot-Extended',
] as const;

/** Paths a citeable site should not hide from those crawlers. */
export const LLM_CITE_PATHS = ['/', '/llms.txt', '/sitemap.xml'] as const;

const CHECK_LABEL: Record<LlmCrawlerCheckId, string> = {
  llms_txt: 'llms.txt',
  llms_structure: 'llms.txt structure',
  ai_bot_directives: 'AI crawler directives',
  cite_paths: 'Cite paths',
  ai_txt: 'Optional ai.txt',
};

function check(id: LlmCrawlerCheckId, status: LlmCrawlerStatus, detail: string): LlmCrawlerCheck {
  return { id, label: CHECK_LABEL[id], status, detail };
}

export function unevaluatedLlmCrawlerReport(reason = 'LLM crawler files were not fetched.'): LlmCrawlerReport {
  return {
    checks: (Object.keys(CHECK_LABEL) as LlmCrawlerCheckId[]).map((id) => check(id, 'not_measured', reason)),
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

function escapeRegExp(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
}

/** Prefix match, `*` wildcard, and `$` end anchor. Empty rules match nothing. */
function ruleMatches(rule: string, path: string): boolean {
  if (!rule) return false;
  const endAnchored = rule.endsWith('$');
  const body = endAnchored ? rule.slice(0, -1) : rule;
  if (!body) return false;
  if (body.includes('*')) {
    const source = `^${body.split('*').map(escapeRegExp).join('.*')}${endAnchored ? '$' : ''}`;
    return new RegExp(source).test(path);
  }
  if (endAnchored) return path === body;
  return path.startsWith(body);
}

/** Longest matching rule wins. Equal length: Allow wins. A named group does not merge with `*`. */
function pathBlocked(groups: Map<string, RobotGroup>, bot: string, path: string): boolean {
  const group = groups.get(bot.toLowerCase()) || groups.get('*');
  if (!group) return false;
  let bestLen = -1;
  let blocked = false;
  const consider = (rule: string, isDisallow: boolean) => {
    if (!ruleMatches(rule, path)) return;
    if (rule.length > bestLen) {
      bestLen = rule.length;
      blocked = isDisallow;
      return;
    }
    if (rule.length === bestLen && !isDisallow) blocked = false;
  };
  for (const rule of group.disallow) consider(rule, true);
  for (const rule of group.allow) consider(rule, false);
  return blocked;
}

function englishList(items: readonly string[]): string {
  if (items.length <= 1) return items[0] || '';
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

const SUMMARY_MIN_CHARS = 40;

function llmsStructureFlags(text: string): { title: boolean; summary: boolean } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = lines.some((line) => /^#\s+\S/.test(line));
  const summaryQuote = lines.some((line) => /^>\s*\S/.test(line));
  const prose = lines
    .filter((line) => !line.startsWith('#') && !line.startsWith('>') && !/^[-*]\s+/.test(line) && !/^\d+\.\s+/.test(line))
    .join(' ');
  return { title, summary: summaryQuote || prose.length >= SUMMARY_MIN_CHARS };
}

function evaluateLlmsPresence(snapshot: LlmCrawlerSnapshot): LlmCrawlerCheck {
  if (snapshot.llmsHttpStatus === 404 || (snapshot.llmsTxt !== null && snapshot.llmsTxt.trim() === '')) {
    return check('llms_txt', 'fail', 'llms.txt was not found at the site root.');
  }
  if (snapshot.llmsTxt && snapshot.llmsTxt.trim().length > 0 && (snapshot.llmsHttpStatus === 200 || snapshot.llmsHttpStatus === null)) {
    return check('llms_txt', 'pass', 'llms.txt is present. Google Search may ignore it. Other agents can still quote it.');
  }
  if (snapshot.llmsHttpStatus != null) {
    return check('llms_txt', 'not_measured', `llms.txt fetch returned HTTP ${snapshot.llmsHttpStatus}. Presence was not measured.`);
  }
  return check('llms_txt', 'not_measured', 'llms.txt was not fetched.');
}

function evaluateLlmsStructure(snapshot: LlmCrawlerSnapshot, presence: LlmCrawlerCheck): LlmCrawlerCheck {
  if (presence.status !== 'pass' || !snapshot.llmsTxt) {
    return check('llms_structure', 'not_measured', 'llms.txt was not available, so structure was not measured.');
  }
  const flags = llmsStructureFlags(snapshot.llmsTxt);
  if (flags.title && flags.summary) {
    return check('llms_structure', 'pass', 'llms.txt has a title and a short summary. This is a structure hint, not a score.');
  }
  const missing = [!flags.title ? 'a title (H1)' : '', !flags.summary ? 'a short summary' : ''].filter(Boolean);
  return check(
    'llms_structure',
    'fail',
    `llms.txt is missing ${missing.join(' and ')}. This is a structure hint, not a score.`,
  );
}

function evaluateBotDirectives(snapshot: LlmCrawlerSnapshot): { check: LlmCrawlerCheck; groups: Map<string, RobotGroup> | null } {
  if (snapshot.robotsHttpStatus === 404 || (snapshot.robotsTxt !== null && snapshot.robotsTxt.trim() === '')) {
    return {
      check: check('ai_bot_directives', 'pass', 'No robots.txt was found. Common AI crawlers are not blocked by a robots rule.'),
      groups: null,
    };
  }
  if (snapshot.robotsTxt && snapshot.robotsTxt.trim().length > 0) {
    const groups = parseRobots(snapshot.robotsTxt);
    const blocked = LLM_CRAWLER_BOTS.filter((bot) => botBlocked(groups, bot));
    if (blocked.length === 0) {
      return {
        check: check('ai_bot_directives', 'pass', `${englishList(LLM_CRAWLER_BOTS)} are not blocked at /.`),
        groups,
      };
    }
    return {
      check: check('ai_bot_directives', 'fail', `robots.txt blocks ${blocked.join(', ')} at /.`),
      groups,
    };
  }
  if (snapshot.robotsHttpStatus != null) {
    return {
      check: check(
        'ai_bot_directives',
        'not_measured',
        `robots.txt fetch returned HTTP ${snapshot.robotsHttpStatus}. Directives were not measured.`,
      ),
      groups: null,
    };
  }
  return { check: check('ai_bot_directives', 'not_measured', 'robots.txt was not fetched.'), groups: null };
}

function evaluateCitePaths(bots: LlmCrawlerCheck, groups: Map<string, RobotGroup> | null): LlmCrawlerCheck {
  if (bots.status === 'not_measured') {
    return check('cite_paths', 'not_measured', 'robots.txt was not available, so cite paths were not measured.');
  }
  if (!groups) {
    return check('cite_paths', 'pass', 'No robots.txt was found. Homepage, /llms.txt, and /sitemap.xml are not blocked by a robots rule.');
  }
  const hits: string[] = [];
  for (const bot of LLM_CRAWLER_BOTS) {
    for (const path of LLM_CITE_PATHS) {
      if (pathBlocked(groups, bot, path)) hits.push(`${bot} at ${path}`);
    }
  }
  if (hits.length === 0) {
    return check('cite_paths', 'pass', 'Homepage, /llms.txt, and /sitemap.xml are not blocked for the named AI crawlers.');
  }
  const shown = hits.slice(0, 4);
  const extra = hits.length - shown.length;
  const more = extra > 0 ? ` (+${extra} more)` : '';
  return check('cite_paths', 'fail', `robots.txt blocks ${shown.join(', ')}${more}.`);
}

function evaluateAiTxt(snapshot: LlmCrawlerSnapshot): LlmCrawlerCheck {
  if (snapshot.aiTxt === undefined && snapshot.aiHttpStatus === undefined) {
    return check('ai_txt', 'not_measured', 'ai.txt was not fetched.');
  }
  if (snapshot.aiHttpStatus === 404 || (snapshot.aiTxt !== null && snapshot.aiTxt !== undefined && snapshot.aiTxt.trim() === '')) {
    return check('ai_txt', 'fail', 'Optional ai.txt was not found at the site root. Absence is recorded. It is not a citation score.');
  }
  if (snapshot.aiTxt && snapshot.aiTxt.trim().length > 0 && (snapshot.aiHttpStatus === 200 || snapshot.aiHttpStatus === null)) {
    return check('ai_txt', 'pass', 'Optional ai.txt is present. Presence is not a citation score.');
  }
  if (snapshot.aiHttpStatus != null) {
    return check('ai_txt', 'not_measured', `ai.txt fetch returned HTTP ${snapshot.aiHttpStatus}. Presence was not measured.`);
  }
  return check('ai_txt', 'not_measured', 'ai.txt was not fetched.');
}

export function evaluateLlmCrawlerReadiness(snapshot: LlmCrawlerSnapshot | null | undefined): LlmCrawlerReport {
  if (!snapshot) return unevaluatedLlmCrawlerReport();
  const llms = evaluateLlmsPresence(snapshot);
  const bots = evaluateBotDirectives(snapshot);
  return {
    checks: [
      llms,
      evaluateLlmsStructure(snapshot, llms),
      bots.check,
      evaluateCitePaths(bots.check, bots.groups),
      evaluateAiTxt(snapshot),
    ],
  };
}
