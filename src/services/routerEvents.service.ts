import { dataSource } from "../config/dataSource.js";
import { RouterEventsReport } from "../entities/routerEvent.js"; // adjust path

export const getRouterEvents = async () => {
  try {
    const events = await dataSource
      .getRepository(RouterEventsReport)
      .createQueryBuilder("rer")
      .orderBy("rer.timestamp", "DESC")
      .getMany();

    console.log(`Loaded ${events.length} router connect events`);

    return events;
  } catch (err) {
    console.error("Error fetching router events report:", err);
    throw err;
  }
};