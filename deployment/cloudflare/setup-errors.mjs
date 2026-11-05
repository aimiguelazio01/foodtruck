export function setupError(stage, code, retryable = true) {
  return Response.json({ code, stage, retryable, requestId: crypto.randomUUID(),
    message: 'A configuração não foi concluída. Consulte o diagnóstico da instalação.' },
  { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
