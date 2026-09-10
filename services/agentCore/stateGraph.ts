/**
 * StateGraph: Lightweight, edge-native cyclic state machine
 * Clean-room adaptation of LangGraph principles for Cloudflare Workers & React
 * 
 * Features:
 * - Cyclic execution loops with safety limits (maxIterations)
 * - Dynamic conditional branching based on agent state
 * - Checkpointing of state at every step for time-travel & recovery
 * - Real-time event emission for non-developer UI transparency
 * - Zero external dependencies, pure TypeScript
 */

import {
  StateGraphNodeHandler,
  StateGraphCondition,
  StateGraphCheckpoint,
  AgentActivityEvent,
} from './types';

export const END_NODE = '__END__';

export class StateGraph<TContext extends Record<string, any>> {
  private nodes = new Map<string, { name: string; handler: StateGraphNodeHandler<TContext> }>();
  private edges = new Map<string, string>();
  private conditionalEdges = new Map<string, StateGraphCondition<TContext>>();
  private entryNode: string | null = null;
  private checkpoints: StateGraphCheckpoint<TContext>[] = [];

  constructor(private options: { maxIterations?: number; name?: string } = {}) {
    this.options.maxIterations = options.maxIterations ?? 25;
  }

  /**
   * Register an autonomous agent node
   */
  public addNode(
    id: string,
    name: string,
    handler: StateGraphNodeHandler<TContext>
  ): this {
    this.nodes.set(id, { name, handler });
    if (!this.entryNode) {
      this.entryNode = id;
    }
    return this;
  }

  /**
   * Set the initial entrypoint node
   */
  public setEntryPoint(id: string): this {
    if (!this.nodes.has(id)) {
      throw new Error(`Entrypoint node "${id}" must be registered first.`);
    }
    this.entryNode = id;
    return this;
  }

  /**
   * Add a deterministic edge from one node to another
   */
  public addEdge(fromId: string, toId: string): this {
    if (!this.nodes.has(fromId)) {
      throw new Error(`Source node "${fromId}" is not registered.`);
    }
    if (toId !== END_NODE && !this.nodes.has(toId)) {
      throw new Error(`Target node "${toId}" is not registered.`);
    }
    this.edges.set(fromId, toId);
    return this;
  }

  /**
   * Add dynamic conditional edge (e.g. if Critic rejects, loop back to Auditor)
   */
  public addConditionalEdge(
    fromId: string,
    condition: StateGraphCondition<TContext>
  ): this {
    if (!this.nodes.has(fromId)) {
      throw new Error(`Source node "${fromId}" is not registered.`);
    }
    this.conditionalEdges.set(fromId, condition);
    return this;
  }

  /**
   * Execute the graph starting from the entrypoint
   */
  public async run(
    initialContext: TContext,
    onEvent?: (event: AgentActivityEvent) => void
  ): Promise<{ finalContext: TContext; checkpoints: StateGraphCheckpoint<TContext>[] }> {
    if (!this.entryNode) {
      throw new Error('StateGraph has no entry node defined.');
    }

    let currentNodeId: string = this.entryNode;
    let context: TContext = { ...initialContext };
    let iteration = 0;
    this.checkpoints = [];

    const emit = (event: AgentActivityEvent) => {
      if (onEvent) {
        try {
          onEvent(event);
        } catch {
          /* observer errors must not crash state machine */
        }
      }
    };

    while (currentNodeId !== END_NODE && iteration < (this.options.maxIterations || 25)) {
      iteration++;
      const node = this.nodes.get(currentNodeId);
      if (!node) {
        break;
      }

      // Checkpoint before node execution
      this.checkpoints.push({
        nodeId: currentNodeId,
        iteration,
        timestamp: Date.now(),
        context: JSON.parse(JSON.stringify(context)),
      });

      try {
        const delta = await node.handler(context, emit);
        context = { ...context, ...delta };
      } catch (err: any) {
        const errorMsg = `Node "${currentNodeId}" failed: ${err?.message || String(err)}`;
        if (Array.isArray(context.errors)) {
          context.errors.push(errorMsg);
        }
        emit({
          id: `evt-err-${Date.now()}-${iteration}`,
          timestamp: Date.now(),
          agentRole: 'adversarial_critic',
          agentName: 'State Machine Monitor',
          phase: 'error_recovery',
          message: errorMsg,
          status: 'failed',
        });
      }

      // Determine next node
      if (this.conditionalEdges.has(currentNodeId)) {
        const conditionFn = this.conditionalEdges.get(currentNodeId)!;
        currentNodeId = await conditionFn(context);
      } else if (this.edges.has(currentNodeId)) {
        currentNodeId = this.edges.get(currentNodeId)!;
      } else {
        // No outgoing edge -> terminate
        currentNodeId = END_NODE;
      }
    }

    // Final checkpoint
    this.checkpoints.push({
      nodeId: END_NODE,
      iteration,
      timestamp: Date.now(),
      context: JSON.parse(JSON.stringify(context)),
    });

    return {
      finalContext: context,
      checkpoints: this.checkpoints,
    };
  }

  public getCheckpoints(): StateGraphCheckpoint<TContext>[] {
    return [...this.checkpoints];
  }
}
