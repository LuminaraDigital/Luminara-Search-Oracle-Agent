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
import com.luminarasuite.app.EXTRA_ENQUIRY_ID
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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** Sign-off and call-back alerts for agents. Only agents who are signed in register a device. */
object AgentPush {
    const val CHANNEL_ID = "agent_signoff"
    const val PREFS = "luminara_app"
    const val KEY_AGENT_MODE = "agent_mode"

    fun isAgentMode(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_AGENT_MODE, false)

    // Android shows a tagged FCM notification under id 0. Alerts posted here use it too,
    // so one cancel covers both.
    private const val TAGGED_NOTIFICATION_ID = 0

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

    /** [tag] names the item, so a repeat replaces the earlier alert and [dismiss] can remove it. */
    fun post(
        context: Context,
        title: String,
        body: String,
        tag: String?,
        enquiryId: String?,
    ) {
        if (NextFixReminder.needsPermission(context)) return
        createChannel(context)
        val open =
            PendingIntent.getActivity(
                context,
                tag.hashCode(),
                Intent(context, MainActivity::class.java)
                    .putExtra(EXTRA_OPEN, OPEN_TODAY)
                    .putExtra(EXTRA_ENQUIRY_ID, enquiryId)
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
        context.getSystemService(NotificationManager::class.java)?.notify(tag, TAGGED_NOTIFICATION_ID, notification)
    }

    /** The item was handled somewhere else, so its alert leaves this phone. */
    fun dismiss(
        context: Context,
        tag: String,
    ) {
        context.getSystemService(NotificationManager::class.java)?.cancel(tag, TAGGED_NOTIFICATION_ID)
    }
}

class AgentMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    override fun onNewToken(token: String) {
        if (!AgentPush.isAgentMode(this)) return
        val app = application as LuminaraApplication
        scope.launch {
            if (app.repository.vaultFlow.first().isSignedIn) app.workspace.registerPushToken(token)
        }
    }

    // Alerts arrive here only when the app is open; in the background Android shows them itself.
    // A dismissal is data only, so it arrives here either way.
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        if (data["kind"] == "dismiss") {
            data["tag"]?.let { AgentPush.dismiss(this, it) }
            return
        }
        val title = message.notification?.title ?: return
        AgentPush.post(this, title, message.notification?.body.orEmpty(), data["tag"], data["enquiryId"])
    }
}
