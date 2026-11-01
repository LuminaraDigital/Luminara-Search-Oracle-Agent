package com.luminarasuite.app.core.reminders

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.luminarasuite.app.LuminaraApplication
import com.luminarasuite.app.MainActivity
import com.luminarasuite.app.R
import com.luminarasuite.app.core.model.CrewRules
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

/** Opt-in weekly nudge. It reads the findings already on the device and sends nothing anywhere. */
object NextFixReminder {
    private const val PREFS = "luminara_app"
    private const val KEY_ENABLED = "weekly_reminder"
    private const val WORK_NAME = "weekly_next_fix"
    private const val INTERVAL_DAYS = 7L
    const val CHANNEL_ID = "next_fix"
    const val NOTIFICATION_ID = 7

    fun isEnabled(context: Context): Boolean =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ENABLED, false)

    fun setEnabled(
        context: Context,
        enabled: Boolean,
    ) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(KEY_ENABLED, enabled).apply()
        val work = WorkManager.getInstance(context)
        if (enabled) {
            createChannel(context)
            work.enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<NextFixWorker>(INTERVAL_DAYS, TimeUnit.DAYS)
                    .setInitialDelay(INTERVAL_DAYS, TimeUnit.DAYS)
                    .build(),
            )
        } else {
            work.cancelUniqueWork(WORK_NAME)
        }
    }

    fun needsPermission(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED

    private fun createChannel(context: Context) {
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Weekly next fix", NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    fun post(
        context: Context,
        title: String,
    ) {
        if (needsPermission(context)) return
        val open =
            PendingIntent.getActivity(
                context,
                0,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        val notification =
            NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_launcher_monochrome)
                .setContentTitle("This week's next fix")
                .setContentText(title)
                .setStyle(NotificationCompat.BigTextStyle().bigText(title))
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
        context.getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION_ID, notification)
    }
}

class NextFixWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val repository = (applicationContext as LuminaraApplication).repository
        // No open work means no notification. A reminder never invents a task.
        CrewRules.pickNextFix(repository.findingsFlow.first())
            ?.takeIf { it.status == "open" || it.status == "in_progress" }
            ?.let { NextFixReminder.post(applicationContext, "${it.domain}: ${it.title}") }
        return Result.success()
    }
}
