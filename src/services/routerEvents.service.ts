import { dataSource } from "../config/dataSource.js";

export interface FilterParams {
  startDate?: Date;
  endDate?: Date;
  routerId?: string;
}

export interface PaginatedResult {
  data: any[];
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

    // Build WHERE clauses dynamically
    const conditions: string[] = [
      "et.code IN (0, 1, 10)"
    ];
    const params: any[] = [];
    let paramIdx = 1;

    if (filters.routerId) {
      conditions.push(`r.router_serial = $${paramIdx++}`);
      params.push(filters.routerId.toUpperCase());
    }
    if (filters.startDate) {
      conditions.push(`e.timestamp >= extract(epoch from $${paramIdx++}::timestamptz)`);
      params.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push(`e.timestamp <= extract(epoch from $${paramIdx++}::timestamptz)`);
      params.push(filters.endDate);
    }

    const whereClause = conditions.length > 0
      ? "WHERE " + conditions.join(" AND ")
      : "";

    // Single optimised query: data + total in one round-trip using a window function
    const sql = `
      SELECT
        e.id                                                            AS event_id,
        r.router_serial                                                 AS router_id,
        h.hh_id                                                         AS hhid,
        to_timestamp(e.timestamp)                                       AS timestamp,
        e.event_type_id                                                 AS type_id,
        CASE et.code
          WHEN 0  THEN 'disconnected'
          WHEN 1  THEN 'connected'
          WHEN 10 THEN 'connected'
        END                                                             AS event,
        e.details -> 'device_details' ->> 'hostname'                   AS hostname,
        e.details -> 'domain_activity' ->> 'platform'                  AS platform,
        e.details -> 'domain_activity' ->> 'category'                  AS category,
        CASE WHEN et.code = 0
          THEN (e.details -> 'device_details' ->> 'connected_duration_sec')::integer
          ELSE NULL
        END                                                             AS duration_sec,
        reg.member_codes                                                AS member,
        reg.device_types                                                AS device_type,
        COUNT(*) OVER ()                                                AS total_count
      FROM router_events e
      JOIN event_types et  ON et.id = e.event_type_id
      JOIN routers r       ON r.id  = e.router_id
      LEFT JOIN households h ON h.id = r.household_id
      LEFT JOIN LATERAL (
        SELECT m.member_code AS member_codes, dt.name AS device_types
        FROM member_devices md
        JOIN members m      ON m.id  = md.member_id
        JOIN device_types dt ON dt.id = md.device_type_id
        WHERE md.router_id = e.router_id
          AND md.mac = NULLIF(e.details -> 'device_details' ->> 'mac', '')::macaddr
        UNION ALL
        SELECT hd.shared_members AS member_codes, dt.name AS device_types
        FROM household_devices hd
        JOIN device_types dt ON dt.id = hd.device_type_id
        WHERE hd.router_id = e.router_id
          AND hd.mac = NULLIF(e.details -> 'device_details' ->> 'mac', '')::macaddr
      ) reg ON true
      ${whereClause}
      ORDER BY e.timestamp DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;

    params.push(limit, offset);

    const rows: any[] = await dataSource.query(sql, params);

    const total = rows.length > 0 ? parseInt(rows[0].total_count, 10) : 0;
    const totalPages = Math.ceil(total / limit);

    // Strip the window-function column before returning
    const data = rows.map(({ total_count, ...rest }) => rest);

    console.log(
      `Loaded ${data.length} of ${total} router events (page ${page}/${totalPages})`,
      filters
    );

    return { data, total, page, totalPages };
  } catch (err) {
    console.error("Error fetching router events:", err);
    throw err;
  }
};