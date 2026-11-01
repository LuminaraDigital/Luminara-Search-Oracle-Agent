package com.luminarasuite.app.core.designsystem

import com.luminarasuite.app.core.model.BotDirectiveStatus
import com.luminarasuite.app.core.model.ReadinessCheck

enum class ProbeTone {
    Idle,
    Running,
    Pass,
    Fail,
    Unknown,
}

data class ProbeBeacon(
    val path: String,
    val tone: ProbeTone,
)

private val ProbeFiles: List<Pair<String, List<String>>> =
    listOf(
        "/robots.txt" to listOf("ai_bot_directives"),
        "/llms.txt" to listOf("llms_txt", "llms_structure", "cite_paths"),
        "/ai.txt" to listOf("ai_txt"),
    )

fun probeBeacons(
    isLoading: Boolean,
    checks: List<ReadinessCheck>?,
): List<ProbeBeacon> =
    ProbeFiles.map { (path, ids) ->
        val related = checks?.filter { it.id in ids }
        ProbeBeacon(
            path = path,
            tone = if (isLoading) ProbeTone.Running else toneForChecks(related),
        )
    }

fun toneForChecks(checks: List<ReadinessCheck>?): ProbeTone {
    if (checks.isNullOrEmpty()) return ProbeTone.Idle
    val statuses = checks.map { it.status.lowercase() }
    return when {
        statuses.any { it == "fail" } -> ProbeTone.Fail
        statuses.all { it == "pass" } -> ProbeTone.Pass
        else -> ProbeTone.Unknown
    }
}

fun toneForStatus(status: String): ProbeTone =
    when (status.lowercase()) {
        "pass", "allowed", "measured", "done" -> ProbeTone.Pass
        "fail", "blocked", "high", "critical" -> ProbeTone.Fail
        "in_progress" -> ProbeTone.Running
        else -> ProbeTone.Unknown
    }

fun toneWord(tone: ProbeTone): String =
    when (tone) {
        ProbeTone.Idle -> "WAITING"
        ProbeTone.Running -> "PROBING"
        ProbeTone.Pass -> "PASS"
        ProbeTone.Fail -> "FAIL"
        ProbeTone.Unknown -> "NOT_MEASURED"
    }

fun probeCaption(
    isLoading: Boolean,
    beacons: List<ProbeBeacon>,
): String {
    if (isLoading) {
        return "Reading the live files. Nothing is scored until the response arrives."
    }
    if (beacons.isEmpty() || beacons.all { it.tone == ProbeTone.Idle }) {
        return "Nothing measured yet. Probe a host to light these files."
    }
    val pass = beacons.count { it.tone == ProbeTone.Pass }
    val fail = beacons.count { it.tone == ProbeTone.Fail }
    val unknown = beacons.count { it.tone == ProbeTone.Unknown }
    val parts = mutableListOf("$pass of ${beacons.size} files passed")
    if (fail > 0) parts += "$fail failed"
    if (unknown > 0) parts += "$unknown not measured"
    return parts.joinToString(". ") + "."
}

fun auditIsClear(
    measurementStatus: String,
    checks: List<ReadinessCheck>,
    failCount: Int,
): Boolean {
    if (measurementStatus != "measured") return false
    if (checks.isEmpty() || failCount != 0) return false
    return checks.all { it.status == "pass" }
}

fun botAllowanceLabel(bots: List<BotDirectiveStatus>): String {
    if (bots.isEmpty() || bots.all { it.status.equals("not_measured", ignoreCase = true) }) {
        return "NOT_MEASURED"
    }
    val allowed = bots.count { it.status.equals("allowed", ignoreCase = true) }
    return "$allowed of ${bots.size} allowed"
}
