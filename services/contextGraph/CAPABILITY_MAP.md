# Luminara Context Graph: Capability Map

Clean-room TypeScript layer for AEO/SEO/Oracle workflows. Inspired by graph-native context-layer patterns; original Luminara implementation (no Semantica source, no Python runtime).

| Capability idea | Luminara API |
| --- | --- |
| Context graph nodes/edges | `contextGraphStore.addNode`, `addEdge`, `getNeighbors` |
| Decision intelligence | `decisionService.recordDecision`, `addCausalLink`, `traceChain`, `findSimilar` |
| Provenance / lineage | `provenanceService.track`, `getTrail` |
| Entity extraction | `entityExtractService.fromBusinessDNA`, `fromAuditReport` |
| Conflict detection | `conflictService.detectConflicts` |
| Rule / policy gates | `aeoRuleEngine.runRules` |
| Hybrid retrieval | `hybridRetrieve.query` (graph + VFS DRR) |
| JSON-LD / audit export | `jsonLdExporter.exportOrganization`, `exportProvenance` |
| Facade for UI/CLI | `contextGraphService` |

Persistence key: `luminara_context_graph`. CLI group: `kg`. Harness tab: `graph`.
