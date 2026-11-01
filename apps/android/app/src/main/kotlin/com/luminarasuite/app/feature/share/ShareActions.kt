package com.luminarasuite.app.feature.share

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.luminarasuite.app.core.designsystem.GhostPillButton
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import kotlinx.coroutines.launch

private fun openShareSheet(
    context: Context,
    subject: String,
    text: String,
) {
    val send =
        Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_SUBJECT, subject)
            .putExtra(Intent.EXTRA_TEXT, text)
    context.startActivity(Intent.createChooser(send, subject))
}

/**
 * A public link is published only when the person asks for one. Worker error copy is not shown here
 * because it can name plans, which the Play build must not.
 */
@Composable
fun ShareActions(
    subject: String,
    text: String,
    domain: String?,
    testTagPrefix: String,
    onShareLink: suspend (String, String?) -> Result<String>,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var failed by remember(text) { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        GhostPillButton(
            text = "Share as text",
            onClick = { openShareSheet(context, subject, text) },
            modifier = Modifier.fillMaxWidth(),
            testTag = "${testTagPrefix}_share_button",
        )
        GhostPillButton(
            text = if (busy) "Creating link" else "Create public link",
            onClick = {
                busy = true
                failed = false
                scope.launch {
                    onShareLink(text, domain)
                        .onSuccess { openShareSheet(context, subject, it) }
                        .onFailure { failed = true }
                    busy = false
                }
            },
            enabled = !busy,
            modifier = Modifier.fillMaxWidth(),
            testTag = "${testTagPrefix}_link_button",
        )
        Text(
            text =
            if (failed) {
                "A public link could not be created. Check you are signed in, or share as text."
            } else {
                "Anyone with a public link can read this."
            },
            style = LuminaraTextStyles.Body,
            color = if (failed) LuminaraColors.ErrorRed else LuminaraColors.Ink2,
        )
    }
}
