export * from '../../types';

export interface VfsCreateNodeInput {
  uri: string;
  name?: string;
  type: 'directory' | 'file' | 'memory' | 'resource' | 'skill' | 'session';
  content?: string;
  rawFormat?: 'markdown' | 'json' | 'text' | 'yaml';
  description?: string;
  tags?: string[];
  domainFocus?: 'SEO' | 'AEO' | 'GEO' | 'STRATEGY' | 'MEMORY';
  author?: string;
}

export interface VfsLsEntry {
  uri: string;
  name: string;
  type: string;
  isDir: boolean;
  sizeBytes: number;
  l0Tokens: number;
  l1Tokens: number;
  l2Tokens: number;
  updatedAt: number;
  tags: string[];
}

export interface VfsTreeNode {
  uri: string;
  name: string;
  type: string;
  isDir: boolean;
  depth: number;
  children: VfsTreeNode[];
  l0Tokens: number;
  l1Tokens: number;
  l2Tokens: number;
  savingsPct: number;
}
