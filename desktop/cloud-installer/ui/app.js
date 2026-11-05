'use strict';

let packagePath = '';
let verifiedLicense;
let installing = false;
const fields = document.querySelector('#install-fields');
const accountsSelect = document.querySelector('#accounts');

function updateInstallAccess() {
  fields.disabled = installing || !packagePath || verifiedLicense?.account !== accountsSelect.value;
}

async function run(form, status, request, completed, pending = 'A verificar…') {
  const button = form.querySelector('button');
  button.disabled = true;
  status.textContent = pending;
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
  const directory = document.querySelector('#directory').value.trim();
  packagePath = '';
  updateInstallAccess();
  run(event.currentTarget, status, { action: 'verify-package', packageDirectory: directory }, result => {
    if (directory !== document.querySelector('#directory').value.trim()) return;
    packagePath = result.status === 'release' ? directory : '';
    status.textContent = `Pacote ${result.version} verificado. ${Object.keys(result.files).length} ficheiros conferidos.` +
      (packagePath ? '' : ' Este pacote é uma prévia e não pode ser publicado pelo assistente.');
    updateInstallAccess();
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
  invalidateLicense();
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
      if (account !== accountsSelect.value || document.querySelector('#license-file').files[0] !== file) return;
      verifiedLicense = { account, license };
      status.textContent = 'Licença verificada para a conta selecionada.';
      updateInstallAccess();
    });
  } catch {
    status.textContent = 'Não foi possível ler o ficheiro de licença.';
  }
});

function invalidateLicense() {
  verifiedLicense = undefined;
  document.querySelector('#license-result').textContent = '';
  updateInstallAccess();
}

accountsSelect.addEventListener('change', invalidateLicense);
document.querySelector('#license-file').addEventListener('change', invalidateLicense);
document.querySelector('#directory').addEventListener('input', () => {
  packagePath = '';
  updateInstallAccess();
});

document.querySelector('#install').addEventListener('submit', async event => {
  event.preventDefault();
  if (fields.disabled) return;
  const form = event.currentTarget;
  const business = Object.fromEntries(new FormData(form));
  const tokenField = document.querySelector('#deploy-token');
  const token = tokenField.value;
  tokenField.value = '';
  document.querySelector('#admin-password').value = '';
  const addresses = document.querySelector('#addresses');
  addresses.hidden = true;
  installing = true;
  const request = { action: 'install', token, business, packageDirectory: packagePath,
    account: verifiedLicense.account, license: verifiedLicense.license,
    costsApproved: document.querySelector('#costs-approved').checked,
    imagesApproved: document.querySelector('#images-approved').checked };
  updateInstallAccess();
  const status = document.querySelector('#install-result');
  try {
    await run(form, status, request, result => {
      document.querySelector('#customer-url').value = result.customer;
      document.querySelector('#management-url').value = result.management;
      addresses.hidden = false;
      status.textContent = 'Publicação concluída. Os dois sites foram verificados.';
    }, 'A preparar a base de dados, publicar os Workers e verificar os sites…');
  } finally {
    installing = false;
    updateInstallAccess();
  }
});
