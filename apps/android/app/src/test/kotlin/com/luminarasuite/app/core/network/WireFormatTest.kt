package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.model.GroqChatRequest
import com.luminarasuite.app.core.model.GroqMessage
import com.luminarasuite.app.core.model.ScoutRecheckRequest
import com.luminarasuite.app.core.model.TavilySearchRequest
import kotlinx.serialization.json.JsonNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WireFormatTest {
    @Test
    fun chatRequestSendsItsModel() {
        val body =
            LuminaraWireJson.encodeToString(
                GroqChatRequest(messages = listOf(GroqMessage(role = "user", content = "hi"))),
            )

        assertTrue(body.contains("\"model\""))
        assertTrue(body.contains("\"max_tokens\""))
    }

    @Test
    fun recheckFlagReachesTheWorker() {
        val body = LuminaraWireJson.encodeToString(ScoutRecheckRequest(domain = "a.com", checkId = "x"))

        assertTrue(body.contains("\"recheck\":true"))
    }

    @Test
    fun searchSendsItsSettings() {
        val body = LuminaraWireJson.encodeToString(TavilySearchRequest(query = "q"))

        assertTrue(body.contains("\"search_depth\""))
    }

    @Test
    fun refundSendsExplicitNullScores() {
        val body = auditRefundBody("token", "a.com")

        assertEquals("true", body["refund"].toString())
        assertEquals(JsonNull, body["healthScore"])
        assertEquals(JsonNull, body["citationRate"])
    }
}
