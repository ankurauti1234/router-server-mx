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

    LEFT JOIN LATERAL (

      SELECT
        STRING_AGG(m.member_code, ', ' ORDER BY m.member_code)     AS member_codes,
        STRING_AGG(dt.name,       ', ' ORDER BY m.member_code)     AS device_types
      FROM member_registration mr
      JOIN members m
        ON m.id = mr.member_id
      JOIN member_devices md
        ON md.member_id = m.id
       AND md.router_id = e.router_id
      JOIN device_types dt
        ON dt.id = md.device_type_id
      WHERE mr.router_id = e.router_id
        AND mr.registered_at <= to_timestamp(e.timestamp)

      UNION ALL

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
  event_id!: string;          // UUID not integer

  @ViewColumn()
  router_id!: string;

  @ViewColumn()
  hhid!: string | null;       // nullable — LEFT JOIN households

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
  member!: string | null;      // "M1, M2, M3, M4"

  @ViewColumn()
  device_type!: string | null; // "Smartphone, Laptop, Smart TV"
}