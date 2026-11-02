package com.luminarasuite.app.core.designsystem

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun ProbeWell(
    beacons: List<ProbeBeacon>,
    running: Boolean,
    caption: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier =
        modifier
            .fillMaxWidth()
            .semantics(mergeDescendants = true) {},
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        ProbeStage(beacons = beacons, running = running)
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            beacons.forEach { beacon ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = beacon.path,
                        style =
                        LuminaraTextStyles.EyebrowMono.copy(
                            fontSize = 10.sp,
                            letterSpacing = 0.6.sp,
                        ),
                    )
                    Text(
                        text = toneWord(beacon.tone),
                        style =
                        LuminaraTextStyles.MetricTabular.copy(
                            fontSize = 11.sp,
                            color = toneColor(beacon.tone),
                        ),
                    )
                }
            }
        }
        Text(text = caption, style = LuminaraTextStyles.Body)
    }
}

@Composable
private fun ProbeStage(
    beacons: List<ProbeBeacon>,
    running: Boolean,
) {
    if (running) {
        RunningProbeStage(beacons)
    } else {
        ProbeCanvas(colors = beacons.map { toneColor(it.tone) }, spark = null)
    }
}

@Composable
private fun RunningProbeStage(beacons: List<ProbeBeacon>) {
    val transition = rememberInfiniteTransition(label = "probe")
    val spark by transition.animateFloat(
        initialValue = 0f,
        targetValue = beacons.size.coerceAtLeast(1).toFloat(),
        animationSpec =
        infiniteRepeatable(
            animation = tween(durationMillis = 1500, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "spark",
    )
    ProbeCanvas(colors = beacons.map { toneColor(it.tone) }, spark = spark)
}

@Composable
private fun ProbeCanvas(
    colors: List<Color>,
    spark: Float?,
) {
    val shape = RoundedCornerShape(22.dp)
    Box(
        modifier =
        Modifier
            .fillMaxWidth()
            .height(132.dp)
            .graphicsLayer {
                rotationX = 16f
                cameraDistance = 18f * density
                this.shape = shape
                clip = true
            }
            .background(LuminaraColors.Paper3)
            .border(1.dp, Color.White.copy(alpha = 0.08f), shape),
    ) {
        Canvas(
            modifier =
            Modifier
                .fillMaxSize()
                .clearAndSetSemantics {},
        ) {
            drawProbeFilaments(colors, spark)
        }
    }
}

private fun DrawScope.drawProbeFilaments(
    colors: List<Color>,
    spark: Float?,
) {
    if (colors.isEmpty()) return
    val top = 18.dp.toPx()
    val bottom = size.height - 18.dp.toPx()
    val xs = List(colors.size) { index -> size.width * (index + 1f) / (colors.size + 1f) }
    drawLine(
        color = Color.White.copy(alpha = 0.14f),
        start = Offset(xs.first(), bottom),
        end = Offset(xs.last(), bottom),
        strokeWidth = 1.dp.toPx(),
        cap = StrokeCap.Round,
    )
    colors.forEachIndexed { index, color ->
        val x = xs[index]
        drawCircle(
            color = color.copy(alpha = 0.16f),
            radius = 22.dp.toPx(),
            center = Offset(x, (top + bottom) / 2f),
        )
        drawLine(
            color = color,
            start = Offset(x, top),
            end = Offset(x, bottom),
            strokeWidth = 2.dp.toPx(),
            cap = StrokeCap.Round,
        )
        drawCircle(color = color, radius = 4.dp.toPx(), center = Offset(x, bottom))
    }
    if (spark == null) return
    val segment = spark.toInt().coerceIn(0, colors.lastIndex)
    val local = (spark - segment).coerceIn(0f, 1f)
    val x = xs[segment]
    val y = top + (bottom - top) * local
    drawCircle(color = LuminaraColors.GoldLight, radius = 5.dp.toPx(), center = Offset(x, y))
}

@Composable
fun LiveTrack(modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "liveTrack")
    val travel by transition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec =
        infiniteRepeatable(
            animation = tween(durationMillis = 1100, easing = LinearEasing),
            repeatMode = RepeatMode.Restart,
        ),
        label = "travel",
    )
    Canvas(
        modifier =
        modifier
            .fillMaxWidth()
            .height(3.dp)
            .clearAndSetSemantics {},
    ) {
        drawRect(color = Color.White.copy(alpha = 0.08f))
        val slug = 56.dp.toPx()
        val head = size.width * travel
        drawRect(
            color = LuminaraColors.GoldLight,
            topLeft = Offset((head - slug).coerceAtLeast(0f), 0f),
            size = Size(slug.coerceAtMost(head), size.height),
        )
    }
}
