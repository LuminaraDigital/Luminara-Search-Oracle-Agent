package com.luminarasuite.app.core.network

import com.luminarasuite.app.core.model.AuditRunResponse
import com.luminarasuite.app.core.model.BrandName
import com.luminarasuite.app.core.model.CrewPage
import com.luminarasuite.app.core.model.CrewResult
import com.luminarasuite.app.core.model.CrewRules
import com.luminarasuite.app.core.model.EntityMatch
import com.luminarasuite.app.core.model.FirecrawlMapRequest
import com.luminarasuite.app.core.model.FirecrawlScrapeRequest
import com.luminarasuite.app.core.model.PageSchemas
import com.luminarasuite.app.core.model.ReadinessCheck
import com.luminarasuite.app.core.model.SearchRow
import com.luminarasuite.app.core.model.TavilySearchRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import java.net.URI
import java.util.Locale

/**
 * Runs the audit crew's network steps on the phone, like the web client: read pages, run three searches,
 * then hand the evidence to CrewRules. A failed step yields no evidence, never a made-up row.
 * Every provider call carries the run token, so one hosted check pays for the whole audit.
 */
class AuditCrew(
    private val api: LuminaraApi,
) {
    companion object {
        private const val MAX_PAGES = 4
        private const val MAP_LIMIT = 40
        private const val SEARCH_RESULTS = 3
        private val PAGE_PRIORITY = listOf("about", "pricing", "service", "product", "faq", "contact")

        /** Home first, then the pages most likely to say who the business is and what it sells. */
        fun choosePages(
            homeUrl: String,
            domain: String,
            links: List<String>,
        ): List<String> {
            val rank = { url: String ->
                val path = runCatching { URI(url).path }.getOrNull().orEmpty().lowercase(Locale.ROOT)
                PAGE_PRIORITY.indexOfFirst { it in path }.takeIf { it >= 0 } ?: PAGE_PRIORITY.size
            }
            val sameSite =
                links.filter { link ->
                    val host = runCatching { URI(link).host }.getOrNull().orEmpty()
                    EntityMatch.sameSite(host, domain) && link.trimEnd('/') != homeUrl.trimEnd('/')
                }
            return (listOf(homeUrl) + sameSite.distinct().sortedBy(rank)).take(MAX_PAGES)
        }

        private fun linkOf(element: JsonElement): String? =
            when (element) {
                is JsonPrimitive -> element.contentOrNull
                is JsonObject -> (element["url"] as? JsonPrimitive)?.contentOrNull
                else -> null
            }
    }

    suspend fun run(
        domain: String,
        run: AuditRunResponse,
        crawlerChecks: List<ReadinessCheck>,
        onStage: (String) -> Unit,
    ): CrewResult {
        onStage("Reading your pages")
        val pages = readPages(domain, run)
        val live = pages.filter(CrewRules::pageIsLive)
        onStage("Searching the live web")
        val brand = BrandName.fromPage(live.firstOrNull())
        val rows = search(domain, brand, run)
        onStage("Checking findings against the evidence")
        return CrewRules.assess(domain, pages, rows, crawlerChecks)
    }

    private suspend fun readPages(
        domain: String,
        run: AuditRunResponse,
    ): List<CrewPage> {
        val home = "https://$domain"
        val links =
            attempt {
                api.firecrawlMap(run.token, run.domain, FirecrawlMapRequest(url = home, limit = MAP_LIMIT))
                    .links
                    .mapNotNull(::linkOf)
            }.orEmpty()
        return coroutineScope {
            choosePages(home, domain, links)
                .map { url -> async { attempt { readPage(url, run) } } }
                .awaitAll()
                .filterNotNull()
        }
    }

    private suspend fun readPage(
        url: String,
        run: AuditRunResponse,
    ): CrewPage? {
        val data = api.firecrawlScrape(run.token, run.domain, FirecrawlScrapeRequest(url = url)).data ?: return null
        val metadata = data.metadata
        return CrewPage(
            url = (metadata["sourceURL"] as? JsonPrimitive)?.contentOrNull ?: url,
            title = (metadata["title"] as? JsonPrimitive)?.contentOrNull ?: url,
            siteName = (metadata["ogSiteName"] as? JsonPrimitive)?.contentOrNull,
            httpStatus = metadata["statusCode"]?.jsonPrimitive?.intOrNull,
            schemas = PageSchemas.extract(data.rawHtml),
            wordCount = CrewRules.wordCount(data.markdown),
            textSnippet = CrewRules.snippet(data.markdown),
        )
    }

    private suspend fun search(
        domain: String,
        brand: String?,
        run: AuditRunResponse,
    ): List<SearchRow> =
        coroutineScope {
            CrewRules.searchQueries(domain, brand)
                .map { query ->
                    async {
                        attempt {
                            api.searchTavily(
                                auditRun = run.token,
                                auditDomain = run.domain,
                                body = TavilySearchRequest(query = query, maxResults = SEARCH_RESULTS),
                            ).results.map { item ->
                                SearchRow(
                                    query = query,
                                    title = item.title,
                                    url = item.url,
                                    snippet = item.content,
                                    brandMentioned =
                                    EntityMatch.mentionsAudited(
                                        domain = domain,
                                        brandName = brand.orEmpty(),
                                        url = item.url,
                                        title = item.title,
                                        text = item.content,
                                    ),
                                )
                            }
                        }.orEmpty()
                    }
                }.awaitAll()
                .flatten()
        }

    // Any provider failure means this evidence is not_measured.
    @Suppress("TooGenericExceptionCaught")
    private suspend fun <T> attempt(block: suspend () -> T): T? =
        try {
            block()
        } catch (err: CancellationException) {
            throw err
        } catch (_: Exception) {
            null
        }
}
