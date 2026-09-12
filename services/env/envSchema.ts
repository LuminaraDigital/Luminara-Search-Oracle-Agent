/**
 * Environment Schema & Validation Service
 * Validates and isolates runtime configurations across local, staging, and production environments.
 */

export type AppEnvironment = 'development' | 'staging' | 'production' | 'test';

export interface ValidatedClientEnv {
  mode: AppEnvironment;
  isStaging: boolean;
  isProduction: boolean;
  apiBase: string;
  firebaseProjectId: string;
  firebaseAuthDomain?: string;
  firebaseApiKey?: string;
}

export interface ValidationResult {
  valid: boolean;
  mode: AppEnvironment;
  errors: string[];
  warnings: string[];
}

/**
 * Validate client environment variables
 */
export function validateClientEnv(envRecord: Record<string, string | undefined>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawMode = (envRecord.MODE || envRecord.NODE_ENV || 'development').toLowerCase();
  let mode: AppEnvironment = 'development';
  if (rawMode.includes('prod')) mode = 'production';
  else if (rawMode.includes('stag')) mode = 'staging';
  else if (rawMode.includes('test')) mode = 'test';

  const firebaseProjectId = envRecord.VITE_FIREBASE_PROJECT_ID || '';
  if (!firebaseProjectId && mode !== 'test') {
    warnings.push('VITE_FIREBASE_PROJECT_ID is not defined; Firebase Auth token checks will be disabled.');
  }

  // Staging Isolation Check
  if (mode === 'staging') {
    if (firebaseProjectId === 'luminara-suite') {
      warnings.push('Staging environment is using the production Firebase Project ID (luminara-suite). A staging sandbox project (e.g. luminara-suite-staging) is recommended.');
    }
  }

  return {
    valid: errors.length === 0,
    mode,
    errors,
    warnings,
  };
}

/**
 * Validate Cloudflare Worker environment bindings
 */
export function validateWorkerEnv(env: Record<string, any>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const environment = (env.ENVIRONMENT || 'production').toLowerCase();
  const mode: AppEnvironment = environment.includes('stag')
    ? 'staging'
    : environment.includes('test')
      ? 'test'
      : 'production';

  if (!env.WEBAPP_URL) {
    errors.push('WEBAPP_URL is required on Worker environment.');
  }

  // Verify KV and D1 database bindings exist
  if (!env.LUMINARA_KV && mode !== 'test') {
    warnings.push('LUMINARA_KV binding missing. KV-backed user metering will fall back to in-memory.');
  }

  if (mode === 'staging') {
    if (env.WEBAPP_URL && env.WEBAPP_URL.includes('https://luminarasuite.com') && !env.WEBAPP_URL.includes('staging.')) {
      errors.push('Staging WEBAPP_URL cannot point to production URL (https://luminarasuite.com).');
    }
  }

  return {
    valid: errors.length === 0,
    mode,
    errors,
    warnings,
  };
}
