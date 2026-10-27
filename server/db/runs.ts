import type { Database } from 'bun:sqlite'
import type { AuditRow } from '@wefaber/codemode-mcp'

/** Una fila por corrida de Code Mode (SPEC de WCM §9). Solo se inserta; se consulta por SQL o desde un tablero. */
export function insertCodemodeRun(db: Database, row: AuditRow) {
  db.query(
    `INSERT INTO codemode_runs (run_id, token_id, agent_label, kind, ops, calls, ms, result_bytes, truncated, error_code, spec_version, via, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.runId,
    row.tokenId,
    row.agentLabel,
    row.kind,
    JSON.stringify(row.ops),
    row.calls,
    row.ms,
    row.resultBytes,
    row.truncated ? 1 : 0,
    row.errorCode,
    row.specVersion,
    row.via,
    row.createdAt,
  )
}
