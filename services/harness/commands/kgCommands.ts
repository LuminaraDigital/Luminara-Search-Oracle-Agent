import { HarnessCommand } from '../../../types';
import { contextGraphService } from '../../contextGraph/contextGraphService';

export const kgCommands: HarnessCommand[] = [
  {
    group: 'kg',
    name: 'sync',
    summary: 'Sync Business DNA and VFS entities into the Luminara Context Graph',
    examples: ['luminara kg sync'],
    execute: async () => {
      const start = Date.now();
      const res = contextGraphService.syncFromDna();
      return {
        command: 'kg sync',
        rawInput: 'kg sync',
        status: res.ok ? 'success' : 'error',
        output: res.message,
        format: 'text',
        executionTimeMs: Date.now() - start,
        timestamp: Date.now(),
        structuredData: res.ok ? { nodes: res.nodes?.length, edges: res.edgesCreated } : undefined
      };
    }
  },

  {
    group: 'kg',
    name: 'ingest',
    summary: 'Ingest last Instant Audit report into the context graph',
    args: '[audit]',
    examples: ['luminara kg ingest audit'],
    aliases: ['ingest-audit'],
    execute: async (args) => {
      const start = Date.now();
      if (args[0] && args[0] !== 'audit') {
        return {
          command: 'kg ingest',
          rawInput: `kg ingest ${args.join(' ')}`,
          status: 'error',
          output: 'Usage: luminara kg ingest audit',
          format: 'text',
          executionTimeMs: Date.now() - start,
          timestamp: Date.now()
        };
      }
      const res = contextGraphService.ingestAudit();
      return {
        command: 'kg ingest audit',
        rawInput: 'kg ingest audit',
        status: res.ok ? 'success' : 'error',
        output: res.message,
        format: 'text',
        executionTimeMs: Date.now() - start,
        timestamp: Date.now()
      };
    }
  },

  {
    group: 'kg',
    name: 'node',
    summary: 'List, get, or expand neighbors for graph nodes',
    args: 'list|get|neighbors [id_or_query] [--hops=1]',
    examples: ['luminara kg node list', 'luminara kg node get org_acme', 'luminara kg node neighbors org_acme --hops=2'],
    execute: async (args, flags) => {
      const start = Date.now();
      const action = args[0] || 'list';
      const target = args.slice(1).join(' ');
      if (action === 'list') {
        const nodes = target
          ? contextGraphService.findNodes(target)
          : contextGraphService.listNodes();
        const lines = nodes.slice(0, 50).map(n => `${n.type.padEnd(12)} ${n.id}  ${n.label}`);
        return {
          command: 'kg node list',
          rawInput: `kg node ${args.join(' ')}`,
          status: 'success',
          output: lines.length ? lines.join('\n') : 'No nodes found.',
          format: 'text',
          executionTimeMs: Date.now() - start,
          timestamp: Date.now(),
          structuredData: nodes
        };
      }
      if (action === 'get') {
        const node = contextGraphService.getNode(target) || contextGraphService.findNodes(target)[0];
        if (!node) {
          return {
            command: 'kg node get',
            rawInput: `kg node get ${target}`,
            status: 'error',
            output: `Node not found: ${target}`,
            format: 'text',
            executionTimeMs: Date.now() - start,
            timestamp: Date.now()
          };
        }
        return {
          command: 'kg node get',
          rawInput: `kg node get ${target}`,
          status: 'success',
          output: JSON.stringify(node, null, 2),
          format: 'json',
          executionTimeMs: Date.now() - start,
          timestamp: Date.now(),
          structuredData: node
        };
      }
      if (action === 'neighbors') {
        const node = contextGraphService.getNode(target) || contextGraphService.findNodes(target)[0];
        if (!node) {
          return {
            command: 'kg node neighbors',
            rawInput: `kg node neighbors ${target}`,
            status: 'error',
            output: `Node not found: ${target}`,
            format: 'text',
            executionTimeMs: Date.now() - start,
            timestamp: Date.now()
          };
        }
        const hops = Number(flags.hops) || 1;
        const nb = contextGraphService.getNeighbors(node.id, hops);
        return {
          command: 'kg node neighbors',
          rawInput: `kg node neighbors ${target}`,
          status: 'success',
          output: JSON.stringify({ root: node.id, hops, ...nb }, null, 2),
          format: 'json',
          executionTimeMs: Date.now() - start,
          timestamp: Date.now(),
          structuredData: nb
        };
      }
      return {
        command: 'kg node',
        rawInput: `kg node ${args.join(' ')}`,
        status: 'error',
        output: 'Usage: kg node list|get|neighbors [id]',
        format: 'text',
        executionTimeMs: Date.now() - start,
        timestamp: Date.now()
      };
    }
  },

  {
    group: 'kg',
    name: 'edge',
    summary: 'Add a typed edge between two graph nodes',
    args: 'add <fromId> <toId> <edgeType>',
    examples: ['luminara kg edge add org_a org_b competes_with'],
    execute: async (args) => {
      const start = Date.now();
      if (args[0] !== 'add' || args.length < 4) {
        return {
          command: 'kg edge',
          rawInput: `kg edge ${args.join(' ')}`,
          status: 'error',
          output: 'Usage: luminara kg edge add <fromId> <toId> <edgeType>',
          format: 'text',
          executionTimeMs: Date.now() - start,
          timestamp: Date.now()
        };
      }
      const edge = contextGraphService.addEdge(args[1], args[2], args[3] as any);
      return {
        command: 'kg edge add',
        rawInput: `kg edge ${args.join(' ')}`,
        status: edge ? 'success' : 'error',
        output: edge ? JSON.stringify(edge, null, 2) : 'Failed: nodes missing or invalid edge type.',
        format: edge ? 'json' : 'text',
        executionTimeMs: Date.now() - start,
        timestamp: Date.now()
      };
    }
  },

  {
    group: 'kg',
    name: 'decision',
    summary: 'Record, list, trace, or find similar decisions',
    args: 'record|list|trace|similar ...',
    examples: [
      'luminara kg decision list',
      'luminara kg decision similar "loan approval"',
      'luminara kg decision trace decision_abc'
    ],
    execute: async (args) => {
      const start = Date.now();
      const action = args[0] || 'list';
      if (action === 'list') {
        const list = contextGraphService.listDecisions();
        return {
          command: 'kg decision list',
          rawInput: 'kg decision list',
          status: 'success',
          output: list.length
            ? list.map(d => `${d.id}  [${d.category}] ${d.outcome} (${(d.confidence * 100).toFixed(0)}%)`).join('\n')
            : 'No decisions recorded.',
          format: 'text',
          executionTimeMs: Date.now() - start,
          timestamp: Date.now(),
          structuredData: list
        };
      }
      if (action === 'record') {
        const scenario = args.slice(1).join(' ') || 'CLI recorded decision';
        const d = contextGraphService.recordDecision({
          category: 'cli',
          scenario,
          reasoning: 'Recorded via luminara kg decision record',
          outcome: 'recorded',
          confidence: 0.8
        });
        return {
          command: 'kg decision record',
          rawInput: `kg decision record ${scenario}`,
          status: 'success',
          output: JSON.stringify(d, null, 2),
          format: 'json',
          executionTimeMs: Date.now() - start,
          timestamp: Date.now(),
          structuredData: d
        };
      }
      if (action === 'trace') {
        const id = args[1];
        if (!id) {
          return {
            command: 'kg decision trace',
            rawInput: 'kg decision trace',
            status: 'error',
            output: 'Usage: luminara kg decision trace <id>',
            format: 'text',
            executionTimeMs: Date.now() - start,
            timestamp: Date.now()
          };
        }
        const chain = contextGraphService.traceDecision(id);
        return {
          command: 'kg decision trace',
          rawInput: `kg decision trace ${id}`,
          status: 'success',
          output: JSON.stringify(chain, null, 2),
          format: 'json',
          executionTimeMs: Date.now() - start,
          timestamp: Date.now(),
          structuredData: chain
        };
      }
      if (action === 'similar') {
        const q = args.slice(1).join(' ') || 'audit';
        const sims = contextGraphService.similarDecisions(q);
        return {
          command: 'kg decision similar',
          rawInput: `kg decision similar ${q}`,
          status: 'success',
          output: JSON.stringify(sims, null, 2),
          format: 'json',
          executionTimeMs: Date.now() - start,
          timestamp: Date.now(),
          structuredData: sims
        };
      }
      return {
        command: 'kg decision',
        rawInput: `kg decision ${args.join(' ')}`,
        status: 'error',
        output: 'Usage: kg decision record|list|trace|similar',
        format: 'text',
        executionTimeMs: Date.now() - start,
        timestamp: Date.now()
      };
    }
  },

  {
    group: 'kg',
    name: 'query',
    summary: 'Hybrid retrieve across context graph nodes and VFS DRR',
    args: '<text>',
    examples: ['luminara kg query "competitor AEO citation"'],
    execute: async (args) => {
      const start = Date.now();
      const q = args.join(' ') || 'brand';
      const res = contextGraphService.query(q);
      return {
        command: 'kg query',
        rawInput: `kg query ${q}`,
        status: 'success',
        output: res.assembledContext || 'No hits.',
        format: 'text',
        executionTimeMs: Date.now() - start,
        timestamp: Date.now(),
        structuredData: res
      };
    }
  },

  {
    group: 'kg',
    name: 'conflicts',
    summary: 'Detect conflicting facts across DNA and graph sources',
    examples: ['luminara kg conflicts'],
    execute: async () => {
      const start = Date.now();
      const conflicts = contextGraphService.detectConflicts();
      return {
        command: 'kg conflicts',
        rawInput: 'kg conflicts',
        status: 'success',
        output: conflicts.length
          ? conflicts.map(c => `[${c.severity}] ${c.message}`).join('\n')
          : 'No conflicts detected.',
        format: 'text',
        executionTimeMs: Date.now() - start,
        timestamp: Date.now(),
        structuredData: conflicts
      };
    }
  },

  {
    group: 'kg',
    name: 'rules',
    summary: 'Run AEO policy rules against the context graph',
    args: 'run',
    examples: ['luminara kg rules run'],
    execute: async () => {
      const start = Date.now();
      const findings = contextGraphService.runAeoRules();
      return {
        command: 'kg rules run',
        rawInput: 'kg rules run',
        status: 'success',
        output: findings.length
          ? findings.map(f => `[${f.severity}] ${f.name}: ${f.message}\n  -> ${f.recommendation}`).join('\n\n')
          : 'No AEO rule findings.',
        format: 'text',
        executionTimeMs: Date.now() - start,
        timestamp: Date.now(),
        structuredData: findings
      };
    }
  },

  {
    group: 'kg',
    name: 'export',
    summary: 'Export Organization JSON-LD or provenance JSON',
    args: 'jsonld|prov',
    examples: ['luminara kg export jsonld', 'luminara kg export prov'],
    execute: async (args) => {
      const start = Date.now();
      const kind = args[0] || 'jsonld';
      const output =
        kind === 'prov'
          ? contextGraphService.exportProvenance()
          : kind === 'full'
            ? contextGraphService.exportFull()
            : contextGraphService.exportJsonLd();
      return {
        command: `kg export ${kind}`,
        rawInput: `kg export ${kind}`,
        status: 'success',
        output,
        format: 'json',
        executionTimeMs: Date.now() - start,
        timestamp: Date.now()
      };
    }
  },

  {
    group: 'kg',
    name: 'stats',
    summary: 'Show context graph node, edge, decision, and conflict counts',
    examples: ['luminara kg stats'],
    execute: async () => {
      const start = Date.now();
      const stats = contextGraphService.getStats();
      return {
        command: 'kg stats',
        rawInput: 'kg stats',
        status: 'success',
        output: JSON.stringify(stats, null, 2),
        format: 'json',
        executionTimeMs: Date.now() - start,
        timestamp: Date.now(),
        structuredData: stats
      };
    }
  }
];
