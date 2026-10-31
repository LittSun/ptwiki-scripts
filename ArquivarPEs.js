/*!
 * 
 * ArquivarPEs - Arquivar Páginas a eliminar
 *
 * Adiciona um link (um "Arquivar" na linha de ferramentas da PE)
 * para administradores e eliminadores nas páginas para eliminar
 * que faz as ações de fechamento automaticamente.
 *
 * Desenvolvido a partir do [[MediaWiki:Gadget-arquivarPEs.js]] e xfd-closer, da en.wiki
 *
 * Recursos de resultado por página, justificativa, lista de progresso com
 * "tentar de novo"/"abortar", verificação de conflito de edição, eliminação
 * de redirecionamentos e remoção de afluentes inspirados no XFDcloser
 * (https://github.com/wikimedia-gadgets/xfdcloser, licença MIT / CC BY-SA).
 *
 */
// Author: Francisco Venancio ([[Usuário:Chicocvenancio]]), Little Sunshine
/* jshint laxbreak: true, esversion: 8 */
/* global jQuery, mediaWiki, module */

( function ( $, mw ) {
	'use strict';

	const sig5 = '~~'.concat( '~', '~~' ),
		sig4 = '~~'.concat( '~~' ),
		PE_PREFIX = 'Wikipédia:Páginas para eliminar/',
		MONTHS = [ 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro' ],
		WITH_SCRIPT = '; processo assistido por [[Usuário:Little Sunshine/Scripts/ArquivarPEs.js|um script]]',
		BACKLINK_NS = '0|8|10|12|14|100|102',
		RESULTS = [
			{ name: 'Inconclusiva', archive: 'Arquivo de mantidas/', suffix: ' - inconclusiva' },
			{ name: 'Redirecionar', archive: 'Arquivo de mantidas/', suffix: ' - redirecionado' },
			{ name: 'Mantida', archive: 'Arquivo de mantidas/', suffix: '' },
			{ name: 'Eliminada', archive: 'Arquivo de eliminadas/', suffix: '' }
		],
		RESULT_BY_NAME = {},
		NOT_FINISHED = /\{\{Nomeação não concluída\|(\d*)(|\|prog=.*)\}\}/;

	RESULTS.forEach( function ( r ) {
		RESULT_BY_NAME[ r.name ] = r;
	} );

	function plural( n, one, many ) {
		return n === 1 ? one : many;
	}

	function joinResults( list ) {
		const u = list.filter( function ( x, i ) {
			return list.indexOf( x ) === i;
		} );
		if ( u.length <= 1 ) {
			return u[ 0 ] || '';
		}
		return u.slice( 0, -1 ).join( ', ' ) + ' e ' + u[ u.length - 1 ];
	}

	function closeWikitext( text, resultText, keepProg ) {
		if ( !NOT_FINISHED.test( text ) ) {
			return null;
		}
		return text.replace( NOT_FINISHED, function ( m, date, rest ) {
			return '{{Nomeação concluída|' + sig5 + '|' + resultText + ( keepProg ? rest : '' ) + '}}';
		} );
	}

	function findConclusionIndex( text ) {
		const comments = [],
			cre = /<!--[\s\S]*?(?:-->|$)/g,
			hre = /^(={2,6})[ \t]*Conclus[ãa]o[^=\n]*?[ \t]*\1[ \t]*$/gm;
		let m, last = -1;
		while ( ( m = cre.exec( text ) ) ) {
			comments.push( [ m.index, m.index + m[ 0 ].length ] );
			if ( m[ 0 ].length === 0 ) {
				cre.lastIndex++;
			}
		}
		while ( ( m = hre.exec( text ) ) ) {
			const start = m.index;
			if ( !comments.some( function ( c ) {
				return start >= c[ 0 ] && start < c[ 1 ];
			} ) ) {
				last = m.index + m[ 0 ].length;
			}
		}
		return last;
	}

	function getConclusionText( text ) {
		const idx = findConclusionIndex( text );
		if ( idx === -1 ) {
			return '';
		}
		let rest = text.slice( idx )
			.replace( /<!--[\s\S]*?(?:-->|$)/g, '' )
			.replace( /\[\[\s*Categoria\s*:[^\]]*\]\]/gi, '' );
		const next = rest.search( /^={2,6}[^=\n].*?={2,6}[ \t]*$/m );
		if ( next !== -1 ) {
			rest = rest.slice( 0, next );
		}
		return rest.trim();
	}

	function hasConclusionText( text ) {
		return getConclusionText( text ) !== '';
	}

	function insertRationale( text, block ) {
		const idx = findConclusionIndex( text );
		if ( idx === -1 ) {
			return text.replace( /\s+$/, '' ) + '\n\n' + block + '\n';
		}
		return text.slice( 0, idx ) + '\n' + block + text.slice( idx );
	}

	function archivePageName( archive, date ) {
		return PE_PREFIX + archive + MONTHS[ date.getMonth() ] + ' ' + date.getFullYear();
	}

	function archiveLine( pe, page, result ) {
		return '\n* [[' + pe + '| ' + page + ']] – [[:' + page + ']]' + RESULT_BY_NAME[ result ].suffix;
	}

	function escapeRegex( s ) {
		return s.replace( /[.*+?^${}()|[\]\\\/-]/g, '\\$&' );
	}

	function ciChar( ch ) {
		const l = ch.toLowerCase(), u = ch.toUpperCase();
		return l !== u ? '[' + escapeRegex( u ) + escapeRegex( l ) + ']' : escapeRegex( ch );
	}

	function textPattern( text, opts ) {
		let out = '';
		Array.from( text ).forEach( function ( ch, i ) {
			if ( ch === ' ' || ch === '_' ) {
				if ( !/\[ _\]\+$/.test( out ) ) {
					out += '[ _]+';
				}
			} else if ( opts.allCI || ( i === 0 && opts.firstCI ) ) {
				out += ciChar( ch );
			} else {
				out += escapeRegex( ch );
			}
		} );
		return out;
	}

	function buildLinkRegex( title ) {
		const t = mw.Title.newFromText( title );
		if ( !t ) {
			return null;
		}
		const ns = t.getNamespaceId(),
			rest = textPattern( t.getMainText(), { firstCI: true } );
		let nsPattern = '';
		if ( ns !== 0 ) {
			const ids = mw.config.get( 'wgNamespaceIds' ) || {},
				names = Object.keys( ids ).filter( function ( k ) {
					return k !== '' && ids[ k ] === ns;
				} );
			if ( !names.length ) {
				return null;
			}
			nsPattern = '(?:' + names.map( function ( n ) {
				return textPattern( n.replace( /_/g, ' ' ), { allCI: true } );
			} ).join( '|' ) + ')[ _]*:[ _]*';
		}
		const colon = ( ns === 6 || ns === 14 ) ? ':' : ':?';
		return new RegExp(
			'\\[\\[[ \\t]*(' + colon + ')[ \\t]*(' + nsPattern + rest + ')[ _]*(#[^\\]|\\[\\n]*)?(?:\\|([^\\[\\]\\n]*))?\\]\\]',
			'g'
		);
	}

	function unlinkWikitext( text, targets ) {
		const regexes = targets.map( buildLinkRegex ).filter( Boolean );
		if ( !regexes.length ) {
			return text;
		}
		const parts = text.split( /(<!--[\s\S]*?(?:-->|$)|<nowiki>[\s\S]*?<\/nowiki>|<pre[\s\S]*?<\/pre>)/i );
		return parts.map( function ( part, i ) {
			if ( i % 2 === 1 ) {
				return part;
			}
			return regexes.reduce( function ( acc, re ) {
				return acc.replace( re, function ( m, colon, target, frag, label ) {
					return label && label.trim() ? label : target;
				} );
			}, part );
		} ).join( '' );
	}

	function talkTitle( page ) {
		const t = mw.Title.newFromText( page ),
			tt = t && t.getTalkPage();
		if ( tt ) {
			return tt.getPrefixedText();
		}
		const colon = page.indexOf( ':' );
		return colon === -1 ? 'Discussão:' + page : page.substring( 0, colon ) + ' Discussão' + page.substring( colon );
	}

	let apiObj;

	function sleep( ms ) {
		return new Promise( function ( resolve ) {
			setTimeout( resolve, ms );
		} );
	}

	function apiCall( method, args ) {
		apiObj = apiObj || new mw.Api();
		return new Promise( function ( resolve, reject ) {
			apiObj[ method ].apply( apiObj, args ).then( resolve, function ( code, data ) {
				const info = data && data.error && data.error.info;
				const err = new Error( info ? code + ': ' + info : String( code ) );
				err.code = code;
				err.data = data;
				reject( err );
			} );
		} );
	}

	async function withRetry( fn ) {
		for ( let attempt = 1; ; attempt++ ) {
			try {
				return await fn();
			} catch ( e ) {
				if ( attempt >= 3 || [ 'http', 'timeout', 'ratelimited' ].indexOf( e.code ) === -1 ) {
					throw e;
				}
				await sleep( 1000 * attempt );
			}
		}
	}

	function apiGet( params ) {
		return withRetry( function () {
			return apiCall( 'get', [ params ] );
		} );
	}

	function apiPost( params ) {
		return withRetry( function () {
			return apiCall( 'postWithToken', [ 'csrf', params ] );
		} );
	}

	async function queryAll( params, listKey ) {
		let out = [], cont = {};
		for ( ;; ) {
			const data = await apiGet( Object.assign( {}, params, cont ) );
			out = out.concat( ( data.query && data.query[ listKey ] ) || [] );
			if ( !data.continue ) {
				return out;
			}
			cont = data.continue;
		}
	}

	async function fetchPage( title ) {
		const data = await apiGet( {
			action: 'query',
			prop: 'revisions',
			rvprop: 'content|timestamp',
			rvslots: 'main',
			formatversion: 2,
			titles: title
		} );
		const p = data.query && data.query.pages && data.query.pages[ 0 ];
		if ( !p || p.missing || p.invalid || !p.revisions ) {
			return { exists: false };
		}
		return { exists: true, text: p.revisions[ 0 ].slots.main.content, timestamp: p.revisions[ 0 ].timestamp };
	}

	async function editWithTransform( title, transform, summary ) {
		for ( let attempt = 1; ; attempt++ ) {
			const page = await fetchPage( title );
			if ( !page.exists ) {
				throw new Error( 'Página ' + title + ' não existe.' );
			}
			const newText = transform( page.text );
			if ( newText === null || newText === page.text ) {
				return { changed: false };
			}
			try {
				await apiPost( {
					action: 'edit',
					title: title,
					text: newText,
					summary: summary,
					basetimestamp: page.timestamp,
					nocreate: true
				} );
				return { changed: true };
			} catch ( e ) {
				if ( e.code === 'editconflict' && attempt < 3 ) {
					continue;
				}
				throw e;
			}
		}
	}

	class Run {
		/**
		 * @param {Object} opts
		 *  pe, pages [{title, result, target}], rationale, options {deleteRedirects, unlink, deletedCount},
		 *  ui {confirmDeleteRedirects(titles), reviewUnlink(titles)}, onChange, today
		 */
		constructor( opts ) {
			this.pe = opts.pe;
			this.rationale = ( opts.rationale || '' ).trim();
			this.options = opts.options || {};
			this.ui = opts.ui || {};
			this.onChange = opts.onChange || function () {};
			this.today = opts.today || new Date();
			this.running = false;
			this.aborted = false;
			this.tasks = [];
			this.pages = opts.pages.map( function ( p ) {
				return { title: p.title, result: p.result, target: p.target || '', main: [], archived: false };
			} );
			this.build();
		}

		emit() {
			this.onChange( this );
		}

		add( task ) {
			task.status = 'pending';
			task.msg = '';
			task.details = [];
			this.tasks.push( task );
			return task;
		}

		build() {
			this.closeTask = this.add( { label: 'Fechando a PE', run: () => this.doClose() } );
			this.pageTasks = [];
			this.pages.forEach( ( page ) => {
				const t = page.title;
				if ( page.result === 'Eliminada' ) {
					const del = this.add( { label: 'Eliminando ' + t, run: () => this.doDelete( page ) } );
					const talk = this.add( { label: 'Eliminando a discussão de ' + t, requires: del, run: () => this.doDeleteTalk( page ) } );
					page.main = [ del ];
					this.pageTasks.push( del, talk );
				} else if ( page.result === 'Redirecionar' ) {
					const redir = this.add( { label: 'Redirecionando ' + t + ' para ' + page.target, run: () => this.doRedirect( page ) } );
					page.main = [ redir ];
					this.pageTasks.push( redir );
				} else {
					const rm = this.add( { label: 'Retirando {{apagar4}} de ' + t, run: () => this.doRemoveTemplate( page ) } );
					const old = this.add( { label: 'Adicionando {{antigaPE}} à discussão de ' + t, requires: rm, run: () => this.doAddOldPfd( page ) } );
					page.main = [ rm, old ];
					this.pageTasks.push( rm, old );
				}
			} );

			this.archiveTasks = [];
			const groups = [];
			this.pages.forEach( function ( p ) {
				const a = RESULT_BY_NAME[ p.result ].archive;
				let g = groups.find( function ( x ) {
					return x.archive === a;
				} );
				if ( !g ) {
					g = { archive: a, pages: [] };
					groups.push( g );
				}
				g.pages.push( p );
			} );
			groups.forEach( ( g ) => {
				g.pageName = archivePageName( g.archive, this.today );
				this.archiveTasks.push( this.add( {
					label: 'Arquivando em ' + g.pageName,
					group: g,
					run: ( task ) => this.doArchive( task ),
					complete: () => g.pages.every( function ( p ) {
						return p.archived;
					} )
				} ) );
			} );

			this.extraTasks = [];
			if ( this.pages.some( function ( p ) {
				return p.result === 'Eliminada';
			} ) ) {
				this.addExtra( 'Verificando afluentes', ( task, pending ) => this.doInfo( task, pending ) );
				if ( this.options.unlink ) {
					this.addExtra( 'Removendo afluentes', ( task, pending ) => this.doUnlink( task, pending ) );
				}
				if ( this.options.deleteRedirects ) {
					this.addExtra( 'Eliminando redirecionamentos', ( task, pending ) => this.doDeleteRedirects( task, pending ) );
				}
			}
		}

		addExtra( label, fn ) {
			const task = this.add( {
				label: label,
				processed: new Set(),
				complete: () => this.pages.filter( function ( p ) {
					return p.result === 'Eliminada';
				} ).every( function ( p ) {
					return task.processed.has( p );
				} ),
				run: async () => {
					const pending = this.deletedPages().filter( function ( p ) {
						return !task.processed.has( p );
					} );
					if ( !pending.length ) {
						return { status: 'skipped', msg: 'nenhuma página eliminada com sucesso' };
					}
					const outcome = await fn( task, pending );
					if ( outcome && outcome.declined ) {
						task.declined = true;
						return { status: 'skipped', msg: outcome.msg };
					}
					pending.forEach( function ( p ) {
						task.processed.add( p );
					} );
					const left = this.pages.filter( function ( p ) {
						return p.result === 'Eliminada' && !task.processed.has( p );
					} );
					if ( left.length ) {
						return { status: 'skipped', msg: plural( left.length, 'pendente: ', 'pendentes: ' ) + left.map( function ( p ) {
							return p.title;
						} ).join( ', ' ) };
					}
					return outcome;
				}
			} );
			this.extraTasks.push( task );
			return task;
		}

		deletedPages() {
			return this.pages.filter( function ( p ) {
				return p.result === 'Eliminada' && p.main[ 0 ].status === 'done';
			} );
		}

		pageSucceeded( page ) {
			return page.main.every( function ( t ) {
				return t.status === 'done';
			} );
		}

		isComplete( task ) {
			if ( task.declined ) {
				return true;
			}
			return task.complete ? task.complete() : task.status === 'done';
		}

		incompleteTasks() {
			return this.tasks.filter( ( t ) => !this.isComplete( t ) );
		}

		abort() {
			this.aborted = true;
			this.emit();
		}

		async start() {
			if ( this.running ) {
				return;
			}
			this.running = true;
			this.aborted = false;
			this.tasks.forEach( function ( t ) {
				if ( t.status === 'skipped' && !t.declined ) {
					t.status = 'pending';
					t.msg = '';
				}
			} );
			this.emit();
			try {
				await this.runStage( [ this.closeTask ] );
				if ( this.closeTask.status !== 'done' ) {
					this.tasks.forEach( ( t ) => {
						if ( t !== this.closeTask && !this.isComplete( t ) ) {
							t.status = 'skipped';
							t.msg = 'a PE não foi fechada';
						}
					} );
					return;
				}
				await this.runStage( this.pageTasks );
				await this.runStage( this.archiveTasks );
				await this.runStage( this.extraTasks );
			} finally {
				this.running = false;
				this.emit();
			}
		}

		async runStage( tasks ) {
			for ( const task of tasks ) {
				if ( this.isComplete( task ) ) {
					continue;
				}
				if ( this.aborted ) {
					task.status = 'skipped';
					task.msg = 'abortado';
					continue;
				}
				await this.runTask( task );
				this.emit();
			}
		}

		async runTask( task ) {
			if ( task.requires && task.requires.status !== 'done' ) {
				task.status = 'skipped';
				task.msg = 'aguardando a etapa anterior';
				return;
			}
			task.status = 'running';
			task.msg = '';
			this.emit();
			try {
				const r = await task.run( task );
				task.status = ( r && r.status ) || 'done';
				if ( r && r.msg ) {
					task.msg = r.msg;
				}
			} catch ( e ) {
				task.status = 'failed';
				task.msg = e && e.message ? e.message : String( e );
			}
		}

		async doClose() {
			const results = this.pages.map( function ( p ) {
					return p.result;
				} ),
				resultText = joinResults( results ),
				keepProg = results.indexOf( 'Eliminada' ) !== -1,
				block = this.rationale ? ( /~{3,}/.test( this.rationale ) ? this.rationale : this.rationale + ' ' + sig4 ) : '';
			let skippedRationale = false;
			await editWithTransform( this.pe, function ( text ) {
				const out = closeWikitext( text, resultText, keepProg );
				if ( out === null ) {
					throw new Error( 'Predefinição de PE inconclusa não encontrada, por favor verifique a página da PE pela predefinição {{Nomeação não concluída|data (yyyymmdd)}}' );
				}
				if ( !block ) {
					return out;
				}
				if ( hasConclusionText( out ) ) {
					skippedRationale = true;
					return out;
				}
				return insertRationale( out, block );
			}, 'Fechando PE: ' + resultText + WITH_SCRIPT );
			if ( skippedRationale ) {
				return { msg: 'já havia texto de fechamento na Conclusão; justificativa não inserida' };
			}
		}

		async doDelete( page ) {
			try {
				await apiPost( { action: 'delete', title: page.title, reason: 'Decidido em [[' + this.pe + '|PE]]' + WITH_SCRIPT } );
			} catch ( e ) {
				if ( e.code === 'missingtitle' ) {
					return { msg: 'a página já não existia' };
				}
				throw e;
			}
		}

		async doDeleteTalk( page ) {
			try {
				await apiPost( {
					action: 'delete',
					title: talkTitle( page.title ),
					reason: 'Discussão de página eliminada por [[' + this.pe + '|PE]]' + WITH_SCRIPT
				} );
			} catch ( e ) {
				if ( e.code === 'missingtitle' ) {
					return { msg: 'não havia página de discussão' };
				}
				throw e;
			}
		}

		async doRemoveTemplate( page ) {
			const r = await editWithTransform(
				page.title,
				function ( text ) {
					return text.replace( /\{\{\s*apagar4[^}]+\}\}\n/g, '' );
				},
				'Retirando {{apagar4}}' + WITH_SCRIPT
			);
			return r.changed ? null : { msg: '{{apagar4}} não encontrada; nada a retirar' };
		}

		async doAddOldPfd( page ) {
			const result = page.result === 'Inconclusiva' ? 'inconclusivo' : 'manter';
			await apiPost( {
				action: 'edit',
				title: talkTitle( page.title ),
				prependtext: '{{antigaPE|resultado=' + result + '|' + page.title + '}}\n\n',
				summary: 'Adicionando predefinição de antigaPE' + WITH_SCRIPT
			} );
		}

		async doRedirect( page ) {
			const t = mw.Title.newFromText( page.target );
			if ( !t ) {
				throw new Error( 'título de destino inválido: ' + page.target );
			}
			const target = await fetchPage( t.getPrefixedText() );
			if ( !target.exists ) {
				throw new Error( 'a página de destino ' + t.getPrefixedText() + ' não existe' );
			}
			await editWithTransform(
				page.title,
				function () {
					return '#REDIRECIONAMENTO [[' + page.target + ']]';
				},
				'Redirecionando página' + WITH_SCRIPT
			);
		}

		async doArchive( task ) {
			const g = task.group,
				ready = g.pages.filter( ( p ) => !p.archived && this.pageSucceeded( p ) );
			if ( !ready.length ) {
				return { status: 'skipped', msg: 'nenhuma página pronta para arquivar' };
			}
			const day = this.today.getDate();
			await apiPost( {
				action: 'edit',
				title: g.pageName,
				appendtext: ready.map( ( p ) => archiveLine( this.pe, p.title, p.result ) ).join( '' ),
				section: day,
				summary: 'arquivando ' + ready.map( function ( p ) {
					return '[[' + p.title + ']]';
				} ).join( ', ' ) + WITH_SCRIPT
			} );
			ready.forEach( function ( p ) {
				p.archived = true;
			} );
			const monthName = ( mw.config.get( 'wgMonthNames' ) || [] )[ this.today.getMonth() + 1 ],
				url = mw.util.getUrl( g.pageName );
			task.details = [
				{ text: 'Abrir', href: url + ( monthName ? '#' + day + '_de_' + monthName : '' ) },
				{ text: '(diff)', href: mw.util.getUrl( g.pageName, { diff: 0 } ) }
			];
			const left = g.pages.filter( function ( p ) {
				return !p.archived;
			} );
			if ( left.length ) {
				return { status: 'skipped', msg: plural( left.length, 'pendente (ação falhou): ', 'pendentes (ação falhou): ' ) + left.map( function ( p ) {
					return p.title;
				} ).join( ', ' ) };
			}
		}

		async doInfo( task, pending ) {
			try {
				for ( const page of pending ) {
					const bl = await apiGet( {
							action: 'query',
							list: 'backlinks',
							bltitle: page.title,
							blnamespace: BACKLINK_NS,
							bllimit: 80,
							blredirect: 1,
							formatversion: 2
						} ),
						ei = await apiGet( {
							action: 'query',
							list: 'embeddedin',
							eititle: page.title,
							einamespace: BACKLINK_NS,
							eilimit: 80,
							formatversion: 2
						} );
					let n = bl.query.backlinks.length + ei.query.embeddedin.length;
					bl.query.backlinks.forEach( function ( b ) {
						n += ( b.redirlinks || [] ).length;
					} );
					task.details.push( {
						text: page.title + ': ' + ( n === 0 ? 'não há afluentes' : ( n >= 80 ? '80 ou mais afluentes' : n + plural( n, ' afluente', ' afluentes' ) ) ),
						href: mw.util.getUrl( 'Especial:Páginas afluentes/' + page.title )
					} );
				}
			} catch ( e ) {
				throw new Error( 'Houve um erro ao verificar afluentes ' + plural( pending.length, 'do artigo', 'dos artigos' ) + ', por favor faça manualmente. (' + e.message + ')' );
			}
		}

		async doDeleteRedirects( task, pending ) {
			let titles = [];
			for ( const page of pending ) {
				const list = await queryAll( {
					action: 'query',
					list: 'backlinks',
					bltitle: page.title,
					blfilterredir: 'redirects',
					bllimit: 'max',
					formatversion: 2
				}, 'backlinks' );
				titles = titles.concat( list.map( function ( b ) {
					return b.title;
				} ) );
			}
			titles = titles.filter( function ( x, i ) {
				return titles.indexOf( x ) === i;
			} );
			if ( !titles.length ) {
				return { msg: 'nenhum redirecionamento encontrado' };
			}
			if ( titles.length >= 10 && this.ui.confirmDeleteRedirects ) {
				const ok = await this.ui.confirmDeleteRedirects( titles );
				if ( !ok ) {
					return { declined: true, msg: 'cancelado pelo usuário' };
				}
			}
			const fails = [];
			for ( let i = 0; i < titles.length; i++ ) {
				if ( this.aborted ) {
					throw new Error( 'abortado' );
				}
				task.msg = ( i + 1 ) + '/' + titles.length;
				this.emit();
				try {
					await this.deleteIgnoringMissing( titles[ i ], 'Redirecionamento para página eliminada em [[' + this.pe + '|PE]]' + WITH_SCRIPT );
					await this.deleteIgnoringMissing( talkTitle( titles[ i ] ), 'Discussão de redirecionamento para página eliminada em [[' + this.pe + '|PE]]' + WITH_SCRIPT );
				} catch ( e ) {
					fails.push( titles[ i ] + ' (' + e.message + ')' );
				}
			}
			if ( fails.length ) {
				throw new Error( fails.length + plural( fails.length, ' falha: ', ' falhas: ' ) + fails.join( '; ' ) );
			}
			return { msg: titles.length + plural( titles.length, ' redirecionamento eliminado', ' redirecionamentos eliminados' ) };
		}

		async deleteIgnoringMissing( title, reason ) {
			try {
				await apiPost( { action: 'delete', title: title, reason: reason } );
			} catch ( e ) {
				if ( e.code !== 'missingtitle' ) {
					throw e;
				}
			}
		}

		async doUnlink( task, pending ) {
			const editMap = new Map(),
				gone = this.deletedPages().map( function ( p ) {
					return p.title;
				} ).concat( [ this.pe.replace( /_/g, ' ' ) ] );
			function addTarget( title, target ) {
				if ( gone.indexOf( title ) !== -1 ) {
					return;
				}
				if ( !editMap.has( title ) ) {
					editMap.set( title, new Set() );
				}
				editMap.get( title ).add( target );
			}
			for ( const page of pending ) {
				const list = await queryAll( {
					action: 'query',
					list: 'backlinks',
					bltitle: page.title,
					blnamespace: BACKLINK_NS,
					blfilterredir: 'nonredirects',
					bllimit: 'max',
					blredirect: 1,
					formatversion: 2
				}, 'backlinks' );
				list.forEach( function ( b ) {
					if ( b.redirect === true || b.redirect === '' ) {
						( b.redirlinks || [] ).forEach( function ( r ) {
							addTarget( r.title, b.title );
						} );
					} else {
						addTarget( b.title, page.title );
					}
				} );
			}
			const titles = Array.from( editMap.keys() ).sort();
			if ( !titles.length ) {
				return { msg: 'nenhum afluente a remover' };
			}
			let selected = titles;
			if ( this.ui.reviewUnlink ) {
				selected = await this.ui.reviewUnlink( titles, pending.length );
				if ( !selected || !selected.length ) {
					return { declined: true, msg: selected ? 'nenhuma página selecionada' : 'cancelado pelo usuário' };
				}
			}
			let edited = 0, unchanged = 0;
			const fails = [];
			for ( let i = 0; i < selected.length; i++ ) {
				if ( this.aborted ) {
					throw new Error( 'abortado' );
				}
				task.msg = ( i + 1 ) + '/' + selected.length;
				this.emit();
				const targets = Array.from( editMap.get( selected[ i ] ) );
				try {
					const r = await editWithTransform(
						selected[ i ],
						function ( text ) {
							return unlinkWikitext( text, targets );
						},
						plural( targets.length, 'Removendo ligação para ', 'Removendo ligações para ' ) + targets.map( function ( t ) {
							return '[[:' + t + ']]';
						} ).join( ', ' ) + ' (' + plural( targets.length, 'eliminada', 'eliminadas' ) + ' em [[' + this.pe + '|PE]])' + WITH_SCRIPT
					);
					if ( r.changed ) {
						edited++;
					} else {
						unchanged++;
					}
				} catch ( e ) {
					fails.push( selected[ i ] + ' (' + e.message + ')' );
				}
			}
			if ( fails.length ) {
				throw new Error( fails.length + plural( fails.length, ' falha: ', ' falhas: ' ) + fails.join( '; ' ) );
			}
			return { msg: edited + plural( edited, ' página editada', ' páginas editadas' ) + ( unchanged ? ', ' + unchanged + ' sem link encontrado' : '' ) };
		}
	}

	const CSS = '.ape-table{width:100%;border-collapse:collapse}.ape-table td{padding:3px 6px;vertical-align:middle}' +
		'.ape-target{width:100%;box-sizing:border-box}.ape-dialog textarea{width:100%;box-sizing:border-box}' +
		'.ape-error{color:#d33;font-weight:bold}.ape-tasks{list-style:none;margin:0;padding:0}.ape-tasks li{margin:.3em 0}' +
		'.ape-icon{display:inline-block;width:1.4em;text-align:center;font-weight:bold}' +
		'.ape-st-done .ape-icon{color:#14866d}.ape-st-failed .ape-icon{color:#d33}.ape-st-running .ape-icon{color:#36c}' +
		'.ape-st-skipped .ape-icon,.ape-st-pending .ape-icon{color:#72777d}.ape-msg{color:#54595d}' +
		'.ape-note{color:#54595d;font-style:italic}' +
		'.ape-checklist{max-height:300px;overflow:auto;border:1px solid #c8ccd1;padding:4px 8px}' +
		'.ape-extras{margin-top:.6em;border:1px solid #c8ccd1;padding:4px 8px}' +
		'.ape-parsed{max-height:220px;overflow:auto;border:1px solid #c8ccd1;background:#f8f9fa;color:#54595d;padding:4px 8px;margin:0 0 .5em}';

	const ICONS = { pending: '•', running: '⟳', done: '✔', failed: '✖', skipped: '–' };

	function makeSelect() {
		const $sel = $( '<select>' ).append( $( '<option value="">— escolher —</option>' ) );
		RESULTS.forEach( function ( r ) {
			$sel.append( $( '<option>' ).val( r.name ).text( r.name ) );
		} );
		return $sel;
	}

	function normalizeTarget( value ) {
		return $.trim( value || '' ).replace( /^\[\[|\]\]$/g, '' ).replace( /^\s+|\s+$/g, '' );
	}

	function promptDialog( title, $content, okText, collect ) {
		return new Promise( function ( resolve ) {
			let settled = false;
			function done( value ) {
				if ( !settled ) {
					settled = true;
					resolve( value );
				}
			}
			$content.dialog( {
				title: title,
				modal: true,
				width: 560,
				buttons: [
					{ text: okText, click: function () {
						done( collect() );
						$( this ).dialog( 'close' );
					} },
					{ text: 'Cancelar', click: function () {
						done( null );
						$( this ).dialog( 'close' );
					} }
				],
				close: function () {
					done( null );
					$( this ).dialog( 'destroy' ).remove();
				}
			} );
		} );
	}

	function confirmUnlinkWarning( count ) {
		return new Promise( function ( resolve ) {
			let settled = false, timer = null, left = 5;
			const $c = $( '<div class="ape-dialog">' ).append(
				$( '<p>' ).text( 'Atenção: Tem certeza que deseja eliminar os afluentes? Só faça isso se a recriação ' + plural( count, 'da página', 'das páginas' ) + ' de acordo com as políticas for improvável.' )
			);
			function done( value ) {
				if ( !settled ) {
					settled = true;
					resolve( value );
				}
			}
			function makeButtons() {
				return [
					{
						text: left > 0 ? 'Confirmar (' + left + ')' : 'Confirmar',
						disabled: left > 0,
						click: function () {
							if ( left > 0 ) {
								return;
							}
							done( 'confirm' );
							$( this ).dialog( 'close' );
						}
					},
					{ text: 'Manter afluentes', click: function () {
						done( 'keep' );
						$( this ).dialog( 'close' );
					} }
				];
			}
			$c.dialog( {
				title: 'Atenção',
				modal: true,
				width: 480,
				buttons: makeButtons(),
				open: function () {
					timer = setInterval( function () {
						left--;
						$c.dialog( 'option', 'buttons', makeButtons() );
						if ( left <= 0 ) {
							clearInterval( timer );
						}
					}, 1000 );
				},
				close: function () {
					clearInterval( timer );
					done( null );
					$( this ).dialog( 'destroy' ).remove();
				}
			} );
		} );
	}

	const dialogsUI = {
		confirmDeleteRedirects: function ( titles ) {
			const $c = $( '<div class="ape-dialog">' ),
				$ul = $( '<ul class="ape-checklist">' );
			titles.forEach( function ( t ) {
				$ul.append( $( '<li>' ).text( t ) );
			} );
			$c.append( $( '<p>' ).text( 'Ação em massa: ' + plural( titles.length, 'será eliminado ', 'serão eliminados ' ) + titles.length + plural( titles.length, ' redirecionamento', ' redirecionamentos' ) + ' (e ' + plural( titles.length, 'a respectiva página de discussão', 'as respectivas páginas de discussão' ) + ').' ), $ul );
			return promptDialog( 'Atenção', $c, 'Eliminar redirecionamentos', function () {
				return true;
			} );
		},
		reviewUnlink: function ( titles, deletedCount ) {
			const nLinking = titles.length;
			const $c = $( '<div class="ape-dialog">' ),
				$list = $( '<div class="ape-checklist">' );
			titles.forEach( function ( t ) {
				$list.append( $( '<div>' ).append(
					$( '<label>' ).append(
						$( '<input type="checkbox" checked>' ).val( t ), ' ',
						$( '<a>', { href: mw.util.getUrl( t ), target: '_blank', rel: 'noopener' } ).text( t )
					)
				) );
			} );
			const $toggle = $( '<a href="#">marcar/desmarcar todas</a>' ).on( 'click', function ( e ) {
				e.preventDefault();
				const boxes = $list.find( 'input' ), allOn = boxes.filter( ':checked' ).length === boxes.length;
				boxes.prop( 'checked', !allOn );
			} );
			$c.append(
				$( '<p>' ).text(
					plural( nLinking, 'Página que liga', 'Páginas que ligam' ) + ' ' +
					plural( deletedCount, 'à página eliminada', 'às páginas eliminadas' ) + '. ' +
					plural( nLinking, 'O link será removido (o texto fica) na página marcada:', 'Os links serão removidos (o texto fica) nas páginas marcadas:' )
				),
				nLinking > 1 ? $( '<p>' ).append( $toggle ) : $(),
				$list
			);
			return promptDialog( plural( nLinking, 'Remover afluente', 'Remover afluentes' ), $c, plural( nLinking, 'Remover link', 'Remover links' ), function () {
				return $list.find( 'input:checked' ).map( function () {
					return $( this ).val();
				} ).get();
			} );
		}
	};

	function readPages() {
		const out = [];
		$( '.PEferramentas' ).each( function () {
			const text = $.trim( $( this ).children().first().text() );
			if ( text && out.indexOf( text ) === -1 ) {
				out.push( text );
			}
		} );
		return out;
	}

	function openProgress( run ) {
		const $dlg = $( '<div class="ape-dialog">' ),
			$list = $( '<ul class="ape-tasks">' ),
			$summary = $( '<div class="ape-summary">' ),
			onUnload = function ( e ) {
				if ( run.running ) {
					e.preventDefault();
					e.returnValue = '';
					return '';
				}
			};
		$dlg.append( $list, $summary );

		function render() {
			$list.empty();
			run.tasks.forEach( function ( t ) {
				const $li = $( '<li>' ).addClass( 'ape-st-' + t.status ).append(
					$( '<span class="ape-icon">' ).text( ICONS[ t.status ] ), ' ', $( '<span>' ).text( t.label )
				);
				if ( t.msg ) {
					$li.append( ' ', $( '<span class="ape-msg">' ).text( '— ' + t.msg ) );
				}
				t.details.forEach( function ( d ) {
					$li.append( ' ', d.href ? $( '<a>', { href: d.href, target: '_blank', rel: 'noopener' } ).text( d.text ) : $( '<span>' ).text( d.text ) );
				} );
				$list.append( $li );
			} );
			const incomplete = run.incompleteTasks(),
				failed = incomplete.filter( function ( t ) {
					return t.status === 'failed';
				} );
			let title, buttons;
			if ( run.running ) {
				title = run.aborted ? 'Abortando…' : 'Em progresso';
				buttons = [ { text: 'Abortar', click: function () {
					run.abort();
				} } ];
				$summary.text( '' );
			} else if ( !incomplete.length ) {
				title = 'Sucesso';
				$summary.text( 'Sucesso em arquivar! Verifique as suas ações.' );
				buttons = [ { text: 'Fechar', click: function () {
					$( this ).dialog( 'close' );
				} } ];
			} else {
				title = failed.length ? 'Concluído com falhas' : 'Interrompido';
				$summary.text( plural( incomplete.length, 'Uma etapa não foi concluída. Você pode tentar de novo a que falhou.', 'Algumas etapas não foram concluídas. Você pode tentar de novo as que falharam.' ) + ' Verifique as suas ações.' );
				buttons = [
					{ text: 'Tentar de novo', click: function () {
						run.start();
					} },
					{ text: 'Fechar', click: function () {
						$( this ).dialog( 'close' );
					} }
				];
			}
			$dlg.dialog( 'option', 'title', title ).dialog( 'option', 'buttons', buttons );
		}

		run.onChange = render;
		window.addEventListener( 'beforeunload', onUnload );
		$dlg.dialog( {
			title: 'Em progresso',
			modal: true,
			width: 680,
			closeOnEscape: false,
			open: function () {
				$( this ).parent().find( '.ui-dialog-titlebar-close' ).hide();
			},
			close: function () {
				window.removeEventListener( 'beforeunload', onUnload );
				$( this ).dialog( 'destroy' ).remove();
			}
		} );
		render();
	}

	/**
	 * Carrega, antes de abrir o diálogo, todo o estado da PE que altera a interface:
	 * se já está encerrada, se a Conclusão já tem texto e o HTML renderizado dele.
	 * Em caso de falha das consultas, devolve o estado padrão (liberado).
	 */
	function loadPEState() {
		const pe = mw.config.get( 'wgPageName' );
		return Promise.all( [
			fetchPage( pe ).catch( function () {
				return null;
			} ),
			apiGet( {
				action: 'query',
				titles: pe,
				prop: 'templates',
				tltemplates: 'Predefinição:Nomeação concluída',
				formatversion: 2
			} ).catch( function () {
				return null;
			} )
		] ).then( async function ( res ) {
			const page = res[ 0 ], tpl = res[ 1 ],
				p = tpl && tpl.query && tpl.query.pages && tpl.query.pages[ 0 ],
				state = {
					closed: !!( p && p.templates && p.templates.length ),
					hasConclusion: false,
					conclusion: '',
					parsedHtml: null
				};
			if ( page && page.exists && hasConclusionText( page.text ) ) {
				state.hasConclusion = true;
				state.conclusion = getConclusionText( page.text );
				try {
					const data = await apiCall( 'post', [ {
						action: 'parse',
						text: state.conclusion,
						title: pe,
						contentmodel: 'wikitext',
						prop: 'text',
						disablelimitreport: 1,
						disableeditsection: 1,
						formatversion: 2
					} ] );
					state.parsedHtml = data.parse.text;
				} catch ( e ) {
					state.parsedHtml = null;
				}
			}
			return state;
		} );
	}

	let peStatePromise = null,
		opening = false;

	async function openDialog() {
		if ( opening ) {
			return;
		}
		const titles = readPages();
		if ( !titles.length ) {
			window.alert( 'Nenhuma página encontrada nas ferramentas da PE.' );
			return;
		}
		opening = true;
		$( 'body' ).css( 'cursor', 'progress' );
		let state;
		try {
			peStatePromise = peStatePromise || loadPEState();
			state = await peStatePromise;
		} finally {
			opening = false;
			$( 'body' ).css( 'cursor', '' );
		}

		const $dlg = $( '<div class="ape-dialog">' ),
			$table = $( '<table class="ape-table">' ),
			$allSel = makeSelect(),
			$allRow = $( '<p>' ).append( 'Mesmo resultado para todas: ', $allSel ).toggle( titles.length > 1 ),
			$rationale = $( '<textarea rows="4">' ),
			$note = $( '<p class="ape-note">' ).hide(),
			$closedNote = $( '<p class="ape-error">' ).hide(),
			$parsed = $( '<div class="ape-parsed">' ).hide(),
			$delRedirs = $( '<input type="checkbox">' ),
			$unlinkBl = $( '<input type="checkbox">' ),
			$delRedirsText = $( '<span>' ),
			$unlinkText = $( '<span>' ),
			$extras = $( '<div class="ape-extras">' ).hide().append(
				$( '<div>' ).append( $( '<label>' ).append( $delRedirs, ' ', $delRedirsText ) )
				//, $( '<div>' ).append( $( '<label>' ).append( $unlinkBl, ' ', $unlinkText ) )
			),
			$error = $( '<p class="ape-error">' );

		function countDeleted() {
			return rows.filter( function ( r ) {
				return r.$sel.val() === 'Eliminada';
			} ).length;
		}

		function refresh() {
			const n = countDeleted();
			$extras.toggle( n > 0 );
			$delRedirsText.text( plural( n, 'Eliminar redirecionamentos para a página eliminada', 'Eliminar redirecionamentos para as páginas eliminadas' ) );
			$unlinkText.text( plural( n, 'Remover afluentes (links) da página eliminada', 'Remover afluentes (links) das páginas eliminadas' ) );
		}

		const rows = titles.map( function ( title ) {
			const $sel = makeSelect(),
				$target = $( '<input type="text" class="ape-target" placeholder="Redirecionar para…">' ).hide();
			$sel.on( 'change', function () {
				$target.toggle( $sel.val() === 'Redirecionar' );
				refresh();
			} );
			$table.append( $( '<tr>' ).append(
				$( '<td>' ).append( $( '<a>', { href: mw.util.getUrl( title ), target: '_blank', rel: 'noopener' } ).text( title ) ),
				$( '<td>' ).append( $sel ),
				$( '<td>' ).append( $target )
			) );
			return { title: title, $sel: $sel, $target: $target };
		} );

		$allSel.on( 'change', function () {
			const v = $allSel.val();
			if ( v ) {
				rows.forEach( function ( r ) {
					r.$sel.val( v ).trigger( 'change' );
				} );
			}
			rows.forEach( function ( r ) {
				r.$sel.toggle( !v );
			} );
		} );

		$dlg.append(
			$( '<p>' ).text( 'Que tipo de arquivamento deseja fazer? ' + plural( titles.length, 'Escolha o resultado da página.', 'Escolha o resultado de cada página.' ) ),
			$closedNote,
			$allRow,
			$table,
			$( '<p>' ).append( $( '<label>' ).text( 'Justificativa (opcional; vai para a seção de conclusão, com assinatura):' ) ),
			$note, $parsed, $rationale, $extras, $error
		);

		function lockDialog() {
			$closedNote.text( 'Esta PE já está encerrada (a predefinição {{Nomeação concluída}} já está na página); não é possível arquivar novamente.' ).show();
			$allSel.prop( 'disabled', true );
			rows.forEach( function ( r ) {
				r.$sel.prop( 'disabled', true );
				r.$target.prop( 'disabled', true );
			} );
			$rationale.prop( 'disabled', true );
			$delRedirs.prop( 'disabled', true );
			$unlinkBl.prop( 'disabled', true );
			$extras.hide();
		}

		if ( state.hasConclusion ) {
			$note.text( 'A seção Conclusão já contém texto de fechamento; a justificativa não será inserida.' ).show();
			$rationale.prop( 'disabled', true ).val( state.conclusion );
			if ( state.parsedHtml !== null ) {
				$rationale.hide();
				$parsed.html( state.parsedHtml ).show();
				$parsed.find( 'a' ).attr( { target: '_blank', rel: 'noopener' } );
			}
		}

		if ( state.closed ) {
			lockDialog();
		}

		$dlg.dialog( {
			title: 'Arquivar PE',
			modal: true,
			width: 680,
			open: function () {
				$( this ).parent().find( '.ui-dialog-titlebar-close' ).hide();
			},
			close: function () {
				$( this ).dialog( 'destroy' ).remove();
			},
			buttons: [
				{ text: 'Arquivar', disabled: state.closed, click: async function () {
					const $this = $( this );
					const data = rows.map( function ( r ) {
						return { title: r.title, result: r.$sel.val(), target: normalizeTarget( r.$target.val() ) };
					} );
					let problem = '';
					data.forEach( function ( d ) {
						if ( problem ) {
							return;
						}
						if ( !d.result ) {
							problem = 'Escolha o resultado de "' + d.title + '".';
						} else if ( d.result === 'Redirecionar' ) {
							const t = mw.Title.newFromText( d.target ),
								self = mw.Title.newFromText( d.title );
							if ( !d.target || !t ) {
								problem = 'Informe uma página de destino válida para "' + d.title + '".';
							} else if ( self && t.getPrefixedText() === self.getPrefixedText() ) {
								problem = 'A página de destino de "' + d.title + '" não pode ser ela mesma.';
							}
						}
					} );
					if ( problem ) {
						$error.text( problem );
						return;
					}
					$error.text( '' );
					const deletedCount = data.filter( function ( d ) {
							return d.result === 'Eliminada';
						} ).length,
						anyDeleted = deletedCount > 0;
					let wantUnlink = anyDeleted && $unlinkBl.prop( 'checked' );
					if ( wantUnlink ) {
						const choice = await confirmUnlinkWarning( deletedCount );
						if ( choice === null ) {
							return; // cancelou: volta ao diálogo principal sem arquivar
						}
						if ( choice === 'keep' ) {
							wantUnlink = false;
							$unlinkBl.prop( 'checked', false );
						}
					}
					const run = new Run( {
						pe: mw.config.get( 'wgPageName' ),
						pages: data,
						rationale: $rationale.val(),
						options: {
							deleteRedirects: anyDeleted && $delRedirs.prop( 'checked' ),
							unlink: wantUnlink,
							deletedCount: deletedCount
						},
						ui: dialogsUI
					} );
					peStatePromise = null;
					$this.dialog( 'close' );
					openProgress( run );
					run.start();
				} },
				{ text: 'Cancelar', click: function () {
					$( this ).dialog( 'close' );
				} }
			]
		} );
	}

	function addArchiveLink( element ) {
		const $archivePFD = $( '<a href="#">Arquivar</a>' ).on( 'click', function ( e ) {
				e.preventDefault();
				openDialog();
			} ),
			second = $( element ).children()[ 1 ];
		if ( second ) {
			$( second ).before( $archivePFD ).before( ' | ' ).after( ' ' );
		} else {
			$( element ).append( ' ', $archivePFD );
		}
	}

	function init() {
		const $toolbars = $( '.PEferramentas' );
		if ( !$toolbars.length ) {
			return;
		}
		mw.util.addCSS( CSS );
		peStatePromise = loadPEState();
		addArchiveLink( $toolbars.first() );
	}

	if ( typeof module !== 'undefined' && module.exports ) {
		module.exports = {
			Run: Run, joinResults: joinResults, closeWikitext: closeWikitext, insertRationale: insertRationale,
			findConclusionIndex: findConclusionIndex, getConclusionText: getConclusionText, hasConclusionText: hasConclusionText,
			unlinkWikitext: unlinkWikitext, archiveLine: archiveLine,
			archivePageName: archivePageName, talkTitle: talkTitle
		};
		return;
	}

	mw.loader.using( [ 'mediawiki.api', 'mediawiki.util', 'mediawiki.Title' ] ).then( function () {
		return mw.loader.using( 'jquery.ui' ).then( null, function () {
			return null;
		} );
	} ).then( function () {
		$( init );
	} );

}( jQuery, mediaWiki ) );
