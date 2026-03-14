// src/config/dataSource.ts
import "reflect-metadata";
import { DataSource } from "typeorm";
import fs from "fs";
import { env } from "./env.js";
import { getDbHost, getDbPort, createDbTunnel } from "./dbTunnel.js";
import { User } from "../entities/user.entities.js";
import { RouterEventsReport } from "../entities/routerEvent.js";


const isDev = env.nodeEnv === "development";

export const dataSource = new DataSource({
  type: "postgres",
  host: getDbHost(),
  port: getDbPort(),
  username: env.db.username,
  password: env.db.password,
  database: env.db.database,
  entities: [User,  RouterEventsReport],
  synchronize: true,
  logging: env.nodeEnv !== "production",
  ssl: {
    ca: fs.readFileSync("global-bundle.pem").toString(),
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