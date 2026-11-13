import { Router } from "express";
import { env } from "../config/env";
import { asyncHandler } from "../utils/asyncHandler";

const router = Router();
const SERVICE_CHECK_TIMEOUT_MS = 2000;

function isExpectedConnectionError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

async function isServiceRunning(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(SERVICE_CHECK_TIMEOUT_MS),
    });
    return response.ok;
  } catch (error) {
    if (isExpectedConnectionError(error)) {
      return false;
    }
    throw error;
  }
}

router.get(
  "/",
  asyncHandler(async (_req, res) => {
    const serviceResults = await Promise.all(
      env.services.map(async (service) => {
        const publicUrl = service.publicUrl;
        if (!publicUrl || !(await isServiceRunning(publicUrl))) {
          return null;
        }
        return {
          id: service.id,
          name: service.name,
          url: publicUrl,
          logoUrl: new URL(service.logoPath, publicUrl).toString(),
        };
      }),
    );

    res
      .set("Cache-Control", "no-store")
      .json({ services: serviceResults.filter((service) => service !== null) });
  }),
);

export default router;
