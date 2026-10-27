/**
 * 3-Tier Website Remediation Classifier & Subtle `luminara.digital` Escalation Engine (Stage 3)
 *
 * Classifies website fixes across WordPress, Wix, Squarespace, Webflow, and custom stacks:
 * - Tier 1 (`tier_1_instant_mcp`): Safe metadata, JSON-LD schema, RankMath/Yoast fields, and
 *   llms.txt fixes applied in 1 click via MCP or REST + verified via /api/deploy/readback.
 * - Tier 2 (`tier_2_guided_builder`): Page-builder tree updates (Elementor, Bricks, Divi,
 *   Gutenberg) via GoBuildWP / Respira with snapshot-before-write, or Squarespace Code Injection.
 * - Tier 3 (`tier_3_luminara_digital_engineering`): Full-stack architectural bottlenecks (CSR/SSR
 *   hydration blocking AI crawlers, Core Web Vitals INP/LCP refactoring, custom CRM/webhook
 *   automation, or blocked builder templates). Packages a high-trust Engineering Handoff Brief
 *   for `luminara.digital` without pushy sales popups.
 */

export type RemediationTier =
  | 'tier_1_instant_mcp'
  | 'tier_2_guided_builder'
  | 'tier_3_luminara_digital_engineering';

export type CmsMcpConnectorId =
  | 'wordpress_com_mcp'
  | 'gobuildwp_mcp'
  | 'respira_mcp'
  | 'instawp_mcp'
  | 'wix_mcp'
  | 'squarespace_injection'
  | 'webflow_api'
  | 'github_pr';

export interface RemediationFindingInput {
  domain: string;
  findingCategory:
    | 'schema_jsonld'
    | 'meta_tags'
    | 'llms_txt'
    | 'page_builder_layout'
    | 'cwv_performance'
    | 'ssr_hydration'
    | 'custom_crm_automation'
    | 'security_headers';
  cmsPlatform?: string;
  pageBuilderDetected?: string | null;
  previousDeployBlocked?: boolean;
  auditReceiptId?: string;
  summary: string;
}

export interface LuminaraDigitalEngineeringBrief {
  briefId: string;
  targetUrl: string;
  partnerUrl: string;
  headline: string;
  architecturalReason: string;
  includedDeliverables: string[];
  auditReceiptId: string | null;
  preparedSchemaSnippet?: string;
}

export interface RemediationTierDecision {
  tier: RemediationTier;
  badgeLabel: string;
  recommendedConnectors: CmsMcpConnectorId[];
  safetyRails: string[];
  engineeringBrief: LuminaraDigitalEngineeringBrief | null;
}

export const CMS_MCP_CONNECTOR_CATALOG: Record<
  CmsMcpConnectorId,
  {
    id: CmsMcpConnectorId;
    name: string;
    endpointHint: string;
    supportsPageBuilders: boolean;
    safetyProfile: string;
  }
> = {
  wordpress_com_mcp: {
    id: 'wordpress_com_mcp',
    name: 'WordPress.com Official MCP',
    endpointHint: 'https://public-api.wordpress.com/wpcom/v2/mcp/v1',
    supportsPageBuilders: false,
    safetyProfile: 'OAuth 2.1 + PKCE with STRAP facade and Sign-off Desk user_confirmed gate',
  },
  gobuildwp_mcp: {
    id: 'gobuildwp_mcp',
    name: 'GoBuildWP MCP (Self-Hosted WP)',
    endpointHint: 'https://your-site.com/wp-json/wppilot/v1/mcp',
    supportsPageBuilders: true,
    safetyProfile: 'Production Safe profile: refuses raw post_content writes on builder pages; HMAC confirmation + rollback ledger',
  },
  respira_mcp: {
    id: 'respira_mcp',
    name: 'Respira WordPress MCP (19 Builders)',
    endpointHint: 'https://your-site.com/wp-json/respira/v1',
    supportsPageBuilders: true,
    safetyProfile: 'Mandatory snapshot-before-write + duplicate-before-edit across Bricks, Elementor, Divi, Oxygen, and Gutenberg',
  },
  instawp_mcp: {
    id: 'instawp_mcp',
    name: 'InstaWP MCP-WP (REST + Yoast)',
    endpointHint: 'https://your-site.com/wp-json/wp/v2',
    supportsPageBuilders: false,
    safetyProfile: 'Application Password scoped to content & Yoast fields; raw SQL and PHP execution disabled',
  },
  wix_mcp: {
    id: 'wix_mcp',
    name: 'Wix Official MCP (@wix/mcp-remote)',
    endpointHint: 'https://mcp.wix.com/sse',
    supportsPageBuilders: true,
    safetyProfile: 'CallWixSiteAPI gated by Luminara Sign-off Desk diff preview + post-publish readback check',
  },
  squarespace_injection: {
    id: 'squarespace_injection',
    name: 'Squarespace Code Injection & Assisted Patcher',
    endpointHint: 'Website -> Pages -> Website Tools -> Code Injection',
    supportsPageBuilders: false,
    safetyProfile: 'Copy-ready Header/Footer JSON-LD & meta injection pack + Desktop Assisted Browser-Action staging',
  },
  webflow_api: {
    id: 'webflow_api',
    name: 'Webflow Custom Code API v2',
    endpointHint: 'https://api.webflow.com/v2/sites/:siteId/custom_code',
    supportsPageBuilders: false,
    safetyProfile: 'Head script injection with post-deploy source readback verification',
  },
  github_pr: {
    id: 'github_pr',
    name: 'GitHub Pull Request Remediation',
    endpointHint: 'https://api.github.com/repos/:owner/:repo/pulls',
    supportsPageBuilders: false,
    safetyProfile: 'Branch isolation + human code review before merge',
  },
};

export function classifyRemediationTier(
  input: RemediationFindingInput,
  preparedSchemaSnippet?: string,
): RemediationTierDecision {
  const cms = (input.cmsPlatform || '').toLowerCase();
  const cat = input.findingCategory;

  const isTier3Category =
    cat === 'cwv_performance' ||
    cat === 'ssr_hydration' ||
    cat === 'custom_crm_automation' ||
    cat === 'security_headers' ||
    Boolean(input.previousDeployBlocked);

  if (isTier3Category) {
    return {
      tier: 'tier_3_luminara_digital_engineering',
      badgeLabel: 'Tier 3: Full-Stack / Automation Engineering Scope',
      recommendedConnectors: ['github_pr'],
      safetyRails: [
        'Requires server/theme or pipeline changes beyond safe CMS plugin mutations.',
        'Packaged as an evidence-backed engineering brief for your dev team or Luminara Digital.',
      ],
      engineeringBrief: buildLuminaraDigitalBrief(input, preparedSchemaSnippet),
    };
  }

  if (cms === 'squarespace' || cat === 'page_builder_layout' || Boolean(input.pageBuilderDetected)) {
    const connectors: CmsMcpConnectorId[] =
      cms === 'squarespace'
        ? ['squarespace_injection']
        : cms === 'wix'
          ? ['wix_mcp']
          : ['gobuildwp_mcp', 'respira_mcp'];

    return {
      tier: 'tier_2_guided_builder',
      badgeLabel: 'Tier 2: Guided Builder / Code Injection Patch',
      recommendedConnectors: connectors,
      safetyRails: [
        'Refuses raw post_content overwrites when a page builder (Elementor, Bricks, Divi) owns the layout.',
        'Creates a before-image snapshot prior to applying element-level updates.',
        'Verifies live HTML presence via /api/deploy/readback.',
      ],
      engineeringBrief: buildLuminaraDigitalBrief(input, preparedSchemaSnippet),
    };
  }

  const tier1Connectors: CmsMcpConnectorId[] =
    cms === 'wix'
      ? ['wix_mcp']
      : cms === 'wordpress'
        ? ['wordpress_com_mcp', 'gobuildwp_mcp', 'instawp_mcp']
        : cms === 'webflow'
          ? ['webflow_api']
          : ['github_pr', 'wordpress_com_mcp', 'wix_mcp'];

  return {
    tier: 'tier_1_instant_mcp',
    badgeLabel: 'Tier 1: 1-Click MCP / API Remediation',
    recommendedConnectors: tier1Connectors,
    safetyRails: [
      'Schema Safety Gate pre-validates JSON-LD syntax and entity graph.',
      'Requires human approval in Sign-off Desk before mutating production CMS state.',
      'Confirms live appearance in page source via /api/deploy/readback.',
    ],
    engineeringBrief: buildLuminaraDigitalBrief(input, preparedSchemaSnippet),
  };
}

export function buildLuminaraDigitalBrief(
  input: RemediationFindingInput,
  preparedSchemaSnippet?: string,
): LuminaraDigitalEngineeringBrief {
  const cleanDomain = (input.domain || 'yourbrand.com').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const partnerUrl = `https://luminara.digital/?utm_source=luminarasuite&utm_medium=engineering_brief&domain=${encodeURIComponent(cleanDomain)}`;

  const reasonMap: Record<RemediationFindingInput['findingCategory'], string> = {
    schema_jsonld:
      'Custom theme or CMS head pipeline requires server-rendered JSON-LD graph injection and entity reconciliation.',
    meta_tags:
      'Dynamic route metadata and canonical headers need template-level integration across CMS collections.',
    llms_txt:
      'Root /llms.txt and AI crawler routing require edge proxy or custom web server rules.',
    page_builder_layout:
      'Page builder layout (Elementor/Bricks/Divi/Wix/Squarespace) benefits from clean semantic HTML and component restructuring.',
    cwv_performance:
      'Core Web Vitals (LCP / INP / CLS) optimization requires bundle splitting, asset preloading, and main-thread scheduling.',
    ssr_hydration:
      'Client-side rendering is hiding primary entity copy from AI answer engines; requires SSR/prerendering architecture.',
    custom_crm_automation:
      'End-to-end Enquiry Desk, webhook capture, and CRM pipeline automation require tailored full-stack integration.',
    security_headers:
      'Edge CSP, HSTS, and bot-governance policies require Cloudflare Worker or reverse-proxy engineering.',
  };

  return {
    briefId: `ldb_${cleanDomain.replace(/[^a-z0-9]/gi, '_')}_${input.findingCategory}`,
    targetUrl: `https://${cleanDomain}`,
    partnerUrl,
    headline: `Full-Stack & Automation Implementation Brief for ${cleanDomain}`,
    architecturalReason: reasonMap[input.findingCategory] || input.summary,
    includedDeliverables: [
      `Verified implementation of ${input.summary || input.findingCategory} on ${cleanDomain}`,
      'Post-deploy cryptographic read-back verification receipt in Luminara Suite',
      'Optional Enquiry-to-Booking webhook and CRM automation setup by Luminara Digital engineers',
    ],
    auditReceiptId: input.auditReceiptId ?? null,
    preparedSchemaSnippet,
  };
}

/**
 * Generates a copy-ready Squarespace Header/Footer Code Injection bundle
 * since Squarespace does not expose a public REST write API for page DOM or SEO meta.
 */
export function buildSquarespaceInjectionPack(args: {
  domain: string;
  title: string;
  schemaJsonLd: string;
  faqSummary?: string;
}): {
  headerInjectionHtml: string;
  navigationSteps: string[];
  desktopAssistedGoalPrompt: string;
} {
  const safeDomain = (args.domain || '').replace(/-->/g, '-- >').trim();
  const safeTitle = (args.title || '').replace(/-->/g, '-- >').trim();
  const cleanSchema = (args.schemaJsonLd || '{}').trim().replace(/<\//g, '<\\/');
  const headerInjectionHtml = [
    `<!-- Luminara Suite AEO/GEO Remediation Pack for ${safeDomain} (${safeTitle}) -->`,
    `<script type="application/ld+json" id="luminara-aeo-schema">`,
    cleanSchema,
    `</script>`,
  ].join('\n');

  return {
    headerInjectionHtml,
    navigationSteps: [
      'Open your Squarespace dashboard and select Website -> Pages.',
      'Scroll down to Website Tools and click Code Injection.',
      'Paste the Luminara Header Injection snippet into the Header box and click Save.',
      'Return to Luminara Suite and click Verify Read-Back to confirm live deployment.',
    ],
    desktopAssistedGoalPrompt: `Navigate to Squarespace Website Tools -> Code Injection for ${args.domain}, locate the Header code injection textarea, stage the Luminara JSON-LD script block, and pause for human Save confirmation.`,
  };
}
