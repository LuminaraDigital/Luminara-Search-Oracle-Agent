/**
 * Shared APS types for projects, context, and agent reports.
 */

export const TYPED_CONTEXT_KEYS = [
  'business_overview',
  'current_goal',
  'positioning',
  'writing_preferences',
] as const;

export type TypedContextKey = (typeof TYPED_CONTEXT_KEYS)[number];

export type ContextAuthor = 'user' | 'oracle' | 'mcp' | 'onboarding';

export type KeyPageRole = 'hub' | 'spoke' | 'money' | 'other';

export type McpCreditClass = 'free' | 'paid';

export interface SeoProject {
  id: string;
  accountId: string;
  clientId: string;
  domain: string;
  name: string;
  defaultLocationCode: string | null;
  defaultLanguageCode: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectContextSection {
  key: string;
  title: string | null;
  content: string;
  updatedAt: number;
  updatedBy: ContextAuthor;
}

export interface ProjectCompetitor {
  id: string;
  domain: string;
  name: string | null;
  notes: string | null;
  updatedAt: number;
  updatedBy: ContextAuthor;
}

export interface ProjectKeyPage {
  id: string;
  url: string;
  role: KeyPageRole;
  topic: string | null;
  notes: string | null;
  updatedAt: number;
  updatedBy: ContextAuthor;
}

export interface ProjectResearchLogEntry {
  id: string;
  entryDate: string;
  summary: string;
  createdBy: ContextAuthor;
  createdAt: number;
}

export interface ProjectContextBundle {
  projectId: string;
  sections: ProjectContextSection[];
  missingSections: TypedContextKey[];
  competitors: ProjectCompetitor[];
  keyPages: ProjectKeyPage[];
  researchLog: ProjectResearchLogEntry[];
  digestMarkdown: string;
}

export type ProjectContextPatch =
  | { section: TypedContextKey; content: string }
  | { customSection: string; title?: string; content: string }
  | { deleteCustomSection: string }
  | { addCompetitors: Array<{ domain: string; name?: string; notes?: string }> }
  | { removeCompetitors: string[] }
  | {
      addKeyPages: Array<{
        url: string;
        role: KeyPageRole;
        topic?: string;
        notes?: string;
      }>;
    }
  | { removeKeyPages: string[] }
  | { appendResearchLog: { summary: string } }
  | { removeResearchLog: string[] };

export interface AgentReportSummary {
  id: string;
  projectId: string;
  title: string;
  summary: string;
  skill: string | null;
  createdByLabel: string | null;
  sizeBytes: number;
  createdAt: number;
  updatedAt: number;
  url: string;
}

export interface AgentReport extends AgentReportSummary {
  html: string;
  shareId: string | null;
}

export const SECTION_CHAR_CAP = 4000;
export const CUSTOM_SECTION_CAP = 20;
export const COMPETITOR_CAP = 100;
export const KEY_PAGE_CAP = 100;
export const RESEARCH_LOG_DAYS = 90;
export const REPORT_SUMMARY_CAP = 2500;
export const REPORT_HTML_BYTE_CAP = 500_000;
export const REPORT_TITLE_CAP = 120;
