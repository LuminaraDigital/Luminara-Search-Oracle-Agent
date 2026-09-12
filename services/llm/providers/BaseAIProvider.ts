import { 
  AIProvider, 
  AIProviderType, 
  GenerateOptions, 
  GenerateResult, 
  StreamChunk 
} from '../../../types';

/**
 * Base abstract AI Provider
 */
export abstract class BaseAIProvider implements AIProvider {
  abstract id: string;
  abstract name: string;
  abstract type: AIProviderType;
  abstract config: {
    apiKey?: string;
    endpoint?: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
  abstract capabilities: {
    streaming: boolean;
    functionCalling: boolean;
    vision: boolean;
    audio: boolean;
    maxContextLength: number;
  };

  abstract isAvailable(): Promise<boolean>;
  abstract generateText(prompt: string, options?: GenerateOptions): Promise<GenerateResult>;
  abstract streamText(prompt: string, options?: GenerateOptions): AsyncIterable<StreamChunk>;

  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
