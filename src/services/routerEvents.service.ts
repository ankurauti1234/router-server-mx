import { dataSource } from "../config/dataSource.js";
import { RouterEventsReport } from "../entities/routerEvent.js";

export interface PaginatedResult {
  data: RouterEventsReport[];
  total: number;
  page: number;
  totalPages: number;
}

export const getRouterEvents = async (
  page: number = 1,
  limit: number = 10
): Promise<PaginatedResult> => {
  try {
    const offset = (page - 1) * limit;

    const [data, total] = await dataSource
      .getRepository(RouterEventsReport)
      .createQueryBuilder("rer")
      .orderBy("rer.timestamp", "DESC")   // most recent first, no time filter
      .skip(offset)
      .take(limit)
      .getManyAndCount();                 // single round-trip: SELECT + COUNT(*)

    const totalPages = Math.ceil(total / limit);

    console.log(`Loaded ${data.length} of ${total} router events (page ${page}/${totalPages})`);

    return { data, total, page, totalPages };
  } catch (err) {
    console.error("Error fetching router events report:", err);
    throw err;
  }
};