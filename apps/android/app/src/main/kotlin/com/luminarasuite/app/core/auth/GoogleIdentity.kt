package com.luminarasuite.app.core.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialInterruptedException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnsupportedException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/** A Google sign-in problem the person can act on, in words they can act on. */
class GoogleSignInException(
    message: String,
) : IllegalStateException(message)

internal fun googleSignInFailure(err: GetCredentialException): GoogleSignInException =
    GoogleSignInException(
        when (err) {
            is NoCredentialException ->
                "No Google account on this phone. Add one in your phone settings, or sign in with email."
            is GetCredentialProviderConfigurationException, is GetCredentialUnsupportedException ->
                "Google sign-in needs an up-to-date Google Play services. Sign in with email instead."
            is GetCredentialInterruptedException -> "Google sign-in was interrupted. Try again."
            else -> "Google sign-in could not start. Try again, or sign in with email."
        },
    )

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
        } catch (err: GetCredentialException) {
            throw googleSignInFailure(err)
        }
    check(
        credential is CustomCredential && credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL,
    ) {
        "Google did not return an account. Try again."
    }
    return GoogleIdTokenCredential.createFrom(credential.data).idToken
}
