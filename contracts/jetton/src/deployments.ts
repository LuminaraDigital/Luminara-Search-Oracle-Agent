/**
 * deployments.json: where this token lives on each network.
 *
 * The deploy tool writes an entry once it has verified a deployment on-chain.
 * Commit the file afterwards: it is the record that the verify script, the
 * mainnet gate and later the app read the token address from.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CodeHashes, Network } from './deployment';

export interface DeploymentRecord {
  /** Token contract address, in the user-friendly form of its network. */
  master: string;
  /** The admin the token was deployed for. */
  admin: string;
  /** When this tool first verified the deployment (ISO date). */
  verifiedAt: string;
  codeHashes: CodeHashes;
}

export type Deployments = Record<Network, DeploymentRecord | null>;

export const DEPLOYMENTS_FILE = fileURLToPath(new URL('../deployments.json', import.meta.url));

export function loadDeployments(file = DEPLOYMENTS_FILE): Deployments {
  const stored = JSON.parse(readFileSync(file, 'utf8')) as Partial<Deployments>;
  return { testnet: stored.testnet ?? null, mainnet: stored.mainnet ?? null };
}

/**
 * Records a verified deployment. An existing record for a different address
 * is never overwritten: a token's address is its identity, so replacing one
 * has to be a deliberate edit of the file.
 */
export function recordDeployment(network: Network, record: DeploymentRecord, file = DEPLOYMENTS_FILE): 'recorded' | 'unchanged' {
  const deployments = loadDeployments(file);
  const existing = deployments[network];
  if (existing) {
    if (existing.master === record.master) return 'unchanged';
    throw new Error(
      `deployments.json already records a different ${network} token (${existing.master}). ` +
        'Remove that entry by hand if the new deployment is meant to replace it.',
    );
  }
  deployments[network] = record;
  writeFileSync(file, `${JSON.stringify(deployments, null, 2)}\n`);
  return 'recorded';
}
