import { HarnessCommand, VfsLayerType } from '../../../types';
import { vfsStorageService } from '../../vfs/vfsStorageService';
import { vfsRetrievalService } from '../../vfs/vfsRetrievalService';
import { vfsMemoryService } from '../../vfs/vfsMemoryService';
import { VfsCodeExporter } from '../../vfs/vfsCodeExporter';

export const vfsCommands: HarnessCommand[] = [
  {
    group: 'vfs',
    name: 'ls',
    summary: 'List contents of a Viking VFS directory with token footprints',
    args: '[uri] [--recursive] [--json]',
    examples: ['luminara vfs ls', 'luminara vfs ls viking://resources', 'luminara vfs ls viking:// --recursive --json'],
    execute: async (args, flags) => {
      const uri = args[0] || 'viking://';
      const recursive = !!flags.recursive;
      const entries = vfsStorageService.listDirectory(uri, recursive);

      if (flags.json) {
        return {
          command: `vfs ls ${uri}`,
          rawInput: `vfs ls ${args.join(' ')}`,
          status: 'success',
          format: 'json',
          executionTimeMs: 8,
          timestamp: Date.now(),
          output: JSON.stringify(entries, null, 2),
          structuredData: entries
        };
      }

      if (entries.length === 0) {
        return {
          command: `vfs ls ${uri}`,
          rawInput: `vfs ls ${args.join(' ')}`,
          status: 'info',
          format: 'text',
          executionTimeMs: 5,
          timestamp: Date.now(),
          output: `Directory ${uri} is empty or does not exist.`
        };
      }

      const lines = [
        `Luminara Viking VFS: Listing ${uri} (${entries.length} items)`,
        '----------------------------------------------------------------------------------------',
        `${'TYPE'.padEnd(10)} ${'TOKENS (L0/L1/L2)'.padEnd(20)} ${'URI'}`
      ];

      for (const e of entries) {
        const typeStr = e.isDir ? '<DIR>' : e.type;
        const tokenStr = e.isDir ? '-' : `${e.l0Tokens}/${e.l1Tokens}/${e.l2Tokens}`;
        lines.push(`${typeStr.padEnd(10)} ${tokenStr.padEnd(20)} ${e.uri}`);
      }

      return {
        command: `vfs ls ${uri}`,
        rawInput: `vfs ls ${args.join(' ')}`,
        status: 'success',
        format: 'text',
        executionTimeMs: 12,
        timestamp: Date.now(),
        output: lines.join('\n')
      };
    }
  },

  {
    group: 'vfs',
    name: 'tree',
    summary: 'Render hierarchical ASCII tree of Viking VFS namespaces',
    args: '[uri] [--depth=N]',
    examples: ['luminara vfs tree', 'luminara vfs tree viking://user --depth=4'],
    execute: async (args, flags) => {
      const rootUri = args[0] || 'viking://';
      const depth = flags.depth ? parseInt(flags.depth as string, 10) : 5;
      const rootNode = vfsStorageService.getTree(rootUri, depth);

      const lines: string[] = [`Luminara Viking VFS Hierarchy [${rootUri}]:`];

      const renderAscii = (node: any, prefix: string, isLast: boolean) => {
        const connector = isLast ? '└── ' : '├── ';
        const typeIndicator = node.isDir ? '📁' : '📄';
        const tokenInfo = !node.isDir ? ` (L0:${node.l0Tokens} | L1:${node.l1Tokens} | L2:${node.l2Tokens} | ${Math.max(0, node.savingsPct)}% savings)` : '';
        lines.push(`${prefix}${connector}${typeIndicator} ${node.name}${tokenInfo}`);

        const childPrefix = prefix + (isLast ? '    ' : '│   ');
        const children = node.children || [];
        children.forEach((child: any, idx: number) => {
          renderAscii(child, childPrefix, idx === children.length - 1);
        });
      };

      const children = rootNode.children || [];
      children.forEach((child: any, idx: number) => {
        renderAscii(child, '', idx === children.length - 1);
      });

      return {
        command: `vfs tree ${rootUri}`,
        rawInput: `vfs tree ${args.join(' ')}`,
        status: 'success',
        format: 'text',
        executionTimeMs: 15,
        timestamp: Date.now(),
        output: lines.join('\n')
      };
    }
  },

  {
    group: 'vfs',
    name: 'cat',
    summary: 'Read a file from Viking VFS at a specific resolution layer (L0, L1, or L2)',
    args: '<uri> [--layer=L0|L1|L2]',
    examples: [
      'luminara vfs cat viking://resources/schemas/faq_schema_template.jsonld',
      'luminara vfs cat viking://user/default/.memories/profiles/luminara_brand_dna.md --layer=L0'
    ],
    execute: async (args, flags) => {
      if (!args[0]) {
        return {
          command: 'vfs cat',
          rawInput: 'vfs cat',
          status: 'error',
          format: 'text',
          executionTimeMs: 2,
          timestamp: Date.now(),
          output: 'Usage: luminara vfs cat <uri> [--layer=L0|L1|L2]'
        };
      }

      const uri = args[0];
      const layer = ((flags.layer as string) || 'L1').toUpperCase() as VfsLayerType;
      const res = vfsStorageService.readLayer(uri, layer);

      if (!res) {
        return {
          command: `vfs cat ${uri}`,
          rawInput: `vfs cat ${args.join(' ')}`,
          status: 'error',
          format: 'text',
          executionTimeMs: 5,
          timestamp: Date.now(),
          output: `File ${uri} not found or is a directory.`
        };
      }

      return {
        command: `vfs cat ${uri} --layer=${layer}`,
        rawInput: `vfs cat ${args.join(' ')}`,
        status: 'success',
        format: 'text',
        executionTimeMs: 8,
        timestamp: Date.now(),
        output: `[VFS FILE: ${uri} | Layer: ${layer} | Tokens: ${res.tokenCount}]\n\n${res.content}`
      };
    }
  },

  {
    group: 'vfs',
    name: 'query',
    summary: 'Execute Directory Recursive Retrieval (DRR) with observable audit trajectory',
    args: '<query> [--budget=tokens] [--root=uri]',
    examples: [
      'luminara vfs query "Stripe AEO audit"',
      'luminara vfs query "competitor weaknesses" --budget=1200'
    ],
    execute: async (args, flags) => {
      const queryText = args.join(' ');
      if (!queryText) {
        return {
          command: 'vfs query',
          rawInput: 'vfs query',
          status: 'error',
          format: 'text',
          executionTimeMs: 2,
          timestamp: Date.now(),
          output: 'Usage: luminara vfs query <query_string> [--budget=tokens]'
        };
      }

      const budget = flags.budget ? parseInt(flags.budget as string, 10) : 2000;
      const root = flags.root ? (flags.root as string) : undefined;
      const result = vfsRetrievalService.retrieve(queryText, { tokenBudget: budget, rootUri: root });

      let out = `Directory Recursive Retrieval (DRR) Results for: "${queryText}"\n`;
      out += `Token Budget: ${result.tokenBudget} | Used: ${result.tokensUsed} | Token Savings: ${result.tokenSavingsPct}%\n`;
      out += `Matched Nodes: ${result.matchedItems.length} in ${result.executionTimeMs}ms\n\n`;
      
      out += '--- OBSERVABLE AUDIT TRAJECTORY ---\n';
      for (const step of result.trajectory) {
        const scoreStr = step.score !== undefined ? ` [score: ${step.score.toFixed(2)}]` : '';
        const layerStr = step.layerSelected ? ` [layer: ${step.layerSelected}]` : '';
        out += `[Step ${step.stepIndex}] ${step.action.toUpperCase()} -> ${step.targetUri}${scoreStr}${layerStr}: ${step.rationale}\n`;
      }

      out += '\n--- ASSEMBLED CONTEXT ---\n';
      out += result.assembledContext || 'No context matched threshold.';

      return {
        command: `vfs query "${queryText}"`,
        rawInput: `vfs query ${args.join(' ')}`,
        status: 'success',
        format: 'text',
        executionTimeMs: result.executionTimeMs,
        timestamp: Date.now(),
        output: out,
        structuredData: result
      };
    }
  },

  {
    group: 'vfs',
    name: 'find',
    summary: 'Find nodes matching a keyword across names, tags, and descriptions',
    args: '<keyword> [--root=uri]',
    examples: ['luminara vfs find schema', 'luminara vfs find competitor'],
    execute: async (args, flags) => {
      const q = args.join(' ');
      const root = flags.root ? (flags.root as string) : undefined;
      const matches = vfsStorageService.find(q, { rootUri: root });

      const lines = [`Found ${matches.length} matching nodes in Viking VFS for "${q}":\n`];
      for (const m of matches) {
        const desc = m.metadata.description ? ` - ${m.metadata.description}` : '';
        lines.push(`• [${m.type.toUpperCase()}] ${m.uri}${desc}`);
      }

      return {
        command: `vfs find "${q}"`,
        rawInput: `vfs find ${args.join(' ')}`,
        status: 'success',
        format: 'text',
        executionTimeMs: 10,
        timestamp: Date.now(),
        output: lines.join('\n'),
        structuredData: matches
      };
    }
  },

  {
    group: 'vfs',
    name: 'grep',
    summary: 'Search regex pattern inside file contents at L0, L1, or L2 layers',
    args: '<pattern> [--layer=L0|L1|L2]',
    examples: ['luminara vfs grep "citation" --layer=L1', 'luminara vfs grep "JSON-LD"'],
    execute: async (args, flags) => {
      const pattern = args[0];
      if (!pattern) {
        return {
          command: 'vfs grep',
          rawInput: 'vfs grep',
          status: 'error',
          format: 'text',
          executionTimeMs: 2,
          timestamp: Date.now(),
          output: 'Usage: luminara vfs grep <pattern> [--layer=L0|L1|L2]'
        };
      }

      const layer = ((flags.layer as string) || 'L2').toUpperCase() as VfsLayerType;
      const matches = vfsStorageService.grep(pattern, 'viking://', layer);

      const lines = [`Grep matches for /${pattern}/ across VFS at layer ${layer} (${matches.length} hits):\n`];
      for (const m of matches) {
        lines.push(`${m.uri}:${m.line} -> ${m.text}`);
      }

      return {
        command: `vfs grep "${pattern}"`,
        rawInput: `vfs grep ${args.join(' ')}`,
        status: 'success',
        format: 'text',
        executionTimeMs: 14,
        timestamp: Date.now(),
        output: lines.join('\n')
      };
    }
  },

  {
    group: 'vfs',
    name: 'mem',
    summary: 'Inspect or synchronize 6-category self-evolving agent memory',
    args: '[sync-dna|list]',
    examples: ['luminara vfs mem list', 'luminara vfs mem sync-dna'],
    execute: async (args) => {
      const action = args[0] || 'list';

      if (action === 'sync-dna') {
        let savedDna = null;
        try {
          const raw = localStorage.getItem('luminara_business_dna');
          if (raw) savedDna = JSON.parse(raw);
        } catch (e) {}

        if (!savedDna) {
          return {
            command: 'vfs mem sync-dna',
            rawInput: 'vfs mem sync-dna',
            status: 'info',
            format: 'text',
            executionTimeMs: 5,
            timestamp: Date.now(),
            output: 'No active Business DNA found in localStorage. Link DNA in Command Suite or run instant audit first.'
          };
        }

        const res = vfsMemoryService.syncFromBusinessDNA(savedDna);
        return {
          command: 'vfs mem sync-dna',
          rawInput: 'vfs mem sync-dna',
          status: 'success',
          format: 'text',
          executionTimeMs: 20,
          timestamp: Date.now(),
          output: `[MEMORY SYNC] Successfully synced Business DNA for "${savedDna.name}".\n- Synced Categories: ${res.syncedCategories.join(', ')}\n- Nodes Created/Updated: ${res.nodesCreated}\n- Total Long-Term Memory Items: ${res.itemsCount}`
        };
      }

      // List
      const items = vfsMemoryService.getMemoryItems();
      const lines = [
        `Viking VFS: 6-Category Self-Evolving Memories (${items.length} items)`,
        '----------------------------------------------------------------------------------------'
      ];

      for (const it of items) {
        lines.push(`• [${it.category.toUpperCase().padEnd(12)}] ${it.title} (${it.uri})`);
      }

      return {
        command: 'vfs mem list',
        rawInput: 'vfs mem list',
        status: 'success',
        format: 'text',
        executionTimeMs: 10,
        timestamp: Date.now(),
        output: lines.join('\n'),
        structuredData: items
      };
    }
  },

  {
    group: 'vfs',
    name: 'stat',
    summary: 'Display overall VFS statistics, namespace breakdown, and token savings %',
    args: '[--json]',
    examples: ['luminara vfs stat', 'luminara vfs stat --json'],
    execute: async (_, flags) => {
      const stats = vfsStorageService.getTreeSummary();
      if (flags.json) {
        return {
          command: 'vfs stat',
          rawInput: 'vfs stat --json',
          status: 'success',
          format: 'json',
          executionTimeMs: 6,
          timestamp: Date.now(),
          output: JSON.stringify(stats, null, 2),
          structuredData: stats
        };
      }

      const out = `
╔══════════════════════════════════════════════════════════════════════╗
║               LUMINARA VIKING CONTEXT VFS TELEMETRY                 ║
╚══════════════════════════════════════════════════════════════════════╝
Total Indexed Nodes       : ${stats.totalNodes} (${stats.totalDirectories} dirs, ${stats.totalFiles} files)
Overall Token Savings %   : ${stats.overallTokenSavingsPct}% vs Flat L2 RAG
Multi-Resolution Footprint:
  • L0 Abstract Layer     : ${stats.totalL0Tokens.toLocaleString()} tokens
  • L1 Overview Layer     : ${stats.totalL1Tokens.toLocaleString()} tokens
  • L2 Raw Full Detail    : ${stats.totalL2Tokens.toLocaleString()} tokens
Namespace Breakdown:
  • .memories/ (6-Cat)   : ${stats.namespaces.memories} nodes
  • resources/ (Audits)   : ${stats.namespaces.resources} nodes
  • skills/ (Agent Tools) : ${stats.namespaces.skills} nodes
  • sessions/ (Scratch)   : ${stats.namespaces.sessions} nodes
`.trim();

      return {
        command: 'vfs stat',
        rawInput: 'vfs stat',
        status: 'success',
        format: 'text',
        executionTimeMs: 8,
        timestamp: Date.now(),
        output: out
      };
    }
  },

  {
    group: 'vfs',
    name: 'export',
    summary: 'Export clean-room standalone Python package or JSON snapshot',
    args: '[--format=json|python]',
    examples: ['luminara vfs export', 'luminara vfs export --format=python'],
    execute: async (_, flags) => {
      const format = (flags.format as string) || 'json';

      if (format === 'python') {
        const files = VfsCodeExporter.generatePythonCodebase();
        return {
          command: 'vfs export --format=python',
          rawInput: 'vfs export --format=python',
          status: 'success',
          format: 'text',
          executionTimeMs: 18,
          timestamp: Date.now(),
          output: `[STANDALONE PYTHON EXPORT] Generated ${files.length} clean-room Python package files in 'luminara_viking/':\n` +
            files.map(f => `  • ${f.path} (${f.description})`).join('\n') +
            '\n\nNavigate to Archy Harness -> Context VFS -> Python Exporter to download ZIP or preview code.'
        };
      }

      const json = vfsStorageService.exportJson();
      return {
        command: 'vfs export --format=json',
        rawInput: 'vfs export --format=json',
        status: 'success',
        format: 'json',
        executionTimeMs: 12,
        timestamp: Date.now(),
        output: json
      };
    }
  }
];
