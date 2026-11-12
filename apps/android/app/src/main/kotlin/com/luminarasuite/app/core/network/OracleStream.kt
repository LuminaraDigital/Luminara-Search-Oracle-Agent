package com.luminarasuite.app.core.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.ResponseBody

/** One event from the server Oracle stream at `/api/oracle/chat`. */
sealed interface OracleSseEvent {
    data class Token(
        val text: String,
    ) : OracleSseEvent

    data class Error(
        val message: String,
        val code: String?,
    ) : OracleSseEvent

    data class Done(
        val ok: Boolean,
    ) : OracleSseEvent
}

private val SSE_JSON = Json { ignoreUnknownKeys = true }

internal fun decodeOracleEvent(
    name: String,
    data: String,
): OracleSseEvent? {
    val obj: JsonObject = runCatching { SSE_JSON.parseToJsonElement(data).jsonObject }.getOrNull() ?: return null

    fun str(key: String) = obj[key]?.jsonPrimitive?.contentOrNull
    return when (name) {
        "token" -> str("text")?.let { OracleSseEvent.Token(it) }
        "error" -> OracleSseEvent.Error(str("error") ?: "The Oracle could not answer.", str("code"))
        "done" -> OracleSseEvent.Done(str("ok") == "true")
        else -> null
    }
}

/**
 * Reads Server-Sent Events. A blank line ends an event, several `data:` lines join with a newline,
 * and event types this app does not use (status, tool, monitor, harness_event) are skipped.
 */
suspend fun readOracleStream(
    body: ResponseBody,
    onEvent: suspend (OracleSseEvent) -> Unit,
) {
    body.use { response ->
        val source = response.source()
        var name = "message"
        val data = mutableListOf<String>()

        suspend fun dispatch() {
            if (data.isNotEmpty()) decodeOracleEvent(name, data.joinToString("\n"))?.let { onEvent(it) }
            name = "message"
            data.clear()
        }
        while (true) {
            val line = source.readUtf8Line() ?: break
            when {
                line.isEmpty() -> dispatch()
                line.startsWith(":") -> Unit
                line.startsWith("event:") -> name = line.removePrefix("event:").trim()
                line.startsWith("data:") -> data.add(line.removePrefix("data:").removePrefix(" "))
            }
        }
        dispatch()
    }
}
