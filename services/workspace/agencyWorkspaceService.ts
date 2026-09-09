/**
 * Agency client workspaces: isolated DNA + history per client (Pro/Agency).
 */

import type { BusinessDNA } from '../../types';
import { entitlementsFor } from '../plans/planEntitlements';
import { noteWorkspaceDirty } from '../sync/workspaceSyncService';

const STORAGE_KEY = 'luminara_agency_workspaces_v1';
const ACTIVE_KEY = 'luminara_agency_active_client';

export interface AgencyClient {
  id: string;
  name: string;
  domains: string[];
  dna: BusinessDNA | null;
  notes: string;
  createdAt: number;
  updatedAt: number;
}

export interface AgencyWorkspaceState {
  clients: AgencyClient[];
  activeClientId: string | null;
}

let memoryState: AgencyWorkspaceState = { clients: [], activeClientId: null };

function canLS(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem('__ag_probe__', '1');
    localStorage.removeItem('__ag_probe__');
    return true;
  } catch {
    return false;
  }
}

function load(): AgencyWorkspaceState {
  if (!canLS()) return { ...memoryState, clients: [...memoryState.clients] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const active = localStorage.getItem(ACTIVE_KEY);
    if (!raw) return { clients: [], activeClientId: active };
    const parsed = JSON.parse(raw) as { clients?: AgencyClient[] };
    return {
      clients: Array.isArray(parsed.clients) ? parsed.clients : [],
      activeClientId: active,
    };
  } catch {
    return { clients: [], activeClientId: null };
  }
}

function save(state: AgencyWorkspaceState): void {
  memoryState = {
    clients: [...state.clients],
    activeClientId: state.activeClientId,
  };
  if (!canLS()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ clients: state.clients }));
    if (state.activeClientId) localStorage.setItem(ACTIVE_KEY, state.activeClientId);
    else localStorage.removeItem(ACTIVE_KEY);
    noteWorkspaceDirty();
  } catch {
    /* ignore */
  }
}

export function getActiveClientId(): string | null {
  return load().activeClientId;
}

export function listClients(): AgencyClient[] {
  return load().clients.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getActiveClient(): AgencyClient | null {
  const state = load();
  if (!state.activeClientId) return null;
  return state.clients.find((c) => c.id === state.activeClientId) || null;
}

export function setActiveClient(clientId: string | null): void {
  const state = load();
  state.activeClientId = clientId;
  save(state);
  // When switching clients, overlay DNA into the live DNA key so audits personalize.
  const client = clientId ? state.clients.find((c) => c.id === clientId) : null;
  if (client?.dna && canLS()) {
    try {
      localStorage.setItem('luminara_business_dna', JSON.stringify(client.dna));
      window.dispatchEvent(new CustomEvent('luminara-workspace-restored', { detail: { clientId } }));
    } catch {
      /* ignore */
    }
  }
}

export function createClient(
  name: string,
  opts?: { domains?: string[]; dna?: BusinessDNA | null; planId?: string | null }
): AgencyClient | { error: string } {
  const limit = entitlementsFor(opts?.planId).agencyClientLimit;
  const state = load();
  if (limit <= 0) {
    return { error: 'Agency clients require the Pro / Agency plan.' };
  }
  if (state.clients.length >= limit) {
    return { error: `Plan allows up to ${limit} client workspaces.` };
  }
  const now = Date.now();
  const client: AgencyClient = {
    id: `client-${now}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim().slice(0, 120) || 'Untitled client',
    domains: (opts?.domains || []).map((d) =>
      d.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase()
    ),
    dna: opts?.dna ?? null,
    notes: '',
    createdAt: now,
    updatedAt: now,
  };
  state.clients.push(client);
  if (!state.activeClientId) state.activeClientId = client.id;
  save(state);
  return client;
}

export function updateClient(
  clientId: string,
  patch: Partial<Pick<AgencyClient, 'name' | 'domains' | 'dna' | 'notes'>>
): AgencyClient | null {
  const state = load();
  const idx = state.clients.findIndex((c) => c.id === clientId);
  if (idx < 0) return null;
  state.clients[idx] = {
    ...state.clients[idx],
    ...patch,
    updatedAt: Date.now(),
  };
  save(state);
  return state.clients[idx];
}

export function deleteClient(clientId: string): void {
  const state = load();
  state.clients = state.clients.filter((c) => c.id !== clientId);
  if (state.activeClientId === clientId) state.activeClientId = state.clients[0]?.id ?? null;
  save(state);
}

export function canUseAgency(planId?: string | null): boolean {
  return entitlementsFor(planId).agencyClientLimit > 0;
}

export const agencyWorkspaceService = {
  list: listClients,
  getActive: getActiveClient,
  getActiveClientId,
  setActive: setActiveClient,
  create: createClient,
  update: updateClient,
  delete: deleteClient,
  canUse: canUseAgency,
  STORAGE_KEY,
  ACTIVE_KEY,
};
