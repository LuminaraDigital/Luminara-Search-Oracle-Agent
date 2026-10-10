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
    signature: 'VisibilityRadar(rows: string[][], headers?: string[])',
    description: 'Live SERP and AI Overview visibility radar mapping query rankings and citations.',
  },
  CompetitorMap: {
    name: 'CompetitorMap',
    signature: 'CompetitorMap(rows: string[][], headers?: string[])',
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
  ShareOfVoiceCard: {
    name: 'ShareOfVoiceCard',
    signature: 'ShareOfVoiceCard(brandName: string, distribution: [string, number][])',
    description: 'Share of voice comparison card showing brand vs rival citation coverage.',
  },
  Web3DeployCard: {
    name: 'Web3DeployCard',
    signature: 'Web3DeployCard(name: string, network: string, supply: string, gasEstimate: string, action?: Action, buttonLabel?: string)',
    description: '1-click smart contract deployment card with simulated gas and network target.',
  },
  ContractAuditCard: {
    name: 'ContractAuditCard',
    signature: 'ContractAuditCard(address: string, network: string, score: string, findings: [string, string, string][], action?: Action)',
    description: 'Deconstructed smart contract safety audit with plain English findings and verified explorer link.',
  },
  Web3MethodCard: {
    name: 'Web3MethodCard',
    signature: 'Web3MethodCard(methodName: string, contractName: string, address: string, feeEstimate: string, action?: Action)',
    description: 'Conversational method execution card for calling smart contracts with dry-run pre-simulation.',
  },
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
