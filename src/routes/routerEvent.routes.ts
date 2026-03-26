import { Router } from 'express';
import { getRouterEvents } from '../services/routerEvents.service.js';

const router = Router();

router.get('/router-events', async (req, res) => {
  try {
    const hours = req.query.hours ? Number(req.query.hours) : 12;  // ← read from query param
    const events = await getRouterEvents(hours);
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch router events' });
  }
});

export default router;