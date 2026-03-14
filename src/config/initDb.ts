import { createDbTunnel } from "./dbTunnel.js";
import { dataSource } from "./dataSource.js";

export async function initDb() {
  await createDbTunnel();
  await dataSource.initialize();
  console.log("Database initialized successfully");
}