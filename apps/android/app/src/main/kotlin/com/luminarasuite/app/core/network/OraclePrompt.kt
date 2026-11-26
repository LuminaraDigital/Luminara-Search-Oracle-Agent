package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.model.GroqChatRequest
import com.luminarasuite.app.core.model.GroqMessage
import com.luminarasuite.app.core.model.OracleTurn
import com.luminarasuite.app.core.model.TavilyResult

internal fun buildOracleChatRequest(
    question: String,
    sources: List<TavilyResult>,
    earlierTurns: List<OracleTurn> = emptyList(),
    site: String? = null,
): GroqChatRequest {
    val evidenceBlock =
        if (sources.isEmpty()) {
            "Live search evidence: not_measured (no search results returned)."
        } else {
            sources.mapIndexed { idx, item ->
                "[${idx + 1}] ${item.title} (${item.url}): ${item.content.take(240)}"
            }.joinToString("\n")
        }
    val systemPrompt =
        "You are Luminara Search Oracle, an evidence-bound SEO, AEO, and GEO advisor.\n" +
            "1. Never invent SEO metrics or citation percentages. Use not_measured when data is missing.\n" +
            "2. Never use the em dash character anywhere. Use a hyphen, colon, or period.\n" +
            "3. /llms.txt is a Markdown file at a site's root that tells AI assistants what the site offers: " +
            "an H1 with the brand, a blockquote summary, then H2 sections of canonical links. " +
            "It does not list AI models.\n" +
            "4. Never say a site is or is not indexed, cited, or missing something unless the evidence shows it. " +
            "If the question needs a site and none is given, say so and ask them to run an audit in the app.\n" +
            "5. Format your response as two lines:\n" +
            "VERDICT: <concise 1-2 sentence verdict>\n" +
            "NEXT_ACTION: <one concrete action to execute this week>"
    val siteLine = site?.let { "\nThe user's site, from their latest audit: $it" }.orEmpty()
    return GroqChatRequest(
        messages =
        buildList {
            add(GroqMessage(role = "system", content = systemPrompt))
            earlierTurns.reversed().forEach { turn ->
                add(GroqMessage(role = "user", content = turn.question))
                add(
                    GroqMessage(
                        role = "assistant",
                        content = "VERDICT: ${turn.verdict}\nNEXT_ACTION: ${turn.nextAction}",
                    ),
                )
            }
            add(GroqMessage(role = "user", content = "Question: $question$siteLine\n\n$evidenceBlock"))
        },
    )
}
