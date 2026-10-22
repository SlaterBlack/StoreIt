import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4002),
  clientOrigins: (process.env.CLIENT_ORIGINS ??
    'http://localhost:2400,http://localhost:2401,http://localhost:2402')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  db: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT ?? 5432),
    name: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    logging: (process.env.DB_LOGGING ?? 'false') === 'true',
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
  },

  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS ?? 10),
};

export function sourceDatabase(prefix: 'CLOCKIT_SOURCE' | 'MANAGEIT_SOURCE') {
  const name = `${prefix}_DB`;
  const requiredSourceValue = (key: string): string => {
    const value = process.env[`${name}_${key}`];
    if (value === undefined || !value.trim()) {
      throw new Error(`Missing required migration variable: ${name}_${key}`);
    }
    return value;
  };

  return {
    host: requiredSourceValue('HOST'),
    port: Number(process.env[`${name}_PORT`] ?? 5432),
    name: requiredSourceValue('NAME'),
    user: requiredSourceValue('USER'),
    password: requiredSourceValue('PASSWORD'),
  };
}
