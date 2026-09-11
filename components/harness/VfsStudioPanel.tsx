import React, { useState, useEffect, useMemo } from 'react';
import { 
  VfsNode, 
  VfsLayerType, 
  VfsMemoryCategory, 
  VfsRetrievalResult,
  BusinessDNA
} from '../../types';
import { VfsTreeNode } from '../../services/vfs/vfsTypes';
import { vfsStorageService, distillLayers } from '../../services/vfs/vfsStorageService';
import { useConfirm } from '../ui/ConfirmModal';
import { vfsRetrievalService } from '../../services/vfs/vfsRetrievalService';
import { vfsMemoryService } from '../../services/vfs/vfsMemoryService';
import { VfsCodeExporter, GeneratedVfsFile } from '../../services/vfs/vfsCodeExporter';

type VfsSubTab = 'explorer' | 'layers' | 'drr' | 'memory' | 'python';

export const VfsStudioPanel: React.FC = () => {
  const { requestConfirm, confirmModal } = useConfirm();
  const [activeTab, setActiveTab] = useState<VfsSubTab>('explorer');
  const [nodesVersion, setNodesVersion] = useState(0);

  // Explorer State
  const [selectedUri, setSelectedUri] = useState<string>('viking://user/default/.memories/profiles/luminara_brand_dna.md');
  const [activeLayer, setActiveLayer] = useState<VfsLayerType>('L1');
  const [searchFilter, setSearchFilter] = useState('');
  const [isCreatingNode, setIsCreatingNode] = useState(false);
  const [newNodeUri, setNewNodeUri] = useState('viking://resources/my_note.md');
  const [newNodeContent, setNewNodeContent] = useState('# My New VFS Note\n\nEnter details here...');
  const [newNodeDesc, setNewNodeDesc] = useState('Custom knowledge document');

  useEffect(() => {
    if (!isCreatingNode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsCreatingNode(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCreatingNode]);

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
  const [selectedPyFile, setSelectedPyFile] = useState<string>('vfs.py');

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
  const handleCreateNode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNodeUri.trim()) return;
    vfsStorageService.createNode({
      uri: newNodeUri,
      content: newNodeContent,
      description: newNodeDesc,
      type: newNodeUri.includes('.memories') ? 'memory' : newNodeUri.includes('skills') ? 'skill' : 'resource'
    });
    setSelectedUri(newNodeUri);
    setIsCreatingNode(false);
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
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `luminara_viking_vfs_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Recursive Tree Node Renderer
  const renderTreeItem = (node: VfsTreeNode) => {
    const isSelected = selectedUri === node.uri;
    const matchesSearch = !searchFilter || node.name.toLowerCase().includes(searchFilter.toLowerCase()) || node.uri.toLowerCase().includes(searchFilter.toLowerCase());

    return (
      <div key={node.uri} className="space-y-0.5">
        {matchesSearch && (
          <button
            onClick={() => setSelectedUri(node.uri)}
            style={{ paddingLeft: `${node.depth * 14 + 8}px` }}
            className={`w-full text-left py-1.5 pr-2 rounded-lg text-xs font-mono transition-all flex items-center justify-between group ${
              isSelected 
                ? 'bg-gold/20 text-gold-light border border-gold/50 font-bold' 
                : 'text-gray-300 hover:text-white hover:bg-white/5'
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <span className="text-gray-500 group-hover:text-gold shrink-0">
                {node.isDir ? '📁' : node.type === 'memory' ? '🧠' : node.type === 'skill' ? '✦' : '📄'}
              </span>
              <span className="truncate">{node.name}</span>
            </div>
            {!node.isDir && (
              <span className="text-[10px] text-gray-500 shrink-0 font-normal">
                {node.l1Tokens}t
              </span>
            )}
          </button>
        )}
        {node.children && node.children.map(renderTreeItem)}
      </div>
    );
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
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Tree Navigation Sidebar */}
          <div className="lg:col-span-4 glass-morphism rounded-2xl border border-white/10 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-white/5 pb-2">
              <span className="text-xs font-mono uppercase text-gray-400 font-bold tracking-wider">
                Filesystem Hierarchy
              </span>
              <span className="text-[10px] font-mono text-gold">viking://</span>
            </div>

            <div className="relative">
              <input
                type="text"
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                placeholder="Filter nodes..."
                className="w-full px-3 py-1.5 rounded-xl bg-black/40 border border-white/10 text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-gold/50"
              />
              {searchFilter && (
                <button
                  onClick={() => setSearchFilter('')}
                  className="absolute right-2.5 top-2 text-[10px] text-gray-400 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="max-h-[520px] overflow-y-auto space-y-1 pr-1 font-mono text-xs">
              {renderTreeItem(treeData)}
            </div>
          </div>

          {/* Selected Node Inspector */}
          <div className="lg:col-span-8 glass-morphism rounded-2xl border border-white/10 p-6 space-y-5">
            {selectedNode ? (
              <>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-white/5">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-gold/20 text-gold-light text-[10px] font-mono font-bold uppercase border border-gold/30">
                        {selectedNode.type}
                      </span>
                      {selectedNode.metadata.domainFocus && (
                        <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 text-[10px] font-mono border border-blue-500/30">
                          {selectedNode.metadata.domainFocus}
                        </span>
                      )}
                      <span className="text-xs font-mono text-gray-400">
                        {new Date(selectedNode.metadata.updatedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-white font-mono break-all">
                      {selectedNode.uri}
                    </h3>
                    {selectedNode.metadata.description && (
                      <p className="text-xs text-gray-400">
                        {selectedNode.metadata.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(selectedNode.uri);
                        alert(`Copied URI: ${selectedNode.uri}`);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-gray-300 transition-colors"
                      title="Copy URI"
                    >
                      Copy URI
                    </button>
                    <button
                      onClick={handleDeleteSelected}
                      className="px-2.5 py-1.5 rounded-xl bg-danger-500/10 hover:bg-danger-500/20 text-xs font-mono text-danger-400 transition-colors"
                      title="Delete Node"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {selectedNode.type === 'directory' ? (
                  <div className="p-8 text-center text-gray-400 font-mono text-xs space-y-2">
                    <div className="text-2xl">📁</div>
                    <div>Directory Node: <span className="text-white font-bold">{selectedNode.uri}</span></div>
                    <div className="text-gray-500">Contains subdirectories and context files. Select a child leaf node to inspect L0/L1/L2 multi-resolution layers.</div>
                  </div>
                ) : selectedNode.layers ? (
                  <div className="space-y-4">
                    {/* Layer Selector Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-black/40 border border-white/5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-gray-400 uppercase">Resolution Layer:</span>
                        <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/10">
                          {(['L0', 'L1', 'L2'] as VfsLayerType[]).map(layer => (
                            <button
                              key={layer}
                              onClick={() => setActiveLayer(layer)}
                              className={`px-3 py-1 rounded-md text-xs font-mono transition-all ${
                                activeLayer === layer
                                  ? 'bg-gold text-black font-bold shadow-md'
                                  : 'text-gray-400 hover:text-white'
                              }`}
                            >
                              {layer} {layer === 'L0' ? '(Abstract)' : layer === 'L1' ? '(Overview)' : '(Full)'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="flex items-center gap-3 text-xs font-mono">
                        <span className="text-gray-400">Tokens:</span>
                        <span className="text-gold-light font-bold">
                          {activeLayer === 'L0' 
                            ? selectedNode.layers.l0.tokenCount 
                            : activeLayer === 'L1' 
                            ? selectedNode.layers.l1.tokenCount 
                            : selectedNode.layers.l2.tokenCount}
                        </span>
                        {activeLayer !== 'L2' && (
                          <span className="text-success-400 font-bold bg-success-500/10 px-2 py-0.5 rounded border border-success-500/30">
                            -
                            {activeLayer === 'L0' 
                              ? Math.round(((selectedNode.layers.l2.tokenCount - selectedNode.layers.l0.tokenCount) / selectedNode.layers.l2.tokenCount) * 100)
                              : selectedNode.metadata.tokenSavingsPct || 0}
                            % Savings
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Keywords / Sections tags */}
                    {activeLayer === 'L0' && selectedNode.layers.l0.keywords.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-mono text-gray-400 uppercase mr-1">Index Keywords:</span>
                        {selectedNode.layers.l0.keywords.map(kw => (
                          <span key={kw} className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-mono text-gold-light">
                            #{kw}
                          </span>
                        ))}
                      </div>
                    )}

                    {activeLayer === 'L1' && selectedNode.layers.l1.sections.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[10px] font-mono text-gray-400 uppercase mr-1">Structure Anchors:</span>
                        {selectedNode.layers.l1.sections.map((sec, idx) => (
                          <span key={idx} className="px-2 py-0.5 rounded bg-white/5 text-[10px] font-mono text-gray-300">
                            • {sec}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Content Box */}
                    <div className="p-4 rounded-xl bg-black/60 border border-white/10 font-mono text-xs text-gray-200 whitespace-pre-wrap leading-relaxed max-h-[380px] overflow-y-auto">
                      {activeLayer === 'L0' 
                        ? selectedNode.layers.l0.content 
                        : activeLayer === 'L1' 
                        ? selectedNode.layers.l1.content 
                        : selectedNode.layers.l2.content}
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="p-12 text-center text-gray-500 font-mono text-xs">
                Select a node from the hierarchy tree to inspect its contents.
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: CREATE NODE */}
      {isCreatingNode && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto animate-in fade-in duration-200"
          onClick={(e) => { if (e.target === e.currentTarget) setIsCreatingNode(false); }}
        >
          <div 
            className="glass-morphism rounded-2xl border border-gold/40 p-4 sm:p-6 max-w-lg w-full my-auto max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-3.5rem)] flex flex-col overflow-hidden bg-black/95 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Create New VFS Node"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
              <h3 className="text-base font-bold gold-text font-mono">Create New VFS Node</h3>
              <button
                onClick={() => setIsCreatingNode(false)}
                className="text-gray-400 hover:text-white text-xs font-mono p-1 rounded hover:bg-white/10"
                title="Close (Esc)"
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateNode} className="flex-1 min-h-0 overflow-y-auto space-y-4 pt-3 pr-1">
              <div>
                <label className="text-[10px] font-mono text-gray-400 uppercase">Target URI (viking:// or oracle://)</label>
                <input
                  type="text"
                  value={newNodeUri}
                  onChange={e => setNewNodeUri(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-gold"
                  required
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-gray-400 uppercase">Description</label>
                <input
                  type="text"
                  value={newNodeDesc}
                  onChange={e => setNewNodeDesc(e.target.value)}
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-gold"
                />
              </div>

              <div>
                <label className="text-[10px] font-mono text-gray-400 uppercase">Raw Content (L2)</label>
                <textarea
                  value={newNodeContent}
                  onChange={e => setNewNodeContent(e.target.value)}
                  rows={5}
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-gold"
                />
                <p className="text-[10px] text-gray-500 font-mono mt-1">
                  * L0 (Abstract) and L1 (Overview) layers will be automatically distilled from this content.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setIsCreatingNode(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-gold hover:bg-gold-dark text-xs font-mono text-black font-bold"
                >
                  Create & Distill Layers
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: MULTI-RESOLUTION (L0 / L1 / L2) INSPECTOR */}
      {activeTab === 'layers' && (
        <div className="space-y-6">
          <div className="glass-morphism rounded-2xl border border-white/10 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Real-Time Multi-Resolution Distillation Engine
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Paste raw content to observe how the VFS automatically generates L0 Abstract (~100 tokens) and L1 Overview (~2,000 tokens) to optimize agent token economics.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-success-400 font-bold bg-success-500/10 px-3 py-1.5 rounded-xl border border-success-500/30">
                  L1 Saves {Math.round(((distilledCustom.l2.tokenCount - distilledCustom.l1.tokenCount) / (distilledCustom.l2.tokenCount || 1)) * 100)}% Tokens
                </span>
              </div>
            </div>

            <textarea
              value={customText}
              onChange={e => setCustomText(e.target.value)}
              rows={5}
              placeholder="Paste raw documentation, audit JSON, or article..."
              className="w-full px-4 py-3 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-gray-200 focus:outline-none focus:border-gold"
            />
          </div>

          {/* 3 Columns: L0, L1, L2 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* L0 Column */}
            <div className="glass-morphism rounded-2xl border border-white/10 p-5 space-y-3 flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase text-gold-light font-bold">
                  L0: Abstract
                </span>
                <span className="text-xs font-mono text-gray-400 bg-white/5 px-2 py-0.5 rounded">
                  {distilledCustom.l0.tokenCount} tokens
                </span>
              </div>
              <div className="text-[11px] text-gray-400">
                Ultra-dense summary used for routing, broad directory indexation, and vector scoring.
              </div>
              <div className="flex-1 p-3.5 rounded-xl bg-black/60 border border-white/5 text-xs font-mono text-gray-200 overflow-y-auto max-h-[300px] leading-relaxed">
                {distilledCustom.l0.content}
              </div>
              <div className="pt-2 border-t border-white/5">
                <div className="text-[10px] font-mono text-gray-500 uppercase mb-1">Extracted Keywords</div>
                <div className="flex flex-wrap gap-1">
                  {distilledCustom.l0.keywords.map(kw => (
                    <span key={kw} className="px-2 py-0.5 rounded bg-white/5 text-[9px] font-mono text-gray-300">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* L1 Column */}
            <div className="glass-morphism rounded-2xl border border-gold/40 p-5 space-y-3 flex flex-col shadow-[0_0_20px_rgba(191,149,63,0.1)]">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase text-gold-light font-bold">
                  L1: Overview
                </span>
                <span className="text-xs font-mono text-gold-light bg-gold/20 px-2 py-0.5 rounded font-bold border border-gold/30">
                  {distilledCustom.l1.tokenCount} tokens
                </span>
              </div>
              <div className="text-[11px] text-gray-400">
                Structural outline and key section anchors used for high-agency planning and reasoning.
              </div>
              <div className="flex-1 p-3.5 rounded-xl bg-black/60 border border-white/5 text-xs font-mono text-gray-200 overflow-y-auto max-h-[300px] leading-relaxed whitespace-pre-wrap">
                {distilledCustom.l1.content}
              </div>
              <div className="pt-2 border-t border-white/5">
                <div className="text-[10px] font-mono text-gray-500 uppercase mb-1">Section Anchors</div>
                <div className="text-[10px] font-mono text-gray-300">
                  {distilledCustom.l1.sections.join(' • ') || 'None detected'}
                </div>
              </div>
            </div>

            {/* L2 Column */}
            <div className="glass-morphism rounded-2xl border border-white/10 p-5 space-y-3 flex flex-col">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase text-gray-300 font-bold">
                  L2: Full Detail
                </span>
                <span className="text-xs font-mono text-gray-400 bg-white/5 px-2 py-0.5 rounded">
                  {distilledCustom.l2.tokenCount} tokens
                </span>
              </div>
              <div className="text-[11px] text-gray-400">
                Full uncompressed document, loaded on-demand only when fine-grained details are required.
              </div>
              <div className="flex-1 p-3.5 rounded-xl bg-black/60 border border-white/5 text-xs font-mono text-gray-400 overflow-y-auto max-h-[300px] leading-relaxed whitespace-pre-wrap">
                {distilledCustom.l2.content}
              </div>
              <div className="pt-2 border-t border-white/5">
                <div className="text-[10px] font-mono text-gray-500 uppercase mb-1">Storage Spec</div>
                <div className="text-[10px] font-mono text-gray-400">
                  Format: markdown • Raw Bytes: {new Blob([customText]).size} B
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: RECURSIVE RETRIEVAL (DRR) SIMULATOR */}
      {activeTab === 'drr' && (
        <div className="space-y-6">
          <div className="glass-morphism rounded-2xl border border-white/10 p-6 space-y-4">
            <div>
              <h3 className="text-lg font-bold text-white">
                Directory Recursive Retrieval (DRR) & Observable Trajectory
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Simulates OpenViking's hierarchical directory traversal. Rather than performing opaque flat vector matching, DRR navigates directory branches, evaluates relevance, dynamically picks L0/L1/L2 layers to honor token budgets, and records an audit trajectory.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
              <div className="md:col-span-8">
                <label className="text-[10px] font-mono text-gray-400 uppercase">Search Query</label>
                <input
                  type="text"
                  value={drrQuery}
                  onChange={e => setDrrQuery(e.target.value)}
                  placeholder="e.g. Stripe AEO audit, Competitor weaknesses, Schema template..."
                  className="w-full mt-1 px-4 py-2.5 rounded-xl bg-black/60 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-gold"
                />
              </div>

              <div className="md:col-span-2">
                <label className="text-[10px] font-mono text-gray-400 uppercase">Token Budget: {drrBudget}</label>
                <input
                  type="range"
                  min="400"
                  max="4000"
                  step="200"
                  value={drrBudget}
                  onChange={e => setDrrBudget(parseInt(e.target.value, 10))}
                  className="w-full mt-2 accent-gold"
                />
              </div>

              <div className="md:col-span-2 flex items-end">
                <button
                  onClick={handleRunDrr}
                  disabled={isRetrieving}
                  aria-busy={isRetrieving}
                  className="w-full py-2.5 rounded-xl bg-gradient-to-r from-gold to-gold-dark text-black font-bold text-xs font-mono hover:opacity-90 transition-all shadow-md flex items-center justify-center gap-1.5 outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:opacity-50"
                >
                  {isRetrieving ? (
                    <span className="animate-spin">⚙</span>
                  ) : (
                    <span>▶ Run DRR</span>
                  )}
                </button>
              </div>
            </div>

            {/* Quick suggestions */}
            <div className="flex items-center gap-2 flex-wrap pt-2">
              <span className="text-[10px] font-mono text-gray-500 uppercase">Quick Scenarios:</span>
              {[
                'Stripe AEO benchmark',
                'Competitor weaknesses and gaps',
                'FAQPage schema JSON-LD template',
                'Luminara brand DNA and USP'
              ].map(q => (
                <button
                  key={q}
                  onClick={() => { setDrrQuery(q); }}
                  className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-[10px] font-mono text-gray-300 hover:text-white transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Results & Trajectory */}
          {drrResult && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Observable Trajectory Steps */}
              <div className="lg:col-span-6 glass-morphism rounded-2xl border border-white/10 p-5 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono uppercase text-gold-light font-bold">
                      Observable Audit Trajectory
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-gray-400">
                      {drrResult.trajectory.length} steps in {drrResult.executionTimeMs}ms
                    </span>
                  </div>
                </div>

                <div className="space-y-3 font-mono text-xs">
                  {drrResult.trajectory.map((step) => {
                    const isIntent = step.action === 'intent_analysis';
                    const isPrune = step.action === 'prune';
                    const isResolution = step.action === 'layer_resolution';
                    const isAssembly = step.action === 'context_assembly';

                    return (
                      <div
                        key={step.stepIndex}
                        className={`p-3 rounded-xl border transition-all ${
                          isResolution 
                            ? 'bg-gold/10 border-gold/40 text-gold-light'
                            : isPrune
                            ? 'bg-danger-500/5 border-danger-500/20 text-danger-300'
                            : isAssembly
                            ? 'bg-success-500/10 border-success-500/30 text-success-300'
                            : 'bg-black/40 border-white/5 text-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-1.5 py-0.2 rounded bg-white/10 font-bold">
                              #{step.stepIndex}
                            </span>
                            <span className="font-bold uppercase text-[10px] tracking-wider">
                              {step.action.replace('_', ' ')}
                            </span>
                          </div>
                          {step.score !== undefined && (
                            <span className="text-[10px] text-gray-400 font-mono">
                              score: {(step.score * 100).toFixed(0)}%
                            </span>
                          )}
                          {step.layerSelected && (
                            <span className="text-[10px] px-2 py-0.2 rounded bg-gold text-black font-bold">
                              {step.layerSelected} Layer
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-gray-400 truncate mt-1">
                          ↳ {step.targetUri}
                        </div>
                        <div className="text-xs text-gray-200 mt-1 leading-normal">
                          {step.rationale}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Retrieved Context Assembly */}
              <div className="lg:col-span-6 glass-morphism rounded-2xl border border-white/10 p-5 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div>
                    <span className="text-xs font-mono uppercase text-success-400 font-bold">
                      Assembled Context Output
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono ml-2">
                      ({drrResult.tokensUsed} / {drrResult.tokenBudget} tokens)
                    </span>
                  </div>
                  <span className="text-xs font-mono text-success-400 font-bold bg-success-500/10 px-2.5 py-0.5 rounded-full border border-success-500/30">
                    +{drrResult.tokenSavingsPct}% Savings vs L2
                  </span>
                </div>

                <div className="p-4 rounded-xl bg-black/60 border border-white/10 font-mono text-xs text-gray-200 max-h-[500px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
                  {drrResult.assembledContext || 'No relevant context matched threshold.'}
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-[10px] font-mono text-gray-500">
                    Automatically injected into Oracle Agent prompt stream
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(drrResult.assembledContext);
                      alert('Copied assembled context to clipboard!');
                    }}
                    className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-gray-300"
                  >
                    Copy Assembled Context
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 4: 6-CATEGORY SELF-EVOLVING MEMORY HUB */}
      {activeTab === 'memory' && (
        <div className="space-y-6">
          <div className="glass-morphism rounded-2xl border border-white/10 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">
                  6-Category Self-Evolving Long-Term Memory
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Partitioned cognitive storage for AI agents: Profiles, Preferences, Entities, Events, Cases, and Patterns.
                </p>
              </div>
              <button
                onClick={handleSyncDna}
                className="px-3 py-2 rounded-xl bg-gold/20 border border-gold/50 hover:border-gold text-xs font-mono text-gold-light transition-all flex items-center gap-2"
              >
                <span>🧬</span>
                <span>Sync from Business DNA</span>
              </button>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
              {(['all', 'profiles', 'preferences', 'entities', 'events', 'cases', 'patterns'] as const).map(cat => (
                <button
                  key={cat}
                  onClick={() => setMemoryFilter(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono uppercase transition-all shrink-0 ${
                    memoryFilter === cat
                      ? 'bg-gold text-black font-bold shadow-md'
                      : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Memory Items Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {vfsMemoryService.getMemoryItems(memoryFilter === 'all' ? undefined : memoryFilter).map(item => (
              <div
                key={item.id}
                className="glass-morphism rounded-2xl border border-white/10 p-5 space-y-3 hover:border-gold/40 transition-all"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-gold/20 text-gold-light uppercase font-bold border border-gold/30">
                    {item.category}
                  </span>
                  <span className="text-[10px] font-mono text-gray-400">
                    {new Date(item.updatedAt).toLocaleDateString()}
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-white font-mono">{item.title}</h4>
                  <div className="text-[10px] font-mono text-gray-500 truncate mt-0.5">{item.uri}</div>
                </div>

                <div className="p-3 rounded-xl bg-black/40 border border-white/5 text-xs font-mono text-gray-300 line-clamp-3">
                  {item.summaryL0}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-white/5">
                  <div className="flex items-center gap-1 flex-wrap">
                    {item.tags.slice(0, 3).map(t => (
                      <span key={t} className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-white/5 text-gray-400">
                        #{t}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => {
                      setSelectedUri(item.uri);
                      setActiveTab('explorer');
                    }}
                    className="text-xs font-mono text-gold hover:underline"
                  >
                    Open in VFS →
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* SUB-TAB 5: STANDALONE PYTHON & FASTAPI EXPORTER */}
      {activeTab === 'python' && (
        <div className="space-y-6">
          <div className="glass-morphism rounded-2xl border border-white/10 p-6 space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Standalone Clean-Room Python Package Exporter
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Export the complete Luminara Viking context database to a self-contained Python / FastAPI package (<code className="text-gold-light">luminara_viking/</code>) for deployment in microservices, sidecars, or standalone agent harnesses.
                </p>
              </div>
              <button
                onClick={() => {
                  const zipContent = JSON.stringify(pythonFiles, null, 2);
                  const blob = new Blob([zipContent], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `luminara_viking_python_codebase.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-4 py-2 rounded-xl bg-gold hover:bg-gold-dark text-xs font-mono text-black font-bold transition-all shadow-md flex items-center gap-1.5"
              >
                <span>⬇ Download Code Manifest</span>
              </button>
            </div>

            {/* File Switcher Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
              {pythonFiles.map(file => (
                <button
                  key={file.filename}
                  onClick={() => setSelectedPyFile(file.filename)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-mono transition-all shrink-0 border ${
                    selectedPyFile === file.filename
                      ? 'bg-gold/20 text-gold-light border-gold/60 font-bold'
                      : 'text-gray-400 hover:text-white border-transparent hover:bg-white/5'
                  }`}
                >
                  <span>{file.filename}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Selected File Code Viewer */}
          {(() => {
            const currentFile = pythonFiles.find(f => f.filename === selectedPyFile) || pythonFiles[0];
            return (
              <div className="glass-morphism rounded-2xl border border-white/10 p-6 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-white/5">
                  <div>
                    <span className="text-xs font-mono text-white font-bold">{currentFile.path}</span>
                    <p className="text-[11px] text-gray-400 mt-0.5">{currentFile.description}</p>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(currentFile.code);
                      alert(`Copied ${currentFile.filename} to clipboard!`);
                    }}
                    className="px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-gray-300"
                  >
                    Copy File
                  </button>
                </div>

                <pre className="p-4 rounded-xl bg-black/80 border border-white/10 text-xs font-mono text-gray-200 overflow-x-auto max-h-[500px] leading-relaxed">
                  <code>{currentFile.code}</code>
                </pre>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};
