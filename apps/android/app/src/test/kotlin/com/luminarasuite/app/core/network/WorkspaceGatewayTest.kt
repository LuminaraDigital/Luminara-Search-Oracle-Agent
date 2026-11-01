package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.model.BusinessDna
import com.luminarasuite.app.core.model.ShareLink
import com.luminarasuite.app.core.model.WorkspaceResponse
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceGatewayTest {
    private val storedDna = """{"name":"Old","agencyType":"residential","mission":"Keep"}"""
    private val stored =
        WorkspaceResponse(
            ok = true,
            updatedAt = 9L,
            payload =
            JsonObject(
                mapOf(
                    "storage" to
                        JsonObject(
                            mapOf(
                                "luminara_business_dna" to JsonPrimitive(storedDna),
                                "other_key" to JsonPrimitive("kept"),
                            ),
                        ),
                    "topLevel" to JsonPrimitive("kept"),
                ),
            ),
        )

    @Test
    fun savingKeepsOtherWorkspaceDataAndFieldsThisAppDoesNotEdit() =
        runTest {
            val api = FakeLuminaraApi().apply { workspace = stored }
            val gateway = DefaultWorkspaceGateway(api)

            val loaded = gateway.loadProfile().getOrThrow()
            assertEquals("Old", loaded.name)
            assertTrue(gateway.saveProfile(loaded.copy(name = "New")).isSuccess)

            val put = requireNotNull(api.lastWorkspacePut)
            assertEquals(9L, put.baseVersion)
            assertEquals("kept", put.payload["topLevel"]?.jsonPrimitive?.content)
            val storage = requireNotNull(put.payload["storage"]).jsonObject
            assertEquals("kept", storage["other_key"]?.jsonPrimitive?.content)
            val dna = LuminaraWireJson.parseToJsonElement(
                storage.getValue("luminara_business_dna").jsonPrimitive.content,
            )
            assertEquals("New", dna.jsonObject["name"]?.jsonPrimitive?.content)
            assertEquals("residential", dna.jsonObject["agencyType"]?.jsonPrimitive?.content)
        }

    @Test
    fun aConflictRereadsTheStoredVersionOnce() =
        runTest {
            val api =
                FakeLuminaraApi().apply {
                    workspace = stored
                    conflictsLeft = 1
                }
            assertTrue(DefaultWorkspaceGateway(api).saveProfile(BusinessDna(name = "New")).isSuccess)
            assertEquals(10L, api.lastWorkspacePut?.baseVersion)
        }

    @Test
    fun aSecondConflictFailsInsteadOfOverwriting() =
        runTest {
            val api =
                FakeLuminaraApi().apply {
                    workspace = stored
                    conflictsLeft = 2
                }
            assertFalse(DefaultWorkspaceGateway(api).saveProfile(BusinessDna(name = "New")).isSuccess)
            assertNull(api.lastWorkspacePut)
        }

    @Test
    fun aLockedReportAsksForItsPassword() =
        runTest {
            val gateway = DefaultWorkspaceGateway(FakeLuminaraApi())
            val link = ShareLink("locked", isTeaser = false)
            assertTrue(gateway.openShared(link, null).exceptionOrNull() is SharePasswordRequired)
            assertEquals("Body", gateway.openShared(link, "pw").getOrThrow().body)
        }

    @Test
    fun repliesAreRecordedAsTheAgent() =
        runTest {
            val api = FakeLuminaraApi()
            DefaultWorkspaceGateway(api).replyToEnquiry("e1", "Thanks")
            assertEquals("agent", api.enquiryTurns.single().second.sender)
        }

    @Test
    fun shareLinksParseOnlyHttpsSharePaths() {
        val token = "a".repeat(64)
        assertEquals(
            ShareLink(token, isTeaser = false),
            ShareLink.parse("https://www.luminarasuite.com/share/$token"),
        )
        assertEquals(
            ShareLink(token, isTeaser = true),
            ShareLink.parse("https://www.luminarasuite.com/share/teaser/$token"),
        )
        assertNull(ShareLink.parse("https://www.luminarasuite.com/pricing"))
        assertNull(ShareLink.parse("http://www.luminarasuite.com/share/$token"))
        assertNull(ShareLink.parse("https://www.luminarasuite.com/share/x"))
        assertNull(ShareLink.parse("https://www.luminarasuite.com/share/${"z".repeat(64)}"))
        assertNull(ShareLink.parse(null))
    }
}
