'use strict';

async function run(form, status, request, completed) {
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = 'A verificar…';
  try {
    const response = await window.__TAURI__.core.invoke('engine', { request });
    if (response.error) throw new Error(response.error);
    completed(response.result);
  } catch (error) {
    status.textContent = typeof error?.message === 'string' ? error.message : 'Não foi possível concluir a operação.';
  } finally {
    button.disabled = false;
  }
}

document.querySelector('#package').addEventListener('submit', event => {
  event.preventDefault();
  const status = document.querySelector('#package-result');
  run(event.currentTarget, status, { action: 'verify-package', packageDirectory: document.querySelector('#directory').value.trim() }, result => {
    status.textContent = `Pacote ${result.version} verificado. ${Object.keys(result.files).length} ficheiros conferidos.`;
  });
});

document.querySelector('#connect').addEventListener('submit', event => {
  event.preventDefault();
  const input = document.querySelector('#token');
  const token = input.value;
  input.value = '';
  const select = document.querySelector('#accounts');
  select.replaceChildren();
  select.disabled = true;
  const status = document.querySelector('#connection-result');
  run(event.currentTarget, status, { action: 'accounts', token }, accounts => {
    for (const account of accounts ?? []) {
      const option = document.createElement('option');
      option.value = account.id;
      option.textContent = account.name;
      select.append(option);
    }
    select.disabled = !select.options.length;
    status.textContent = select.options.length ? 'Escolha a conta onde pretende alojar a aplicação.' : 'O token não permite consultar contas. Verifique as permissões.';
  });
});

document.querySelector('#license').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector('#license-result');
  const account = document.querySelector('#accounts').value;
  const file = document.querySelector('#license-file').files[0];
  if (!account || !file || file.size > 8192) {
    status.textContent = 'Escolha a conta Cloudflare e um ficheiro de licença válido.';
    return;
  }
  try {
    const license = JSON.parse(await file.text());
    await run(form, status, { action: 'verify-license', account, license }, () => {
      status.textContent = 'Licença verificada para a conta selecionada.';
    });
  } catch {
    status.textContent = 'Não foi possível ler o ficheiro de licença.';
  }
});

document.querySelector('#accounts').addEventListener('change', () => {
  document.querySelector('#license-result').textContent = '';
});
