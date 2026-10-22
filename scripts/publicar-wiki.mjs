const API_URL = 'https://pt.wikipedia.org/w/api.php';

const JS_PAGE_TITLE =
  'Usuário:Little Sunshine/Scripts/AssistenteEncerramentos.js';

const CSS_PAGE_TITLE =
  'Usuário:Little Sunshine/Scripts/AssistenteEncerramentos.css';

const VERSION_PAGE_TITLE =
  'Usuário:Little Sunshine/Scripts/AssistenteEncerramentos/Versão';

const JS_SRC_PATH =
  process.env.JS_SRC || 'AssistEnc/AssistenteEncerramentos.js';
const JS_MIN_PATH =
  process.env.JS_MIN || 'AssistEnc/AssistenteEncerramentos.min.js';
const CSS_MIN_PATH =
  process.env.CSS_MIN || 'AssistEnc/AssistenteEncerramentos.min.css';

const publishJs = process.env.WIKI_PUBLISH_JS === 'true';
const publishCss = process.env.WIKI_PUBLISH_CSS === 'true';

if (!publishJs && !publishCss) {
  throw new Error(
    'Nada a publicar: WIKI_PUBLISH_JS e WIKI_PUBLISH_CSS não estão ' +
    'definidos como "true".'
  );
}

const username = process.env.WIKI_USERNAME;
const password = process.env.WIKI_BOT_PASSWORD;

if (!username || !password) {
  throw new Error(
    'Configure WIKI_USERNAME e WIKI_BOT_PASSWORD nos GitHub Secrets.'
  );
}

function buildSummary(raw, variableName, sourceDescription) {
  const base = raw?.replace(/\s+/g, ' ').trim();

  if (!base) {
    throw new Error(
      `${variableName} está vazio. O sumário deve vir do último ` +
      `commit de ${sourceDescription}.`
    );
  }

  return `${base.slice(0, 470)} (via GitHub)`;
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
    /^[ \t]*var[ \t]+version[ \t]*=[ \t]*(?:(['"`])([^\r\n]*?)\1|([\w.+-]+))[ \t]*[;,]?/mi
  );

  if (!match) {
    throw new Error(
      `A variável "var version" não foi encontrada em ${JS_SRC_PATH}.`
    );
  }

  const version = (match[2] ?? match[3] ?? '').trim();

  if (!version) {
    throw new Error(
      `A variável "var version" em ${JS_SRC_PATH} está vazia.`
    );
  }

  return version;
}

let jsContent;
let jsSummary;
let version;

if (publishJs) {
  jsSummary = buildSummary(
    process.env.WIKI_SUMMARY_JS,
    'WIKI_SUMMARY_JS',
    JS_SRC_PATH
  );

  jsContent = await readFileOrThrow(
    JS_MIN_PATH,
    'o arquivo JavaScript minificado'
  );

  if (!jsContent.startsWith('//<nowiki>\n')) {
    throw new Error('O cabeçalho //<nowiki> não foi encontrado.');
  }

  if (!jsContent.trimEnd().endsWith('//</nowiki>')) {
    throw new Error('O fechamento //</nowiki> não foi encontrado.');
  }

  const sourceContent = await readFileOrThrow(
    JS_SRC_PATH,
    'o arquivo JavaScript original'
  );

  version = extractVersion(sourceContent);

  console.log(`Versão identificada em ${JS_SRC_PATH}: ${version}`);
}

let cssContent;
let cssSummary;

if (publishCss) {
  const cssSrcPath =
    process.env.CSS_SRC || 'AssistEnc/AssistenteEncerramentos.css';

  cssSummary = buildSummary(
    process.env.WIKI_SUMMARY_CSS,
    'WIKI_SUMMARY_CSS',
    cssSrcPath
  );

  cssContent = await readFileOrThrow(
    CSS_MIN_PATH,
    'o arquivo CSS minificado'
  );

  if (!cssContent.trim()) {
    throw new Error(`O arquivo CSS minificado (${CSS_MIN_PATH}) está vazio.`);
  }
}

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

function logEdit(label, edit) {
  console.log(`${label}: ${edit.title}`);
  console.log(
    edit.nochange
      ? 'Sem alterações em relação à revisão anterior.'
      : `Nova revisão: ${edit.newrevid}`
  );
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

if (publishCss) {
  const cssEdit = await publishPage(
    CSS_PAGE_TITLE,
    cssContent,
    cssSummary,
    csrfToken
  );

  logEdit('Página de CSS publicada', cssEdit);
}

if (publishJs) {
  const scriptEdit = await publishPage(
    JS_PAGE_TITLE,
    jsContent,
    jsSummary,
    csrfToken
  );

  logEdit('Página publicada', scriptEdit);

  let versionEdit;

  try {
    versionEdit = await publishPage(
      VERSION_PAGE_TITLE,
      version,
      jsSummary,
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
}
