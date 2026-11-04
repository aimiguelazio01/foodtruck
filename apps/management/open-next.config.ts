import {defineCloudflareConfig} from '@opennextjs/cloudflare';
// As páginas privadas usam no-store; não partilhar cache de respostas autenticadas.
export default defineCloudflareConfig();
