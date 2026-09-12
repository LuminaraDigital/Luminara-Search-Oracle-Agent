import { 
  HarnessCommand, 
  HarnessCommandGroup, 
  CommandExecutionResult, 
  HarnessCommandMetadata
} from '../../types';
import { vfsCommands, kgCommands, createCoreCommands } from './commands';

export const COMMAND_GROUPS: HarnessCommandGroup[] = [
  { id: 'vfs', name: 'Viking Context VFS', description: 'Hierarchical context database, L0/L1/L2 layers, and recursive retrieval', icon: 'Folder' },
  { id: 'kg', name: 'Context Graph', description: 'Entity graph, decision provenance, AEO rules, and hybrid VFS retrieval', icon: 'Network' },
  { id: 'audit', name: 'Search & AEO Audit', description: 'Run real-time SERP scans, AEO rankings, and schema checks', icon: 'Radar' },
  { id: 'agent', name: 'Multi-Agent Matrix', description: 'Manage AI agent fleet, quotas, defaults, and task runners', icon: 'Terminal' },
  { id: 'slm', name: 'OracleMind SLM Studio', description: 'Edge Small Language Model training, LoRA, and PyTorch export', icon: 'Brain' },
  { id: 'forecast', name: 'TimesFM Forecaster', description: 'Zero-shot foundation forecasting, quantiles, and what-if shocks', icon: 'TimeSeries' },
  { id: 'dna', name: 'Strategic Business DNA', description: 'Genome extraction, brand alignment, and persistent context', icon: 'DNA' },
  { id: 'theme', name: 'Omakase Theming', description: 'Luxury palette manager, live CSS styling, and visual presets', icon: 'Sparkle' },
  { id: 'test', name: 'Testing & Verification', description: 'Automated test harness for CLI, agents, neural SLM, and SERP', icon: 'Shield' },
  { id: 'reminder', name: 'Reminders & Schedulers', description: 'Set desktop timers, scheduled audits, and alarms', icon: 'Clock' },
  { id: 'system', name: 'System & Diagnostics', description: 'System telemetry, backups, API keys, and refresh recovery', icon: 'Settings' },
];

class CommandRouterService {
  private commands: HarnessCommand[] = [];

  constructor() {
    this.registerCommands();
  }

  private registerCommands(): void {
    const core = createCoreCommands(
      () => this.getAllMetadata(),
      () => this.getGroups()
    );
    for (const cmd of core) {
      this.register(cmd);
    }
    for (const cmd of vfsCommands) {
      this.register(cmd);
    }
    for (const cmd of kgCommands) {
      this.register(cmd);
    }
  }

  public register(cmd: HarnessCommand): void {
    this.commands.push(cmd);
  }

  public getGroups(): HarnessCommandGroup[] {
    return COMMAND_GROUPS;
  }

  public getAllCommands(): HarnessCommand[] {
    return [...this.commands];
  }

  public getAllMetadata(): HarnessCommandMetadata[] {
    return this.commands.map(c => ({
      group: c.group,
      name: c.name,
      summary: c.summary,
      args: c.args,
      examples: c.examples,
      aliases: c.aliases,
      hidden: c.hidden,
      requiresKey: c.requiresKey
    }));
  }

  public findCommand(group: string, name: string): HarnessCommand | undefined {
    return this.commands.find(c => 
      c.group.toLowerCase() === group.toLowerCase() && 
      (c.name.toLowerCase() === name.toLowerCase() || (c.aliases && c.aliases.includes(name.toLowerCase())))
    );
  }

  public async executeCommandLine(line: string): Promise<CommandExecutionResult> {
    const trimmed = line.trim();
    if (!trimmed) {
      return {
        command: '',
        rawInput: '',
        status: 'info',
        output: 'Type "luminara commands" or "help" to view all available commands.',
        format: 'text',
        executionTimeMs: 0,
        timestamp: Date.now()
      };
    }

    // Strip optional leading 'luminara '
    const clean = trimmed.startsWith('luminara ') ? trimmed.slice(9).trim() : trimmed;

    // Tokenize
    const tokens = this.tokenize(clean);
    if (tokens.length === 0) {
      return this.executeCommandLine('');
    }

    // Handle top level 'commands' or 'help'
    if (tokens[0] === 'commands' || tokens[0] === 'help') {
      const isJson = tokens.includes('--json');
      const cmd = this.findCommand('system', 'commands');
      return cmd ? cmd.execute([], { json: isJson }) : this.executeCommandLine('');
    }

    const group = tokens[0];
    const action = tokens[1] || 'help';

    // Parse flags and positional args
    const args: string[] = [];
    const flags: Record<string, string | boolean> = {};

    for (let i = 2; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok.startsWith('--')) {
        const flagPart = tok.slice(2);
        if (flagPart.includes('=')) {
          const [k, v] = flagPart.split('=');
          flags[k] = v;
        } else {
          flags[flagPart] = true;
        }
      } else {
        args.push(tok);
      }
    }

    const cmd = this.findCommand(group, action);
    if (!cmd) {
      // Look for action if only one word provided
      const potentialMatch = this.commands.find(c => c.name.toLowerCase() === group.toLowerCase());
      if (potentialMatch) {
        return potentialMatch.execute(tokens.slice(1), flags);
      }

      return {
        command: clean,
        rawInput: line,
        status: 'error',
        output: `Unknown command: "luminara ${group} ${action}". Run "luminara commands" for the complete index.`,
        format: 'text',
        executionTimeMs: 2,
        timestamp: Date.now()
      };
    }

    try {
      const start = Date.now();
      const res = await cmd.execute(args, flags);
      res.executionTimeMs = Date.now() - start;
      return res;
    } catch (err: any) {
      return {
        command: `${group} ${action}`,
        rawInput: line,
        status: 'error',
        output: `Error executing command: ${err?.message || 'Unknown error'}`,
        format: 'text',
        executionTimeMs: 10,
        timestamp: Date.now()
      };
    }
  }

  public searchCommands(query: string): HarnessCommandMetadata[] {
    if (!query.trim()) return this.getAllMetadata().slice(0, 15);
    const q = query.toLowerCase();
    return this.getAllMetadata().filter(c => 
      c.name.toLowerCase().includes(q) ||
      c.group.toLowerCase().includes(q) ||
      c.summary.toLowerCase().includes(q) ||
      (c.aliases && c.aliases.some(a => a.toLowerCase().includes(q)))
    );
  }

  private tokenize(str: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if ((ch === '"' || ch === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = ch;
      } else if (ch === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = '';
      } else if (ch === ' ' && !inQuotes) {
        if (current) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }
}

export const commandRouterService = new CommandRouterService();
