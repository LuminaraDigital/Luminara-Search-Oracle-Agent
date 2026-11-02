package com.luminarasuite.app

import android.app.Application
import com.google.firebase.auth.FirebaseAuth
import com.luminarasuite.app.core.auth.AndroidFirebaseAccount
import com.luminarasuite.app.core.auth.KeystoreCredentialVault
import com.luminarasuite.app.core.auth.VaultStorage
import com.luminarasuite.app.core.auth.blockingAppCheckToken
import com.luminarasuite.app.core.auth.installAppCheck
import com.luminarasuite.app.core.database.LuminaraDatabase
import com.luminarasuite.app.core.network.AppCheckTokens
import com.luminarasuite.app.core.network.DefaultLuminaraRepository
import com.luminarasuite.app.core.network.DefaultWorkspaceGateway
import com.luminarasuite.app.core.network.FIREBASE_APP_CHECK_HEADER
import com.luminarasuite.app.core.network.LuminaraApi
import com.luminarasuite.app.core.network.LuminaraRepository
import com.luminarasuite.app.core.network.LuminaraWireJson
import com.luminarasuite.app.core.network.SessionAuthenticator
import com.luminarasuite.app.core.network.WorkspaceGateway
import com.luminarasuite.app.core.network.appCheckHeaderValue
import com.luminarasuite.app.core.network.chooseSessionRefresh
import com.luminarasuite.app.core.network.refreshOverHttp
import kotlinx.coroutines.runBlocking
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

class LuminaraApplication : Application() {
    lateinit var repository: LuminaraRepository
        private set

    lateinit var workspace: WorkspaceGateway
        private set

    override fun onCreate() {
        super.onCreate()
        // Auth enforcement rejects sign-in unless this runs before FirebaseAuth.
        installAppCheck(this)
        val appCheckTokens = AppCheckTokens(read = { blockingAppCheckToken() })
        val vault: VaultStorage = KeystoreCredentialVault(this)
        val firebase = AndroidFirebaseAccount(FirebaseAuth.getInstance())
        val database = LuminaraDatabase.build(this)
        val json = LuminaraWireJson

        val authInterceptor =
            Interceptor { chain ->
                val token = runBlocking { vault.getSnapshot().idToken }
                val reqBuilder =
                    chain.request().newBuilder()
                        .header("Accept", "application/json")
                if (token.isNotBlank()) {
                    reqBuilder.header("Authorization", "Bearer $token")
                }
                appCheckHeaderValue(appCheckTokens.current())?.let { appCheck ->
                    reqBuilder.header(FIREBASE_APP_CHECK_HEADER, appCheck)
                }
                chain.proceed(reqBuilder.build())
            }

        val okHttp =
            OkHttpClient.Builder()
                .addInterceptor(authInterceptor)
                .authenticator(
                    SessionAuthenticator(vault) { refreshToken ->
                        chooseSessionRefresh(
                            refreshToken,
                            sdk = { runBlocking { firebase.forceRefresh() } },
                            http = refreshOverHttp(BuildConfig.API_BASE_URL, json) { appCheckTokens.current() },
                        )
                    },
                )
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .build()

        val api =
            Retrofit.Builder()
                .baseUrl(BuildConfig.API_BASE_URL)
                .client(okHttp)
                .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
                .build()
                .create(LuminaraApi::class.java)

        workspace = DefaultWorkspaceGateway(api)
        repository =
            DefaultLuminaraRepository(
                api = api,
                dao = database.dao(),
                vault = vault,
                firebase = firebase,
            )
    }
}
