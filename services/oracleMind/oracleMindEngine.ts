import type {
  OracleMindConfig,
  LoRAAdapter,
  GenerationParams,
  GenerationResult,
  ExpertActivation
} from '../../types';

export interface AttentionHeadStats {
  headIndex: number;
  entropy: number;
  sparsity: number;
  dominantTokens: string[];
}

export interface MoERouterDecision {
  tokenIndex: number;
  token: string;
  selectedExperts: { expertId: number; weight: number; name: string }[];
}

export class OracleMindMathEngine {
  /**
   * Root Mean Square Normalization (RMSNorm)
   * Formula: x_norm = (x / sqrt(mean(x^2) + eps)) * gamma
   */
  public static computeRMSNorm(x: number[], gamma: number[] = [], eps: number = 1e-6): number[] {
    const dim = x.length;
    if (dim === 0) return [];
    
    let sumSq = 0;
    for (let i = 0; i < dim; i++) {
      sumSq += x[i] * x[i];
    }
    const rms = Math.sqrt(sumSq / dim + eps);
    
    const out = new Array(dim);
    for (let i = 0; i < dim; i++) {
      const g = gamma.length > i ? gamma[i] : 1.0;
      out[i] = (x[i] / rms) * g;
    }
    return out;
  }

  /**
   * Rotary Positional Embeddings (RoPE) with YaRN Context Extension
   * Precomputes frequency cis angles across sequence positions.
   */
  public static computeRoPEFrequencies(
    dim: number,
    seqLen: number,
    base: number = 1e6,
    yarnFactor: number = 1.0
  ): { cos: number[][]; sin: number[][] } {
    const halfDim = Math.floor(dim / 2);
    const cos: number[][] = [];
    const sin: number[][] = [];

    const freqs: number[] = new Array(halfDim);
    for (let i = 0; i < halfDim; i++) {
      const exponent = (2 * i) / dim;
      freqs[i] = 1.0 / Math.pow(base, exponent) / yarnFactor;
    }

    for (let pos = 0; pos < seqLen; pos++) {
      const cosRow = new Array(halfDim);
      const sinRow = new Array(halfDim);
      for (let i = 0; i < halfDim; i++) {
        const angle = pos * freqs[i];
        cosRow[i] = Math.cos(angle);
        sinRow[i] = Math.sin(angle);
      }
      cos.push(cosRow);
      sin.push(sinRow);
    }

    return { cos, sin };
  }

  /**
   * SwiGLU Gated Feed-Forward Network
   * Formula: SwiGLU(x) = (x * W_gate * sigmoid(x * W_gate)) * (x * W_up) * W_down
   */
  public static swiglu(x: number): number {
    // SiLU / Swish activation: silu(x) = x / (1 + exp(-x))
    const silu = x / (1 + Math.exp(-Math.max(-50, Math.min(50, x))));
    return silu;
  }

  /**
   * Grouped Query Attention (GQA) Memory & KV-Cache Footprint
   * Calculates runtime RAM consumption for KV-cache across layers.
   */
  public static calculateKVCacheMemoryMb(
    numLayers: number,
    numKvHeads: number,
    headDim: number,
    seqLen: number,
    bytesPerFloat: number = 2 // fp16 / bf16
  ): number {
    // 2 buffers (K and V) * layers * kv_heads * head_dim * seq_len * precision
    const totalBytes = 2 * numLayers * numKvHeads * headDim * seqLen * bytesPerFloat;
    return Number((totalBytes / (1024 * 1024)).toFixed(3));
  }

  /**
   * Mixture of Experts (MoE) Routing & Load-Balancing Loss
   * Selects Top-K experts from router logits and calculates auxiliary balance loss.
   */
  public static routeExperts(
    routerLogits: number[],
    topK: number = 1,
    expertNames: string[] = []
  ): {
    selected: { expertId: number; weight: number; name: string }[];
    auxiliaryLoss: number;
  } {
    const numExperts = routerLogits.length;
    // Softmax over router logits
    const maxLogit = Math.max(...routerLogits);
    const exps = routerLogits.map(l => Math.exp(l - maxLogit));
    const sumExp = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map(e => e / (sumExp || 1e-6));

    // Sort by descending probability
    const indexed = probs.map((prob, idx) => ({ idx, prob }));
    indexed.sort((a, b) => b.prob - a.prob);

    const chosen = indexed.slice(0, Math.min(topK, numExperts));
    const topSum = chosen.reduce((acc, c) => acc + c.prob, 0);

    const selected = chosen.map(c => ({
      expertId: c.idx,
      weight: Number((c.prob / (topSum || 1)).toFixed(4)),
      name: expertNames[c.idx] || `Expert-${c.idx}`
    }));

    // Auxiliary load balancing loss: L_aux = numExperts * sum(f_i * P_i)
    // where f_i is empirical frequency (here uniform expectation) and P_i is router prob
    let auxLoss = 0;
    const uniformFreq = 1.0 / numExperts;
    for (let i = 0; i < numExperts; i++) {
      auxLoss += uniformFreq * probs[i];
    }
    auxLoss = Number((numExperts * auxLoss * 0.01).toFixed(5));

    return { selected, auxiliaryLoss: auxLoss };
  }

  /**
   * LoRA Parameter-Efficient Update Simulation
   * h = W_0 * x + (alpha / rank) * (B * A * x)
   */
  public static computeLoRAScaling(rank: number, alpha: number): number {
    if (rank <= 0) return 0;
    return alpha / rank;
  }

  /**
   * Group Relative Policy Optimization (GRPO) Relative Advantage
   * Advantage_i = (Reward_i - mean(R)) / (std(R) + eps)
   */
  public static computeGRPOAdvantages(rewards: number[]): number[] {
    const n = rewards.length;
    if (n === 0) return [];
    if (n === 1) return [0];

    const mean = rewards.reduce((sum, r) => sum + r, 0) / n;
    const variance = rewards.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / n;
    const std = Math.sqrt(variance) + 1e-6;

    return rewards.map(r => Number(((r - mean) / std).toFixed(4)));
  }

  /**
   * Simulate Token Telemetry and Neural Activation
   */
  public static generateNeuralTelemetry(
    config: OracleMindConfig,
    promptLength: number,
    completionLength: number,
    adapter?: LoRAAdapter | null
  ): {
    ttftMs: number;
    tokensPerSec: number;
    kvMemoryMb: number;
    expertStats: ExpertActivation[];
  } {
    const totalSeq = promptLength + completionLength;
    const kvMemoryMb = this.calculateKVCacheMemoryMb(
      config.numLayers,
      config.numKvHeads,
      config.headDim,
      totalSeq
    );

    // Baseline speeds based on model parameter count
    let baseTokPerSec = 82;
    let baseTtft = 35;

    if (config.id.includes('nano')) {
      baseTokPerSec = 115;
      baseTtft = 22;
    } else if (config.id.includes('moe')) {
      baseTokPerSec = 78;
      baseTtft = 42;
    } else {
      baseTokPerSec = 64;
      baseTtft = 48;
    }

    // LoRA overhead is negligible (~2%)
    if (adapter && adapter.active) {
      baseTokPerSec *= 0.98;
    }

    // Add slight realistic jitter
    const tokPerSec = Math.round(baseTokPerSec + (Math.random() * 8 - 4));
    const ttftMs = Math.round(baseTtft + (Math.random() * 6 - 3));

    // Expert activations
    const expertNames = [
      'Schema & JSON-LD Specialist',
      'SERP Ranking & Citation Arbiter',
      'Entity Gap & Competitor Analyst',
      'Plain-English Translation Kernel'
    ];

    const expertStats: ExpertActivation[] = [];
    if (config.useMoe) {
      const counts = [
        Math.floor(completionLength * 0.38),
        Math.floor(completionLength * 0.29),
        Math.floor(completionLength * 0.21),
        Math.max(1, completionLength - Math.floor(completionLength * 0.38) - Math.floor(completionLength * 0.29) - Math.floor(completionLength * 0.21))
      ];

      for (let i = 0; i < 4; i++) {
        expertStats.push({
          expertId: i,
          expertName: expertNames[i] || `Expert ${i + 1}`,
          tokenCount: counts[i],
          percentage: Number(((counts[i] / (completionLength || 1)) * 100).toFixed(1))
        });
      }
    } else {
      expertStats.push({
        expertId: 0,
        expertName: 'Dense Backbone',
        tokenCount: completionLength,
        percentage: 100
      });
    }

    return {
      ttftMs,
      tokensPerSec: tokPerSec,
      kvMemoryMb,
      expertStats
    };
  }
}
