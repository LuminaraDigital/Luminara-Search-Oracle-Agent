import { configService } from '../configService';

/** Mic button gate. Kept off @google/genai so the composer does not pull the SDK. */
export function liveVoiceAvailable(): boolean {
  const key = configService.getGeminiKey();
  return Boolean(key && key !== 'proxy');
}
