package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.auth.InMemoryVaultStorage
import com.luminarasuite.app.core.auth.VaultSnapshot
import com.luminarasuite.app.core.model.OracleTurn
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withTimeout
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.asResponseBody
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.Source
import okio.Timeout
import okio.buffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.util.concurrent.CopyOnWriteArrayList

/** Serves its text once, then blocks like a quiet socket until closed, and fails the way a closed socket does. */
class StalledSource(
    private val text: String,
) : Source {
    private val closed = java.util.concurrent.CountDownLatch(1)
    private var sent = false

    override fun read(
        sink: Buffer,
        byteCount: Long,
    ): Long {
        if (!sent) {
            sent = true
            sink.writeUtf8(text)
            return text.length.toLong()
        }
        closed.await()
        throw IOException("Socket closed")
    }

    override fun timeout() = Timeout.NONE

    override fun close() = closed.countDown()
}

/** The hosted Oracle path of Ask: `/api/oracle/chat`, its relay fallback and its failure states. */
class ServerOracleTest {
    private fun signedInRepo(
        api: FakeLuminaraApi,
        clockMs: () -> Long = { 1_000L },
    ) = DefaultLuminaraRepository(
        api = api,
        dao = FakeLuminaraDao(),
        vault = InMemoryVaultStorage(VaultSnapshot(idToken = "t", email = "a@b.co")),
        clockMs = clockMs,
    )

    private fun oracleStream(vararg events: String) = events.joinToString("") { "$it\n\n" }

    private fun tokenEvent(text: String) = "event: token\ndata: {\"text\":\"$text\"}"

    private suspend fun askOracle(
        api: FakeLuminaraApi,
        body: String,
    ): OracleTurn {
        api.oracleStatus = 200
        api.oracleBody = body
        return (signedInRepo(api).streamOracle("Q", emptyList()).toList().last() as OracleEvent.Complete).turn
    }

    private val oracleOk =
        "event: status\ndata: {\"stage\":\"thinking\"}\n\n" +
            "event: token\ndata: {\"text\":\"Your llms.txt is missing.\"}\n\n" +
            "event: token\ndata: {\"text\":\"\\n\\nPublish /llms.txt this week.\"}\n\n" +
            "event: done\ndata: {\"ok\":true}\n\n"

    @Test
    fun streamOracle_signedInUsesServerOracleAndSkipsRelay() =
        runTest {
            val api = FakeLuminaraApi()
            api.oracleStatus = 200
            api.oracleBody = oracleOk
            val events = signedInRepo(api).streamOracle("Why?", emptyList()).toList()

            val turn = (events.last() as OracleEvent.Complete).turn
            assertEquals("Your llms.txt is missing.\n\nPublish /llms.txt this week.", turn.verdict)
            assertEquals(DEFAULT_NEXT_ACTION, turn.nextAction)
            assertEquals("Why?", api.lastOracle?.message)
            assertNull(api.lastChat)
            assertTrue(events.any { it is OracleEvent.Partial })
        }

    @Test
    fun streamOracle_fallsBackToRelayWhenOracleIsNotForThisPlan() =
        runTest {
            for (status in listOf(403, 404, 409, 500, 502)) {
                val api = FakeLuminaraApi()
                api.oracleStatus = status
                val events = signedInRepo(api).streamOracle("Q", emptyList()).toList()

                assertEquals(1, api.oracleCalls)
                assertEquals("Publish /llms.txt - now.", (events.last() as OracleEvent.Complete).turn.verdict)
            }
        }

    @Test
    fun streamOracle_cloudflareHtml503BeforeTokensFallsBackToRelay() =
        runTest {
            val api = FakeLuminaraApi()
            api.oracleStatus = 503
            api.oracleErrorBody = "<html><body>Service Unavailable</body></html>"
            val events = signedInRepo(api).streamOracle("Q", emptyList()).toList()

            assertEquals("Publish /llms.txt - now.", (events.last() as OracleEvent.Complete).turn.verdict)
        }

    @Test
    fun streamOracle_ioFailureBeforeTokensIsAConnectionErrorNotARelayAnswer() =
        runTest {
            val api = FakeLuminaraApi()
            api.oracleFailure = IOException("timeout")
            val result = runCatching { signedInRepo(api).streamOracle("Q", emptyList()).toList() }

            assertEquals(NO_CONNECTION_COPY, result.exceptionOrNull()?.message)
            assertNull(api.lastChat)
        }

    @Test
    fun streamOracle_cancelMidStreamIsNotAnErrorAndNeverCallsRelay() =
        runBlocking {
            val api = FakeLuminaraApi()
            api.oracleStatus = 200
            api.oracleStreamBody =
                StalledSource(oracleStream(tokenEvent("Half"))).buffer()
                    .asResponseBody("text/event-stream".toMediaType())
            val seen = CopyOnWriteArrayList<OracleEvent>()
            val failures = CopyOnWriteArrayList<Throwable>()
            val job =
                launch(Dispatchers.Default) {
                    try {
                        signedInRepo(api).streamOracle("Q", emptyList()).collect { seen.add(it) }
                    } catch (err: CancellationException) {
                        throw err
                    } catch (err: Throwable) {
                        failures.add(err)
                    }
                }
            withTimeout(5_000) { while (seen.none { it is OracleEvent.Partial }) delay(10) }
            withTimeout(5_000) { job.cancelAndJoin() }

            assertTrue(failures.isEmpty())
            assertTrue(seen.none { it is OracleEvent.Complete })
            assertNull(api.lastChat)
            assertEquals(1, api.oracleCalls)
        }

    @Test
    fun streamOracle_forbiddenIsNotAskedAgainForTenMinutes() =
        runTest {
            val api = FakeLuminaraApi()
            api.oracleStatus = 403
            var now = 1_000L
            val repo = signedInRepo(api) { now }
            repo.streamOracle("Q", emptyList()).toList()
            now += 9 * 60 * 1000L
            repo.streamOracle("Q", emptyList()).toList()
            assertEquals(1, api.oracleCalls)

            now += 2 * 60 * 1000L
            repo.streamOracle("Q", emptyList()).toList()
            assertEquals(2, api.oracleCalls)
        }

    @Test
    fun streamOracle_serverWarningStaysWithTheAnswerAndActionIsDefault() =
        runTest {
            val warning = "Some numbers here were not measured."
            val turn =
                askOracle(
                    FakeLuminaraApi(),
                    oracleStream(
                        tokenEvent("Your llms.txt is missing."),
                        tokenEvent("\\n\\n$warning"),
                        "event: done\ndata: {\"ok\":true}",
                    ),
                )

            assertEquals("Your llms.txt is missing.\n\n$warning", turn.verdict)
            assertEquals(DEFAULT_NEXT_ACTION, turn.nextAction)
        }

    @Test
    fun streamOracle_multiParagraphAnswerKeepsEveryParagraphAndMovesTheActionLine() =
        runTest {
            val turn =
                askOracle(
                    FakeLuminaraApi(),
                    oracleStream(
                        tokenEvent("First point.\\n\\nSecond point.\\n\\nNEXT_ACTION: Add the H1."),
                        "event: done\ndata: {\"ok\":true}",
                    ),
                )

            assertEquals("First point.\n\nSecond point.", turn.verdict)
            assertEquals("Add the H1.", turn.nextAction)
        }

    @Test
    fun streamOracle_monitorNoteReachesTheAnswerAndStaysNotMeasured() =
        runTest {
            val turn =
                askOracle(
                    FakeLuminaraApi(),
                    oracleStream(
                        tokenEvent("Traffic will double."),
                        "event: monitor\ndata: {\"ok\":false,\"flags\":[\"unsupported\"]," +
                            "\"notes\":[\"Claim has no source.\"]}",
                        "event: done\ndata: {\"ok\":true}",
                    ),
                )

            assertTrue(turn.verdict.endsWith("Oracle check: Claim has no source."))
            assertEquals("not_measured", turn.measurementStatus)
        }

    @Test
    fun streamOracle_doneNotOkIsAFailure() =
        runTest {
            val api = FakeLuminaraApi()
            api.oracleStatus = 200
            api.oracleBody = oracleStream(tokenEvent("Half"), "event: done\ndata: {\"ok\":false}")
            val result = runCatching { signedInRepo(api).streamOracle("Q", emptyList()).toList() }

            assertTrue(result.exceptionOrNull()?.message.orEmpty().contains("could not finish"))
        }

    @Test
    fun streamOracle_errorAfterTokensDoesNotCallRelay() =
        runTest {
            val api = FakeLuminaraApi()
            api.oracleStatus = 200
            api.oracleBody = oracleStream(tokenEvent("Half"), "event: error\ndata: {\"error\":\"LLM error\"}")
            val result = runCatching { signedInRepo(api).streamOracle("Q", emptyList()).toList() }

            assertEquals("LLM error", result.exceptionOrNull()?.message)
            assertNull(api.lastChat)
        }

    @Test
    fun streamOracle_sessionExpiredSurfacesSignInWithoutFallback() =
        runTest {
            val api = FakeLuminaraApi()
            api.oracleStatus = 401
            val result = runCatching { signedInRepo(api).streamOracle("Q", emptyList()).toList() }

            assertTrue(result.exceptionOrNull()?.message.orEmpty().contains("Sign in again"))
            assertEquals(1, api.oracleCalls)
        }

    @Test
    fun streamOracle_rateLimitIsNamedNotRetriedOnRelay() =
        runTest {
            val api = FakeLuminaraApi()
            api.oracleStatus = 429
            val result = runCatching { signedInRepo(api).streamOracle("Q", emptyList()).toList() }

            assertTrue(result.exceptionOrNull()?.message.orEmpty().contains("too fast"))
        }

    @Test
    fun streamOracle_errorEventAfterPartialKeepsPartialThenFails() =
        runTest {
            val api = FakeLuminaraApi()
            api.oracleStatus = 200
            api.oracleBody =
                "event: token\ndata: {\"text\":\"Half an answer\"}\n\n" +
                "event: error\ndata: {\"error\":\"LLM error 500\"}\n\n"
            val seen = mutableListOf<OracleEvent>()
            val result =
                runCatching {
                    signedInRepo(api).streamOracle("Q", emptyList()).collect { seen.add(it) }
                }

            assertEquals("LLM error 500", result.exceptionOrNull()?.message)
            assertTrue(seen.any { it is OracleEvent.Partial && it.text == "Half an answer" })
            assertTrue(seen.none { it is OracleEvent.Complete })
        }

    @Test
    fun streamOracle_streamEndingWithoutDoneIsReportedAsCutOff() =
        runTest {
            val api = FakeLuminaraApi()
            api.oracleStatus = 200
            api.oracleBody = "event: token\ndata: {\"text\":\"Half\"}\n\n"
            val result = runCatching { signedInRepo(api).streamOracle("Q", emptyList()).toList() }

            assertTrue(result.exceptionOrNull()?.message.orEmpty().contains("dropped"))
        }

    @Test
    fun readOracleStream_joinsMultiLineDataAndSkipsOtherEvents() =
        runTest {
            val raw =
                ": keep-alive\n" +
                    "event: tool\ndata: {\"tool\":\"x\"}\n\n" +
                    "event: token\ndata: {\"text\":\n" +
                    "data: \"line one\"}\n\n" +
                    "event: error\ndata: {\"error\":\"Nope\",\"code\":\"NO_LLM\"}\n\n" +
                    "event: done\ndata: {\"ok\":false}"
            val seen = mutableListOf<OracleSseEvent>()
            readOracleStream(raw.toResponseBody("text/event-stream".toMediaType())) { seen.add(it) }

            assertEquals(
                listOf(
                    OracleSseEvent.Token("line one"),
                    OracleSseEvent.Error("Nope", "NO_LLM"),
                    OracleSseEvent.Done(false),
                ),
                seen,
            )
        }
}
