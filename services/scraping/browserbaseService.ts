import { configService } from '../configService';

export interface BrowserbaseSession {
  id: string;
  status: string;
  createdAt: string;
  connectUrl?: string;
}

export class BrowserbaseService {
  private static instance: BrowserbaseService;

  private constructor() {}

  public static getInstance(): BrowserbaseService {
    if (!BrowserbaseService.instance) {
      BrowserbaseService.instance = new BrowserbaseService();
    }
    return BrowserbaseService.instance;
  }

  public async createSession(projectId?: string): Promise<BrowserbaseSession | null> {
    const apiKey = configService.getBrowserbaseKey();
    if (!apiKey) {
      console.warn('[Browserbase] No Browserbase API Key configured');
      return null;
    }

    try {
      const body: any = {};
      if (projectId) body.projectId = projectId;

      const response = await fetch('https://api.browserbase.com/v1/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-BB-API-Key': apiKey,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Browserbase error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return {
        id: data.id,
        status: data.status,
        createdAt: data.createdAt,
        connectUrl: data.connectUrl,
      };
    } catch (err) {
      console.error('[Browserbase] Session creation failed:', err);
      return null;
    }
  }
}

export const browserbaseService = BrowserbaseService.getInstance();
