import type { Database } from './database'

type Row = Record<string, unknown>

export interface AuditEntry {
  at: string
  event: string
  ipAddress: string
  userAgent: string
}

function toEntry(row: Row): AuditEntry {
  return {
    at: String(row.at),
    event: String(row.event),
    ipAddress: String(row.ip_address),
    userAgent: String(row.user_agent),
  }
}

/** Who did what, when. The only metadata boltbook keeps beyond the records themselves. */
export class AuditLog {
  constructor(private readonly database: Database) {}

  record(event: string, ipAddress: string, userAgent: string, atIso: string): void {
    this.database
      .prepare('INSERT INTO audit_log (at, event, ip_address, user_agent) VALUES (?, ?, ?, ?)')
      .run(atIso, event, ipAddress, userAgent)
  }

  listRecent(limit = 100): AuditEntry[] {
    const rows = this.database
      .prepare('SELECT at, event, ip_address, user_agent FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(limit) as Row[]
    return rows.map(toEntry)
  }
}
