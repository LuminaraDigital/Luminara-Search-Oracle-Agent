package com.luminarasuite.app.core.database

import android.content.Context
import androidx.room3.Dao
import androidx.room3.Database
import androidx.room3.Entity
import androidx.room3.Insert
import androidx.room3.OnConflictStrategy
import androidx.room3.PrimaryKey
import androidx.room3.Query
import androidx.room3.Room
import androidx.room3.RoomDatabase
import androidx.sqlite.driver.AndroidSQLiteDriver
import com.luminarasuite.app.core.model.AuditFinding
import com.luminarasuite.app.core.model.AuditHistoryEntry
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "audit_history")
data class AuditHistoryEntity(
    @PrimaryKey
    val id: String,
    val domain: String,
    val focus: String,
    val measuredAt: Long,
    val healthScore: Int?,
    val citationRatePercent: Int?,
    val schemaGapCount: Int?,
    val topCompetitor: String?,
    val title: String,
    val summary: String,
    val reportExcerpt: String,
) {
    fun toDomain(): AuditHistoryEntry =
        AuditHistoryEntry(
            id = id,
            domain = domain,
            focus = focus,
            measuredAt = measuredAt,
            healthScore = healthScore,
            citationRatePercent = citationRatePercent,
            schemaGapCount = schemaGapCount,
            topCompetitor = topCompetitor,
            title = title,
            summary = summary,
            reportExcerpt = reportExcerpt,
        )
}

fun AuditHistoryEntry.toEntity(): AuditHistoryEntity =
    AuditHistoryEntity(
        id = id,
        domain = domain,
        focus = focus,
        measuredAt = measuredAt,
        healthScore = healthScore,
        citationRatePercent = citationRatePercent,
        schemaGapCount = schemaGapCount,
        topCompetitor = topCompetitor,
        title = title,
        summary = summary,
        reportExcerpt = reportExcerpt,
    )

@Entity(tableName = "audit_findings")
data class FindingEntity(
    @PrimaryKey
    val id: String,
    val auditRunId: String,
    val domain: String,
    val category: String,
    val severity: String,
    val title: String,
    val description: String,
    val status: String,
    val createdAt: Long,
    val updatedAt: Long,
) {
    fun toDomain(): AuditFinding =
        AuditFinding(
            id = id,
            auditRunId = auditRunId,
            domain = domain,
            category = category,
            severity = severity,
            title = title,
            description = description,
            status = status,
            createdAt = createdAt,
            updatedAt = updatedAt,
        )
}

fun AuditFinding.toEntity(): FindingEntity =
    FindingEntity(
        id = id,
        auditRunId = auditRunId,
        domain = domain,
        category = category,
        severity = severity,
        title = title,
        description = description,
        status = status,
        createdAt = createdAt,
        updatedAt = updatedAt,
    )

@Dao
interface LuminaraDao {
    @Query("SELECT * FROM audit_history ORDER BY measuredAt DESC LIMIT 50")
    fun observeAuditHistory(): Flow<List<AuditHistoryEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAuditHistory(entries: List<AuditHistoryEntity>)

    @Query("SELECT * FROM audit_findings ORDER BY updatedAt DESC LIMIT 100")
    fun observeFindings(): Flow<List<FindingEntity>>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertFindings(findings: List<FindingEntity>)

    @Query("UPDATE audit_findings SET status = :status, updatedAt = :updatedAt WHERE id = :id")
    suspend fun updateFindingStatus(
        id: String,
        status: String,
        updatedAt: Long,
    )

    @Query("DELETE FROM audit_history")
    suspend fun clearAuditHistory()

    @Query("DELETE FROM audit_findings")
    suspend fun clearFindings()
}

@Database(
    entities = [AuditHistoryEntity::class, FindingEntity::class],
    version = 1,
    exportSchema = true,
)
abstract class LuminaraDatabase : RoomDatabase() {
    abstract fun dao(): LuminaraDao

    companion object {
        fun build(context: Context): LuminaraDatabase =
            Room.databaseBuilder<LuminaraDatabase>(
                context = context.applicationContext,
                name = "luminara.db",
            )
                .setDriver(AndroidSQLiteDriver())
                .build()
    }
}
