import React from 'react';
import { ComponentRegistry, GenUIComponentDef } from './types';
import { VisibilityRadar } from '../../components/audit/VisibilityRadar';
import { CompetitorMap } from '../../components/audit/CompetitorMap';
import { ROICalculator } from '../../components/audit/ROICalculator';
import { ShipActionGate } from '../../components/audit/ShipActionGate';
import { ShareOfVoiceCard } from '../../components/audit/ShareOfVoiceCard';
import { MetricBadge } from './components/MetricBadge';
import { ActionCard } from './components/ActionCard';
import { isMeasuredShareOfVoice } from '../../services/visibility/shareOfVoiceService';
import { REPORT_TABLES, isReportColumn } from '../audit/reportColumnGate';

// The cards take the report's own columns. A chat model supplies the rows, so the
// same rule as the report gate applies: a column that is not one of the report's
// own is dropped, and a row that cannot be lined up under the headers is dropped.
const DEFAULT_RADAR_HEADERS: string[] = [...REPORT_TABLES.visibilityRadar];
const DEFAULT_COMPETITOR_HEADERS: string[] = [...REPORT_TABLES.competitorMap];

/** Reads (rows, headers?) or (headers, rows) from the model's arguments and gates the columns. */
export function gatedTableArgs(resolvedArgs: any[], defaultHeaders: string[]): { headers: string[]; rows: string[][] } {
  let rows: unknown[] = [];
  let headers: unknown[] = defaultHeaders;

  if (Array.isArray(resolvedArgs[0])) {
    if (resolvedArgs[0].length > 0 && Array.isArray(resolvedArgs[0][0])) {
      rows = resolvedArgs[0];
      if (Array.isArray(resolvedArgs[1])) headers = resolvedArgs[1];
    } else if (resolvedArgs.length > 1 && Array.isArray(resolvedArgs[1])) {
      headers = resolvedArgs[0];
      rows = resolvedArgs[1];
    }
  }

  const names = headers.map((header) => String(header ?? ''));
  const keep = names.map((_, index) => index).filter((index) => isReportColumn(names[index]));
  const aligned = rows.filter((row): row is unknown[] => Array.isArray(row) && row.length === names.length);
  return {
    headers: keep.map((index) => names[index]),
    rows: aligned.map((row) => keep.map((index) => String(row[index] ?? ''))),
  };
}

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
    adapter: (node, resolvedArgs) => gatedTableArgs(resolvedArgs, DEFAULT_RADAR_HEADERS),
    signature: 'VisibilityRadar(rows: [query, intent, brandCited, keyCompetitors, citationStatus][])',
    description: 'Visibility table: one row per query with brand cited (Yes/No/not measured), key competitors and citation status.',
  },

  CompetitorMap: {
    component: CompetitorMap,
    adapter: (node, resolvedArgs) => gatedTableArgs(resolvedArgs, DEFAULT_COMPETITOR_HEADERS),
    signature: 'CompetitorMap(rows: [entity, aiPerception, topCitedPageTypes, contentAdvantage][])',
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
    // Share of voice numbers come only from the code that counted them. Anything a
    // chat model writes here, numbers or a whole summary object, is not shown: the
    // card gets no summary and renders nothing. The entry stays so a stored chat
    // reply that names the card still loads.
    adapter: (node, resolvedArgs) => ({
      summary: isMeasuredShareOfVoice(resolvedArgs[0]) ? resolvedArgs[0] : null,
    }),
    signature: 'ShareOfVoiceCard(summary)',
    description: 'Share of voice counts from an audit. Filled by the app, not by the model.',
  },
};
