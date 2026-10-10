/**
 * Luminara GenUI Component Specifications and System Prompt Generator.
 * Framework-agnostic: safe to run in Node, Cloudflare Workers, or Browser.
 */

export interface GenUISchemaDef {
  name: string;
  signature: string;
  description: string;
}

export const GENUI_COMPONENTS_SPEC: Record<string, GenUISchemaDef> = {
  AuditDeck: {
    name: 'AuditDeck',
    signature: 'AuditDeck(children: Component[])',
    description: 'Vertical stack containing high-priority audit cards.',
  },
  MetricRow: {
    name: 'MetricRow',
    signature: 'MetricRow(children: Component[])',
    description: 'Horizontal or responsive grid of metric badges.',
  },
  MetricBadge: {
    name: 'MetricBadge',
    signature: 'MetricBadge(label: string, value: string | number, status?: "verified" | "unmeasured")',
    description: 'Honest, cite-or-silence metric pill with unmeasured state handling.',
  },
  ShipActionCard: {
    name: 'ShipActionCard',
    signature: 'ShipActionCard(title: string, priority: "High" | "Med" | "Low", timeEstimate: string, action?: Action, buttonLabel?: string)',
    description: 'Card representing the single move worth shipping this week with an action button.',
  },
  VisibilityRadar: {
    name: 'VisibilityRadar',
    signature: 'VisibilityRadar(rows: [query, intent, brandCited, keyCompetitors, citationStatus][])',
    description: 'Visibility table: one row per query with brand cited (Yes/No/not measured), key competitors and citation status.',
  },
  CompetitorMap: {
    name: 'CompetitorMap',
    signature: 'CompetitorMap(rows: [entity, aiPerception, topCitedPageTypes, contentAdvantage][])',
    description: 'Comparative perception and content advantage map for market rivals.',
  },
  ROICalculator: {
    name: 'ROICalculator',
    signature: 'ROICalculator()',
    description: 'Interactive organic search & AEO ROI runway calculator.',
  },
  ShipActionGate: {
    name: 'ShipActionGate',
    signature: 'ShipActionGate(domain: string, markdownText: string)',
    description: 'Level 4 commitment gate unlocking deep audit findings only after shipping one move.',
  },
  // ShareOfVoiceCard is not offered to the model: its numbers come only from the
  // code that counted them (see the registry).
};

export function generateGenUISystemPrompt(): string {
  const componentSignatures = Object.values(GENUI_COMPONENTS_SPEC).map(
    (c) => `- ${c.signature}: ${c.description}`
  );

  return `
### Dynamic Visual Canvas (GenUI)
When providing strategic recommendations, weekly moves, or comparative audits, you can optionally embed an interactive UI block using the \`:::genui\` container:

:::genui
root = AuditDeck([oneMove, metricGroup])
oneMove = ShipActionCard("Deploy Schema.org FAQ markup", "High", "30 mins", @Action("open_cms_deploy"))
metricGroup = MetricRow([m1, m2])
m1 = MetricBadge("AEO Visibility", "Active", "verified")
m2 = MetricBadge("Entity Authority", "not measured", "unmeasured")
:::

#### Available Components:
${componentSignatures.join('\n')}

#### GenUI Rules:
1. Always define \`root = ComponentName(...)\` as the entry layout.
2. Positional arguments match signatures. Use double quotes for strings.
3. Every variable must be referenced by root or another parent container.
4. Cite-or-silence rule: Never invent metrics or percentages. If data is unverified or missing, use "not measured".
5. Use @Action("action_name", payload) for interactive buttons. Common actions: "open_cms_deploy", "open_settings".
`;
}
