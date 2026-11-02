package com.luminarasuite.app.core.designsystem

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.ArrowUpward
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.luminarasuite.app.R

/** Shared side gutter for every screen. */
val ScreenGutter = 16.dp

@Composable
fun LuminaraMark(
    size: Dp,
    modifier: Modifier = Modifier,
) {
    Image(
        painter = painterResource(R.drawable.luminara_mark),
        contentDescription = "Luminara Suite",
        modifier = modifier.size(size),
    )
}

/** Obsidian canvas with one ambient gold glow behind the top of the screen. */
@Composable
fun ObsidianBackdrop(content: @Composable BoxScope.() -> Unit) {
    Box(
        modifier =
        Modifier
            .fillMaxSize()
            .background(LuminaraColors.Paper),
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            drawCircle(
                brush =
                Brush.radialGradient(
                    colors = listOf(LuminaraColors.GoldAccent.copy(alpha = 0.09f), Color.Transparent),
                    center = Offset(size.width * 0.5f, 0f),
                    radius = size.width * 0.95f,
                ),
                radius = size.width * 0.95f,
                center = Offset(size.width * 0.5f, 0f),
            )
        }
        content()
    }
}

/**
 * The logo's atom as a live object. Orbits drift at rest and quicken with a brighter core while
 * work is running, so waiting reads as the product thinking rather than a spinner.
 */
@Composable
fun LuminaraOrb(
    size: Dp,
    thinking: Boolean,
    modifier: Modifier = Modifier,
) {
    val transition = rememberInfiniteTransition(label = "orb")
    val spin by transition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(tween(if (thinking) 5200 else 26000, easing = LinearEasing)),
        label = "orbSpin",
    )
    val pulse by transition.animateFloat(
        initialValue = 0.82f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(if (thinking) 700 else 2600), RepeatMode.Reverse),
        label = "orbPulse",
    )
    Canvas(
        modifier =
        modifier
            .size(size)
            .semantics { contentDescription = if (thinking) "Working" else "Luminara" },
    ) {
        val radius = this.size.minDimension / 2f
        val center = Offset(this.size.width / 2f, this.size.height / 2f)
        drawCircle(
            brush =
            Brush.radialGradient(
                colors = listOf(LuminaraColors.GoldAccent.copy(alpha = 0.34f * pulse), Color.Transparent),
                center = center,
                radius = radius,
            ),
            radius = radius,
            center = center,
        )
        val orbit = Size(radius * 1.72f, radius * 0.62f)
        val gold =
            Brush.linearGradient(
                listOf(LuminaraColors.GoldDark, LuminaraColors.GoldLight, LuminaraColors.GoldAccent),
            )
        listOf(0f, 60f, 120f).forEach { tilt ->
            rotate(tilt + spin / 3f, center) {
                drawOval(
                    brush = gold,
                    topLeft = Offset(center.x - orbit.width / 2f, center.y - orbit.height / 2f),
                    size = orbit,
                    style = Stroke(width = radius * 0.035f, cap = StrokeCap.Round),
                )
            }
        }
        drawCircle(
            brush =
            Brush.radialGradient(
                colors = listOf(Color(0xFFFFF4D6), LuminaraColors.GoldLight, LuminaraColors.GoldAccent),
                center = center,
                radius = radius * 0.2f,
            ),
            radius = radius * 0.18f * pulse.coerceAtLeast(0.9f),
            center = center,
        )
    }
}

/** Editorial headline with one gold italic phrase. */
@Composable
fun AccentHeadline(
    lead: String,
    accent: String,
    modifier: Modifier = Modifier,
    trail: String = "",
    align: TextAlign = TextAlign.Start,
) {
    Text(
        text =
        buildAnnotatedString {
            append(lead)
            withStyle(SpanStyle(color = LuminaraColors.GoldLight, fontStyle = FontStyle.Italic)) {
                append(accent)
            }
            append(trail)
        },
        style = LuminaraTextStyles.DisplaySerif.copy(textAlign = align),
        modifier = modifier,
    )
}

@Composable
fun LiveEyebrow(
    text: String,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(
            modifier =
            Modifier
                .size(6.dp)
                .background(LuminaraColors.GoldAccent, CircleShape),
        )
        EyebrowKicker(text)
    }
}

@Composable
fun SectionHeader(
    title: String,
    modifier: Modifier = Modifier,
    trailing: String? = null,
) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text = title, style = LuminaraTextStyles.HeadlineSerif)
        if (trailing != null) {
            Text(text = trailing, style = LuminaraTextStyles.Body.copy(fontSize = 12.sp))
        }
    }
}

/** Secondary pill. Quiet on purpose so the gold action stays the only loud thing. */
@Composable
fun GhostPillButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    icon: ImageVector? = null,
    testTag: String? = null,
) {
    val haptics = LocalHapticFeedback.current
    Surface(
        modifier =
        modifier
            .clip(CircleShape)
            .clickable(enabled = enabled, role = Role.Button) {
                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                onClick()
            }.then(if (testTag != null) Modifier.testTag(testTag) else Modifier),
        color = Color.White.copy(alpha = 0.04f),
        shape = CircleShape,
        border = BorderStroke(1.dp, LuminaraColors.RuleStrong),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 13.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (icon != null) {
                Icon(icon, contentDescription = null, tint = LuminaraColors.GoldLight, modifier = Modifier.size(18.dp))
            }
            Text(
                text = text,
                style =
                LuminaraTextStyles.SectionTitle.copy(
                    fontSize = 14.sp,
                    color = if (enabled) LuminaraColors.Ink else LuminaraColors.Ink3,
                ),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
fun PillChip(
    text: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val haptics = LocalHapticFeedback.current
    Box(
        modifier =
        modifier
            .clip(CircleShape)
            .background(if (selected) LuminaraColors.GoldAccent else Color.Transparent, CircleShape)
            .border(1.dp, if (selected) LuminaraColors.GoldAccent else LuminaraColors.RuleStrong, CircleShape)
            .clickable(role = Role.Tab) {
                haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                onClick()
            }.padding(horizontal = 16.dp, vertical = 11.dp),
    ) {
        Text(
            text = text,
            style =
            LuminaraTextStyles.Body.copy(
                fontSize = 13.sp,
                lineHeight = 18.sp,
                color = if (selected) LuminaraColors.AccentInk else LuminaraColors.Ink2,
            ),
            maxLines = 1,
        )
    }
}

@Composable
fun ChipStrip(content: @Composable () -> Unit) {
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        content()
    }
}

/** Sticky prompt pill used by Ask and Studio. */
@Composable
fun PromptBar(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    onSend: () -> Unit,
    busy: Boolean,
    modifier: Modifier = Modifier,
    inputTag: String? = null,
    sendTag: String? = null,
) {
    val canSend = value.isNotBlank() && !busy
    val keyboard = LocalSoftwareKeyboardController.current
    val send = {
        keyboard?.hide()
        onSend()
    }
    Row(
        modifier =
        modifier
            .fillMaxWidth()
            .background(LuminaraColors.Paper2, RoundedCornerShape(28.dp))
            .border(1.dp, LuminaraColors.RuleStrong, RoundedCornerShape(28.dp))
            .padding(start = 20.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier =
            Modifier
                .weight(1f)
                .padding(vertical = 8.dp),
        ) {
            if (value.isEmpty()) {
                Text(
                    text = placeholder,
                    style = LuminaraTextStyles.Body.copy(color = LuminaraColors.Ink3),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                textStyle = LuminaraTextStyles.Body.copy(color = LuminaraColors.Ink),
                cursorBrush = SolidColor(LuminaraColors.GoldAccent),
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { if (canSend) send() }),
                modifier =
                Modifier
                    .fillMaxWidth()
                    .then(if (inputTag != null) Modifier.testTag(inputTag) else Modifier),
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        Box(
            modifier =
            Modifier
                .size(44.dp)
                .clip(CircleShape)
                .background(if (canSend) LuminaraColors.GoldAccent else LuminaraColors.Paper3)
                .clickable(enabled = canSend, role = Role.Button, onClick = send)
                .then(if (sendTag != null) Modifier.testTag(sendTag) else Modifier),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Outlined.ArrowUpward,
                contentDescription = "Send",
                tint = if (canSend) LuminaraColors.AccentInk else LuminaraColors.Ink3,
            )
        }
    }
}

/** Honest empty state: says what fills this space and gives the one action that fills it. */
@Composable
fun EmptyStateCard(
    title: String,
    body: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    action: String? = null,
    onAction: () -> Unit = {},
) {
    WorkbenchCard(modifier = modifier) {
        Column(
            modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Box(
                modifier =
                Modifier
                    .size(56.dp)
                    .background(LuminaraColors.Paper3, RoundedCornerShape(16.dp)),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = LuminaraColors.GoldAccent)
            }
            Text(text = title, style = LuminaraTextStyles.HeadlineSerif)
            Text(text = body, style = LuminaraTextStyles.Body.copy(textAlign = TextAlign.Center))
            if (action != null) {
                Spacer(modifier = Modifier.height(2.dp))
                FoundryButton(text = action, onClick = onAction)
            }
        }
    }
}

/** Tappable row with a leading icon well and a chevron, for doors into other screens. */
@Composable
fun DoorRow(
    title: String,
    subtitle: String,
    icon: ImageVector,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    testTag: String? = null,
) {
    WorkbenchCard(
        modifier = modifier.then(if (testTag != null) Modifier.testTag(testTag) else Modifier),
        onClick = onClick,
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Box(
                modifier =
                Modifier
                    .size(44.dp)
                    .background(LuminaraColors.Paper3, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, contentDescription = null, tint = LuminaraColors.GoldAccent, modifier = Modifier.size(20.dp))
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(text = title, style = LuminaraTextStyles.SectionTitle.copy(fontSize = 15.sp))
                Text(text = subtitle, style = LuminaraTextStyles.Body.copy(fontSize = 12.sp, lineHeight = 17.sp))
            }
            Icon(
                Icons.AutoMirrored.Outlined.ArrowForward,
                contentDescription = null,
                tint = LuminaraColors.Ink3,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

/** Required next to every piece of AI output by the Play declaration. */
@Composable
fun ReportAiOutput(
    reported: Boolean,
    onReport: () -> Unit,
    modifier: Modifier = Modifier,
) {
    TextButton(onClick = onReport, enabled = !reported, modifier = modifier) {
        Text(
            text = if (reported) "Reported" else "Report AI output",
            color = LuminaraColors.Ink2,
            fontSize = 12.sp,
        )
    }
}

/** Fraction ring for real counts only. Never pass an estimated score. */
@Composable
fun ProgressRing(
    fraction: Float,
    label: String,
    modifier: Modifier = Modifier,
    size: Dp = 84.dp,
) {
    Box(modifier = modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(modifier = Modifier.fillMaxSize().rotate(-90f)) {
            val stroke = Stroke(width = 7.dp.toPx(), cap = StrokeCap.Round)
            drawArc(LuminaraColors.Paper3, 0f, 360f, useCenter = false, style = stroke)
            drawArc(
                brush = Brush.sweepGradient(listOf(LuminaraColors.GoldDark, LuminaraColors.GoldLight)),
                startAngle = 0f,
                sweepAngle = 360f * fraction.coerceIn(0f, 1f),
                useCenter = false,
                style = stroke,
            )
        }
        Text(text = label, style = LuminaraTextStyles.MetricTabular.copy(fontSize = 18.sp))
    }
}
