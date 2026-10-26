package com.luminarasuite.app.core.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.luminarasuite.app.core.model.ByokKeyBag
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val Context.luminaraDataStore by preferencesDataStore(name = "luminara_vault")

data class VaultSnapshot(
    val idToken: String = "",
    val refreshToken: String = "",
    val email: String = "",
    val accountId: String = "",
    val byokKeys: ByokKeyBag = ByokKeyBag(),
    val reportedTurnIds: Set<String> = emptySet(),
) {
    val isSignedIn: Boolean
        get() = idToken.isNotBlank() && email.isNotBlank()
}

interface VaultStorage {
    val snapshotFlow: Flow<VaultSnapshot>

    suspend fun getSnapshot(): VaultSnapshot

    suspend fun saveSession(
        idToken: String,
        refreshToken: String,
        email: String,
        accountId: String,
    )

    suspend fun clearSession()

    suspend fun saveByokKeys(bag: ByokKeyBag)

    suspend fun reportAiTurn(turnId: String)
}

class InMemoryVaultStorage(
    initial: VaultSnapshot = VaultSnapshot(),
) : VaultStorage {
    private val state = MutableStateFlow(initial)
    override val snapshotFlow: Flow<VaultSnapshot> = state

    override suspend fun getSnapshot(): VaultSnapshot = state.value

    override suspend fun saveSession(
        idToken: String,
        refreshToken: String,
        email: String,
        accountId: String,
    ) {
        state.value =
            state.value.copy(
                idToken = idToken,
                refreshToken = refreshToken,
                email = email,
                accountId = accountId,
            )
    }

    override suspend fun clearSession() {
        state.value =
            state.value.copy(
                idToken = "",
                refreshToken = "",
                email = "",
                accountId = "",
            )
    }

    override suspend fun saveByokKeys(bag: ByokKeyBag) {
        state.value = state.value.copy(byokKeys = bag)
    }

    override suspend fun reportAiTurn(turnId: String) {
        state.value =
            state.value.copy(
                reportedTurnIds = state.value.reportedTurnIds + turnId,
            )
    }
}

class KeystoreCredentialVault(
    private val context: Context,
) : VaultStorage {
    companion object {
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEY_ALIAS = "luminara_vault_aes_gcm_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128

        private val KEY_ID_TOKEN = stringPreferencesKey("enc_id_token")
        private val KEY_REFRESH_TOKEN = stringPreferencesKey("enc_refresh_token")
        private val KEY_EMAIL = stringPreferencesKey("user_email")
        private val KEY_ACCOUNT_ID = stringPreferencesKey("account_id")
        private val KEY_GROQ = stringPreferencesKey("enc_groq_key")
        private val KEY_NIM = stringPreferencesKey("enc_nim_key")
        private val KEY_GEMINI = stringPreferencesKey("enc_gemini_key")
        private val KEY_TAVILY = stringPreferencesKey("enc_tavily_key")
        private val KEY_REPORTED_TURNS = stringSetPreferencesKey("reported_turn_ids")
    }

    @Volatile
    private var cachedSnapshot: VaultSnapshot? = null

    override val snapshotFlow: Flow<VaultSnapshot> =
        context.luminaraDataStore.data.map { prefs ->
            VaultSnapshot(
                idToken = decrypt(prefs[KEY_ID_TOKEN].orEmpty()),
                refreshToken = decrypt(prefs[KEY_REFRESH_TOKEN].orEmpty()),
                email = prefs[KEY_EMAIL].orEmpty(),
                accountId = prefs[KEY_ACCOUNT_ID].orEmpty(),
                byokKeys =
                ByokKeyBag(
                    groqKey = decrypt(prefs[KEY_GROQ].orEmpty()),
                    nimKey = decrypt(prefs[KEY_NIM].orEmpty()),
                    geminiKey = decrypt(prefs[KEY_GEMINI].orEmpty()),
                    tavilyKey = decrypt(prefs[KEY_TAVILY].orEmpty()),
                ),
                reportedTurnIds = prefs[KEY_REPORTED_TURNS].orEmpty(),
            ).also { cachedSnapshot = it }
        }

    override suspend fun getSnapshot(): VaultSnapshot = cachedSnapshot ?: snapshotFlow.first()

    override suspend fun saveSession(
        idToken: String,
        refreshToken: String,
        email: String,
        accountId: String,
    ) {
        context.luminaraDataStore.edit { prefs ->
            prefs[KEY_ID_TOKEN] = encrypt(idToken)
            prefs[KEY_REFRESH_TOKEN] = encrypt(refreshToken)
            prefs[KEY_EMAIL] = email.trim()
            prefs[KEY_ACCOUNT_ID] = accountId.trim()
        }
    }

    override suspend fun clearSession() {
        context.luminaraDataStore.edit { prefs ->
            prefs.remove(KEY_ID_TOKEN)
            prefs.remove(KEY_REFRESH_TOKEN)
            prefs.remove(KEY_EMAIL)
            prefs.remove(KEY_ACCOUNT_ID)
        }
    }

    override suspend fun saveByokKeys(bag: ByokKeyBag) {
        context.luminaraDataStore.edit { prefs ->
            prefs[KEY_GROQ] = encrypt(bag.groqKey.trim())
            prefs[KEY_NIM] = encrypt(bag.nimKey.trim())
            prefs[KEY_GEMINI] = encrypt(bag.geminiKey.trim())
            prefs[KEY_TAVILY] = encrypt(bag.tavilyKey.trim())
        }
    }

    override suspend fun reportAiTurn(turnId: String) {
        context.luminaraDataStore.edit { prefs ->
            val current = prefs[KEY_REPORTED_TURNS].orEmpty()
            prefs[KEY_REPORTED_TURNS] = current + turnId
        }
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val existing = keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry
        if (existing != null) return existing.secretKey

        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        val spec =
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    private fun encrypt(plainText: String): String {
        if (plainText.isEmpty()) return ""
        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
            val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
            val cipherBytes = cipher.doFinal(plainText.encodeToByteArray())
            val payload = Base64.encodeToString(cipherBytes, Base64.NO_WRAP)
            "$iv:$payload"
        }.getOrDefault("")
    }

    private fun decrypt(serialized: String): String {
        if (serialized.isEmpty() || !serialized.contains(':')) return ""
        return runCatching {
            val iv = Base64.decode(serialized.substringBefore(':'), Base64.NO_WRAP)
            val cipherBytes = Base64.decode(serialized.substringAfter(':'), Base64.NO_WRAP)
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
            cipher.doFinal(cipherBytes).decodeToString()
        }.getOrDefault("")
    }
}
