package com.luminarasuite.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
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
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(LuminaraColors.Paper.toArgb()),
            navigationBarStyle = SystemBarStyle.dark(LuminaraColors.Paper2.toArgb()),
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

    val auditViewModel = viewModel { AuditViewModel(repository) }
    val askViewModel = viewModel { AskViewModel(repository) }
    val dashboardViewModel = viewModel { DashboardViewModel(repository) }
    val settingsViewModel = viewModel { SettingsViewModel(repository) }

    Scaffold(
        modifier = Modifier.fillMaxSize(),
        containerColor = LuminaraColors.Paper,
        bottomBar = {
            NavigationBar(
                containerColor = LuminaraColors.Paper2,
                contentColor = LuminaraColors.Ink,
            ) {
                LuminaraTab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = selectedTab == tab,
                        onClick = { selectedTab = tab },
                        icon = { Icon(imageVector = tab.icon, contentDescription = tab.label) },
                        label = { Text(tab.label) },
                        colors =
                        NavigationBarItemDefaults.colors(
                            selectedIconColor = LuminaraColors.GoldLight,
                            selectedTextColor = LuminaraColors.GoldLight,
                            indicatorColor = LuminaraColors.Paper3,
                            unselectedIconColor = LuminaraColors.Ink2,
                            unselectedTextColor = LuminaraColors.Ink2,
                        ),
                        modifier = Modifier.testTag(tab.tag),
                    )
                }
            }
        },
    ) { innerPadding ->
        Box(
            modifier =
            Modifier
                .fillMaxSize()
                .padding(innerPadding),
        ) {
            when (selectedTab) {
                LuminaraTab.AUDIT -> AuditScreen(viewModel = auditViewModel)
                LuminaraTab.ASK -> AskScreen(viewModel = askViewModel)
                LuminaraTab.DASHBOARD -> DashboardScreen(viewModel = dashboardViewModel)
                LuminaraTab.SETTINGS -> SettingsScreen(viewModel = settingsViewModel)
            }
        }
    }
}
