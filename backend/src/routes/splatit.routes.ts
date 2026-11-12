import { createHmac, timingSafeEqual } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { NextFunction, Request, Response, Router } from "express";
import { env } from "../config/env";
import { requireAuth } from "../middleware/requireAuth";
import { ApiError } from "../utils/ApiError";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();
const supportedExtensions = new Set([
  ".ply",
  ".sog",
  ".spz",
  ".ksplat",
  ".html",
]);
const signedUrlLifetimeSeconds = 5 * 60;
const rateLimitWindowMs = 60 * 1000;
const rateLimitRequestCount = 120;
const requestCounts = new Map<string, { startedAt: number; count: number }>();
const normalizedAllowedOrigins = new Set(
  env.splatIt.allowedOrigins.map((origin) => {
    try {
      return new URL(origin).origin;
    } catch {
      return "";
    }
  }),
);
let rateLimitCleanupCount = 0;

function requestOrigin(req: Request): string | undefined {
  const header = req.get("origin") ?? req.get("referer");
  if (!header || header === "null") {
    return undefined;
  }

  try {
    return new URL(header).origin;
  } catch {
    return undefined;
  }
}

function requireAllowedOrigin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (normalizedAllowedOrigins.size === 0) {
    next(new ApiError(503, "SplatIt allowed origins are not configured."));
    return;
  }

  const origin = requestOrigin(req);
  if (!origin || !normalizedAllowedOrigins.has(origin)) {
    next(
      new ApiError(403, "This origin is not allowed to access SplatIt scenes."),
    );
    return;
  }

  next();
}

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const clientIp = req.ip || req.socket.remoteAddress || "unknown";
  const current = requestCounts.get(clientIp);

  if (!current || now - current.startedAt >= rateLimitWindowMs) {
    requestCounts.set(clientIp, { startedAt: now, count: 1 });
  } else if (current.count >= rateLimitRequestCount) {
    const retryAfterSeconds = Math.ceil(
      (rateLimitWindowMs - (now - current.startedAt)) / 1000,
    );
    res.setHeader("Retry-After", String(retryAfterSeconds));
    next(
      new ApiError(429, "Too many SplatIt requests. Please try again shortly."),
    );
    return;
  } else {
    current.count += 1;
  }

  rateLimitCleanupCount += 1;
  if (rateLimitCleanupCount % 256 === 0) {
    for (const [ip, entry] of requestCounts) {
      if (now - entry.startedAt >= rateLimitWindowMs) {
        requestCounts.delete(ip);
      }
    }
  }

  next();
}

function sceneNameFromId(id: string): string {
  let name: string;
  try {
    name = Buffer.from(id, "base64url").toString("utf8");
  } catch {
    throw new ApiError(400, "Invalid scene identifier.");
  }

  const segments = name.split("/");
  if (
    !name ||
    Buffer.from(name).toString("base64url") !== id ||
    name.includes("\\") ||
    path.posix.isAbsolute(name) ||
    path.posix.normalize(name) !== name ||
    segments.length > 2 ||
    segments.some((segment) => !segment || segment.startsWith("."))
  ) {
    throw new ApiError(400, "Invalid scene identifier.");
  }

  if (!supportedExtensions.has(path.extname(name).toLowerCase())) {
    throw new ApiError(404, "Scene not found.");
  }

  return name;
}

function collisionNameFromSceneId(id: string): string {
  const sceneName = sceneNameFromId(id);
  const extension = path.posix.extname(sceneName).toLowerCase();
  if (extension === ".html") {
    throw new ApiError(404, "Collision data not found.");
  }

  const directory = path.posix.dirname(sceneName);
  const basename = path.posix.basename(sceneName, extension);
  return path.posix.join(directory, `${basename}.collision.glb`);
}

function signingSecret(): string {
  if (env.splatIt.signingSecret.length < 32) {
    throw new ApiError(503, "SplatIt signed URL configuration is unavailable.");
  }

  return env.splatIt.signingSecret;
}

function signatureFor(
  id: string,
  expiresAt: number,
  kind: "splat" | "collision" = "splat",
): string {
  return createHmac("sha256", signingSecret())
    .update(`${id}:${kind}:${expiresAt}`)
    .digest("base64url");
}

function hasValidSignature(
  id: string,
  expiresAt: number,
  signature: string,
  kind: "splat" | "collision" = "splat",
): boolean {
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  const expected = Buffer.from(signatureFor(id, expiresAt, kind));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

router.use(requireAllowedOrigin, rateLimit);

router.get(
  "/scenes",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const sceneRoot = env.splatIt.sceneRoot;
    let entries;
    try {
      entries = await readdir(sceneRoot, { withFileTypes: true });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "EACCES")
      ) {
        console.error("SplatIt scene storage is unavailable.", error);
        throw new ApiError(503, "SplatIt scene storage is unavailable.");
      }
      throw error;
    }

    const fileNames: string[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      if (
        entry.isFile() &&
        supportedExtensions.has(path.extname(entry.name).toLowerCase())
      ) {
        fileNames.push(entry.name);
      } else if (entry.isDirectory()) {
        const childEntries = await readdir(path.join(sceneRoot, entry.name), {
          withFileTypes: true,
        });
        for (const child of childEntries) {
          if (
            child.isFile() &&
            !child.name.startsWith(".") &&
            supportedExtensions.has(path.extname(child.name).toLowerCase())
          ) {
            fileNames.push(`${entry.name}/${child.name}`);
          }
        }
      }
    }

    const scenes = fileNames
      .map((name) => {
        const fileName = path.basename(name);
        const subdirectory = path.dirname(name);
        const extension = path.extname(fileName).slice(1).toUpperCase();
        return {
          id: Buffer.from(name).toString("base64url"),
          title: path
            .basename(fileName, path.extname(fileName))
            .replace(/[_-]+/g, " "),
          description:
            extension === "HTML"
              ? "Open this SuperSplat export in its standalone viewer."
              : "Explore this Gaussian splat from the Bluey project library.",
          format: extension,
          sourceLabel:
            subdirectory === "."
              ? "Bluey GaussianSplats"
              : `Bluey GaussianSplats / ${subdirectory}`,
        };
      })
      .sort((left, right) => left.title.localeCompare(right.title));

    res.json({ scenes });
  }),
);

router.get(
  "/scenes/:id/collision/access",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sceneName = sceneNameFromId(req.params.id);
    const collisionName = collisionNameFromSceneId(req.params.id);
    const scenePath = path.join(env.splatIt.sceneRoot, sceneName);
    const collisionPath = path.join(env.splatIt.sceneRoot, collisionName);

    try {
      const source = await stat(scenePath);
      if (!source.isFile()) {
        throw new ApiError(404, "Scene not found.");
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new ApiError(404, "Scene not found.");
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EACCES"
      ) {
        console.error("SplatIt collision data is unavailable.", error);
        throw new ApiError(503, "SplatIt collision data is unavailable.");
      }
      throw error;
    }

    try {
      const collision = await stat(collisionPath);
      if (!collision.isFile()) {
        res.json({ url: null });
        return;
      }
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        res.json({ url: null });
        return;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "EACCES"
      ) {
        console.error("SplatIt collision data is unavailable.", error);
        throw new ApiError(503, "SplatIt collision data is unavailable.");
      }
      throw error;
    }

    const expiresAt = Math.floor(Date.now() / 1000) + signedUrlLifetimeSeconds;
    const signature = signatureFor(req.params.id, expiresAt, "collision");
    res.json({
      url: `/api/splatit/collision-assets/${encodeURIComponent(req.params.id)}.glb?expires=${expiresAt}&signature=${encodeURIComponent(signature)}`,
      expiresAt,
    });
  }),
);

router.get(
  "/collision-assets/:id.glb",
  asyncHandler(async (req, res, next) => {
    const expiresAt = Number(req.query.expires);
    const signature = req.query.signature;
    if (
      typeof signature !== "string" ||
      !hasValidSignature(req.params.id, expiresAt, signature, "collision")
    ) {
      throw new ApiError(403, "This collision URL is invalid or has expired.");
    }

    const collisionName = collisionNameFromSceneId(req.params.id);
    const filePath = path.join(env.splatIt.sceneRoot, collisionName);
    try {
      const file = await stat(filePath);
      if (!file.isFile()) {
        throw new ApiError(404, "Collision data not found.");
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new ApiError(404, "Collision data not found.");
      }
      throw error;
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.type(".glb");
    res.sendFile(filePath, (error) => {
      if (error) {
        next(error);
      }
    });
  }),
);

router.get(
  "/scenes/:id/access",
  requireAuth,
  asyncHandler(async (req, res) => {
    const name = sceneNameFromId(req.params.id);
    const filePath = path.join(env.splatIt.sceneRoot, name);

    try {
      const file = await stat(filePath);
      if (!file.isFile()) {
        throw new ApiError(404, "Scene not found.");
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new ApiError(404, "Scene not found.");
      }
      throw error;
    }

    const expiresAt = Math.floor(Date.now() / 1000) + signedUrlLifetimeSeconds;
    const signature = signatureFor(req.params.id, expiresAt);
    res.json({
      url: `/api/splatit/assets/${encodeURIComponent(req.params.id)}?expires=${expiresAt}&signature=${encodeURIComponent(signature)}`,
      expiresAt,
    });
  }),
);

router.get(
  "/assets/:id",
  asyncHandler(async (req, res, next) => {
    const expiresAt = Number(req.query.expires);
    const signature = req.query.signature;
    if (
      typeof signature !== "string" ||
      !hasValidSignature(req.params.id, expiresAt, signature)
    ) {
      throw new ApiError(403, "This asset URL is invalid or has expired.");
    }

    const name = sceneNameFromId(req.params.id);
    const filePath = path.join(env.splatIt.sceneRoot, name);
    try {
      const file = await stat(filePath);
      if (!file.isFile()) {
        throw new ApiError(404, "Scene not found.");
      }
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        throw new ApiError(404, "Scene not found.");
      }
      throw error;
    }

    res.setHeader("Cache-Control", "private, no-store");
    if (path.extname(name).toLowerCase() === ".html") {
      res.setHeader(
        "Content-Security-Policy",
        "sandbox allow-scripts allow-pointer-lock; default-src 'self' data: blob: https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob: data: https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' data: blob: https://cdn.jsdelivr.net; img-src 'self' data: blob: https://cdn.jsdelivr.net; connect-src 'self' data: blob: https://cdn.jsdelivr.net; font-src 'self' data: https://cdn.jsdelivr.net; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
      );
    }
    res.type(path.extname(name));
    res.sendFile(filePath, (error) => {
      if (error) {
        next(error);
      }
    });
  }),
);

export default router;
