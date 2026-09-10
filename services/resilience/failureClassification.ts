/**
 * Failure Classification Engine
 * Adapted from OmniRoute (src/lib/resilience/failureClassification.ts, MIT License).
 *
 * Categorizes upstream provider failures to distinguish retryable errors (transient rate limits,
 * network hiccups) from non-retryable errors (invalid API keys, exhausted quota balances).
 */

export type ProviderFailureType =
  | 'authentication_error'
  | 'rate_limit'
  | 'quota_exhausted'
  | 'timeout'
  | 'network_error'
  | 'provider_5xx'
  | 'invalid_request'
  | 'model_unavailable'
  | 'permission_error'
  | 'unknown';

export interface ProviderFailure {
  type: ProviderFailureType;
  retryable: boolean;
  providerId: string;
  statusCode?: number;
  retryAfter?: number;
  message: string;
}

export function classifyProviderFailure(input: {
  providerId: string;
  statusCode?: number;
  code?: string;
  message?: string;
  retryAfter?: number;
}): ProviderFailure {
  const message = input.message?.trim() || 'Provider request failed';
  const normalized = `${input.code ?? ''} ${message}`.toLowerCase();
  const status = input.statusCode;
  let type: ProviderFailureType = 'unknown';
  let retryable = false;

  if (
    status === 401 ||
    status === 403 ||
    /invalid.*(key|token)|unauthori[sz]ed|forbidden/.test(normalized)
  ) {
    type =
      status === 403 || normalized.includes('permission')
        ? 'permission_error'
        : 'authentication_error';
    retryable = false;
  } else if (status === 408 || status === 504 || /timeout|timed out|etimedout/.test(normalized)) {
    type = 'timeout';
    retryable = true;
  } else if (status === 429 || /rate.?limit|too many requests|retry.?after/.test(normalized)) {
    type = /quota|insufficient balance|credits exhausted|balance is \$0|exceeded your current quota/.test(normalized)
      ? 'quota_exhausted'
      : 'rate_limit';
    retryable = type === 'rate_limit';
  } else if (status !== undefined && status >= 500) {
    type = 'provider_5xx';
    retryable = true;
  } else if (status === 400 || /invalid request|malformed|unsupported parameter/.test(normalized)) {
    type = 'invalid_request';
    retryable = false;
  } else if (status === 404 || /model unavailable|model not found|unknown model/.test(normalized)) {
    type = 'model_unavailable';
    retryable = false;
  } else if (/network|econnreset|econnrefused|enotfound|fetch failed|socket/.test(normalized)) {
    type = 'network_error';
    retryable = true;
  }

  return {
    type,
    retryable,
    providerId: input.providerId,
    ...(status !== undefined ? { statusCode: status } : {}),
    ...(input.retryAfter !== undefined ? { retryAfter: input.retryAfter } : {}),
    message,
  };
}
