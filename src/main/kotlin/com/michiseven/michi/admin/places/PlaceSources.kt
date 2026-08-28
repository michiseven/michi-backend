package com.michiseven.michi.admin.places

object PlaceSources {
    const val KTO = "kto-tour-jpn"
    const val NAVER = "naver-local"
    const val KAKAO = "kakao-local"
    const val MOCK = "mock-place"

    fun isKnown(source: String?): Boolean {
        return source == KTO || source == NAVER || source == KAKAO || source == MOCK
    }

    fun normalizeFilter(provider: String?): String? {
        if (provider.isNullOrBlank() || provider.equals("all", ignoreCase = true)) {
            return null
        }
        val trimmed = provider.trim()
        return when (trimmed.lowercase()) {
            "kto", KTO -> KTO
            "naver", NAVER -> NAVER
            "kakao", KAKAO -> KAKAO
            "mock", MOCK -> MOCK
            else -> trimmed
        }
    }
}
