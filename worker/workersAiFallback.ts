/**
 * Cloudflare Workers AI edge fallback for chat completions.
 * Falls back to @cf/meta/llama-3.1-8b-instruct and formats
 * output as standard OpenAI ChatCompletion (JSON or SSE stream).
 */
import type { Ai } from './env';

export interface OpenAiChatCompletionChoice {
  index: number;
  message: {
    role: string;
    content: string;
  };
  finish_reason: string;
}

export interface OpenAiChatCompletion {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAiChatCompletionChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAiStreamChunkChoice {
  index: number;
  delta: {
    role?: string;
    content?: string;
  };
  finish_reason: string | null;
}

export interface OpenAiStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: OpenAiStreamChunkChoice[];
}

/**
 * Transforms Workers AI SSE or raw stream chunks into OpenAI-compatible SSE ReadableStream.
 */
export function createOpenAiSseReadableStream(
  aiResult: unknown,
  id: string,
  created: number,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (aiResult && typeof (aiResult as any).getReader === 'function') {
          const reader = (aiResult as ReadableStream).getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let emittedStop = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
              // Direct object chunk from mock/stream
              const content = typeof (value as any).response === 'string'
                ? (value as any).response
                : typeof (value as any).choices?.[0]?.delta?.content === 'string'
                  ? (value as any).choices[0].delta.content
                  : '';
              if (content) {
                const chunk: OpenAiStreamChunk = {
                  id,
                  object: 'chat.completion.chunk',
                  created,
                  model: '@cf/meta/llama-3.1-8b-instruct',
                  choices: [
                    {
                      index: 0,
                      delta: { content },
                      finish_reason: null,
                    },
                  ],
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
              continue;
            }

            const textChunk = typeof value === 'string' ? value : decoder.decode(value, { stream: true });
            buffer += textChunk;

            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const rawLine of lines) {
              const line = rawLine.trim();
              if (!line) continue;
              if (line.startsWith('data:')) {
                const dataPart = line.slice(5).trim();
                if (dataPart === '[DONE]') {
                  if (!emittedStop) {
                    const stopChunk: OpenAiStreamChunk = {
                      id,
                      object: 'chat.completion.chunk',
                      created,
                      model: '@cf/meta/llama-3.1-8b-instruct',
                      choices: [
                        {
                          index: 0,
                          delta: {},
                          finish_reason: 'stop',
                        },
                      ],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(stopChunk)}\n\n`));
                    emittedStop = true;
                  }
                  continue;
                }
                try {
                  const parsed = JSON.parse(dataPart);
                  const content = typeof parsed.response === 'string'
                    ? parsed.response
                    : typeof parsed.choices?.[0]?.delta?.content === 'string'
                      ? parsed.choices[0].delta.content
                      : '';
                  if (content) {
                    const chunk: OpenAiStreamChunk = {
                      id,
                      object: 'chat.completion.chunk',
                      created,
                      model: '@cf/meta/llama-3.1-8b-instruct',
                      choices: [
                        {
                          index: 0,
                          delta: { content },
                          finish_reason: null,
                        },
                      ],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }
                } catch {
                  // Ignore non-JSON SSE lines
                }
              }
            }
          }

          if (buffer.trim()) {
            const line = buffer.trim();
            if (line.startsWith('data:')) {
              const dataPart = line.slice(5).trim();
              if (dataPart !== '[DONE]') {
                try {
                  const parsed = JSON.parse(dataPart);
                  const content = typeof parsed.response === 'string'
                    ? parsed.response
                    : typeof parsed.choices?.[0]?.delta?.content === 'string'
                      ? parsed.choices[0].delta.content
                      : '';
                  if (content) {
                    const chunk: OpenAiStreamChunk = {
                      id,
                      object: 'chat.completion.chunk',
                      created,
                      model: '@cf/meta/llama-3.1-8b-instruct',
                      choices: [
                        {
                          index: 0,
                          delta: { content },
                          finish_reason: null,
                        },
                      ],
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }
                } catch {
                  // Ignore
                }
              }
            }
          }

          if (!emittedStop) {
            const stopChunk: OpenAiStreamChunk = {
              id,
              object: 'chat.completion.chunk',
              created,
              model: '@cf/meta/llama-3.1-8b-instruct',
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'stop',
                },
              ],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(stopChunk)}\n\n`));
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } else {
          // aiResult is a static object or string
          const content = typeof (aiResult as any)?.response === 'string'
            ? (aiResult as any).response
            : typeof (aiResult as any)?.choices?.[0]?.message?.content === 'string'
              ? (aiResult as any).choices[0].message.content
              : typeof aiResult === 'string'
                ? aiResult
                : '';
          if (content) {
            const chunk: OpenAiStreamChunk = {
              id,
              object: 'chat.completion.chunk',
              created,
              model: '@cf/meta/llama-3.1-8b-instruct',
              choices: [
                {
                  index: 0,
                  delta: { content },
                  finish_reason: null,
                },
              ],
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
          const stopChunk: OpenAiStreamChunk = {
            id,
            object: 'chat.completion.chunk',
            created,
            model: '@cf/meta/llama-3.1-8b-instruct',
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: 'stop',
              },
            ],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stopChunk)}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/**
 * Runs Cloudflare Workers AI edge fallback for chat completions.
 */
export async function runWorkersAiChatFallback(ai: Ai, body: unknown): Promise<any> {
  let parsedBody: Record<string, any> = {};
  if (typeof body === 'string') {
    try {
      parsedBody = JSON.parse(body);
    } catch {
      parsedBody = {};
    }
  } else if (body && typeof body === 'object') {
    parsedBody = body as Record<string, any>;
  }

  let messages: Array<{ role: string; content: string }> = [];
  if (Array.isArray(parsedBody.messages) && parsedBody.messages.length > 0) {
    messages = parsedBody.messages
      .filter((m: any) => m && typeof m === 'object')
      .map((m: any) => ({
        role: typeof m.role === 'string' ? m.role : 'user',
        content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
      }));
  } else if (typeof parsedBody.prompt === 'string' && parsedBody.prompt.trim()) {
    messages = [{ role: 'user', content: parsedBody.prompt.trim() }];
  }

  const stream = Boolean(parsedBody.stream);
  const aiResult = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
    messages,
    temperature: 0.7,
    max_tokens: 2048,
    stream,
  });

  const now = Date.now();
  const id = `chatcmpl-cf-${now}`;
  const created = Math.floor(now / 1000);

  if (stream) {
    return createOpenAiSseReadableStream(aiResult, id, created);
  }

  let responseText = '';
  if (aiResult && typeof aiResult === 'object') {
    if (typeof aiResult.response === 'string') {
      responseText = aiResult.response;
    } else if (typeof aiResult.choices?.[0]?.message?.content === 'string') {
      responseText = aiResult.choices[0].message.content;
    } else if (typeof aiResult.text === 'string') {
      responseText = aiResult.text;
    } else {
      responseText = JSON.stringify(aiResult);
    }
  } else if (typeof aiResult === 'string') {
    responseText = aiResult;
  }

  return {
    id,
    object: 'chat.completion',
    created,
    model: '@cf/meta/llama-3.1-8b-instruct',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: responseText,
        },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
