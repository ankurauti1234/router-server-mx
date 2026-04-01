import { dataSource } from "../config/dataSource.js";
import type { Response } from "express";

export interface ReportFilters {
  startDate?: Date;
  endDate?: Date;
  routerId?: string;
}

const BATCH_SIZE = 5_000;

export const streamRouterEventsReport = async (
  res: Response,
  filters: ReportFilters
): Promise<void> => {
  const db = dataSource;

  // ── WHERE clauses ────────────────────────────────────────────────────────
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

  // ── CSV header — must match SELECT aliases below exactly ─────────────────
  const CSV_HEADER =
    "event_id,router_id,hhid,timestamp,type,event," +
    "hostname,platform,category,domain,ip,mac," +
    "service_category,duration_sec,member,device_type," +
    "user_device_id,timestamp_converted,date,time\n";

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="report_${Date.now()}.csv"`
  );
  res.write(CSV_HEADER);

  // ── Paginate ─────────────────────────────────────────────────────────────
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const sql = `
      SELECT
        e.id                                                            AS event_id,
        r.router_serial                                                 AS router_id,
        h.hh_id                                                         AS hhid,

        -- UTC timestamp formatted for CSV
        to_char(
          to_timestamp(e.timestamp) AT TIME ZONE 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS"Z"'
        )                                                               AS timestamp,

        et.code                                                         AS type,

        et.name                                                         AS event,

        e.details -> 'device_details'  ->> 'hostname'                  AS hostname,
        e.details -> 'domain_activity' ->> 'platform'                  AS platform,
        e.details -> 'domain_activity' ->> 'category'                  AS category,
        e.details -> 'domain_activity' ->> 'domain'                    AS domain,

        CASE WHEN et.code = 10
          THEN e.details -> 'device_details' ->> 'ip'
        END                                                             AS ip,

        CASE WHEN et.code = 10
          THEN (e.details -> 'device_details' ->> 'mac')
        END                                                             AS mac,

        CASE WHEN et.code = 10
          THEN e.details -> 'domain_activity' ->> 'service_category'
        END                                                             AS service_category,

        CASE WHEN et.code = 0
          THEN (e.details -> 'device_details' ->> 'connected_duration_sec')::integer
        END                                                             AS duration_sec,

        reg.member_codes                                                AS member,
        reg.device_types                                                AS device_type,
        reg.user_device_id                                              AS user_device_id,

        -- Mexico City local timestamp formatted for CSV
        TO_CHAR(
          to_timestamp(e.timestamp) AT TIME ZONE 'America/Mexico_City',
          'DD-MM-YYYY HH24:MI:SS'
        )                                                               AS timestamp_converted,

        TO_CHAR(
          to_timestamp(e.timestamp) AT TIME ZONE 'America/Mexico_City',
          'DD-MM-YYYY'
        )                                                               AS date,

        TO_CHAR(
          to_timestamp(e.timestamp) AT TIME ZONE 'America/Mexico_City',
          'HH24:MI:SS'
        )                                                               AS time

      FROM router_events e

      JOIN event_types et
        ON et.id = e.event_type_id
       AND et.code IN (0, 1, 10, 30)

      JOIN routers r
        ON r.id = e.router_id

      LEFT JOIN households h
        ON h.id = r.household_id

      LEFT JOIN LATERAL (
        -- Personal device
        SELECT
          m.member_code AS member_codes,
          dt.name       AS device_types,
          md.id         AS user_device_id
        FROM member_devices md
        JOIN members      m  ON m.id  = md.member_id
        JOIN device_types dt ON dt.id = md.device_type_id
        WHERE md.router_id = e.router_id
          AND md.mac = NULLIF(e.details -> 'device_details' ->> 'mac', '')::macaddr

        UNION ALL

        -- Shared device
        SELECT
          hd.shared_members AS member_codes,
          dt.name           AS device_types,
          hd.id             AS user_device_id
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

    // ── Map rows → CSV lines ──────────────────────────────────────────────
    const csvChunk =
      rows
        .map((row) =>
          [
            row.event_id              ?? "",
            row.router_id             ?? "",
            row.hhid                  ?? "",
            row.timestamp             ?? "",
            row.type                  ?? "",
            csvEscape(row.event),
            csvEscape(row.hostname),
            csvEscape(row.platform),
            csvEscape(row.category),
            csvEscape(row.domain),
            row.ip                    ?? "",
            row.mac                   ?? "",
            csvEscape(row.service_category),
            row.duration_sec          ?? "",
            csvEscape(row.member),
            csvEscape(row.device_type),
            row.user_device_id        ?? "",
            row.timestamp_converted   ?? "",
            row.date                  ?? "",
            row.time                  ?? "",
          ].join(",")
        )
        .join("\n") + "\n";

    res.write(csvChunk);

    if (rows.length < BATCH_SIZE) {
      hasMore = false;
    } else {
      offset += BATCH_SIZE;
    }
  }

  res.end();
};

function csvEscape(value: any): string {
  if (value == null) return "";
  const str = String(value);
  if (/[,"\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}