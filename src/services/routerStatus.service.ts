import { dataSource } from "../config/dataSource.js";
import { RouterEventsReport } from "../entities/routerEvent.js";

export interface RouterStatusResult {
  router_id:  string;
  hhid:       string | null;
  last_seen:  Date;
  last_event: string | null;
  status:     "Alive" | "Idle";
}

const TRACKED_ROUTERS = ['RM0001', 'RM0002', 'RM0003', 'RM0004', 'RM0005', 'RM0010'];

export const getRouterStatuses = async (): Promise<RouterStatusResult[]> => {
  try {
    const oneHourAgo  = new Date(Date.now() - 1  * 60 * 60 * 1000);
    const twoHoursAgo = new Date(Date.now() - 2  * 60 * 60 * 1000);

    // ── Step 1: fast query — only last 2 hours ──────────────────────────────
    // If a router sent an event in the last 2hrs it will appear here.
    // Scanning 2hrs of indexed rows instead of the entire table.
    const recentRows = await dataSource
      .getRepository(RouterEventsReport)
      .createQueryBuilder("rer")
      .select("rer.router_id",         "router_id")
      .addSelect("rer.hhid",           "hhid")
      .addSelect("MAX(rer.timestamp)", "last_seen")
      .addSelect(
        `(ARRAY_AGG(rer.event ORDER BY rer.timestamp DESC))[1]`,
        "last_event"
      )
      .where("rer.router_id IN (:...routerIds)", { routerIds: TRACKED_ROUTERS })
      .andWhere("rer.timestamp >= :since", { since: twoHoursAgo })  // ← the key addition
      .groupBy("rer.router_id")
      .addGroupBy("rer.hhid")
      .getRawMany();

    const resultMap = new Map<string, RouterStatusResult>();

    for (const row of recentRows) {
      const lastSeen = new Date(row.last_seen);
      resultMap.set(row.router_id, {
        router_id:  row.router_id,
        hhid:       row.hhid ?? null,
        last_seen:  lastSeen,
        last_event: row.last_event ?? null,
        status:     lastSeen >= oneHourAgo ? "Alive" : "Idle",
      });
    }

    // ── Step 2: for routers with NO recent events, get their last-ever event ─
    // Only runs for routers that were completely silent for 2+ hours.
    // Uses DISTINCT ON — far cheaper than GROUP BY on a full scan.
    const missingIds = TRACKED_ROUTERS.filter(id => !resultMap.has(id));

    if (missingIds.length > 0) {
      const fallback: Array<{
        router_id:  string;
        hhid:       string | null;
        last_seen:  string;
        last_event: string | null;
      }> = await dataSource.query(`
        SELECT DISTINCT ON (router_id)
          router_id,
          hhid,
          timestamp  AS last_seen,
          event      AS last_event
        FROM router_events_report
        WHERE router_id = ANY($1)
        ORDER BY router_id, timestamp DESC
      `, [missingIds]);

      for (const row of fallback) {
        resultMap.set(row.router_id, {
          router_id:  row.router_id,
          hhid:       row.hhid       ?? null,
          last_seen:  new Date(row.last_seen),
          last_event: row.last_event ?? null,
          status:     "Idle",   // no events in 2hrs → always Idle
        });
      }
    }

    // ── Step 3: guarantee all 6 routers appear even with zero events ever ───
    return TRACKED_ROUTERS.map(id => resultMap.get(id) ?? {
      router_id:  id,
      hhid:       null,
      last_seen:  new Date(0),
      last_event: null,
      status:     "Idle" as const,
    });

  } catch (err) {
    console.error("Error fetching router statuses:", err);
    throw err;
  }
};