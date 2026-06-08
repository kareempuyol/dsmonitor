import { safeStorage } from 'electron'

/**
 * Encrypts/decrypts API keys using Electron's safeStorage (Windows DPAPI / macOS Keychain).
 * Keys are stored as base64-encoded ciphertext in SQLite.
 */
class SecureStorage {
  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  encrypt(plaintext: string): string {
    if (!plaintext) return ''
    const buffer = safeStorage.encryptString(plaintext)
    return buffer.toString('base64')
  }

  decrypt(ciphertext: string): string {
    if (!ciphertext) return ''
    try {
      const buffer = Buffer.from(ciphertext, 'base64')
      return safeStorage.decryptString(buffer)
    } catch {
      // Handle case where key was stored before encryption was enabled
      // (migration path from plaintext to encrypted)
      console.warn('[SecureStorage] Decryption failed, treating as plaintext')
      return ciphertext
    }
  }
}

export const secureStorage = new SecureStorage()
