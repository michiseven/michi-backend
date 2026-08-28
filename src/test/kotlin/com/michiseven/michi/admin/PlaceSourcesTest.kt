package com.michiseven.michi.admin

import com.michiseven.michi.admin.places.PlaceSources
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PlaceSourcesTest {

    @Test
    fun `identifies known place sources correctly`() {
        assertEquals("kto-tour-jpn", PlaceSources.KTO)
        assertEquals("naver-local", PlaceSources.NAVER)

        assertTrue(PlaceSources.isKnown("kto-tour-jpn"))
        assertTrue(PlaceSources.isKnown("naver-local"))

        assertFalse(PlaceSources.isKnown("kto"))
        assertFalse(PlaceSources.isKnown("naver"))
        assertFalse(PlaceSources.isKnown("unknown"))
        assertFalse(PlaceSources.isKnown(null))
    }

    @Test
    fun `normalizes provider filter query param`() {
        assertNull(PlaceSources.normalizeFilter(null))
        assertNull(PlaceSources.normalizeFilter(""))
        assertNull(PlaceSources.normalizeFilter("all"))
        assertNull(PlaceSources.normalizeFilter("ALL"))

        assertEquals(PlaceSources.KTO, PlaceSources.normalizeFilter("kto"))
        assertEquals(PlaceSources.KTO, PlaceSources.normalizeFilter("kto-tour-jpn"))
        assertEquals(PlaceSources.KTO, PlaceSources.normalizeFilter("KTO-TOUR-JPN"))

        assertEquals(PlaceSources.NAVER, PlaceSources.normalizeFilter("naver"))
        assertEquals(PlaceSources.NAVER, PlaceSources.normalizeFilter("naver-local"))
        assertEquals(PlaceSources.NAVER, PlaceSources.normalizeFilter("NAVER-LOCAL"))

        assertEquals("custom-vendor", PlaceSources.normalizeFilter("custom-vendor"))
    }
}
