package com.luminarasuite.app.core.model

data class AuditChange(
    val domain: String,
    val headline: String,
    val detail: String,
    val improved: Boolean?,
)

/**
 * Compares the two newest audits of each domain. A domain with one audit has nothing to compare,
 * and an audit with no measured gap count is never treated as a change.
 */
fun auditChanges(history: List<AuditHistoryEntry>): List<AuditChange> =
    history
        .groupBy { it.domain }
        .mapNotNull { (domain, audits) ->
            val ordered = audits.sortedByDescending { it.measuredAt }
            val latest = ordered.getOrNull(0)?.schemaGapCount ?: return@mapNotNull null
            val previous = ordered.getOrNull(1)?.schemaGapCount ?: return@mapNotNull null
            when {
                latest < previous ->
                    AuditChange(domain, "${previous - latest} fewer open gaps", "$previous then $latest gaps", true)
                latest > previous ->
                    AuditChange(domain, "${latest - previous} new gaps", "$previous then $latest gaps", false)
                else -> AuditChange(domain, "No change", "$latest gaps on both audits", null)
            }
        }

/** Share of a domain's findings marked done. Null when there is nothing to count. */
fun fixesShipped(
    findings: List<AuditFinding>,
    domain: String?,
): Pair<Int, Int>? {
    val scoped = findings.filter { domain == null || it.domain == domain }
    if (scoped.isEmpty()) return null
    return scoped.count { it.status == "done" } to scoped.size
}
