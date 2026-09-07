import { TriageReport } from '../../types';

export const SAMPLE_CRASH_SCENARIOS = [
  {
    title: 'KV-Cache Memory Exhaustion in MoE Layer 12',
    source: 'OracleMind SLM Runtime',
    severity: 'high' as const,
    trace: `RuntimeError: CUDA out of memory. Tried to allocate 512.00 MiB (GPU 0; 15.74 GiB total capacity; 14.82 GiB already allocated; 312.00 MiB free; 15.02 GiB reserved in total by PyTorch)
  File "luminara_mind/model.py", line 284, in forward
    kv_cache = torch.cat([kv_cache, new_kv], dim=2)
  File "luminara_mind/attention.py", line 142, in grouped_query_attention
    scores = torch.matmul(q, k.transpose(-2, -1)) * self.scale`,
    rootCausePlain: 'The neural network ran out of graphics card memory while processing a very long conversation because the attention cache got too large.',
    rootCauseTechnical: 'Unbounded Key-Value cache allocation during GQA forward pass in Layer 12 when sequence length exceeded max_position_embeddings (8,192 tokens) without YaRN dynamic chunking.',
    affectedComponents: ['services/oracleMind/oracleMindEngine.ts', 'luminara_mind/model.py'],
    recommendedFix: 'Implement sliding-window attention with YaRN rotary positional scaling and 4-bit KV quantization (FP8 / INT4) to cap memory allocation at 256MB.',
    codeDiff: `--- a/luminara_mind/model.py
+++ b/luminara_mind/model.py
@@ -281,4 +281,7 @@
-        kv_cache = torch.cat([kv_cache, new_kv], dim=2)
+        if kv_cache.shape[2] > self.config.sliding_window:
+            kv_cache = kv_cache[:, :, -self.config.sliding_window:]
+        kv_cache = torch.cat([kv_cache, new_kv], dim=2)`
  },
  {
    title: 'Malformed JSON-LD Schema Entity Graph',
    source: 'SERP Ingestion Pipeline',
    severity: 'medium' as const,
    trace: `SyntaxError: Unexpected token '}' in JSON-LD script block at line 42:
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": "Enterprise Audit",
    "offers": {
      "@type": "Offer",
      "price": "4900",
    }
  }
  </script>`,
    rootCausePlain: 'The website has a typo in its hidden structured data (an extra comma before a closing bracket), which causes search engines and AI assistants to ignore the product info.',
    rootCauseTechnical: 'Trailing comma after "price": "4900" violates RFC 8259 JSON specifications, triggering unhandled parse exception in strict JSON-LD AST builders.',
    affectedComponents: ['services/seo/SiteAuditService.ts', 'components/audit/InstantAuditView.tsx'],
    recommendedFix: 'Apply a resilient non-strict JSON parser with trailing comma sanitization prior to AST validation.',
    codeDiff: `--- a/services/seo/SiteAuditService.ts
+++ b/services/seo/SiteAuditService.ts
@@ -45,3 +45,5 @@
-      const parsed = JSON.parse(rawJsonLd);
+      const sanitized = rawJsonLd.replace(/,\\s*([}\\]])/g, '$1');
+      const parsed = JSON.parse(sanitized);`
  },
  {
    title: 'Provider Rate Limit 429 & Quota Exhaustion',
    source: 'Claude Code API Runner',
    severity: 'critical' as const,
    trace: `AnthropicRateLimitError: 429 Too Many Requests
  {
    "type": "error",
    "error": {
      "type": "rate_limit_error",
      "message": "Number of request tokens has exceeded your per-minute rate limit (TPM). Limit: 40,000 TPM; current: 42,850 TPM."
    }
  }`,
    rootCausePlain: 'Too many words were sent to Claude within one minute, temporarily pausing responses until the timer resets.',
    rootCauseTechnical: 'Token-per-minute (TPM) burst ceiling breached during recursive codebase tree indexing without rate-limiter backoff.',
    affectedComponents: ['services/harness/agentMatrixService.ts'],
    recommendedFix: 'Activate exponential backoff with jitter and automatically fall back to Oracle Agent (Gemini 3 Pro) or local SLM when rate-limited.',
    codeDiff: `--- a/services/harness/agentMatrixService.ts
+++ b/services/harness/agentMatrixService.ts
@@ -102,3 +102,6 @@
+      if (error.status === 429) {
+        return this.dispatchPrompt(prompt, 'oracle', mode);
+      }`
  }
];

class TriageService {
  private reports: TriageReport[] = [];
  private listeners: Array<() => void> = [];

  constructor() {
    this.reports = SAMPLE_CRASH_SCENARIOS.map((sc, i) => ({
      id: `triage_init_${i}`,
      timestamp: Date.now() - (i + 1) * 3600000,
      errorTitle: sc.title,
      source: sc.source,
      severity: sc.severity,
      rawTrace: sc.trace,
      rootCausePlain: sc.rootCausePlain,
      rootCauseTechnical: sc.rootCauseTechnical,
      affectedComponents: sc.affectedComponents,
      recommendedFix: sc.recommendedFix,
      codeDiff: sc.codeDiff,
      rollbackAvailable: true,
      status: i === 0 ? 'open' : 'resolved'
    }));
  }

  public getReports(): TriageReport[] {
    return [...this.reports];
  }

  public analyzeError(title: string, rawTrace: string, source: string = 'User Submitted'): TriageReport {
    const isOom = rawTrace.toLowerCase().includes('out of memory') || rawTrace.toLowerCase().includes('oom');
    const isSyntax = rawTrace.toLowerCase().includes('syntaxerror') || rawTrace.toLowerCase().includes('unexpected');
    const isRateLimit = rawTrace.toLowerCase().includes('429') || rawTrace.toLowerCase().includes('rate limit');

    let severity: 'critical' | 'high' | 'medium' | 'low' = 'medium';
    let rootCausePlain = 'An unexpected runtime condition stopped execution.';
    let rootCauseTechnical = 'Unhandled exception in execution loop.';
    let recommendedFix = 'Wrap operation in safe boundary and verify input sanitization.';
    let codeDiff = `--- a/src/index.ts\n+++ b/src/index.ts\n@@ -1,3 +1,5 @@\n+try {\n   // verified execution\n+} catch (e) { console.error(e); }`;

    if (isOom) {
      severity = 'critical';
      rootCausePlain = 'The system ran out of computational memory while handling large tensors or files.';
      rootCauseTechnical = 'Memory footprint exceeded available hardware capacity in forward pass buffer.';
      recommendedFix = 'Activate tensor gradient checkpointing, reduce batch size, or enable 4-bit quantization.';
      codeDiff = `--- a/config.py\n+++ b/config.py\n@@ -12,2 +12,4 @@\n-    batch_size = 32\n+    batch_size = 8\n+    gradient_checkpointing = True`;
    } else if (isSyntax) {
      severity = 'high';
      rootCausePlain = 'A formatting error or typo prevented the code or data from being understood.';
      rootCauseTechnical = 'Token parser encountered unexpected character violating grammar specification.';
      recommendedFix = 'Validate schema formatting with strict pre-parser linting.';
    } else if (isRateLimit) {
      severity = 'high';
      rootCausePlain = 'The external AI provider is temporarily busy because too many requests were made at once.';
      rootCauseTechnical = 'HTTP 429 Too Many Requests due to TPM/RPM quota threshold breach.';
      recommendedFix = 'Implement exponential backoff retry policy and hot-swap to local OracleMind SLM.';
    }

    const report: TriageReport = {
      id: `triage_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      errorTitle: title || 'Runtime Diagnostic Incident',
      source,
      severity,
      rawTrace,
      rootCausePlain,
      rootCauseTechnical,
      affectedComponents: ['Runtime Execution Loop', 'Agent Dispatcher'],
      recommendedFix,
      codeDiff,
      rollbackAvailable: true,
      status: 'open'
    };

    this.reports.unshift(report);
    this.notify();
    return report;
  }

  public resolveReport(id: string): void {
    const rep = this.reports.find(r => r.id === id);
    if (rep) {
      rep.status = 'resolved';
      this.notify();
    }
  }

  public subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  private notify(): void {
    this.listeners.forEach(fn => fn());
  }
}

export const triageService = new TriageService();
