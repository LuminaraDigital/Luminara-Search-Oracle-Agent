package com.luminarasuite.app.core.designsystem

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object LuminaraColors {
    val Paper = Color(0xFF070706)
    val Paper2 = Color(0xFF10100E)
    val Paper3 = Color(0xFF181714)
    val Ink = Color(0xFFF3F1EA)
    val Ink2 = Color(0xFFA7A297)
    val GoldAccent = Color(0xFFD4B15A)
    val GoldLight = Color(0xFFF3E2A4)
    val GoldDark = Color(0xFFAA771C)
    val AccentInk = Color(0xFF14110A)
    val RuleBorder = Color(0x14FFFFFF)
    val RuleStrong = Color(0x24FFFFFF)
    val PassGreen = Color(0xFF3DDC97)
    val WarnAmber = Color(0xFFE2A23A)
    val ErrorRed = Color(0xFFF87171)
}

private val NightFoundryColorScheme =
    darkColorScheme(
        primary = LuminaraColors.GoldAccent,
        onPrimary = LuminaraColors.AccentInk,
        primaryContainer = LuminaraColors.Paper3,
        onPrimaryContainer = LuminaraColors.Ink,
        secondary = LuminaraColors.Ink2,
        onSecondary = LuminaraColors.Ink,
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
            fontSize = 32.sp,
            lineHeight = 36.sp,
            letterSpacing = (-0.6).sp,
            color = LuminaraColors.Ink,
        )

    val SectionTitle =
        TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
            lineHeight = 22.sp,
            color = LuminaraColors.Ink,
        )

    val Body =
        TextStyle(
            fontFamily = FontFamily.SansSerif,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            lineHeight = 20.sp,
            color = LuminaraColors.Ink2,
        )

    val EyebrowMono =
        TextStyle(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Medium,
            fontSize = 11.sp,
            letterSpacing = 1.4.sp,
            color = LuminaraColors.Ink2,
        )

    val MetricTabular =
        TextStyle(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
            fontFeatureSettings = "tnum",
            color = LuminaraColors.Ink,
        )
}

fun toneColor(tone: ProbeTone): Color =
    when (tone) {
        ProbeTone.Pass -> LuminaraColors.PassGreen
        ProbeTone.Fail -> LuminaraColors.WarnAmber
        ProbeTone.Running -> LuminaraColors.GoldLight
        ProbeTone.Idle, ProbeTone.Unknown -> LuminaraColors.Ink2
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
    railColor: Color = Color.Transparent,
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(
        targetValue = if (onClick != null && pressed) 0.985f else 1f,
        animationSpec = spring(dampingRatio = 0.7f, stiffness = Spring.StiffnessMedium),
        label = "plateScale",
    )
    val shape = RoundedCornerShape(18.dp)
    val press =
        if (onClick != null) {
            Modifier.clickable(
                interactionSource = interaction,
                indication = ripple(),
                role = Role.Button,
                onClick = onClick,
            )
        } else {
            Modifier
        }
    Surface(
        modifier =
        modifier
            .fillMaxWidth()
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .clip(shape)
            .then(press),
        color = if (emphasized) LuminaraColors.Paper3 else LuminaraColors.Paper2,
        shape = shape,
        border = BorderStroke(1.dp, LuminaraColors.RuleBorder),
    ) {
        Row(
            modifier =
            Modifier
                .height(IntrinsicSize.Min)
                .fillMaxWidth(),
        ) {
            if (railColor != Color.Transparent) {
                Box(
                    modifier =
                    Modifier
                        .padding(start = 10.dp, top = 14.dp, bottom = 14.dp)
                        .width(3.dp)
                        .fillMaxHeight()
                        .background(railColor, RoundedCornerShape(3.dp)),
                )
            }
            Column(
                modifier =
                Modifier
                    .weight(1f)
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                content = content,
            )
        }
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
    val tone = toneForStatus(status)
    val color by animateColorAsState(targetValue = toneColor(tone), label = "statusColor")
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Box(
            modifier =
            Modifier
                .width(6.dp)
                .height(6.dp)
                .background(color, CircleShape),
        )
        Text(
            text = status.uppercase(),
            style =
            TextStyle(
                fontFamily = FontFamily.Monospace,
                fontWeight = FontWeight.Medium,
                fontSize = 11.sp,
                fontFeatureSettings = "tnum",
                color = color,
            ),
        )
    }
}

@Composable
fun AiEvidenceDisclosureBar(
    modifier: Modifier = Modifier,
    note: String = "Evidence-bound. Unverified metrics stay NOT_MEASURED.",
) {
    Text(
        text = note,
        modifier = modifier.fillMaxWidth(),
        style = LuminaraTextStyles.Body.copy(fontSize = 12.sp),
    )
}

@Composable
fun FoundryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    testTag: String? = null,
) {
    val haptics = LocalHapticFeedback.current
    Button(
        onClick = {
            haptics.performHapticFeedback(HapticFeedbackType.LongPress)
            onClick()
        },
        enabled = enabled,
        shape = RoundedCornerShape(999.dp),
        colors =
        ButtonDefaults.buttonColors(
            containerColor = LuminaraColors.GoldAccent,
            contentColor = LuminaraColors.AccentInk,
            disabledContainerColor = LuminaraColors.Paper3,
            disabledContentColor = LuminaraColors.Ink2,
        ),
        modifier =
        modifier
            .fillMaxWidth()
            .height(52.dp)
            .then(if (testTag != null) Modifier.testTag(testTag) else Modifier),
    ) {
        Text(text = text, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun FoundryFieldColors() =
    OutlinedTextFieldDefaults.colors(
        focusedTextColor = LuminaraColors.Ink,
        unfocusedTextColor = LuminaraColors.Ink,
        focusedBorderColor = LuminaraColors.Ink2.copy(alpha = 0.55f),
        unfocusedBorderColor = LuminaraColors.RuleStrong,
        cursorColor = LuminaraColors.GoldLight,
        focusedLabelColor = LuminaraColors.Ink2,
        unfocusedLabelColor = LuminaraColors.Ink2,
        focusedContainerColor = Color.Transparent,
        unfocusedContainerColor = Color.Transparent,
    )
