import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const targets = {
  'x86_64-pc-windows-msvc': ['windows', 'amd64', '.exe'],
  'x86_64-apple-darwin': ['darwin', 'amd64', ''],
  'aarch64-apple-darwin': ['darwin', 'arm64', ''],
  'x86_64-unknown-linux-gnu': ['linux', 'amd64', ''],
};
const target = process.argv[2];
if (!targets[target]) throw new Error('Choose a supported Rust target triple');
const [GOOS, GOARCH, extension] = targets[target];
const publicKey = process.env.FOODTRUCK_LICENSE_PUBLIC_KEY || '';
if (publicKey && (!/^[A-Za-z0-9_-]{43}$/.test(publicKey) || Buffer.from(publicKey, 'base64url').length !== 32)) {
  throw new Error('FOODTRUCK_LICENSE_PUBLIC_KEY must contain the base64url Ed25519 public key');
}
const linkerFlags = ['-s', '-w', ...(publicKey ? [`-X=main.vendorPublicKey=${publicKey}`] : [])].join(' ');
const directory = fileURLToPath(new URL('./src-tauri/binaries/', import.meta.url));
await mkdir(directory, { recursive: true });
const result = spawnSync('go', ['build', '-buildvcs=false', '-trimpath', `-ldflags=${linkerFlags}`, '-o',
  join(directory, `foodtruck-cloud-engine-${target}${extension}`), './cmd/cloud-deploy'], {
  cwd: fileURLToPath(new URL('../launcher/', import.meta.url)),
  env: { ...process.env, GOOS, GOARCH, CGO_ENABLED: '0' }, stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error('Could not build the Cloudflare engine');
