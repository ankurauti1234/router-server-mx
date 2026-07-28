// src/config/dataSource.ts
import "reflect-metadata";
import { DataSource } from "typeorm";
import fs from "fs";
import { env } from "./env.js";
import { getDbHost, getDbPort, createDbTunnel } from "./dbTunnel.js";
import { fileURLToPath } from "url";
import path from "path";
import { User } from "../entities/user.entities.js";
import { RouterEventsReport } from "../entities/routerEvent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const caPath = path.resolve(__dirname, "../../global-bundle.pem");

const isDev = env.nodeEnv === "development";

export const dataSource = new DataSource({
  type: "postgres",
  host: getDbHost(),
  port: getDbPort(),
  username: env.db.username,
  password: env.db.password,
  database: env.db.database,
  entities: [User, RouterEventsReport],
  synchronize: false,
  logging: env.nodeEnv !== "production",
  ssl: {
    ca: fs.readFileSync(caPath).toString(),
    rejectUnauthorized: !isDev,
  },
  extra: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
  },
});

// Only create SSH tunnel in development
export async function initializeDataSource() {
  if (isDev && env.ssh.enabled) {
    await createDbTunnel();
  }
  return dataSource.initialize();
}