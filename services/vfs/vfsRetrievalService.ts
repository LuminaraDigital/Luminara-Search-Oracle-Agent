import { 
  VfsRetrievalResult, 
  VfsRetrievalOptions, 
  VfsMatchedItem, 
  RetrievalTrajectoryStep, 
  VfsNode, 
  VfsLayerType 
} from '../../types';
import { vfsStorageService, estimateTokens } from './vfsStorageService';

export class VfsRetrievalService {
  /**
   * Executes Directory Recursive Retrieval (DRR) over the VFS hierarchy.
   * Traverses directory trees, scores nodes against query, dynamically resolves L0/L1/L2 layers,
   * enforces token budget, and records an observable audit trajectory.
   */
  public retrieve(query: string, options: VfsRetrievalOptions = {}): VfsRetrievalResult {
    const startTime = performance.now();
    const tokenBudget = options.tokenBudget ?? 2500;
    const minScore = options.minScore ?? 0.18;
    const trajectory: RetrievalTrajectoryStep[] = [];
    let stepCounter = 0;

    const addStep = (
      action: RetrievalTrajectoryStep['action'],
      targetUri: string,
      rationale: string,
      extras: Partial<RetrievalTrajectoryStep> = {}
    ) => {
      stepCounter++;
      trajectory.push({
        stepIndex: stepCounter,
        action,
        targetUri,
        rationale,
        timestamp: Date.now(),
        ...extras
      });
    };

    // 1. Intent Analysis & Root Positioning
    const cleanQuery = (query || '').toLowerCase().trim();
    const queryTokens = cleanQuery.replace(/[^a-z0-9\s_-]/g, ' ').split(/\s+/).filter(w => w.length > 2);
    
    let rootUri = options.rootUri ? vfsStorageService.normalizeUri(options.rootUri) : 'viking://';
    let intentRationale = `Analyzed ${queryTokens.length} query tokens. Standard cross-namespace search.`;

    if (!options.rootUri) {
      if (cleanQuery.includes('memory') || cleanQuery.includes('dna') || cleanQuery.includes('competitor') || cleanQuery.includes('profile') || cleanQuery.includes('preference')) {
        rootUri = 'viking://user/default/.memories';
        intentRationale = 'Query intent signals long-term brand memory & competitor profiling. Positioning at .memories/';
      } else if (cleanQuery.includes('audit') || cleanQuery.includes('serp') || cleanQuery.includes('schema') || cleanQuery.includes('benchmark')) {
        rootUri = 'viking://resources';
        intentRationale = 'Query intent signals diagnostic audits, schemas, or SERP cache. Positioning at resources/';
      } else if (cleanQuery.includes('skill') || cleanQuery.includes('tool') || cleanQuery.includes('how to')) {
        rootUri = 'viking://skills';
        intentRationale = 'Query intent signals agent capability or execution tool. Positioning at skills/';
      }
    }

    addStep('intent_analysis', rootUri, intentRationale);

    // 2. Recursive Descent Traversal
    const matchedCandidates: Array<{ node: VfsNode; rawScore: number }> = [];

    const scoreNode = (node: VfsNode): number => {
      if (!node.layers && node.type !== 'directory') return 0;

      let score = 0;
      const nodeText = [
        node.name,
        node.metadata.description || '',
        ...(node.metadata.tags || []),
        node.layers?.l0.keywords.join(' ') || '',
        node.layers?.l0.content || '',
        node.layers?.l1.sections.join(' ') || ''
      ].join(' ').toLowerCase();

      for (const token of queryTokens) {
        if (node.name.toLowerCase().includes(token)) score += 0.35;
        if (node.metadata.tags?.some(t => t.toLowerCase().includes(token))) score += 0.30;
        if (node.layers?.l0.keywords.some(k => k.toLowerCase().includes(token))) score += 0.25;
        if (nodeText.includes(token)) score += 0.15;
      }

      // Domain boost
      if (node.metadata.domainFocus && cleanQuery.includes(node.metadata.domainFocus.toLowerCase())) {
        score += 0.20;
      }

      return Math.min(1.0, score);
    };

    const traverseDirectory = (dirUri: string, depth: number) => {
      const children = vfsStorageService.listDirectory(dirUri, false);
      addStep(
        'directory_position', 
        dirUri, 
        `Positioned at directory level ${depth} with ${children.length} candidate items.`
      );

      for (const childEntry of children) {
        const childNode = vfsStorageService.getNode(childEntry.uri);
        if (!childNode) continue;

        if (childNode.type === 'directory') {
          // Score directory suitability by inspecting its name and description
          let dirScore = 0;
          const dirText = (childNode.name + ' ' + (childNode.metadata.description || '')).toLowerCase();
          for (const token of queryTokens) {
            if (dirText.includes(token)) dirScore += 0.3;
          }

          if (dirScore >= minScore || children.length <= 4) {
            addStep(
              'descend', 
              childNode.uri, 
              `Branch score ${dirScore.toFixed(2)} meets threshold. Descending into subtree.`,
              { score: dirScore }
            );
            traverseDirectory(childNode.uri, depth + 1);
          } else {
            addStep(
              'prune', 
              childNode.uri, 
              `Branch score ${dirScore.toFixed(2)} below threshold ${minScore}. Pruning subtree.`,
              { score: dirScore }
            );
          }
        } else {
          // File / Memory / Resource / Skill leaf node
          const score = scoreNode(childNode);
          addStep(
            'branch_scoring', 
            childNode.uri, 
            `Evaluated leaf node relevance: score ${score.toFixed(2)}.`,
            { score }
          );

          if (score >= minScore) {
            matchedCandidates.push({ node: childNode, rawScore: score });
          }
        }
      }
    };

    // If root is 'viking://', traverse main namespaces
    if (rootUri === 'viking://') {
      const topDirs = ['viking://user/default/.memories', 'viking://resources', 'viking://skills', 'viking://sessions'];
      for (const topDir of topDirs) {
        traverseDirectory(topDir, 1);
      }
    } else {
      traverseDirectory(rootUri, 1);
    }

    // 3. Sort candidates by score descending
    matchedCandidates.sort((a, b) => b.rawScore - a.rawScore);

    // 4. Dynamic Multi-Resolution Layer Resolution under Token Budget
    let remainingBudget = tokenBudget;
    const matchedItems: VfsMatchedItem[] = [];
    let hypotheticalL2TokensTotal = 0;

    for (const item of matchedCandidates) {
      if (remainingBudget <= 60) {
        addStep(
          'prune', 
          item.node.uri, 
          `Remaining budget (${remainingBudget} tokens) exhausted. Skipping lower priority matches.`
        );
        break;
      }

      const layers = item.node.layers;
      if (!layers) continue;

      hypotheticalL2TokensTotal += layers.l2.tokenCount;

      let chosenLayer: VfsLayerType = 'L0';
      let chosenContent = layers.l0.content;
      let chosenTokens = layers.l0.tokenCount;
      let layerRationale = '';

      const forceLayer = options.preferredLayer;

      if (forceLayer === 'L2' && layers.l2.tokenCount <= remainingBudget) {
        chosenLayer = 'L2';
        chosenContent = layers.l2.content;
        chosenTokens = layers.l2.tokenCount;
        layerRationale = `Explicit L2 preference selected within budget (${chosenTokens} tokens).`;
      } else if (forceLayer === 'L1' && layers.l1.tokenCount <= remainingBudget) {
        chosenLayer = 'L1';
        chosenContent = layers.l1.content;
        chosenTokens = layers.l1.tokenCount;
        layerRationale = `Explicit L1 preference selected within budget (${chosenTokens} tokens).`;
      } else {
        // Automatic Multi-Resolution Selection Algorithm
        if (item.rawScore >= 0.70 && layers.l2.tokenCount <= remainingBudget * 0.7) {
          chosenLayer = 'L2';
          chosenContent = layers.l2.content;
          chosenTokens = layers.l2.tokenCount;
          layerRationale = `High semantic relevance (${item.rawScore.toFixed(2)}) justified Full Detail L2 extraction (${chosenTokens} tokens).`;
        } else if (item.rawScore >= 0.35 && layers.l1.tokenCount <= remainingBudget) {
          chosenLayer = 'L1';
          chosenContent = layers.l1.content;
          chosenTokens = layers.l1.tokenCount;
          layerRationale = `Strong structural match (${item.rawScore.toFixed(2)}) resolved to Overview L1 (${chosenTokens} tokens, saving ${layers.l2.tokenCount - chosenTokens} tokens).`;
        } else if (layers.l0.tokenCount <= remainingBudget) {
          chosenLayer = 'L0';
          chosenContent = layers.l0.content;
          chosenTokens = layers.l0.tokenCount;
          layerRationale = `Broad context match (${item.rawScore.toFixed(2)}) resolved to Abstract L0 (${chosenTokens} tokens, saving 85%+ tokens).`;
        }
      }

      // Honor the token budget: if even the cheapest fitting layer is over budget, skip this node.
      if (chosenTokens > remainingBudget) continue;
      remainingBudget -= chosenTokens;

      matchedItems.push({
        node: item.node,
        layer: chosenLayer,
        content: chosenContent,
        score: item.rawScore,
        tokenCount: chosenTokens
      });

      addStep(
        'layer_resolution', 
        item.node.uri, 
        layerRationale,
        {
          score: item.rawScore,
          layerSelected: chosenLayer,
          tokensCost: chosenTokens
        }
      );
    }

    // 5. Context Assembly
    const contextSections = matchedItems.map(m => {
      return `### [VFS: ${m.node.uri} | Layer: ${m.layer} | Score: ${(m.score * 100).toFixed(0)}%]\n` +
             `*Description*: ${m.node.metadata.description || 'N/A'}\n\n` +
             `${m.content}\n`;
    });

    const assembledContext = contextSections.join('\n---\n\n');
    const tokensUsed = tokenBudget - remainingBudget;
    const tokenSavingsPct = hypotheticalL2TokensTotal > tokensUsed
      ? Math.round(((hypotheticalL2TokensTotal - tokensUsed) / hypotheticalL2TokensTotal) * 100)
      : 0;

    addStep(
      'context_assembly', 
      rootUri, 
      `Assembled ${matchedItems.length} context nodes. Total tokens: ${tokensUsed} / ${tokenBudget} (Saved ${tokenSavingsPct}% vs raw L2).`
    );

    const executionTimeMs = Math.round(performance.now() - startTime);

    return {
      query,
      rootUri,
      tokenBudget,
      tokensUsed,
      tokenSavingsPct,
      matchedItems,
      assembledContext,
      trajectory,
      executionTimeMs
    };
  }
}

export const vfsRetrievalService = new VfsRetrievalService();
