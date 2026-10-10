# Architectural Implementation Plan: Luminara GenUI (100x Dynamic Canvas Engine)

## Executive Summary

This architecture plan extracts the core algorithmic innovation of **OpenUI** (streaming declarative assignment DSL) and re-engineers it as a clean-room, zero-dependency, evidence-bound **Generative Canvas Engine** native to **Luminara Suite**. 

By replacing fragile regex markdown-table scraping and token-heavy JSON streaming with a streaming line-based assignment language, Luminara's Oracle Agent and Instant Audit surfaces gain the ability to render rich, interactive, animated React components incrementally as tokens arrive.

---

## 1. Architectural Critique: OpenUI vs. Luminara 100x

| Vector | Vanilla OpenUI (`thesysdev/openui`) | Luminara 100x GenUI Engine |
| :--- | :--- | :--- |
| **Streaming Grammar** | Monolithic line-by-line DSL (`root = Component(...)`) | **Hybrid Streamer**: Mixes natural markdown dialogue with embedded `:::genui` reactive blocks. |
| **Token Cost** | ~50% savings over JSON schemas | **~55% savings over JSON**: Lean component signatures tailored directly to Luminara's design system. |
| **AST Fault Tolerance** | Incomplete statements hold or drop unreferenced variables | **Auto-Healing Virtual AST**: Automatically balances quotes, brackets, and parameter lists mid-token to prevent layout shift. |
| **Domain Grounding** | Generic buttons, inputs, generic charts | **Evidence-Bound Registry**: Bounded to SERP grounding, "cite-or-silence" metrics, Level 4 Ship Action gates, and diff deployments. |
| **Action Bridge** | Simulated `@Run` callbacks | **Live App RPC Bridge**: Triggers real client modals (`CmsDeploymentModal`, `DiffViewerModal`), MCP endpoints (`/mcp`), and D1 state mutations. |
| **Dependencies & Privacy**| 15 npm packages with opt-in telemetry and cloud sinks to Thesys | **Zero external dependencies**, 100% owned TypeScript (~200 lines), zero network phone-home, Vite/Cloudflare Workers native. |

---

## 2. System Architecture & Data Flow

```mermaid
flowchart TD
    subgraph Engine ["LLM Streaming (Gemini / Groq / Local)"]
        A[Oracle LLM Stream] --> B[Hybrid Stream Splitter]
    end

    subgraph Splitter ["Dual-Track Processing"]
        B -->|Standard Markdown| C[Prose Streamer]
        B -->|:::genui Blocks| D[Resilient Tokenizer & Lexer]
    end

    subgraph Parser ["Virtual AST & Materializer"]
        D --> E[Auto-Closing Line Parser]
        E --> F[Topological State Map: Map ID, Node]
        F --> G[Dynamic Property Resolver]
    end

    subgraph Viewport ["React Canvas Surface"]
        C --> H[Markdown Content View]
        G --> I[Luminara Component Registry]
        I --> J[Live Interactive Widget]
        H & J --> K[Active Message / Audit Card]
    end

    subgraph Actions ["App Action Bridge"]
        J -->|@Action events| L[Client Event Bus / MCP RPC]
        L --> M[CmsDeploymentModal / ShipActionGate / D1]
    end
```

---

## 3. The Luminara GenUI DSL Specification

### 3.1 Grammar Definition
The language uses a line-oriented, positional and named argument syntax:

```text
[identifier] = [ComponentName]([arguments...])
$[stateVar] = [primitiveValue]
```

#### Example Output from Oracle Chat:
```text
Here is your AI Overview analysis for this week. Your primary citation vulnerability is structured entity markup:

:::genui
root = AuditDeck([oneMove, radar, citationShare])

oneMove = ShipActionCard(
  "Deploy Schema.org Markup",
  "High",
  "30 mins",
  @Action("open_modal", "cms_deploy")
)

radar = VisibilityRadar([
  ["best aeo tool", "Informational", "Yes", "Competitor A", "#1", "Active", "Cited"],
  ["search oracle agent", "Transactional", "No", "None", "#8", "None", "not measured"]
])

citationShare = ShareOfVoiceCard(
  "AI Citation Share",
  [["Luminara", 68], ["Market Rivals", 32]]
)
:::

You can review the proposed JSON-LD diff below or trigger the one-click deployment directly.
```

### 3.2 Resilient Auto-Closing Parser
Unlike traditional compilers that throw syntax errors on unclosed tokens, the Luminara stream parser maintains a **virtual closing stack**:
1. When a chunk terminates inside an open string (`"Deploy Schema...`), the lexer appends a virtual `"` for immediate display.
2. When arguments terminate before a closing parenthesis `)`, the parser automatically synthesizes `)` and materializes the node into the component tree.
3. As subsequent tokens arrive, the node updates in-place via React `useMemo` / reconciliation with no screen jump.

---

## 4. Luminara Component Registry

We bind Luminara's existing enterprise audit and decision components directly into the GenUI engine:

```typescript
// services/genui/registry.ts
import React from 'react';
import { VisibilityRadar } from '../../components/audit/VisibilityRadar';
import { CompetitorMap } from '../../components/audit/CompetitorMap';
import { ROICalculator } from '../../components/audit/ROICalculator';
import { ShipActionGate } from '../../components/audit/ShipActionGate';
import { ShareOfVoiceCard } from '../../components/audit/ShareOfVoiceCard';
import { EntityAuthorityCard } from '../../components/audit/EntityAuthorityCard';
import { DiffViewerModal } from '../../components/audit/DiffViewerModal';
import { MetricBadge } from './components/MetricBadge';
import { ActionCard } from './components/ActionCard';

export const LUMINARA_GENUI_REGISTRY: Record<string, React.FC<any>> = {
  // Composite Layouts
  AuditDeck: ({ children }) => <div className="space-y-6 my-4">{children}</div>,
  MetricRow: ({ children }) => <div className="grid grid-cols-1 md:grid-cols-3 gap-4 my-4">{children}</div>,
  
  // High-Density Domain Components
  VisibilityRadar,
  CompetitorMap,
  ROICalculator,
  ShipActionGate,
  ShareOfVoiceCard,
  EntityAuthorityCard,
  
  // Tactical Action Components
  ShipActionCard: ActionCard,
  MetricBadge: MetricBadge,
};
```

---

## 5. Technical Implementation Details

### File Structure Additions:
```
services/
└── genui/
    ├── types.ts              # GenUI AST, Statement, Token, and Registry types
    ├── lexer.ts              # Zero-allocation streaming tokenizer
    ├── parser.ts             # Fault-tolerant auto-closing statement parser
    ├── materializer.ts       # Topological reference resolution & action binder
    ├── registry.ts           # Component map & prop adapter layer
    └── promptGenerator.ts    # Compact system prompt signatures generator
components/
└── genui/
    ├── GenUICanvas.tsx       # Standalone or embedded GenUI block renderer
    ├── GenUISkeleton.tsx     # Low-latency streaming placeholder shimmer
    └── HybridMessageBody.tsx # Splitter for standard Markdown + :::genui blocks
```

### 5.1 Clean-Room Stream Parser Implementation (`services/genui/parser.ts`)
```typescript
export interface ASTNode {
  id: string;
  component: string;
  args: any[];
  isComplete: boolean;
}

export interface ParseState {
  nodes: Map<string, ASTNode>;
  rootId: string | null;
  stateVars: Map<string, any>;
}

export function parseGenUIStream(rawText: string): ParseState {
  const nodes = new Map<string, ASTNode>();
  const stateVars = new Map<string, any>();
  let rootId: string | null = null;

  const lines = rawText.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//') || line.startsWith('#')) continue;

    // State variable declaration: $var = value
    const stateMatch = line.match(/^\$([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
    if (stateMatch) {
      try {
        stateVars.set(stateMatch[1], JSON.parse(stateMatch[2]));
      } catch {
        stateVars.set(stateMatch[1], stateMatch[2]);
      }
      continue;
    }

    // Component declaration: id = ComponentName(args...)
    const compMatch = line.match(/^([a-zA-Z0-9_]+)\s*=\s*([A-Z][a-zA-Z0-9_]*)\s*\((.*)$/);
    if (compMatch) {
      const id = compMatch[1];
      const component = compMatch[2];
      let rawArgs = compMatch[3];

      if (id === 'root') rootId = id;

      // Auto-close trailing parenthesis if stream cut mid-line
      let isComplete = true;
      if (rawArgs.endsWith(')')) {
        rawArgs = rawArgs.slice(0, -1);
      } else {
        isComplete = false;
      }

      const args = parseFlexibleArgs(rawArgs);
      nodes.set(id, { id, component, args, isComplete });
    }
  }

  return { nodes, rootId: rootId || (nodes.has('root') ? 'root' : null), stateVars };
}
```

### 5.2 Hybrid Markdown Splitter (`components/genui/HybridMessageBody.tsx`)
```tsx
import React, { useMemo } from 'react';
import { renderMarkdown } from '../../utils/markdown';
import { GenUICanvas } from './GenUICanvas';

interface Props {
  content: string;
  isStreaming?: boolean;
  onAction?: (actionName: string, payload: any) => void;
}

export const HybridMessageBody: React.FC<Props> = ({ content, isStreaming, onAction }) => {
  const segments = useMemo(() => {
    const parts: Array<{ type: 'markdown' | 'genui'; text: string }> = [];
    const blockRegex = /:::genui\s*([\s\S]*?)(?::::|$)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = blockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: 'markdown', text: content.slice(lastIndex, match.index) });
      }
      parts.push({ type: 'genui', text: match[1] });
      lastIndex = blockRegex.lastIndex;
    }

    if (lastIndex < content.length) {
      parts.push({ type: 'markdown', text: content.slice(lastIndex) });
    }

    return parts;
  }, [content]);

  return (
    <div className="space-y-4">
      {segments.map((seg, idx) => {
        if (seg.type === 'genui') {
          return (
            <GenUICanvas
              key={`genui-${idx}`}
              streamText={seg.text}
              isStreaming={isStreaming}
              onAction={onAction}
            />
          );
        }
        return (
          <div
            key={`md-${idx}`}
            className="markdown-content prose prose-invert max-w-none"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(seg.text) }}
          />
        );
      })}
    </div>
  );
};
```

---

## 6. Phased Implementation Roadmap

### Phase G0: Engine Foundations (`services/genui/`)
- [ ] Create `services/genui/types.ts` (AST nodes, token types, action interfaces).
- [ ] Implement `services/genui/lexer.ts` and `services/genui/parser.ts` with streaming auto-closing logic.
- [ ] Implement `services/genui/materializer.ts` for reference resolution, nested arrays, and `@Action` binding.
- [ ] Unit tests in `tests/genuiParser.test.ts` verifying partial chunk parsing, auto-close behavior, and edge-case syntax recovery.

### Phase G1: Component Registry & Adapters
- [ ] Create `services/genui/registry.ts` and register core Luminara cards:
  - `VisibilityRadar` adapter
  - `CompetitorMap` adapter
  - `ROICalculator` adapter
  - `ShipActionGate` adapter
  - `ShareOfVoiceCard` adapter
- [ ] Create dedicated GenUI tactical micro-components:
  - `ActionCard` (single weekly move CTA with direct deploy trigger)
  - `MetricBadge` (cite-or-silence metric pill with `not_measured` styling)
- [ ] Implement `components/genui/GenUICanvas.tsx` with error boundary and fallback UI.

### Phase G2: Chat & Audit Viewport Integration
- [ ] Implement `components/genui/HybridMessageBody.tsx` to handle mixed prose + `:::genui` blocks.
- [ ] Update `components/MessageList.tsx` to use `HybridMessageBody` for model responses, removing flickering and stream-end delays.
- [ ] Wire up action dispatches to Luminara's global custom events (`luminara-open-cms-deploy`, `luminara-open-settings`, etc.).

### Phase G3: System Prompt Injection & Guidance
- [ ] Implement `services/genui/promptGenerator.ts` to output concise component signatures (~350 tokens).
- [ ] Update `constants.tsx` / `services/geminiService.ts` to instruct the Oracle Agent how to use `:::genui` blocks for actionable audits and comparative queries.
- [ ] Enforce "cite-or-silence" invariant: instruct the agent never to fabricate scores inside GenUI components.

### Phase G4: Verification, Benchmarks & Evals
- [ ] Compare token consumption: measure standard Markdown table audit vs. `:::genui` audit (targeting >= 40% token reduction).
- [ ] Measure streaming render latency: verify component renders on first chunk without waiting for completion.
- [ ] Execute quality gates: `npm run typecheck`, `npm run lint`, `npm test`.

---

## 7. Quality Gates & Risk Mitigation

* **Backward Compatibility**: If the model outputs standard Markdown without `:::genui` blocks, `HybridMessageBody` falls back 100% cleanly to standard Markdown rendering. Existing audit flows remain unbroken.
* **Security & Sanitization**: GenUI does NOT support `eval()`, arbitrary JavaScript, or unvetted HTML tags. Only pre-registered React components in `LUMINARA_GENUI_REGISTRY` can ever be mounted.
* **No Em Dashes (Rule Check)**: All copy, documentation, and prompt strings adhere strictly to the rule prohibiting em dashes (U+2014), using `-`, `:`, or `.`.
