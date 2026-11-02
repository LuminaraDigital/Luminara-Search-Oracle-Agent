package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.model.AudioOverview
import com.luminarasuite.app.core.model.AuditRunResponse
import com.luminarasuite.app.core.model.ByokKeyBag
import com.luminarasuite.app.core.model.GeminiContent
import com.luminarasuite.app.core.model.GeminiGenerateRequest
import com.luminarasuite.app.core.model.GeminiPart
import com.luminarasuite.app.core.model.GroqChatRequest
import com.luminarasuite.app.core.model.GroqChatResponse
import com.luminarasuite.app.core.model.GroqMessage
import com.luminarasuite.app.core.model.GroqStreamChunk
import com.luminarasuite.app.core.model.OracleTurn
import com.luminarasuite.app.core.model.TavilyResult
import kotlinx.serialization.json.Json
import okhttp3.ResponseBody

private val STREAM_JSON = Json { ignoreUnknownKeys = true }
private const val NIM_DEFAULT_MODEL = "meta/llama-3.3-70b-instruct"

data class LlmCompletion(
    val content: String,
    val modelLabel: String,
)

private fun deltaFrom(data: String): String? =
    runCatching { STREAM_JSON.decodeFromString<GroqStreamChunk>(data) }
        .getOrNull()
        ?.choices
        ?.firstOrNull()
        ?.delta
        ?.content

/** Accepts SSE, and also a plain JSON body when the relay falls back to a non-streaming answer. */
suspend fun readModelStream(
    body: ResponseBody,
    onDelta: suspend (String) -> Unit,
) {
    body.use { response ->
        val source = response.source()
        val plain = StringBuilder()
        var line = source.readUtf8Line()
        while (line != null && line.removePrefix("data:").trim() != "[DONE]") {
            if (line.startsWith("data:")) {
                deltaFrom(line.removePrefix("data:").trim())?.takeIf { it.isNotEmpty() }?.let { onDelta(it) }
            } else if (line.isNotBlank() && !line.startsWith(":") && !line.startsWith("event:")) {
                plain.append(line)
            }
            line = source.readUtf8Line()
        }
        if (plain.isNotEmpty()) {
            runCatching { STREAM_JSON.decodeFromString<GroqChatResponse>(plain.toString()) }
                .getOrNull()
                ?.choices
                ?.firstOrNull()
                ?.message
                ?.content
                ?.takeIf { it.isNotEmpty() }
                ?.let { onDelta(it) }
        }
    }
}

fun streamingVerdict(raw: String): String =
    raw.replace("\u2014", "-")
        .substringBefore("NEXT_ACTION")
        .removePrefix("VERDICT:")
        .trim()

suspend fun completeLlmChat(
    api: LuminaraApi,
    keys: ByokKeyBag,
    request: GroqChatRequest,
    auditRun: AuditRunResponse? = null,
): LlmCompletion {
    val groqKey = keys.groqKey.takeIf { it.isNotBlank() }
    val nimKey = keys.nimKey.takeIf { it.isNotBlank() }
    val geminiKey = keys.geminiKey.takeIf { it.isNotBlank() }
    return when {
        groqKey != null -> {
            val res =
                api.chatGroq(
                    providerKey = groqKey,
                    auditRun = auditRun?.token,
                    auditDomain = auditRun?.domain,
                    body = request,
                )
            LlmCompletion(res.choices.firstOrNull()?.message?.content.orEmpty(), "Groq LPU (BYOK)")
        }
        nimKey != null -> {
            val res =
                api.chatNim(
                    providerKey = nimKey,
                    auditRun = auditRun?.token,
                    auditDomain = auditRun?.domain,
                    body = request.copy(model = NIM_DEFAULT_MODEL),
                )
            LlmCompletion(res.choices.firstOrNull()?.message?.content.orEmpty(), "NVIDIA NIM (BYOK)")
        }
        geminiKey != null -> {
            val res =
                api.chatGemini(
                    providerKey = geminiKey,
                    auditRun = auditRun?.token,
                    auditDomain = auditRun?.domain,
                    body = toGeminiRequest(request),
                )
            val text =
                res.candidates
                    .firstOrNull()
                    ?.content
                    ?.parts
                    ?.joinToString("") { it.text }
                    .orEmpty()
            LlmCompletion(text, "Gemini 2.5 Flash (BYOK)")
        }
        else -> {
            val res =
                api.chatGroq(
                    providerKey = null,
                    auditRun = auditRun?.token,
                    auditDomain = auditRun?.domain,
                    body = request,
                )
            LlmCompletion(res.choices.firstOrNull()?.message?.content.orEmpty(), "Groq LPU (Hosted)")
        }
    }
}

suspend fun streamLlmChat(
    api: LuminaraApi,
    keys: ByokKeyBag,
    request: GroqChatRequest,
    auditRun: AuditRunResponse? = null,
    onDelta: suspend (String) -> Unit,
): LlmCompletion {
    val groqKey = keys.groqKey.takeIf { it.isNotBlank() }
    val nimKey = keys.nimKey.takeIf { it.isNotBlank() }
    val geminiKey = keys.geminiKey.takeIf { it.isNotBlank() }
    if (geminiKey != null && groqKey == null && nimKey == null) {
        val completion = completeLlmChat(api, keys, request, auditRun)
        if (completion.content.isNotEmpty()) {
            onDelta(completion.content)
        }
        return completion
    }
    val streamBody =
        if (nimKey != null && groqKey == null) {
            api.streamNim(
                providerKey = nimKey,
                auditRun = auditRun?.token,
                auditDomain = auditRun?.domain,
                body = request.copy(model = NIM_DEFAULT_MODEL, stream = true),
            )
        } else {
            api.streamGroq(
                providerKey = groqKey,
                auditRun = auditRun?.token,
                auditDomain = auditRun?.domain,
                body = request.copy(stream = true),
            )
        }
    val buffer = StringBuilder()
    readModelStream(streamBody) { delta ->
        buffer.append(delta)
        onDelta(delta)
    }
    val label =
        when {
            groqKey != null -> "Groq LPU (BYOK)"
            nimKey != null -> "NVIDIA NIM (BYOK)"
            else -> "Groq LPU (Hosted)"
        }
    return LlmCompletion(buffer.toString(), label)
}

private fun toGeminiRequest(request: GroqChatRequest): GeminiGenerateRequest {
    val systemText =
        request.messages
            .filter { it.role == "system" }
            .joinToString("\n\n") { it.content }
    val turns =
        request.messages
            .filter { it.role != "system" }
            .map { msg ->
                GeminiContent(
                    role = if (msg.role == "assistant") "model" else "user",
                    parts = listOf(GeminiPart(text = msg.content)),
                )
            }
    return GeminiGenerateRequest(
        contents = turns,
        systemInstruction =
        systemText.takeIf { it.isNotBlank() }?.let {
            GeminiContent(role = "user", parts = listOf(GeminiPart(text = it)))
        },
    )
}

fun decodeAudioOverview(raw: String): AudioOverview {
    val start = raw.indexOf('{')
    val end = raw.lastIndexOf('}')
    check(start >= 0 && end > start) { "The briefing came back empty. Try again." }
    val overview =
        runCatching { STREAM_JSON.decodeFromString<AudioOverview>(raw.substring(start, end + 1)) }
            .getOrElse { throw IllegalStateException("The briefing came back in an unexpected format. Try again.") }
    check(overview.script.isNotEmpty()) { "The briefing came back empty. Try again." }
    return overview
}

fun buildOracleChatRequest(
    question: String,
    sources: List<TavilyResult>,
    earlierTurns: List<OracleTurn> = emptyList(),
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
            "3. Format your response as two lines:\n" +
            "VERDICT: <concise 1-2 sentence verdict>\n" +
            "NEXT_ACTION: <one concrete action to execute this week>"
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
            add(GroqMessage(role = "user", content = "Question: $question\n\n$evidenceBlock"))
        },
    )
}

fun parseOracleTurn(
    question: String,
    rawContent: String,
    sources: List<TavilyResult>,
    modelLabel: String,
    nowMs: Long,
): OracleTurn {
    val clean = rawContent.replace("\u2014", "-")
    val verdictLine =
        clean.lineSequence()
            .firstOrNull { it.startsWith("VERDICT:", ignoreCase = true) }
            ?.substringAfter(":")
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: clean.lineSequence().firstOrNull { it.isNotBlank() }?.trim()
            ?: "Evidence check completed."
    val actionLine =
        clean.lineSequence()
            .firstOrNull { it.startsWith("NEXT_ACTION:", ignoreCase = true) }
            ?.substringAfter(":")
            ?.trim()
            ?.takeIf { it.isNotEmpty() }
            ?: "Run Instant Audit on your target domain and publish /llms.txt with canonical links."
    return OracleTurn(
        id = "turn-$nowMs-${question.hashCode().toUInt().toString(16)}",
        question = question,
        verdict = verdictLine,
        nextAction = actionLine,
        sources = sources,
        modelLabel = modelLabel,
        measurementStatus = if (sources.isNotEmpty()) "measured" else "not_measured",
        timestampMs = nowMs,
    )
}
