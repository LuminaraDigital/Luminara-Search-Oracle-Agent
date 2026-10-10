import { describe, it, expect, vi } from 'vitest';
import { parseGenUI } from '../../services/genui/parser';
import { materializeNode } from '../../services/genui/materializer';
import { LUMINARA_GENUI_REGISTRY } from '../../services/genui/registry';
import React from 'react';

describe('Web3 GenUI Micro-Components & Registry', () => {
  it('registers Web3DeployCard, ContractAuditCard, and Web3MethodCard in registry', () => {
    expect(LUMINARA_GENUI_REGISTRY.Web3DeployCard).toBeDefined();
    expect(LUMINARA_GENUI_REGISTRY.ContractAuditCard).toBeDefined();
    expect(LUMINARA_GENUI_REGISTRY.Web3MethodCard).toBeDefined();
  });

  it('parses and materializes Web3DeployCard from DSL stream', () => {
    const dsl = `
      root = Web3DeployCard(
        "Luminara Token ($LUMN)",
        "Base Mainnet",
        "1,000,000",
        "$0.04 (0.000015 ETH)",
        @Action("web3_deploy", "erc20_standard")
      )
    `;

    const parsed = parseGenUI(dsl);
    expect(parsed.rootId).toBe('root');
    const node = parsed.nodes.get('root')!;
    expect(node.component).toBe('Web3DeployCard');
    expect(node.args[0]).toBe('Luminara Token ($LUMN)');
    expect(node.args[1]).toBe('Base Mainnet');

    const actionSpy = vi.fn();
    const element = materializeNode('root', parsed, LUMINARA_GENUI_REGISTRY, actionSpy) as React.ReactElement;
    expect(React.isValidElement(element)).toBe(true);
    expect(element.props.args[0]).toBe('Luminara Token ($LUMN)');
  });

  it('parses and materializes ContractAuditCard with findings list', () => {
    const dsl = `
      root = ContractAuditCard(
        "0x140C07055B0B85efe91b80e765BCc24b3dd647d9",
        "Base",
        "94/100 (Safe)",
        [
          ["Honeypot Check", "Passed", "Verified"],
          ["Ownership", "Renounced", "Verified"]
        ]
      )
    `;

    const parsed = parseGenUI(dsl);
    expect(parsed.rootId).toBe('root');
    const node = parsed.nodes.get('root')!;
    expect(node.component).toBe('ContractAuditCard');

    const element = materializeNode('root', parsed, LUMINARA_GENUI_REGISTRY) as React.ReactElement;
    expect(React.isValidElement(element)).toBe(true);
    expect(element.props.args[0]).toBe('0x140C07055B0B85efe91b80e765BCc24b3dd647d9');
  });

  it('parses and materializes Web3MethodCard', () => {
    const dsl = `
      root = Web3MethodCard(
        "claimRewards",
        "CommunityStaking",
        "0x140C07055B0B85efe91b80e765BCc24b3dd647d9",
        "Free (Gas ~$0.01)"
      )
    `;

    const parsed = parseGenUI(dsl);
    const node = parsed.nodes.get('root')!;
    expect(node.component).toBe('Web3MethodCard');

    const element = materializeNode('root', parsed, LUMINARA_GENUI_REGISTRY) as React.ReactElement;
    expect(React.isValidElement(element)).toBe(true);
    expect(element.props.args[0]).toBe('claimRewards');
  });
});
