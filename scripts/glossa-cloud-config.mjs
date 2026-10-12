import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Load only public Glossa configuration; credentials remain outside the build script. */
export function readGlossaPublicConfig(root, environment = process.env) {
  const file = resolve(root, 'apps/readest-app/.env.glossa.local');
  const values = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(NEXT_PUBLIC_GLOSSA_[A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
      values[match[1]] = value;
    }
  }
  for (const [key, value] of Object.entries(environment)) {
    if (key.startsWith('NEXT_PUBLIC_GLOSSA_') && value !== undefined) values[key] = value;
  }
  const authKey = values.NEXT_PUBLIC_GLOSSA_AUTH_KEY?.trim();
  if (authKey?.startsWith('sb_secret_')) throw new Error('Use a public Glossa auth key, never a secret key');
  if (authKey?.split('.').length === 3) {
    let role;
    try { role = JSON.parse(Buffer.from(authKey.split('.')[1], 'base64url').toString('utf8')).role; }
    catch { throw new Error('Invalid public Glossa auth key'); }
    if (role !== 'anon') throw new Error('Use an anon or publishable Glossa auth key');
  }
  return values;
}

/** Generate native callbacks from the same public client ID baked into the frontend. */
export function prepareGlossaCloudConfig(root, { dev = false, environment = process.env } = {}) {
  const values = readGlossaPublicConfig(root, environment);
  const schemes = [dev ? 'glossa-dev' : 'glossa', dev ? 'glossa-dev-onedrive' : 'glossa-onedrive', 'readest'];
  const clientId = values.NEXT_PUBLIC_GLOSSA_GOOGLE_CLIENT_ID || environment.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (clientId) {
    if (!/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
      throw new Error('Invalid Glossa Google native public client ID');
    }
    schemes.push(`com.googleusercontent.apps.${clientId.replace(/\.apps\.googleusercontent\.com$/, '').toLowerCase()}`);
  }
  const directory = resolve(root, dev ? '.glossa-dev' : '.glossa-build', 'config');
  mkdirSync(directory, { recursive: true });
  const configPath = resolve(directory, 'cloud.json');
  writeFileSync(configPath, JSON.stringify({ plugins: { 'deep-link': { desktop: { schemes } } } }, null, 2) + '\n');
  return { configPath, environment: values };
}
