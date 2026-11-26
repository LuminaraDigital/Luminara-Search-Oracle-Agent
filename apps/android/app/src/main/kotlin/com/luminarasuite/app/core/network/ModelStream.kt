package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.model.GroqChatResponse
import com.luminarasuite.app.core.model.GroqStreamChunk
import kotlinx.serialization.json.Json
import okhttp3.ResponseBody

private val STREAM_JSON = Json { ignoreUnknownKeys = true }

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

/** Models sometimes bold or head their labels, so VERDICT: and **VERDICT:** both match. */
private fun answerLabel(name: String) = Regex("^[\\s*#_]*$name[\\s*_]*:[\\s*_]*", RegexOption.IGNORE_CASE)

internal val VERDICT_LABEL = answerLabel("VERDICT")
internal val ACTION_LABEL = answerLabel("NEXT_ACTION")

internal fun labelledLine(
    text: String,
    label: Regex,
): String? =
    text.lineSequence()
        .firstOrNull { label.containsMatchIn(it) }
        ?.replace(label, "")
        ?.trim(' ', '*', '_')
        ?.takeIf { it.isNotEmpty() }

fun streamingVerdict(raw: String): String =
    raw.replace("—", "-")
        .substringBefore("NEXT_ACTION")
        .replace(VERDICT_LABEL, "")
        .trim(' ', '\n', '*', '_')
