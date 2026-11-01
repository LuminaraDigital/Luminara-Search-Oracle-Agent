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
import androidx.compose.material3.Typography
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
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.luminarasuite.app.R

object LuminaraColors {
    val Paper = Color(0xFF08080A)
    val Paper2 = Color(0xFF0F0F12)
    val Paper3 = Color(0xFF16161B)
    val Ink = Color(0xFFFFFFFF)
    val Ink2 = Color(0xFFA1A1AA)
    val Ink3 = Color(0xFF71717A)
    val GoldAccent = Color(0xFFF5A623)
    val GoldLight = Color(0xFFFFD166)
    val GoldDark = Color(0xFFAA771C)
    val AccentInk = Color(0xFF08080A)
    val RuleBorder = Color(0x14FFFFFF)
    val RuleStrong = Color(0x1FFFFFFF)
    val GoldRule = Color(0x59F5A623)
    val PassGreen = Color(0xFF10B981)
    val WarnAmber = Color(0xFFE2A23A)
    val ErrorRed = Color(0xFFF87171)
}

@OptIn(ExperimentalTextApi::class)
private fun jakarta(weight: Int) =
    Font(
        R.font.plus_jakarta_sans,
        FontWeight(weight),
        variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
    )

@OptIn(ExperimentalTextApi::class)
private fun playfair(weight: Int) =
    Font(
        R.font.playfair_display,
        FontWeight(weight),
        variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
    )

@OptIn(ExperimentalTextApi::class)
private fun playfairItalic(weight: Int) =
    Font(
        resId = R.font.playfair_display_italic,
        weight = FontWeight(weight),
        style = FontStyle.Italic,
        variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
    )

val JakartaFamily = FontFamily(jakarta(400), jakarta(500), jakarta(600), jakarta(700))
val PlayfairFamily = FontFamily(playfair(500), playfair(600), playfairItalic(500), playfairItalic(600))

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
            fontFamily = PlayfairFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 32.sp,
            lineHeight = 38.sp,
            letterSpacing = (-0.3).sp,
            color = LuminaraColors.Ink,
        )

    val HeadlineSerif =
        TextStyle(
            fontFamily = PlayfairFamily,
            fontWeight = FontWeight.Medium,
            fontSize = 22.sp,
            lineHeight = 28.sp,
            color = LuminaraColors.Ink,
        )

    val SectionTitle =
        TextStyle(
            fontFamily = JakartaFamily,
            fontWeight = FontWeight.SemiBold,
            fontSize = 16.sp,
            lineHeight = 22.sp,
            letterSpacing = (-0.1).sp,
            color = LuminaraColors.Ink,
        )

    val Body =
        TextStyle(
            fontFamily = JakartaFamily,
            fontWeight = FontWeight.Normal,
            fontSize = 14.sp,
            lineHeight = 21.sp,
            color = LuminaraColors.Ink2,
        )

    val EyebrowMono =
        TextStyle(
            fontFamily = JakartaFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 11.sp,
            lineHeight = 14.sp,
            letterSpacing = 0.9.sp,
            color = LuminaraColors.GoldAccent,
        )

    val MetricTabular =
        TextStyle(
            fontFamily = JakartaFamily,
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

private val LuminaraTypography =
    Typography().run {
        copy(
            labelLarge = labelLarge.copy(fontFamily = JakartaFamily),
            labelMedium = labelMedium.copy(fontFamily = JakartaFamily),
            labelSmall = labelSmall.copy(fontFamily = JakartaFamily),
            bodyLarge = bodyLarge.copy(fontFamily = JakartaFamily),
            bodyMedium = bodyMedium.copy(fontFamily = JakartaFamily),
            bodySmall = bodySmall.copy(fontFamily = JakartaFamily),
        )
    }

@Composable
fun LuminaraTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = NightFoundryColorScheme,
        typography = LuminaraTypography,
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
    val shape = RoundedCornerShape(24.dp)
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
        color = LuminaraColors.Paper2,
        shape = shape,
        border = BorderStroke(1.dp, if (emphasized) LuminaraColors.GoldRule else LuminaraColors.RuleBorder),
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
        modifier =
        Modifier
            .background(color.copy(alpha = 0.12f), CircleShape)
            .padding(horizontal = 10.dp, vertical = 5.dp),
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
            text = status.replace('_', ' ').uppercase(),
            style = LuminaraTextStyles.EyebrowMono.copy(fontSize = 10.sp, color = color),
        )
    }
}

@Composable
fun AiEvidenceDisclosureBar(
    modifier: Modifier = Modifier,
    note: String = "Evidence only. Anything we cannot verify is marked not measured.",
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
        Text(text = text, fontFamily = JakartaFamily, fontWeight = FontWeight.Bold, fontSize = 15.sp)
    }
}

@Composable
fun FoundryFieldColors() =
    OutlinedTextFieldDefaults.colors(
        focusedTextColor = LuminaraColors.Ink,
        unfocusedTextColor = LuminaraColors.Ink,
        focusedBorderColor = LuminaraColors.GoldAccent.copy(alpha = 0.5f),
        unfocusedBorderColor = LuminaraColors.RuleBorder,
        cursorColor = LuminaraColors.GoldAccent,
        focusedLabelColor = LuminaraColors.GoldLight,
        unfocusedLabelColor = LuminaraColors.GoldLight,
        focusedContainerColor = LuminaraColors.Paper3,
        unfocusedContainerColor = LuminaraColors.Paper3,
    )
