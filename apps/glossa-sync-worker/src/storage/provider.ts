import { AwsV4Signer } from 'aws4fetch';
import type { Bindings } from '../contracts';

type Signed = { url: string; headers: Record<string, string>; expires_at: number };
type DeleteResult = { key: string; deleted: boolean };
type ObjectMetadata = {
  bytes: number;
  etag: string;
  contentType?: string;
  md5?: ArrayBuffer;
};
export function objectStorage(env: Bindings): ObjectStorageProvider {
  return new R2Storage(env);
}
export interface ObjectStorageProvider {
  generatePresignedPut(key: string, mime: string, md5: string, expiresAt: number): Promise<Signed>;
  generatePresignedGet(key: string, expiresAt: number): Promise<Signed>;
  headObject(key: string): Promise<ObjectMetadata | null>;
  deleteObjects(keys: readonly string[]): Promise<DeleteResult[]>;
}
export class R2Storage implements ObjectStorageProvider {
  constructor(private readonly env: Bindings) {}
  private async sign(
    method: string,
    key: string,
    headers: Record<string, string>,
    expiresAt: number,
  ) {
    const {
      R2_S3_ENDPOINT: endpoint,
      R2_BUCKET_NAME: bucket,
      R2_ACCESS_KEY_ID: accessKeyId,
      R2_SECRET_ACCESS_KEY: secretAccessKey,
    } = this.env;
    const url = new URL(endpoint);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      !bucket ||
      !accessKeyId ||
      !secretAccessKey
    )
      throw new Error('Invalid R2 signing configuration');
    url.pathname = '/' + [bucket, ...key.split('/')].map(encodeURIComponent).join('/');
    const start = Math.floor(Date.now() / 1000);
    const expiry = Math.floor(expiresAt / 1000);
    if (expiry <= start) throw new Error('Signing window expired');
    url.searchParams.set('X-Amz-Expires', String(expiry - start));
    const signer = new AwsV4Signer({
      method,
      url: url.href,
      headers,
      accessKeyId,
      secretAccessKey,
      service: 's3',
      region: 'auto',
      datetime: new Date(start * 1000).toISOString().replace(/[:-]|\.\d{3}/g, ''),
      allHeaders: true,
      signQuery: true,
    });
    return { url: (await signer.sign()).url.href, headers, expires_at: expiry * 1000 };
  }
  generatePresignedPut(key: string, mime: string, md5: string, expiresAt: number) {
    return this.sign(
      'PUT',
      key,
      { 'Content-Type': mime, 'Content-MD5': md5, 'If-None-Match': '*' },
      expiresAt,
    );
  }
  generatePresignedGet(key: string, expiresAt: number) {
    return this.sign('GET', key, {}, expiresAt);
  }
  async headObject(key: string): Promise<ObjectMetadata | null> {
    const value = await this.env.OBJECTS.head(key);
    return (
      value && {
        bytes: value.size,
        etag: value.etag,
        contentType: value.httpMetadata?.contentType,
        md5: value.checksums.md5,
      }
    );
  }
  async deleteObjects(keys: readonly string[]): Promise<DeleteResult[]> {
    const results: DeleteResult[] = [];
    for (const key of keys) {
      try {
        await this.env.OBJECTS.delete(key);
        results.push({ key, deleted: true });
      } catch {
        results.push({ key, deleted: false });
      }
    }
    return results;
  }
}
