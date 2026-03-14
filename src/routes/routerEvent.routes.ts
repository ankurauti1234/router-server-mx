import { Router } from 'express';
import { getRouterEvents } from '../services/routerEvents.service.js';

const router = Router();

router.get('/router-events', async (req, res) => {   // ← I suggest plural name
  try {
    const events = await getRouterEvents();
    res.json(events);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch router events' });
  }
});

export default router;