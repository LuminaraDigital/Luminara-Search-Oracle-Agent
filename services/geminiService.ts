import { GoogleGenAI, GenerateContentResponse, Type } from "@google/genai";
import { OracleMode, ToolExecution, Message } from "../types";
import { SYSTEM_INSTRUCTIONS } from "../constants";

export interface StreamChunk {
  text?: string;
  groundingUrls?: Array<{ uri: string; title: string }>;
}

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  }

  async *streamQuery(prompt: string, mode: OracleMode): AsyncGenerator<StreamChunk, void, unknown> {
    const model = mode === OracleMode.DEEP_THINK ? 'gemini-3-pro-preview' : 'gemini-3-flash-preview';
    const config: any = {
      systemInstruction: SYSTEM_INSTRUCTIONS,
      tools: [{ googleSearch: {} }],
    };

    if (mode === OracleMode.DEEP_THINK) {
      config.thinkingConfig = { thinkingBudget: 32768 };
    }

    try {
      const result = await this.ai.models.generateContentStream({
        model,
        contents: prompt,
        config,
      });

      for await (const chunk of result) {
        const responseChunk: StreamChunk = {};
        
        if (chunk.text) {
          responseChunk.text = chunk.text;
        }

        const candidate = chunk.candidates?.[0];
        const groundingChunks = candidate?.groundingMetadata?.groundingChunks;
        if (groundingChunks) {
          const urls: Array<{ uri: string; title: string }> = [];
          groundingChunks.forEach((c: any) => {
            if (c.web) {
              urls.push({ uri: c.web.uri, title: c.web.title });
            }
          });
          if (urls.length > 0) {
            responseChunk.groundingUrls = urls;
          }
        }

        yield responseChunk;
      }
    } catch (error) {
      console.error("Gemini Streaming Error:", error);
      yield { text: "Search systems interrupted. Please verify connectivity and re-attempt the query." };
    }
  }

  async queryWithSearch(prompt: string): Promise<{ 
    text: string; 
    urls: Array<{ uri: string; title: string }>;
    toolExecutions: ToolExecution[];
  }> {
    try {
      const config: any = {
        systemInstruction: SYSTEM_INSTRUCTIONS,
        tools: [{ googleSearch: {} }, { codeExecution: {} }],
      };

      const response = await this.ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
        config,
      });

      const text = response.text || "No response text found.";
      const urls: Array<{ uri: string; title: string }> = [];
      const toolExecutions: ToolExecution[] = [];
      
      const candidate = response.candidates?.[0];
      
      // Extract grounding URLs
      const groundingChunks = candidate?.groundingMetadata?.groundingChunks;
      if (groundingChunks) {
        groundingChunks.forEach((chunk: any) => {
          if (chunk.web) {
            urls.push({ uri: chunk.web.uri, title: chunk.web.title });
          }
        });
      }

      // Extract Python Code Executions
      if (candidate?.content?.parts) {
        let currentCode = '';
        for (const part of candidate.content.parts) {
          if (part.executableCode) {
            currentCode = part.executableCode.code;
          } else if (part.codeExecutionResult && currentCode) {
            toolExecutions.push({
              code: currentCode,
              output: part.codeExecutionResult.output
            });
            currentCode = '';
          }
        }
      }

      return { text, urls, toolExecutions };
    } catch (error) {
      console.error("Gemini Search Error:", error);
      return { text: "Error fetching search data.", urls: [], toolExecutions: [] };
    }
  }
}

export const geminiService = new GeminiService();