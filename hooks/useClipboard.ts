import { useState, useCallback, useRef, useEffect } from 'react';
import { copyToClipboard } from '../utils/clipboard';

export interface UseClipboardOptions {
  timeout?: number;
  onSuccess?: () => void;
  onError?: () => void;
}

export function useClipboard(options: UseClipboardOptions = {}) {
  const { timeout = 2000, onSuccess, onError } = options;
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const copy = useCallback(async (text: string): Promise<boolean> => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
      }, timeout);
      onSuccess?.();
    } else {
      onError?.();
    }
    return success;
  }, [timeout, onSuccess, onError]);

  return { copied, copy };
}
