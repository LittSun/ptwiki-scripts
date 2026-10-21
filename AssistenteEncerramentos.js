//<nowiki>
/**
 * AssistenteEncerramentos
 *
 * Adiciona botão "encerrar" nas seções de páginas de pedidos da Wikipédia
 * lusófona, permitindo encerrar notificações e pedidos via diálogo.
 *
 * Esta ferramenta é muito grande para a Wikipédia e portanto está minificada. A atualização de seu código no GitHub atualiza automaticamente o código do script de usuário da Wikipédia. Favor não editar código minificado diretamente diretamente.
 *
 * Configuração opcional (defina ANTES de carregar o script ou pelo console de seu navegador):
 *   window.assistEnc = { debug: true, dryRun: true };
 *   - debug:  liga logs detalhados no console (padrão: false).
 *   - dryRun: nenhuma edição real é enviada; a transformação e o resumo
 *             são apenas registrados no console (padrão: false).
 *   window.assistEncBotoes
 *
 * @author   [[User:Little Sunshine]]
 * @license  MIT
 * @link     [[User:Little Sunshine/Scripts/AssistenteEncerramentos]]
 */
(function() {
	'use strict';

	// ---------------------------------------------------------------------------
	// Configuração e constantes
	// ---------------------------------------------------------------------------

	/** @type {string} */
	var PAGE_NAME = mw.config.get('wgPageName').replace(/_/g, ' ');

	/** @type {boolean} */
	var IS_MOBILE = mw.config.get('skin') === 'minerva';

	/** @type {string} */
	var PAGE_TITLE = mw.config.get('wgTitle');

	/** @type {number} */
	var NS = mw.config.get('wgNamespaceNumber');

	/** @type {string} */
	var USER_NAME = mw.config.get('wgUserName');

	/** @type {string} */
	var ADVERT = ' com [[User:Little Sunshine/AssistEnc|script]] #AssistEnc';

	/**
	 * Mapa de subpáginas válidas para o tipo de pedido correspondente.
	 * @type {Object.<string, 'notificação'|'pedido'>}
	 */
	var VALID_PAGES = {
		'Pedidos/Notificação de incidentes': 'notificação',
		'Pedidos/Notificações de vandalismo': 'notificação',
		'Pedidos/Restauro': 'pedido',
		'Pedidos/Desproteção': 'pedido',
		'Pedidos/Histórico': 'pedido',
		'Pedidos/Proteção': 'pedido',
		'Pedidos/Páginas protegidas': 'pedido',
		'Pedidos/Outros': 'pedido',
		'Pedidos/Revisão de nomes de usuário': 'notificação',
		'Pedidos/Ocultação': 'pedido'
	};

	/**
	 * Retorna o tipo de pedido de uma subpágina suportada (ou null).
	 * Usa hasOwnProperty para não aceitar chaves herdadas (ex.: "constructor").
	 *
	 * @param  {string} title  wgTitle.
	 * @return {'notificação'|'pedido'|null}
	 */
	function getRequestType(title) {
		return Object.prototype.hasOwnProperty.call(VALID_PAGES, title) ?
			VALID_PAGES[title] :
			null;
	}

	// ---------------------------------------------------------------------------
	// Configuração de depuração (lida a cada uso, nunca sobrescreve o que o
	// usuário já definiu). Pode ser alterada no console em tempo de execução.
	// ---------------------------------------------------------------------------
	if (typeof window.assistEnc !== 'object' || window.assistEnc === null) {
		window.assistEnc = {};
	}
	/** Impede edições reais quando true — apenas para testes. */
	if (typeof window.assistEnc.dryRun === 'undefined') {
		window.assistEnc.dryRun = false;
	}
	/** Liga logs detalhados no console (desligado por padrão em produção). */
	if (typeof window.assistEnc.debug === 'undefined') {
		window.assistEnc.debug = false;
	}

	// Sai cedo se não estiver numa página suportada
	/** @type {'notificação'|'pedido'|null} */
	var REQUEST_TYPE = NS === 4 ? getRequestType(PAGE_TITLE) : null;

	if (!REQUEST_TYPE) {
		return;
	}

	// Garante inicialização única (o script pode ser carregado mais de uma vez)
	if (window.assistEnc._loaded) {
		return;
	}
	window.assistEnc._loaded = true;

	// ---------------------------------------------------------------------------
	// API
	// ---------------------------------------------------------------------------

	/** @type {mw.Api} */
	var api;

	// ---------------------------------------------------------------------------
	// Utilitários: log, erros e notificações
	// ---------------------------------------------------------------------------

	/**
	 * @return {boolean} true se o modo de simulação estiver ativo.
	 */
	function isDryRun() {
		return !!(window.assistEnc && window.assistEnc.dryRun);
	}

	/**
	 * Loga argumentos no console apenas quando debug está ativo.
	 * @param {...*} args
	 */
	function log() {
		if (window.assistEnc && window.assistEnc.debug) {
			console.log.apply(console, arguments); // eslint-disable-line no-console
		}
	}

	/**
	 * @typedef  {Object} AssistError
	 * @property {boolean} assistEnc     Marca de erro tratado pelo script.
	 * @property {string}  code          Código curto (ex.: 'nosection', 'editconflict').
	 * @property {string}  message       Mensagem em português para o usuário.
	 * @property {boolean} [uncertain]   true se não se sabe se a operação foi aplicada.
	 * @property {*}       [detail]      Dados técnicos (só vão para o console).
	 */

	/**
	 * Cria um erro tratado.
	 *
	 * @param  {string}  code
	 * @param  {string}  message
	 * @param  {*}       [detail]
	 * @param  {boolean} [uncertain]
	 * @return {AssistError}
	 */
	function makeError(code, message, detail, uncertain) {
		return {
			assistEnc: true,
			code: code,
			message: message,
			detail: detail,
			uncertain: !!uncertain
		};
	}

	/**
	 * Retorna uma promise rejeitada com um erro tratado.
	 *
	 * @param  {string}  code
	 * @param  {string}  message
	 * @param  {*}       [detail]
	 * @param  {boolean} [uncertain]
	 * @return {jQuery.Promise}
	 */
	function failWith(code, message, detail, uncertain) {
		return $.Deferred().reject(makeError(code, message, detail, uncertain)).promise();
	}

	/**
	 * Converte qualquer valor de rejeição (erro tratado, código do mw.Api,
	 * exceção JavaScript) em um AssistError.
	 *
	 * @param  {*} err
	 * @param  {*} [data]  Segundo argumento de rejeição do mw.Api.
	 * @return {AssistError}
	 */
	function normalizeError(err, data) {
		if (err && err.assistEnc) {
			return err;
		}
		if (typeof err === 'string') {
			return describeApiError(err, data);
		}
		if (err instanceof Error || (err && typeof err === 'object' && typeof err.message === 'string' && typeof err.name === 'string')) {
			return makeError('internal', 'Erro interno do script: ' + err.message, err);
		}
		return makeError('unknown', 'Erro desconhecido.', err);
	}

	/**
	 * Traduz um código de erro da API em mensagem compreensível.
	 *
	 * @param  {string} code
	 * @param  {*}      [data]  Resposta/objeto de erro do mw.Api.
	 * @return {AssistError}
	 */
	function describeApiError(code, data) {
		var info = data && data.error && data.error.info ? data.error.info : '';
		var msg;
		var uncertain = false;
		switch (code) {
			case 'timeout':
			case 'http':
				msg = 'Falha de conexão com o servidor. Verifique sua conexão e tente novamente.';
				uncertain = true;
				break;
			case 'editconflict':
				msg = 'Conflito de edição: a página foi alterada por outra pessoa. Revise a antevisão e tente novamente.';
				break;
			case 'assertuserfailed':
			case 'assertnameduserfailed':
				msg = 'Você não está autenticado(a). Entre na sua conta e tente novamente.';
				break;
			case 'badtoken':
				msg = 'A sessão de edição expirou. Recarregue a página e tente novamente.';
				break;
			case 'blocked':
			case 'autoblocked':
				msg = 'Sua conta está bloqueada e não pode editar.';
				break;
			case 'protectedpage':
			case 'permissiondenied':
			case 'cantcreate':
				msg = 'Você não tem permissão para editar esta página.';
				break;
			case 'ratelimited':
				msg = 'Limite de edições atingido. Aguarde alguns instantes e tente novamente.';
				break;
			case 'readonly':
				msg = 'A Wikipédia está temporariamente em modo somente leitura.';
				break;
			case 'missingtitle':
			case 'nocreate-missing':
				msg = 'A página não existe mais.';
				break;
			case 'nosuchsection':
			case 'rvnosuchsection':
				msg = 'A seção não existe mais. Recarregue a página e tente novamente.';
				break;
			default:
				msg = 'Erro da API (' + code + ')' + (info ? ': ' + info : '.');
		}
		return makeError(code, msg, data, uncertain);
	}

	/**
	 * Registra o erro no console (modo debug) e notifica o usuário uma única vez.
	 *
	 * @param  {*}      err
	 * @param  {string} [context]  Operação em curso (para o log).
	 * @param  {*}      [data]
	 * @return {AssistError}
	 */
	function reportError(err, context, data) {
		var e = normalizeError(err, data);
		mw.notify(e.message, {
			type: 'error',
			tag: 'assistEnc'
		});
		log('[AssistEnc] ERRO' + (context ? ' (' + context + ')' : '') + ':', e.code, e.message, e.detail || '');
		return e;
	}

	/**
	 * Exibe uma notificação informativa (substitui a anterior da mesma tag).
	 *
	 * @param {string} msg
	 * @param {'info'|'warn'|'success'} [type]
	 */
	function notify(msg, type) {
		mw.notify(msg, {
			type: type || 'info',
			tag: 'assistEnc'
		});
	}

	// ---------------------------------------------------------------------------
	// Camada de dados — MediaWiki API
	// ---------------------------------------------------------------------------

	/**
	 * GET na API convertendo rejeições em AssistError.
	 *
	 * @param  {Object} params
	 * @param  {string} what  Descrição da operação (para o log).
	 * @return {jQuery.Promise}
	 */
	function apiGet(params, what) {
		return api.get(params).then(null, function(code, data) {
			var e = normalizeError(code, data);
			log('[AssistEnc] Falha em', what + ':', e.code, e.detail || '');
			return $.Deferred().reject(e).promise();
		});
	}

	/**
	 * @typedef  {Object} SectionData
	 * @property {string} anchor
	 * @property {string} sectionIndex  Índice numérico (string) da seção.
	 * @property {string} wikitext      Wikitext da seção (inclui a linha do título).
	 * @property {number} revid         Revisão da qual o wikitext foi lido.
	 * @property {string} fetchedAt     Timestamp do servidor no momento da leitura.
	 * @property {string} notificado
	 */

	/**
	 * Uma tentativa de ler a seção: resolve o índice pelo anchor e o wikitext
	 * pelo índice, confirmando que ambos vêm da MESMA revisão.
	 *
	 * @param  {string} anchor
	 * @return {jQuery.Promise.<SectionData>}
	 */
	function fetchSectionOnce(anchor) {
		return apiGet({
			action: 'parse',
			page: PAGE_NAME,
			prop: 'sections',
			formatversion: 2
		}, 'parse/sections').then(function(data) {
			var parse = data && data.parse;
			if (!parse || !Array.isArray(parse.sections)) {
				return failWith('malformed', 'Resposta inesperada da API ao listar as seções.', data);
			}

			var index = null;
			for (var i = 0; i < parse.sections.length; i++) {
				var s = parse.sections[i];
				// Seções transcluídas têm índice "T-n" e não são editáveis daqui
				if (s && s.anchor === anchor && /^\d+$/.test(String(s.index))) {
					index = String(s.index);
					break;
				}
			}
			if (index === null) {
				log('[AssistEnc] Seção não encontrada para anchor:', anchor);
				return failWith('nosection', 'Seção não encontrada. A página pode ter sido alterada; recarregue-a e tente novamente.');
			}

			return apiGet({
				action: 'query',
				prop: 'revisions',
				rvprop: 'ids|content|timestamp',
				rvslots: 'main',
				rvsection: index,
				titles: PAGE_NAME,
				curtimestamp: true,
				formatversion: 2
			}, 'query/revisions').then(function(q) {
				var page = q && q.query && q.query.pages && q.query.pages[0];
				if (!page || page.missing || page.invalid) {
					return failWith('missingtitle', 'A página não existe mais.', q);
				}
				var rev = page.revisions && page.revisions[0];
				var content = null;
				if (rev && rev.slots && rev.slots.main && typeof rev.slots.main.content === 'string') {
					content = rev.slots.main.content;
				} else if (rev && typeof rev.content === 'string') {
					content = rev.content;
				}
				if (content === null || !rev.revid) {
					return failWith('norevision', 'A API não retornou o conteúdo da seção.', q);
				}
				if (parse.revid && parse.revid !== rev.revid) {
					return failWith('raced', 'A página foi editada enquanto os dados eram obtidos.', {
						parse: parse.revid,
						query: rev.revid
					});
				}
				if (!/^==[^=]/.test(content)) {
					return failWith('badsection', 'O conteúdo obtido não corresponde a uma seção de nível 2. Recarregue a página e tente novamente.', content.slice(0, 80));
				}
				log('[AssistEnc] Wikitext obtido (' + content.length + ' chars, rev ' + rev.revid + ', seção ' + index + ')');

				return {
					anchor: anchor,
					sectionIndex: index,
					wikitext: content,
					revid: rev.revid,
					fetchedAt: q.curtimestamp || '',
					notificado: extractNotificado(content)
				};
			});
		});
	}

	/**
	 * Lê os dados da seção; repete UMA vez se a página mudou entre as duas
	 * requisições.
	 *
	 * @param  {string} anchor  ID do <h2> da seção.
	 * @return {jQuery.Promise.<SectionData>}  Rejeita com AssistError.
	 */
	function fetchSection(anchor) {
		return fetchSectionOnce(anchor).then(null, function(err) {
			if (err && err.code === 'raced') {
				log('[AssistEnc] Corrida entre parse e query; repetindo uma vez.');
				return fetchSectionOnce(anchor);
			}
			return $.Deferred().reject(err).promise();
		});
	}

	/**
	 * Valida a resposta de uma edição e a converte num resultado.
	 *
	 * @param  {*} data
	 * @return {{newrevid: number}|AssistError}
	 */
	function validateEditResponse(data) {
		var e = data && data.edit;
		if (!e) {
			return makeError('malformed', 'Resposta inesperada da API ao editar. Verifique o histórico da página antes de tentar novamente.', data, true);
		}
		if (e.result !== 'Success') {
			return makeError(e.code || 'editfailed', 'A edição não foi aceita' + (e.info ? ': ' + e.info : '.'), data);
		}
		if (e.nochange) {
			return makeError('nochange', 'A edição não alterou a página (nenhuma mudança detectada).', data);
		}
		if (!e.newrevid) {
			return makeError('norevid', 'A API não confirmou a nova revisão. Verifique o histórico da página antes de tentar novamente.', data, true);
		}
		return {
			newrevid: e.newrevid
		};
	}

	/**
	 * Envia a edição de uma seção via API (único ponto de escrita do script).
	 * Em dryRun NUNCA chega à API.
	 *
	 * @param  {SectionData} section
	 * @param  {string}      newWikitext
	 * @param  {string}      summary
	 * @return {jQuery.Promise.<{dryRun: boolean, newrevid: (number|undefined)}>}
	 */
	function editSection(section, newWikitext, summary) {
		if (isDryRun()) {
			log('[AssistEnc] dryRun ativo — edição NÃO enviada.\nResumo:', summary, '\nWikitext:\n', newWikitext);
			return $.Deferred().resolve({
				dryRun: true
			}).promise();
		}

		var params = {
			action: 'edit',
			title: PAGE_NAME,
			section: section.sectionIndex,
			text: newWikitext,
			summary: summary,
			minor: false,
			baserevid: section.revid,
			nocreate: true,
			assert: 'user',
			formatversion: 2
		};
		if (section.fetchedAt) {
			params.starttimestamp = section.fetchedAt;
		}

		return api.postWithEditToken(params).then(function(data) {
			var res = validateEditResponse(data);
			if (res.assistEnc) {
				log('[AssistEnc] Resposta de edição rejeitada:', res.code, data);
				return $.Deferred().reject(res).promise();
			}
			return {
				dryRun: false,
				newrevid: res.newrevid
			};
		}, function(code, data) {
			var e = normalizeError(code, data);
			log('[AssistEnc] Falha na edição:', e.code, e.detail || '');
			if (e.uncertain) {
				// Sem resposta do servidor: a edição pode ter sido aplicada
				e = makeError(e.code, 'A conexão falhou durante o envio e a edição pode ter sido aplicada. Verifique o histórico da página antes de tentar novamente.', e.detail, true);
			}
			return $.Deferred().reject(e).promise();
		});
	}

	/**
	 * Envia o wikitext para pré-visualização via API (expande subst: e ~~~~).
	 * A promise retornada tem um método abort() (descarta a requisição em curso).
	 *
	 * @param  {string} wikitext
	 * @return {jQuery.Promise.<string>}  HTML renderizado (rejeita com AssistError).
	 */
	function fetchPreview(wikitext) {
		var req = api.post({
			action: 'parse',
			title: PAGE_NAME,
			text: wikitext,
			contentmodel: 'wikitext',
			prop: 'text',
			disablelimitreport: true,
			disableeditsection: true,
			preview: true,
			pst: true,
			formatversion: 2
		});
		var p = req.then(function(data) {
			var t = data && data.parse && data.parse.text;
			var html = typeof t === 'string' ? t : (t && typeof t['*'] === 'string' ? t['*'] : null);
			if (html === null) {
				return failWith('malformed', 'A API não retornou a antevisão.', data);
			}
			return html;
		}, function(code, data) {
			var e = normalizeError(code, data);
			e = makeError(e.code, 'Erro ao gerar antevisão: ' + e.message, e.detail);
			return $.Deferred().reject(e).promise();
		});
		p.abort = function() {
			if (req && typeof req.abort === 'function') {
				req.abort();
			}
		};
		return p;
	}

	/**
	 * GET somente-leitura com aborto e mapeamento do resultado. Falhas viram
	 * AssistError; um aborto (abort()) rejeita com code 'http' e é ignorado
	 * pelos chamadores através de isAborted().
	 *
	 * @param  {Object}   params
	 * @param  {function(*): *} map  Converte a resposta bruta.
	 * @param  {string}   what
	 * @return {jQuery.Promise}  Com método abort().
	 */
	function apiLookup(params, map, what) {
		var req = api.get(params);
		var p = req.then(function(data) {
			try {
				return map(data);
			} catch (e) {
				return failWith('malformed', 'Resposta inesperada da API.', e);
			}
		}, function(code, data) {
			var e = normalizeError(code, data);
			log('[AssistEnc] Falha em', what + ':', e.code, e.detail || '');
			return $.Deferred().reject(e).promise();
		});
		p.abort = function() {
			if (req && typeof req.abort === 'function') {
				req.abort();
			}
		};
		return p;
	}

	/**
	 * Busca usuários(as) cujo nome começa por "prefix".
	 * @param  {string} prefix
	 * @return {jQuery.Promise.<string[]>}
	 */
	function searchUsers(prefix) {
		var q = String(prefix).replace(/_/g, ' ').trim();
		q = q.charAt(0).toUpperCase() + q.slice(1);
		return apiLookup({
			action: 'query',
			list: 'allusers',
			auprefix: q,
			aulimit: 8,
			formatversion: 2
		}, function(data) {
			return data.query.allusers.map(function(u) {
				return u.name;
			});
		}, 'allusers');
	}

	/**
	 * Busca páginas cujo título começa por "prefix" (o prefixo de espaço de
	 * nomes, se houver, é interpretado pela própria API).
	 * @param  {string} prefix
	 * @return {jQuery.Promise.<string[]>}
	 */
	function searchPages(prefix) {
		return apiLookup({
			action: 'query',
			list: 'prefixsearch',
			pssearch: String(prefix).trim(),
			pslimit: 8,
			psnamespace: 0,
			formatversion: 2
		}, function(data) {
			return data.query.prefixsearch.map(function(r) {
				return r.title;
			});
		}, 'prefixsearch');
	}

	/**
	 * Consulta o último bloqueio de um(a) usuário(a) no registro.
	 * Resolve com o resultado de parseLastBlock() ou null se nunca foi bloqueado(a).
	 *
	 * @param  {string} name
	 * @return {jQuery.Promise}
	 */
	function fetchLastBlock(name) {
		return apiLookup({
			action: 'query',
			list: 'logevents',
			letype: 'block',
			letitle: 'User:' + name,
			lelimit: 10,
			leprop: 'user|type|timestamp|details',
			formatversion: 2
		}, function(data) {
			return parseLastBlock(data.query.logevents, USER_NAME);
		}, 'logevents/block');
	}

	// ---------------------------------------------------------------------------
	// Pré-carregamento das seções (em segundo plano)
	// ---------------------------------------------------------------------------

	/** Atraso para não competir com o carregamento da página. */
	var PREFETCH_DELAY = 1200;
	/** Validade dos dados pré-carregados. */
	var PREFETCH_TTL = 120000;

	var sectionCache = null;
	var prefetching = null;

	/**
	 * Lê a página inteira UMA vez (lista de seções + wikitext) e recorta as
	 * seções de nível 2 localmente, pelos deslocamentos em bytes. Entradas que
	 * não puderem ser recortadas com segurança são omitidas — nesse caso a
	 * abertura usa a leitura normal. Nunca rejeita.
	 *
	 * @return {jQuery.Promise}
	 */
	function prefetchSections() {
		if (prefetching) {
			return prefetching;
		}
		if (typeof TextEncoder === 'undefined' || typeof TextDecoder === 'undefined') {
			return $.Deferred().resolve(null).promise();
		}
		prefetching = apiGet({
			action: 'parse',
			page: PAGE_NAME,
			prop: 'sections',
			formatversion: 2
		}, 'prefetch/sections').then(function(data) {
			var parse = data && data.parse;
			if (!parse || !Array.isArray(parse.sections)) {
				return null;
			}
			return apiGet({
				action: 'query',
				prop: 'revisions',
				rvprop: 'ids|content',
				rvslots: 'main',
				titles: PAGE_NAME,
				curtimestamp: true,
				formatversion: 2
			}, 'prefetch/content').then(function(q) {
				var page = q && q.query && q.query.pages && q.query.pages[0];
				var rev = page && !page.missing && page.revisions && page.revisions[0];
				var content = rev && rev.slots && rev.slots.main && rev.slots.main.content;
				if (typeof content !== 'string' || !rev.revid || (parse.revid && parse.revid !== rev.revid)) {
					return null;
				}
				var bytes = new TextEncoder().encode(content);
				var dec = new TextDecoder('utf-8');
				var secs = parse.sections;
				var out = {};
				for (var i = 0; i < secs.length; i++) {
					var s = secs[i];
					if (!s || String(s.level) !== '2' || typeof s.byteoffset !== 'number' || !/^\d+$/.test(String(s.index))) {
						continue;
					}
					var end = bytes.length;
					var ok = true;
					for (var j = i + 1; j < secs.length; j++) {
						var n = secs[j];
						if (!n || Number(n.level) > 2) {
							continue;
						}
						if (typeof n.byteoffset !== 'number') {
							ok = false; // título de nível 2 transcluído: limite desconhecido
						} else {
							end = n.byteoffset;
						}
						break;
					}
					if (!ok || end < s.byteoffset) {
						continue;
					}
					var text = dec.decode(bytes.subarray(s.byteoffset, end)).replace(/\s+$/, '');
					if (/^==[^=]/.test(text)) {
						out[s.anchor] = {
							index: String(s.index),
							text: text
						};
					}
				}
				return {
					at: Date.now(),
					revid: rev.revid,
					fetchedAt: q.curtimestamp || '',
					sections: out
				};
			});
		}).then(function(cache) {
			sectionCache = cache;
			prefetching = null;
			log('[AssistEnc] Pré-carregamento:', cache ? Object.keys(cache.sections).length + ' seções' : 'indisponível');
			return cache;
		}, function(err) {
			prefetching = null;
			log('[AssistEnc] Pré-carregamento falhou (a leitura normal será usada):', err && err.code);
			return null;
		});
		return prefetching;
	}

	/**
	 * Dados de uma seção já pré-carregados (e ainda válidos), ou null. Cada
	 * entrada é consumida: reabrir a mesma seção faz uma leitura nova.
	 *
	 * @param  {string} anchor
	 * @return {SectionData|null}
	 */
	function takeCachedSection(anchor) {
		var c = sectionCache;
		if (!c || Date.now() - c.at > PREFETCH_TTL || !Object.prototype.hasOwnProperty.call(c.sections, anchor)) {
			return null;
		}
		var e = c.sections[anchor];
		delete c.sections[anchor];
		try {
			return {
				anchor: anchor,
				sectionIndex: e.index,
				wikitext: e.text,
				revid: c.revid,
				fetchedAt: c.fetchedAt,
				notificado: extractNotificado(e.text)
			};
		} catch (err) {
			log('[AssistEnc] Seção pré-carregada descartada:', err);
			return null;
		}
	}

	// ---------------------------------------------------------------------------
	// Extração de dados
	// ---------------------------------------------------------------------------

	/**
	 * Extrai o nome do notificado a partir do título da seção (primeira linha
	 * do wikitext). Aceita "== {{U|Nome}} ==" (qualquer caixa em "U") e títulos
	 * simples; devolve '' se não houver título.
	 *
	 * @param  {string} wikitext
	 * @return {string}
	 */
	function extractNotificado(wikitext) {
		var text = typeof wikitext === 'string' ? wikitext : '';
		var firstLine = text.split('\n', 1)[0];
		var m = firstLine.match(/^==\s*(.+?)\s*==/) || text.match(/^==\s*(.+?)\s*==/m);
		if (!m) {
			return '';
		}
		var heading = m[1];
		var tpl = heading.match(/^\{\{\s*[Uu]\s*\|\s*([^{}|]+?)\s*\}\}$/);
		if (tpl) {
			return tpl[1];
		}
		return heading.replace(/\{\{\s*[Uu]\s*\|/, '').replace('}}', '');
	}

	/**
	 * Namespaces de usuário(a) do ptwiki (inclui "(a)", formas antigas e o
	 * alias em inglês), aplicados ao título JÁ decodificado (espaços no lugar de
	 * underscores).
	 * @type {RegExp}
	 */
	var USER_NS_REGEXP = /^(?:Usu[aá]rio\(a\)|Usu[aá]ria|Usu[aá]rio|User)(?:\s+Discuss[aã]o|\s+talk)?:(.+)$/i;

	/**
	 * Regex de assinatura: timestamp nos formatos usados no ptwiki
	 * ("HHhMMmin de D de mês de AAAA (UTC)" e variantes "HH:MM, D mês AAAA (UTC)").
	 * @type {RegExp}
	 */
	var TIMESTAMP_REGEXP = /\d{1,2}h\d{2}min de \d{1,2} de [a-zç]+ de \d{4} \(UTC\)|\d{1,2}:\d{2}, \d{1,2} [a-zç]+\.? \d{4} \(UTC\)/i;

	/** Base usada apenas para resolver hrefs relativos. */
	var URL_BASE = 'https://pt.wikipedia.org/';

	/** Máximo de caracteres entre o link do nome e o timestamp numa assinatura. */
	var MAX_SIGNATURE_GAP = 100;

	/** Máximo de links candidatos examinados antes do timestamp. */
	var MAX_SIGNATURE_LINKS = 10;

	/**
	 * Tags consideradas "bloco": o percurso reverso nunca sai do bloco que
	 * contém o timestamp, para não atribuir o nome a outro comentário.
	 * @type {Object.<string, boolean>}
	 */
	var BLOCK_TAGS = {
		P: true,
		LI: true,
		DD: true,
		DT: true,
		TD: true,
		TH: true,
		DIV: true,
		BLOCKQUOTE: true,
		SECTION: true,
		UL: true,
		OL: true,
		DL: true,
		TABLE: true
	};

	/**
	 * Extrai o nome do notificante a partir do DOM da seção, percorrendo os
	 * nós de volta a partir do timestamp de assinatura — mesma estratégia
	 * usada pelo Convenient Discussions (findTimestamp + walk-back) — com o
	 * atributo data-mw-comment-sig do DiscussionTools como último recurso.
	 *
	 * @param  {HTMLElement} headingDiv  O div.mw-heading da seção.
	 * @return {string}
	 */
	function extractNotificante(headingDiv) {
		var $headingDiv = $(headingDiv);
		var $scope = $headingDiv.nextUntil('div.mw-heading');
		if (!$scope.length) {
			$scope = $headingDiv.nextAll();
		}

		var name = walkBackFromSignature($scope);
		if (name) {
			return name;
		}

		log('[AssistEnc] walk-back falhou, tentando data-mw-comment-sig');
		var $sig = $scope.find('[data-mw-comment-sig]').first();
		if (!$sig.length) {
			log('[AssistEnc] Nem walk-back nem data-mw-comment-sig encontraram o notificante');
			return '';
		}
		var sigValue = $sig.attr('data-mw-comment-sig') || '';
		var m = sigValue.match(/^c-(.+?)-\d{14}/);
		if (!m) {
			log('[AssistEnc] Formato de data-mw-comment-sig inesperado:', sigValue);
			return '';
		}
		try {
			return decodeURIComponent(m[1]).replace(/_/g, ' ').trim();
		} catch (e) {
			log('[AssistEnc] data-mw-comment-sig com percent-encoding inválido:', sigValue);
			return m[1].replace(/_/g, ' ').trim();
		}
	}

	/**
	 * Retorna o ancestral de bloco mais próximo de um nó (ou null).
	 *
	 * @param  {Node} node
	 * @param  {Node} [limit]  Elemento onde parar.
	 * @return {HTMLElement|null}
	 */
	function closestBlock(node, limit) {
		var el = node.parentNode;
		while (el && el.nodeType === 1) {
			if (BLOCK_TAGS[el.tagName] && !(el.classList && el.classList.contains('mw-heading'))) {
				return el;
			}
			if (el === limit) {
				break;
			}
			el = el.parentNode;
		}
		return null;
	}

	/**
	 * Localiza, dentro do escopo dado, o nó de texto correspondente à
	 * PRIMEIRA assinatura (a do autor do pedido) e procura, no mesmo bloco e
	 * ANTES do timestamp, o link de usuário(a) mais próximo — desde que esteja
	 * a poucos caracteres do timestamp (assinatura sem link não deve herdar
	 * links de menções anteriores).
	 *
	 * @param  {jQuery} $scope  Conjunto de elementos da seção (sem o heading).
	 * @return {string}  Nome de usuário, ou string vazia se não encontrado.
	 */
	function walkBackFromSignature($scope) {
		if (!$scope.length) {
			return '';
		}

		var timestampNode = findFirstTimestampNode($scope.get());
		if (!timestampNode) {
			log('[AssistEnc] Nenhum timestamp de assinatura encontrado no escopo');
			return '';
		}

		var tsMatch = TIMESTAMP_REGEXP.exec(timestampNode.textContent);
		var tsOffset = tsMatch ? tsMatch.index : 0;
		var block = closestBlock(timestampNode) || timestampNode.parentNode;
		if (!block || !block.querySelectorAll) {
			return '';
		}

		var links = block.querySelectorAll('a[href]');
		var examined = 0;
		var doc = timestampNode.ownerDocument;

		for (var i = links.length - 1; i >= 0 && examined < MAX_SIGNATURE_LINKS; i--) {
			var link = links[i];
			// Só interessam links ANTES do timestamp (FOLLOWING = 4) e que não o contenham
			if (!(link.compareDocumentPosition(timestampNode) & 4) || link.contains(timestampNode)) {
				continue;
			}
			examined++;

			var name = extractUserFromHref(link.getAttribute('href'));
			if (!name) {
				continue;
			}

			// Mede o texto entre o link e o INÍCIO do timestamp (que pode estar no
			// mesmo nó de texto que o conteúdo anterior a ele)
			var range = doc.createRange();
			range.setStartAfter(link);
			range.setEnd(timestampNode, tsOffset);
			if (range.toString().length > MAX_SIGNATURE_GAP) {
				log('[AssistEnc] Link de usuário(a) distante demais do timestamp; ignorado:', name);
				return '';
			}
			return name;
		}

		return '';
	}

	/**
	 * Procura, dentro de uma lista de elementos, o primeiro nó de texto que
	 * contenha um timestamp de assinatura.
	 *
	 * @param  {HTMLElement[]} elements
	 * @return {Node|null}
	 */
	function findFirstTimestampNode(elements) {
		for (var i = 0; i < elements.length; i++) {
			var el = elements[i];
			if (!el || !el.ownerDocument) {
				continue;
			}
			var walker = el.ownerDocument.createTreeWalker(el, 4 /* SHOW_TEXT */ , null, false);
			var textNode;
			while ((textNode = walker.nextNode())) {
				if (TIMESTAMP_REGEXP.test(textNode.textContent)) {
					return textNode;
				}
			}
		}
		return null;
	}

	/**
	 * Obtém o título (decodificado UMA vez, com espaços) apontado por um href
	 * de artigo (/wiki/Título) ou de link vermelho (index.php?title=Título).
	 *
	 * @param  {string} href
	 * @return {string}  Título, ou '' se não for possível obter.
	 */
	function titleFromHref(href) {
		var url;
		try {
			url = new URL(href, URL_BASE);
		} catch (e) {
			return '';
		}
		var title = url.searchParams.get('title');
		if (!title) {
			var m = url.pathname.match(/\/wiki\/(.+)$/);
			if (!m) {
				return '';
			}
			try {
				title = decodeURIComponent(m[1]);
			} catch (e) {
				return '';
			}
		}
		return title.replace(/_/g, ' ');
	}

	/**
	 * Extrai o nome de usuário(a) de um href, se este apontar para uma
	 * página de usuário(a) ou de discussão de usuário(a). Subpáginas
	 * ("Usuário:Nome/teste") resultam apenas em "Nome".
	 *
	 * @param  {string|null} href
	 * @return {string}  Nome de usuário, ou string vazia.
	 */
	function extractUserFromHref(href) {
		if (!href) {
			return '';
		}
		var title = titleFromHref(href);
		var m = title.match(USER_NS_REGEXP);
		if (!m) {
			return '';
		}
		return m[1].split('/')[0].trim();
	}

	// ---------------------------------------------------------------------------
	// Transformação do wikitext
	// ---------------------------------------------------------------------------

	/**
	 * @typedef  {Object} ResponseOption
	 * @property {string} respondidoParam  Valor para |respondido=
	 * @property {string} rodape           Predefinição de rodapé (sem {{ }})
	 */

	/** @type {Object.<string, ResponseOption>} */
	var RESPONSE_OPTIONS = {
		bloqueado: {
			respondidoParam: 'feito',
			rodape: 'Subst:Bloqueio feito'
		},
		feito: {
			respondidoParam: 'feito',
			rodape: 'Subst:Feito'
		},
		negado: {
			respondidoParam: 'negado',
			rodape: 'Subst:Negado'
		},
		intermed: {
			respondidoParam: 'desnecessário',
			rodape: 'Subst:Desnecessário'
		},
		emobs: {
			respondidoParam: 'em observação',
			rodape: 'Subst:Em observação'
		},
		ocult: {
			respondidoParam: 'feito',
			rodape: 'Supressão feita'
		}
	};

	/**
	 * @typedef  {Object} TransformParams
	 * @property {string}  responseType   Chave em RESPONSE_OPTIONS.
	 * @property {string}  comment        Comentário opcional do operador.
	 * @property {string}  [bloqueadoPor] Operador que bloqueou (notificações).
	 * @property {string}  [prazo]        Prazo do bloqueio.
	 * @property {boolean} [ocultar]      Ocultar nome ofensivo.
	 * @property {string}  [supressaoPor] Operador responsável pela supressão.
	 * @property {string}  [supNum]       Número de supressões.
	 */

	/**
	 * @typedef  {Object} TransformContext
	 * @property {'notificação'|'pedido'} [requestType]  Padrão: tipo da página atual.
	 */

	/** Corpo de um comentário HTML sem atravessar "-->" (evita casar comentários distintos). */
	var COMMENT_BODY = '(?:(?!-->)[\\s\\S])*';

	/** Comentário de abertura contendo a predefinição {{Respondido}} / {{Respondido2}}. */
	var OPENING_COMMENT_RE = new RegExp('<!--' + COMMENT_BODY + '?\\{\\{[Rr]espondido(2)?' + COMMENT_BODY + '-->\\n?');

	/**
	 * Constrói o regex do comentário de rodapé (ex.: ":{{subst:Feito}}") a remover.
	 *
	 * @param  {string} templateName  Ex.: 'Bloqueio feito'.
	 * @param  {boolean} withSubst    Se o nome é precedido por "subst:".
	 * @return {RegExp}
	 */
	function footerCommentRe(templateName, withSubst) {
		return new RegExp('<!--' + COMMENT_BODY + '?:\\{\\{' + (withSubst ? '[Ss]ubst:' : '') +
			templateName + COMMENT_BODY + '-->\\n?');
	}

	/**
	 * Indica se o corpo da seção já COMEÇA por uma predefinição {{Respondido}}
	 * ativa (fora de comentários), isto é, o pedido já foi encerrado. A
	 * verificação é ancorada no início do corpo — onde o script (e quem encerra
	 * manualmente) insere a predefinição — para não confundir com citações do
	 * texto do pedido.
	 *
	 * @param  {string} wikitext
	 * @return {boolean}
	 */
	function isAlreadyClosed(wikitext) {
		var firstNl = wikitext.indexOf('\n');
		var body = firstNl === -1 ? '' : wikitext.slice(firstNl + 1);
		var visible = body.replace(/<!--[\s\S]*?-->/g, '');
		return /^\s*\{\{\s*[Rr]espondido2?\s*\|/.test(visible);
	}

	/**
	 * Aplica a PRIMEIRA substituição de um regex (sem flag g) apenas em trechos
	 * fora de comentários HTML.
	 *
	 * @param  {string}          text
	 * @param  {RegExp}          re
	 * @param  {function|string} replacement
	 * @return {string}
	 */
	function replaceFirstOutsideComments(text, re, replacement) {
		var parts = text.split(/(<!--[\s\S]*?-->)/);
		for (var i = 0; i < parts.length; i += 2) {
			if (re.test(parts[i])) {
				parts[i] = parts[i].replace(re, replacement);
				return parts.join('');
			}
		}
		return text;
	}

	/**
	 * Torna um texto livre seguro para ficar dentro de um parâmetro de
	 * predefinição: "|" fora de [[…]]/{{…}} vira {{!}}, "{{" e "}}" sem par
	 * viram entidades e "<!--" é neutralizado.
	 *
	 * @param  {string} text
	 * @return {string}
	 */
	function escapeForTemplateArg(text) {
		var re = /\{\{|\}\}|\[\[|\]\]/g;
		var stack = [];
		var matched = {};
		var m, k;
		while ((m = re.exec(text))) {
			if (m[0] === '{{' || m[0] === '[[') {
				stack.push({
					tok: m[0],
					pos: m.index
				});
			} else {
				var want = m[0] === '}}' ? '{{' : '[[';
				for (k = stack.length - 1; k >= 0; k--) {
					if (stack[k].tok === want) {
						break;
					}
				}
				if (k >= 0) {
					matched[stack[k].pos] = true;
					matched[m.index] = true;
					stack.length = k;
				}
			}
		}

		var out = '';
		var depth = 0;
		for (var i = 0; i < text.length; i++) {
			var two = text.substr(i, 2);
			if (two === '{{' || two === '}}' || two === '[[' || two === ']]') {
				if (matched[i]) {
					depth += (two === '{{' || two === '[[') ? 1 : -1;
					out += two;
				} else if (two === '{{') {
					out += '&#123;&#123;';
				} else if (two === '}}') {
					out += '&#125;&#125;';
				} else {
					out += two;
				}
				i++;
			} else if (text.charAt(i) === '|' && depth === 0) {
				out += '{{!}}';
			} else {
				out += text.charAt(i);
			}
		}
		return out.replace(/<!--/g, '&lt;!--');
	}

	/**
	 * Aplica as transformações necessárias ao wikitext da seção.
	 * Lança AssistError se a entrada for inválida ou o pedido já estiver encerrado.
	 *
	 * @param  {string}           originalWikitext
	 * @param  {TransformParams}  params
	 * @param  {TransformContext} [ctx]
	 * @return {{ wikitext: string, respondidoParam: string, warnings: string[] }}
	 */
	function transformWikitext(originalWikitext, params, ctx) {
		var requestType = (ctx && ctx.requestType) || REQUEST_TYPE;

		if (typeof originalWikitext !== 'string' || !originalWikitext) {
			throw makeError('emptysection', 'O conteúdo da seção está vazio ou ausente.');
		}
		if (!params || !Object.prototype.hasOwnProperty.call(RESPONSE_OPTIONS, params.responseType)) {
			throw makeError('badparams', 'Tipo de encerramento inválido.', params);
		}
		if (isAlreadyClosed(originalWikitext)) {
			throw makeError('alreadyclosed', 'Este pedido parece já ter sido encerrado (a seção já começa por uma predefinição {{Respondido}}). Recarregue a página.');
		}

		var option = RESPONSE_OPTIONS[params.responseType];
		var warnings = [];
		var text = originalWikitext;

		// — Abertura: substitui (ou insere) o bloco {{Respondido}} —
		var firstNl = text.indexOf('\n');
		var titleLine = firstNl !== -1 ? text.slice(0, firstNl + 1) : text + '\n';
		var body = firstNl !== -1 ? text.slice(firstNl + 1) : '';

		if (OPENING_COMMENT_RE.test(body)) {
			body = body.replace(OPENING_COMMENT_RE, function(all, two) {
				return '{{Respondido' + (two || '') + '|' + option.respondidoParam + '|texto=\n';
			});
		} else {
			body = '{{Respondido2|' + option.respondidoParam + '|texto=\n' + body;
		}

		// — Remoção do rodapé original em comentário —
		var closingPattern;
		if (requestType === 'notificação') {
			closingPattern = footerCommentRe('Bloqueio feito', true);
		} else if (params.responseType === 'ocult') {
			closingPattern = footerCommentRe('Supressão feita', false);
		} else {
			closingPattern = footerCommentRe('Feito', true);
		}
		body = body.replace(closingPattern, '');

		// — Tratamento especial: ocultar nome ofensivo (notificações) —
		if (params.ocultar) {
			var tplApplied = false;
			body = replaceFirstOutsideComments(body, /(\{\{[Uu]suário3\|(?:(?!ocultar\s*=)[^}])*)\}\}/, function(all, head) {
				tplApplied = true;
				return head + ' |ocultar=sim}}';
			});
			if (!tplApplied) {
				warnings.push('A predefinição {{usuário3}} não foi encontrada (ou já tem |ocultar=); o nome pode continuar visível no corpo do pedido.');
			}
			if (/^==.*==[ \t]*(?=\n|$)/.test(titleLine)) {
				titleLine = titleLine.replace(/^==.*==[ \t]*(?=\n|$)/, '== Nome ocultado ==');
			} else {
				warnings.push('O título da seção não pôde ser substituído por "Nome ocultado".');
			}
		}

		text = titleLine + body;

		// — Rodapé de resposta —
		var rodape;
		if (params.responseType === 'ocult') {
			rodape = ':{{' + option.rodape + '|' + (params.supNum || '1') +
				(params.supressaoPor ? '|por=' + params.supressaoPor : '') + '}}';
		} else if (params.responseType === 'bloqueado') {
			rodape = ':{{' + option.rodape + '|' + (params.prazo || '') +
				(params.bloqueadoPor ? '|por=' + params.bloqueadoPor : '') + '}}';
		} else {
			rodape = ':{{' + option.rodape + '}}';
		}

		var commentText = params.comment ?
			' ' + escapeForTemplateArg(params.comment).replace(/\r?\n/g, '\n:') :
			'';

		var suffix = params.responseType === 'ocult' ? '' : '.';
		text += '\n' + rodape + suffix + commentText + ' ~~~~}}';

		return {
			wikitext: text,
			respondidoParam: option.respondidoParam,
			warnings: warnings
		};
	}

	/**
	 * Gera o resumo de edição.
	 *
	 * @param  {'notificação'|'pedido'} requestType
	 * @param  {TransformParams}        params
	 * @param  {string}                 notificado
	 * @param  {string}                 respondidoParam
	 * @return {string}
	 */
	function buildSummary(requestType, params, notificado, respondidoParam) {
		var label = (params.ocultar || !notificado) ? '' : ' para ' + notificado;
		return 'Encerrando ' + requestType + label + ' como ' + respondidoParam + ADVERT;
	}

	/** Caracteres que quebrariam um parâmetro de predefinição. */
	var TEMPLATE_UNSAFE_RE = /[|{}\[\]<>\r\n]/;

	/**
	 * @typedef  {Object} FormValues
	 * @property {string}  [choice]      Valor do radio: 'feito' | 'negado' | 'intermed'.
	 * @property {string}  [comment]
	 * @property {string}  [blockedBy]
	 * @property {string}  [prazo]
	 * @property {boolean} [ofensivo]
	 * @property {string}  [supNum]
	 * @property {string}  [supPor]
	 */

	/**
	 * Converte os valores do formulário em parâmetros de transformação,
	 * validando-os. Retorna {params} ou {error: {message, field}}, onde field é
	 * o id do controle a focar ('result' = primeiro radio).
	 *
	 * @param  {FormValues} form
	 * @param  {{requestType: string, pageTitle: string}} [ctx]
	 * @return {{params: TransformParams}|{error: {message: string, field: string}}}
	 */
	function buildParams(form, ctx) {
		var requestType = (ctx && ctx.requestType) || REQUEST_TYPE;
		var pageTitle = (ctx && ctx.pageTitle) || PAGE_TITLE;
		var raw = form && form.choice;

		if (!raw) {
			return {
				error: {
					message: 'Selecione uma opção antes de continuar.',
					field: 'result'
				}
			};
		}
		if (raw !== 'feito' && raw !== 'negado' && raw !== 'intermed') {
			return {
				error: {
					message: 'Opção de encerramento inválida.',
					field: 'result'
				}
			};
		}

		function field(value, fallback) {
			return String(value === undefined || value === null ? '' : value).trim() || fallback;
		}

		var p = {
			responseType: raw,
			comment: String(form.comment || '').trim(),
			ocultar: false
		};
		var checks = [];

		if (requestType === 'notificação') {
			if (raw === 'feito') {
				p.responseType = 'bloqueado';
				p.bloqueadoPor = field(form.blockedBy, '');
				p.prazo = field(form.prazo, 'tempo indeterminado');
				p.ocultar = !!form.ofensivo;
				checks.push(['Por', p.bloqueadoPor, 'assistEnc-blockedBy'], ['Prazo', p.prazo, 'assistEnc-prazo', true]);
			} else if (raw === 'intermed') {
				p.responseType = 'emobs';
			}
		} else if (pageTitle === 'Pedidos/Ocultação' && raw === 'feito') {
			p.responseType = 'ocult';
			p.supNum = field(form.supNum, '1');
			p.supressaoPor = field(form.supPor, '');
			checks.push(['Nº de supressões', p.supNum, 'assistEnc-supNum', true], ['Por', p.supressaoPor, 'assistEnc-supPor']);
		}

		for (var i = 0; i < checks.length; i++) {
			// checks[i][3]: parâmetro posicional, onde "=" viraria um parâmetro nomeado
			var unsafe = TEMPLATE_UNSAFE_RE.test(checks[i][1]) || (checks[i][3] && checks[i][1].indexOf('=') !== -1);
			if (unsafe) {
				return {
					error: {
						message: 'O campo "' + checks[i][0] + '" contém caracteres não permitidos ( | { } [ ] < > ' + (checks[i][3] ? '= ' : '') + ').',
						field: checks[i][2]
					}
				};
			}
		}
		return {
			params: p
		};
	}

	// ---------------------------------------------------------------------------
	// Versão e links de suporte
	// ---------------------------------------------------------------------------

	var VERSION = '2.1.1';

	var DOC_PAGE = 'Usuário:Little Sunshine/Scripts/AssistenteEncerramentos';
	var CHANGELOG_PAGE = DOC_PAGE + '/Changelog#' + VERSION;
	var BUGS_PAGE = 'Usuário Discussão:Little Sunshine/Scripts/AssistenteEncerramentos';

	/**
	 * Converte a estampa "AAAA-MM-DD hh:mm:ss (UTC)" em "DD/MM/AAAA hh:mm UTC".
	 * Valores fora do formato são devolvidos como estão.
	 *
	 * @param  {string} stamp
	 * @return {string}
	 */
	function formatVersion(stamp) {
		var m = /^\s*(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::\d{2})?\s*\(UTC\)\s*$/.exec(String(stamp));
		return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5] + ' UTC' : String(stamp).trim();
	}

	/**
	 * URL de uma página do wiki (com parâmetros opcionais).
	 * @param  {string} title
	 * @param  {Object} [params]
	 * @return {string}
	 */
	function pageUrl(title, params) {
		return mw.util.getUrl(title, params);
	}

	// ---------------------------------------------------------------------------
	// Botões personalizados (window.assistEncBotoes)
	// ---------------------------------------------------------------------------

	/**
	 * @typedef  {Object} CustomButton
	 * @property {string} etiqueta  Texto exibido no botão.
	 * @property {string} texto     Texto inserido; "/i" marca onde fica a seleção/cursor.
	 */

	/**
	 * Lê window.assistEncBotoes e devolve os botões válidos para esta página.
	 * Itens malformados são ignorados (com aviso no console em modo debug).
	 *
	 * Cada item: { tipo: 'notificação'|'pedido', pagina: 'Pedidos/Restauro',
	 * texto: '{{Exemplo|/i}}', etiqueta: 'Exemplo' }. "pagina" aceita o título
	 * completo ("Wikipédia:Pedidos/Restauro") ou sem o prefixo.
	 *
	 * @param  {string} [requestType]
	 * @param  {string} [pageTitle]
	 * @return {CustomButton[]}
	 */
	function getCustomButtons(requestType, pageTitle) {
		var list = window.assistEncBotoes;
		var out = [];
		if (!list || typeof list.length !== 'number' || typeof list === 'string') {
			return out;
		}
		var type = requestType || REQUEST_TYPE;
		var title = pageTitle || PAGE_TITLE;
		for (var i = 0; i < list.length; i++) {
			var b = list[i];
			if (!b || typeof b !== 'object' || typeof b.texto !== 'string' || typeof b.etiqueta !== 'string' ||
				!b.texto || !b.etiqueta.trim()) {
				log('[AssistEnc] assistEncBotoes[' + i + '] ignorado: requer "texto" e "etiqueta" (strings não vazias).');
				continue;
			}
			var tipo = String(b.tipo || '').toLowerCase().replace('ç', 'c').replace('ã', 'a');
			if (tipo && tipo !== (type === 'notificação' ? 'notificacao' : 'pedido')) {
				continue;
			}
			if (b.pagina) {
				var pg = String(b.pagina).replace(/_/g, ' ').replace(/^Wikipédia:/, '');
				if (pg !== title) {
					continue;
				}
			}
			out.push({
				etiqueta: b.etiqueta.trim(),
				texto: b.texto
			});
		}
		return out;
	}

	/**
	 * Posição do primeiro marcador "/i" que não faz parte de uma tag "</i>".
	 * @param  {string} text
	 * @return {number} -1 se não houver.
	 */
	function findMarker(text) {
		var from = 0;
		for (;;) {
			var i = text.indexOf('/i', from);
			if (i === -1) {
				return -1;
			}
			if (i === 0 || text.charAt(i - 1) !== '<') {
				return i;
			}
			from = i + 2;
		}
	}

	/**
	 * Insere o texto de um botão personalizado num valor, respeitando a seleção:
	 * - sem seleção: o marcador "/i" é removido e o cursor fica onde ele estava;
	 * - com seleção: a seleção ocupa o lugar do "/i" e o restante do texto a
	 *   envolve; o cursor fica depois do trecho inserido.
	 * Sem marcador, o texto substitui a seleção e o cursor vai para o fim.
	 *
	 * @param  {string} value  Conteúdo atual do campo.
	 * @param  {number} start  Início da seleção.
	 * @param  {number} end    Fim da seleção.
	 * @param  {string} texto  Texto do botão.
	 * @return {{value: string, cursor: number}}
	 */
	function applyCustomText(value, start, end, texto) {
		var selected = value.slice(start, end);
		var m = findMarker(texto);
		var insert, cursor;
		if (m === -1) {
			insert = texto;
			cursor = start + insert.length;
		} else {
			var pre = texto.slice(0, m);
			var post = texto.slice(m + 2);
			insert = pre + selected + post;
			cursor = selected ? start + insert.length : start + pre.length;
		}
		return {
			value: value.slice(0, start) + insert + value.slice(end),
			cursor: cursor
		};
	}

	// ---------------------------------------------------------------------------
	// Sugestões no campo de comentário: "@" (usuários) e "[[" (páginas)
	// ---------------------------------------------------------------------------

	/**
	 * @typedef  {Object} Trigger
	 * @property {'mention'|'link'} kind
	 * @property {number} start  Início do trecho a substituir.
	 * @property {number} end    Fim do trecho a substituir.
	 * @property {string} query  Texto digitado até o cursor.
	 */

	/**
	 * Identifica se o cursor está dentro de uma "@menção" ou do destino de um
	 * link "[[destino|texto]]" ainda em edição.
	 *
	 * @param  {string} text
	 * @param  {number} pos  Posição do cursor.
	 * @return {Trigger|null}
	 */
	function detectTrigger(text, pos) {
		var before = text.slice(0, pos);
		var tail = text.slice(pos);
		var m = /(^|[\s(])@([^\s@\[\]|{}<>]{0,40})$/.exec(before);
		if (m) {
			return {
				kind: 'mention',
				start: pos - m[2].length - 1,
				end: pos + /^[^\s@\[\]|{}<>]*/.exec(tail)[0].length,
				query: m[2]
			};
		}
		var i = before.lastIndexOf('[[');
		if (i !== -1) {
			var seg = before.slice(i + 2);
			if (seg.length >= 2 && !/[\]\[|{}\n<>]/.test(seg)) {
				return {
					kind: 'link',
					start: i + 2,
					end: pos + /^[^|\]\[\n{}<>]*/.exec(tail)[0].length,
					query: seg
				};
			}
		}
		return null;
	}

	/**
	 * Aplica uma sugestão escolhida no texto.
	 *
	 * @param  {string}  text
	 * @param  {Trigger} trig
	 * @param  {string}  name  Nome de usuário(a) ou título da página.
	 * @return {{value: string, cursor: number}}
	 */
	function applySuggestion(text, trig, name) {
		var rep, closing = '';
		if (trig.kind === 'mention') {
			rep = '@[[Usuário(a):' + name + '|' + name + ']] ';
		} else {
			rep = name;
			var after = text.slice(trig.end, trig.end + 2);
			if (after !== ']]' && text.charAt(trig.end) !== '|') {
				closing = ']]';
			}
		}
		return {
			value: text.slice(0, trig.start) + rep + closing + text.slice(trig.end),
			cursor: trig.start + rep.length + closing.length
		};
	}

	/**
	 * Usuários(as) identificados(as) numa seção: os informados em "extras"
	 * primeiro, depois os citados no wikitext (links, {{U}}, {{usuário3}},
	 * contribuições). Sem duplicatas.
	 *
	 * @param  {string}   wikitext
	 * @param  {string[]} [extras]
	 * @return {string[]}
	 */
	function collectUsers(wikitext, extras) {
		var seen = {};
		var out = [];
		function add(raw) {
			var n = String(raw || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
			if (!n || n.length > 85 || /[#<>\[\]{}|]/.test(n)) {
				return;
			}
			n = n.charAt(0).toUpperCase() + n.slice(1);
			if (!Object.prototype.hasOwnProperty.call(seen, n)) {
				seen[n] = true;
				out.push(n);
			}
		}
		(extras || []).forEach(add);
		var res = [
			/\[\[\s*:?\s*(?:Usu[aá]rio\(a\)|Usu[aá]rio|User)(?:[ _]+Discuss[aã]o| talk)?\s*:\s*([^|\]#\/]+)/gi,
			/\{\{\s*(?:u|usu[aá]rio3|usu[aá]rio|user)\s*\|\s*(?:1\s*=\s*)?([^|}]+)/gi,
			/\[\[\s*(?:Especial|Special)\s*:\s*(?:Contribui[cç][õo]es|Contributions)\/([^|\]]+)/gi
		];
		var clean = String(wikitext || '').replace(/<!--[\s\S]*?-->/g, '');
		res.forEach(function(re) {
			var m;
			while ((m = re.exec(clean)) !== null) {
				add(m[1]);
			}
		});
		return out.slice(0, 12);
	}

	// ---------------------------------------------------------------------------
	// Atalhos de formatação: Ctrl+B, Ctrl+I, Ctrl/Alt+1..4
	// ---------------------------------------------------------------------------

	/** Tamanho da sequência de apóstrofos que termina (dir<0) ou começa (dir>0) em pos. */
	function apostropheRun(value, pos, dir) {
		var n = 0;
		if (dir < 0) {
			while (pos - n - 1 >= 0 && value.charAt(pos - n - 1) === "'") {
				n++;
			}
		} else {
			while (pos + n < value.length && value.charAt(pos + n) === "'") {
				n++;
			}
		}
		return n;
	}

	/** n=2 (itálico): sequência de 2 ou 5; n=3 (negrito): sequência de 3 ou 5. */
	function hasMark(run, n) {
		return n === 2 ? (run === 2 || run === 5) : (run === 3 || run === 5);
	}

	/**
	 * Alterna '' (n=2) ou ''' (n=3) em volta da seleção.
	 *
	 * @param  {string} value
	 * @param  {number} start
	 * @param  {number} end
	 * @param  {number} n
	 * @return {{value: string, start: number, end: number}}
	 */
	function toggleQuotes(value, start, end, n) {
		var mark = new Array(n + 1).join("'");

		// Marcas logo fora da seleção: remove
		if (hasMark(apostropheRun(value, start, -1), n) && hasMark(apostropheRun(value, end, 1), n)) {
			return {
				value: value.slice(0, start - n) + value.slice(start, end) + value.slice(end + n),
				start: start - n,
				end: end - n
			};
		}
		// Marcas dentro da seleção: remove
		var sel = value.slice(start, end);
		var lead = apostropheRun(sel, 0, 1);
		var trail = apostropheRun(sel, sel.length, -1);
		if (sel.length > lead + trail && hasMark(lead, n) && hasMark(trail, n)) {
			var inner = sel.slice(n, sel.length - n);
			return {
				value: value.slice(0, start) + inner + value.slice(end),
				start: start,
				end: start + inner.length
			};
		}
		// Envolve (ignorando espaços nas pontas, comuns em seleção por duplo clique)
		var s = start,
			e = end;
		while (s < e && /\s/.test(value.charAt(s))) {
			s++;
		}
		while (e > s && /\s/.test(value.charAt(e - 1))) {
			e--;
		}
		return {
			value: value.slice(0, s) + mark + value.slice(s, e) + mark + value.slice(e),
			start: s + n,
			end: e + n
		};
	}

	/**
	 * Alterna título de nível "level" na linha do cursor: "== /i ==".
	 * Mesmo nível = remove; outro nível = troca; sem título = cria.
	 *
	 * @param  {string} value
	 * @param  {number} start
	 * @param  {number} end
	 * @param  {number} level  1 a 4.
	 * @return {{value: string, start: number, end: number}}
	 */
	function toggleHeading(value, start, end, level) {
		var ls = start === 0 ? 0 : value.lastIndexOf('\n', start - 1) + 1;
		var le = value.indexOf('\n', start);
		if (le === -1) {
			le = value.length;
		}
		var line = value.slice(ls, le);
		var m = /^(={1,6})(.*?)(={1,6})\s*$/.exec(line);
		var text = (m ? m[2] : line).trim();
		var newLine, pos;

		if (m && m[1].length === level) {
			newLine = text;
			pos = ls + text.length;
		} else {
			var eq = new Array(level + 1).join('=');
			newLine = eq + ' ' + text + ' ' + eq;
			pos = ls + level + 1 + text.length;
		}
		return {
			value: value.slice(0, ls) + newLine + value.slice(le),
			start: pos,
			end: pos
		};
	}

	/**
	 * Devolve a transformação associada a um atalho de teclado (ou null).
	 * Ctrl/Cmd+B, Ctrl/Cmd+I; Ctrl/Cmd+1..4 e Alt+1..4 (o Alt é alternativa
	 * porque alguns navegadores reservam Ctrl+número para trocar de aba).
	 *
	 * @param  {KeyboardEvent} e
	 * @return {function(string, number, number): Object|null}
	 */
	function shortcutFor(e) {
		var mod = e.ctrlKey || e.metaKey;
		if (e.shiftKey) {
			return null;
		}
		var k = String(e.key || '').toLowerCase();
		if (mod && !e.altKey && (k === 'b' || k === 'i')) {
			var n = k === 'b' ? 3 : 2;
			return function(v, s, t) {
				return toggleQuotes(v, s, t, n);
			};
		}
		var d = /^(?:Digit|Numpad)([1-4])$/.exec(e.code || '');
		if (d && (mod !== e.altKey)) { // Ctrl/Cmd OU Alt, nunca os dois (AltGr)
			var level = Number(d[1]);
			return function(v, s, t) {
				return toggleHeading(v, s, t, level);
			};
		}
		return null;
	}

	// ---------------------------------------------------------------------------
	// Editor do comentário: CodeMirror 6 (com <textarea> como reserva)
	// ---------------------------------------------------------------------------

	var cmReady = null;

	/** Carrega o CodeMirror 6 uma vez. Resolve com null se não estiver disponível. */
	function loadCodeMirror() {
		if (!cmReady) {
			cmReady = mw.loader.using([
				'ext.CodeMirror',
				'ext.CodeMirror.lib',
				'ext.CodeMirror.mode.mediawiki'
			]).then(function(req) {
				var CM = req('ext.CodeMirror');
				if (CM && typeof CM !== 'function') {
					CM = CM.default || CM.CodeMirror;
				}
				var m = req('ext.CodeMirror.mode.mediawiki');
				var lang = typeof m === 'function' ? m :
					(m && (m.mediaWikiLang || m.mediawiki || m.default));
				if (typeof CM !== 'function' || typeof lang !== 'function') {
					throw new Error('Exports inesperados: ext.CodeMirror=' + typeof CM +
						' [' + Object.keys(req('ext.CodeMirror') || {}) + '], mode=' + typeof m +
						' [' + Object.keys(m || {}) + ']');
				}
				return {
					CodeMirror: CM,
					mode: { mediawiki: lang },
					lib: req('ext.CodeMirror.lib')
				};
			}).then(null, function(err) {
				console.warn('[AssistEnc] CodeMirror indisponível; usando <textarea>:', err); // eslint-disable-line no-console
				return null;
			});
		}
		return cmReady;
	}
	/** Menor trecho que difere entre a e b (preserva o histórico de desfazer). */
	function diffRange(a, b) {
		var s = 0;
		var max = Math.min(a.length, b.length);
		while (s < max && a.charCodeAt(s) === b.charCodeAt(s)) {
			s++;
		}
		var ea = a.length;
		var eb = b.length;
		while (ea > s && eb > s && a.charCodeAt(ea - 1) === b.charCodeAt(eb - 1)) {
			ea--;
			eb--;
		}
		return {
			from: s,
			to: ea,
			insert: b.slice(s, eb)
		};
	}

	/**
	 * Cria o editor do comentário. Começa como <textarea> comum e, quando o
	 * CodeMirror carrega, é substituído por ele sem mudar a interface do objeto:
	 * getValue(), getSelection(), setValue(v, start, [end]), focus(),
	 * on('caret'|'keydown'|'blur', fn), aria(nome, valor|null), destroy().
	 *
	 * @param  {HTMLTextAreaElement} ta
	 * @return {Object}
	 */
	function createEditor(ta) {
		var handlers = {
			caret: [],
			keydown: [],
			blur: []
		};
		var ariaAttrs = {};
		var view = null;
		var destroyed = false;
		var ed = {};

		$(ta).wrap('<div class="assistEnc-editor"></div>');
		ed.$wrap = $(ta).parent();

		function emit(name, e) {
			handlers[name].forEach(function(fn) {
				fn(e);
			});
		}

		function applyAria(target) {
			Object.keys(ariaAttrs).forEach(function(k) {
				if (ariaAttrs[k] === null) {
					target.removeAttribute(k);
				} else {
					target.setAttribute(k, ariaAttrs[k]);
				}
			});
		}

		function onKey(e) {
			if (e.isComposing) {
				return;
			}
			var action = shortcutFor(e);
			if (action) {
				e.preventDefault();
				e.stopPropagation();
				var sel = ed.getSelection();
				var r = action(ed.getValue(), sel.start, sel.end);
				ed.setValue(r.value, r.start, r.end);
				return;
			}
			emit('keydown', e);
		}

		var onCaret = function() {
			emit('caret');
		};
		var taHandlers = {
			input: onCaret,
			click: onCaret,
			focus: onCaret,
			keyup: function(e) {
				if (!/^(ArrowUp|ArrowDown|Enter|Tab|Escape)$/.test(e.key)) {
					emit('caret');
				}
			},
			keydown: onKey,
			blur: function() {
				emit('blur');
			}
		};
		Object.keys(taHandlers).forEach(function(k) {
			ta.addEventListener(k, taHandlers[k]);
		});

		ed.on = function(name, fn) {
			handlers[name].push(fn);
		};
		ed.aria = function(name, value) {
			ariaAttrs[name] = value;
			applyAria(view ? view.contentDOM : ta);
		};
		ed.getValue = function() {
			return view ? view.state.doc.toString() : ta.value;
		};
		ed.getSelection = function() {
			if (view) {
				var r = view.state.selection.main;
				return {
					start: r.from,
					end: r.to
				};
			}
			return {
				start: ta.selectionStart,
				end: ta.selectionEnd
			};
		};
		ed.setValue = function(value, start, end) {
			if (end === undefined) {
				end = start;
			}
			if (view) {
				view.dispatch({
					changes: diffRange(view.state.doc.toString(), value),
					selection: {
						anchor: start,
						head: end
					},
					userEvent: 'input'
				});
				view.focus();
			} else {
				ta.value = value;
				ta.selectionStart = start;
				ta.selectionEnd = end;
				ta.focus();
				notifyInput(ta);
			}
		};
		ed.focus = function() {
			if (view) {
				view.focus();
			} else {
				ta.focus();
			}
		};
		ed.destroy = function() {
			destroyed = true;
			Object.keys(taHandlers).forEach(function(k) {
				ta.removeEventListener(k, taHandlers[k]);
			});
			try {
				if (view) {
					view.destroy();
				}
			} catch (e) { /* o elemento será removido de qualquer forma */ }
		};

		function upgrade(mods) {
			if (destroyed || !mods || !document.body.contains(ta)) {
				return;
			}
			var hadFocus = document.activeElement === ta;
			var selStart = ta.selectionStart;
			var selEnd = ta.selectionEnd;
			var cm = null;
			try {
				var EV = mods.lib && mods.lib.EditorView;
				if (!EV || !EV.updateListener) {
					throw new Error('ext.CodeMirror.v6.lib não exporta EditorView');
				}
				var extra = [EV.updateListener.of(function(u) {
					if (u.docChanged) {
						// Mantém o <textarea> oculto em sincronia (antevisão ao vivo, leitura do formulário)
						ta.value = u.state.doc.toString();
						notifyInput(ta);
					}
					if (u.docChanged || u.selectionSet || (u.focusChanged && u.view.hasFocus)) {
						emit('caret');
					}
				})];
				if (EV.lineWrapping) {
					extra.push(EV.lineWrapping);
				}
				cm = new mods.CodeMirror(ta, mods.mode.mediawiki());
				cm.initialize([cm.defaultExtensions, extra]);

				// Captura: o atalho/sugestão age antes do keymap do CodeMirror
				cm.view.dom.addEventListener('keydown', onKey, true);
				cm.view.contentDOM.addEventListener('blur', function() {
					emit('blur');
				});
				Object.keys(taHandlers).forEach(function(k) {
					ta.removeEventListener(k, taHandlers[k]);
				});
				view = cm.view;
				applyAria(view.contentDOM);
				view.dispatch({
					selection: {
						anchor: selStart,
						head: selEnd
					}
				});
				if (hadFocus) {
					view.focus();
				}
			} catch (e) {
				log('[AssistEnc] Falha ao iniciar o CodeMirror; mantendo <textarea>:', e);
				try {
					if (cm && cm.view) {
						cm.view.destroy();
					}
				} catch (e2) { /* ignorado */ }
				ta.style.display = '';
				view = null;
			}
		}

		loadCodeMirror().then(upgrade);
		return ed;
	}

	/**
	 * Insere texto na seleção do editor (substitui-a).
	 * @param {Object} ed
	 * @param {string} text
	 */
	function insertText(ed, text) {
		var s = ed.getSelection();
		var v = ed.getValue();
		ed.setValue(v.slice(0, s.start) + text + v.slice(s.end), s.start + text.length);
	}

	// ---------------------------------------------------------------------------
	// Último bloqueio (registro de bloqueios)
	// ---------------------------------------------------------------------------

	var DURATION_UNITS = {
		second: ['segundo', 'segundos'],
		minute: ['minuto', 'minutos'],
		hour: ['hora', 'horas'],
		day: ['dia', 'dias'],
		week: ['semana', 'semanas'],
		month: ['mês', 'meses'],
		year: ['ano', 'anos']
	};

	/**
	 * Traduz a duração do registro de bloqueios ("3 days", "infinite") para o
	 * formato do campo "Prazo". Texto irreconhecível é devolvido como está.
	 *
	 * @param  {string} duration
	 * @return {string}
	 */
	function formatDuration(duration) {
		var d = String(duration || '').trim();
		if (/^(infinite|indefinite|infinity|never)$/i.test(d)) {
			return 'tempo indeterminado';
		}
		var parts = d.split(/\s*(?:,|\band\b)\s*/);
		var out = [];
		for (var i = 0; i < parts.length; i++) {
			var m = /^(\d+)\s*(second|minute|hour|day|week|month|year)s?$/i.exec(parts[i]);
			if (!m) {
				return d;
			}
			out.push(m[1] + ' ' + DURATION_UNITS[m[2].toLowerCase()][m[1] === '1' ? 0 : 1]);
		}
		return out.join(' e ');
	}

	/**
	 * Escolhe, entre as entradas do registro (mais recente primeiro), o último
	 * bloqueio e converte-o nos campos do formulário.
	 *
	 * @param  {Array}  entries   logevents (formatversion 2).
	 * @param  {string} [me]      Nome de quem usa a ferramenta (vira "vazio").
	 * @return {{blockedBy: string, prazo: string, user: string, timestamp: string, unblockedLater: boolean}|null}
	 */
	function parseLastBlock(entries, me) {
		var unblockedLater = false;
		for (var i = 0; i < (entries || []).length; i++) {
			var e = entries[i];
			if (!e || e.suppressed || e.actionhidden) {
				continue;
			}
			if (e.action === 'unblock') {
				unblockedLater = true;
				continue;
			}
			if (e.action !== 'block' && e.action !== 'reblock') {
				continue;
			}
			var p = e.params || {};
			var prazo = '';
			if (p.duration) {
				prazo = formatDuration(p.duration);
			} else if (p.expiry && e.timestamp) {
				var secs = Math.round((Date.parse(p.expiry) - Date.parse(e.timestamp)) / 1000);
				if (secs > 0) {
					prazo = secs % 86400 === 0 ? formatDuration(secs / 86400 + ' days') :
						secs % 3600 === 0 ? formatDuration(secs / 3600 + ' hours') :
						formatDuration(Math.round(secs / 60) + ' minutes');
				}
			}
			return {
				blockedBy: e.user && e.user !== me ? e.user : '',
				prazo: prazo || 'tempo indeterminado',
				user: e.user || '',
				timestamp: e.timestamp || '',
				unblockedLater: unblockedLater
			};
		}
		return null;
	}

	// ---------------------------------------------------------------------------
	// CSS (injetado uma única vez)
	// ---------------------------------------------------------------------------

	var cssInjected = false;

	function injectCss() {
		if (cssInjected) {
			return;
		}
		cssInjected = true;
		mw.util.addCSS([
			/* — Desktop: dialog — */
			'#assistEnc-sheet .assistEnc-smallBtn { font-size: 13px; padding: 4px 8px; }',
			'#assistEnc-dialog textarea { width: 100%; padding: 5px; box-sizing: border-box; }',
			'#assistEnc-dialog textarea { resize: vertical; font-family: monospace; font-size: 15px; line-height: 1.5; }',
			'#assistEnc-blockDiv { display: none; }',
			'#assistEnc-supDiv   { display: none; }',
			'.assistEnc-label    { display: block; margin-top: 10px; }',
			'#assistEnc-ofensivo { display: inline-block; }',
			'#assistEnc-preview  { display: none; margin-top: 15px; border: 1px solid #ccc;',
			'                      padding: 10px; background: #f9f9f9;',
			'                      max-height: 400px; overflow-y: auto; }',
			'#assistEnc-preview h4 { margin-top: 0; }',
			'.assistEnc-pingBtn  { font-size: 11px; padding: 2px 6px; }',
			/* — Mobile: bottom sheet — */
			'#assistEnc-sheet-overlay {',
			'  position: fixed; inset: 0; z-index: 10000;',
			'  background: rgba(0,0,0,.45); }',
			'#assistEnc-sheet {',
			'  position: fixed; bottom: 0; left: 0; right: 0;',
			'  background: var(--background-color-base, #fff);',
			'  border-radius: 16px 16px 0 0;',
			'  max-height: 90vh; display: flex; flex-direction: column;',
			'  transform: translateY(100%);',
			'  transition: transform .3s ease; }',
			'#assistEnc-sheet.assistEnc-sheet-open { transform: translateY(0); }',
			'#assistEnc-sheet:focus { outline: none; }',
			'#assistEnc-sheet-handle {',
			'  width: 40px; height: 4px; background: #ccc;',
			'  border-radius: 2px; margin: 10px auto 0; flex-shrink: 0; }',
			'#assistEnc-sheet-body {',
			'  overflow-y: auto; padding: 16px;',
			'  -webkit-overflow-scrolling: touch; }',
			'#assistEnc-sheet input[type=text],',
			'#assistEnc-sheet textarea {',
			'  width: 100%; box-sizing: border-box; padding: 6px; margin-top: 4px; }',
			'#assistEnc-sheet textarea {',
			'  resize: vertical; font-family: monospace; font-size: 16px; line-height: 1.5; min-height: 80px; }',
			/* — Editor: CodeMirror, sugestões, botões e rodapé — */
			'.assistEnc-smallBtn { font-size: 11px; padding: 2px 6px; }',
			'.assistEnc-editor { position: relative; display: block; }',
			'.assistEnc-editor .cm-editor { border: 1px solid #a2a9b1; border-radius: 2px; background: var(--background-color-base, #fff); }',
			'.assistEnc-editor .cm-editor.cm-focused { outline: 1px solid #36c; }',
			'.assistEnc-editor .cm-scroller { min-height: 12em; max-height: 45vh; overflow: auto; font-family: monospace; font-size: 15px; line-height: 1.5; }',
			'#assistEnc-sheet .assistEnc-editor .cm-scroller { min-height: 6em; font-size: 16px; }',
			'.assistEnc-suggest { position: absolute; left: 0; right: 0; top: 100%; z-index: 20; margin: 2px 0 0;',
			'  padding: 2px 0; list-style: none; max-height: 180px; overflow-y: auto;',
			'  background: var(--background-color-base, #fff); color: var(--color-base, #202122);',
			'  border: 1px solid #a2a9b1; border-radius: 2px; box-shadow: 0 2px 6px rgba(0,0,0,.25); }',
			'.assistEnc-suggest li { margin: 0; padding: 4px 8px; cursor: pointer; font-size: 13px; }',
			'.assistEnc-suggest li[aria-selected=true] { background: #36c; color: #fff; }',
			'.assistEnc-suggest li.assistEnc-suggest-info { cursor: default; color: #72777d; font-style: italic; }',
			'.assistEnc-customRow { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; }',
			'.assistEnc-footer { display: flex; justify-content: space-between; align-items: center;',
			'  margin-top: 12px; font-size: 11px; color: #72777d; }',
			'.assistEnc-help { position: relative; }',
			'.assistEnc-helpBtn { background: none; border: 1px solid currentColor; border-radius: 50%; cursor: pointer;',
			'  opacity: .65; font-size: 11px; font-weight: bold; line-height: 1; width: 18px; height: 18px; padding: 0; }',
			'.assistEnc-helpBtn:hover, .assistEnc-helpBtn:focus { opacity: 1; }',
			'.assistEnc-helpMenu { display: none; position: absolute; right: 0; bottom: 100%; z-index: 20; white-space: nowrap;',
			'  padding: 4px 0; background: var(--background-color-base, #fff); border: 1px solid #a2a9b1;',
			'  box-shadow: 0 2px 6px rgba(0,0,0,.25); }',
			'.assistEnc-helpMenu a { display: block; padding: 4px 12px; font-size: 13px; }'
		].join('\n'));
	}

	// ---------------------------------------------------------------------------
	// Sessão de encerramento (lógica compartilhada entre desktop e mobile)
	// ---------------------------------------------------------------------------

	/** Sessão atualmente aberta (no máximo uma). */
	var activeSession = null;

	/** true enquanto os dados de uma seção estão sendo obtidos para abrir a interface. */
	var opening = false;

	/** Códigos de erro que são avisos recuperáveis (não falhas). */
	var SOFT_ERRORS = {
		stale: true,
		warnings: true
	};

	/**
	 * @typedef  {Object} SessionUi
	 * @property {function(boolean)} setBusy      Desabilita/reabilita os controles de envio.
	 * @property {function(string)}  showPreview  Mostra o HTML da antevisão.
	 * @property {function()}        clearPreview Esconde a antevisão.
	 * @property {function(string)}  focusField   Foca um controle pelo id ('result' = 1º radio).
	 */

	/**
	 * Cria a sessão de uma interface aberta: guarda os dados da seção, impede
	 * operações simultâneas e descarta respostas obsoletas de antevisão.
	 *
	 * @param  {string}      anchor
	 * @param  {SectionData} data     Dados já obtidos ao abrir a interface.
	 * @param  {SessionUi}   ui
	 * @param  {{requestType: string, pageTitle: string}} [ctx]
	 * @return {Object}  Sessão com preview(form), confirm(form), dispose() e isBusy().
	 */
	function createSession(anchor, data, ui, ctx) {
		var s = {
			data: data,
			busy: false,
			closed: false,
			previewOpen: false
		};
		var previewSeq = 0;
		var previewReq = null;
		var lastPreview = null; // {text, html}
		var ackedWarnings = null;

		function requestType() {
			return (ctx && ctx.requestType) || REQUEST_TYPE;
		}

		function abortPreview() {
			previewSeq++; // invalida qualquer resposta pendente
			if (previewReq && typeof previewReq.abort === 'function') {
				previewReq.abort();
			}
			previewReq = null;
		}

		function formError(error) {
			notify(error.message, 'warn');
			ui.focusField(error.field);
		}

		s.isBusy = function() {
			return s.busy;
		};

		s.dispose = function() {
			s.closed = true;
			abortPreview();
			if (activeSession === s) {
				activeSession = null;
			}
		};

		/**
		 * Gera a antevisão a partir do estado atual do formulário.
		 * No modo automático (antevisão ao vivo) formulário incompleto e
		 * avisos não geram notificações.
		 *
		 * @param {FormValues} form
		 * @param {boolean}    [auto]
		 */
		s.preview = function(form, auto) {
			if (s.closed || s.busy) {
				return;
			}
			var built = buildParams(form, ctx);
			if (built.error) {
				if (!auto) {
					formError(built.error);
				}
				return;
			}

			var result;
			try {
				result = transformWikitext(s.data.wikitext, built.params, ctx);
			} catch (e) {
				if (auto) {
					log('[AssistEnc] Antevisão automática falhou:', e);
				} else {
					reportError(e, 'antevisão');
				}
				return;
			}
			if (result.warnings.length && !auto) {
				notify(result.warnings.join(' '), 'warn');
			}

			// Mesma transformação já exibida: não refaz a requisição
			if (lastPreview && lastPreview.text === result.wikitext) {
				s.previewOpen = true;
				ui.showPreview(lastPreview.html);
				return;
			}

			abortPreview();
			var seq = previewSeq;
			var req = fetchPreview(result.wikitext);
			previewReq = req;
			req.then(function(html) {
				if (s.closed || seq !== previewSeq) {
					return;
				}
				lastPreview = {
					text: result.wikitext,
					html: html
				};
				s.previewOpen = true;
				s.autoErrNotified = false;
				ui.showPreview(html);
			}, function(err) {
				if (s.closed || seq !== previewSeq) {
					return;
				}
				// Na antevisão ao vivo, só a primeira falha da sequência é notificada
				if (auto && s.autoErrNotified) {
					log('[AssistEnc] Antevisão automática falhou:', err);
					return;
				}
				s.autoErrNotified = !!auto;
				reportError(err, 'antevisão');
			});
		};

		/**
		 * Confirma o encerramento: relê a seção, recusa dados obsoletos e só
		 * informa sucesso depois que a API confirmar a nova revisão.
		 * @param {FormValues} form
		 */
		s.confirm = function(form) {
			if (s.closed || s.busy) {
				return;
			}
			var built = buildParams(form, ctx);
			if (built.error) {
				formError(built.error);
				return;
			}

			s.busy = true;
			ui.setBusy(true);
			abortPreview();
			notify('Encerrando pedido…');

			fetchSection(anchor).then(function(fresh) {
				if (s.closed) {
					return failWith('closed', 'Operação cancelada.');
				}
				if (fresh.wikitext.replace(/\s+$/, '') !== s.data.wikitext.replace(/\s+$/, '')) {
					s.data = fresh;
					lastPreview = null;
					s.previewOpen = false;
					ui.clearPreview();
					return failWith('stale', 'A seção foi alterada por outra pessoa desde que foi aberta. Revise a antevisão e confirme novamente.');
				}
				s.data = fresh;

				var result;
				try {
					result = transformWikitext(fresh.wikitext, built.params, ctx);
				} catch (e) {
					return $.Deferred().reject(normalizeError(e)).promise();
				}
				if (result.warnings.length) {
					var key = result.warnings.join('|');
					if (ackedWarnings !== key) {
						ackedWarnings = key;
						return failWith('warnings', result.warnings.join(' ') + ' Clique em Confirmar novamente para prosseguir mesmo assim.');
					}
				}

				var summary = buildSummary(requestType(), built.params, fresh.notificado, result.respondidoParam);
				return editSection(fresh, result.wikitext, summary);
			}).then(function(outcome) {
				if (outcome.dryRun) {
					notify('[dryRun] Nenhuma edição real foi feita — veja o console.', 'warn');
					s.busy = false;
					ui.setBusy(false);
					return;
				}
				// Permanece "ocupado": a página será recarregada
				notify('Pedido encerrado com sucesso!', 'success');
				location.reload();
			}, function(err) {
				s.busy = false;
				ui.setBusy(false);
				var e = normalizeError(err);
				if (e.code === 'closed') {
					return;
				}
				if (SOFT_ERRORS[e.code]) {
					notify(e.message, 'warn');
					log('[AssistEnc] Aviso (' + e.code + '):', e.message);
				} else {
					reportError(e, 'confirmar');
				}
			});
		};

		return s;
	}

	/**
	 * Abre uma nova sessão; se já houver uma aberta, ela é descartada antes.
	 *
	 * @param  {string}      anchor
	 * @param  {SectionData} data
	 * @param  {SessionUi}   ui
	 * @return {Object}
	 */
	function startSession(anchor, data, ui) {
		if (activeSession) {
			activeSession.dispose();
		}
		activeSession = createSession(anchor, data, ui);
		return activeSession;
	}

	// ---------------------------------------------------------------------------
	// Auxiliares de formulário (idênticos nas duas interfaces)
	// ---------------------------------------------------------------------------

	/**
	 * Rótulos das opções 1 e 3 conforme o tipo de pedido.
	 * @return {{label1: string, label3: string}}
	 */
	function getOptionLabels() {
		return {
			label1: REQUEST_TYPE === 'notificação' ? 'Bloqueio feito' : 'Feito',
			label3: REQUEST_TYPE === 'notificação' ? 'Em observação' : 'Desnecessário'
		};
	}

	/**
	 * Lê os valores atuais do formulário dentro de um contêiner.
	 *
	 * @param  {jQuery} $root
	 * @return {FormValues}
	 */
	function readForm($root) {
		var ed = $root.data('assistEncEditor');
		return {
			choice: $root.find('input[name="assistEnc-result"]:checked').val() || '',
			comment: (ed ? ed.getValue() : $root.find('#assistEnc-comment').val()) || '',
			blockedBy: $root.find('#assistEnc-blockedBy').val() || '',
			prazo: $root.find('#assistEnc-prazo').val() || '',
			ofensivo: !!$root.find('#assistEnc-ofensivo').prop('checked'),
			supNum: $root.find('#assistEnc-supNum').val() || '',
			supPor: $root.find('#assistEnc-supPor').val() || ''
		};
	}

	/**
	 * Liga o comportamento comum do formulário: exibição condicional dos
	 * campos e inserção de menções no comentário.
	 *
	 * @param {jQuery} $root
	 */
	function bindFormBehavior($root) {
		$root.find('input[name="assistEnc-result"]').on('change', function() {
			var val = this.value;
			$root.find('#assistEnc-blockDiv').toggle(val === 'feito' && REQUEST_TYPE === 'notificação');
			$root.find('#assistEnc-supDiv').toggle(val === 'feito' && PAGE_TITLE === 'Pedidos/Ocultação');
		});

		$root.on('click', '.assistEnc-pingBtn', function() {
			var name = $(this).attr('data-mention') || '';
			var ed = $root.data('assistEncEditor');
			if (ed) {
				insertText(ed, '@[[Usuário(a):' + name + '|' + name + ']] ');
			}
		});
	}

	/**
	 * Foca um controle do formulário (o 1º radio quando id = 'result').
	 *
	 * @param {jQuery} $root
	 * @param {string} id
	 */
	function focusFormField($root, id) {
		var $el = id === 'result' ?
			$root.find('input[name="assistEnc-result"]').first() :
			$root.find('#' + id);
		if ($el.length) {
			$el.trigger('focus');
		}
	}

	/**
	 * HTML do botão de menção; vazio quando o nome não foi identificado.
	 *
	 * @param  {string} name
	 * @param  {string} [extraClass]
	 * @return {string}
	 */
	function pingButtonHtml(name, extraClass) {
		if (!name) {
			return '';
		}
		return '<button type="button" class="assistEnc-pingBtn' + (extraClass ? ' ' + extraClass : '') + '"' +
			' data-mention="' + mw.html.escape(name) + '">@' + mw.html.escape(name) + '</button>';
	}

	/**
	 * Avisa os ouvintes (antevisão ao vivo, leitura do formulário) de que o valor mudou por código.
	 * @param {HTMLElement} el
	 */
	function notifyInput(el) {
		try {
			el.dispatchEvent(new Event('input', {
				bubbles: true
			}));
		} catch (e) { /* ambiente sem construtor Event: sem antevisão ao vivo */ }
	}

	// ---------------------------------------------------------------------------
	// Complementos do formulário (compartilhados por desktop e Minerva)
	// ---------------------------------------------------------------------------

	/**
	 * HTML da linha de botões personalizados (vazio se não houver nenhum).
	 * @param  {CustomButton[]} buttons
	 * @param  {string}         [extraClass]
	 * @return {string}
	 */
	function customButtonsHtml(buttons, extraClass) {
		if (!buttons.length) {
			return '';
		}
		return '<div class="assistEnc-customRow">' + buttons.map(function(b, i) {
			return '<button type="button" class="assistEnc-customBtn assistEnc-smallBtn' + (extraClass ? ' ' + extraClass : '') +
				'" data-index="' + i + '">' + mw.html.escape(b.etiqueta) + '</button>';
		}).join('') + '</div>';
	}

	/**
	 * HTML do botão "Obter último bloqueio" (só para notificações).
	 * @param  {string} [extraClass]
	 * @return {string}
	 */
	function lastBlockButtonHtml(extraClass) {
		return '<p><button type="button" id="assistEnc-lastBlock" class="assistEnc-smallBtn' + (extraClass ? ' ' + extraClass : '') +
			'">Obter último bloqueio</button></p>';
	}

	/**
	 * HTML do rodapé: versão, link do changelog e menu de ajuda (ícone).
	 * @return {string}
	 */
	function footerHtml() {
		return '<div class="assistEnc-footer">' +
			'<span>AssistEnc ' + mw.html.escape(formatVersion(VERSION)) + '</span>' +
			'<span class="assistEnc-help">' +
			'<button type="button" class="assistEnc-helpBtn" aria-label="Ajuda e suporte" title="Ajuda e suporte"' +
			' aria-haspopup="true" aria-expanded="false">?</button>' +
			'<span class="assistEnc-helpMenu" role="menu">' +
			'<a role="menuitem" target="_blank" rel="noopener" href="' + mw.html.escape(pageUrl(BUGS_PAGE, {
				action: 'edit',
				section: 'new'
			})) + '">Informar um erro</a>' +
			'<a role="menuitem" target="_blank" rel="noopener" href="' + mw.html.escape(pageUrl(DOC_PAGE)) + '">Documentação</a>' +
			'<a href="' + mw.html.escape(pageUrl(CHANGELOG_PAGE)) + '" target="_blank" rel="noopener">Changelog</a>' +
			'</span>' +
			'</span>' +
			'</div>';
	}

	/**
	 * Liga o menu de ajuda do rodapé (fecha ao clicar fora ou com Esc).
	 * @param {jQuery} $root
	 */
	function bindHelpMenu($root) {
		var $btn = $root.find('.assistEnc-helpBtn');
		var $menu = $root.find('.assistEnc-helpMenu');
		function toggle(show) {
			$menu.css('display', show ? 'block' : 'none');
			$btn.attr('aria-expanded', show ? 'true' : 'false');
		}
		$btn.on('click', function(e) {
			e.preventDefault();
			toggle($menu.css('display') === 'none');
		});
		$root.on('click', function(e) {
			if (!$(e.target).closest('.assistEnc-help').length) {
				toggle(false);
			}
		});
		$root.find('.assistEnc-help').on('keydown', function(e) {
			if (e.key === 'Escape' && $menu.css('display') !== 'none') {
				e.preventDefault();
				e.stopPropagation(); // fecha só o menu, não o diálogo
				toggle(false);
				$btn.trigger('focus');
			}
		});
	}

	/**
	 * Sugestões no campo de comentário: "@" lista os(as) usuários(as)
	 * identificados(as) e busca outros nomes; "[[" busca páginas.
	 * Setas navegam, Enter/Tab/clique escolhem, Esc fecha só a lista.
	 *
	 * @param  {Object}              ed        Editor criado por createEditor().
	 * @param  {function(): string[]} getUsers  Usuários(as) da seção.
	 * @return {function()}  Libera timers e requisições.
	 */
	function attachSuggestions(ed, getUsers) {
		var $list = $('<ul class="assistEnc-suggest" role="listbox" id="assistEnc-suggest" style="display:none"></ul>');
		ed.$wrap.append($list);
		ed.aria('aria-autocomplete', 'list');
		ed.aria('aria-controls', 'assistEnc-suggest');
		var items = [];
		var active = -1;
		var trig = null;
		var seq = 0;
		var req = null;
		var timer = null;
		var shownKey = '';

		function cancelPending() {
			seq++;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			if (req && typeof req.abort === 'function') {
				req.abort();
			}
			req = null;
		}

		function close() {
			cancelPending();
			trig = null;
			items = [];
			active = -1;
			shownKey = '';
			$list.hide().empty();
			ed.aria('aria-activedescendant', null);
		}

		function render(list, info) {
			items = list;
			active = list.length ? 0 : -1;
			$list.empty();
			list.forEach(function(v, i) {
				$('<li role="option"></li>').attr({
					id: 'assistEnc-opt-' + i,
					'aria-selected': i === active ? 'true' : 'false'
				}).text(v).appendTo($list);
			});
			if (info) {
				$('<li class="assistEnc-suggest-info" role="presentation"></li>').text(info).appendTo($list);
			}
			if (list.length || info) {
				$list.show();
			} else {
				$list.hide();
			}
			ed.aria('aria-activedescendant', active >= 0 ? 'assistEnc-opt-' + active : null);
		}

		function setActive(i) {
			if (!items.length) {
				return;
			}
			active = (i + items.length) % items.length;
			$list.children('li[role=option]').each(function(k) {
				$(this).attr('aria-selected', k === active ? 'true' : 'false');
			});
			ed.aria('aria-activedescendant', 'assistEnc-opt-' + active);
			var el = document.getElementById('assistEnc-opt-' + active);
			if (el && el.scrollIntoView) {
				try {
					el.scrollIntoView({
						block: 'nearest'
					});
				} catch (e) { /* conveniência */ }
			}
		}

		function choose(i) {
			if (!trig || i < 0 || i >= items.length) {
				return;
			}
			var res = applySuggestion(ed.getValue(), trig, items[i]);
			close();
			ed.setValue(res.value, res.cursor);
		}

		function merge(local, remote) {
			var out = local.slice();
			remote.forEach(function(n) {
				if (out.indexOf(n) === -1) {
					out.push(n);
				}
			});
			return out;
		}

		function refresh() {
			var sel = ed.getSelection();
			if (sel.start !== sel.end) {
				close();
				return;
			}
			var t = detectTrigger(ed.getValue(), sel.start);
			if (!t) {
				close();
				return;
			}
			var key = t.kind + ':' + t.start + ':' + t.query;
			if (key === shownKey) {
				return;
			}
			cancelPending();
			shownKey = key;
			trig = t;
			var mySeq = seq;
			var lookup;
			var local = [];
			if (t.kind === 'mention') {
				var q = t.query.toLowerCase();
				local = getUsers().filter(function(n) {
					return n.toLowerCase().indexOf(q) !== -1;
				});
				render(local, t.query.length >= 2 ? 'Buscando…' : '');
				lookup = t.query.length >= 2 ? searchUsers : null;
			} else {
				render([], 'Buscando…');
				lookup = searchPages;
			}
			if (!lookup) {
				return;
			}
			// Pausa curta para não consultar a cada tecla
			timer = setTimeout(function() {
				timer = null;
				req = lookup(t.query);
				req.then(function(names) {
					if (mySeq !== seq || !trig) {
						return;
					}
					var list = t.kind === 'mention' ? merge(local, names) : names;
					render(list, list.length ? '' : (t.kind === 'mention' ? 'Nenhum(a) usuário(a) encontrado(a).' : 'Nenhuma página encontrada.'));
				}, function(err) {
					if (mySeq !== seq) {
						return;
					}
					log('[AssistEnc] Falha na busca de sugestões:', err);
					render(local, 'Busca indisponível.');
				});
			}, 250);
		}

		ed.on('caret', refresh);
		ed.on('keydown', function(e) {
			if ($list.css('display') === 'none') {
				return;
			}
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				setActive(active + (e.key === 'ArrowDown' ? 1 : -1));
			} else if ((e.key === 'Enter' || e.key === 'Tab') && active >= 0 && !e.shiftKey) {
				e.preventDefault();
				e.stopPropagation();
				choose(active);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation(); // fecha só a lista, não o diálogo
				close();
			}
		});
		ed.on('blur', function() {
			setTimeout(close, 150);
		});
		// mousedown (e não click) evita perder o foco do editor antes de escolher
		$list.on('mousedown', 'li[role=option]', function(e) {
			e.preventDefault();
			choose($(this).index());
		});

		return close;
	}

	/**
	 * Liga tudo o que o formulário tem além dos campos básicos: editor,
	 * sugestões, botões personalizados, "último bloqueio" e antevisão ao vivo.
	 * Cada recurso é isolado: a falha de um não afeta os demais.
	 *
	 * @param  {jQuery} $root
	 * @param  {Object} session
	 * @param  {{notificante: string, buttons: CustomButton[]}} info
	 */
	function enhanceForm($root, session, info) {
		var ta = $root.find('#assistEnc-comment')[0];
		var ed = ta ? createEditor(ta) : null;
		var cleanups = [];
		var notificado = session.data.notificado;
		if (ed) {
			$root.data('assistEncEditor', ed);
			cleanups.push(ed.destroy);
		}

		// Botões personalizados (texto com "/i" = posição da seleção)
		$root.on('click', '.assistEnc-customBtn', function() {
			var b = info.buttons[Number($(this).attr('data-index'))];
			if (!b || !ed) {
				return;
			}
			var sel = ed.getSelection();
			var r = applyCustomText(ed.getValue(), sel.start, sel.end, b.texto);
			ed.setValue(r.value, r.cursor);
		});

		// Obter último bloqueio
		$root.on('click', '#assistEnc-lastBlock', function() {
			var $btn = $(this);
			if ($btn.prop('disabled') || !notificado) {
				return;
			}
			$btn.prop('disabled', true);
			notify('Consultando o registro de bloqueios…');
			fetchLastBlock(notificado).then(function(r) {
				if (session.closed) {
					return;
				}
				if (!r) {
					notify('Nenhum bloqueio encontrado no registro de "' + notificado + '".', 'warn');
					return;
				}
				$root.find('#assistEnc-blockedBy').val(r.blockedBy);
				$root.find('#assistEnc-prazo').val(r.prazo);
				var by = r.blockedBy ? r.blockedBy : (r.user ? r.user + ' (você)' : '');
				var date = r.timestamp ? r.timestamp.slice(8, 10) + '/' + r.timestamp.slice(5, 7) + '/' + r.timestamp.slice(0, 4) : '';
				notify('Último bloqueio' + (date ? ' (' + date + ')' : '') + ': por ' + by + ', prazo ' + r.prazo + '.' +
					(r.unblockedLater ? ' Atenção: há um desbloqueio posterior.' : ''), r.unblockedLater ? 'warn' : 'success');
				var inputs = $root.find('#assistEnc-blockedBy, #assistEnc-prazo');
				inputs.each(function() {
					notifyInput(this);
				});
			}, function(err) {
				if (!session.closed) {
					reportError(err, 'último bloqueio');
				}
			}).always(function() {
				$btn.prop('disabled', false);
			});
		});

		// Antevisão ao vivo: com a antevisão aberta, atualiza 0,7 s depois da última alteração
		var liveTimer = null;
		$root.on('input change', 'textarea, input', function() {
			if (!session.previewOpen || session.closed) {
				return;
			}
			clearTimeout(liveTimer);
			liveTimer = setTimeout(function() {
				liveTimer = null;
				if (!session.closed && session.previewOpen) {
					session.preview(readForm($root), true);
				}
			}, 700);
		});
		cleanups.push(function() {
			clearTimeout(liveTimer);
		});

		if (ed) {
			try {
				cleanups.push(attachSuggestions(ed, function() {
					return collectUsers(session.data.wikitext, [info.notificante, REQUEST_TYPE === 'notificação' ? notificado : '']);
				}));
			} catch (e) {
				log('[AssistEnc] Sugestões:', e);
			}
		}
		bindHelpMenu($root);

		var baseDispose = session.dispose;
		session.dispose = function() {
			cleanups.forEach(function(fn) {
				fn();
			});
			baseDispose();
		};
	}

	// ---------------------------------------------------------------------------
	// Interface: dispatcher
	// ---------------------------------------------------------------------------

	/**
	 * Abre a interface adequada conforme a skin activa.
	 *
	 * @param {string}      anchor
	 * @param {SectionData} data         Dados da seção já obtidos.
	 * @param {string}      notificante
	 */
	function openDialog(anchor, data, notificante) {
		if (IS_MOBILE) {
			openBottomSheet(anchor, data, notificante);
		} else {
			openJqDialog(anchor, data, notificante);
		}
	}

	// ---------------------------------------------------------------------------
	// Interface: diálogo jQuery UI (desktop)
	// ---------------------------------------------------------------------------

	/**
	 * Constrói e abre o diálogo jQuery UI para uma seção.
	 *
	 * @param {string}      anchor
	 * @param {SectionData} data
	 * @param {string}      notificante
	 */
	function openJqDialog(anchor, data, notificante) {
		injectCss();
		$('#assistEnc-dialog').remove();

		var notificado = data.notificado;
		var blockHtml = '',
			supHtml = '',
			pingHtml = '';

		if (notificante) {
			pingHtml += '<p><label>Notificante: ' + pingButtonHtml(notificante) + '</label></p>';
		}

		if (REQUEST_TYPE === 'notificação') {
			if (notificado) {
				pingHtml += '<p><label>Notificado: ' + pingButtonHtml(notificado) + '</label></p>';
			}

			blockHtml = '<div id="assistEnc-blockDiv">' +
				(notificado ? lastBlockButtonHtml() : '') +
				'<label class="assistEnc-label" for="assistEnc-blockedBy">Por (vazio = você)</label>' +
				'<input type="text" id="assistEnc-blockedBy" placeholder="' + mw.html.escape(USER_NAME) + '" />' +
				'<label class="assistEnc-label" for="assistEnc-prazo">Prazo</label>' +
				'<input type="text" id="assistEnc-prazo" value="tempo indeterminado" />' +
				'<label class="assistEnc-label">' +
				'<input type="checkbox" id="assistEnc-ofensivo" /> Ocultar nome de usuário(a) ofensivo' +
				'</label></div>';
		}

		if (PAGE_TITLE === 'Pedidos/Ocultação') {
			supHtml = '<div id="assistEnc-supDiv">' +
				'<label class="assistEnc-label" for="assistEnc-supNum">Nº de supressões</label>' +
				'<input type="text" id="assistEnc-supNum" value="1" />' +
				'<label class="assistEnc-label" for="assistEnc-supPor">Por (vazio = você)</label>' +
				'<input type="text" id="assistEnc-supPor" placeholder="' + mw.html.escape(USER_NAME) + '" />' +
				'</div>';
		}

		var labels = getOptionLabels();
		var customButtons = getCustomButtons();

		var html =
			'<div id="assistEnc-dialog" title="Encerrar ' + REQUEST_TYPE + ' para ' + mw.html.escape(notificado) + '" style="display:none;">' +
			'<div role="radiogroup" aria-labelledby="assistEnc-radioLabel">' +
			'<p><label id="assistEnc-radioLabel">Selecione uma opção:</label></p>' +
			'<p><label><input type="radio" name="assistEnc-result" value="feito"> ' + labels.label1 + '</label></p>' +
			'<p><label><input type="radio" name="assistEnc-result" value="negado"> Negado</label></p>' +
			'<p><label><input type="radio" name="assistEnc-result" value="intermed"> ' + labels.label3 + '</label></p>' +
			'</div>' +
			supHtml + blockHtml +
			'<p><label for="assistEnc-comment">Comentário (opcional):</label></p>' +
			customButtonsHtml(customButtons) +
			'<p><textarea id="assistEnc-comment" rows="10"></textarea></p>' +
			pingHtml +
			'<div id="assistEnc-preview"><h4>Antevisão:</h4><div id="assistEnc-previewContent"></div></div>' +
			footerHtml() +
			'</div>';

		$('body').append(html);

		var $dlg = $('#assistEnc-dialog');
		bindFormBehavior($dlg);

		var session = startSession(anchor, data, {
			setBusy: function(busy) {
				var $widget = $dlg.dialog('widget');
				$widget.attr('aria-busy', busy ? 'true' : 'false');
				$widget.find('.ui-dialog-buttonpane button')
					.prop('disabled', busy)
					.toggleClass('ui-state-disabled', busy);
			},
			showPreview: function(previewHtml) {
				$('#assistEnc-previewContent').html(previewHtml);
				$('#assistEnc-preview').show();
			},
			clearPreview: function() {
				$('#assistEnc-preview').hide();
				$('#assistEnc-previewContent').empty();
			},
			focusField: function(id) {
				focusFormField($dlg, id);
			}
		});

		$dlg.dialog({
			modal: true,
			width: 700,
			// Não fecha (Esc/Cancelar/X) enquanto a edição está em andamento
			beforeClose: function() {
				return !session.isBusy();
			},
			close: function() {
				session.dispose();
				$dlg.dialog('destroy').remove();
			},
			buttons: {
				'Antevisão': function() {
					session.preview(readForm($dlg));
				},

				'Cancelar': function() {
					$(this).dialog('close');
				},

				'Confirmar': function() {
					session.confirm(readForm($dlg));
				}
			}
			
		});

		enhanceForm($dlg, session, {
			notificante: notificante,
			buttons: customButtons
		});
	}

	// ---------------------------------------------------------------------------
	// Interface: bottom sheet (mobile/Minerva)
	// ---------------------------------------------------------------------------

	/**
	 * Constrói e abre o bottom sheet para uma seção.
	 *
	 * @param {string}      anchor
	 * @param {SectionData} data
	 * @param {string}      notificante
	 */
	function openBottomSheet(anchor, data, notificante) {
		injectCss();
		$('#assistEnc-sheet-overlay').remove();

		var notificado = data.notificado;
		var opener = document.activeElement;
		var labels = getOptionLabels();
		var customButtons = getCustomButtons();

		var blockHtml = '',
			supHtml = '';

		if (REQUEST_TYPE === 'notificação') {
			blockHtml =
				'<div id="assistEnc-blockDiv" style="display:none">' +
				(notificado ? lastBlockButtonHtml('mw-ui-button') : '') +
				'<label class="assistEnc-label">Por (vazio = você)<br>' +
				'<input type="text" id="assistEnc-blockedBy" placeholder="' + mw.html.escape(USER_NAME) + '"></label>' +
				'<label class="assistEnc-label">Prazo<br>' +
				'<input type="text" id="assistEnc-prazo" value="tempo indeterminado"></label>' +
				'<label class="assistEnc-label" style="display:flex;align-items:center;gap:8px">' +
				'<input type="checkbox" id="assistEnc-ofensivo"> Ocultar nome ofensivo</label>' +
				'</div>';
		}
		if (PAGE_TITLE === 'Pedidos/Ocultação') {
			supHtml =
				'<div id="assistEnc-supDiv" style="display:none">' +
				'<label class="assistEnc-label">Nº de supressões<br>' +
				'<input type="text" id="assistEnc-supNum" value="1"></label>' +
				'<label class="assistEnc-label">Por (vazio = você)<br>' +
				'<input type="text" id="assistEnc-supPor" placeholder="' + mw.html.escape(USER_NAME) + '"></label>' +
				'</div>';
		}

		var pingButtons = pingButtonHtml(notificante, 'mw-ui-button mw-ui-quiet');
		if (REQUEST_TYPE === 'notificação') {
			pingButtons += pingButtonHtml(notificado, 'mw-ui-button mw-ui-quiet');
		}
		var pingHtml = pingButtons ?
			'<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' + pingButtons + '</div>' :
			'';

		var html =
			'<div id="assistEnc-sheet-overlay">' +
			'<div id="assistEnc-sheet" role="dialog" aria-modal="true" aria-labelledby="assistEnc-sheet-title" tabindex="-1">' +
			'<div id="assistEnc-sheet-handle"></div>' +
			'<div id="assistEnc-sheet-body">' +
			'<h3 id="assistEnc-sheet-title" style="margin:0 0 12px;font-size:16px">Encerrar ' + REQUEST_TYPE + ': ' + mw.html.escape(notificado) + '</h3>' +

			'<div role="radiogroup" aria-labelledby="assistEnc-sheet-title" style="display:flex;flex-direction:column;gap:6px;margin-bottom:10px">' +
			'<label style="display:flex;align-items:center;gap:8px">' +
			'<input type="radio" name="assistEnc-result" value="feito"> ' + labels.label1 + '</label>' +
			'<label style="display:flex;align-items:center;gap:8px">' +
			'<input type="radio" name="assistEnc-result" value="negado"> Negado</label>' +
			'<label style="display:flex;align-items:center;gap:8px">' +
			'<input type="radio" name="assistEnc-result" value="intermed"> ' + labels.label3 + '</label>' +
			'</div>' +

			supHtml + blockHtml +

			'<div class="assistEnc-label"><label for="assistEnc-comment">Comentário (opcional)</label>' +
			customButtonsHtml(customButtons, 'mw-ui-button') +
			'<textarea id="assistEnc-comment" rows="4"></textarea></div>' +

			pingHtml +

			'<div id="assistEnc-preview"' +
			' style="display:none;margin-top:12px;border:1px solid #ccc;padding:10px;' +
			'background:#f9f9f9;border-radius:4px;max-height:260px;overflow-y:auto">' +
			'<strong>Antevisão</strong><div id="assistEnc-previewContent"></div></div>' +

			'<div style="display:flex;gap:8px;margin-top:14px">' +
			'<button id="assistEnc-btn-confirm" class="mw-ui-button mw-ui-progressive" style="flex:1">Confirmar</button>' +
			'<button id="assistEnc-btn-preview" class="mw-ui-button" style="flex:1">Antevisão</button>' +
			'<button id="assistEnc-btn-cancel"  class="mw-ui-button mw-ui-quiet" style="flex:1">Cancelar</button>' +
			'</div>' +
			footerHtml() +
			'</div></div></div>';

		$('body').append(html);

		var $overlay = $('#assistEnc-sheet-overlay');
		bindFormBehavior($overlay);

		var session = startSession(anchor, data, {
			setBusy: function(busy) {
				$('#assistEnc-sheet').attr('aria-busy', busy ? 'true' : 'false');
				$overlay.find('#assistEnc-btn-confirm, #assistEnc-btn-preview, #assistEnc-btn-cancel')
					.prop('disabled', busy);
			},
			showPreview: function(previewHtml) {
				$('#assistEnc-previewContent').html(previewHtml);
				$('#assistEnc-preview').show();
			},
			clearPreview: function() {
				$('#assistEnc-preview').hide();
				$('#assistEnc-previewContent').empty();
			},
			focusField: function(id) {
				focusFormField($overlay, id);
			}
		});

		enhanceForm($overlay, session, {
			notificante: notificante,
			buttons: customButtons
		});

		function closeSheet() {
			// Não fecha enquanto a edição está em andamento
			if (session.isBusy()) {
				return;
			}
			session.dispose();
			$overlay.remove();
			if (opener && typeof opener.focus === 'function' && document.body.contains(opener)) {
				opener.focus();
			}
		}

		// Fechar ao tocar no overlay fora do sheet
		$overlay.on('click', function(e) {
			if (e.target === this) {
				closeSheet();
			}
		});

		// Esc fecha (o listener vive no overlay e some junto com ele)
		$overlay.on('keydown', function(e) {
			if (e.key === 'Escape' || e.keyCode === 27) {
				e.preventDefault();
				closeSheet();
			}
		});

		$('#assistEnc-btn-cancel').on('click', closeSheet);

		$('#assistEnc-btn-preview').on('click', function() {
			session.preview(readForm($overlay));
		});

		$('#assistEnc-btn-confirm').on('click', function() {
			session.confirm(readForm($overlay));
		});

		// Animação de entrada
		requestAnimationFrame(function() {
			var sheet = document.getElementById('assistEnc-sheet');
			if (!sheet) {
				return;
			}
			$(sheet).addClass('assistEnc-sheet-open');
			try {
				sheet.focus({
					preventScroll: true
				});
			} catch (e) { /* foco é apenas uma conveniência */ }
		});
	}

	// ---------------------------------------------------------------------------
	// Injeção dos botões "encerrar" na página
	// ---------------------------------------------------------------------------

	function addButtons() {
		if (IS_MOBILE) {
			addButtonsMobile();
		} else {
			addButtonsDesktop();
		}
	}

	/**
	 * Indica se o bloco logo após o título já é um pedido encerrado
	 * (predefinição {{Respondido}} renderizada com fundo de sucesso).
	 *
	 * @param  {HTMLElement} headingEl
	 * @return {boolean}
	 */
	function isMarkedClosed(headingEl) {
		var $next = $(headingEl).next();
		return $next.is('div') &&
			($next.attr('style') || '').indexOf('background:var(--background-color-success-subtle') !== -1;
	}

	/**
	 * Desktop (Vector/MonoBook): injeta link dentro do [editar] existente.
	 */
	function addButtonsDesktop() {
		var headings = document.querySelectorAll('div.mw-heading.mw-heading2');

		Array.prototype.forEach.call(headings, function(headingDiv) {
			var h2 = headingDiv.querySelector('h2');
			if (!h2 || !h2.id) {
				return;
			}

			if (isMarkedClosed(headingDiv) || headingDiv.querySelector('.assistEnc-link')) {
				return;
			}

			var $editSection = $(headingDiv).find('.mw-editsection');
			if (!$editSection.length) {
				return;
			}

			var $link = $('<a>')
				.attr('href', '#')
				.addClass('assistEnc-link')
				.text('encerrar');

			var $bracket = $editSection.find('.mw-editsection-bracket').eq(1);
			if ($bracket.length) {
				$bracket.before(', ').before($link);
			} else {
				$editSection.append(', ', $link);
			}

			$link.on('click', function(e) {
				e.preventDefault();
				handleEncerrar(h2.id, headingDiv);
			});
		});
	}

	/**
	 * Mobile (Minerva): injeta item no menu "⋯" do OOUI de cada seção.
	 * Aguarda o DiscussionTools renderizar os menus via MutationObserver, que
	 * é desconectado assim que não há mais seções pendentes (ou após 30 s).
	 */
	function addButtonsMobile() {
		var processed = new WeakSet();
		var observer = null;
		var scheduled = false;
		var timer = null;

		function stop() {
			if (observer) {
				observer.disconnect();
				observer = null;
			}
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
		}

		/**
		 * Trata uma seção; retorna true se ficou resolvida (não precisa de nova tentativa).
		 */
		function processHeading(headingEl) {
			if (processed.has(headingEl)) {
				return true;
			}

			var h2 = headingEl.tagName === 'H2' ?
				headingEl :
				headingEl.querySelector('h2');
			if (!h2 || !h2.id) {
				return true;
			}

			if (isMarkedClosed(headingEl)) {
				processed.add(headingEl);
				return true;
			}

			// Tenta o caminho OOUI (menu ⋯)
			var menuWidget = headingEl.querySelector('.ext-discussiontools-init-section-overflowMenuButton');
			if (menuWidget) {
				processed.add(headingEl);
				try {
					var ouiData = $(menuWidget).data('ooui');
					if (!ouiData || typeof ouiData.getMenu !== 'function' ||
						typeof OO === 'undefined' || !OO.ui || !OO.ui.MenuOptionWidget) {
						addMinervaFallbackButton(headingEl, h2);
						return true;
					}
					var menuSelect = ouiData.getMenu();
					if (menuSelect.findItemFromData('assistEnc-encerrar')) {
						return true; // já adicionado
					}
					var item = new OO.ui.MenuOptionWidget({
						data: 'assistEnc-encerrar',
						label: 'Encerrar'
					});
					menuSelect.addItems([item]);
					menuSelect.on('choose', function(chosen) {
						if (chosen.getData() === 'assistEnc-encerrar') {
							menuSelect.toggle(false);
							handleEncerrar(h2.id, headingEl);
						}
					});
				} catch (e) {
					// Falha neste menu não pode comprometer as demais seções
					log('[AssistEnc] Falha ao integrar com o menu OOUI; usando botão simples:', e);
					addMinervaFallbackButton(headingEl, h2);
				}
				return true;
			}

			// Sem menu ⋯ — layout mf-collapsible: botão dentro do mw-editsection
			var editSection = headingEl.querySelector('.mw-editsection');
			if (!editSection) {
				return false; // ainda não renderizado (ou anônimo): tenta de novo
			}

			processed.add(headingEl);

			if (headingEl.querySelector('.assistEnc-minerva-btn')) {
				return true;
			}

			var btn = document.createElement('a');
			btn.className = 'assistEnc-minerva-btn';
			btn.href = '#';
			btn.textContent = 'encerrar';
			btn.style.cssText = 'font-size:0.9em;margin-left:8px;white-space:nowrap;';
			btn.addEventListener('click', function(e) {
				e.preventDefault();
				e.stopPropagation(); // evita colapsar a seção ao clicar
				handleEncerrar(h2.id, headingEl);
			});

			editSection.appendChild(btn);
			return true;
		}

		/**
		 * Processa todas as seções; retorna quantas ainda aguardam renderização.
		 * @return {number}
		 */
		function processHeadings() {
			var headings = document.querySelectorAll([
				'.section-heading',
				'div.mw-heading.mw-heading2',
				'div.mw-heading.mf-collapsible-heading'
			].join(', '));

			var pending = 0;
			Array.prototype.forEach.call(headings, function(headingEl) {
				try {
					if (!processHeading(headingEl)) {
						pending++;
					}
				} catch (e) {
					log('[AssistEnc] Erro ao processar seção:', e);
				}
			});
			return pending;
		}

		// Primeira passada; só observa o DOM se restarem seções sem menu renderizado
		if (processHeadings() === 0 || typeof MutationObserver === 'undefined') {
			return;
		}
		// Observa apenas o conteúdo da página (não o body inteiro)
		var root = document.getElementById('mw-content-text') || document.body;
		observer = new MutationObserver(function() {
			if (scheduled) {
				return;
			}
			scheduled = true;
			requestAnimationFrame(function() {
				scheduled = false;
				if (observer && processHeadings() === 0) {
					stop();
				}
			});
		});
		observer.observe(root, {
			childList: true,
			subtree: true
		});
		// Limite de segurança: nunca fica ativo indefinidamente
		timer = setTimeout(stop, 30000);
	}

	/**
	 * Fallback Minerva: botão simples ao lado do ⋯ quando a API OOUI
	 * não está acessível.
	 *
	 * @param {HTMLElement} headingEl
	 * @param {HTMLElement} h2
	 */
	function addMinervaFallbackButton(headingEl, h2) {
		if (headingEl.querySelector('.assistEnc-minerva-btn')) {
			return;
		}

		var btn = document.createElement('button');
		btn.className = 'assistEnc-minerva-btn mw-ui-button mw-ui-quiet';
		btn.textContent = 'Encerrar';
		btn.style.cssText = 'font-size:14px;padding:0 8px;vertical-align:middle;margin-left:4px;';
		btn.addEventListener('click', function() {
			handleEncerrar(h2.id, headingEl);
		});

		var menuBtn = headingEl.querySelector('.ext-discussiontools-init-section-overflowMenuButton');
		if (menuBtn) {
			menuBtn.parentNode.insertBefore(btn, menuBtn.nextSibling);
		} else {
			headingEl.appendChild(btn);
		}
	}

	/**
	 * Ponto de entrada comum ao clicar em "encerrar" em qualquer skin.
	 * Extrai o notificante do DOM, obtém os dados da seção UMA vez e delega
	 * para openDialog(). Ignora cliques enquanto outra abertura está em curso
	 * ou há uma interface aberta.
	 *
	 * @param {string}      anchor
	 * @param {HTMLElement} headingEl
	 */
	function handleEncerrar(anchor, headingEl) {
		if (opening || activeSession) {
			return;
		}
		opening = true;
		var cached = takeCachedSection(anchor);
		if (!cached) {
			notify('Obtendo dados da seção…');
		}

		var notificante = '';
		try {
			notificante = extractNotificante(headingEl);
		} catch (e) {
			log('[AssistEnc] Falha ao extrair o notificante:', e);
		}

		var source = cached ? $.Deferred().resolve(cached).promise() : fetchSection(anchor);
		source.then(function(data) {
			try {
				openDialog(anchor, data, notificante);
			} catch (e) {
				return $.Deferred().reject(e).promise();
			}
		}).then(null, function(err) {
			reportError(err, 'abrir interface');
		}).always(function() {
			opening = false;
		});
	}

	// ---------------------------------------------------------------------------
	// Bootstrap
	// ---------------------------------------------------------------------------

	function init() {
		if (!USER_NAME) {
			log('[AssistEnc] Usuário não autenticado; script inativo.');
			return;
		}
		api = new mw.Api({
			userAgent: 'AssistenteEncerramentos.js (User:Little Sunshine)'
		});
		$(addButtons);
		// Lê as seções em segundo plano para a abertura ser quase instantânea
		setTimeout(prefetchSections, PREFETCH_DELAY);
		// Pré-carrega o CodeMirror para o diálogo já abrir com ele
		setTimeout(loadCodeMirror, PREFETCH_DELAY);
	}

	mw.loader.using([
		'mediawiki.api',
		'mediawiki.util',
		'mediawiki.notification',
		'jquery.ui',
		'oojs-ui-core'
	]).then(function() {
		try {
			init();
		} catch (e) {
			window.assistEnc._loaded = false;
			reportError(e, 'inicialização');
		}
	}, function(err) {
		// Permite nova tentativa se o gadget for carregado de novo
		window.assistEnc._loaded = false;
		reportError(makeError('loader', 'Não foi possível carregar os módulos necessários ao AssistenteEncerramentos.', err), 'mw.loader');
	});

}());
//</nowiki>
