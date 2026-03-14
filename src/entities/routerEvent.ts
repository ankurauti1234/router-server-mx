import { ViewEntity, ViewColumn } from "typeorm";

@ViewEntity({
  name: "router_events_report",
  materialized: false,   // ← consider true + periodic refresh later
  expression: `
    SELECT
      e10.id                                                     AS event_id,
      r.router_serial                                            AS router_id,
      h.hh_id                                                    AS hhid,
      to_timestamp(e10.timestamp)                                AS timestamp,
      e10.event_type_id                                          AS type_id,

      -- From type 10
      COALESCE(
        e0.details -> 'device_details' ->> 'event',
        e10.details -> 'device_details' ->> 'event'
      )                AS event,
      
      e10.details -> 'device_details' ->> 'hostname'             AS hostname,
      e10.details -> 'domain_activity' ->> 'platform'            AS platform,
      e10.details -> 'domain_activity' ->> 'category'            AS category,

      -- From matched type 0 (later disconnect)
      (e0.details -> 'device_details' ->> 'connected_duration_sec')::integer  AS duration_sec,

      -- From type 30 + matched index
      e30.details -> 'member_details' -> matched_member.idx ->> 'member_code'   AS member,
      e30.details -> 'member_details' -> matched_member.idx ->> 'device_type'   AS device_type

    FROM router_events e10

    JOIN routers r 
      ON r.id = e10.router_id

    JOIN households h 
      ON h.id = r.household_id

    LEFT JOIN router_events e0
      ON  e0.router_id = e10.router_id
      AND e0.details -> 'device_details' ->> 'mac' = e10.details -> 'device_details' ->> 'mac'
      AND e0.event_type_id = (SELECT id FROM event_types WHERE code = 0)
      AND e0.timestamp > e10.timestamp

    LEFT JOIN router_events e30
      ON  e30.router_id = e10.router_id
      AND e30.event_type_id = (SELECT id FROM event_types WHERE code = 30)

    LEFT JOIN LATERAL (
      SELECT idx
      FROM generate_series(
        0,
        jsonb_array_length(e30.details -> 'member_details') - 1
      ) AS idx
      WHERE e30.details -> 'member_details' -> idx ->> 'mac'
          = e10.details -> 'device_details' ->> 'mac'
      LIMIT 1
    ) matched_member ON true

    WHERE e10.event_type_id = (SELECT id FROM event_types WHERE code = 10)

    ORDER BY e10.timestamp DESC
  `
})
export class RouterEventsReport {
  @ViewColumn()
  event_id!: number;

  @ViewColumn()
  router_id!: string;

  @ViewColumn()
  hhid!: string;              // now non-nullable due to INNER JOIN

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