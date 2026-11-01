package com.luminarasuite.app.core.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/** Opens the system account sheet. Null means the person closed it, which is not an error. */
suspend fun requestGoogleIdToken(
    activityContext: Context,
    webClientId: String,
): String? {
    val option =
        GetGoogleIdOption.Builder()
            .setServerClientId(webClientId)
            .setFilterByAuthorizedAccounts(false)
            .build()
    val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
    val credential =
        try {
            CredentialManager.create(activityContext).getCredential(activityContext, request).credential
        } catch (_: GetCredentialCancellationException) {
            return null
        }
    check(
        credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL,
    ) {
        "Google did not return an account. Try again."
    }
    return GoogleIdTokenCredential.createFrom(credential.data).idToken
}
