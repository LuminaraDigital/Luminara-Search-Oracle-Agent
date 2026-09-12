import React, { useState, useEffect } from 'react';

interface VfsCreateNodeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (uri: string, content: string, desc: string) => void;
}

export const VfsCreateNodeModal: React.FC<VfsCreateNodeModalProps> = ({
  isOpen,
  onClose,
  onCreate,
}) => {
  const [newNodeUri, setNewNodeUri] = useState('viking://resources/my_note.md');
  const [newNodeContent, setNewNodeContent] = useState('# My New VFS Note\n\nEnter details here...');
  const [newNodeDesc, setNewNodeDesc] = useState('Custom knowledge document');

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNodeUri.trim()) return;
    onCreate(newNodeUri, newNodeContent, newNodeDesc);
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-4 md:p-6 overflow-y-auto animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
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
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xs font-mono p-1 rounded hover:bg-white/10"
            title="Close (Esc)"
            aria-label="Close modal"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 min-h-0 overflow-y-auto space-y-4 pt-3 pr-1">
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
              onClick={onClose}
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
  );
};
