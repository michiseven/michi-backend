package com.michiseven.michi.admin.auth

import de.mkammerer.argon2.Argon2Factory

class PasswordHasher {
    fun hash(password: CharArray): String {
        val argon2 = Argon2Factory.create(Argon2Factory.Argon2Types.ARGON2id)
        return try {
            argon2.hash(3, 65_536, 1, password)
        } finally {
            argon2.wipeArray(password)
        }
    }

    fun verify(hash: String, password: CharArray): Boolean {
        val argon2 = Argon2Factory.create(Argon2Factory.Argon2Types.ARGON2id)
        return try {
            argon2.verify(hash, password)
        } finally {
            argon2.wipeArray(password)
        }
    }
}
