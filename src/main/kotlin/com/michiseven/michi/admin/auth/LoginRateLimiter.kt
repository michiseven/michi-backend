package com.michiseven.michi.admin.auth

import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.concurrent.ConcurrentHashMap

class LoginRateLimiter(
    private val maximumAttempts: Int = 5,
    private val window: Duration = Duration.ofMinutes(15),
    private val clock: Clock = Clock.systemUTC()
) {
    private val failures = ConcurrentHashMap<String, ArrayDeque<Instant>>()

    fun isBlocked(key: String): Boolean {
        val attempts = failures[key] ?: return false
        synchronized(attempts) {
            removeExpired(attempts)
            return attempts.size >= maximumAttempts
        }
    }

    fun recordFailure(key: String) {
        val attempts = failures.computeIfAbsent(key) { ArrayDeque() }
        synchronized(attempts) {
            removeExpired(attempts)
            attempts.addLast(clock.instant())
        }
    }

    fun reset(key: String) {
        failures.remove(key)
    }

    private fun removeExpired(attempts: ArrayDeque<Instant>) {
        val cutoff = clock.instant().minus(window)
        while (attempts.firstOrNull()?.isBefore(cutoff) == true) {
            attempts.removeFirst()
        }
    }
}
