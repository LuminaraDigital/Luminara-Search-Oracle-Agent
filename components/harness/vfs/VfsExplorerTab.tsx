import React, { useState } from 'react';
import { VfsNode, VfsLayerType } from '../../../types';
import { VfsTreeNode } from '../../../services/vfs/vfsTypes';
import { copyToClipboard } from '../../../utils/clipboard';

interface VfsExplorerTabProps {
  treeData: VfsTreeNode;
  selectedUri: string;
  onSelectUri: (uri: string) => void;
  selectedNode: VfsNode | null;
  onDeleteNode: () => void;
  activeLayer: VfsLayerType;
  setActiveLayer: (layer: VfsLayerType) => void;
}

export const VfsExplorerTab: React.FC<VfsExplorerTabProps> = ({
  treeData,
  selectedUri,
  onSelectUri,
  selectedNode,
  onDeleteNode,
  activeLayer,
  setActiveLayer,
}) => {
  const [searchFilter, setSearchFilter] = useState('');
  const [copiedUri, setCopiedUri] = useState(false);

  const handleCopyUri = async (uri: string) => {
    await copyToClipboard(uri);
    setCopiedUri(true);
    setTimeout(() => setCopiedUri(false), 2000);
  };

  // Recursive Tree Node Renderer
  const renderTreeItem = (node: VfsTreeNode) => {
    const isSelected = selectedUri === node.uri;
    const matchesSearch =
      !searchFilter ||
      node.name.toLowerCase().includes(searchFilter.toLowerCase()) ||
      node.uri.toLowerCase().includes(searchFilter.toLowerCase());

    return (
      <div key={node.uri} className="space-y-0.5">
        {matchesSearch && (
          <button
            onClick={() => onSelectUri(node.uri)}
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
                  onClick={() => handleCopyUri(selectedNode.uri)}
                  className="px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-mono text-gray-300 transition-colors"
                  title="Copy URI"
                >
                  {copiedUri ? 'Copied!' : 'Copy URI'}
                </button>
                <button
                  onClick={onDeleteNode}
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
  );
};
