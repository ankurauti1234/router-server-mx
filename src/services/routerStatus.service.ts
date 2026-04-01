import { dataSource } from "../config/dataSource.js";
import { RouterEventsReport } from "../entities/routerEvent.js";

export interface RouterStatusResult {
  router_id: string;
  hhid: string | null;
  last_seen: Date;
  last_event: string | null;
  status: "Alive" | "Idle";
}

// Only these routers are tracked on the status page
const TRACKED_ROUTERS = ['RM0001', 'RM0002', 'RM0003', 'RM0004', 'RM0005', 'RM0010'];

export const getRouterStatuses = async (): Promise<RouterStatusResult[]> => {
  try {
    const rows = await dataSource
      .getRepository(RouterEventsReport)
      .createQueryBuilder("rer")
      .select("rer.router_id",  "router_id")
      .addSelect("rer.hhid",    "hhid")
      .addSelect("MAX(rer.timestamp)", "last_seen")
      .addSelect(
        `(ARRAY_AGG(rer.event ORDER BY rer.timestamp DESC))[1]`,
        "last_event"
      )
      .where("rer.router_id IN (:...routerIds)", { routerIds: TRACKED_ROUTERS })  // ← key line
      .groupBy("rer.router_id")
      .addGroupBy("rer.hhid")
      .getRawMany();

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    // Build a result map from DB rows
    const resultMap = new Map(
      rows.map(row => [row.router_id, {
        router_id:  row.router_id,
        hhid:       row.hhid,
        last_seen:  new Date(row.last_seen),
        last_event: row.last_event,
        status:     (new Date(row.last_seen) >= oneHourAgo ? "Alive" : "Idle") as "Alive" | "Idle",
      }])
    );

    // Guarantee every tracked router appears, even with zero events
    return TRACKED_ROUTERS.map(id => resultMap.get(id) ?? {
      router_id:  id,
      hhid:       null,
      last_seen:  new Date(0),       // epoch = "never seen"
      last_event: null,
      status:     "Idle" as const,
    });

  } catch (err) {
    console.error("Error fetching router statuses:", err);
    throw err;
  }
};