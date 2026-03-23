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

async function cargarRedesSociales() {
	let profileUrl = $('#socialProfileUrl').value.trim();
	profileUrl = profileUrl.replace(/^https?:\/\/(?:www\.)?https?:\/\//i, 'https://');
	if (profileUrl && !/^https?:\/\//i.test(profileUrl)) {
		profileUrl = `https://${profileUrl}`;
	}
	$('#socialProfileUrl').value = profileUrl;

	if (!profileUrl) {
		$('#socialProfile').textContent = 'Pega la URL de un perfil para consultar publicaciones.';
		$('#socialPosts').innerHTML = '';
		return;
	}

	$('#socialProfile').textContent = 'Consultando perfil...';
	$('#socialPosts').innerHTML = '';

	try {
		const data = await fetchApi(`/api/redes-sociales?profileUrl=${encodeURIComponent(profileUrl)}`);

		if (data.fuente === 'facebook-embed' && data.embedUrl) {
			$('#socialProfile').innerHTML = `
				<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-3">
					<p><strong>${data.perfil.nombre}</strong> (@${data.perfil.usuario})</p>
					<p class="text-xs opacity-75">Fuente: ${data.fuente} | ${data.aviso}</p>
					<a class="shop-link inline-block mt-2" href="${data.perfil.url}" target="_blank" rel="noopener noreferrer">Abrir perfil</a>
				</div>
			`;

			$('#socialPosts').innerHTML = `
				<div class="md:col-span-2 bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-3">
					<iframe
						title="Timeline de Facebook"
						src="${data.embedUrl}"
						class="w-full h-[620px] rounded-md border border-outline-variant/40"
						style="overflow:hidden"
						scrolling="no"
						frameborder="0"
						allowfullscreen="true"
						allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share">
					</iframe>
				</div>
			`;
			return;
		}

		$('#socialProfile').innerHTML = `
			<div class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-3">
				<p><strong>${data.perfil.nombre}</strong> (@${data.perfil.usuario})</p>
				<p class="text-xs opacity-75">Fuente: ${data.fuente} | ${data.perfil.empresa || 'Sin empresa'} | Karma: ${data.perfil.karma ?? 'n/a'}</p>
				${data.perfil.url ? `<a class="shop-link inline-block mt-2" href="${data.perfil.url}" target="_blank" rel="noopener noreferrer">Abrir perfil</a>` : ''}
			</div>
		`;

		const xFrame =
			data.fuente === 'x-rss' && data.perfil?.url
				? `
				<div class="md:col-span-2 bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-3">
					<p class="text-[11px] opacity-70 mb-2">Vista de X</p>
					<p class="text-sm opacity-85">En este entorno el embed de X se bloquea. Se muestran publicaciones extraidas y enlaces directos.</p>
					<p class="text-[11px] opacity-75 mt-2">
						Abrir perfil completo en X:
						<a class="shop-link ml-1" href="${data.perfil.url}" target="_blank" rel="noopener noreferrer">Perfil en X</a>
					</p>
				</div>
			`
				: '';

		const postsHtml = data.publicaciones
			.map(
				(post) => `
				<article class="bg-surface-container-lowest border border-outline-variant/30 rounded-lg p-3">
					${post.image ? `<img src="${post.image}" alt="Imagen de publicacion" class="social-post-image" loading="lazy" />` : ''}
					<h3 class="font-semibold text-sm">${post.title}</h3>
					<p class="text-xs mt-1 opacity-80">${post.body || 'Sin descripcion.'}</p>
					<div class="mt-2 flex items-center justify-between gap-2">
						<span class="text-[11px] opacity-60">Score: ${post.score ?? 'n/a'}</span>
						${post.url ? `<a class="shop-link" href="${post.url}" target="_blank" rel="noopener noreferrer">Ver publicacion</a>` : ''}
					</div>
				</article>
			`
			)
			.join('');

		$('#socialPosts').innerHTML = `${xFrame}${postsHtml}`;
	} catch (error) {
		$('#socialProfile').textContent = formatError(error);
	}
}

function mlFmt(n) {
	return new Intl.NumberFormat('es-MX').format(Math.round(Number(n) || 0));
}

async function mlLoadDetail(q) {
	try {
		const res = await fetch(`https://api.mercadolibre.com/sites/MLM/search?q=${encodeURIComponent(q)}&limit=1`);
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

	// Iframe de resultados reales
	const slug = query.replace(/\s+/g, '-');
	const searchUrl = `https://listado.mercadolibre.com.mx/${encodeURIComponent(slug)}`;
	const frame = document.getElementById('shopFrame');
	frame.src = searchUrl;
	frame.style.display = 'block';
	document.getElementById('mlPlaceholder').style.display = 'none';

	// Card del primer resultado
	mlLoadDetail(query);
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

	// Carga inicial de e-commerce
	$('#shopQuery').value = 'laptop';
	cargarProducto();
}

document.addEventListener('DOMContentLoaded', init);