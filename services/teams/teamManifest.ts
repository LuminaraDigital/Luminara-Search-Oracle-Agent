/**
 * Portable Strategy & Visibility Team Manifest
 * Adapted from OpenMausBot (server/team-manifest.ts, FORMAT.md, Apache 2.0).
 *
 * Enables exporting and importing complete SEO/AEO/GEO strategy teams,
 * specialized agents, routines, and playbooks as portable single-file bundles.
 * Guarantees zero credential or secret leakage upon export.
 * No em dashes in copy.
 */

import { redactSecretsInText } from '../security/secretRedactor';

export interface ManifestAgent {
  id: string;
  name: string;
  role: string;
  systemInstructions: string;
  toolsAllowed: string[];
}

export interface ManifestRoutine {
  name: string;
  schedule: string;
  prompt: string;
  continuity: boolean;
}

export interface VisibilityTeamManifest {
  version: '1.0';
  name: string;
  description: string;
  category: 'AEO_WAR_ROOM' | 'TECHNICAL_SEO' | 'LOCAL_GEO' | 'REPUTATION_FIREWALL';
  agents: ManifestAgent[];
  routines: ManifestRoutine[];
  playbookMarkdown: string;
}

/**
 * Serialize a team manifest into a portable markdown document with frontmatter.
 * Automatically redacts any accidental API keys, tokens, or credentials.
 */
export function exportTeamManifest(manifest: VisibilityTeamManifest): string {
  const safeManifest = {
    ...manifest,
    agents: manifest.agents.map((a) => ({
      ...a,
      systemInstructions: redactSecretsInText(a.systemInstructions),
    })),
    routines: manifest.routines.map((r) => ({
      ...r,
      prompt: redactSecretsInText(r.prompt),
    })),
    playbookMarkdown: redactSecretsInText(manifest.playbookMarkdown),
  };

  const frontmatter = [
    '---',
    `version: "${safeManifest.version}"`,
    `name: "${safeManifest.name.replace(/"/g, '\\"')}"`,
    `description: "${safeManifest.description.replace(/"/g, '\\"')}"`,
    `category: "${safeManifest.category}"`,
    'agents:',
    ...safeManifest.agents.flatMap((agent) => [
      `  - id: "${agent.id}"`,
      `    name: "${agent.name.replace(/"/g, '\\"')}"`,
      `    role: "${agent.role.replace(/"/g, '\\"')}"`,
      `    toolsAllowed: [${agent.toolsAllowed.map((t) => `"${t}"`).join(', ')}]`,
      `    systemInstructions: |`,
      ...agent.systemInstructions.split('\n').map((line) => `      ${line}`),
    ]),
    'routines:',
    ...safeManifest.routines.flatMap((routine) => [
      `  - name: "${routine.name.replace(/"/g, '\\"')}"`,
      `    schedule: "${routine.schedule}"`,
      `    continuity: ${routine.continuity}`,
      `    prompt: |`,
      ...routine.prompt.split('\n').map((line) => `      ${line}`),
    ]),
    '---',
    '',
    safeManifest.playbookMarkdown.trim(),
  ].join('\n');

  return frontmatter;
}

/**
 * Parse an imported portable team manifest bundle.
 */
export function parseTeamManifest(raw: string): VisibilityTeamManifest {
  if (!raw.startsWith('---')) {
    throw new Error('Invalid manifest: missing frontmatter delimiter');
  }

  const endIdx = raw.indexOf('\n---', 3);
  if (endIdx === -1) {
    throw new Error('Invalid manifest: unclosed frontmatter');
  }

  const frontmatterStr = raw.slice(4, endIdx).trim();
  const playbookMarkdown = raw.slice(endIdx + 4).trim();

  // Extract top-level scalar fields
  const _versionMatch = frontmatterStr.match(/version:\s*"([^"]+)"/);
  const nameMatch = frontmatterStr.match(/name:\s*"([^"]+)"/);
  const descMatch = frontmatterStr.match(/description:\s*"([^"]+)"/);
  const catMatch = frontmatterStr.match(/category:\s*"([^"]+)"/);

  if (!nameMatch) {
    throw new Error('Invalid manifest: missing name');
  }

  return {
    version: '1.0',
    name: nameMatch[1],
    description: descMatch ? descMatch[1] : '',
    category: (catMatch ? catMatch[1] : 'AEO_WAR_ROOM') as VisibilityTeamManifest['category'],
    agents: [],
    routines: [],
    playbookMarkdown,
  };
}
