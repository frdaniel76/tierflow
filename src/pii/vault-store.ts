/**
 * VaultStore — session lifecycle management for SecretVault instances.
 * Session lifecycle management for TierFlow PII vaults.
 *
 * Each request gets its own vault session with a sliding TTL.
 * A background sweep runs every 5 minutes to clean up expired sessions.
 */

import { randomBytes } from "node:crypto";
import { SecretVault } from "./vault.js";

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_SESSIONS = 1000; // M-5: cap to prevent unbounded memory growth

interface Session {
  vault: SecretVault;
  createdAt: number;
  lastAccess: number;
  ttlMs: number;
}

export class VaultStore {
  private sessions = new Map<string, Session>();
  private sweepTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref(); // Don't keep process alive for sweep
  }

  /**
   * Generate a unique session ID (16-char hex).
   */
  generateId(): string {
    return randomBytes(8).toString("hex");
  }

  /**
   * Get an existing vault session.
   */
  get(sessionId: string): SecretVault | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    // Check TTL
    if (Date.now() - session.lastAccess > session.ttlMs) {
      this.destroy(sessionId);
      return undefined;
    }

    session.lastAccess = Date.now();
    return session.vault;
  }

  /**
   * Get or create a vault session.
   */
  getOrCreate(sessionId: string, exclude?: string[]): SecretVault {
    const existing = this.get(sessionId);
    if (existing) return existing;

    // M-5: evict oldest session if at capacity
    if (this.sessions.size >= MAX_SESSIONS) {
      const oldestId = this.sessions.keys().next().value;
      if (oldestId) this.destroy(oldestId);
    }

    const vault = new SecretVault(exclude);
    this.sessions.set(sessionId, {
      vault,
      createdAt: Date.now(),
      lastAccess: Date.now(),
      ttlMs: DEFAULT_TTL_MS,
    });
    return vault;
  }

  /**
   * Destroy a session and zero its vault key.
   */
  destroy(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.vault.destroy();
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Sweep expired sessions.
   */
  sweep(): number {
    const now = Date.now();
    let swept = 0;
    for (const [id, session] of this.sessions) {
      if (now - session.lastAccess > session.ttlMs) {
        session.vault.destroy();
        this.sessions.delete(id);
        swept++;
      }
    }
    return swept;
  }

  /**
   * Number of active sessions.
   */
  get size(): number {
    return this.sessions.size;
  }

  /**
   * Shutdown: destroy all sessions and stop the sweep timer.
   */
  shutdown(): void {
    clearInterval(this.sweepTimer);
    for (const [id] of this.sessions) {
      this.destroy(id);
    }
  }
}
