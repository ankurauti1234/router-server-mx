import { ViewEntity, ViewColumn } from "typeorm";

@ViewEntity({
  name: "router_events_report",
  materialized: false,
  expression: `
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

    JOIN event_types et
      ON et.id = e.event_type_id
     AND et.code IN (0, 1, 10)

    JOIN routers r
      ON r.id = e.router_id

    LEFT JOIN households h
      ON h.id = r.household_id

    -- MAC-based lookup: returns exactly what was registered for that device
    LEFT JOIN LATERAL (

      -- Personal device: single member (M1, M2 etc.)
      SELECT
        m.member_code                                               AS member_codes,
        dt.name                                                     AS device_types
      FROM member_devices md
      JOIN members m
        ON m.id = md.member_id
      JOIN device_types dt
        ON dt.id = md.device_type_id
      WHERE md.router_id = e.router_id
        AND md.mac = NULLIF(
              e.details -> 'device_details' ->> 'mac', ''
            )::macaddr

      UNION ALL

      -- Shared device: multiple members (M1,M2,M3,M4 stored as-is)
      SELECT
        hd.shared_members                                           AS member_codes,
        dt.name                                                     AS device_types
      FROM household_devices hd
      JOIN device_types dt
        ON dt.id = hd.device_type_id
      WHERE hd.router_id = e.router_id
        AND hd.mac = NULLIF(
              e.details -> 'device_details' ->> 'mac', ''
            )::macaddr

    ) reg ON true

    ORDER BY e.timestamp DESC
  `
})
export class RouterEventsReport {
  @ViewColumn()
  event_id!: string;

  @ViewColumn()
  router_id!: string;

  @ViewColumn()
  hhid!: string | null;

  @ViewColumn()
  timestamp!: Date;

  @ViewColumn()
  type_id!: number;

  @ViewColumn()
  event!: string | null;

  @ViewColumn()
  hostname!: string | null;

  @ViewColumn()
  platform!: string | null;

  @ViewColumn()
  category!: string | null;

  @ViewColumn()
  duration_sec!: number | null;

  @ViewColumn()
  member!: string | null;

  @ViewColumn()
  device_type!: string | null;
}