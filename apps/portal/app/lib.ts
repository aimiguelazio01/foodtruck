// Shared helpers for the self-service wizard. Everything here runs in the browser.

export type Order = {
  id: string;
  mode: string;
  state: string; // new | queued | running | blocked | ready | cancelled
  message: string;
  step?: string;
  addresses: { customer?: string; management?: string };
  planStatus: string; // trialing | active | past_due | canceled | suspended
  trialEndsAt?: string;
  activeUntil: string;
  cancelAtPeriodEnd?: boolean;
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** GET without a body, POST with one. Errors carry the portal's own Portuguese message. */
export async function call<T = any>(path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Sem ligação ao serviço. Verifica a tua internet e tenta de novo.', 0);
  }
  let data: any = {};
  try {
    data = await response.json();
  } catch {
    // Non-JSON answers fall through to the generic message.
  }
  if (!response.ok) throw new ApiError(data?.message || 'Não foi possível concluir o pedido. Tenta novamente.', response.status);
  return data as T;
}

export const installSteps = [
  ['verify-package', 'A verificar o pacote'],
  ['provision-storage', 'A preparar a base de dados e as imagens'],
  ['configure-business', 'A configurar o teu negócio'],
  ['publish-api', 'A preparar o servidor'],
  ['publish-customer', 'A publicar a página de encomendas'],
  ['publish-management', 'A publicar a área de gestão'],
  ['attach-domain', 'A ligar o teu endereço'],
  ['verify-application', 'A verificar que tudo funciona'],
] as const;

export function progressPercent(step?: string): number {
  const index = installSteps.findIndex(([name]) => name === step);
  return index < 0 ? 5 : Math.round(((index + 1) / (installSteps.length + 1)) * 100);
}

export function stepLabel(step?: string): string {
  return installSteps.find(([name]) => name === step)?.[1] ?? 'A começar';
}

/** Whole days left until `iso`, never negative. */
export function daysLeft(iso?: string, now = Date.now()): number {
  const end = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(end) ? 0 : Math.max(0, Math.ceil((end - now) / 86_400_000));
}

const siteLink = /^https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,24}\/?$/;
export const safeSiteLink = (url?: string) => (url && siteLink.test(url) ? url : undefined);

/** Only ever send the browser to Stripe, whatever the service answered. */
export function stripeUrl(url: unknown, host: 'checkout.stripe.com' | 'billing.stripe.com'): string | undefined {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === 'https:' && parsed.hostname === host ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

/** Links to the shared demonstration site; null unless both are plain https site addresses (the operator sets them in .env). */
export function demoLinks(customer?: string, management?: string): { customer: string; management: string } | null {
  const site = safeSiteLink(customer?.trim());
  const manage = safeSiteLink(management?.trim());
  return site && manage ? { customer: site.replace(/\/$/, ''), management: manage.replace(/\/$/, '') } : null;
}
