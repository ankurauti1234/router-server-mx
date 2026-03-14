import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
    host: process.env.RDS_HOST,                  // string | undefined ✅ OK
    port: process.env.RDS_PORT ? Number(process.env.DB_PORT) : undefined, // convert to number
    user: process.env.RDS_USER,
    password: process.env.RDS_PASSWORD,
    database: process.env.RDS_NAME,
});

export default pool;