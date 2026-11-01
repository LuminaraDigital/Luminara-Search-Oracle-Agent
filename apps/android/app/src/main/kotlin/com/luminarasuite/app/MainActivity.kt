package com.luminarasuite.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBars
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Analytics
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.luminarasuite.app.core.designsystem.LuminaraColors
import com.luminarasuite.app.core.designsystem.LuminaraTheme
import com.luminarasuite.app.core.network.LuminaraRepository
import com.luminarasuite.app.feature.ask.AskScreen
import com.luminarasuite.app.feature.ask.AskViewModel
import com.luminarasuite.app.feature.audit.AuditScreen
import com.luminarasuite.app.feature.audit.AuditViewModel
import com.luminarasuite.app.feature.dashboard.DashboardScreen
import com.luminarasuite.app.feature.dashboard.DashboardViewModel
import com.luminarasuite.app.feature.settings.SettingsScreen
import com.luminarasuite.app.feature.settings.SettingsViewModel
import android.graphics.Color as AndroidColor

enum class LuminaraTab(
    val label: String,
    val icon: ImageVector,
    val tag: String,
) {
    AUDIT("Instant Audit", Icons.Outlined.Analytics, "nav_tab_audit"),
    ASK("Ask", Icons.Outlined.ChatBubbleOutline, "nav_tab_ask"),
    DASHBOARD("Dashboard", Icons.Outlined.Dashboard, "nav_tab_dashboard"),
    SETTINGS("Settings", Icons.Outlined.Settings, "nav_tab_settings"),
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Transparent scrims: the window background draws behind the system bars.
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.dark(AndroidColor.TRANSPARENT),
        )
        val app = application as LuminaraApplication
        setContent {
            LuminaraTheme {
                LuminaraWorkbenchApp(repository = app.repository)
            }
        }
    }
}

@Composable
fun LuminaraWorkbenchApp(repository: LuminaraRepository) {
    var selectedTab by rememberSaveable { mutableStateOf(LuminaraTab.AUDIT) }
    var askSeed by rememberSaveable { mutableStateOf<String?>(null) }
    val bars = WindowInsets.systemBars.union(WindowInsets.displayCutout)

    val auditViewModel = viewModel { AuditViewModel(repository) }
    val askViewModel = viewModel { AskViewModel(repository) }
    val dashboardViewModel = viewModel { DashboardViewModel(repository) }
    val settingsViewModel = viewModel { SettingsViewModel(repository) }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = LuminaraColors.Paper,
        contentWindowInsets = bars.union(WindowInsets.ime),
        bottomBar = {
            NavigationBar(
                containerColor = LuminaraColors.Paper,
                contentColor = LuminaraColors.Ink2,
                tonalElevation = 0.dp,
                windowInsets = bars.only(WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom),
            ) {
                LuminaraTab.entries.forEach { tab ->
                    val selected = selectedTab == tab
                    NavigationBarItem(
                        selected = selected,
                        onClick = { selectedTab = tab },
                        icon = { TabIcon(tab = tab, selected = selected) },
                        label = { Text(tab.label) },
                        colors =
                        NavigationBarItemDefaults.colors(
                            selectedIconColor = LuminaraColors.Ink,
                            selectedTextColor = LuminaraColors.Ink,
                            indicatorColor = Color.Transparent,
                            unselectedIconColor = LuminaraColors.Ink2,
                            unselectedTextColor = LuminaraColors.Ink2,
                        ),
                        modifier = Modifier.testTag(tab.tag),
                    )
                }
            }
        },
    ) { innerPadding ->
        AnimatedContent(
            targetState = selectedTab,
            modifier =
            Modifier
                .fillMaxSize()
                .padding(innerPadding),
            transitionSpec = {
                (
                    fadeIn(tween(220)) +
                        slideInVertically(animationSpec = tween(220)) { it / 24 }
                    ) togetherWith fadeOut(tween(120))
            },
            label = "workbenchTab",
        ) { tab ->
            when (tab) {
                LuminaraTab.AUDIT ->
                    AuditScreen(
                        viewModel = auditViewModel,
                        onAskAbout = { question ->
                            askSeed = question
                            selectedTab = LuminaraTab.ASK
                        },
                    )
                LuminaraTab.ASK ->
                    AskScreen(
                        viewModel = askViewModel,
                        seedPrompt = askSeed,
                        onSeedConsumed = { askSeed = null },
                    )
                LuminaraTab.DASHBOARD -> DashboardScreen(viewModel = dashboardViewModel)
                LuminaraTab.SETTINGS -> SettingsScreen(viewModel = settingsViewModel)
            }
        }
    }
}

@Composable
private fun TabIcon(
    tab: LuminaraTab,
    selected: Boolean,
) {
    val tick by animateFloatAsState(
        targetValue = if (selected) 1f else 0f,
        animationSpec = spring(dampingRatio = 0.62f, stiffness = Spring.StiffnessMedium),
        label = "navTick",
    )
    Box(contentAlignment = Alignment.BottomCenter) {
        Icon(
            imageVector = tab.icon,
            contentDescription = tab.label,
            modifier = Modifier.padding(bottom = 5.dp),
        )
        Box(
            modifier =
            Modifier
                .size(width = 12.dp, height = 3.dp)
                .graphicsLayer {
                    scaleX = tick
                    alpha = tick
                }
                .background(LuminaraColors.GoldAccent, RoundedCornerShape(999.dp)),
        )
    }
}
