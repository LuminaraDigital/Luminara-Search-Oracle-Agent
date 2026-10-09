import { describe, it, expect, beforeEach } from 'vitest';
import { autoLockService } from '../services/security/autoLockService';

describe('AutoLockService', () => {
  beforeEach(() => {
    autoLockService.clearPin();
  });

  it('reports hasPinSet false by default', () => {
    expect(autoLockService.hasPinSet()).toBe(false);
    expect(autoLockService.isLocked()).toBe(false);
  });

  it('sets a PIN and verifies it successfully', async () => {
    await autoLockService.setPin('1234');
    expect(autoLockService.hasPinSet()).toBe(true);

    const valid = await autoLockService.verifyPin('1234');
    expect(valid).toBe(true);

    const invalid = await autoLockService.verifyPin('9999');
    expect(invalid).toBe(false);
  });

  it('locks and unlocks with valid PIN', async () => {
    await autoLockService.setPin('8888');
    autoLockService.lock();
    expect(autoLockService.isLocked()).toBe(true);

    const wrongAttempt = await autoLockService.unlock('0000');
    expect(wrongAttempt).toBe(false);
    expect(autoLockService.isLocked()).toBe(true);

    const correctAttempt = await autoLockService.unlock('8888');
    expect(correctAttempt).toBe(true);
    expect(autoLockService.isLocked()).toBe(false);
  });

  it('allows updating timeout setting', () => {
    autoLockService.setTimeout(300);
    expect(autoLockService.getTimeout()).toBe(300);

    autoLockService.setTimeout(0);
    expect(autoLockService.getTimeout()).toBe(0);
  });

  it('rejects short PINs under 4 characters', async () => {
    await expect(autoLockService.setPin('12')).rejects.toThrow(/at least 4/i);
  });
});
