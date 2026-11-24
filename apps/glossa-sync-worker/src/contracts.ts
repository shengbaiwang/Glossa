export * from '@glossa/sync-contracts';
export type Bindings = {
  CLIENT_ORIGINS?: string;
  DB: D1Database;
  OBJECTS: Pick<R2Bucket, 'head' | 'delete'>;
  R2_S3_ENDPOINT: string;
  R2_BUCKET_NAME: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  IDENTITY_ISSUER: string;
  IDENTITY_AUDIENCE: string;
  IDENTITY_JWKS_URL?: string;
  IDENTITY_JWKS_JSON?: string;
  TOKEN_ISSUER: string;
  ACCESS_SECRET: string;
  REFRESH_SECRET: string;
  JTI_SECRET: string;
};
export type Principal = { user: string; session: string; device: string };
export type AppEnv = { Bindings: Bindings; Variables: { principal: Principal; requestId: string } };
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 503,
    readonly code: string,
  ) {
    super(code);
  }
}
export function unauthorized() {
  return new ApiError(401, 'invalid_credentials');
}
