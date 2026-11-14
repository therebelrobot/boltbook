import { createHash, randomBytes } from 'node:crypto'

/**
 * Sessions live only in memory. Consequences, all intentional:
 * - Restarting the server signs everyone out.
 * - The session cookie carries a random token; only its SHA-256 hash is kept,
 *   so a heap dump of the session map cannot be replayed as cookies.
 *
 * Unlike resonate/reframe a session holds no key: boltbook stores plaintext
 * (docs/adr/0001), so a session is identity, not access to a decryptable store.
 */
export interface Session {
  tokenHash: string
  createdAtMilliseconds: number
  lastSeenAtMilliseconds: number
  /** Authenticator secret generated during enrollment, until the first code confirms it. */
  pendingTotpSecret: Buffer | null
}

export class SessionStore {
  private readonly sessionsByTokenHash = new Map<string, Session>()

  constructor(
    private readonly idleTimeoutMilliseconds: number,
    private readonly absoluteTimeoutMilliseconds: number,
    private readonly currentTimeMilliseconds: () => number = Date.now,
  ) {}

  static hashToken(sessionToken: string): string {
    return createHash('sha256').update(sessionToken).digest('hex')
  }

  create(): { sessionToken: string; session: Session } {
    const sessionToken = randomBytes(32).toString('base64url')
    const nowMilliseconds = this.currentTimeMilliseconds()
    const session: Session = {
      tokenHash: SessionStore.hashToken(sessionToken),
      createdAtMilliseconds: nowMilliseconds,
      lastSeenAtMilliseconds: nowMilliseconds,
      pendingTotpSecret: null,
    }
    this.sessionsByTokenHash.set(session.tokenHash, session)
    return { sessionToken, session }
  }

  /** Returns the live session and slides its idle window, or null if missing/expired. */
  touch(sessionToken: string | undefined): Session | null {
    if (!sessionToken) return null
    const tokenHash = SessionStore.hashToken(sessionToken)
    const session = this.sessionsByTokenHash.get(tokenHash)
    if (!session) return null
    const nowMilliseconds = this.currentTimeMilliseconds()
    if (this.isExpired(session, nowMilliseconds)) {
      this.destroyByHash(tokenHash)
      return null
    }
    session.lastSeenAtMilliseconds = nowMilliseconds
    return session
  }

  destroy(sessionToken: string | undefined): void {
    if (!sessionToken) return
    this.destroyByHash(SessionStore.hashToken(sessionToken))
  }

  destroyAll(): void {
    for (const tokenHash of [...this.sessionsByTokenHash.keys()]) this.destroyByHash(tokenHash)
  }

  /** Removes expired sessions; called on a timer. */
  sweepExpired(): number {
    const nowMilliseconds = this.currentTimeMilliseconds()
    let removedCount = 0
    for (const [tokenHash, session] of this.sessionsByTokenHash) {
      if (this.isExpired(session, nowMilliseconds)) {
        this.destroyByHash(tokenHash)
        removedCount += 1
      }
    }
    return removedCount
  }

  get activeSessionCount(): number {
    return this.sessionsByTokenHash.size
  }

  private isExpired(session: Session, nowMilliseconds: number): boolean {
    return (
      nowMilliseconds - session.lastSeenAtMilliseconds > this.idleTimeoutMilliseconds ||
      nowMilliseconds - session.createdAtMilliseconds > this.absoluteTimeoutMilliseconds
    )
  }

  private destroyByHash(tokenHash: string): void {
    const session = this.sessionsByTokenHash.get(tokenHash)
    if (!session) return
    session.pendingTotpSecret?.fill(0)
    this.sessionsByTokenHash.delete(tokenHash)
  }
}
