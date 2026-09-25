/**
 * MUSE-Inspired Post-Audit Autonomous Reflection Engine
 * 
 * Clean-room adaptation of the MUSE (Memory-Utilizing & Self-Evolving) agent framework:
 * (ACL 2026 Findings: "Learning on the Job: An Experience-Driven, Self-Evolving Agent")
 * 
 * After an audit completes, this engine autonomously reflects on the execution trajectory:
 * 1. Procedural Memory: Site-specific DOM quirks, CMS detection (Shopify, WordPress, Next.js), and crawl traps.
 * 2. Strategic Memory: AEO/GEO methodology lessons (citation rate drivers, entity gaps, comparison moats).
 * 3. Operational Notes: SERP evidence quality and tool grounding notes.
 * 
 * The structured experience object is persisted into VFS and Brand Memory Vault,
 * allowing future audits of the same domain to learn iteratively on the job.
 */

import { BusinessDNA, ReportFocus } from '../../types';
import { vfsMemoryService } from '../vfs/vfsMemoryService';
import { mem0MemoryEngine } from '../agentCore/mem0MemoryEngine';

export interface ProceduralLesson {
  pattern: string;
  heuristic: string;
  severity: 'critical' | 'warning' | 'tip';
}

export interface StrategicLesson {
  hypothesis: string;
  observedOutcome: string;
  actionableRule: string;
}

export interface PostAuditExperience {
  id: string;
  domain: string;
  auditId: string;
  timestamp: number;
  focus: string;
  citationRatePercent?: number | null;
  healthScore?: number | null;
  proceduralLessons: ProceduralLesson[];
  strategicLessons: StrategicLesson[];
  operationalNotes: string[];
}

export interface ReflectAuditInput {
  domain: string;
  focus: ReportFocus | string;
  auditId: string;
  healthScore?: number | null;
  scrapedEvidence?: {
    scrapedUrl?: string;
    hasContent?: boolean;
    schemasFound?: string[];
    title?: string;
    wordCount?: number;
    rawTextSnippet?: string;
  };
  findings?: Array<{
    title: string;
    category?: string;
    severity?: string;
    description?: string;
  }>;
  citationRatePercent?: number | null;
  topCompetitor?: string | null;
  dna?: BusinessDNA | null;
}

const EXPERIENCE_STORAGE_KEY = 'luminara_muse_experiences_v1';
const MAX_SAVED_EXPERIENCES = 50;

export class PostAuditReflectionService {
  private static instance: PostAuditReflectionService;

  public static getInstance(): PostAuditReflectionService {
    if (!PostAuditReflectionService.instance) {
      PostAuditReflectionService.instance = new PostAuditReflectionService();
    }
    return PostAuditReflectionService.instance;
  }

  /**
   * Autonomously reflects on the audit trajectory to derive structured lessons
   */
  public reflectOnAudit(input: ReflectAuditInput): PostAuditExperience {
    const cleanDomain = input.domain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    const proceduralLessons: ProceduralLesson[] = [];
    const strategicLessons: StrategicLesson[] = [];
    const operationalNotes: string[] = [];

    const textSnippet = (input.scrapedEvidence?.rawTextSnippet || '').toLowerCase();
    const wordCount = input.scrapedEvidence?.wordCount ?? 0;
    const schemas = input.scrapedEvidence?.schemasFound || [];
    const hasContentFlag = input.scrapedEvidence?.hasContent;
    // Explicit false means the scrape returned nothing to inspect. Do not infer DOM gaps from an empty schema list.
    const pageInspected = hasContentFlag === false
      ? false
      : hasContentFlag === true || wordCount > 0 || textSnippet.trim().length > 0;

    // 1. Procedural Memory: Detect CMS / Frontend Architecture Quirks
    if (!pageInspected) {
      operationalNotes.push('Page content was not measured, so no DOM or schema lessons were recorded.');
    } else if (textSnippet.includes('shopify') || textSnippet.includes('cdn.shopify.com')) {
      proceduralLessons.push({
        pattern: 'Shopify E-Commerce Architecture',
        heuristic: 'Site uses Shopify. Watch for duplicate collection URL paths (/collections/*/products/*) and ensure canonical link tags point to root /products/* endpoints.',
        severity: 'warning',
      });
    } else if (textSnippet.includes('wp-content') || textSnippet.includes('wordpress')) {
      proceduralLessons.push({
        pattern: 'WordPress CMS Architecture',
        heuristic: 'WordPress platform detected. Verify XML sitemap indexing status, eliminate unused plugin header scripts, and validate Yoast/RankMath JSON-LD graph integrity.',
        severity: 'tip',
      });
    } else if (textSnippet.includes('__next') || textSnippet.includes('_next/static')) {
      proceduralLessons.push({
        pattern: 'Next.js / React Hydration',
        heuristic: 'Modern Next.js application. Ensure SSR/SSG pre-rendering is intact so AI answer crawlers (GPTBot, PerplexityBot) can index content without headless JS execution.',
        severity: 'tip',
      });
    }

    if (pageInspected && wordCount > 0 && wordCount < 250) {
      proceduralLessons.push({
        pattern: 'Thin Initial DOM Content (<250 words)',
        heuristic: 'Target page has extremely sparse initial text. Search engines may flag this as soft 404 or low-information-gain. Expand substantive copy to at least 450 words.',
        severity: 'critical',
      });
    }

    if (pageInspected && schemas.length === 0) {
      proceduralLessons.push({
        pattern: 'Zero Schema.org Structured Data',
        heuristic: 'No JSON-LD schemas identified in DOM. Immediate priority is injecting Organization and WebSite schemas to establish entity disambiguation.',
        severity: 'critical',
      });
    }

    // 2. Strategic Memory: AEO / GEO Search Methodology Rules
    const citationRate = input.citationRatePercent ?? null;
    if (citationRate !== null) {
      if (citationRate < 45) {
        strategicLessons.push({
          hypothesis: 'Brand visibility is suppressed in conversational AI overviews due to lack of extractable definitional targets.',
          observedOutcome: `Measured citation rate is only ${citationRate}%. AI engines favor third-party summaries.`,
          actionableRule: 'Deploy concise 40-60 word direct-answer definitions immediately under H2 question headings to become the primary citation source.',
        });
      } else if (citationRate >= 70) {
        strategicLessons.push({
          hypothesis: 'Strong domain authority and entity clarity yield high citation capture in generative answer engines.',
          observedOutcome: `Empirical citation rate reached ${citationRate}%.`,
          actionableRule: 'Defend existing citation dominance by adding comparison tables and addressing long-tail user query permutations.',
        });
      }
    }

    if (input.topCompetitor) {
      strategicLessons.push({
        hypothesis: `Top competitor "${input.topCompetitor}" captures adjacent search share.`,
        observedOutcome: `AI search engines cite "${input.topCompetitor}" for key category searches.`,
        actionableRule: `Create dedicated, objective versus/alternative landing pages differentiating against "${input.topCompetitor}" with verifiable benchmark data.`,
      });
    }

    // 3. Operational Notes
    operationalNotes.push(
      `Audit completed for focus "${input.focus}" on ${new Date().toISOString()}. Health score: ${input.healthScore ?? 'N/A'}.`
    );

    const experience: PostAuditExperience = {
      id: `exp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      domain: cleanDomain,
      auditId: input.auditId,
      timestamp: Date.now(),
      focus: String(input.focus),
      citationRatePercent: citationRate,
      healthScore: input.healthScore,
      proceduralLessons,
      strategicLessons,
      operationalNotes,
    };

    this.persistExperience(experience);
    return experience;
  }

  private canStorage(): boolean {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem('__muse_probe__', '1');
      localStorage.removeItem('__muse_probe__');
      return true;
    } catch {
      return false;
    }
  }

  private persistExperience(exp: PostAuditExperience): void {
    // 1. Save to localStorage
    if (this.canStorage()) {
      try {
        const raw = localStorage.getItem(EXPERIENCE_STORAGE_KEY);
        const list: PostAuditExperience[] = raw ? JSON.parse(raw) : [];
        list.unshift(exp);
        localStorage.setItem(EXPERIENCE_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_SAVED_EXPERIENCES)));
      } catch {
        /* ignore */
      }
    }

    // 2. Persist to VFS (Virtual File System)
    try {
      vfsMemoryService.addMemoryItem(
        'patterns',
        `MUSE Experience: ${exp.domain} (${exp.focus})`,
        this.formatExperienceAsMarkdown(exp),
        ['muse-experience', 'audit-reflection', exp.domain],
        'AEO'
      );
    } catch (e) {
      console.warn('[MUSE] VFS memory save error', e);
    }

    // 3. Sync into Mem0 Memory Graph
    try {
      for (const proc of exp.proceduralLessons) {
        mem0MemoryEngine.addRelation({
          source: exp.domain,
          predicate: 'has_procedural_trait',
          target: proc.pattern,
          confidence: 0.9,
          metadata: { heuristic: proc.heuristic, severity: proc.severity },
        });
      }
      for (const strat of exp.strategicLessons) {
        mem0MemoryEngine.addRelation({
          source: exp.domain,
          predicate: 'governed_by_rule',
          target: strat.actionableRule.slice(0, 50),
          confidence: 0.85,
          metadata: { rule: strat.actionableRule },
        });
      }
    } catch (e) {
      console.warn('[MUSE] Mem0 sync error', e);
    }
  }

  public getExperiencesForDomain(domain: string): PostAuditExperience[] {
    if (!this.canStorage()) return [];
    try {
      const clean = domain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
      const raw = localStorage.getItem(EXPERIENCE_STORAGE_KEY);
      if (!raw) return [];
      const list: PostAuditExperience[] = JSON.parse(raw);
      return Array.isArray(list) ? list.filter((e) => e.domain.toLowerCase() === clean) : [];
    } catch {
      return [];
    }
  }

  public formatExperienceAsMarkdown(exp: PostAuditExperience): string {
    const lines = [
      `# MUSE Experience Heuristics: ${exp.domain.toUpperCase()}`,
      `*Recorded on ${new Date(exp.timestamp).toISOString()} | Focus: ${exp.focus}*`,
      '',
      '## Procedural Lessons (Platform & Technical Traits)',
    ];

    if (exp.proceduralLessons.length === 0) {
      lines.push('- No platform anomalies detected.');
    } else {
      for (const p of exp.proceduralLessons) {
        lines.push(`- **[${p.severity.toUpperCase()}] ${p.pattern}**: ${p.heuristic}`);
      }
    }

    lines.push('', '## Strategic Lessons (AEO/GEO Rules)');
    if (exp.strategicLessons.length === 0) {
      lines.push('- Standard playbooks apply.');
    } else {
      for (const s of exp.strategicLessons) {
        lines.push(`- **Observation**: ${s.observedOutcome}`);
        lines.push(`  - *Rule*: ${s.actionableRule}`);
      }
    }

    return lines.join('\n');
  }

  public formatExperienceForPrompt(domain: string): string {
    const list = this.getExperiencesForDomain(domain);
    if (list.length === 0) return '';
    const latest = list[0];

    const lines = [
      `[MUSE HISTORIC AUDIT EXPERIENCE | ${domain.toUpperCase()}]`,
    ];

    if (latest.proceduralLessons.length > 0) {
      lines.push('Known Site Characteristics:');
      for (const p of latest.proceduralLessons.slice(0, 3)) {
        lines.push(`- ${p.pattern}: ${p.heuristic}`);
      }
    }

    if (latest.strategicLessons.length > 0) {
      lines.push('Learned Strategic Rules:');
      for (const s of latest.strategicLessons.slice(0, 2)) {
        lines.push(`- ${s.actionableRule}`);
      }
    }

    lines.push('--------------------------------------------------');
    return lines.join('\n');
  }
}

export const postAuditReflectionService = PostAuditReflectionService.getInstance();
