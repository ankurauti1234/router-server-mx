import "reflect-metadata";
import { DataSource, DataSourceOptions } from "typeorm";
import { env } from "./env.js";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { getDbHost, getDbPort } from "./dbTunnel.js";
import { User } from "../entities/user.entities.js";
import { RouterEventsReport } from "../entities/routerEvent.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const caPath = path.resolve(__dirname, "../../global-bundle.pem");

const isDev = env.nodeEnv === "development";

const baseConfig: DataSourceOptions = {
  type: "postgres",
  username: env.db.username,
  password: env.db.password,
  database: env.db.database,
  synchronize: false,
  logging: env.nodeEnv !== "production",

  entities: [User, RouterEventsReport],

  migrations: isDev
    ? ["src/migrations/**/*.ts"]
    : ["dist/migrations/**/*.js"],

  ssl: {
    ca: fs.readFileSync(caPath).toString(),
    rejectUnauthorized: !isDev,
  },

  extra: {
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
  },
};

export const dataSource = new DataSource({
  ...baseConfig,
  host: isDev ? getDbHost() : env.db.host,
  port: isDev ? getDbPort() : env.db.port,
});