import { Router } from "express";
import { getRouterEvents } from "../services/routerEvents.service.js";
import { streamRouterEventsReport } from "../services/routerEventsReport.service.js";
import { FilterParams } from "../services/routerEvents.service.js";
import { getRouterStatuses } from "../services/routerStatus.service.js";
import { RouterEventsReport } from "../entities/routerEvent.js";
import { dataSource } from "../config/dataSource.js";


const router = Router();

// ── Existing paginated endpoint (unchanged) ─────────────────────────────────
router.get("/router-events", async (req, res) => {
  try {
    const page  = req.query.page  ? Math.max(1, Number(req.query.page))    : 1;
    const limit = req.query.limit ? Math.min(100, Number(req.query.limit)) : 10;

    // ── Parse filters ─────────────────────────────────────────
    const filters: FilterParams = {};

    if (req.query.routerId) {
      filters.routerId = String(req.query.routerId);
    }
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

// ── NEW: streaming CSV report endpoint ─────────────────────────────────────
//   GET /api/router-events/report/stream
//   Query params:
//     startDate  – ISO 8601 string, e.g. 2026-03-01T00:00:00.000Z (optional)
//     endDate    – ISO 8601 string (optional)
//     routerId   – router serial, e.g. RM0001 (optional)
router.get("/report/stream", async (req, res) => {
  try {
    const { startDate, endDate, routerId } = req.query;

    const filters = {
      startDate : startDate  ? new Date(String(startDate))  : undefined,
      endDate   : endDate    ? new Date(String(endDate))    : undefined,
      routerId  : routerId   ? String(routerId).toUpperCase() : undefined,
    };

    // Basic date validation
    if (filters.startDate && isNaN(filters.startDate.getTime())) {
      res.status(400).json({ error: "Invalid startDate" });
      return;
    }
    if (filters.endDate && isNaN(filters.endDate.getTime())) {
      res.status(400).json({ error: "Invalid endDate" });
      return;
    }

    console.log(
      `[Report] Streaming CSV – router: ${filters.routerId ?? "ALL"} | ` +
      `${filters.startDate?.toISOString() ?? "any"} → ${filters.endDate?.toISOString() ?? "any"}`
    );

    await streamRouterEventsReport(res, filters);
  } catch (err) {
    console.error("[Report] Stream error:", err);
    // If headers not yet sent, return JSON error; otherwise just close stream.
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate report" });
    } else {
      res.end();
    }
  }
});

// GET /api/router-events/status
router.get("/status", async (req, res) => {
  try {
    const statuses = await getRouterStatuses();
    res.json(statuses);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch router statuses" });
  }
});

// GET /api/router-events/sessions-data
router.get("/sessions-data", async (req, res) => {
  try {
    const { startDate, endDate, routerId } = req.query;

    // Hard ceiling — never go back more than 48 hours
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const qb = dataSource
      .getRepository(RouterEventsReport)
      .createQueryBuilder("rer")
      .select([
        "rer.event_id",
        "rer.router_id",
        "rer.hhid",
        "rer.timestamp",
        "rer.event",
        "rer.hostname",
        "rer.platform",
        "rer.category",
        "rer.duration_sec",
        "rer.member",
        "rer.device_type",
        "rer.type_id",
      ])
      .orderBy("rer.timestamp", "ASC");

    // Start date: use whatever the frontend sends, but never older than 48h
    if (startDate) {
      const requested = new Date(String(startDate));
      // Pick whichever is MORE recent — requested or 48h ceiling
      qb.andWhere("rer.timestamp >= :startDate", {
        startDate: requested > fortyEightHoursAgo ? requested : fortyEightHoursAgo,
      });
    } else {
      // No date sent → default to 48h window
      qb.andWhere("rer.timestamp >= :startDate", {
        startDate: fortyEightHoursAgo,
      });
    }

    if (endDate) {
      qb.andWhere("rer.timestamp <= :endDate", {
        endDate: new Date(String(endDate)),
      });
    }

    if (routerId) {
      qb.andWhere("rer.router_id = :routerId", {
        routerId: String(routerId).toUpperCase(),
      });
    }

    // Safety cap — even within 48h, don't return more than 5000 rows
    qb.take(5000);

    const data = await qb.getMany();

    console.log(
      `[Sessions] Returning ${data.length} events | ` +
      `window: ${startDate ?? "48h ago"} → ${endDate ?? "now"}`
    );

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch session data" });
  }
});

export default router;