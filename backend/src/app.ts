import cors from "cors";
import express, { Application } from "express";
import helmet from "helmet";
import morgan from "morgan";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requireAuth } from "./middleware/requireAuth";
import routes from "./routes";

export function createApp(): Application {
  const app = express();

  app.set("trust proxy", env.trustProxy);
  app.use(helmet());
  app.use(
    cors({
      origin: [
        ...new Set([...env.clientOrigins, ...env.splatIt.allowedOrigins]),
      ],
      credentials: true,
    }),
  );
  app.use(
    "/api/clockit/time-entries/import",
    requireAuth,
    express.json({ limit: "5mb" }),
  );
  app.use(express.json());
  app.use(morgan(env.nodeEnv === "development" ? "dev" : "combined"));

  app.use("/api", routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
