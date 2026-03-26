import { dataSource } from "../config/dataSource.js";
import { RouterEventsReport } from "../entities/routerEvent.js";

export const getRouterEvents = async (hours: number = 12) => {  // ← default 12hrs
  try {
    const events = await dataSource
      .getRepository(RouterEventsReport)
      .createQueryBuilder("rer")
      .where("rer.timestamp >= NOW() - INTERVAL '1 hour' * :hours", { hours })  // ← dynamic
      .orderBy("rer.timestamp", "DESC")
      .getMany();

    console.log(`Loaded ${events.length} router connect events`);
    return events;
  } catch (err) {
    console.error("Error fetching router events report:", err);
    throw err;
  }
};