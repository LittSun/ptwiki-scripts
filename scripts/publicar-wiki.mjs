const API_URL = 'https://pt.wikipedia.org/w/api.php';

const PAGE_TITLE =
  'Usuário:Little Sunshine/Scripts/AssistenteEncerramentos.js';

const VERSION_PAGE_TITLE =
  'Usuário:Little Sunshine/Scripts/AssistenteEncerramentos/Versão';

const SUMMARY_BASE = process.env.WIKI_EDIT_SUMMARY?.trim();

const EDIT_SUMMARY = SUMMARY_BASE
  ? `${SUMMARY_BASE} (via GitHub)`
  : 'Atualização automática a partir do repositório GitHub';

const FILE_PATH = 'AssistenteEncerramentos.min.js';

const SOURCE_PATH = 'AssistenteEncerramentos.js';

const username = process.env.WIKI_USERNAME;
const password = process.env.WIKI_BOT_PASSWORD;

if (!username || !password) {
  throw new Error(
    'Configure WIKI_USERNAME e WIKI_BOT_PASSWORD nos GitHub Secrets.'
  );
}

const fs = await import('node:fs/promises');

async function readFileOrThrow(path, description) {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (error) {
    throw new Error(
      `Não foi possível ler ${description} (${path}): ${error.message}`
    );
  }
}

function extractVersion(source) {
  const match = source.match(
    /^[ \t]*var[ \t]+version[ \t]*=[ \t]*(?:(['"`])([^\r\n]*?)\1|([\w.+-]+))[ \t]*[;,]?/m
  );

  if (!match) {
    throw new Error(
      `A variável "var version" não foi encontrada em ${SOURCE_PATH}.`
    );
  }

  const version = (match[2] ?? match[3] ?? '').trim();

  if (!version) {
    throw new Error(
      `A variável "var version" em ${SOURCE_PATH} está vazia.`
    );
  }

  return version;
}

const content = await readFileOrThrow(
  FILE_PATH,
  'o arquivo minificado'
);

if (!content.startsWith('//<nowiki>\n')) {
  throw new Error('O cabeçalho //<nowiki> não foi encontrado.');
}

if (!content.trimEnd().endsWith('//</nowiki>')) {
  throw new Error('O fechamento //</nowiki> não foi encontrado.');
}

const sourceContent = await readFileOrThrow(
  SOURCE_PATH,
  'o arquivo-fonte original'
);

const version = extractVersion(sourceContent);

console.log(`Versão identificada em ${SOURCE_PATH}: ${version}`);

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
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const headers = {
      'User-Agent':
        'AssistenteEncerramentos-GitHubActions/1.0 (https://github.com/LittSun/ptwiki-scripts)'
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

    let response;

    try {
      response = await fetch(url, options);
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      const delay = Math.min(5000 * 2 ** (attempt - 1), 60000);
      console.log(
        `Falha de rede. Nova tentativa em ${delay / 1000}s (${attempt}/${maxAttempts}).`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    saveCookies(response);

    if (response.status === 429 || response.status === 503) {
      const retryAfter = response.headers.get('Retry-After');
      let delay;

      if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
        delay = Number(retryAfter) * 1000;
      } else if (retryAfter) {
        const retryDate = Date.parse(retryAfter);
        delay = Number.isNaN(retryDate)
          ? 5000 * 2 ** (attempt - 1)
          : Math.max(0, retryDate - Date.now());
      } else {
        delay = 5000 * 2 ** (attempt - 1);
      }

      if (attempt === maxAttempts) {
        const body = (await response.text()).slice(0, 500);

        throw new Error(
          `API indisponível após ${maxAttempts} tentativas. ` +
          `HTTP ${response.status}. Resposta: ${body}`
        );
      }

      console.log(
        `HTTP ${response.status}. Aguardando ${Math.ceil(delay / 1000)}s antes de tentar novamente (${attempt}/${maxAttempts}).`
      );

      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }

    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);

      throw new Error(
        `Erro HTTP ${response.status} na API da wiki: ${body}`
      );
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(
        `Erro da API (${data.error.code}): ${data.error.info}`
      );
    }

    return data;
  }

  throw new Error('Número máximo de tentativas excedido.');
}


async function publishPage(title, text, summary, csrfToken) {
  const editResponse = await api({
    action: 'edit',
    title,
    text,
    summary,
    token: csrfToken,
    assert: 'user',
    format: 'json'
  }, 'POST');

  if (editResponse.edit?.result !== 'Success') {
    throw new Error(
      `A API não confirmou a edição de "${title}".`
    );
  }

  return editResponse.edit;
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

const scriptEdit = await publishPage(
  PAGE_TITLE,
  content,
  EDIT_SUMMARY,
  csrfToken
);

console.log(`Página publicada: ${scriptEdit.title}`);
console.log(
  scriptEdit.nochange
    ? 'Sem alterações em relação à revisão anterior.'
    : `Nova revisão: ${scriptEdit.newrevid}`
);

let versionEdit;

try {
  versionEdit = await publishPage(
    VERSION_PAGE_TITLE,
    version,
    `Atualizando versão para ${version} (via GitHub)`,
    csrfToken
  );
} catch (error) {
  throw new Error(
    `O script principal foi publicado, mas a página de versão ` +
    `(${VERSION_PAGE_TITLE}) não pôde ser atualizada: ${error.message}`
  );
}

console.log(`Página de versão publicada: ${versionEdit.title}`);
console.log(
  versionEdit.nochange
    ? `Versão ${version} já estava publicada (sem alterações).`
    : `Versão ${version} publicada. Nova revisão: ${versionEdit.newrevid}`
);
