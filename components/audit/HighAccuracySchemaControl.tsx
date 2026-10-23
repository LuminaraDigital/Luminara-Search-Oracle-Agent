import React, { useEffect, useState } from 'react';
import { configService } from '../../services/configService';
import { SCHEMA_HA_ESTIMATE_LABEL } from '../../services/highAccuracy/contract';
import {
  expectedTypeFromSchema,
  failureNote,
  formatAccuracyReceipt,
  requestHighAccuracySchema,
  resolveByokSchemaTarget,
  type HaAccuracy,
} from '../../services/highAccuracy/schemaClient';

interface HighAccuracySchemaControlProps {
  pageUrl: string;
  pageTitle?: string;
  evidence: string;
  existingSchema?: string;
  onApplied: (schemaJsonLd: string) => void;
}

export const HighAccuracySchemaControl: React.FC<HighAccuracySchemaControlProps> = ({
  pageUrl,
  pageTitle,
  evidence,
  existingSchema,
  onApplied,
}) => {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<HaAccuracy | null>(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    setEnabled(false);
    setBusy(false);
    setNote(null);
    setReceipt(null);
    setApplied(false);
  }, [pageUrl, evidence]);

  const target = resolveByokSchemaTarget(configService.getChatModelPreference(), {
    groq: configService.getByokKey('luminara_groq_key'),
    nim: configService.getByokKey('luminara_nvidia_key'),
    nimOrg: configService.getByokKey('luminara_nvidia_org_id'),
    ollama: configService.getByokKey('luminara_ollama_key'),
    ollamaModel: configService.getOllamaModel(),
    openrouter: configService.getByokKey('luminara_openrouter_key'),
  });

  const canRun = enabled && !busy && Boolean(target) && pageUrl.startsWith('http');

  const run = async () => {
    if (!target || !canRun) return;
    setBusy(true);
    setNote(null);
    const result = await requestHighAccuracySchema({
      target,
      pageUrl,
      pageTitle,
      evidence,
      expectedType: expectedTypeFromSchema(existingSchema),
    });
    setBusy(false);
    if (!result.ok) {
      setReceipt(result.accuracy ?? null);
      setNote(failureNote(result));
      return;
    }
    setReceipt(result.accuracy);
    setApplied(true);
    setNote(null);
    onApplied(result.schemaJsonLd);
  };

  const estimate = target
    ? `High-accuracy schema runs the model up to 3 times and keeps the first JSON-LD that passes checks. Estimated ${SCHEMA_HA_ESTIMATE_LABEL} on your ${target.label} key.`
    : 'Add your own Groq, NVIDIA NIM, OpenRouter, or Ollama key in Settings. High-accuracy does not use a hosted key.';

  return (
    <section className="mb-6 rounded-2xl border border-white/10 bg-black/40 p-4" aria-label="High-accuracy schema">
      <label className="flex items-start gap-3 text-sm text-gray-200 cursor-pointer">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-gold"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span>
          <span className="font-semibold text-white">High-accuracy schema</span>
          <span className="block text-xs text-gray-400 mt-1" id="ha-schema-estimate">{estimate}</span>
        </span>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => { void run(); }}
          disabled={!canRun}
          aria-describedby="ha-schema-estimate"
          className="px-3.5 py-2 rounded-xl border border-gold/40 text-xs font-mono text-gold-light disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-gold focus-visible:outline-none"
        >
          {busy ? 'Generating...' : 'Generate JSON-LD'}
        </button>
        <p className="text-[11px] text-gray-500">
          {applied
            ? 'Deploy will use this JSON-LD. The report text stays as it was.'
            : 'The report schema stays in place until a candidate passes.'}
        </p>
      </div>
      {note && (
        <p className="mt-3 text-xs text-amber-200" role="status">{note}</p>
      )}
      {receipt && (
        <p className="mt-2 text-xs font-mono text-gray-300" role="status">{formatAccuracyReceipt(receipt)}</p>
      )}
    </section>
  );
};
