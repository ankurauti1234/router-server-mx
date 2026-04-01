import { dataSource } from "../config/dataSource.js";
import type { Response } from "express";

export interface ReportFilters {
  startDate?: Date;
  endDate?: Date;
  routerId?: string; // e.g. "RM0001"
}

/**
 * Streams the router-events report as CSV directly into the Express Response.
 *
 * Strategy for 100 000+ rows:
 *   • Raw SQL query (no ORM overhead) with server-side cursor via pg streaming.
 *   • We chunk the SELECT into pages of BATCH_SIZE rows and write each chunk
 *     immediately, so memory stays flat and the browser starts downloading at once.
 *   • Content-Type is set to text/csv so the browser triggers "Save As" automatically
 *     when the frontend creates a download link from the streamed blob.
 */
const BATCH_SIZE = 5_000; // rows per DB round-trip

export const streamRouterEventsReport = async (
  res: Response,
  filters: ReportFilters
): Promise<void> => {
  const db = dataSource;

  // ── Build WHERE clauses ──────────────────────────────────────────────────
  const conditions: string[] = ["et.code IN (0, 1, 10, 30)"];
  const params: (string | Date)[] = [];
  let paramIdx = 1;

  if (filters.startDate) {
    conditions.push(`to_timestamp(e.timestamp) >= $${paramIdx++}`);
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    conditions.push(`to_timestamp(e.timestamp) <= $${paramIdx++}`);
    params.push(filters.endDate);
  }
  if (filters.routerId) {
    conditions.push(`r.router_serial = $${paramIdx++}`);
    params.push(filters.routerId);
  }

  const whereClause = conditions.length
    ? "WHERE " + conditions.join(" AND ")
    : "";

  // ── CSV header ───────────────────────────────────────────────────────────
  const CSV_HEADER =
    "event_id,router_id,hhid,timestamp,type,hostname,platform,category," +
    "domain,ip,mac,service_category,duration_sec,member,device_type," +
    "date,time\n";

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="report_${Date.now()}.csv"`
  );
  // Transfer-Encoding: chunked is set automatically by Node/Express when we
  // don't know Content-Length upfront.

  res.write(CSV_HEADER);

  // ── Paginate through results ─────────────────────────────────────────────
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const sql = `
      SELECT
        e.id                                                          AS event_id,
        r.router_serial                                               AS router_id,
        h.hh_id                                                       AS hhid,

        -- ✅ UTC timestamp
        to_timestamp(e.timestamp)                                     AS timestamp_utc,

        et.code                                                       AS type,

        e.details -> 'device_details' ->> 'hostname'                  AS hostname,
        e.details -> 'domain_activity' ->> 'platform'                 AS platform,
        e.details -> 'domain_activity' ->> 'category'                 AS category,
        e.details -> 'domain_activity' ->> 'domain'                   AS domain,

        CASE WHEN et.code = 10
          THEN e.details -> 'device_details' ->> 'ip'
        END                                                           AS ip,

        CASE WHEN et.code = 10
          THEN (e.details -> 'device_details' ->> 'mac')::macaddr
        END                                                           AS mac,

        CASE WHEN et.code = 10
          THEN e.details -> 'domain_activity' ->> 'service_category'
        END                                                           AS service_category,

        CASE WHEN et.code = 0
          THEN (e.details -> 'device_details' ->> 'connected_duration_sec')::integer
        END                                                           AS duration_sec,

        reg.member_codes                                              AS member,
        reg.device_types                                              AS device_type,

        -- ✅ Mexico time
        (to_timestamp(e.timestamp) AT TIME ZONE 'America/Mexico_City')::timestamp
                                                                      AS timestamp_converted,

        TO_CHAR(
          to_timestamp(e.timestamp) AT TIME ZONE 'America/Mexico_City',
          'DD-MM-YYYY'
        )                                                             AS date,

        TO_CHAR(
          to_timestamp(e.timestamp) AT TIME ZONE 'America/Mexico_City',
          'HH24:MI:SS'
        )                                                             AS time

      FROM router_events e

      JOIN event_types et
        ON et.id = e.event_type_id
      AND et.code IN (0, 1, 10, 30)

      JOIN routers r
        ON r.id = e.router_id

      LEFT JOIN households h
        ON h.id = r.household_id

      LEFT JOIN LATERAL (
        SELECT
          m.member_code AS member_codes,
          dt.name       AS device_types
        FROM member_devices md
        JOIN members m       ON m.id = md.member_id
        JOIN device_types dt ON dt.id = md.device_type_id
        WHERE md.router_id = e.router_id
          AND md.mac = NULLIF(e.details -> 'device_details' ->> 'mac', '')::macaddr

        UNION ALL

        SELECT
          hd.shared_members AS member_codes,
          dt.name           AS device_types
        FROM household_devices hd
        JOIN device_types dt ON dt.id = hd.device_type_id
        WHERE hd.router_id = e.router_id
          AND hd.mac = NULLIF(e.details -> 'device_details' ->> 'mac', '')::macaddr
      ) reg ON true

      ${whereClause}

      ORDER BY e.timestamp
      LIMIT ${BATCH_SIZE} OFFSET ${offset}
    `;

    const rows: Record<string, any>[] = await db.query(sql, params);

    if (rows.length === 0) {
      hasMore = false;
      break;
    }

    // Convert rows → CSV lines
    const csvChunk = rows
      .map((row) =>
        [
          row.event_id           ?? "",
          row.router_id          ?? "",
          row.hhid               ?? "",
          row.timestamp          ? new Date(row.timestamp).toISOString() : "",
          row.type               ?? "",
          csvEscape(row.hostname),
          csvEscape(row.platform),
          csvEscape(row.category),
          csvEscape(row.domain),
          row.ip                 ?? "",
          row.mac                ?? "",
          csvEscape(row.service_category),
          row.duration_sec       ?? "",
          csvEscape(row.member),
          csvEscape(row.device_type),
          row.date               ?? "",
          row.time               ?? "",
        ].join(",")
      )
      .join("\n") + "\n";

    res.write(csvChunk);

    if (rows.length < BATCH_SIZE) {
      hasMore = false; // last page was partial → done
    } else {
      offset += BATCH_SIZE;
    }
  }

  res.end();
};

/** Wrap a value in quotes if it contains commas, quotes, or newlines. */
function csvEscape(value: any): string {
  if (value == null) return "";
  const str = String(value);
  if (/[,"\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}