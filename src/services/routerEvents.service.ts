import { dataSource } from "../config/dataSource.js";
import { RouterEventsReport } from "../entities/routerEvent.js";

export interface FilterParams {
  startDate?: Date;
  endDate?: Date;
  routerId?: string;
}

export interface PaginatedResult {
  data: RouterEventsReport[];
  total: number;
  page: number;
  totalPages: number;
}

export const getRouterEvents = async (
  page: number = 1,
  limit: number = 10,
  filters: FilterParams = {}
): Promise<PaginatedResult> => {
  try {
    const offset = (page - 1) * limit;

    // Build filter conditions
    const conditions: string[] = ["et.code IN (0, 1, 10)"];
    const params: any[] = [];
    let paramIdx = 1;

    if (filters.routerId) {
      conditions.push(`r.router_serial = $${paramIdx++}`);
      params.push(filters.routerId.toUpperCase());
    }
    if (filters.startDate) {
      conditions.push(`to_timestamp(e.timestamp) >= $${paramIdx++}`);
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push(`to_timestamp(e.timestamp) <= $${paramIdx++}`);
      params.push(filters.endDate);
    }

    const whereClause = `WHERE ${conditions.join(" AND ")}`;

    // Query base tables directly — always fresh, no 5 min delay
    const dataRows = await dataSource.query(`
      SELECT
        e.id                                                          AS event_id,
        r.router_serial                                               AS router_id,
        h.hh_id                                                       AS hhid,
        to_timestamp(e.timestamp)                                     AS timestamp,
        e.event_type_id                                               AS type_id,
        CASE et.code
          WHEN 0  THEN 'disconnected'
          WHEN 1  THEN 'connected'
          WHEN 10 THEN 'connected'
        END                                                           AS event,
        e.details -> 'device_details' ->> 'hostname'                 AS hostname,
        e.details -> 'domain_activity' ->> 'platform'                AS platform,
        e.details -> 'domain_activity' ->> 'category'                AS category,
        CASE WHEN et.code = 0
          THEN (e.details -> 'device_details' ->> 'connected_duration_sec')::integer
          ELSE NULL
        END                                                           AS duration_sec,
        reg.member_codes                                              AS member,
        reg.device_types                                              AS device_type
      FROM router_events e
      JOIN event_types et ON et.id = e.event_type_id AND et.code IN (0, 1, 10)
      JOIN routers r ON r.id = e.router_id
      LEFT JOIN households h ON h.id = r.household_id
      LEFT JOIN LATERAL (
        SELECT m.member_code AS member_codes, dt.name AS device_types
        FROM member_devices md
        JOIN members m ON m.id = md.member_id
        JOIN device_types dt ON dt.id = md.device_type_id
        WHERE md.router_id = e.router_id
          AND md.mac = NULLIF(e.details -> 'device_details' ->> 'mac', '')::macaddr
        UNION ALL
        SELECT hd.shared_members AS member_codes, dt.name AS device_types
        FROM household_devices hd
        JOIN device_types dt ON dt.id = hd.device_type_id
        WHERE hd.router_id = e.router_id
          AND hd.mac = NULLIF(e.details -> 'device_details' ->> 'mac', '')::macaddr
        LIMIT 1
      ) reg ON true
      ${whereClause}
      ORDER BY e.timestamp DESC
      LIMIT ${limit} OFFSET ${offset}
    `, params);

    // Count query — use MV for speed (count is always close enough)
    const countRow = await dataSource.query(`
      SELECT COUNT(*) AS total FROM router_events_report
      ${filters.routerId || filters.startDate || filters.endDate ? `WHERE ${[
        filters.routerId  ? `router_id = '${filters.routerId.toUpperCase()}'` : null,
        filters.startDate ? `timestamp >= '${filters.startDate.toISOString()}'` : null,
        filters.endDate   ? `timestamp <= '${filters.endDate.toISOString()}'`   : null,
      ].filter(Boolean).join(" AND ")}` : ""}
    `);

    const total = parseInt(countRow[0].total, 10);
    const totalPages = Math.ceil(total / limit);

    console.log(`Loaded ${dataRows.length} of ${total} router events (page ${page}/${totalPages})`, filters);

    return { data: dataRows, total, page, totalPages };
  } catch (err) {
    console.error("Error fetching router events report:", err);
    throw err;
  }
};