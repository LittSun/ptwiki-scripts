
const API_URL = 'https://pt.wikipedia.org/w/api.php';

const PAGE_TITLE =
  'Usuário:Little Sunshine/Scripts/AssistenteEncerramentos.js';

const EDIT_SUMMARY =
  'Atualização automática a partir do repositório GitHub';

const FILE_PATH = 'AssistenteEncerramentos.min.js';

const username = process.env.WIKI_USERNAME;
const password = process.env.WIKI_BOT_PASSWORD;

if (!username || !password) {
  throw new Error(
    'Configure WIKI_USERNAME e WIKI_BOT_PASSWORD nos GitHub Secrets.'
  );
}

const fs = await import('node:fs/promises');
const content = await fs.readFile(FILE_PATH, 'utf8');

if (!content.startsWith('//<nowiki>\n')) {
  throw new Error('O cabeçalho //<nowiki> não foi encontrado.');
}

if (!content.trimEnd().endsWith('// </nowiki>')) {
  throw new Error('O fechamento // </nowiki> não foi encontrado.');
}

// Mantém os cookies recebidos durante a sessão autenticada.
const cookies = new Map();

function saveCookies(response) {
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(';', 1)[0];
    const separator = pair.indexOf('=');

    if (separator > 0) {
      cookies.set(
        pair.slice(0, separator),
        pair.slice(separator + 1)
      );
    }
  }
}

async function api(params, method = 'GET') {
  const headers = {
    'User-Agent':
      'AssistenteEncerramentos-GitHubActions/1.0 (pt.wikipedia.org)'
  };

  if (cookies.size > 0) {
    headers.Cookie = [...cookies]
      .map(([key, value]) => `${key}=${value}`)
      .join('; ');
  }

  const options = { method, headers };
  let url = API_URL;

  if (method === 'GET') {
    url += `?${new URLSearchParams(params)}`;
  } else {
    headers['Content-Type'] =
      'application/x-www-form-urlencoded';

    options.body = new URLSearchParams(params);
  }

  const response = await fetch(url, options);
  saveCookies(response);

  if (!response.ok) {
    throw new Error(`Erro HTTP ${response.status} na API da wiki.`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(
      `Erro da API (${data.error.code}): ${data.error.info}`
    );
  }

  return data;
}

const loginTokenResponse = await api({
  action: 'query',
  meta: 'tokens',
  type: 'login',
  format: 'json'
});

const loginToken =
  loginTokenResponse.query.tokens.logintoken;

const loginResponse = await api({
  action: 'login',
  lgname: username,
  lgpassword: password,
  lgtoken: loginToken,
  format: 'json'
}, 'POST');

if (loginResponse.login?.result !== 'Success') {
  throw new Error(
    `Falha na autenticação: ${loginResponse.login?.result}`
  );
}

console.log('Autenticação na Wikipédia concluída.');

const csrfResponse = await api({
  action: 'query',
  meta: 'tokens',
  format: 'json'
});

const csrfToken = csrfResponse.query.tokens.csrftoken;

const editResponse = await api({
  action: 'edit',
  title: PAGE_TITLE,
  text: content,
  summary: EDIT_SUMMARY,
  token: csrfToken,
  assert: 'user',
  format: 'json'
}, 'POST');

if (editResponse.edit?.result !== 'Success') {
  throw new Error('A API não confirmou a edição.');
}

console.log(`Página publicada: ${editResponse.edit.title}`);
console.log(`Nova revisão: ${editResponse.edit.newrevid}`);
