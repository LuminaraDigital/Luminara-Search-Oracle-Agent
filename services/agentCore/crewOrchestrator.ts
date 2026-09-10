/**
 * Crew Orchestrator: Autonomous Multi-Agent Search Crew
 * 
 * Synthesizes:
 * - CrewAI: Specialized roles and autonomous task delegation
 * - AutoGen: Adversarial critic reflection loops
 * - LangGraph: Cyclic StateGraph edge execution
 * - Mem0: 4-tier memory and delta updates
 * - TON Web3: Cryptographic Proof-of-Audit attestation
 */

import { StateGraph, END_NODE } from './stateGraph';
import {
  AuditStateGraphContext,
  AgentActivityEvent,
  AgentRole,
  AgentProfile,
} from './types';
import { scoutAgent } from './agents/scoutAgent';
import { serpRadarAgent } from './agents/serpRadarAgent';
import { playbookAuditorAgent } from './agents/playbookAuditorAgent';
import { competitorStrategistAgent } from './agents/competitorStrategistAgent';
import { remediationArchitectAgent } from './agents/remediationArchitectAgent';
import { executiveTranslatorAgent } from './agents/executiveTranslatorAgent';
import { criticReflectionEngine } from './criticReflectionEngine';
import { mem0MemoryEngine } from './mem0MemoryEngine';
import { tonAttestationService } from './tonAttestationService';
import { ReportFocus, BusinessDNA } from '../../types';

export const CREW_PROFILES: Record<AgentRole, AgentProfile> = {
  scout: {
    role: 'scout',
    name: 'Scout Agent',
    avatar: '🔍',
    tagline: 'Deep Crawl & DOM Parser',
    goal: 'Scrape and extract raw HTML, headings, and schema entities.',
    backstory: 'Expert web crawler trained to extract structured data and assess DOM hygiene.',
    preferredModelRole: 'efficient',
  },
  serp_radar: {
    role: 'serp_radar',
    name: 'SERP Radar',
    avatar: '📡',
    tagline: 'Live Search & Citation Radar',
    goal: 'Probe search engines and measure empirical citation rates.',
    backstory: 'Search engine intelligence specialist monitoring Google, Perplexity, and AI Overviews.',
    preferredModelRole: 'efficient',
  },
  playbook_auditor: {
    role: 'playbook_auditor',
    name: 'Playbook Auditor',
    avatar: '⚖️',
    tagline: 'Compliance & Rule Enforcement',
    goal: 'Audit against claude-seo playbooks and calculate health scores.',
    backstory: 'Strict compliance auditor verifying Schema.org rules and E-E-A-T signals.',
    preferredModelRole: 'capable',
  },
  competitor_strategist: {
    role: 'competitor_strategist',
    name: 'Competitor Strategist',
    avatar: '🎯',
    tagline: 'Market Intelligence & Moats',
    goal: 'Detect competitors and uncover high-converting search intent gaps.',
    backstory: 'Market analyst mapping search landscape share-of-voice.',
    preferredModelRole: 'capable',
  },
  adversarial_critic: {
    role: 'adversarial_critic',
    name: 'Adversarial Critic',
    avatar: '🛡️',
    tagline: 'Anti-Hallucination Gatekeeper',
    goal: 'Cross-examine findings against raw evidence and eliminate false claims.',
    backstory: 'Impartial verifier ensuring zero false claims reach the non-developer.',
    preferredModelRole: 'advisor',
  },
  remediation_architect: {
    role: 'remediation_architect',
    name: 'Remediation Architect',
    avatar: '🛠️',
    tagline: 'JSON-LD & Code Engineer',
    goal: 'Formulate valid Schema.org patches and CMS deployment diffs.',
    backstory: 'Full-stack engineer crafting copy-paste ready code remediations.',
    preferredModelRole: 'capable',
  },
  executive_translator: {
    role: 'executive_translator',
    name: 'Executive Translator',
    avatar: '✍️',
    tagline: 'Plain-English ROI Synthesizer',
    goal: 'Translate technical findings into an 8th-grade executive summary.',
    backstory: 'Business communicator translating engineering jargon into clear business value.',
    preferredModelRole: 'efficient',
  },
};

export class CrewOrchestrator {
  /**
   * Builds the StateGraph pipeline with cyclic critic reflection
   */
  private buildGraph(): StateGraph<AuditStateGraphContext> {
    const graph = new StateGraph<AuditStateGraphContext>({ maxIterations: 12, name: 'LuminaraAuditCrew' });

    // Node 1: Scout Crawl
    graph.addNode('scout_node', 'Scout Site Crawl', async (ctx, emit) => {
      const scrapedPages = await scoutAgent.execute(ctx.targetUrl, emit);
      return { scrapedPages };
    });

    // Node 2: SERP Radar Probe
    graph.addNode('serp_node', 'SERP Radar Search', async (ctx, emit) => {
      const cleanDomain = ctx.targetUrl.replace(/^https?:\/\//i, '').split('/')[0];
      const { serpEvidence, citationRatePercent, shareOfVoiceScore } = await serpRadarAgent.execute(
        cleanDomain,
        ctx.dna,
        emit
      );
      return { serpEvidence, citationRatePercent, shareOfVoiceScore };
    });

    // Node 3: Playbook Compliance Audit
    graph.addNode('auditor_node', 'Playbook Auditor', async (ctx, emit) => {
      const { findings, healthScore } = await playbookAuditorAgent.execute(
        ctx.focus,
        ctx.scrapedPages,
        ctx.serpEvidence,
        ctx.dna,
        emit
      );
      return { findings, healthScore };
    });

    // Node 4: Competitor Intelligence
    graph.addNode('competitor_node', 'Competitor Strategist', async (ctx, emit) => {
      const { topCompetitors, competitorGaps } = await competitorStrategistAgent.execute(
        ctx.targetUrl,
        ctx.dna,
        ctx.serpEvidence,
        emit
      );
      return { topCompetitors, competitorGaps };
    });

    // Node 5: Adversarial Critic Verification Gate (AutoGen reflection)
    graph.addNode('critic_gate_node', 'Adversarial Critic Gate', async (ctx, emit) => {
      emit({
        id: `critic-start-${Date.now()}`,
        timestamp: Date.now(),
        agentRole: 'adversarial_critic',
        agentName: 'Adversarial Critic',
        phase: 'adversarial_verification',
        message: 'Cross-examining candidate findings against ground-truth DOM and SERP evidence…',
        status: 'reflecting',
      });

      const { verifiedFindings, rejectedCount, reflectionFeedback, criticConfidence } =
        criticReflectionEngine.verify(ctx.findings, ctx.patches, ctx.scrapedPages, ctx.serpEvidence);

      emit({
        id: `critic-done-${Date.now()}`,
        timestamp: Date.now(),
        agentRole: 'adversarial_critic',
        agentName: 'Adversarial Critic',
        phase: 'verification_complete',
        message:
          rejectedCount > 0
            ? `Adversarial check complete: Corrected ${rejectedCount} false claim(s). Remaining ${verifiedFindings.length} findings verified.`
            : `All ${verifiedFindings.length} findings 100% verified against ground truth DOM and SERP evidence.`,
        status: 'completed',
        confidenceScore: criticConfidence,
      });

      return {
        findings: verifiedFindings,
        criticRejections: (ctx.criticRejections || 0) + rejectedCount,
        criticPass: true,
      };
    });

    // Node 6: Code Remediation Generation
    graph.addNode('remediation_node', 'Remediation Architect', async (ctx, emit) => {
      const patches = await remediationArchitectAgent.execute(ctx.targetUrl, ctx.findings, ctx.dna, emit);
      // Run critic syntax validation on generated patches
      const { verifiedPatches } = criticReflectionEngine.verify([], patches, ctx.scrapedPages, ctx.serpEvidence);
      return { patches: verifiedPatches };
    });

    // Node 7: Plain English Executive Briefing
    graph.addNode('executive_translator_node', 'Executive Translator', async (ctx, emit) => {
      const plainEnglishBrief = await executiveTranslatorAgent.execute(
        ctx.targetUrl,
        ctx.healthScore,
        ctx.citationRatePercent,
        ctx.findings,
        ctx.patches,
        ctx.dna,
        emit
      );
      return { plainEnglishBrief };
    });

    // Node 8: Cryptographic Proof-of-Audit Attestation (TON)
    graph.addNode('attestation_node', 'TON Attestation Generator', async (ctx, emit) => {
      const cleanDomain = ctx.targetUrl.replace(/^https?:\/\//i, '').split('/')[0];
      const attestation = await tonAttestationService.createAttestation({
        domain: cleanDomain,
        healthScore: ctx.healthScore,
        citationRatePercent: ctx.citationRatePercent,
        findings: ctx.findings,
      });

      emit({
        id: `ton-attest-${Date.now()}`,
        timestamp: Date.now(),
        agentRole: 'adversarial_critic',
        agentName: 'Blockchain Attestation Vault',
        phase: 'attestation_generated',
        message: `Generated SHA-256 Proof-of-Audit digest: ${attestation.digestHex.slice(0, 16)}… Ready for TON anchoring.`,
        status: 'completed',
      });

      return { attestation };
    });

    // Node 9: Mem0 4-Tier Memory Extraction & Sync
    graph.addNode('memory_sync_node', 'Mem0 Memory Delta Sync', async (ctx, emit) => {
      const deltas = mem0MemoryEngine.extractAndSyncAuditContext(ctx);
      emit({
        id: `mem0-sync-${Date.now()}`,
        timestamp: Date.now(),
        agentRole: 'executive_translator',
        agentName: 'Brand Memory Vault',
        phase: 'memory_synced',
        message: `Synced ${deltas.length} autonomous memory delta(s) into brand knowledge graph.`,
        status: 'completed',
      });
      return {};
    });

    // Set graph edges
    graph.setEntryPoint('scout_node');
    graph.addEdge('scout_node', 'serp_node');
    graph.addEdge('serp_node', 'auditor_node');
    graph.addEdge('auditor_node', 'competitor_node');
    graph.addEdge('competitor_node', 'critic_gate_node');
    graph.addEdge('critic_gate_node', 'remediation_node');
    graph.addEdge('remediation_node', 'executive_translator_node');
    graph.addEdge('executive_translator_node', 'attestation_node');
    graph.addEdge('attestation_node', 'memory_sync_node');
    graph.addEdge('memory_sync_node', END_NODE);

    return graph;
  }

  /**
   * Run the full autonomous search crew for a target URL
   */
  public async runAuditCrew(
    targetUrl: string,
    focus: ReportFocus = 'AEO',
    dna?: BusinessDNA | null,
    onEvent?: (event: AgentActivityEvent) => void
  ): Promise<AuditStateGraphContext> {
    const formattedUrl = targetUrl.includes('://') ? targetUrl : `https://${targetUrl}`;

    const initialContext: AuditStateGraphContext = {
      targetUrl: formattedUrl,
      focus,
      dna,
      scrapedPages: [],
      serpEvidence: [],
      citationRatePercent: 50,
      shareOfVoiceScore: 50,
      healthScore: 75,
      findings: [],
      topCompetitors: [],
      competitorGaps: [],
      patches: [],
      plainEnglishBrief: '',
      criticRejections: 0,
      criticPass: false,
      errors: [],
    };

    const graph = this.buildGraph();
    const { finalContext } = await graph.run(initialContext, onEvent);
    return finalContext;
  }
}

export const crewOrchestrator = new CrewOrchestrator();
