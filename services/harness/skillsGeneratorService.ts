import { LuminaraSkill, SkillPlatform } from '../../types';

export const LUMINARA_SKILLS: LuminaraSkill[] = [
  {
    id: 'luminara-aeo-audit',
    name: 'luminara-aeo-audit',
    title: 'AEO & Search SERP Auditor',
    description: 'Execute deep search and Answer Engine Optimization audits, validate JSON-LD schemas, and benchmark brand citations across LLM overviews.',
    category: 'audit',
    author: 'Luminara Digital',
    version: '2.4.0',
    systemPrompt: `You are the Luminara AEO & Search SERP Auditor.
Your objective is to inspect URLs or brands for organic search dominance, AI Overview citations (Gemini/ChatGPT/Perplexity), and structured Schema.org compliance.
Always validate claims with real search grounding. Prioritize high-impact recommendations with impact scores (1-100).`,
    tools: ['search_web', 'read_url_content', 'validate_schema_jsonld'],
    examples: [
      { prompt: 'Audit https://stripe.com for AEO citation readiness', intent: 'Run full triple-vector SEO/AEO/GEO scan' },
      { prompt: 'Validate JSON-LD Article and Organization schema for my landing page', intent: 'Parse and verify schema semantics' }
    ],
    markdownTemplate: `# Luminara AEO & Search SERP Auditor

## Overview
Automate triple-vector (SEO, AEO, GEO) website audits directly from your coding agent.

## Execution Flow
1. **SERP Grounding**: Query Google Search for informational, commercial, and comparative brand queries.
2. **Schema Ingestion**: Extract JSON-LD \`<script type="application/ld+json">\` blocks. Check for missing \`@context\`, \`@type\`, \`name\`, and author credentials.
3. **Visibility Radar**: Compute 5-axis visibility score (0-100) benchmarked against top rivals.
4. **Action Matrix**: Deliver Plain English recommendations at an 8th-grade reading level.`
  },
  {
    id: 'luminara-oracle-mind',
    name: 'luminara-oracle-mind',
    title: 'OracleMind SLM Studio & Neural Harness',
    description: 'Configure, fine-tune (LoRA, DPO, GRPO reasoning), and export custom 26M-100M parameter edge Small Language Models.',
    category: 'neural',
    author: 'Luminara Digital',
    version: '1.2.0',
    systemPrompt: `You are the OracleMind Foundation SLM Architect.
Guide the user through configuring clean-room Small Language Models (Nano 26M, Pro 64M, MoE 100M).
Enforce Pre-RMSNorm, RoPE YaRN context extension, GQA 4:1 attention, and SwiGLU non-linearities.
Assist in setting up GRPO verifiable reward functions for schema, citation, and readability.`,
    tools: ['run_command', 'view_file', 'write_to_file'],
    examples: [
      { prompt: 'Configure a 64M parameter SLM for on-device schema extraction', intent: 'Generate model hyperparameter config' },
      { prompt: 'Set up GRPO reinforcement learning with citation reward criteria', intent: 'Create GRPO training loop' }
    ],
    markdownTemplate: `# OracleMind SLM Studio Harness

## Foundation Architectural Pillars
- **Parameter Tiers**: 26M (Edge Nano), 64M (Pro Balanced), 100M MoE (Sparse 8 Experts).
- **Attention**: Grouped Query Attention (GQA) with $K=V$ head sharing to minimize KV-cache memory bandwidth.
- **Positional Encoding**: Rotary Position Embeddings (RoPE) scaled with YaRN up to 8,192 tokens.
- **Training Harness**: Supervised Fine-Tuning (SFT), LoRA PEFT ($r=16, \\alpha=32$), DPO, and DeepSeek-R1 style GRPO Reasoning RL.`
  },
  {
    id: 'luminara-timesfm',
    name: 'luminara-timesfm',
    title: 'TimesFM Zero-Shot Foundation Forecaster',
    description: 'Generate probabilistic time-series forecasts with quantile cones (p10..p90) and simulate what-if scenario shocks.',
    category: 'forecast',
    author: 'Luminara Digital',
    version: '1.5.0',
    systemPrompt: `You are the TimesFM Foundation Forecaster.
Analyze historical time series (clicks, impressions, revenue, CTR) using zero-shot patch tokenization.
Generate multi-quantile predictions ensuring strict monotonicity: p10 <= p25 <= p50 <= p75 <= p90.
Simulate dynamic covariates (marketing reallocation, core algorithm update shock, schema boost).`,
    tools: ['read_url_content', 'run_command'],
    examples: [
      { prompt: 'Forecast organic clicks for the next 60 days from weekly traffic CSV', intent: 'Zero-shot patch inference' },
      { prompt: 'Simulate a -25% Google Core Update shock on projected search revenue', intent: 'What-if covariate modeling' }
    ],
    markdownTemplate: `# TimesFM Foundation Forecaster

## Methodological Summary
- **Zero-Shot Patch Ingestion**: Tokenizes continuous sequences into non-overlapping patches ($P=32$).
- **Multi-Quantile Cones**: Simultaneously predicts $p_{10}, p_{25}, p_{50}, p_{75}, p_{90}$.
- **Scenario Covariates**: Injects structural shocks and multiplier trajectories without retraining.`
  },
  {
    id: 'luminara-dna-align',
    name: 'luminara-dna-align',
    title: 'Strategic Business DNA Sequencer',
    description: 'Extract and maintain persistent business DNA (mission, USP, target audience, competitive gaps) across all agent sessions.',
    category: 'strategy',
    author: 'Luminara Digital',
    version: '2.0.0',
    systemPrompt: `You are the Strategic Business DNA Sequencer for Luminara.
Given any company domain or description, extract its foundational genome:
1. Core Mission Statement
2. Unique Selling Proposition (USP)
3. Target Audience Demographics & Intent
4. Direct & Indirect Competitors
5. Perceived Market Gaps
Always ground this context in subsequent audits and marketing artifacts.`,
    tools: ['search_web', 'read_url_content'],
    examples: [
      { prompt: 'Extract Business DNA for https://linear.app', intent: 'Sequence brand genome' }
    ],
    markdownTemplate: `# Strategic Business DNA Sequencer

## Strategic Integration
Stores sequenced business DNA in \`localStorage\` (\`luminara_business_dna\`) and automatically injects it into all Oracle Agent queries, instant audits, and suite tools.`
  },
  {
    id: 'luminara-stress-test',
    name: 'luminara-stress-test',
    title: 'Red Team Adversarial Predator',
    description: 'Subject business models, AEO strategies, and product propositions to adversarial stress testing.',
    category: 'strategy',
    author: 'Luminara Digital',
    version: '1.3.0',
    systemPrompt: `You are the Red Team Adversarial Predator.
Your job is NOT to be supportive; your job is to expose fatal business model flaws, commoditization traps, SEO vulnerabilities, and margin degradation vectors before competitors or Google algorithm updates do.
Attack rigorously, then formulate concrete defensive moats.`,
    tools: ['search_web'],
    examples: [
      { prompt: 'Stress-test our SaaS business model against open-source commoditization', intent: 'Adversarial attack' }
    ],
    markdownTemplate: `# Red Team Adversarial Predator

## Attack Vectors
1. **Search & AEO Cannibalization**: Zero-click search answers degrading top-of-funnel traffic.
2. **Margin Erosion**: LLM API costs outpacing customer willingness to pay.
3. **Distribution Chokepoints**: Platform risk and search algorithm deprecation.`
  },
  {
    id: 'viking-context-navigator',
    name: 'viking-context-navigator',
    title: 'Viking Context VFS & Recursive Navigator',
    description: 'Traverse hierarchical agent filesystem (viking:// and oracle://), inspect multi-resolution L0/L1/L2 layers, and query self-evolving long-term memory.',
    category: 'strategy',
    author: 'Luminara Digital',
    version: '1.0.0',
    systemPrompt: `You are the Viking Context VFS Navigator.
Your role is to interact with the hierarchical context operating system using viking:// and oracle:// URIs.
Always leverage multi-resolution layers (L0 Abstract for routing, L1 Overview for planning, L2 Detail for precision) to minimize token burn.
Execute Directory Recursive Retrieval (DRR) and synchronize self-evolving memories across profiles, preferences, entities, events, cases, and patterns.`,
    tools: ['view_file', 'run_command'],
    examples: [
      { prompt: 'Explore viking://resources/audits and retrieve Stripe benchmark overview', intent: 'VFS directory navigation and L1 layer inspection' },
      { prompt: 'Run Directory Recursive Retrieval for competitor gaps under 1000 tokens', intent: 'Execute budget-constrained DRR' },
      { prompt: 'Sync current business DNA into viking://user/default/.memories/', intent: 'Long-term memory synchronization' }
    ],
    markdownTemplate: `# Viking Context VFS Navigator

## Overview
Replaces flat vector database queries with structured hierarchical filesystem operations across \`viking://\` namespaces.

## Directory Layout
- \`viking://user/default/.memories/\`: 6-category self-evolving memory (\`profiles\`, \`preferences\`, \`entities\`, \`events\`, \`cases\`, \`patterns\`).
- \`viking://resources/\`: AEO audits, SERP caches, and JSON-LD schema templates.
- \`viking://skills/\`: Reusable tool definitions and agent prompts.
- \`viking://sessions/\`: Active conversation context and scratchpads.

## Multi-Resolution Layers
- **L0 (Abstract)**: ~100 tokens (Routing & Indexing).
- **L1 (Overview)**: ~2,000 tokens (Planning & Structural Context).
- **L2 (Full Detail)**: Complete raw content on-demand.`
  },
  {
    id: 'luminara-context-graph',
    name: 'luminara-context-graph',
    title: 'Luminara Context Graph & Decision Provenance',
    description: 'Build an AEO entity knowledge graph from Business DNA and Instant Audits, record decision chains, detect conflicts, run AEO rules, and export Organization JSON-LD.',
    category: 'graph',
    author: 'Luminara Digital',
    version: '1.0.0',
    systemPrompt: `You are the Luminara Context Graph navigator.
Maintain a structured entity graph (Organization, Competitor, Offering, Finding, Evidence, Decision).
Always attach provenance when ingesting audits or DNA.
Prefer hybrid retrieval (graph neighbors + VFS DRR) over flat keyword search alone.
Use CLI group: luminara kg sync|ingest|query|decision|rules|export.`,
    tools: ['run_command', 'view_file'],
    examples: [
      { prompt: 'Sync Business DNA into the context graph and show stats', intent: 'kg sync + kg stats' },
      { prompt: 'Ingest the last Instant Audit and trace the decision chain', intent: 'kg ingest audit + kg decision trace' },
      { prompt: 'Export Organization JSON-LD for schema saturation', intent: 'kg export jsonld' }
    ],
    markdownTemplate: `# Luminara Context Graph

## Overview
Clean-room browser TypeScript context graph for AEO entity saturation and decision provenance.

## CLI
- \`luminara kg sync\` - DNA + VFS entities to graph
- \`luminara kg ingest audit\` - Instant Audit ingest + decision node
- \`luminara kg query "<text>"\` - Hybrid graph + VFS retrieve
- \`luminara kg rules run\` - AEO policy findings
- \`luminara kg export jsonld\` - Organization schema export

## Harness
Open Command Suite → Harness → Context Graph.`
  }
];

class SkillsGeneratorService {
  public listSkills(): LuminaraSkill[] {
    return [...LUMINARA_SKILLS];
  }

  public getSkill(id: string): LuminaraSkill | undefined {
    return LUMINARA_SKILLS.find(s => s.id === id);
  }

  public formatForPlatform(skill: LuminaraSkill, platform: SkillPlatform): string {
    switch (platform) {
      case 'antigravity':
        return `---
name: ${skill.name}
description: ${skill.description}
tools: [${skill.tools.join(', ')}]
author: ${skill.author}
version: ${skill.version}
---

# ${skill.title}

${skill.description}

## System Directives
${skill.systemPrompt}

## Recommended Usage
${skill.examples.map(e => `- \`${e.prompt}\` -> *${e.intent}*`).join('\n')}

${skill.markdownTemplate}
`;

      case 'claude':
        return `# Skill: ${skill.name}
# Description: ${skill.description}

You have access to the "${skill.name}" skill. When invoked by the user:

## Role & Instructions
${skill.systemPrompt}

## Tools Allowed
${skill.tools.map(t => `- \`${t}\``).join('\n')}

## Examples
${skill.examples.map(e => `User: "${e.prompt}"\nAction: ${e.intent}\n`).join('\n')}

${skill.markdownTemplate}
`;

      case 'codex':
        return `# [CODEX_SKILL_MANIFEST]
# NAME: ${skill.name}
# VERSION: ${skill.version}

<system_instructions>
${skill.systemPrompt}
</system_instructions>

<capabilities>
${skill.markdownTemplate}
</capabilities>
`;

      case 'hermes':
        return `<|im_start|>system
[SKILL_DEFINITION: ${skill.name}]
${skill.description}

Instructions:
${skill.systemPrompt}

Tools: ${skill.tools.join(', ')}
<|im_end|>
`;

      case 'pi':
      default:
        return `# ${skill.name}
# ${skill.description}

${skill.systemPrompt}

## Quick Reference
${skill.examples.map(e => `- ${e.prompt}`).join('\n')}

${skill.markdownTemplate}
`;
    }
  }

  public getInstallPath(skill: LuminaraSkill, platform: SkillPlatform): string {
    switch (platform) {
      case 'antigravity':
        return `~/.gemini/config/skills/${skill.name}/SKILL.md`;
      case 'claude':
        return `~/.claude/skills/${skill.name}.md`;
      case 'codex':
        return `~/.codex/skills/${skill.name}.md`;
      case 'hermes':
        return `~/.hermes/skills/${skill.name}.json`;
      case 'pi':
        return `~/.pi/agent/skills/${skill.name}.md`;
      default:
        return `~/.agents/skills/${skill.name}/SKILL.md`;
    }
  }
}

export const skillsGeneratorService = new SkillsGeneratorService();
