import { describe, expect, it, vi } from 'vitest';
import { parseGenUI } from '../services/genui/parser';
import { tokenize } from '../services/genui/lexer';
import { TokenType } from '../services/genui/types';
import { materializeNode } from '../services/genui/materializer';
import React from 'react';

describe('Luminara GenUI Parser & Lexer', () => {
  it('tokenizes identifiers, components, strings, numbers and actions', () => {
    const input = 'card = MetricCard("Visibility Score", 92, true, @Action("inspect", "seo"))';
    const tokens = tokenize(input);

    expect(tokens.map((t) => t.type)).toEqual([
      TokenType.Ident,      // card
      TokenType.Equals,     // =
      TokenType.Component,  // MetricCard
      TokenType.LParen,     // (
      TokenType.Str,        // "Visibility Score"
      TokenType.Comma,      // ,
      TokenType.Num,        // 92
      TokenType.Comma,      // ,
      TokenType.True,       // true
      TokenType.Comma,      // ,
      TokenType.Action,     // @Action
      TokenType.LParen,     // (
      TokenType.Str,        // "inspect"
      TokenType.Comma,      // ,
      TokenType.Str,        // "seo"
      TokenType.RParen,     // )
      TokenType.RParen,     // )
      TokenType.EOF,
    ]);
  });

  it('parses structured component assignments and detects root', () => {
    const dsl = `
      root = Deck([card1, card2])
      card1 = MetricCard("AEO Visibility", 84)
      card2 = ActionCard("Fix Schema", "High")
    `;

    const result = parseGenUI(dsl);
    expect(result.rootId).toBe('root');
    expect(result.nodes.size).toBe(3);

    const rootNode = result.nodes.get('root');
    expect(rootNode?.component).toBe('Deck');
    expect(rootNode?.args[0]).toEqual(['card1', 'card2']);

    const card1 = result.nodes.get('card1');
    expect(card1?.component).toBe('MetricCard');
    expect(card1?.args).toEqual(['AEO Visibility', 84]);
  });

  it('handles state variables ($var) and named arguments', () => {
    const dsl = `
      $brand = "Luminara"
      root = Header(title: "Audit for " + $brand, priority: "High")
    `;

    const result = parseGenUI(dsl);
    expect(result.stateVars.get('brand')).toBe('Luminara');

    const rootNode = result.nodes.get('root');
    expect(rootNode?.namedArgs?.priority).toBe('High');
  });

  it('auto-recovers and closes incomplete streaming chunks', () => {
    // LLM cut off mid-statement
    const incompleteDsl = 'root = VisibilityRadar([["query 1", "Yes", 90';
    const result = parseGenUI(incompleteDsl);

    expect(result.nodes.has('root')).toBe(true);
    const rootNode = result.nodes.get('root');
    expect(rootNode?.component).toBe('VisibilityRadar');
    expect(rootNode?.isComplete).toBe(false);
  });

  it('materializes nodes into React elements and resolves references', () => {
    const dsl = `
      root = Container([pill])
      pill = Badge("Active", "green")
    `;

    const Container: React.FC<{ children: React.ReactNode }> = ({ children }) =>
      React.createElement('div', { className: 'container' }, children);
    const Badge: React.FC<{ args: any[] }> = ({ args }) =>
      React.createElement('span', { className: 'badge' }, `${args[0]} - ${args[1]}`);

    const registry = { Container, Badge };
    const result = parseGenUI(dsl);

    const rendered = materializeNode('root', result, registry) as React.ReactElement;
    expect(React.isValidElement(rendered)).toBe(true);
    expect(rendered.type).toBe(Container);
  });

  it('executes action callback when an @Action is invoked', () => {
    const actionSpy = vi.fn();
    const dsl = `
      root = Button("Click Me", @Action("trigger_modal", { modal: "cms" }))
    `;

    const Button: React.FC<{ args: any[] }> = ({ args }) => {
      const onClick = args[1];
      return React.createElement('button', { onClick }, args[0]);
    };

    const registry = { Button };
    const result = parseGenUI(dsl);

    const rendered = materializeNode('root', result, registry, actionSpy) as React.ReactElement;
    expect(React.isValidElement(rendered)).toBe(true);

    // Call the generated onClick callback
    const onClickHandler = rendered.props.args[1];
    expect(typeof onClickHandler).toBe('function');
    onClickHandler();

    expect(actionSpy).toHaveBeenCalledWith('trigger_modal', { modal: 'cms' });
  });

  it('renders components using LUMINARA_GENUI_REGISTRY adapters', async () => {
    const { LUMINARA_GENUI_REGISTRY } = await import('../services/genui/registry');

    const dsl = `
      root = AuditDeck([oneMove, metricGroup])
      oneMove = ShipActionCard("Deploy FAQ schema", "High", "20 mins")
      metricGroup = MetricRow([m1])
      m1 = MetricBadge("Visibility", "not measured")
    `;

    const result = parseGenUI(dsl);
    const rendered = materializeNode('root', result, LUMINARA_GENUI_REGISTRY) as React.ReactElement;
    expect(React.isValidElement(rendered)).toBe(true);
  });

  it('generates system prompt containing component signatures', async () => {
    const { generateGenUISystemPrompt } = await import('../services/genui/promptGenerator');
    const prompt = generateGenUISystemPrompt();

    expect(prompt).toContain(':::genui');
    expect(prompt).toContain('VisibilityRadar');
    expect(prompt).toContain('CompetitorMap');
    expect(prompt).toContain('ShipActionCard');
    expect(prompt).toContain('Cite-or-silence rule');
  });
});
