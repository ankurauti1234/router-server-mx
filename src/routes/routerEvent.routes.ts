import { Router } from "express";
import { getRouterEvents } from "../services/routerEvents.service.js";
import { streamRouterEventsReport } from "../services/routerEventsReport.service.js";
import { FilterParams } from "../services/routerEvents.service.js";

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

export default router;