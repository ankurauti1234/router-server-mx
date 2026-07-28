import { Router } from "express";
import { getRouterEvents } from "../services/routerEvents.service.js";
import { streamRouterEventsReport } from "../services/routerEventsReport.service.js";
import { FilterParams } from "../services/routerEvents.service.js";
import { getRouterStatuses } from "../services/routerStatus.service.js";
import { RouterEventsReport } from "../entities/routerEvent.js";
import { dataSource } from "../config/dataSource.js";
import { getDbHost, getDbPort } from "../config/dbTunnel.js";
import { env } from "../config/env.js";
import { fileURLToPath } from "url";
import path from "path";
import pg from "pg";
import fs from "fs";
import type { Response } from "express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const caPath = path.resolve(__dirname, "../../global-bundle.pem");

const router = Router();

// ── SSE client registry ─────────────────────────────────────────────────────
const sseClients = new Set<Response>();

// ── pg LISTEN client (dedicated connection, not from the pool) ──────────────
const pgListener = new pg.Client({
  host:     getDbHost(),
  port:     getDbPort(),
  database: env.db.database,
  user:     env.db.username,
  password: env.db.password,
  ssl: {
    ca: fs.readFileSync(caPath).toString(),
    rejectUnauthorized: env.nodeEnv !== "development",
  },
});

export const startPgListener = async () => {
  try {
    await pgListener.connect();
    await pgListener.query("LISTEN new_router_event");

    pgListener.on("notification", async (msg) => {
      if (!msg.payload) return;
      console.log("[SSE] Received notify for event id:", msg.payload);

      try {
        // Query base table directly — MV won't have this event yet
        const rows = await dataSource.query(`
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
          WHERE e.id = $1
        `, [msg.payload]);

        if (!rows.length) {
          console.log("[SSE] Event filtered out (wrong type):", msg.payload);
          return;
        }

        console.log("[SSE] Pushing event to clients:", rows[0].router_id, "| connected clients:", sseClients.size);
        const payload = `data: ${JSON.stringify(rows[0])}\n\n`;

        for (const client of sseClients) {
          try { (client as any).write(payload); }
          catch { sseClients.delete(client); }
        }
      } catch (err) {
        console.error("[SSE] Failed to fetch new event:", err);
      }
    });

    pgListener.on("error", (err) => {
      console.error("[SSE] pgListener error:", err.message);
    });

    console.log("[SSE] pg LISTEN ready on new_router_event");
  } catch (err) {
    console.error("[SSE] Failed to start pgListener:", err);
  }
};

// ── GET /api/router-events/live — SSE endpoint ─────────────────────────────
router.get("/live", (req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  // Send immediate heartbeat so frontend knows connection is alive
  res.write(": heartbeat\n\n");

  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); }
    catch { clearInterval(heartbeat); }
  }, 30_000);

  sseClients.add(res);
  console.log(`[SSE] Client connected. Total: ${sseClients.size}`);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(`[SSE] Client disconnected. Total: ${sseClients.size}`);
  });
});

// ── GET /api/router-events/router-events — paginated ───────────────────────
router.get("/router-events", async (req, res) => {
  try {
    const page  = req.query.page  ? Math.max(1, Number(req.query.page))    : 1;
    const limit = req.query.limit ? Math.min(100, Number(req.query.limit)) : 10;

    const filters: FilterParams = {};
    if (req.query.routerId) filters.routerId = String(req.query.routerId);
    if (req.query.startDate) {
      const d = new Date(String(req.query.startDate));
      if (!isNaN(d.getTime())) filters.startDate = d;
    }
    if (req.query.endDate) {
      const d = new Date(String(req.query.endDate));
      if (!isNaN(d.getTime())) filters.endDate = d;
    }

    const result = await getRouterEvents(page, limit, filters);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch router events" });
  }
});

// ── GET /api/router-events/report/stream — CSV export ──────────────────────
router.get("/report/stream", async (req, res) => {
  try {
    const { startDate, endDate, routerId } = req.query;

    const filters = {
      startDate: startDate ? new Date(String(startDate)) : undefined,
      endDate:   endDate   ? new Date(String(endDate))   : undefined,
      routerId:  routerId  ? String(routerId).toUpperCase() : undefined,
    };

    if (filters.startDate && isNaN(filters.startDate.getTime())) {
      res.status(400).json({ error: "Invalid startDate" }); return;
    }
    if (filters.endDate && isNaN(filters.endDate.getTime())) {
      res.status(400).json({ error: "Invalid endDate" }); return;
    }

    console.log(`[Report] Streaming CSV – router: ${filters.routerId ?? "ALL"} | ${filters.startDate?.toISOString() ?? "any"} → ${filters.endDate?.toISOString() ?? "any"}`);
    await streamRouterEventsReport(res, filters);
  } catch (err) {
    console.error("[Report] Stream error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to generate report" });
    else res.end();
  }
});

// ── GET /api/router-events/status ──────────────────────────────────────────
router.get("/status", async (req, res) => {
  try {
    const statuses = await getRouterStatuses();
    res.json(statuses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch router statuses" });
  }
});

// ── GET /api/router-events/sessions-data ───────────────────────────────────
router.get("/sessions-data", async (req, res) => {
  try {
    const { startDate, endDate, routerId } = req.query;
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const qb = dataSource
      .getRepository(RouterEventsReport)
      .createQueryBuilder("rer")
      .select([
        "rer.router_id", "rer.hhid", "rer.timestamp", "rer.event",
        "rer.hostname",  "rer.platform", "rer.category", "rer.duration_sec",
        "rer.member",    "rer.device_type", "rer.type_id",
      ])
      .orderBy("rer.timestamp", "ASC");

    if (startDate) {
      const requested = new Date(String(startDate));
      qb.andWhere("rer.timestamp >= :startDate", {
        startDate: requested > fortyEightHoursAgo ? requested : fortyEightHoursAgo,
      });
    } else {
      qb.andWhere("rer.timestamp >= :startDate", { startDate: fortyEightHoursAgo });
    }

    if (endDate)  qb.andWhere("rer.timestamp <= :endDate",  { endDate:  new Date(String(endDate)) });
    if (routerId) qb.andWhere("rer.router_id = :routerId",  { routerId: String(routerId).toUpperCase() });

    qb.take(5000);
    const data = await qb.getMany();
    console.log(`[Sessions] Returning ${data.length} events | window: ${startDate ?? "48h ago"} → ${endDate ?? "now"}`);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch session data" });
  }
});

export default router;