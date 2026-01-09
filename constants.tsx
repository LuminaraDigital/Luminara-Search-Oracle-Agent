import React from 'react';

export const SYSTEM_INSTRUCTIONS = `
Role: You are Vaticinator, the world's premier Holographic Search Simulator and AEO Architect for "Luminara Digital". You operate as an "Always-On Strategic Consultant" for businesses seeking an alternative to expensive monthly agency retainers.

Core Philosophy:
1. Search-First Reasoning: Every claim MUST be validated by real-time SERP data using your Google Search tool.
2. Revenue-Linked Audit: Prioritize recommendations based on ROI impact (25-45% lift benchmark).
3. Economic Sovereignty: Empower businesses to optimize without $10k/mo agency fees.
4. Accessibility: When asked to simplify or use the "Plain English" protocol, ensure reading level is below grade 8. Use short, direct sentences. Avoid jargon.

Specialized Protocols:
- [Crawl & Diagnose]: Scan URLs for technical SEO, CWV, and indexation. Translate issues into plain-English tasks with "Impact Scores" (1-100).
- [AEO & AI Visibility]: Evaluate presence in ChatGPT/Gemini/SGE. Propose answer-ready content and schema.
- [LLM Optimization]: Test prompts against leading LLMs. Log brand mentions. Suggest cluster improvements for LLM quotation.
- [ROI Reporting]: Packaged audit with charts and action plans for non-technical owners.
- [Plain English Protocol]: Rewrite any analysis for a grade 8 reading level. Use short sentences. Be direct.

Strict Template (REQUIRED for Full Audits):
# Luminara Digital: Strategic Intelligence Report
## Document Identifier: [LS-ID-00X] | [Business Name]
**Date:** [Current Date] | **Lead Architect:** Vaticinator Neural Core

## I. Executive Briefing
[3-sentence high-impact summary linking findings to revenue potential.]

## II. Diagnostic Scan & Impact Matrix
| Task Name | Issue Summary | Impact Score (1-100) | Priority |
|-----------|---------------|----------------------|----------|
| [Task]    | [Simple explanation] | [Score] | [High/Med/Low] |

## III. AEO Visibility & LLM Footprint
- **Entity Clarity:** [Score/10] | **FAQ Saturation:** [Score/10]
- **LLM Quote Probability:** [%]
- **Prompt-Test Log:** [Brief trend analysis of brand appearance in AI answers]

## IV. Budget Efficiency & ROI Projection
- **Estimated Budget Waste:** [% of current spend misallocated]
- **Projected ROI Lift:** [25-45% range based on implementation]
- **Targeted ROAS Improvement:** [34%+ benchmark]
- **Cost Per Lead Reduction:** [Estimated -41% trajectory]

## V. Strategic Appendix: Sources
[A formal list of real sources found via search.]

---
*Luminara Digital: Vaticinator Loop Terminated | Intelligence Ready for Implementation.*
`;

export const ICONS = {
  Sparkle: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
    </svg>
  ),
  Mic: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/>
    </svg>
  ),
  Send: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" x2="11" y1="2" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  ),
  Stop: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
    </svg>
  ),
  Search: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
    </svg>
  ),
  AlertCircle: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="red" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>
    </svg>
  ),
  List: () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  ),
  Copy: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
    </svg>
  ),
  Check: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  FileText: ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
      <line x1="10" y1="9" x2="8" y2="9"/>
    </svg>
  ),
  LuminaraLogo: ({ className, isThinking, isVoice }: { className?: string; isThinking?: boolean; isVoice?: boolean }) => (
    <div className={`relative flex items-center justify-center ${className} ${isThinking ? 'logo-thinking' : ''} ${isVoice ? 'logo-voice' : ''} interactive-logo`}>
        <svg viewBox="0 0 100 100" className="w-full h-full">
            <defs>
                <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style={{stopColor:'#BF953F'}} />
                    <stop offset="50%" style={{stopColor:'#FCF6BA'}} />
                    <stop offset="100%" style={{stopColor:'#AA771C'}} />
                </linearGradient>
                <radialGradient id="thinkingGlow" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                    <stop offset="0%" style={{stopColor:'#FCF6BA', stopOpacity: 1}} />
                    <stop offset="40%" style={{stopColor:'#BF953F', stopOpacity: 0.8}} />
                    <stop offset="100%" style={{stopColor:'#AA771C', stopOpacity: 0}} />
                </radialGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="2.5" result="coloredBlur"/>
                  <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                  </feMerge>
                </filter>
            </defs>
            <circle cx="50" cy="50" r="48" fill="url(#goldGrad)" opacity="0.05" />
            {isVoice && (
              <circle cx="50" cy="50" r="46" fill="none" stroke="url(#goldGrad)" strokeWidth="0.5" strokeDasharray="1 3" className="animate-[spin_3s_linear_infinite]" opacity="0.6" />
            )}
            <g className="logo-orbit">
              <ellipse cx="50" cy="50" rx="42" ry="12" fill="none" stroke="url(#goldGrad)" strokeWidth="0.7" transform="rotate(45, 50, 50)" opacity="0.6" />
              <ellipse cx="50" cy="50" rx="42" ry="12" fill="none" stroke="url(#goldGrad)" strokeWidth="0.7" transform="rotate(-45, 50, 50)" opacity="0.6" />
              <ellipse cx="50" cy="50" rx="42" ry="12" fill="none" stroke="url(#goldGrad)" strokeWidth="0.7" transform="rotate(90, 50, 50)" opacity="0.4" />
            </g>
            <circle cx="50" cy="50" r="35" fill="none" stroke="url(#goldGrad)" strokeWidth="0.3" strokeDasharray="10 5" opacity="0.2" className="animate-[spin_12s_linear_infinite]" />
            <circle cx="50" cy="50" r="28" fill="none" stroke="url(#goldGrad)" strokeWidth="0.2" opacity="0.3" />
            <g className="logo-core" filter="url(#glow)">
              {isThinking && (
                <circle cx="50" cy="50" r="22" fill="url(#thinkingGlow)" opacity="0.3" className="animate-pulse" />
              )}
              <circle cx="50" cy="50" r="16" fill="url(#goldGrad)" opacity="0.15" />
              <circle cx="50" cy="50" r="10" fill="url(#goldGrad)" opacity="0.8" />
              <circle cx="50" cy="50" r="5" fill="#FCF6BA" />
              {(isThinking || isVoice) && (
                <circle cx="50" cy="50" r="12" fill="url(#goldGrad)" opacity="0.5" className="animate-pulse" />
              )}
            </g>
            <path d="M50 20 L50 80 M20 50 L80 50" stroke="url(#goldGrad)" strokeWidth="0.1" opacity="0.2" />
        </svg>
    </div>
  )
};
