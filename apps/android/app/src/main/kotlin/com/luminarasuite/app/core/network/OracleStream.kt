package com.luminarasuite.app.core.network

import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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

    /** The server's output monitor flagged the answer. It is only sent when the answer did not pass. */
    data class Monitor(
        val notes: List<String>,
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
        "monitor" ->
            if (str("ok") == "false") {
                val notes = (obj["notes"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
                OracleSseEvent.Monitor(notes.filter { it.isNotBlank() })
            } else {
                null
            }
        else -> null
    }
}

/**
 * Reads Server-Sent Events. A blank line ends an event, several `data:` lines join with a newline,
 * and event types this app does not use (status, tool, provenance, harness_event) are skipped.
 * Cancelling the caller closes the body, which also stops a read blocked on a quiet socket.
 */
suspend fun readOracleStream(
    body: ResponseBody,
    onEvent: suspend (OracleSseEvent) -> Unit,
) = coroutineScope {
    val closer =
        launch {
            try {
                awaitCancellation()
            } finally {
                body.close()
            }
        }
    try {
        val source = body.source()
        var name = "message"
        val data = mutableListOf<String>()

        suspend fun dispatch() {
            if (data.isNotEmpty()) decodeOracleEvent(name, data.joinToString("\n"))?.let { onEvent(it) }
            name = "message"
            data.clear()
        }
        while (true) {
            ensureActive()
            val line = source.readUtf8Line() ?: break
            when {
                line.isEmpty() -> dispatch()
                line.startsWith(":") -> Unit
                line.startsWith("event:") -> name = line.removePrefix("event:").trim()
                line.startsWith("data:") -> data.add(line.removePrefix("data:").removePrefix(" "))
            }
        }
        dispatch()
    } finally {
        closer.cancel()
        body.close()
    }
}
