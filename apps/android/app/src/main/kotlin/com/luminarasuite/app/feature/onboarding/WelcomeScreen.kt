package com.luminarasuite.app.feature.onboarding

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.luminarasuite.app.core.designsystem.AccentHeadline
import com.luminarasuite.app.core.designsystem.FoundryButton
import com.luminarasuite.app.core.designsystem.FoundryFieldColors
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraOrb
import com.luminarasuite.app.core.designsystem.LuminaraTextStyles
import com.luminarasuite.app.core.designsystem.ObsidianBackdrop

/** First run asks one thing: which site. The first answer is the product, not a tour of it. */
@Composable
fun WelcomeScreen(
    onCheckSite: (String) -> Unit,
    onSkip: () -> Unit,
    onAgent: () -> Unit = {},
) {
    var host by rememberSaveable { mutableStateOf("") }
    ObsidianBackdrop {
        Column(
            modifier =
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Spacer(modifier = Modifier.height(36.dp))
            LuminaraOrb(size = 200.dp, thinking = false)
            Spacer(modifier = Modifier.height(8.dp))
            Box(modifier = Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                AccentHeadline(
                    lead = "Will AI mention ",
                    accent = "your brand",
                    trail = "?",
                    align = TextAlign.Center,
                )
            }
            Text(
                text = "Paste your site. Get a plain answer, the evidence behind it, and one thing to fix this week.",
                style = LuminaraTextStyles.Body.copy(textAlign = TextAlign.Center),
            )
            Spacer(modifier = Modifier.height(6.dp))
            OutlinedTextField(
                value = host,
                onValueChange = { host = it },
                placeholder = { Text("yoursite.com", color = LuminaraColors.Ink3) },
                singleLine = true,
                shape = RoundedCornerShape(16.dp),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
                keyboardActions = KeyboardActions(onGo = { if (host.isNotBlank()) onCheckSite(host) }),
                colors = FoundryFieldColors(),
                modifier =
                Modifier
                    .fillMaxWidth()
                    .testTag("welcome_domain_input"),
            )
            FoundryButton(
                text = "Check my site",
                onClick = { onCheckSite(host) },
                enabled = host.isNotBlank(),
                testTag = "welcome_check_button",
            )
            TextButton(onClick = onSkip, modifier = Modifier.testTag("welcome_skip_button")) {
                Text(text = "Look around first", color = LuminaraColors.Ink2)
            }
            OutlinedButton(
                onClick = onAgent,
                shape = RoundedCornerShape(999.dp),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("welcome_agent_button"),
            ) {
                Text(text = "I'm a real-estate agent", color = LuminaraColors.GoldLight)
            }
            Text(
                text =
                "No account needed for this check. " +
                    "AI answers can be wrong, and we say when something is not measured.",
                style = LuminaraTextStyles.Body.copy(color = LuminaraColors.Ink3, textAlign = TextAlign.Center),
            )
        }
    }
}
