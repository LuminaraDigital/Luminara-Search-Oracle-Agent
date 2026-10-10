import React from 'react';
import { ComponentRegistry, GenUIComponentDef } from './types';
import { VisibilityRadar } from '../../components/audit/VisibilityRadar';
import { CompetitorMap } from '../../components/audit/CompetitorMap';
import { ROICalculator } from '../../components/audit/ROICalculator';
import { ShipActionGate } from '../../components/audit/ShipActionGate';
import { ShareOfVoiceCard } from '../../components/audit/ShareOfVoiceCard';
import { MetricBadge } from './components/MetricBadge';
import { ActionCard } from './components/ActionCard';
import type { ShareOfVoiceSummary } from '../../services/visibility/shareOfVoiceService';

const DEFAULT_RADAR_HEADERS = [
  'Query',
  'Intent',
  'Brand cited',
  'Competitors',
  'Organic rank',
  'AI Overview',
  'Status',
];

const DEFAULT_COMPETITOR_HEADERS = [
  'Brand',
  'How AI talks about them',
  'Pages that win citations',
  'Content Advantage',
  'Trust Signals',
];

export const LUMINARA_GENUI_REGISTRY: ComponentRegistry = {
  // Composite Layouts
  AuditDeck: {
    component: ({ children }: { children?: React.ReactNode }) => (
      <div className="space-y-6 my-4 w-full">{children}</div>
    ),
    signature: 'AuditDeck(children: Component[])',
    description: 'Vertical stack containing high-priority audit cards.',
  },

  MetricRow: {
    component: ({ children }: { children?: React.ReactNode }) => (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 my-4 w-full">{children}</div>
    ),
    signature: 'MetricRow(children: Component[])',
    description: 'Horizontal or responsive grid of metric badges.',
  },

  // Tactical Micro-Components
  MetricBadge: {
    component: MetricBadge,
    signature: 'MetricBadge(label: string, value: string | number, status?: "verified" | "unmeasured")',
    description: 'Honest, cite-or-silence metric pill with unmeasured state handling.',
  },

  ShipActionCard: {
    component: ActionCard,
    signature: 'ShipActionCard(title: string, priority: "High" | "Med" | "Low", timeEstimate: string, action?: Action, buttonLabel?: string)',
    description: 'Card representing the single move worth shipping this week with an action button.',
  },

  // High-Density Domain Components
  VisibilityRadar: {
    component: VisibilityRadar,
    adapter: (node, resolvedArgs) => {
      let rows: string[][] = [];
      let headers: string[] = DEFAULT_RADAR_HEADERS;

      if (Array.isArray(resolvedArgs[0])) {
        // If first arg is an array of arrays: rows
        if (resolvedArgs[0].length > 0 && Array.isArray(resolvedArgs[0][0])) {
          rows = resolvedArgs[0];
          if (Array.isArray(resolvedArgs[1])) headers = resolvedArgs[1];
        } else if (resolvedArgs.length > 1 && Array.isArray(resolvedArgs[1])) {
          headers = resolvedArgs[0];
          rows = resolvedArgs[1];
        }
      }

      return { headers, rows };
    },
    signature: 'VisibilityRadar(rows: string[][], headers?: string[])',
    description: 'Live SERP and AI Overview visibility radar mapping query rankings and citations.',
  },

  CompetitorMap: {
    component: CompetitorMap,
    adapter: (node, resolvedArgs) => {
      let rows: string[][] = [];
      let headers: string[] = DEFAULT_COMPETITOR_HEADERS;

      if (Array.isArray(resolvedArgs[0])) {
        if (resolvedArgs[0].length > 0 && Array.isArray(resolvedArgs[0][0])) {
          rows = resolvedArgs[0];
          if (Array.isArray(resolvedArgs[1])) headers = resolvedArgs[1];
        } else if (resolvedArgs.length > 1 && Array.isArray(resolvedArgs[1])) {
          headers = resolvedArgs[0];
          rows = resolvedArgs[1];
        }
      }

      return { headers, rows };
    },
    signature: 'CompetitorMap(rows: string[][], headers?: string[])',
    description: 'Comparative perception and content advantage map for market rivals.',
  },

  ROICalculator: {
    component: ROICalculator,
    signature: 'ROICalculator()',
    description: 'Interactive organic search & AEO ROI runway calculator.',
  },

  ShipActionGate: {
    component: ShipActionGate,
    adapter: (node, resolvedArgs, actionHandler) => {
      const domain = typeof resolvedArgs[0] === 'string' ? resolvedArgs[0] : '';
      const markdownText = typeof resolvedArgs[1] === 'string' ? resolvedArgs[1] : '';

      return {
        domain,
        markdownText,
        hasEvidence: true,
        sourceCount: 1,
        onCommitted: (commitment: any) => {
          if (actionHandler) {
            actionHandler('commit_ship', commitment);
          } else {
            window.dispatchEvent(
              new CustomEvent('luminara-genui-action', {
                detail: { action: 'commit_ship', payload: commitment },
              })
            );
          }
        },
        onDeploy: () => {
          if (actionHandler) {
            actionHandler('open_cms_deploy', { domain });
          } else {
            window.dispatchEvent(new CustomEvent('luminara-open-cms-deploy'));
          }
        },
      };
    },
    signature: 'ShipActionGate(domain: string, markdownText: string)',
    description: 'Level 4 commitment gate unlocking deep audit findings only after shipping one move.',
  },

  ShareOfVoiceCard: {
    component: ShareOfVoiceCard,
    adapter: (node, resolvedArgs) => {
      if (resolvedArgs[0] && typeof resolvedArgs[0] === 'object' && 'slices' in resolvedArgs[0]) {
        return { summary: resolvedArgs[0] as ShareOfVoiceSummary };
      }

      // Convert tuples like [["Luminara", 65], ["Competitor", 35]]
      const title = typeof resolvedArgs[0] === 'string' ? resolvedArgs[0] : 'Brand Share of Voice';
      const pairs = Array.isArray(resolvedArgs[1]) ? resolvedArgs[1] : [];

      const slices = pairs.map((pair: any, idx: number) => {
        const label = Array.isArray(pair) ? String(pair[0]) : `Entity ${idx + 1}`;
        const pct = Array.isArray(pair) ? Number(pair[1]) || 0 : 0;
        return {
          label,
          kind: idx === 0 ? ('brand' as const) : ('competitor' as const),
          mentionCount: 1,
          citationCount: 1,
          citationSharePercent: pct,
          mentionSharePercent: pct,
        };
      });

      const summary: ShareOfVoiceSummary = {
        targetDomain: 'target.domain',
        brandName: title,
        measuredAt: Date.now(),
        totalPrompts: 1,
        mentionCoveragePercent: slices[0]?.mentionSharePercent ?? 0,
        citationCoveragePercent: slices[0]?.citationSharePercent ?? 0,
        brandCitationSharePercent: slices[0]?.citationSharePercent ?? 0,
        slices,
        formula: 'empirical_probe',
        method: 'observed',
      };

      return { summary };
    },
    signature: 'ShareOfVoiceCard(brandName: string, distribution: [string, number][])',
    description: 'Share of voice comparison card showing brand vs rival citation coverage.',
  },
};
