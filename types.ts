
export enum OracleMode {
  FLASH = 'FLASH',
  DEEP_THINK = 'DEEP_THINK'
}

export interface ToolExecution {
  code: string;
  output: string;
}

export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: number;
  mode?: OracleMode;
  isStreaming?: boolean;
  groundingUrls?: Array<{ uri: string; title: string }>;
  toolExecutions?: ToolExecution[];
}

export interface SearchGroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export interface GroundingMetadata {
  groundingChunks?: SearchGroundingChunk[];
}
