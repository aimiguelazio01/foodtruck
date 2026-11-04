type BrandingAPI = { fetch(request: Request): Promise<Response> };

export async function readAppBranding() {
  const fallback = { app_name: 'Food Truck Live', secondary_color: '#20271f', logo: '' };
  try {
    let api: BrandingAPI | undefined;
    let cloudflare = false;
    try {
      const { getCloudflareContext } = await import('@opennextjs/cloudflare');
      const context = getCloudflareContext();
      cloudflare = true;
      api = (context.env as unknown as { FOODTRUCK_API?: BrandingAPI }).FOODTRUCK_API;
    } catch {
      // Node installations do not have an OpenNext request context.
    }
    if (cloudflare && !api) return fallback;
    const response = api
      ? await api.fetch(new Request('https://foodtruck-api.internal/api/v1/public/app-settings'))
      : await fetch(`${process.env.INTERNAL_API_URL || 'http://localhost:4000'}/api/v1/public/app-settings`, { cache: 'no-store' });
    if (response.ok) return await response.json();
  } catch {
    // Branding must not prevent the login page from rendering during recovery.
  }
  return fallback;
}
