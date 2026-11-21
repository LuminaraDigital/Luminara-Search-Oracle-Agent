package com.luminarasuite.app.core.auth

import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.exceptions.NoCredentialException
import org.junit.Assert.assertEquals
import org.junit.Test

class GoogleIdentityTest {
    @Test
    fun noGoogleAccountOnThePhoneTellsThePersonWhatToDo() {
        val failure = googleSignInFailure(NoCredentialException())

        assertEquals(
            "No Google account on this phone. Add one in your phone settings, or sign in with email.",
            failure.message,
        )
    }

    @Test
    fun missingPlayServicesPointsToEmailSignIn() {
        val failure = googleSignInFailure(GetCredentialProviderConfigurationException())

        assertEquals(
            "Google sign-in needs an up-to-date Google Play services. Sign in with email instead.",
            failure.message,
        )
    }

    @Test
    fun anythingElseStillOffersEmail() {
        val failure = googleSignInFailure(GetCredentialUnknownException())

        assertEquals("Google sign-in could not start. Try again, or sign in with email.", failure.message)
    }
}
