import React, { useState, useEffect, useMemo } from 'react';
import { 
  VfsLayerType, 
  VfsMemoryCategory, 
  VfsRetrievalResult,
  BusinessDNA
} from '../../types';
import { vfsStorageService, distillLayers } from '../../services/vfs/vfsStorageService';
import { useConfirm } from '../ui/ConfirmModal';
import { vfsRetrievalService } from '../../services/vfs/vfsRetrievalService';
import { vfsMemoryService } from '../../services/vfs/vfsMemoryService';
import { VfsCodeExporter } from '../../services/vfs/vfsCodeExporter';
import { downloadBlob } from '../../utils/download';
import {
  VfsCreateNodeModal,
  VfsExplorerTab,
  VfsLayersTab,
  VfsDrrTab,
  VfsMemoryTab,
  VfsPythonTab,
} from './vfs';

export {
  VfsCreateNodeModal,
  VfsExplorerTab,
  VfsLayersTab,
  VfsDrrTab,
  VfsMemoryTab,
  VfsPythonTab,
};

type VfsSubTab = 'explorer' | 'layers' | 'drr' | 'memory' | 'python';

export const VfsStudioPanel: React.FC = () => {
  const { requestConfirm, confirmModal } = useConfirm();
  const [activeTab, setActiveTab] = useState<VfsSubTab>('explorer');
  const [nodesVersion, setNodesVersion] = useState(0);

  // Explorer State
  const [selectedUri, setSelectedUri] = useState<string>('viking://user/default/.memories/profiles/luminara_brand_dna.md');
  const [activeLayer, setActiveLayer] = useState<VfsLayerType>('L1');
  const [isCreatingNode, setIsCreatingNode] = useState(false);

  // DRR Simulator State
  const [drrQuery, setDrrQuery] = useState('Stripe AEO benchmark');
  const [drrBudget, setDrrBudget] = useState(2000);
  const [drrResult, setDrrResult] = useState<VfsRetrievalResult | null>(null);
  const [isRetrieving, setIsRetrieving] = useState(false);

  // Multi-Resolution Inspector State
  const [customText, setCustomText] = useState(
    `# Enterprise AEO Strategy & AI Citation Architecture\n\n` +
    `Modern search engines are rapidly transitioning from 10 blue links to conversational synthesized answers powered by Large Language Models (LLMs) such as Gemini, Perplexity, and ChatGPT Search.\n\n` +
    `## Core Strategy Pillars\n` +
    `- **1. Entity Disambiguation**: Use comprehensive JSON-LD Organization and Article schemas.\n` +
    `- **2. Definitional Precision**: Place authoritative 25-word definitions directly beneath H2 headers.\n` +
    `- **3. Empirical Benchmark Tables**: LLMs quote numerical comparison tables 3.4x more frequently than bullet points.\n\n` +
    `## Verification Protocol\n` +
    `Every strategic claim must be grounded in verified Google Search SERP chunks to prevent hallucination.`
  );
  const distilledCustom = useMemo(() => distillLayers(customText, 'markdown', 'Enterprise AEO Strategy'), [customText]);

  // Memory Hub State
  const [memoryFilter, setMemoryFilter] = useState<VfsMemoryCategory | 'all'>('all');
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  // Python Exporter State
  const pythonFiles = useMemo(() => VfsCodeExporter.generatePythonCodebase(), []);

  // Reload nodes on storage changes
  useEffect(() => {
    const unsub = vfsStorageService.subscribe(() => {
      setNodesVersion(v => v + 1);
    });
    return unsub;
  }, []);

  const summary = useMemo(() => vfsStorageService.getTreeSummary(), [nodesVersion]);
  const treeData = useMemo(() => vfsStorageService.getTree('viking://', 5), [nodesVersion]);
  const selectedNode = useMemo(() => vfsStorageService.getNode(selectedUri), [selectedUri, nodesVersion]);

  // Handle Sync DNA
  const handleSyncDna = () => {
    let savedDna: BusinessDNA | null = null;
    try {
      const raw = localStorage.getItem('luminara_business_dna');
      if (raw) savedDna = JSON.parse(raw);
    } catch (e) {}

    if (!savedDna) {
      setSyncStatus('No Business DNA found in storage. Configure Business DNA first.');
      setTimeout(() => setSyncStatus(null), 3500);
      return;
    }

    const res = vfsMemoryService.syncFromBusinessDNA(savedDna);
    setSyncStatus(`Successfully synced DNA for ${savedDna.name} (${res.nodesCreated} nodes updated).`);
    setTimeout(() => setSyncStatus(null), 4000);
  };

  // Handle DRR Execution
  const handleRunDrr = () => {
    if (!drrQuery.trim()) return;
    setIsRetrieving(true);
    setTimeout(() => {
      const result = vfsRetrievalService.retrieve(drrQuery, { tokenBudget: drrBudget });
      setDrrResult(result);
      setIsRetrieving(false);
    }, 150);
  };

  // Handle Create Node
  const handleCreateNode = (uri: string, content: string, desc: string) => {
    vfsStorageService.createNode({
      uri,
      content,
      description: desc,
      type: uri.includes('.memories') ? 'memory' : uri.includes('skills') ? 'skill' : 'resource'
    });
    setSelectedUri(uri);
  };

  // Handle Delete Node
  const handleDeleteSelected = () => {
    if (!selectedNode) return;
    const uri = selectedNode.uri;
    requestConfirm(
      {
        title: 'Delete node?',
        description: <>Delete <code className="font-mono text-gold-light">{uri}</code> and everything beneath it? This cannot be undone.</>,
        confirmLabel: 'Delete node',
        variant: 'danger',
      },
      () => {
        vfsStorageService.deleteNode(uri, true);
        setSelectedUri('viking://user/default/.memories');
      },
    );
  };

  // Handle Export Snapshot
  const handleDownloadSnapshot = () => {
    const json = vfsStorageService.exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    downloadBlob(blob, `luminara_viking_vfs_${Date.now()}.json`);
  };

  return (
    <div className="space-y-6">
      {confirmModal}
      {/* Top Banner & KPI Telemetry */}
      <div className="glass-morphism rounded-2xl border border-white/10 p-6 relative overflow-hidden">
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-gold/10 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 pb-6 border-b border-white/5">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-gold/20 border border-gold/30 text-[10px] font-mono text-gold-light font-bold uppercase">
                Clean-Room OpenViking Adaptation
              </span>
              <span className="text-gray-500">•</span>
              <span className="text-xs font-mono text-success-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-success-400 animate-pulse" />
                VFS Online (viking:// & oracle://)
              </span>
            </div>
            <h2 className="text-2xl font-bold gold-text tracking-tight mt-1">
              Luminara Viking Context OS & Hierarchical VFS
            </h2>
            <p className="text-xs text-gray-400 max-w-3xl mt-1">
              Organizes agent long-term memories, AEO audits, and skill capabilities into a hierarchical filesystem with multi-resolution L0/L1/L2 layers and observable Directory Recursive Retrieval (DRR).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleSyncDna}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-gold/20 to-gold-dark/20 border border-gold/40 hover:border-gold text-xs font-mono text-gold-light transition-all flex items-center gap-1.5 shadow-sm"
              title="Synchronize Business DNA into .memories/"
            >
              <span>🧬</span>
              <span>Sync Business DNA</span>
            </button>
            <button
              onClick={() => setIsCreatingNode(true)}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-mono text-gray-300 hover:text-white transition-all flex items-center gap-1.5"
            >
              <span>+</span>
              <span>New Node</span>
            </button>
            <button
              onClick={handleDownloadSnapshot}
              className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-mono text-gray-300 hover:text-white transition-all"
              title="Download JSON Snapshot"
            >
              <span>Export JSON</span>
            </button>
            <button
              onClick={() => requestConfirm(
                {
                  title: 'Reset Viking VFS?',
                  description: 'The filesystem will be restored to the default seed. All stored memories and custom nodes will be lost.',
                  confirmLabel: 'Reset VFS',
                  variant: 'danger',
                },
                () => vfsStorageService.resetToDefaults(),
              )}
              className="px-2.5 py-1.5 rounded-xl bg-danger-500/10 hover:bg-danger-500/20 border border-danger-500/30 text-[11px] font-mono text-danger-400 transition-all outline-none focus-visible:ring-2 focus-visible:ring-danger-400"
              title="Reset VFS"
            >
              Reset
            </button>
          </div>
        </div>

        {syncStatus && (
          <div className="mt-3 p-2.5 rounded-xl bg-success-500/10 border border-success-500/30 text-xs font-mono text-success-300 flex items-center gap-2">
            <span>✓</span>
            <span>{syncStatus}</span>
          </div>
        )}

        {/* 4 Metric Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6">
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5">
            <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Indexed Nodes</div>
            <div className="text-xl font-bold text-white mt-1 font-mono">{summary.totalNodes}</div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">{summary.totalDirectories} dirs • {summary.totalFiles} files</div>
          </div>

          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5">
            <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Token Savings</div>
            <div className="text-xl font-bold text-success-400 mt-1 font-mono">+{summary.overallTokenSavingsPct}%</div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">vs flat L2 full document loads</div>
          </div>

          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5">
            <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">L0 / L1 / L2 Footprint</div>
            <div className="text-xs font-bold text-gold-light mt-1 font-mono">
              {summary.totalL0Tokens} / {summary.totalL1Tokens} / {summary.totalL2Tokens}
            </div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">Abstract / Overview / Detail tokens</div>
          </div>

          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5">
            <div className="text-[10px] font-mono text-gray-400 uppercase tracking-wider">Namespaces</div>
            <div className="text-xs font-bold text-gray-300 mt-1 font-mono">
              {summary.namespaces.memories} mem • {summary.namespaces.resources} res
            </div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
              {summary.namespaces.skills} skills • {summary.namespaces.sessions} sess
            </div>
          </div>
        </div>
      </div>

      {/* Sub-Tabs Selector */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-2 overflow-x-auto scrollbar-none">
        {[
          { id: 'explorer', label: 'VFS Tree & Explorer', icon: '🗂' },
          { id: 'layers', label: 'Multi-Resolution (L0/L1/L2)', icon: '⚡' },
          { id: 'drr', label: 'Recursive Retrieval (DRR)', icon: '🎯' },
          { id: 'memory', label: '6-Category Memory Hub', icon: '🧠' },
          { id: 'python', label: 'Standalone Python Code', icon: '🐍' }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id as VfsSubTab)}
            className={`px-4 py-2 rounded-xl text-xs font-mono transition-all flex items-center gap-2 shrink-0 border ${
              activeTab === t.id
                ? 'bg-gold/20 text-gold-light border-gold/60 font-bold shadow-[0_0_15px_rgba(191,149,63,0.15)]'
                : 'text-gray-400 hover:text-white border-transparent hover:bg-white/5'
            }`}
          >
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* SUB-TAB 1: VFS TREE & EXPLORER */}
      {activeTab === 'explorer' && (
        <VfsExplorerTab
          treeData={treeData}
          selectedUri={selectedUri}
          onSelectUri={setSelectedUri}
          selectedNode={selectedNode}
          onDeleteNode={handleDeleteSelected}
          activeLayer={activeLayer}
          setActiveLayer={setActiveLayer}
        />
      )}

      {/* SUB-TAB 2: MULTI-RESOLUTION (L0 / L1 / L2) INSPECTOR */}
      {activeTab === 'layers' && (
        <VfsLayersTab
          customText={customText}
          setCustomText={setCustomText}
          distilledCustom={distilledCustom}
        />
      )}

      {/* SUB-TAB 3: RECURSIVE RETRIEVAL (DRR) SIMULATOR */}
      {activeTab === 'drr' && (
        <VfsDrrTab
          drrQuery={drrQuery}
          setDrrQuery={setDrrQuery}
          drrBudget={drrBudget}
          setDrrBudget={setDrrBudget}
          drrResult={drrResult}
          isRetrieving={isRetrieving}
          onRunDrr={handleRunDrr}
        />
      )}

      {/* SUB-TAB 4: 6-CATEGORY SELF-EVOLVING MEMORY HUB */}
      {activeTab === 'memory' && (
        <VfsMemoryTab
          memoryFilter={memoryFilter}
          setMemoryFilter={setMemoryFilter}
          onSyncDna={handleSyncDna}
          onSelectUri={setSelectedUri}
          onNavigateExplorer={() => setActiveTab('explorer')}
        />
      )}

      {/* SUB-TAB 5: STANDALONE PYTHON & FASTAPI EXPORTER */}
      {activeTab === 'python' && (
        <VfsPythonTab
          pythonFiles={pythonFiles}
        />
      )}

      {/* MODAL: CREATE NODE */}
      <VfsCreateNodeModal
        isOpen={isCreatingNode}
        onClose={() => setIsCreatingNode(false)}
        onCreate={handleCreateNode}
      />
    </div>
  );
};
