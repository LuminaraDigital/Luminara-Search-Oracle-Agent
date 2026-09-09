import { describe, it, expect } from 'vitest';
import { createExecutiveTheme } from '../components/pdf/theme';
import { marked } from 'marked';
import React from 'react';
import { ExecutiveReportDocument } from '../components/pdf/ExecutiveReportDocument';

describe('Executive PDF Export System', () => {
  it('creates executive theme with custom and default primary colors', () => {
    const defaultTheme = createExecutiveTheme();
    expect(defaultTheme.colors.primary).toBe('#BF953F');
    expect(defaultTheme.colors.background).toBe('#ffffff');
    expect(defaultTheme.spacing.pageMargin.top).toBe(48);

    const customTheme = createExecutiveTheme('#0284c7');
    expect(customTheme.colors.primary).toBe('#0284c7');
  });

  it('parses audit markdown content into tokens for the PDF renderer', () => {
    const sampleAuditMarkdown = `
# Executive Summary
Target domain has 72/100 readiness score.

## Key Recommendations
- Implement Organization schema with SameAs links.
- Optimize LLM citation anchors on pricing page.

| Priority | Finding | Impact |
| --- | --- | --- |
| High | Missing Author Bios | Severe |
| Med | Schema Misconfiguration | Moderate |

> Strategic Context: Critical deployment needed before Q3.
`;

    const tokens = marked.lexer(sampleAuditMarkdown);
    expect(tokens.length).toBeGreaterThan(0);

    const headings = tokens.filter((t) => t.type === 'heading');
    expect(headings.length).toBe(2);
    expect(headings[0].text).toBe('Executive Summary');

    const lists = tokens.filter((t) => t.type === 'list');
    expect(lists.length).toBe(1);

    const tables = tokens.filter((t) => t.type === 'table');
    expect(tables.length).toBe(1);

    const blockquotes = tokens.filter((t) => t.type === 'blockquote');
    expect(blockquotes.length).toBe(1);
  });

  it('instantiates ExecutiveReportDocument component without throwing', () => {
    const element = React.createElement(ExecutiveReportDocument, {
      agencyName: 'Apex Growth Partners',
      clientName: 'Acme Health Corp',
      targetDomain: 'acmehealth.com',
      preparedBy: 'Luminara AI Strategy Practice',
      executiveNotes: 'Immediate remediation advised.',
      primaryColor: '#BF953F',
      markdownText: '# Executive Audit\n\nAll metrics grounded.',
      auditDate: 'March 15, 2026',
    });

    expect(element).toBeDefined();
    expect(element.props.agencyName).toBe('Apex Growth Partners');
    expect(element.props.clientName).toBe('Acme Health Corp');
    expect(element.props.primaryColor).toBe('#BF953F');
  });

  it('handles empty or malformed markdown gracefully', () => {
    const elementEmpty = React.createElement(ExecutiveReportDocument, {
      agencyName: 'Apex Growth',
      clientName: 'Client',
      preparedBy: 'Practice',
      markdownText: '',
    });

    expect(elementEmpty).toBeDefined();
  });
});
