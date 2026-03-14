import * as dotenv from "dotenv";
dotenv.config();

const isDev = process.env.NODE_ENV === "development";

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT) || 4000,

  db: {
    host: process.env.RDS_HOST!,
    port: Number(process.env.RDS_PORT) || 5432,
    username: process.env.RDS_USER!,
    password: process.env.RDS_PASSWORD!,
    database: process.env.RDS_DB!,
  },

  ssh: {
    enabled: isDev && process.env.USE_SSH_TUNNEL !== "false",
    host: process.env.SSH_HOST!,
    port: Number(process.env.SSH_PORT) || 22,
    username: process.env.SSH_USERNAME!,
    keyPath: process.env.SSH_KEY_PATH!,
    localPort: Number(process.env.SSH_LOCAL_PORT) || 5433,
  },

  jwt: {
    secret: process.env.JWT_SECRET!,
    expiration: process.env.JWT_EXPIRES_IN || "1h",
  },
};