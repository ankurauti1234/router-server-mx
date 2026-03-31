import { dataSource } from "../config/dataSource.js";
import { RouterEventsReport } from "../entities/routerEvent.js";

export interface FilterParams {
  startDate?: Date;
  endDate?: Date;
  routerId?: string;
}

export interface PaginatedResult {
  data: RouterEventsReport[];
  total: number;
  page: number;
  totalPages: number;
}

export const getRouterEvents = async (
  page: number = 1,
  limit: number = 10,
  filters: FilterParams = {}
): Promise<PaginatedResult> => {
  try {
    const offset = (page - 1) * limit;

    const qb = dataSource
      .getRepository(RouterEventsReport)
      .createQueryBuilder("rer")
      .orderBy("rer.timestamp", "DESC");

    // ── Filters ──────────────────────────────────────────────
    if (filters.routerId) {
      qb.andWhere("rer.router_id = :routerId", { routerId: filters.routerId.toUpperCase() });
    }
    if (filters.startDate) {
      qb.andWhere("rer.timestamp >= :startDate", { startDate: filters.startDate });
    }
    if (filters.endDate) {
      qb.andWhere("rer.timestamp <= :endDate", { endDate: filters.endDate });
    }

    const [data, total] = await qb
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    const totalPages = Math.ceil(total / limit);

    console.log(
      `Loaded ${data.length} of ${total} router events (page ${page}/${totalPages})`,
      filters
    );

    return { data, total, page, totalPages };
  } catch (err) {
    console.error("Error fetching router events report:", err);
    throw err;
  }
};