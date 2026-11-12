package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.model.OracleChatRequest
import com.luminarasuite.app.core.model.OracleTurn
import com.luminarasuite.app.core.model.TavilyResult
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import retrofit2.HttpException
import java.io.IOException

internal const val NO_ANSWER_COPY = "The AI did not answer. Try again."
internal const val DEFAULT_NEXT_ACTION =
    "Run Instant Audit on your target domain and publish /llms.txt with canonical links."
private const val SESSION_ENDED_COPY = "Your session ended. Sign in again to keep asking."
private const val RATE_LIMITED_COPY = "You are asking too fast. Wait a minute and try again."
private const val CUT_OFF_COPY = "The connection dropped before the answer finished. Try again."
private const val NOT_FINISHED_COPY = "The Oracle could not finish that answer. Try again."
private const val SKIP_AFTER_FORBIDDEN_MS = 10 * 60 * 1000L

/** What to do with a failed `/oracle/chat` request. */
internal enum class OracleFailure { FALL_BACK, SESSION_ENDED, RATE_LIMITED, FAIL }

/**
 * 403 is a plan without Oracle, 404 and 409 are a missing or busy route, and any 5xx (a JSON error or
 * a Cloudflare HTML page alike) is the server being down. All of those can still be answered by the
 * relay. 401 and 429 are the person's to act on, so they never fall back.
 */
internal fun oracleFailure(status: Int): OracleFailure =
    when {
        status == 401 -> OracleFailure.SESSION_ENDED
        status == 429 -> OracleFailure.RATE_LIMITED
        status == 403 || status == 404 || status == 409 || status >= 500 -> OracleFailure.FALL_BACK
        else -> OracleFailure.FAIL
    }

internal fun buildOracleTurn(
    question: String,
    verdict: String,
    nextAction: String,
    sources: List<TavilyResult>,
    modelLabel: String,
    now: Long,
) = OracleTurn(
    id = "turn-$now-${question.hashCode().toUInt().toString(16)}",
    question = question,
    verdict = verdict,
    nextAction = nextAction,
    sources = sources,
    modelLabel = modelLabel,
    measurementStatus = if (sources.isNotEmpty()) "measured" else "not_measured",
    timestampMs = now,
)

/** The answer text without its labelled action line, which shows separately as the next action. */
private fun answerWithoutAction(raw: String): String {
    val clean = raw.withoutEmDash()
    val lines = clean.lines().toMutableList()
    val action = lines.indexOfFirst { ACTION_LABEL.containsMatchIn(it) }
    if (action >= 0) lines.removeAt(action)
    return lines.joinToString("\n").trim()
}

/**
 * The hosted Oracle at `/api/oracle/chat`, the route the web Oracle uses. [answer] returns true when
 * it produced the turn and false when nothing was streamed yet and the caller should use the relay.
 * Once tokens have reached the person a failure is an error, never a second answer on top of the first.
 */
internal class ServerOracle(
    private val api: LuminaraApi,
    private val clockMs: () -> Long,
) {
    @Volatile
    private var skipUntilMs = 0L

    /** Forget the 403 memory, so a new account is tried again. */
    fun reset() {
        skipUntilMs = 0L
    }

    suspend fun answer(
        question: String,
        emit: suspend (OracleEvent) -> Unit,
    ): Boolean {
        if (clockMs() < skipUntilMs) return false
        emit(OracleEvent.Status("Asking the Oracle"))
        val body =
            try {
                api.streamOracleChat(body = OracleChatRequest(message = question))
            } catch (err: HttpException) {
                when (oracleFailure(err.code())) {
                    OracleFailure.SESSION_ENDED -> throw IllegalStateException(SESSION_ENDED_COPY)
                    OracleFailure.RATE_LIMITED -> throw IllegalStateException(RATE_LIMITED_COPY)
                    OracleFailure.FAIL -> throw err
                    OracleFailure.FALL_BACK -> {
                        if (err.code() == 403) skipUntilMs = clockMs() + SKIP_AFTER_FORBIDDEN_MS
                        return false
                    }
                }
            }
        // An IOException above is not caught here: the server may already be running the turn, so a
        // relay answer could cost a second question. The repository shows the connection error.
        val answer = StringBuilder()
        val notes = mutableListOf<String>()
        var finished = false
        try {
            readOracleStream(body) { event ->
                when (event) {
                    is OracleSseEvent.Token -> {
                        answer.append(event.text)
                        emit(OracleEvent.Partial(answerWithoutAction(answer.toString())))
                    }
                    is OracleSseEvent.Error -> throw IllegalStateException(event.message)
                    is OracleSseEvent.Done -> {
                        finished = event.ok
                        if (!finished) throw IllegalStateException(NOT_FINISHED_COPY)
                    }
                    is OracleSseEvent.Monitor -> notes.addAll(event.notes)
                }
            }
        } catch (_: IOException) {
            // Cancelling closes the body, which lands here. A cancel is not a failure.
            currentCoroutineContext().ensureActive()
            throw IllegalStateException(CUT_OFF_COPY)
        }
        if (answer.isBlank()) throw IllegalStateException(NO_ANSWER_COPY)
        // The stream ended without its done event, so the answer may be cut off. Say so.
        check(finished) { CUT_OFF_COPY }
        emit(OracleEvent.Complete(serverTurn(question, answer.toString(), notes)))
        return true
    }

    /** The whole answer is the verdict, server warnings included. A labelled action line is the next step. */
    private fun serverTurn(
        question: String,
        raw: String,
        notes: List<String>,
    ): OracleTurn {
        val clean = raw.withoutEmDash().trim()
        val flagged = if (notes.isEmpty()) "" else "\n\nOracle check: ${notes.joinToString(" ").withoutEmDash()}"
        return buildOracleTurn(
            question = question,
            verdict = answerWithoutAction(raw) + flagged,
            nextAction = labelledLine(clean, ACTION_LABEL) ?: DEFAULT_NEXT_ACTION,
            sources = emptyList(),
            modelLabel = "Suite hosted",
            now = clockMs(),
        )
    }
}
