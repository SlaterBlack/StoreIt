import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function servicePublicUrl(name: string, defaultValue: string): string {
  const value = process.env[name]?.trim() || defaultValue;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL.`);
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an absolute HTTP or HTTPS URL without credentials or query parameters.`);
  }
  return url.toString();
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4002),
  apiHost: process.env.API_HOST ?? "0.0.0.0",
  trustProxy: process.env.TRUST_PROXY?.trim() || false,
  clientOrigins: (
    process.env.CLIENT_ORIGINS ??
    "http://localhost:2400,http://localhost:2401,http://localhost:2402"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  splatIt: {
    sceneRoot: process.env.SPLATIT_SCENE_ROOT ?? "/MaxResources/GaussianSplats",
    allowedOrigins: (process.env.SPLATIT_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    signingSecret: process.env.SPLATIT_SIGNING_SECRET ?? "",
  },
  services: [
    {
      id: "clockit",
      name: "ClockIt",
      publicUrl: servicePublicUrl(
        "CLOCKIT_PUBLIC_URL",
        "https://clockit.ai3d.com.au:2400/",
      ),
      logoPath: "/ClockItLogo_32x32.png",
    },
    {
      id: "manageit",
      name: "ManageIt",
      publicUrl: servicePublicUrl(
        "MANAGEIT_PUBLIC_URL",
        "https://manageit.ai3d.com.au/",
      ),
      logoPath: "/ManageItLogo_32x32.png",
    },
    {
      id: "splatit",
      name: "SplatIt",
      publicUrl: servicePublicUrl(
        "SPLATIT_PUBLIC_URL",
        "https://splatit.ai3d.com.au/",
      ),
      logoPath: "/SplatItLogo_32.png",
    },
  ],

  db: {
    host: required("DB_HOST"),
    port: Number(process.env.DB_PORT ?? 5432),
    name: required("DB_NAME"),
    user: required("DB_USER"),
    password: required("DB_PASSWORD"),
    logging: (process.env.DB_LOGGING ?? "false") === "true",
  },

  jwt: {
    secret: required("JWT_SECRET"),
    expiresIn: process.env.JWT_EXPIRES_IN ?? "1d",
  },

  smtp: {
    host: process.env.SMTP_HOST?.trim() ?? "",
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: (process.env.SMTP_SECURE ?? "false") === "true",
    user: process.env.SMTP_USER?.trim() ?? "",
    password: process.env.SMTP_PASSWORD ?? "",
    from: process.env.SMTP_FROM?.trim() ?? "",
  },

  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS ?? 10),
};

export function sourceDatabase(prefix: "CLOCKIT_SOURCE" | "MANAGEIT_SOURCE") {
  const name = `${prefix}_DB`;
  const requiredSourceValue = (key: string): string => {
    const value = process.env[`${name}_${key}`];
    if (value === undefined || !value.trim()) {
      throw new Error(`Missing required migration variable: ${name}_${key}`);
    }
    return value;
  };

  return {
    host: requiredSourceValue("HOST"),
    port: Number(process.env[`${name}_PORT`] ?? 5432),
    name: requiredSourceValue("NAME"),
    user: requiredSourceValue("USER"),
    password: requiredSourceValue("PASSWORD"),
  };
}
