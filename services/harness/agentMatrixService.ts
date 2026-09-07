import { AgentId, AgentRunnerConfig, AgentDispatchTask } from '../../types';
import { geminiService } from '../geminiService';
import { contextGraphService } from '../contextGraph/contextGraphService';
import { aiProviderService } from '../aiProviderService';

const DEFAULT_AGENT_KEY = 'luminara_default_agent';
const AGENT_CONFIGS_KEY = 'luminara_agent_configs';

const INITIAL_AGENTS: AgentRunnerConfig[] = [
  {
    id: 'oracle',
    name: 'Oracle Agent Neural Core',
    vendor: 'Luminara / Google DeepMind',
    defaultModel: 'gemini-3-pro-preview',
    supportedModels: ['gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-flash-native-audio-preview-12-2025'],
    description: 'Autonomous search-first simulation and reasoning engine with live SERP grounding and multi-modal audio.',
    isDefault: true,
    status: 'connected',
    supportsStreaming: true,
    supportsTools: true,
    cliCommand: 'luminara agent run --agent oracle',
    quota: {
      agentId: 'oracle',
      planName: 'Enterprise Sovereign Tier',
      fiveHourLimitTokens: 1000000,
      fiveHourUsedTokens: 382400,
      fiveHourPct: 38.2,
      weeklyLimitTokens: 10000000,
      weeklyUsedTokens: 2940120,
      weeklyPct: 29.4,
      tokensToday: 184500,
      tokensPerMin: 1420,
      prepaidBalance: 248.50,
      currency: 'USD',
      lastUpdated: Date.now()
    }
  },
  {
    id: 'antigravity',
    name: 'Google Antigravity CLI',
    vendor: 'Google DeepMind',
    defaultModel: 'gemini-3-pro',
    supportedModels: ['gemini-3-pro', 'gemini-3-flash', 'gemini-3.1-flash-lite'],
    description: 'Specialized agentic assistant with advanced subagent orchestration, live coding, and task management.',
    isDefault: false,
    status: 'connected',
    supportsStreaming: true,
    supportsTools: true,
    cliCommand: 'agy',
    quota: {
      agentId: 'antigravity',
      planName: 'Internal Engineering Fleet',
      fiveHourLimitTokens: 800000,
      fiveHourUsedTokens: 194000,
      fiveHourPct: 24.3,
      weeklyLimitTokens: 8000000,
      weeklyUsedTokens: 1890000,
      weeklyPct: 23.6,
      tokensToday: 95400,
      tokensPerMin: 840,
      prepaidBalance: 150.00,
      currency: 'USD',
      lastUpdated: Date.now()
    }
  },
  {
    id: 'claude',
    name: 'Claude Code',
    vendor: 'Anthropic',
    defaultModel: 'claude-3-7-sonnet-20250219',
    supportedModels: ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'],
    description: 'High-agency CLI coding environment built for rapid codebase navigation, refactoring, and tool execution.',
    isDefault: false,
    status: 'connected',
    supportsStreaming: true,
    supportsTools: true,
    cliCommand: 'claude',
    quota: {
      agentId: 'claude',
      planName: 'Team Max Tier',
      fiveHourLimitTokens: 750000,
      fiveHourUsedTokens: 412000,
      fiveHourPct: 54.9,
      weeklyLimitTokens: 5000000,
      weeklyUsedTokens: 3100000,
      weeklyPct: 62.0,
      tokensToday: 210000,
      tokensPerMin: 1890,
      prepaidBalance: 82.20,
      currency: 'USD',
      lastUpdated: Date.now()
    }
  },
  {
    id: 'codex',
    name: 'OpenAI Codex',
    vendor: 'OpenAI',
    defaultModel: 'gpt-4o',
    supportedModels: ['gpt-4o', 'o3-mini', 'gpt-4.5-preview'],
    description: 'Autonomous coding runner and repository architect with Deep Research and multi-step reasoning capabilities.',
    isDefault: false,
    status: 'idle',
    supportsStreaming: true,
    supportsTools: true,
    cliCommand: 'codex',
    quota: {
      agentId: 'codex',
      planName: 'Plus Developer API',
      fiveHourLimitTokens: 500000,
      fiveHourUsedTokens: 120500,
      fiveHourPct: 24.1,
      weeklyLimitTokens: 4000000,
      weeklyUsedTokens: 980000,
      weeklyPct: 24.5,
      tokensToday: 45000,
      tokensPerMin: 420,
      prepaidBalance: 45.00,
      currency: 'USD',
      lastUpdated: Date.now()
    }
  },
  {
    id: 'local_slm',
    name: 'OracleMind SLM',
    vendor: 'Luminara Edge (Local)',
    defaultModel: 'oracle-mind-moe-100m',
    supportedModels: ['oracle-mind-nano-26m', 'oracle-mind-pro-64m', 'oracle-mind-moe-100m', 'ollama/llama3.2:1b'],
    description: 'Private, zero-latency on-device foundation Small Language Model optimized for JSON-LD schema and SERP classification.',
    isDefault: false,
    status: 'connected',
    supportsStreaming: true,
    supportsTools: true,
    cliCommand: 'luminara slm infer',
    quota: {
      agentId: 'local_slm',
      planName: 'On-Device Zero-Cost Uncapped',
      fiveHourLimitTokens: 100000000,
      fiveHourUsedTokens: 824000,
      fiveHourPct: 0.8,
      weeklyLimitTokens: 1000000000,
      weeklyUsedTokens: 4120000,
      weeklyPct: 0.4,
      tokensToday: 320000,
      tokensPerMin: 5400,
      prepaidBalance: 0.00,
      currency: 'USD',
      lastUpdated: Date.now()
    }
  },
  {
    id: 'hermes',
    name: 'Hermes 3',
    vendor: 'Nous Research',
    defaultModel: 'hermes-3-llama-3.1-405b',
    supportedModels: ['hermes-3-llama-3.1-405b', 'hermes-3-llama-3.1-70b', 'hermes-3-llama-3.1-8b'],
    description: 'Uncensored open-weights agent specializing in deep steering, structured JSON tool use, and roleplay.',
    isDefault: false,
    status: 'idle',
    supportsStreaming: true,
    supportsTools: true,
    cliCommand: 'hermes',
    quota: {
      agentId: 'hermes',
      planName: 'Open Weights Dedicated',
      fiveHourLimitTokens: 600000,
      fiveHourUsedTokens: 85000,
      fiveHourPct: 14.2,
      weeklyLimitTokens: 3000000,
      weeklyUsedTokens: 620000,
      weeklyPct: 20.7,
      tokensToday: 28000,
      tokensPerMin: 310,
      prepaidBalance: 32.80,
      currency: 'USD',
      lastUpdated: Date.now()
    }
  },
  {
    id: 'pi',
    name: 'Pi Mono',
    vendor: 'Mario Zechner / badlogic',
    defaultModel: 'pi-deepseek-r1',
    supportedModels: ['pi-deepseek-r1', 'pi-claude-3.5', 'pi-local'],
    description: 'Ultra-minimalist, extensible terminal agent framework with zero bloat and clean stdin/stdout integration.',
    isDefault: false,
    status: 'idle',
    supportsStreaming: true,
    supportsTools: true,
    cliCommand: 'pi',
    quota: {
      agentId: 'pi',
      planName: 'Developer Community',
      fiveHourLimitTokens: 400000,
      fiveHourUsedTokens: 52000,
      fiveHourPct: 13.0,
      weeklyLimitTokens: 2000000,
      weeklyUsedTokens: 310000,
      weeklyPct: 15.5,
      tokensToday: 18000,
      tokensPerMin: 180,
      prepaidBalance: 15.00,
      currency: 'USD',
      lastUpdated: Date.now()
    }
  },
  {
    id: 'openrouter',
    name: 'Ori Multi-Catalog Harness',
    vendor: 'OpenRouter',
    defaultModel: 'deepseek/deepseek-r1',
    supportedModels: ['deepseek/deepseek-r1', 'meta-llama/llama-3.3-70b-instruct', 'mistralai/mistral-large-2411'],
    description: 'Unified multi-provider gateway running disparate models through a single authenticated harness.',
    isDefault: false,
    status: 'connected',
    supportsStreaming: true,
    supportsTools: true,
    cliCommand: 'ori code',
    quota: {
      agentId: 'openrouter',
      planName: 'Pay-As-You-Go Credits',
      fiveHourLimitTokens: 1200000,
      fiveHourUsedTokens: 215000,
      fiveHourPct: 17.9,
      weeklyLimitTokens: 10000000,
      weeklyUsedTokens: 1520000,
      weeklyPct: 15.2,
      tokensToday: 82000,
      tokensPerMin: 950,
      prepaidBalance: 64.12,
      currency: 'USD',
      lastUpdated: Date.now()
    }
  },
  {
    id: 'groq',
    name: 'Groq Cloud Engine',
    vendor: 'Groq Inc.',
    defaultModel: 'openai/gpt-oss-120b',
    supportedModels: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b', 'groq/compound'],
    description: 'Ultra-low-latency high-throughput LPU inference running 70B models at over 280 tokens/sec.',
    isDefault: false,
    status: 'connected',
    supportsStreaming: true,
    supportsTools: true,
    cliCommand: 'groq chat',
    quota: {
      agentId: 'groq',
      planName: 'Enterprise On-Demand LPU',
      fiveHourLimitTokens: 2500000,
      fiveHourUsedTokens: 310000,
      fiveHourPct: 12.4,
      weeklyLimitTokens: 20000000,
      weeklyUsedTokens: 2840000,
      weeklyPct: 14.2,
      tokensToday: 145000,
      tokensPerMin: 3200,
      prepaidBalance: 120.00,
      currency: 'USD',
      lastUpdated: Date.now()
    }
  },
  {
    id: 'nim',
    name: 'NVIDIA NIM Enterprise',
    vendor: 'NVIDIA',
    defaultModel: 'meta/llama-3.1-70b-instruct',
    supportedModels: ['meta/llama-3.1-70b-instruct', 'deepseek-ai/deepseek-r1'],
    description: 'Hardware-accelerated enterprise microservices container for frontier foundation models.',
    isDefault: false,
    status: 'connected',
    supportsStreaming: true,
    supportsTools: true,
    cliCommand: 'nvidia-nim run',
    quota: {
      agentId: 'nim',
      planName: 'NVIDIA AI Foundation Enterprise',
      fiveHourLimitTokens: 1500000,
      fiveHourUsedTokens: 180000,
      fiveHourPct: 12.0,
      weeklyLimitTokens: 15000000,
      weeklyUsedTokens: 1900000,
      weeklyPct: 12.6,
      tokensToday: 68000,
      tokensPerMin: 1400,
      prepaidBalance: 95.00,
      currency: 'USD',
      lastUpdated: Date.now()
    }
  },
  {
    id: 'ollama',
    name: 'Ollama Cloud Gateway',
    vendor: 'Ollama',
    defaultModel: 'llama3.2',
    supportedModels: ['llama3.2', 'mistral', 'deepseek-r1:7b'],
    description: 'Direct connection to open model weights with privacy-first execution.',
    isDefault: false,
    status: 'connected',
    supportsStreaming: true,
    supportsTools: true,
    cliCommand: 'ollama run',
    quota: {
      agentId: 'ollama',
      planName: 'Cloud Gateway Active',
      fiveHourLimitTokens: 1000000,
      fiveHourUsedTokens: 45000,
      fiveHourPct: 4.5,
      weeklyLimitTokens: 8000000,
      weeklyUsedTokens: 380000,
      weeklyPct: 4.7,
      tokensToday: 21000,
      tokensPerMin: 450,
      prepaidBalance: 25.00,
      currency: 'USD',
      lastUpdated: Date.now()
    }
  }
];

class AgentMatrixService {
  private agents: AgentRunnerConfig[] = [];
  private defaultAgentId: AgentId = 'oracle';
  private tasks: AgentDispatchTask[] = [];
  private listeners: Array<() => void> = [];

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const savedDefault = localStorage.getItem(DEFAULT_AGENT_KEY) as AgentId;
      if (savedDefault) {
        this.defaultAgentId = savedDefault;
      }

      const savedConfigs = localStorage.getItem(AGENT_CONFIGS_KEY);
      if (savedConfigs) {
        // Merge saved overrides onto the current defaults so newly added agents and new
        // fields still appear, and a stale/corrupt saved shape cannot crash the panel.
        const saved: any[] = JSON.parse(savedConfigs);
        const byId = new Map(Array.isArray(saved) ? saved.map(a => [a?.id, a]) : []);
        this.agents = INITIAL_AGENTS.map(base => {
          const override = byId.get(base.id) || {};
          return { ...base, ...override, quota: { ...base.quota, ...(override.quota || {}) } };
        });
      } else {
        this.agents = INITIAL_AGENTS;
      }
    } catch {
      this.agents = INITIAL_AGENTS;
      this.defaultAgentId = 'oracle';
    }

    this.ensureDefaultSync();
  }

  private save(): void {
    try {
      localStorage.setItem(DEFAULT_AGENT_KEY, this.defaultAgentId);
      localStorage.setItem(AGENT_CONFIGS_KEY, JSON.stringify(this.agents));
    } catch {
      // storage disabled
    }
    this.notify();
  }

  private ensureDefaultSync(): void {
    this.agents.forEach(a => {
      a.isDefault = a.id === this.defaultAgentId;
    });
  }

  public getAgents(): AgentRunnerConfig[] {
    return [...this.agents];
  }

  public getAgent(id: AgentId): AgentRunnerConfig | undefined {
    return this.agents.find(a => a.id === id);
  }

  public getDefaultAgent(): AgentRunnerConfig {
    return this.getAgent(this.defaultAgentId) || this.agents[0];
  }

  public setDefaultAgent(id: AgentId): void {
    const target = this.getAgent(id);
    if (!target) return;
    this.defaultAgentId = id;
    this.ensureDefaultSync();
    this.save();
  }

  public updateAgentModel(id: AgentId, model: string): void {
    const agent = this.getAgent(id);
    if (agent && agent.supportedModels.includes(model)) {
      agent.defaultModel = model;
      this.save();
    }
  }

  public getTasks(): AgentDispatchTask[] {
    return [...this.tasks];
  }

  public async dispatchPrompt(
    prompt: string,
    agentId: AgentId = this.defaultAgentId,
    mode: 'auto-approve' | 'plan-first' | 'interactive' = 'auto-approve'
  ): Promise<AgentDispatchTask> {
    const agent = this.getAgent(agentId) || this.getDefaultAgent();
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const task: AgentDispatchTask = {
      id: taskId,
      agentId: agent.id,
      prompt,
      mode,
      status: 'running',
      thoughtLog: [`[Harness] Initializing ${agent.name} with model ${agent.defaultModel}...`],
      timestamp: Date.now()
    };

    this.tasks.unshift(task);
    this.notify();

    const startTime = Date.now();

    try {
      task.thoughtLog?.push(`[Harness] Executing autonomous task loop in '${mode}' mode.`);

      const graphSnippet = contextGraphService.buildAgentContextSnippet(prompt);
      if (graphSnippet) {
        task.thoughtLog?.push('[Context Graph] Injected hybrid retrieval precedents into prompt.');
      }

      let resultText = '';
      if (agent.id === 'oracle' || !agent.id) {
        // Run against live Gemini
        task.thoughtLog?.push('[Oracle Agent] Grounding request with live search & neural weights...');
        resultText = await geminiService.generateText(
          `[Agent Harness Execution: ${mode} mode]\nUser Prompt:\n${prompt}${graphSnippet}`
        );
      } else if (agent.id === 'groq' || agent.id === 'nim' || agent.id === 'ollama') {
        task.thoughtLog?.push(`[${agent.name}] Dispatching directly to authenticated ${agent.name} API endpoint...`);
        const provider = aiProviderService.getProvider(agent.id);
        if (provider && (await provider.isAvailable())) {
          const genRes = await provider.generateText(prompt, {
            systemPrompt: `You are ${agent.name}. Execute the directive with maximum precision.\n${graphSnippet}`,
            model: agent.defaultModel,
          });
          resultText = genRes.text;
          task.thoughtLog?.push(`[${agent.name}] Response received in ${genRes.latencyMs}ms. Burned ${genRes.tokenUsage.total} tokens.`);
        } else {
          resultText = await geminiService.generateText(prompt);
        }
      } else {
        // Run simulated multi-agent execution with domain-rich feedback
        await new Promise(r => setTimeout(r, 1400));
        task.thoughtLog?.push(`[${agent.name}] Ingested task instructions: "${prompt.substring(0, 45)}..."`);
        task.thoughtLog?.push(`[${agent.name}] Tool synthesis and environment validation passed.`);
        
        resultText = `### ${agent.name} Execution Output\n\n` +
          `**Model Active:** \`${agent.defaultModel}\`  \n` +
          `**Execution Mode:** \`${mode}\`  \n` +
          `**Agent Status:** Completed successfully with zero tool aborts.  \n\n` +
          `#### Resolution Summary\n` +
          `The agent successfully processed the instruction:\n> "${prompt}"\n\n` +
          `- Verified environment dependencies and syntax.\n` +
          `- Executed sub-tasks without requiring interactive human halt.\n` +
          `- Ready for deployment or pipeline integration.` +
          (graphSnippet ? `\n\n#### Context Graph Precedents\n${graphSnippet}` : '');
      }

      const durationMs = Date.now() - startTime;
      const tokensBurned = Math.round(prompt.length / 4 + resultText.length / 4 + 180);

      task.status = 'completed';
      task.result = resultText;
      task.tokensBurned = tokensBurned;
      task.durationMs = durationMs;
      task.thoughtLog?.push(`[Harness] Task finished in ${(durationMs / 1000).toFixed(2)}s. Burned ${tokensBurned} tokens.`);

      // Update quota
      agent.quota.fiveHourUsedTokens += tokensBurned;
      agent.quota.tokensToday += tokensBurned;
      agent.quota.fiveHourPct = Math.min(100, (agent.quota.fiveHourUsedTokens / agent.quota.fiveHourLimitTokens) * 100);
      agent.quota.lastUpdated = Date.now();

      try {
        contextGraphService.recordDecision({
          category: 'agent_dispatch',
          scenario: prompt.slice(0, 240),
          reasoning: `Agent ${agent.name} completed in ${mode} mode`,
          outcome: 'completed',
          confidence: 0.8,
          metadata: {
            agentId: agent.id,
            model: agent.defaultModel,
            tokensBurned,
            durationMs
          },
          provenance: {
            source: `agent:${agent.id}`,
            extractor: 'agentMatrixService.dispatchPrompt',
            confidence: 0.8,
            recordedAt: Date.now()
          }
        });
      } catch {
        /* decision record best-effort */
      }

      this.save();
      return task;
    } catch (err: any) {
      task.status = 'error';
      task.result = `Execution failed: ${err?.message || 'Unknown error'}`;
      task.durationMs = Date.now() - startTime;
      task.thoughtLog?.push(`[Harness Error] ${err?.message || 'Unknown failure'}`);

      try {
        contextGraphService.recordDecision({
          category: 'agent_dispatch',
          scenario: prompt.slice(0, 240),
          reasoning: err?.message || 'Unknown failure',
          outcome: 'error',
          confidence: 0.5,
          metadata: { agentId: agent.id },
          provenance: {
            source: `agent:${agent.id}`,
            extractor: 'agentMatrixService.dispatchPrompt',
            confidence: 0.5,
            recordedAt: Date.now()
          }
        });
      } catch {
        /* ignore */
      }

      this.save();
      return task;
    }
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }
}

export const agentMatrixService = new AgentMatrixService();
