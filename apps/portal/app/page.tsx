'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, Order, call, daysLeft, progressPercent, safeSiteLink, stepLabel, stripeUrl } from './lib';

type Stage = 'loading' | 'account' | 'business' | 'progress' | 'ready';
type SlugState = { state: 'idle' | 'checking' | 'ok' | 'taken' | 'invalid'; domain: string };

const stages: [Stage, string][] = [
  ['account', 'Criar conta'],
  ['business', 'O teu negócio'],
  ['progress', 'A preparar o site'],
  ['ready', 'Pronto'],
];

export default function Portal() {
  const [stage, setStage] = useState<Stage>('loading');
  const [order, setOrder] = useState<Order | undefined>();
  const [mode, setMode] = useState<'signup' | 'login'>('signup');
  const [sentTo, setSentTo] = useState('');
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [slug, setSlug] = useState('');
  const [slugState, setSlugState] = useState<SlugState>({ state: 'idle', domain: '' });
  const [qr, setQr] = useState('');
  const [demo, setDemo] = useState<{ customer?: string; management?: string }>({});
  const started = useRef(false);

  // The shared demonstration site, when the operator has installed one.
  useEffect(() => {
    fetch('/api/demo', { cache: 'no-store' }).then(r => (r.ok ? r.json() : {})).then(setDemo).catch(() => {});
  }, []);

  const say = (text: string, bad = false) => {
    setMessage(text);
    setFailed(bad);
  };
  const fail = (error: unknown) => say(error instanceof Error ? error.message : 'Ocorreu um erro. Tenta novamente.', true);

  const refresh = useCallback(async (quiet = true) => {
    try {
      const orders = await call<Order[]>('orders');
      const managed = orders.find(o => o.mode === 'platform');
      setOrder(managed);
      if (!managed) {
        setStage('account');
        if (!quiet) say('Esta conta não tem um espaço gerido. Usa as opções avançadas.', true);
        return;
      }
      setStage(managed.state === 'ready' ? 'ready' : managed.state === 'new' || managed.state === 'cancelled' ? 'business' : 'progress');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setOrder(undefined);
        setStage('account');
      } else if (!quiet) fail(error);
      else setStage(current => (current === 'loading' ? 'account' : current));
    }
  }, []);

  // First load: handle the e-mail confirmation link and the return from Stripe, then look at the session.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('verify');
    const billing = params.get('billing');
    if (token || billing) window.history.replaceState(null, '', window.location.pathname);
    (async () => {
      if (token) {
        try {
          await call('auth/verify', { token });
          say('Email confirmado! O teu teste gratuito já começou.');
        } catch (error) {
          fail(error);
        }
      } else if (billing === 'ok') {
        say('Pagamento recebido. Pode demorar alguns instantes a aparecer aqui.');
      } else if (billing === 'cancelled') {
        say('O pagamento foi cancelado. Podes subscrever quando quiseres.');
      }
      await refresh();
    })();
  }, [refresh]);

  // Follow the installation without any manual refresh.
  useEffect(() => {
    if (stage !== 'progress' || order?.state === 'blocked') return;
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [stage, order?.state, refresh]);

  // Learn whether addresses live on the operator's domain, then check the one being typed.
  useEffect(() => {
    if (stage !== 'business') return;
    const wanted = slug.trim().toLowerCase();
    setSlugState(current => ({ ...current, state: wanted ? 'checking' : 'idle' }));
    const timer = setTimeout(async () => {
      try {
        const answer = await call<{ domain: string; available: boolean; reason?: string }>('slugs/check?slug=' + encodeURIComponent(wanted));
        setSlugState({ domain: answer.domain, state: !wanted ? 'idle' : answer.available ? 'ok' : answer.reason === 'taken' ? 'taken' : 'invalid' });
      } catch {
        setSlugState(current => ({ ...current, state: 'idle' }));
      }
    }, wanted ? 400 : 0);
    return () => clearTimeout(timer);
  }, [slug, stage]);

  // A scannable code for the ordering page, drawn in the browser.
  const customerLink = safeSiteLink(order?.addresses?.customer);
  useEffect(() => {
    if (stage !== 'ready' || !customerLink) return;
    let cancelled = false;
    import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(customerLink, { margin: 1, width: 220 })).then(url => {
      if (!cancelled) setQr(url);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [stage, customerLink]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  const days = daysLeft(order?.trialEndsAt);
  const plan = order?.planStatus;
  const canSubscribe = plan === 'trialing' || plan === 'canceled' || plan === 'suspended';
  const active = Math.max(0, stages.findIndex(([name]) => name === stage));

  return (
    <main>
      <aside>
        <strong>FOOD TRUCK<br />LIVE.</strong>
        <p>O teu negócio,<br />pronto para abrir.</p>
        <ol>
          {stages.map(([name, label], index) => (
            <li key={name} className={index === active ? 'active' : index < active ? 'done' : ''} aria-current={index === active ? 'step' : undefined}>{label}</li>
          ))}
        </ol>
        <small>Teste gratuito, sem cartão.<br />Cancelas quando quiseres.</small>
      </aside>
      <article>
        <p className="eyebrow">DO PRIMEIRO CLIQUE À PRIMEIRA ENCOMENDA</p>
        <p className="mobile-step" aria-hidden="true">Passo {active + 1} de {stages.length} · {stages[active][1]}</p>

        {stage === 'loading' && <p role="status">A carregar…</p>}

        {stage === 'account' && (sentTo ? (
          <section>
            <h1>Verifica<br />o teu email.</h1>
            <p>Enviámos uma ligação de confirmação para <strong>{sentTo}</strong>. Abre-a para começar o teste gratuito. Se não a vires, espreita o spam.</p>
            <button disabled={busy} onClick={() => run(async () => { await call('auth/signup', { email: sentTo, password: pendingPassword.current }); say('Enviámos outro email.'); })}>Reenviar email</button>
            <button className="link" onClick={() => { setSentTo(''); pendingPassword.current = ''; }}>Usar outro email</button>
          </section>
        ) : (
          <section>
            <h1>{mode === 'signup' ? <>Vamos abrir<br />o teu espaço.</> : <>Bem-vindo<br />de volta.</>}</h1>
            <p>{mode === 'signup' ? 'Cria a tua conta e experimenta grátis. Não pedimos cartão.' : 'Entra para ver o teu espaço.'}</p>
            <form onSubmit={e => {
              e.preventDefault();
              const form = e.currentTarget;
              const data = new FormData(form);
              const email = String(data.get('email')).trim();
              const password = String(data.get('password'));
              run(async () => {
                if (mode === 'login') {
                  await call('auth/login', { email, password });
                  say('');
                  await refresh(false);
                } else {
                  const result = await call<{ message: string }>('auth/signup', { email, password });
                  pendingPassword.current = password;
                  setSentTo(email);
                  say(result.message);
                }
              });
            }}>
              <label>Email<input name="email" type="email" required maxLength={254} autoComplete="username" /></label>
              <label>Palavra-passe (mínimo 12 caracteres)<input name="password" type="password" required minLength={12} maxLength={256} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>
              <button disabled={busy}>{mode === 'signup' ? 'Criar conta grátis' : 'Entrar'}</button>
            </form>
            <button className="link" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); say(''); }}>
              {mode === 'signup' ? 'Já tenho conta' : 'Ainda não tenho conta'}
            </button>
          </section>
        ))}

        {stage === 'business' && order && (
          <section>
            <h1>Fala-nos<br />do teu negócio.</h1>
            {order.state === 'cancelled' && <p className="notice bad">O teu espaço anterior foi removido. Para voltar a ter um site, subscreve abaixo.</p>}
            {plan === 'trialing' && <p className="notice">Teste gratuito: faltam <strong>{days}</strong> dia(s).</p>}
            <form onSubmit={e => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const email = String(data.get('email')).trim();
              run(async () => {
                await call('install', {
                  order: order.id, account: '', costsApproved: true, slug: slug.trim().toLowerCase(),
                  business: {
                    name: data.get('name'), email, password: data.get('password'), phone: data.get('phone'), address: '',
                    contactEmail: email, primaryColor: data.get('primaryColor'), secondaryColor: '#20271f',
                  },
                });
                say('');
                await refresh();
              });
            }}>
              <label>Nome do negócio<input name="name" required maxLength={100} /></label>
              {slugState.domain && (
                <label>Endereço do teu site (3 a 40 letras minúsculas, números ou hífenes)
                  <input value={slug} onChange={e => setSlug(e.target.value)} required minLength={3} maxLength={40} pattern="[a-z0-9]+(-[a-z0-9]+)*" autoComplete="off" aria-describedby="slug-help" />
                  <span id="slug-help" className={slugState.state === 'taken' || slugState.state === 'invalid' ? 'hint bad' : 'hint'}>
                    {slug.trim() ? `${slug.trim().toLowerCase()}.${slugState.domain}` : `o-teu-nome.${slugState.domain}`}
                    {slugState.state === 'checking' && ' · a verificar…'}
                    {slugState.state === 'ok' && ' · disponível ✓'}
                    {slugState.state === 'taken' && ' · já está em uso'}
                    {slugState.state === 'invalid' && ' · endereço não permitido'}
                  </span>
                </label>
              )}
              <label>Email do administrador<input name="email" type="email" required maxLength={254} autoComplete="off" /></label>
              <label>Palavra-passe do administrador (mínimo 12 caracteres)<input name="password" type="password" required minLength={12} maxLength={256} autoComplete="new-password" /></label>
              <label>Telefone de contacto<input name="phone" maxLength={50} /></label>
              <label>Cor principal<input name="primaryColor" type="color" defaultValue="#ed8735" /></label>
              <label className="check"><input type="checkbox" required /> Confirmo os dados e quero criar o meu site.</label>
              <button disabled={busy || (!!slugState.domain && slugState.state !== 'ok')}>Criar o meu site</button>
            </form>
            {canSubscribe && order.state === 'cancelled' && <button disabled={busy} onClick={() => run(() => subscribe(order.id))}>Subscrever</button>}
          </section>
        )}

        {stage === 'progress' && order && (
          <section>
            <h1>A preparar<br />o teu site.</h1>
            <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent(order.step)}>
              <span style={{ width: progressPercent(order.step) + '%' }} />
            </div>
            <p aria-live="polite">{order.state === 'queued' ? 'Estás na fila. Vai começar em instantes.' : stepLabel(order.step)}</p>
            {order.state === 'blocked' ? (
              <>
                <p className="notice bad">{order.message || 'A instalação parou. Os teus dados estão guardados.'}</p>
                <button disabled={busy} onClick={() => run(async () => { await call('jobs/action', { order: order.id, action: 'resume' }); await refresh(); })}>Tentar novamente</button>
              </>
            ) : <p className="hint">Demora normalmente 2 a 3 minutos. Podes deixar esta página aberta.</p>}
          </section>
        )}

        {stage === 'ready' && order && (
          <section>
            <h1>O teu site<br />está no ar.</h1>
            <div className="links">
              {customerLink && <a href={customerLink} target="_blank" rel="noreferrer">Ver a página de encomendas ↗</a>}
              {safeSiteLink(order.addresses?.management) && <a href={safeSiteLink(order.addresses.management)} target="_blank" rel="noreferrer">Abrir a gestão ↗</a>}
            </div>
            {qr && <figure className="qr"><img src={qr} width={220} height={220} alt="Código QR da página de encomendas" /><figcaption>Imprime este código para os teus clientes encomendarem.</figcaption></figure>}
            <h2>A tua subscrição</h2>
            {plan === 'trialing' && <p className="notice">Teste gratuito: faltam <strong>{days}</strong> dia(s). Subscreve para manter o site depois disso.</p>}
            {plan === 'active' && <p className="notice ok">Subscrição ativa{order.cancelAtPeriodEnd ? ' — termina no fim do período pago' : ''}.</p>}
            {plan === 'past_due' && <p className="notice bad">Não conseguimos cobrar o último pagamento. Atualiza o cartão para manter o site.</p>}
            {plan === 'canceled' && <p className="notice bad">A subscrição foi cancelada. O site funciona até ao fim do período pago.</p>}
            {plan === 'suspended' && <p className="notice bad">O site está suspenso. Subscreve para o reativar de imediato; os dados ficam guardados durante algum tempo.</p>}
            {canSubscribe && <button disabled={busy} onClick={() => run(() => subscribe(order.id))}>Subscrever</button>}
            {(plan === 'active' || plan === 'past_due') && <button disabled={busy} onClick={() => run(async () => {
              const { url } = await call<{ url: string }>('billing/portal', { order: order.id });
              const target = stripeUrl(url, 'billing.stripe.com');
              if (!target) throw new Error('Destino de pagamento inválido.');
              window.location.assign(target);
            })}>Gerir pagamento</button>}
          </section>
        )}

        {demo.management && stage !== 'progress' && stage !== 'loading' && !sentTo && (
          <section className="demo-offer" aria-label="Demonstração">
            <h2>Quer ver como funciona primeiro?</h2>
            <p>Experimente uma demonstração com dados fictícios. Não precisa de conta. Não tem pagamentos nem emails reais, e os dados repõem-se todos os dias.</p>
            <div className="links">
              <a href={`${demo.management}/demo`} target="_blank" rel="noreferrer">Experimentar a gestão ↗</a>
              {demo.customer && <a href={demo.customer} target="_blank" rel="noreferrer">Ver a página de encomendas ↗</a>}
            </div>
          </section>
        )}

        <p className={failed ? 'status bad' : 'status'} role="status" aria-live="polite">{message}</p>
        <footer>
          {stage !== 'account' && stage !== 'loading' && <button className="link" onClick={() => run(async () => { await call('auth/logout', {}); setOrder(undefined); setStage('account'); say('Sessão terminada.'); })}>Terminar sessão</button>}
          <a className="link" href="/avancado">Opções avançadas</a>
        </footer>
      </article>
    </main>
  );

  async function subscribe(orderId: string) {
    const { url } = await call<{ url: string }>('billing/checkout', { order: orderId });
    const target = stripeUrl(url, 'checkout.stripe.com');
    if (!target) throw new Error('Destino de pagamento inválido.');
    window.location.assign(target);
  }
}

// Kept only in memory so "reenviar email" can repeat the sign-up; never stored or logged.
const pendingPassword = { current: '' };
