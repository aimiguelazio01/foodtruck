// Fills the locally generated secrets of the operator platform .env without ever printing them.
//
//   node scripts/platform-secrets.mjs [env-file] [--keys-dir <folder>]
//
// Only empty values are filled, so running it twice never replaces a key in use. The Ed25519
// signing key is written to the .env (64 bytes, base64url, as the Go service expects) and, as
// PKCS8 PEM, to <keys-dir>/signing-key.pem for `license-tool -mode sign-package`.
// The keys folder defaults to ~/.foodtruck-platform, outside the repository.
import { createPrivateKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const b64url = bytes => Buffer.from(bytes).toString('base64url');

export const generators = {
  PLATFORM_DB_PASSWORD: () => randomBytes(24).toString('hex'), // URL-safe: it goes into a connection string
  PLATFORM_ENCRYPTION_KEY: () => b64url(randomBytes(32)),
  PLATFORM_ADMIN_KEY: () => b64url(randomBytes(48)),
};

/** A new Ed25519 key: the .env value (seed || public key) and the matching PKCS8 PEM. */
export function newSigningKey() {
  const { privateKey } = generateKeyPairSync('ed25519');
  return signingKeyFiles(privateKey);
}

/** Rebuilds the PEM and public key from an existing .env value. */
export function signingKeyFromEnv(value) {
  const raw = Buffer.from(value, 'base64url');
  if (raw.length !== 64) throw new Error('PLATFORM_SIGNING_KEY must be 64 bytes, base64url');
  const key = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: b64url(raw.subarray(0, 32)), x: b64url(raw.subarray(32)) }, format: 'jwk' });
  const files = signingKeyFiles(key);
  if (files.env !== value) throw new Error('PLATFORM_SIGNING_KEY does not match its own public key');
  return files;
}

function signingKeyFiles(privateKey) {
  const jwk = privateKey.export({ format: 'jwk' });
  return {
    env: b64url(Buffer.concat([Buffer.from(jwk.d, 'base64url'), Buffer.from(jwk.x, 'base64url')])),
    pem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    publicKey: jwk.x,
  };
}

/** Returns the new .env text and the names that were filled. Lines and comments are kept as they are. */
export function fillSecrets(text, signingKey = newSigningKey) {
  const filled = [];
  let signing;
  const lines = text.split(/\r?\n/).map(line => {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match || match[2].trim() !== '') return line;
    const name = match[1];
    if (generators[name]) {
      filled.push(name);
      return `${name}=${generators[name]()}`;
    }
    if (name === 'PLATFORM_SIGNING_KEY') {
      signing = signingKey();
      filled.push(name);
      return `${name}=${signing.env}`;
    }
    return line;
  });
  return { text: lines.join('\n'), filled, signing };
}

function main(argv) {
  const keysAt = argv.indexOf('--keys-dir');
  const keysDir = resolve(keysAt >= 0 ? argv[keysAt + 1] : join(homedir(), '.foodtruck-platform'));
  const positional = argv.filter((arg, i) => !arg.startsWith('--') && (keysAt < 0 || i !== keysAt + 1));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const envFile = resolve(positional[0] ?? join(root, 'deployment', 'platform', '.env'));
  if (!existsSync(envFile)) {
    copyFileSync(join(dirname(envFile), '.env.example'), envFile);
    console.log(`Criado ${envFile} a partir de .env.example`);
  }
  const { text, filled, signing } = fillSecrets(readFileSync(envFile, 'utf8'));
  const pemPath = join(keysDir, 'signing-key.pem');
  // Keep the PEM in step with the .env: write it for a new key, or rebuild it if it is missing.
  const existing = /^PLATFORM_SIGNING_KEY=(.+)$/m.exec(text)?.[1]?.trim();
  const key = signing ?? (existing ? signingKeyFromEnv(existing) : undefined);
  if (key && (signing || !existsSync(pemPath))) {
    mkdirSync(keysDir, { recursive: true });
    if (existsSync(pemPath) && signing) throw new Error(`${pemPath} já existe; mova-o antes de gerar uma chave nova`);
    writeFileSync(pemPath, key.pem, { mode: 0o600 });
    writeFileSync(join(keysDir, 'signing-key.pub'), key.publicKey + '\n');
    console.log(`Chave de assinatura (PEM) em ${pemPath}`);
  }
  writeFileSync(envFile, text, { mode: 0o600 });
  console.log(filled.length ? `Preenchidos: ${filled.join(', ')}` : 'Nada a preencher: todos os valores gerados já existem.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
