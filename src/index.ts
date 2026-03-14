import express from "express";
import cors from "cors";
import { initializeDataSource } from "./config/dataSource.js";
import authRouter from "./routes/auth.routes.js";
import routerEventRoutes from "./routes/routerEvent.routes.js";
import cookieParser from 'cookie-parser'

const app = express();
app.use(cookieParser());

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "https://router-mexico.indirex.io"
    ],          // ← your frontend URL
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // usually enough
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,                        // if you use cookies / auth later
  })
);

app.use(express.json());

app.use("/api/auth", authRouter);
app.use("/api/router-events", routerEventRoutes);

const PORT = process.env.PORT || 4000;

initializeDataSource()
  .then(() => {
    console.log("Database connected successfully");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize DB:", err);
  });