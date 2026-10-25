package com.luminarasuite.app.core.designsystem

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object LuminaraColors {
    val Paper = Color(0xFF000000)
    val Paper2 = Color(0xFF0A0A0A)
    val Paper3 = Color(0xFF141310)
    val Ink = Color(0xFFF1F1F1)
    val Ink2 = Color(0xFFB0ADA5)
    val GoldAccent = Color(0xFFBF953F)
    val GoldLight = Color(0xFFFCF6BA)
    val GoldDark = Color(0xFFAA771C)
    val AccentInk = Color(0xFF000000)
    val RuleBorder = Color(0x47BF953F)
    val RuleStrong = Color(0x85BF953F)
    val PassGreen = Color(0xFF34D399)
    val WarnAmber = Color(0xFFF59E0B)
    val ErrorRed = Color(0xFFF87171)
}

private val NightFoundryColorScheme =
    darkColorScheme(
        primary = LuminaraColors.GoldAccent,
        onPrimary = LuminaraColors.AccentInk,
        primaryContainer = LuminaraColors.Paper3,
        onPrimaryContainer = LuminaraColors.GoldLight,
        secondary = LuminaraColors.GoldLight,
        onSecondary = LuminaraColors.AccentInk,
        background = LuminaraColors.Paper,
        onBackground = LuminaraColors.Ink,
        surface = LuminaraColors.Paper2,
        onSurface = LuminaraColors.Ink,
        surfaceVariant = LuminaraColors.Paper3,
        onSurfaceVariant = LuminaraColors.Ink2,
        outline = LuminaraColors.RuleBorder,
        error = LuminaraColors.ErrorRed,
    )

object LuminaraTextStyles {
    val DisplaySerif =
        TextStyle(
            fontFamily = FontFamily.Serif,
            fontWeight = FontWeight.Normal,
            fontSize = 26.sp,
            lineHeight = 32.sp,
            letterSpacing = (-0.5).sp,
            color = LuminaraColors.Ink,
        )

    val SectionTitle =
        TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 18.sp,
            lineHeight = 24.sp,
            color = LuminaraColors.Ink,
        )

    val Body =
        TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Normal,
            fontSize = 15.sp,
            lineHeight = 22.sp,
            color = LuminaraColors.Ink2,
        )

    val EyebrowMono =
        TextStyle(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Medium,
            fontSize = 11.sp,
            letterSpacing = 1.6.sp,
            color = LuminaraColors.GoldLight,
        )

    val MetricTabular =
        TextStyle(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.SemiBold,
            fontSize = 20.sp,
            fontFeatureSettings = "tnum",
            color = LuminaraColors.Ink,
        )
}

@Composable
fun LuminaraTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = NightFoundryColorScheme,
        content = content,
    )
}

@Composable
fun WorkbenchCard(
    modifier: Modifier = Modifier,
    emphasized: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    val borderColor = if (emphasized) LuminaraColors.RuleStrong else LuminaraColors.RuleBorder
    Surface(
        modifier = modifier.fillMaxWidth(),
        color = LuminaraColors.Paper2,
        shape = RoundedCornerShape(14.dp),
        border = BorderStroke(1.dp, borderColor),
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
            content = content,
        )
    }
}

@Composable
fun EyebrowKicker(text: String) {
    Text(
        text = text.uppercase(),
        style = LuminaraTextStyles.EyebrowMono,
    )
}

@Composable
fun MeasurementStatusBadge(status: String) {
    val normalized = status.lowercase()
    val (bgColor, textColor, label) =
        when (normalized) {
            "pass", "allowed", "measured", "done" ->
                Triple(Color(0x2634D399), LuminaraColors.PassGreen, normalized.uppercase())
            "fail", "blocked", "high", "critical" ->
                Triple(Color(0x26F59E0B), LuminaraColors.WarnAmber, normalized.uppercase())
            else ->
                Triple(LuminaraColors.Paper3, LuminaraColors.Ink2, normalized.uppercase())
        }
    Box(
        modifier =
        Modifier
            .background(bgColor, RoundedCornerShape(6.dp))
            .border(1.dp, textColor.copy(alpha = 0.35f), RoundedCornerShape(6.dp))
            .padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Text(
            text = label,
            style =
            TextStyle(
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Medium,
                fontSize = 10.sp,
                fontFeatureSettings = "tnum",
                color = textColor,
            ),
        )
    }
}

@Composable
fun AiEvidenceDisclosureBar(
    modifier: Modifier = Modifier,
    note: String = "Evidence-bound output. Unverified metrics are marked NOT_MEASURED.",
) {
    Row(
        modifier =
        modifier
            .fillMaxWidth()
            .background(LuminaraColors.Paper3, RoundedCornerShape(10.dp))
            .border(1.dp, LuminaraColors.RuleBorder, RoundedCornerShape(10.dp))
            .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = note,
            style = LuminaraTextStyles.Body.copy(fontSize = 12.sp),
        )
    }
}
