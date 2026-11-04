import { readBoundedJSON } from './installation-worker.mjs';

export const mediaPath = /^\/uploads\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.webp)$/;
const maximumBytes = 3 * 1024 * 1024;

export async function saveImage(request, env) {
  if (!env.IMAGES || !env.MEDIA) return { status: 503, body: { message: 'O carregamento de imagens ainda não está configurado.' } };
  const input = (await readBoundedJSON(request, 4_200_000))?.data;
  const invalid = { status: 400, body: { message: 'Carregue uma imagem PNG, JPEG ou WebP válida, até 3 MB.' } };
  if (typeof input !== 'string' || input.length > maximumBytes * 4 / 3 || !/^[A-Za-z0-9+/]+={0,2}$/.test(input)) return invalid;
  let transformed;
  try {
    const decoded = atob(input);
    if (decoded.length > maximumBytes) return invalid;
    const png = decoded.startsWith('\x89PNG\r\n\x1a\n');
    const jpeg = decoded.startsWith('\xff\xd8\xff');
    const webp = decoded.startsWith('RIFF') && decoded.slice(8, 12) === 'WEBP';
    if (!png && !jpeg && !webp) return invalid;
    const image = new Blob([Uint8Array.from(decoded, value => value.charCodeAt(0))]);
    const info = await env.IMAGES.info(image.stream());
    if (!Number.isSafeInteger(info.width) || !Number.isSafeInteger(info.height) ||
      info.width < 1 || info.height < 1 || info.width * info.height > 25_000_000) return invalid;
    transformed = (await env.IMAGES.input(image.stream()).transform({ width: 2048, height: 2048, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 92, anim: false })).response();
  } catch {
    return { status: 422, body: { message: 'Não foi possível processar a imagem. Verifique o ficheiro ou tente novamente.' } };
  }
  if (!transformed.ok || !transformed.body || transformed.headers.get('Content-Type') !== 'image/webp') return invalid;
  const file = `${crypto.randomUUID()}.webp`;
  await env.MEDIA.put(`uploads/${file}`, transformed.body, { httpMetadata: { contentType: 'image/webp' } });
  return { status: 201, body: { path: `/uploads/${file}` } };
}

export async function readMedia(env, file, head = false) {
  if (!env.MEDIA) return new Response(null, { status: 404 });
  const key = `uploads/${file}`;
  const object = head ? await env.MEDIA.head(key) : await env.MEDIA.get(key);
  if (!object) return new Response(null, { status: 404 });
  return new Response(head ? null : object.body, { headers: {
    'Content-Type': 'image/webp', 'Cache-Control': 'public,max-age=31536000,immutable',
    'X-Content-Type-Options': 'nosniff', ETag: object.httpEtag,
  } });
}
