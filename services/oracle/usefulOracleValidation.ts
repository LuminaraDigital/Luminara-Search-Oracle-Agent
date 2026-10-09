/**
 * Useful Oracle Validation (UOV) Engine.
 *
 * Implements the Useful Proof of Work (UPoW) and Quorum Consensus
 * principles from the Qubic Whitepaper for Luminara Search Oracle.
 *
 * Rather than expending compute on arbitrary hashing, computational power
 * evaluates real-time AI search engine visibility across multi-model agents.
 * Byzantine Fault Tolerant (BFT) quorum voting validates consensus digests
 * before on-chain anchoring to TON's CitationRegistry.
 */

export interface OracleAgentVote {
  agentId: string;
  domain: string;
  query: string;
  healthScore: number;
  citationRate: number;
  engineSample: string[]; // e.g. ['google_sge', 'perplexity', 'chatgpt_search']
  timestamp: number;
}

export interface QuorumConsensusResult {
  isAligned: boolean;
  quorumSize: number;
  agreeingCount: number;
  consensusHealthScore: number;
  consensusCitationRate: number;
  evidenceHash: string;
  divergentVotes: string[];
}

/**
 * Computes a deterministic SHA-256 digest string for arbitrary JSON payloads.
 */
async function computeEvidenceDigest(data: unknown): Promise<string> {
  const jsonStr = JSON.stringify(data, Object.keys(data as any).sort());
  const encoder = new TextEncoder();
  const bytes = encoder.encode(jsonStr);
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Computes Quorum Consensus across a panel of independent AI Search Oracle agents.
 * Implements Qubic's BFT dissemination criterion: Quorum Q >= 2f + 1 where f <= (N - 1) / 3.
 */
export async function evaluateOracleQuorum(
  votes: OracleAgentVote[],
  toleranceEpsilon = 12, // Score delta tolerance for grouping votes
): Promise<QuorumConsensusResult> {
  const N = votes.length;
  if (N === 0) {
    return {
      isAligned: false,
      quorumSize: 0,
      agreeingCount: 0,
      consensusHealthScore: 0,
      consensusCitationRate: 0,
      evidenceHash: '0'.repeat(64),
      divergentVotes: [],
    };
  }

  // Calculate maximum tolerated faulty nodes f and required quorum Q (BFT 2/3 + 1)
  const maxFaultyF = Math.floor((N - 1) / 3);
  const requiredQuorumQ = Math.max(1, 2 * maxFaultyF + 1);

  // Group votes by score proximity
  let bestCluster: OracleAgentVote[] = [];
  let bestScoreSum = 0;
  let bestRateSum = 0;

  for (let i = 0; i < N; i++) {
    const candidate = votes[i];
    const cluster = votes.filter((v) => {
      const dScore = Math.abs(v.healthScore - candidate.healthScore);
      const dRate = Math.abs(v.citationRate - candidate.citationRate);
      return dScore <= toleranceEpsilon && dRate <= toleranceEpsilon;
    });

    if (cluster.length > bestCluster.length) {
      bestCluster = cluster;
      bestScoreSum = cluster.reduce((sum, v) => sum + v.healthScore, 0);
      bestRateSum = cluster.reduce((sum, v) => sum + v.citationRate, 0);
    }
  }

  const agreeingCount = bestCluster.length;
  const isAligned = agreeingCount >= requiredQuorumQ;

  const consensusHealthScore = agreeingCount > 0 ? Math.round(bestScoreSum / agreeingCount) : 0;
  const consensusCitationRate = agreeingCount > 0 ? Math.round(bestRateSum / agreeingCount) : 0;

  const agreedAgentIds = new Set(bestCluster.map((v) => v.agentId));
  const divergentVotes = votes.filter((v) => !agreedAgentIds.has(v.agentId)).map((v) => v.agentId);

  // Build the cryptographic evidence digest linking all agreeing votes
  const evidenceData = {
    domain: votes[0]?.domain || '',
    query: votes[0]?.query || '',
    consensusHealthScore,
    consensusCitationRate,
    agreeingAgents: bestCluster.map((v) => ({
      id: v.agentId,
      health: v.healthScore,
      rate: v.citationRate,
    })),
    tickTimestamp: Date.now(),
  };

  const evidenceHash = await computeEvidenceDigest(evidenceData);

  return {
    isAligned,
    quorumSize: requiredQuorumQ,
    agreeingCount,
    consensusHealthScore,
    consensusCitationRate,
    evidenceHash,
    divergentVotes,
  };
}
