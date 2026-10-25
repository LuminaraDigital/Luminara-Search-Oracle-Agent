package com.luminarasuite.app

import android.app.Application
import com.luminarasuite.app.core.auth.KeystoreCredentialVault
import com.luminarasuite.app.core.auth.VaultStorage
import com.luminarasuite.app.core.database.LuminaraDatabase
import com.luminarasuite.app.core.network.DefaultLuminaraRepository
import com.luminarasuite.app.core.network.LuminaraApi
import com.luminarasuite.app.core.network.LuminaraRepository
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

class LuminaraApplication : Application() {
    lateinit var repository: LuminaraRepository
        private set

    override fun onCreate() {
        super.onCreate()
        val vault: VaultStorage = KeystoreCredentialVault(this)
        val database = LuminaraDatabase.build(this)
        val json =
            Json {
                ignoreUnknownKeys = true
                coerceInputValues = true
                explicitNulls = false
            }

        val authInterceptor =
            Interceptor { chain ->
                val token = runBlocking { vault.getSnapshot().idToken }
                val reqBuilder =
                    chain.request().newBuilder()
                        .header("Accept", "application/json")
                if (token.isNotBlank()) {
                    reqBuilder.header("Authorization", "Bearer $token")
                }
                chain.proceed(reqBuilder.build())
            }

        val okHttp =
            OkHttpClient.Builder()
                .addInterceptor(authInterceptor)
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

        repository =
            DefaultLuminaraRepository(
                api = api,
                dao = database.dao(),
                vault = vault,
            )
    }
}
