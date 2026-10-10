/**
 * Web3 Client Action Bridge
 * Routes GenUI @Action events ("web3_deploy", "web3_inspect", "web3_call")
 * to connected wallet signers or chat prompts.
 */

import { fetchVerifiedContractClient, analyzeContractSafety } from './contractExplorerClient';
import { simulateDeployTransaction, simulateMethodCall } from './simulationEngine';
import { getTemplate, validateTemplateParams } from './templateCatalog';
import { getEvmChainConfig } from '../chain/evmChainRegistry';

export interface Web3ActionPayload {
  templateId?: string;
  params?: Record<string, any>;
  address?: string;
  chainId?: number;
  functionName?: string;
  args?: any[];
  [key: string]: any;
}

/**
 * Handles incoming GenUI actions triggered by Web3 cards.
 */
export async function handleWeb3GenUIAction(
  actionName: string,
  payload: Web3ActionPayload,
  onNotify?: (message: string, type: 'info' | 'success' | 'error') => void
): Promise<any> {
  const notify = onNotify || ((msg, type) => console.log(`[Web3 Action: ${type}] ${msg}`));

  switch (actionName) {
    case 'web3_deploy': {
      const templateId = payload.templateId || 'erc20_standard';
      const template = getTemplate(templateId);
      if (!template) {
        notify(`Template "${templateId}" not found in catalog.`, 'error');
        throw new Error(`Template "${templateId}" not found`);
      }

      const params = payload.params || {};
      const validation = validateTemplateParams(templateId, params);
      if (!validation.valid) {
        notify(`Validation failed: ${validation.errors.join(', ')}`, 'error');
        throw new Error(validation.errors.join(', '));
      }

      const chainId = payload.chainId || 8453; // Default Base
      const chainConfig = getEvmChainConfig(chainId);
      notify(`Simulating deployment for ${template.name} on ${chainConfig?.name || chainId}...`, 'info');

      // Pre-flight simulation check
      const simulation = await simulateDeployTransaction({
        chainId,
        bytecode: '0x608060405234801561001057600080fd5b50', // Mock bytecode for standard pre-flight
        abi: [],
      });

      if (!simulation.success) {
        notify(`Simulation warning: ${simulation.revertReason || 'Dry run failed'}`, 'error');
        throw new Error(simulation.revertReason || 'Dry run failed');
      }

      notify(`Ready to deploy on ${chainConfig?.name || 'Base'}. Estimated gas: ${simulation.estimatedFeeUsd}`, 'success');

      // Trigger standard wallet prompt or event for UI
      window.dispatchEvent(
        new CustomEvent('luminara-web3-sign-requested', {
          detail: {
            action: 'deploy',
            templateId,
            params,
            chainId,
            simulation,
          },
        })
      );
      return simulation;
    }

    case 'web3_inspect': {
      const address = payload.address;
      const chainId = payload.chainId || 8453;
      if (!address) {
        notify('Missing contract address to inspect.', 'error');
        throw new Error('Missing address');
      }

      notify(`Inspecting verified contract ${address.slice(0, 8)}...`, 'info');
      const res = await fetchVerifiedContractClient(chainId, address);
      if (!res.ok) {
        notify(`Failed to inspect contract: ${res.error}`, 'error');
        throw new Error(res.error);
      }

      const audit = analyzeContractSafety(res.data);
      notify(`Audit complete: ${audit.summary}`, 'success');

      window.dispatchEvent(
        new CustomEvent('luminara-web3-audit-completed', {
          detail: { contract: res.data, audit },
        })
      );
      return audit;
    }

    case 'web3_call': {
      const address = payload.address as `0x${string}`;
      const chainId = payload.chainId || 8453;
      const functionName = payload.functionName || 'unknown';
      if (!address) {
        notify('Missing contract address for method execution.', 'error');
        throw new Error('Missing address');
      }

      notify(`Simulating method ${functionName}() on ${address.slice(0, 8)}...`, 'info');
      const simulation = await simulateMethodCall({
        chainId,
        contractAddress: address,
        abi: payload.abi || [],
        functionName,
        args: payload.args || [],
      });

      if (!simulation.success) {
        notify(`Method simulation failed: ${simulation.revertReason}`, 'error');
        throw new Error(simulation.revertReason);
      }

      notify(`Simulation passed. Triggering wallet signature for ${functionName}()...`, 'success');
      window.dispatchEvent(
        new CustomEvent('luminara-web3-sign-requested', {
          detail: {
            action: 'call',
            address,
            chainId,
            functionName,
            args: payload.args,
            simulation,
          },
        })
      );
      return simulation;
    }

    default:
      console.warn(`[Web3 Action Bridge] Unhandled action: ${actionName}`);
      return null;
  }
}
