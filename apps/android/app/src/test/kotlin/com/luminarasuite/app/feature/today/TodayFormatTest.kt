package com.luminarasuite.app.feature.today

import com.luminarasuite.app.core.model.ScorecardSegment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TodayFormatTest {
    @Test
    fun phonesKeepOnlyDigitsAndALeadingPlus() {
        assertEquals("+61412345678", dialablePhone("+61 412 345 678"))
        // Star and hash are removed, so a call-forward code becomes plain digits the dialer will not run.
        assertEquals("210400", dialablePhone("*21*0400#"))
        assertNull(dialablePhone("12+34567"))
        assertNull(dialablePhone(null))
    }

    @Test
    fun emailsThatCouldAddComposerFieldsAreDropped() {
        assertEquals("pat@example.com", safeEmail(" pat@example.com "))
        assertNull(safeEmail("pat@example.com?bcc=x@y.com"))
        assertNull(safeEmail("pat@example.com&body=hi"))
        assertNull(safeEmail("not-an-email"))
    }

    @Test
    fun timesReadInMelbourne() {
        // 2026-11-06T04:00:00Z is 3:00 pm on Friday 6 Nov in Melbourne (AEDT, UTC+11).
        assertEquals("Fri 6 Nov, 3:00 pm", formatMelbourne(1_793_937_600_000L))
        assertEquals("Fri 6 Nov", formatDay(1_793_937_600_000L))
    }

    @Test
    fun scorecardUsesPlainWordsAndSingulars() {
        assertEquals(
            "1 new enquiry · 0 ready for an appraisal · 2 appraisals booked",
            scorecardLine(ScorecardSegment(enquiries = 1, qualified = 0, appraisalsBooked = 2)),
        )
    }
}
