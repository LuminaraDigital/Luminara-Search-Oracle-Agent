import { describe, it, expect, beforeEach, vi } from 'vitest';
import { notebookService, DEMO_NOTEBOOK } from '../services/notebook/notebookService';
import { BusinessDNA, NotebookSource } from '../types';

const storage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (k: string) => storage[k] || null,
  setItem: (k: string, v: string) => { storage[k] = String(v); },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
};

if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = globalThis;
}
(globalThis as any).localStorage = mockLocalStorage;

describe('NotebookService', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('initializes with default demo notebook when storage is empty', () => {
    const list = notebookService.listNotebooks();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].id).toBe(DEMO_NOTEBOOK.id);
    expect(list[0].sources.length).toBeGreaterThanOrEqual(3);
  });

  it('creates and switches active notebook', () => {
    const created = notebookService.createNotebook('Q4 Competitor Research', 'Competitive analysis for 2026');
    expect(created.title).toBe('Q4 Competitor Research');
    expect(created.description).toBe('Competitive analysis for 2026');
    expect(notebookService.getActiveNotebookId()).toBe(created.id);

    const retrieved = notebookService.getNotebook(created.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.title).toBe('Q4 Competitor Research');
  });

  it('adds text source and calculates word count and keywords', () => {
    const nb = notebookService.createNotebook('Test Notebook');
    const source = notebookService.addTextSource(
      nb.id,
      'Competitor Entity Strategy',
      'Entity authority requires Organization schema markup linked to Wikidata and Crunchbase. This produces consistent AI Overviews citations across ChatGPT and Google.'
    );

    expect(source.title).toBe('Competitor Entity Strategy');
    expect(source.type).toBe('text');
    expect(source.wordCount).toBeGreaterThan(15);
    expect(source.selected).toBe(true);

    const updated = notebookService.getNotebook(nb.id);
    expect(updated?.sources.length).toBe(1);
    expect(updated?.sources[0].id).toBe(source.id);
  });

  it('adds Business DNA source into notebook', () => {
    const nb = notebookService.createNotebook('DNA Notebook');
    const mockDna: BusinessDNA = {
      name: 'Acme AI',
      mission: 'Democratize search intelligence',
      usp: 'Zero-latency on-device verification',
      targetAudience: 'Growth founders and marketers',
      competitors: ['ApexRank', 'PilotSEO'],
      perceivedGaps: ['Weak JSON-LD schema'],
      rawContext: 'Acme AI is a leading search visibility intelligence engine.',
      industry: 'Software & AI',
    };

    const source = notebookService.addDnaSource(nb.id, mockDna);
    expect(source.type).toBe('dna');
    expect(source.title).toContain('Acme AI');
    expect(source.content).toContain('Zero-latency on-device verification');
    expect(source.keyEntities).toContain('Acme AI');
  });

  it('toggles source selection and removes source', () => {
    const nb = notebookService.createNotebook('Toggle Notebook');
    const s1 = notebookService.addTextSource(nb.id, 'Source 1', 'Content 1');
    const s2 = notebookService.addTextSource(nb.id, 'Source 2', 'Content 2');

    expect(s1.selected).toBe(true);
    expect(s2.selected).toBe(true);

    notebookService.toggleSourceSelection(nb.id, s1.id);
    let updated = notebookService.getNotebook(nb.id);
    expect(updated?.sources.find(s => s.id === s1.id)?.selected).toBe(false);
    expect(updated?.sources.find(s => s.id === s2.id)?.selected).toBe(true);

    notebookService.toggleAllSources(nb.id, false);
    updated = notebookService.getNotebook(nb.id);
    expect(updated?.sources.every(s => !s.selected)).toBe(true);

    notebookService.removeSource(nb.id, s1.id);
    updated = notebookService.getNotebook(nb.id);
    expect(updated?.sources.length).toBe(1);
    expect(updated?.sources[0].id).toBe(s2.id);
  });

  it('parses structured citations and quotes from model output', () => {
    const mockSources: NotebookSource[] = [
      {
        id: 's1',
        title: 'Luminara Guidelines',
        type: 'text',
        content: 'Direct answers under H2 headers win 73% more citations.',
        summary: 'Direct answers guidance',
        wordCount: 10,
        addedAt: Date.now(),
        selected: true,
      },
      {
        id: 's2',
        title: 'Competitor ApexRank',
        type: 'text',
        content: 'ApexRank has a 28% citation rate due to missing sameAs links.',
        summary: 'ApexRank report',
        wordCount: 11,
        addedAt: Date.now(),
        selected: true,
      },
    ];

    const rawModelOutput = `You should optimize your headers [1] and take advantage of ApexRank's weak citation rate [2].

<!-- CITATIONS -->
[1]: "Direct answers under H2 headers win 73% more citations."
[2]: "ApexRank has a 28% citation rate due to missing sameAs links."
<!-- END_CITATIONS -->`;

    const { cleanContent, citations } = notebookService.parseCitations(rawModelOutput, mockSources);

    expect(cleanContent).toContain('You should optimize your headers [1]');
    expect(cleanContent).not.toContain('<!-- CITATIONS -->');
    expect(citations.length).toBe(2);
    expect(citations[0].citationNumber).toBe(1);
    expect(citations[0].sourceId).toBe('s1');
    expect(citations[0].quote).toBe('Direct answers under H2 headers win 73% more citations.');
    expect(citations[1].citationNumber).toBe(2);
    expect(citations[1].sourceId).toBe('s2');
  });

  it('manages scratchpad notes and exports markdown', () => {
    const nb = notebookService.createNotebook('Notes Notebook');
    const note = notebookService.addNote(nb.id, 'Action Item', 'Audit Schema graph this Friday', ['Schema', 'Sprint']);
    expect(note.title).toBe('Action Item');

    notebookService.updateNote(nb.id, note.id, { title: 'Updated Action Item' });
    let updated = notebookService.getNotebook(nb.id);
    expect(updated?.notes[0].title).toBe('Updated Action Item');

    const mdExport = notebookService.exportNotebookMarkdown(nb.id);
    expect(mdExport).toContain('# Notes Notebook');
    expect(mdExport).toContain('### Updated Action Item');

    notebookService.deleteNote(nb.id, note.id);
    updated = notebookService.getNotebook(nb.id);
    expect(updated?.notes.length).toBe(0);
  });
});
