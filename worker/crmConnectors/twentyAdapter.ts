/**
 * Clean-Room Twenty CRM GraphQL & Webhook Sync Adapter (Stage 5)
 *
 * Architectural & Licensing Boundary:
 * - Twenty (`twentyhq/twenty`) is licensed under AGPLv3 with `@license Enterprise` modules.
 * - Luminara never embeds Twenty server code. Instead, Luminara acts as the operational
 *   visibility + enquiry layer and synchronizes Contacts, Properties, Enquiries, and
 *   Opportunities with a customer's self-hosted or cloud Twenty workspace over HTTPS GraphQL.
 */

import { validateCmsEndpoint } from '../../services/deployment/cmsEndpointValidator';

export interface TwentySyncConfig {
  baseUrl: string;
  apiKey: string;
  workspaceName?: string;
}

export interface TwentyContactPayload {
  luminaraContactId: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  consentStatus: string;
}

export interface TwentyOpportunityPayload {
  luminaraEnquiryId: string;
  name: string;
  stage: string;
  intentType: string;
  propertyAddress?: string | null;
  contactExternalId?: string | null;
}

export interface TwentySyncResult {
  ok: boolean;
  externalId?: string;
  operation: 'createPerson' | 'createOpportunity';
  error?: string;
}

export function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Prospect', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: '' };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(' '),
  };
}

export function buildTwentyCreatePersonMutation(contact: TwentyContactPayload): {
  query: string;
  variables: Record<string, unknown>;
} {
  return {
    query: `mutation CreateLuminaraPerson($data: PersonCreateInput!) {
      createPerson(data: $data) {
        id
        name {
          firstName
          lastName
        }
      }
    }`,
    variables: {
      data: {
        name: {
          firstName: contact.firstName,
          lastName: contact.lastName,
        },
        emails: contact.email ? { primaryEmail: contact.email } : undefined,
        phones: contact.phone ? { primaryPhoneNumber: contact.phone } : undefined,
      },
    },
  };
}

export function buildTwentyCreateOpportunityMutation(opp: TwentyOpportunityPayload): {
  query: string;
  variables: Record<string, unknown>;
} {
  return {
    query: `mutation CreateLuminaraOpportunity($data: OpportunityCreateInput!) {
      createOpportunity(data: $data) {
        id
        name
        stage
      }
    }`,
    variables: {
      data: {
        name: opp.propertyAddress
          ? `${opp.name} - ${opp.propertyAddress}`
          : opp.name,
        stage: opp.stage,
        pointOfContactId: opp.contactExternalId || undefined,
      },
    },
  };
}

async function executeTwentyGraphqlMutation<TData>(
  config: TwentySyncConfig,
  operation: 'createPerson' | 'createOpportunity',
  body: { query: string; variables: Record<string, unknown> },
  extractId: (data: TData | undefined) => string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<TwentySyncResult> {
  const check = validateCmsEndpoint(config.baseUrl);
  if (!check.ok) {
    return { ok: false, operation, error: `Invalid Twenty endpoint: ${check.error}` };
  }
  if (!config.apiKey?.trim()) {
    return { ok: false, operation, error: 'Twenty API key is required.' };
  }

  const graphqlUrl = `${check.url.replace(/\/+$/, '')}/graphql`;
  try {
    const res = await fetchFn(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return {
        ok: false,
        operation,
        error: `Twenty GraphQL returned HTTP ${res.status}`,
      };
    }

    const parsed = (await res.json()) as {
      data?: TData;
      errors?: Array<{ message?: string }>;
    };

    if (parsed.errors && parsed.errors.length > 0) {
      return {
        ok: false,
        operation,
        error: parsed.errors[0]?.message || 'Twenty GraphQL mutation error',
      };
    }

    const externalId = extractId(parsed.data);
    if (!externalId) {
      return {
        ok: false,
        operation,
        error: `Twenty GraphQL response did not include ${operation}.id`,
      };
    }

    return {
      ok: true,
      operation,
      externalId,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      operation,
      error: err instanceof Error ? err.message : 'Network failure calling Twenty GraphQL API',
    };
  }
}

export async function syncContactToTwenty(
  config: TwentySyncConfig,
  contact: TwentyContactPayload,
  fetchFn: typeof fetch = fetch,
): Promise<TwentySyncResult> {
  return executeTwentyGraphqlMutation<{ createPerson?: { id?: string } }>(
    config,
    'createPerson',
    buildTwentyCreatePersonMutation(contact),
    (data) => data?.createPerson?.id,
    fetchFn,
  );
}

export async function syncOpportunityToTwenty(
  config: TwentySyncConfig,
  opp: TwentyOpportunityPayload,
  fetchFn: typeof fetch = fetch,
): Promise<TwentySyncResult> {
  return executeTwentyGraphqlMutation<{ createOpportunity?: { id?: string } }>(
    config,
    'createOpportunity',
    buildTwentyCreateOpportunityMutation(opp),
    (data) => data?.createOpportunity?.id,
    fetchFn,
  );
}
