import { configService } from './configService';

export interface FalGenerateResult {
  imageUrl?: string;
  images?: Array<{ url: string; width?: number; height?: number }>;
  seed?: number;
  prompt?: string;
  error?: string;
}

export class FalService {
  private static instance: FalService;

  private constructor() {}

  public static getInstance(): FalService {
    if (!FalService.instance) {
      FalService.instance = new FalService();
    }
    return FalService.instance;
  }

  public async generateImage(prompt: string, model: string = 'fal-ai/flux/schnell'): Promise<FalGenerateResult> {
    const apiKey = configService.getFalKey();
    if (!apiKey) {
      console.warn('[Fal] No Fal.ai API Key configured');
      return { error: 'No Fal.ai API Key configured' };
    }

    try {
      const response = await fetch(`https://fal.run/${model}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Key ${apiKey}`,
        },
        body: JSON.stringify({
          prompt,
          image_size: 'landscape_4_3',
          num_inference_steps: 4,
          num_images: 1,
          enable_safety_checker: true,
        }),
      });

      if (!response.ok) {
        throw new Error(`Fal.ai error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const firstImage = data.images?.[0]?.url || data.image?.url;
      return {
        imageUrl: firstImage,
        images: data.images,
        seed: data.seed,
        prompt,
      };
    } catch (err: any) {
      console.error('[Fal] Image generation failed:', err);
      return { error: err?.message || 'Generation failed' };
    }
  }
}

export const falService = FalService.getInstance();
