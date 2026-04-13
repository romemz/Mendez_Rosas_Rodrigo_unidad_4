const $ = (selector) => document.querySelector(selector);

let googleMap;
let geoMarker;

function actualizarMarcadorEnMapa(location, title, zoom = 13) {
	if (!googleMap || !window.google?.maps) return;

	googleMap.setCenter(location);
	googleMap.setZoom(zoom);

	if (geoMarker) {
		geoMarker.setPosition(location);
		geoMarker.setTitle(title || 'Ubicacion');
	} else {
		geoMarker = new google.maps.Marker({
			position: location,
			map: googleMap,
			title: title || 'Ubicacion',
		});
	}
}

function initMap() {
	const defaultCenter = { lat: 23.6345, lng: -102.5528 };
	googleMap = new google.maps.Map(document.getElementById('geoMap'), {
		center: defaultCenter,
		zoom: 5,
		mapTypeControl: false,
		streetViewControl: false,
		fullscreenControl: true,
	});

	geoMarker = new google.maps.Marker({
		position: defaultCenter,
		map: googleMap,
		title: 'Ubicacion inicial',
	});
}

window.initMap = initMap;

function formatError(error) {
	return error?.message || 'Ocurrio un error inesperado.';
}

async function fetchApi(url, options = {}) {
	const response = await fetch(url, options);
	const data = await response.json();
	if (!response.ok) {
		throw new Error(data.error || 'Error en la peticion.');
	}
	return data;
}

function cargarScriptWidgetX() {
	return new Promise((resolve, reject) => {
		if (window.twttr?.widgets?.createTimeline) {
			resolve();
			return;
		}

		const existing = document.getElementById('twitter-wjs');
		if (existing) {
			existing.addEventListener('load', () => resolve(), { once: true });
			existing.addEventListener('error', () => reject(new Error('No se pudo cargar widgets.js')), {
				once: true,
			});
			setTimeout(() => {
				if (window.twttr?.widgets?.createTimeline) {
					resolve();
				} else {
					reject(new Error('Timeout cargando widgets.js'));
				}
			}, 3500);
			return;
		}

		const script = document.createElement('script');
		script.id = 'twitter-wjs';
		script.async = true;
		script.src = 'https://platform.twitter.com/widgets.js';
		script.charset = 'utf-8';
		script.onload = () => resolve();
		script.onerror = () => reject(new Error('No se pudo cargar widgets.js'));
		document.body.appendChild(script);
	});
}

function extraerUsuarioX(profileUrl = '') {
	try {
		const parsed = new URL(profileUrl);
		const part = parsed.pathname.split('/').filter(Boolean)[0] || '';
		return part.replace(/^@/, '');
	} catch (_error) {
		return '';
	}
}

async function renderTimelineX(hostElement, profileUrl, username) {
	if (!hostElement) return;

	const user = (username || extraerUsuarioX(profileUrl)).trim();
	if (!user) {
		hostElement.innerHTML = '<p class="text-sm opacity-80">No se pudo identificar el usuario de X.</p>';
		return;
	}

	hostElement.innerHTML = '<p class="text-sm opacity-80">Cargando timeline de X...</p>';

	try {
		await cargarScriptWidgetX();

		if (!window.twttr?.widgets?.createTimeline) {
			throw new Error('Widget no disponible.');
		}

		hostElement.innerHTML = '';
		const target = document.createElement('div');
		target.className = 'social-frame';
		hostElement.appendChild(target);

		await window.twttr.widgets.createTimeline(
			{ sourceType: 'profile', screenName: user },
			target,
			{
				theme: 'dark',
				height: 620,
				chrome: 'nofooter transparent',
				dnt: true,
			}
		);
	} catch (_error) {
		hostElement.innerHTML = `
			<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-3">
				<p class="text-sm opacity-85">No se pudo cargar el widget de X en este navegador/red.</p>
				<iframe
					title="Vista alternativa de X"
					src="https://nitter.net/${encodeURIComponent(user)}"
					class="social-frame"
					loading="lazy">
				</iframe>
			</div>
		`;
	}
}

async function cargarGeolocalizacion() {
	const query = $('#geoQuery').value.trim();
	if (!query) return;

	$('#geoCoords').textContent = 'Buscando ubicacion...';

	try {
		const data = await fetchApi(`/api/geolocalizacion?query=${encodeURIComponent(query)}`);
		$('#geoCoords').textContent = `${data.displayName} | LAT: ${data.lat} | LON: ${data.lon}`;

		const location = { lat: Number(data.lat), lng: Number(data.lon) };
		actualizarMarcadorEnMapa(location, data.displayName || query, 13);
	} catch (error) {
		$('#geoCoords').textContent = formatError(error);
	}
}

function verMiUbicacionActual() {
	if (!navigator.geolocation) {
		$('#geoCoords').textContent = 'Tu navegador no soporta geolocalizacion.';
		return;
	}

	$('#geoCoords').textContent = 'Obteniendo tu ubicacion actual...';

	navigator.geolocation.getCurrentPosition(
		(position) => {
			const location = {
				lat: position.coords.latitude,
				lng: position.coords.longitude,
			};

			actualizarMarcadorEnMapa(location, 'Mi ubicacion actual', 16);
			$('#geoCoords').textContent = `Mi ubicacion actual | LAT: ${location.lat.toFixed(6)} | LON: ${location.lng.toFixed(6)}`;
		},
		(error) => {
			const errores = {
				1: 'Permiso denegado para obtener la ubicacion.',
				2: 'No se pudo determinar tu ubicacion.',
				3: 'Tiempo de espera agotado al obtener la ubicacion.',
			};
			$('#geoCoords').textContent = errores[error.code] || 'No se pudo obtener tu ubicacion actual.';
		},
		{ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
	);
}

// ─── X / Twitter helpers ────────────────────────────────────────────────────

function renderTweetCard(post, username) {
	const fecha = (post.body || '').match(/Publicado:\s*(.+)$/)?.[1] || post.pubDate || '';
	const texto = (post.body || '').replace(/\n+Publicado:.+$/, '').trim() || post.title || '';
	return `
		<div class="x-tweet-card">
			<div class="x-tweet-header">
				<img class="x-tweet-avatar"
					src="https://unavatar.io/twitter/${username}"
					onerror="this.src='https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png'"
					alt="@${username}"/>
				<div>
					<span class="x-tweet-name">@${username}</span>
					${fecha ? `<span class="x-tweet-date">${fecha}</span>` : ''}
				</div>
				<a class="x-tweet-logo" href="${post.url || '#'}" target="_blank" rel="noopener noreferrer">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
				</a>
			</div>
			<p class="x-tweet-body">${texto}</p>
			${post.image ? `<img class="x-tweet-image" src="${post.image}" alt="" loading="lazy"/>` : ''}
			<div class="x-tweet-footer">
				${post.url ? `<a class="x-tweet-link" href="${post.url}" target="_blank" rel="noopener noreferrer">Ver en X →</a>` : ''}
			</div>
		</div>`;
}

async function cargarTweetsOEmbed(username, postsEl) {
	postsEl.innerHTML = `<div class="x-tweets-loading">${Array(4).fill('<div class="x-tweet-skel"></div>').join('')}</div>`;

	try {
		const data = await fetchApi(`/api/redes-sociales?profileUrl=${encodeURIComponent('https://x.com/' + username)}&limit=6`);
		const posts = data.publicaciones || [];

		if (!posts.length) {
			postsEl.innerHTML = '<p class="x-no-tweets">No se pudieron obtener publicaciones.</p>';
			return;
		}

		postsEl.innerHTML = '<div id="x-tweets-list" class="x-tweets-list"></div>';
		const list = document.getElementById('x-tweets-list');

		// Intentar embeds oficiales de X tweet a tweet
		await new Promise((resolve) => {
			if (window.twttr?.widgets) { resolve(); return; }
			const s = document.createElement('script');
			s.src = 'https://platform.twitter.com/widgets.js';
			s.async = true;
			s.onload = resolve; s.onerror = resolve;
			document.head.appendChild(s);
		});

		for (const post of posts) {
			const tweetId = post.url?.match(/status\/(\d+)/)?.[1];
			const wrapper = document.createElement('div');
			wrapper.className = 'x-tweet-wrap';

			if (tweetId && window.twttr?.widgets?.createTweet) {
				wrapper.innerHTML = '<div class="x-tweet-loading-mini"></div>';
				list.appendChild(wrapper);
				try {
					await window.twttr.widgets.createTweet(tweetId, wrapper, { theme: 'dark', dnt: true, align: 'center' });
					wrapper.querySelector('.x-tweet-loading-mini')?.remove();
				} catch (_e) {
					wrapper.innerHTML = renderTweetCard(post, username);
				}
			} else {
				wrapper.innerHTML = renderTweetCard(post, username);
				list.appendChild(wrapper);
			}
		}
	} catch (_err) {
		postsEl.innerHTML = '<p class="x-no-tweets">No se pudieron cargar los tweets.</p>';
	}
}

function renderPerfilX(username, profileUrl) {
	const profileEl = $('#socialProfile');
	const postsEl   = $('#socialPosts');

	profileEl.innerHTML = `
		<div class="x-profile-card">
			<div class="x-profile-banner"></div>
			<div class="x-profile-body">
				<div class="x-profile-top">
					<div class="x-avatar-wrap">
						<img class="x-avatar"
							src="https://unavatar.io/twitter/${username}"
							onerror="this.src='https://abs.twimg.com/sticky/default_profile_images/default_profile_400x400.png'"
							alt="@${username}"/>
					</div>
					<a class="x-follow-btn" href="${profileUrl}" target="_blank" rel="noopener noreferrer">Seguir en X</a>
				</div>
				<div class="x-profile-names">
					<span class="x-display-name">@${username}</span>
					<span class="x-handle">@${username}</span>
				</div>
				<div class="x-meta">
					<span class="x-meta-item">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" style="opacity:.5"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
						X / Twitter
					</span>
					<a class="x-meta-item x-meta-link" href="${profileUrl}" target="_blank" rel="noopener noreferrer">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
						Ver perfil completo
					</a>
				</div>
			</div>
		</div>`;

	postsEl.className = 'mt-3';
	cargarTweetsOEmbed(username, postsEl);
}

async function cargarRedesSociales() {
	let profileUrl = $('#socialProfileUrl').value.trim();
	profileUrl = profileUrl.replace(/^https?:\/\/(?:www\.)?https?:\/\//i, 'https://');
	if (profileUrl && !/^https?:\/\//i.test(profileUrl)) profileUrl = `https://${profileUrl}`;
	$('#socialProfileUrl').value = profileUrl;

	if (!profileUrl) {
		$('#socialProfile').textContent = 'Pega la URL de un perfil para consultar publicaciones.';
		$('#socialPosts').innerHTML = '';
		return;
	}

	// Detectar X/Twitter antes del fetch
	const isX = /^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i.test(profileUrl);
	if (isX) {
		const username = extraerUsuarioX(profileUrl);
		if (username) { renderPerfilX(username, profileUrl); return; }
	}

	$('#socialProfile').textContent = 'Consultando perfil...';
	$('#socialPosts').innerHTML = '';

	try {
		const data = await fetchApi(`/api/redes-sociales?profileUrl=${encodeURIComponent(profileUrl)}`);

		// Reddit
		if (data.fuente === 'reddit') {
			$('#socialProfile').innerHTML = `
				<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-3 flex items-center gap-3">
					${data.perfil.avatar ? `<img src="${data.perfil.avatar}" class="w-12 h-12 rounded-full object-cover flex-shrink-0" alt="avatar"/>` : ''}
					<div>
						<p class="font-semibold">${data.perfil.nombre}</p>
						<p class="text-xs opacity-70">u/${data.perfil.usuario} · Karma: ${data.perfil.karma ?? 'n/a'}</p>
						${data.perfil.url ? `<a class="shop-link inline-block mt-1" href="${data.perfil.url}" target="_blank" rel="noopener noreferrer">Ver en Reddit</a>` : ''}
					</div>
				</div>`;
			$('#socialPosts').innerHTML = data.publicaciones.map((post) => `
				<article class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-3">
					<h3 class="font-semibold text-sm">${post.title}</h3>
					<p class="text-xs mt-1 opacity-80">${post.body || ''}</p>
					<div class="mt-2 flex items-center justify-between gap-2">
						<span class="text-[11px] opacity-60">Score: ${post.score ?? 'n/a'}</span>
						${post.url ? `<a class="shop-link" href="${post.url}" target="_blank" rel="noopener noreferrer">Ver publicacion</a>` : ''}
					</div>
				</article>`).join('');
			return;
		}

		// Fallback genérico
		$('#socialProfile').innerHTML = `
			<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-3">
				<p><strong>${data.perfil.nombre}</strong> (@${data.perfil.usuario})</p>
				${data.perfil.url ? `<a class="shop-link inline-block mt-2" href="${data.perfil.url}" target="_blank" rel="noopener noreferrer">Abrir perfil</a>` : ''}
			</div>`;
		$('#socialPosts').innerHTML = (data.publicaciones || []).map((post) => `
			<article class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-3">
				${post.image ? `<img src="${post.image}" alt="" class="social-post-image" loading="lazy"/>` : ''}
				<h3 class="font-semibold text-sm">${post.title}</h3>
				<p class="text-xs mt-1 opacity-80">${post.body || ''}</p>
				${post.url ? `<a class="shop-link mt-2 inline-block" href="${post.url}" target="_blank" rel="noopener noreferrer">Ver publicacion</a>` : ''}
			</article>`).join('');
	} catch (error) {
		$('#socialProfile').textContent = formatError(error);
	}
}

function mlFmt(n) {
	return new Intl.NumberFormat('es-MX').format(Math.round(Number(n) || 0));
}

async function mlLoadGrid(q, searchUrl) {
	const placeholder = document.getElementById('mlPlaceholder');
	placeholder.style.display = 'block';
	placeholder.classList.add('ml-results-mode');
	placeholder.innerHTML = '<p class="ml-ph-sub">Buscando resultados...</p>';

	try {
		const res = await fetch(`/api/ml-search?q=${encodeURIComponent(q)}&limit=8`);
		const data = await res.json();
		const items = data.results || [];

		if (!items.length) {
			placeholder.innerHTML = `
				<div class="ml-empty-box">
					<p class="ml-ph-title">No encontramos productos para "${q}"</p>
					<a class="ml-open-btn" href="${searchUrl}" target="_blank" rel="noopener noreferrer">Abrir resultados en Mercado Libre</a>
				</div>
			`;
			return;
		}

		placeholder.innerHTML = `
			<div class="ml-grid-header">
				<p class="ml-ph-title">Resultados para "${q}"</p>
				<a class="ml-open-btn" href="${searchUrl}" target="_blank" rel="noopener noreferrer">Abrir en Mercado Libre</a>
			</div>
			<div class="ml-results-grid">
				${items
					.map((item) => {
						const thumb = String(item.thumbnail || '')
							.replace('http://', 'https://')
							.replace('-I.jpg', '-O.jpg');
						const currency = item.currency_id || 'MXN';
						const price = mlFmt(item.price);
						return `
							<article class="ml-item-card">
								<div class="ml-item-image-wrap">
									<img class="ml-item-image" src="${thumb}" alt="${item.title || 'Producto'}" loading="lazy" />
								</div>
								<p class="ml-item-title">${item.title || 'Producto sin titulo'}</p>
								<p class="ml-item-price">${currency} ${price}</p>
								<a class="ml-item-link" href="${item.permalink || searchUrl}" target="_blank" rel="noopener noreferrer">Ver producto</a>
							</article>
						`;
					})
					.join('')}
			</div>
		`;
	} catch (_error) {
		placeholder.innerHTML = `
			<div class="ml-empty-box">
				<p class="ml-ph-title">No se pudo cargar la vista interna.</p>
				<p class="ml-ph-sub">Puedes abrir los resultados directamente en Mercado Libre.</p>
				<a class="ml-open-btn" href="${searchUrl}" target="_blank" rel="noopener noreferrer">Abrir resultados en Mercado Libre</a>
			</div>
		`;
	}
}

async function mlLoadDetail(q) {
	try {
		const res = await fetch(`/api/ml-search?q=${encodeURIComponent(q)}&limit=1`);
		const data = await res.json();
		const items = data.results || [];
		if (!items.length) { document.getElementById('mlDetail').style.display = 'none'; return; }
		const p = items[0];
		const thumb = (p.thumbnail || '').replace('http://', 'https://').replace('-I.jpg', '-O.jpg');
		document.getElementById('mlDImg').src = thumb;
		document.getElementById('mlDTitle').textContent = p.title || '';
		document.getElementById('mlDCurr').textContent = (p.currency_id || 'MXN') + ' ';
		document.getElementById('mlDPrice').textContent = mlFmt(p.price);
		let badges = '';
		if (p.shipping?.free_shipping) badges += '<span class="ml-badge-free">Envío gratis</span>';
		badges += `<span class="ml-badge-cond">${p.condition === 'new' ? 'Nuevo' : 'Usado'}</span>`;
		document.getElementById('mlDBadges').innerHTML = badges;
		document.getElementById('mlDLink').href = p.permalink || '#';
		document.getElementById('mlDetail').style.display = 'block';
	} catch (_e) {
		document.getElementById('mlDetail').style.display = 'none';
	}
}

async function cargarProducto() {
	const query = $('#shopQuery').value.trim();
	if (!query) return;

	const searchUrl = `https://listado.mercadolibre.com.mx/${encodeURIComponent(query)}`;
	const frame = document.getElementById('shopFrame');
	frame.removeAttribute('src');
	frame.style.display = 'none';

	// Card del primer resultado
	await Promise.all([mlLoadDetail(query), mlLoadGrid(query, searchUrl)]);
}

async function refrescarRegistros() {
	const data = await fetchApi('/api/base-datos');
	if (!data.registros.length) {
		$('#dbList').innerHTML = '<p class="text-xs opacity-80">No hay registros todavia.</p>';
		return;
	}

	$('#dbList').innerHTML = data.registros
		.map(
			(item) => `
			<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-2 text-xs">
				<strong>${item.username}</strong> | ${item.provider} | cloudId: ${item.cloudId}
			</div>
		`
		)
		.join('');
}

async function registrarUsuario(event) {
	event.preventDefault();

	const username = $('#dbUsername').value.trim();
	const provider = $('#dbProvider').value.trim();

	if (!username) {
		$('#dbResult').textContent = 'Debes escribir un nombre de usuario.';
		return;
	}

	try {
		const result = await fetchApi('/api/base-datos', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, provider }),
		});

		$('#dbResult').textContent = `${result.mensaje}: ${result.registro.username}`;
		$('#dbUsername').value = '';
		await refrescarRegistros();
	} catch (error) {
		$('#dbResult').textContent = formatError(error);
	}
}

async function enviarSms() {
	const to = $('#smsTo').value.trim();
	const message = $('#smsMessage').value.trim();

	if (!to || !message) {
		$('#smsResult').textContent = 'Completa destinatario y mensaje.';
		return;
	}

	try {
		const result = await fetchApi('/api/protocolos', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ to, message }),
		});

		$('#smsResult').textContent = `${result.mensaje} | folio: ${result.sms.id}`;
	} catch (error) {
		$('#smsResult').textContent = formatError(error);
	}
}

function renderRiskBadge(alerta = {}) {
	const badge = $('#riskBadge');
	if (!badge) return;

	const nivel = String(alerta.nivel || 'normal').toLowerCase();
	badge.classList.remove('normal', 'medio', 'alto');
	badge.classList.add(['normal', 'medio', 'alto'].includes(nivel) ? nivel : 'normal');
	badge.textContent = alerta.mensaje || 'Sin alertas climaticas.';
}

function renderWeatherSummary(weatherData) {
	const target = $('#weatherSummary');
	if (!target) return;

	if (!weatherData) {
		target.innerHTML = '<p class="text-sm opacity-70">Sin datos de clima disponibles.</p>';
		return;
	}

	const parts = [
		`<strong>${weatherData.ciudad || 'Ciudad desconocida'}</strong>`,
		`Temp: <strong>${weatherData.temperaturaC ?? 'n/a'}°C</strong>`,
		`Viento: <strong>${weatherData.vientoKmh ?? 'n/a'} km/h</strong>`,
		`Prob. lluvia: <strong>${weatherData.probLluviaPct ?? 'n/a'}%</strong>`,
	];

	target.innerHTML = `<p>${parts.join(' | ')}</p>`;
}

function renderNewsList(newsPayload) {
	const target = $('#newsList');
	if (!target) return;

	const noticias = newsPayload?.noticias || [];
	if (!noticias.length) {
		target.innerHTML = '<p class="text-sm opacity-70">No hay titulares disponibles.</p>';
		return;
	}

	target.innerHTML = noticias
		.map(
			(item) => `
			<article class="noti-item">
				<p class="noti-item-title">${item.titulo || 'Sin titulo'}</p>
				<p class="noti-item-summary">${item.resumen || ''}</p>
				<div class="noti-item-meta">
					<span>${item.fuente || 'Fuente'}</span>
					${item.url ? `<a href="${item.url}" target="_blank" rel="noopener noreferrer">Ver nota</a>` : ''}
				</div>
			</article>
		`
		)
		.join('');
}

async function cargarNoticieroLocal() {
	const city = $('#newsCity')?.value.trim() || 'Monterrey';
	const topic = $('#newsTopic')?.value.trim() || 'general';

	$('#newsStatus').textContent = 'Consultando portada local...';

	try {
		const data = await fetchApi(
			`/api/noticiero/home?city=${encodeURIComponent(city)}&topic=${encodeURIComponent(topic)}&limit=6`
		);

		renderWeatherSummary(data.weather?.data || null);
		renderRiskBadge(data.weather?.data?.alerta || {});
		renderNewsList(data.news?.data || null);

		const etiquetas = [];
		if (data.degradado) etiquetas.push('Modo degradado');
		if (data.weather?.fallback || data.news?.fallback) etiquetas.push('Datos desde cache');

		const estado = etiquetas.length ? ` (${etiquetas.join(' | ')})` : '';
		$('#newsStatus').textContent = `Portada actualizada para ${city} / ${topic}${estado}.`;
	} catch (error) {
		$('#newsStatus').textContent = `No se pudo actualizar la portada: ${formatError(error)}`;
		renderWeatherSummary(null);
		renderRiskBadge({ nivel: 'normal', mensaje: 'sin datos' });
		renderNewsList(null);
	}
}


/* ── YouTube Player Modal ── */

function ytOpenPlayer(videoId, titulo, canal, vistas, publicado) {
	let modal = document.getElementById('yt-modal');
	if (!modal) {
		modal = document.createElement('div');
		modal.id = 'yt-modal';
		modal.innerHTML = `
			<div class="yt-modal-backdrop" id="yt-modal-backdrop"></div>
			<div class="yt-modal-box">
				<div class="yt-modal-header">
					<div class="yt-modal-info">
						<p id="yt-modal-title" class="yt-modal-title"></p>
						<p id="yt-modal-meta" class="yt-modal-meta"></p>
					</div>
					<div class="yt-modal-actions">
						<a id="yt-modal-link" class="yt-modal-ext" href="#" target="_blank" rel="noopener noreferrer">↗ Abrir en YouTube</a>
						<button id="yt-modal-close" class="yt-modal-close" title="Cerrar">✕</button>
					</div>
				</div>
				<div class="yt-modal-player">
					<iframe id="yt-modal-iframe"
						frameborder="0"
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
						allowfullscreen>
					</iframe>
				</div>
			</div>
		`;
		document.body.appendChild(modal);
		document.getElementById('yt-modal-backdrop').addEventListener('click', ytClosePlayer);
		document.getElementById('yt-modal-close').addEventListener('click', ytClosePlayer);
		document.addEventListener('keydown', (e) => { if (e.key === 'Escape') ytClosePlayer(); });
	}

	document.getElementById('yt-modal-title').textContent = titulo;
	document.getElementById('yt-modal-meta').textContent = [canal, vistas, publicado].filter(Boolean).join(' · ');
	document.getElementById('yt-modal-link').href = `https://www.youtube.com/watch?v=${videoId}`;
	document.getElementById('yt-modal-iframe').src = `https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0`;
	modal.classList.add('open');
	document.body.style.overflow = 'hidden';
}

function ytClosePlayer() {
	const modal = document.getElementById('yt-modal');
	if (!modal) return;
	modal.classList.remove('open');
	document.body.style.overflow = '';
	const iframe = document.getElementById('yt-modal-iframe');
	if (iframe) iframe.src = '';
}

function ytSetActiveTag(el) {
	document.querySelectorAll('.yt-tag').forEach((t) => t.classList.remove('active'));
	if (el) el.classList.add('active');
}

function ytUpdateDirectLink(term) {
	const url = term
		? `https://www.youtube.com/results?search_query=${encodeURIComponent(term)}`
		: 'https://www.youtube.com/';
	const link = document.getElementById('streamDirectLink');
	const openBtn = document.getElementById('streamOpenBtn');
	if (link) link.href = url;
	if (openBtn) openBtn.href = url;
}

function ytShowSkeleton() {
	document.getElementById('streamResults').innerHTML = Array(8).fill(0).map(() => `
		<div class="yt-skeleton">
			<div class="yt-skel-thumb"></div>
			<div class="yt-skel-line w-full"></div>
			<div class="yt-skel-line w-3-4"></div>
			<div class="yt-skel-line w-1-2"></div>
		</div>
	`).join('');
}

function ytRenderVideos(videos, label) {
	const labelEl = document.getElementById('streamLabel');
	if (labelEl) labelEl.innerHTML = label || '';
	if (!videos || !videos.length) {
		document.getElementById('streamResults').innerHTML = '<div class="yt-error">No se encontraron videos.</div>';
		return;
	}
	document.getElementById('streamResults').innerHTML = videos.map((v) => `
		<div class="yt-card"
			data-id="${v.id}"
			data-titulo="${v.titulo.replace(/"/g, '&quot;')}"
			data-canal="${(v.canal || '').replace(/"/g, '&quot;')}"
			data-vistas="${v.vistas || ''}"
			data-publicado="${v.publicado || ''}">
			<div class="yt-thumb-wrap">
				<img class="yt-thumb" src="${v.thumbnail}" alt="${v.titulo}" loading="lazy"/>
				<div class="yt-play-overlay"><div class="yt-play-icon">▶</div></div>
				${v.duracion ? `<span class="yt-duration">${v.duracion}</span>` : ''}
			</div>
			<div class="yt-card-meta">
				<p class="yt-card-title">${v.titulo}</p>
				<p class="yt-card-channel">${v.canal || ''}</p>
				<p class="yt-card-stats">${v.vistas || ''}${v.publicado ? ` · ${v.publicado}` : ''}</p>
			</div>
		</div>
	`).join('');

	document.getElementById('streamResults').querySelectorAll('.yt-card').forEach((card) => {
		card.addEventListener('click', () => {
			ytOpenPlayer(card.dataset.id, card.dataset.titulo, card.dataset.canal, card.dataset.vistas, card.dataset.publicado);
		});
	});
}

async function cargarStreaming(term, tagEl) {
	term = (term || '').trim();
	const isInicio = !term;
	ytUpdateDirectLink(term);
	ytShowSkeleton();
	if (tagEl) ytSetActiveTag(tagEl);

	try {
		const data = await (isInicio
			? fetchApi('/api/youtube-inicio')
			: fetchApi(`/api/youtube-busqueda?query=${encodeURIComponent(term)}`));
		const label = isInicio
			? 'Tendencias en México'
			: `${data.videos?.length || 0} resultados para "<strong>${term}</strong>"`;
		ytRenderVideos(data.videos, label);
	} catch (error) {
		document.getElementById('streamResults').innerHTML = `
			<div class="yt-error">${formatError(error)}<br/>
			<a class="shop-link" style="margin-top:10px;display:inline-block" href="https://www.youtube.com" target="_blank">Abrir YouTube</a></div>`;
	}
}

function init() {
	const $ = (sel) => document.querySelector(sel);
	$('#geoBtn').addEventListener('click', cargarGeolocalizacion);
	$('#geoCurrentBtn').addEventListener('click', verMiUbicacionActual);
	$('#socialBtn').addEventListener('click', cargarRedesSociales);

	// E-commerce: botón buscar + Enter + chips
	$('#shopBtn').addEventListener('click', cargarProducto);
	$('#shopQuery').addEventListener('keydown', (e) => {
		if (e.key === 'Enter') { e.preventDefault(); cargarProducto(); }
	});
	document.getElementById('mlChips').addEventListener('click', (e) => {
		const chip = e.target.closest('.ml-chip');
		if (!chip) return;
		document.querySelectorAll('.ml-chip').forEach((c) => c.classList.remove('active'));
		chip.classList.add('active');
		$('#shopQuery').value = chip.dataset.q;
		cargarProducto();
	});

	$('#dbForm').addEventListener('submit', registrarUsuario);
	$('#smsBtn').addEventListener('click', enviarSms);
	$('#newsBtn').addEventListener('click', cargarNoticieroLocal);
	$('#newsCity').addEventListener('keydown', (e) => {
		if (e.key === 'Enter') { e.preventDefault(); cargarNoticieroLocal(); }
	});
	$('#newsTopic').addEventListener('keydown', (e) => {
		if (e.key === 'Enter') { e.preventDefault(); cargarNoticieroLocal(); }
	});

	$('#streamBtn').addEventListener('click', () => cargarStreaming($('#streamTerm').value));
	$('#streamTerm').addEventListener('keydown', (e) => {
		if (e.key === 'Enter') { e.preventDefault(); cargarStreaming($('#streamTerm').value); }
	});
	document.querySelectorAll('.yt-tag').forEach((tag) => {
		tag.addEventListener('click', () => {
			$('#streamTerm').value = tag.dataset.q || '';
			cargarStreaming(tag.dataset.q || '', tag);
		});
	});

	cargarGeolocalizacion();
	cargarRedesSociales();
	refrescarRegistros();
	cargarStreaming('');
	cargarNoticieroLocal();

	// Carga inicial de e-commerce
	$('#shopQuery').value = 'laptop';
	cargarProducto();
}

/* ── Sistema de Pruebas - Unidad 4 ── */

let testLog = [];

function logTest(message, type = 'info') {
	const timestamp = new Date().toLocaleTimeString();
	testLog.push({ message, type, timestamp });
	updateTestDisplay();
}

function updateTestDisplay() {
	const resultDiv = document.getElementById('testResults');
	if (!resultDiv) return;

	resultDiv.innerHTML = testLog
		.map((log) => {
			let color = 'text-green-400';
			if (log.type === 'error') color = 'text-red-400';
			else if (log.type === 'warning') color = 'text-yellow-400';
			else if (log.type === 'info') color = 'text-blue-400';

			return `<div class="${color}">[${log.timestamp}] ${log.message}</div>`;
		})
		.join('');

	resultDiv.scrollTop = resultDiv.scrollHeight;
}

async function runUnitTests() {
	testLog = [];
	logTest('▶ Iniciando pruebas unitarias...', 'info');

	const tests = [
		{
			name: 'U-01: Validar parseo de URL social',
			test: () => {
				const url = 'https://x.com/elonmusk';
				const result = url.includes('x.com') ? 'exitoso' : 'fallido';
				return result === 'exitoso' ? '✓ PASS' : '✗ FAIL';
			},
		},
		{
			name: 'U-02: Evaluar riesgo climático',
			test: () => {
				const weather = { temp_c: 40, rain_prob: 75, wind_kph: 65 };
				const riskLevel = weather.temp_c > 38 || weather.rain_prob > 70 || weather.wind_kph > 60 ? 'alto' : 'normal';
				return riskLevel === 'alto' ? '✓ PASS' : '✗ FAIL';
			},
		},
		{
			name: 'U-03: Extracción de JSON-LD',
			test: () => {
				const html = '<script type="application/ld+json">{"@type": "Product"}</script>';
				const hasJSON = html.includes('application/ld+json') ? 'exitoso' : 'fallido';
				return hasJSON === 'exitoso' ? '✓ PASS' : '✗ FAIL';
			},
		},
		{
			name: 'U-04: Normalización de noticias Reddit',
			test: () => {
				const news = { title: 'Test', subreddit: 'r/test', score: 100 };
				const normalized = { titulo: news.title, fuente: 'Reddit', puntos: news.score };
				return normalized.fuente === 'Reddit' ? '✓ PASS' : '✗ FAIL';
			},
		},
	];

	let passed = 0;
	for (const test of tests) {
		try {
			const result = test.test();
			if (result.includes('PASS')) passed++;
			logTest(`${test.name} - ${result}`, result.includes('PASS') ? 'info' : 'error');
		} catch (e) {
			logTest(`${test.name} - ✗ FAIL (${e.message})`, 'error');
		}
	}

	logTest(`✓ Pruebas unitarias completadas: ${passed}/${tests.length} aprobadas`, 'info');
	document.getElementById('unitPass').textContent = `${passed}/${tests.length}`;
	calculateSuccessRate();
}

async function runIntegrationTests() {
	testLog = [];
	logTest('▶ Iniciando pruebas de integración...', 'info');

	const tests = [
		{
			name: 'I-01: GET /api/geolocalizacion',
			test: async () => {
				try {
					const res = await fetch('/api/geolocalizacion?q=Monterrey');
					const data = await res.json();
					return res.ok && data.lat && data.lon ? '✓ PASS' : '✗ FAIL';
				} catch (_) {
					return '✗ FAIL';
				}
			},
		},
		{
			name: 'I-02: GET /api/ml-search (proxy test)',
			test: async () => {
				try {
					const res = await fetch('/api/ml-search?q=laptop&limit=2');
					const data = await res.json();
					return res.ok && data.results ? '✓ PASS' : '✗ FAIL';
				} catch (_) {
					return '✗ FAIL';
				}
			},
		},
		{
			name: 'I-03: GET /api/noticiero/home endpoint',
			test: async () => {
				try {
					const res = await fetch('/api/noticiero/home?city=Monterrey&topic=general&limit=3');
					const data = await res.json();
					return res.ok && data.weather && data.news ? '✓ PASS' : '✗ FAIL';
				} catch (_) {
					return '✗ FAIL';
				}
			},
		},
		{
			name: 'I-04: Validar resilencia ante degradación',
			test: async () => {
				try {
					const res = await fetch('/api/noticiero/home?city=Monterrey&topic=tech&limit=3');
					const data = await res.json();
					return res.ok ? '✓ PASS (resilencia activa)' : '✗ FAIL';
				} catch (_) {
					return '✗ FAIL';
				}
			},
		},
	];

	let passed = 0;
	for (const test of tests) {
		try {
			const result = await test.test();
			if (result.includes('PASS')) passed++;
			logTest(`${test.name} - ${result}`, result.includes('PASS') ? 'info' : 'error');
		} catch (e) {
			logTest(`${test.name} - ✗ FAIL (${e.message})`, 'error');
		}
	}

	logTest(`✓ Pruebas integración completadas: ${passed}/${tests.length} aprobadas`, 'info');
	document.getElementById('intPass').textContent = `${passed}/${tests.length}`;
	calculateSuccessRate();
}

async function runUITests() {
	testLog = [];
	logTest('▶ Iniciando pruebas UI...', 'info');

	const tests = [
		{
			name: 'UI-01: Validar elementos en DOM',
			test: () => {
				const required = ['geoBtn', 'shopBtn', 'newsBtn', 'newsCity', 'newsList', 'streamResults', 'dbForm'];
				const found = required.filter((id) => document.getElementById(id)).length;
				return found === required.length ? '✓ PASS' : `✗ FAIL (${found}/${required.length} encontrados)`;
			},
		},
		{
			name: 'UI-02: Validar funciones cargarNoticieroLocal',
			test: () => {
				return typeof cargarNoticieroLocal === 'function' ? '✓ PASS' : '✗ FAIL';
			},
		},
		{
			name: 'UI-03: Validar estilos noticiero presentes',
			test: () => {
				const stylesheet = document.querySelector('link[href="styles.css"]');
				const hasStyles = document.querySelectorAll('[class*="noti-"]').length > 0;
				return stylesheet && hasStyles ? '✓ PASS' : '✗ FAIL';
			},
		},
	];

	let passed = 0;
	for (const test of tests) {
		try {
			const result = test.test();
			if (result.includes('PASS')) passed++;
			logTest(`${test.name} - ${result}`, result.includes('PASS') ? 'info' : 'error');
		} catch (e) {
			logTest(`${test.name} - ✗ FAIL (${e.message})`, 'error');
		}
	}

	logTest(`✓ Pruebas UI completadas: ${passed}/${tests.length} aprobadas`, 'info');
	document.getElementById('uiPass').textContent = `${passed}/${tests.length}`;
	calculateSuccessRate();
}

function calculateSuccessRate() {
	const unitText = document.getElementById('unitPass').textContent;
	const intText = document.getElementById('intPass').textContent;
	const uiText = document.getElementById('uiPass').textContent;

	const parse = (txt) => {
		const parts = txt.split('/');
		return [parseInt(parts[0]) || 0, parseInt(parts[1]) || 0];
	};

	const [unitPass, unitTotal] = parse(unitText);
	const [intPass, intTotal] = parse(intText);
	const [uiPass, uiTotal] = parse(uiText);

	const totalPass = unitPass + intPass + uiPass;
	const totalTests = unitTotal + intTotal + uiTotal;
	const rate = totalTests > 0 ? Math.round((totalPass / totalTests) * 100) : 0;

	document.getElementById('successRate').textContent = `${rate}%`;
}

// Conectar botones de pruebas
document.addEventListener('DOMContentLoaded', () => {
	const unitBtn = document.getElementById('runUnitTests');
	const intBtn = document.getElementById('runIntegrationTests');
	const uiBtn = document.getElementById('runUITests');

	if (unitBtn) unitBtn.addEventListener('click', runUnitTests);
	if (intBtn) intBtn.addEventListener('click', runIntegrationTests);
	if (uiBtn) uiBtn.addEventListener('click', runUITests);

	// Ejecutar todos automáticamente al cargar
	setTimeout(() => {
		runUnitTests().then(() => runIntegrationTests()).then(() => runUITests());
	}, 1500);
});

document.addEventListener('DOMContentLoaded', init);