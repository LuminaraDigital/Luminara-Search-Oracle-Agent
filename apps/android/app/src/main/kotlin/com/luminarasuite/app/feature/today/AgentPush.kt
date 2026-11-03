package com.luminarasuite.app.feature.today

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.luminarasuite.app.EXTRA_OPEN
import com.luminarasuite.app.LuminaraApplication
import com.luminarasuite.app.MainActivity
import com.luminarasuite.app.OPEN_TODAY
import com.luminarasuite.app.R
import com.luminarasuite.app.core.network.WorkspaceGateway
import com.luminarasuite.app.core.reminders.NextFixReminder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** Sign-off and call-back alerts for agents. Only agents who are signed in register a device. */
object AgentPush {
    const val CHANNEL_ID = "agent_signoff"
    private const val NOTIFICATION_ID = 11

    suspend fun register(
        context: Context,
        workspace: WorkspaceGateway,
    ) {
        createChannel(context)
        currentToken()?.let { workspace.registerPushToken(it) }
    }

    /** Called before sign-out, while the session can still prove which account owns the device. */
    suspend fun unregister(workspace: WorkspaceGateway) {
        currentToken()?.let { workspace.removePushToken(it) }
        // If the server call failed, a dead token still stops alerts: FCM reports it and the Worker drops it.
        runCatching {
            suspendCancellableCoroutine<Unit> { cont ->
                FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener { cont.resume(Unit) }
            }
        }
    }

    // Null when Play services or Firebase is unavailable. Alerts are optional, so the app carries on.
    private suspend fun currentToken(): String? =
        runCatching {
            suspendCancellableCoroutine { cont ->
                FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                    cont.resume(task.result.takeIf { task.isSuccessful })
                }
            }
        }.getOrNull()

    fun createChannel(context: Context) {
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Needs your sign-off", NotificationManager.IMPORTANCE_HIGH),
        )
    }

    fun post(
        context: Context,
        title: String,
        body: String,
    ) {
        if (NextFixReminder.needsPermission(context)) return
        createChannel(context)
        val open =
            PendingIntent.getActivity(
                context,
                NOTIFICATION_ID,
                Intent(context, MainActivity::class.java)
                    .putExtra(EXTRA_OPEN, OPEN_TODAY)
                    .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        val notification =
            NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher_monochrome)
                .setContentTitle(title)
                .setContentText(body)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
        context.getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification)
    }
}

class AgentMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        val agentMode = getSharedPreferences("luminara_app", MODE_PRIVATE).getBoolean("agent_mode", false)
        if (!agentMode) return
        val app = application as LuminaraApplication
        scope.launch { app.workspace.registerPushToken(token) }
    }

    // Runs when the app is open. In the background Android shows the notification itself.
    override fun onMessageReceived(message: RemoteMessage) {
        val title = message.notification?.title ?: return
        AgentPush.post(this, title, message.notification?.body.orEmpty())
    }
}
