const express = require('express');
const path = require('path');
const { agregarRegistro, obtenerRegistros } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

async function fetchJson(url, options = {}) {
	const response = await fetch(url, options);
	if (!response.ok) {
		const error = new Error(`Error en servicio externo: ${response.status}`);
		error.status = response.status;
		throw error;
	}
	return response.json();
}

function normalizarImagen(url = '') {
	if (!url) return '';
	if (url.startsWith('http://')) {
		return `https://${url.slice('http://'.length)}`;
	}
	return url;
}

function extraerProductoDesdeHtmlMercadoLibre(html) {
	const scriptRegex = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
	let match = scriptRegex.exec(html);

	while (match) {
		try {
			const json = JSON.parse(match[1]);
			const graph = Array.isArray(json['@graph']) ? json['@graph'] : [];
			const producto = graph.find(
				(item) => item['@type'] === 'Product' && item.offers?.price && item.name
			);

			if (producto) {
				return {
					id: `ML-HTML-${Date.now()}`,
					titulo: producto.name,
					precio: producto.offers.price,
					imagen: normalizarImagen(producto.image),
					categoria: 'mercado-libre',
					descripcion: 'Producto obtenido de Mercado Libre (fallback HTML).',
					moneda: producto.offers.priceCurrency || 'MXN',
					url: producto.offers.url,
				};
			}
		} catch (_error) {
			// Ignora bloques JSON-LD no relacionados con productos.
		}

		match = scriptRegex.exec(html);
	}

	return null;
}

function parseSocialProfileUrl(rawUrl = '') {
	try {
		const url = new URL(rawUrl);
		const host = url.hostname.toLowerCase().replace(/^www\./, '');
		const pathParts = url.pathname.split('/').filter(Boolean);

		if (host === 'reddit.com' && pathParts[0] === 'user' && pathParts[1]) {
			return {
				platform: 'reddit',
				username: pathParts[1],
			};
		}

		if (host === 'facebook.com' && pathParts[0]) {
			return {
				platform: 'facebook',
				username: pathParts[0],
			};
		}

		if ((host === 'x.com' || host === 'twitter.com') && pathParts[0]) {
			const username = pathParts[0].replace(/^@/, '');
			if (!username) return null;

			return {
				platform: 'x',
				username,
			};
		}

		return null;
	} catch (_error) {
		return null;
	}
}

function extraerTagXml(block = '', tag = '') {
	if (!block || !tag) return '';
	const safeTag = tag.replace(':', '\\:');
	const regex = new RegExp(`<${safeTag}[^>]*>([\\s\\S]*?)</${safeTag}>`, 'i');
	const match = block.match(regex);
	return match ? match[1].trim() : '';
}

function decodeHtmlEntities(text = '') {
	return text
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&nbsp;/g, ' ');
}

function limpiarHtmlBasico(text = '') {
	return decodeHtmlEntities(text)
		.replace(/<br\s*\/?\s*>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function limpiarTextoPublicacion(text = '') {
	return decodeHtmlEntities(String(text || ''))
		.replace(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi, ' ')
		.replace(/\[[^\]]+\]\((https?:\/\/[^)]+)\)/gi, ' ')
		.replace(/https?:\/\/t\.co\/\S+/gi, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function extraerImagenDesdeTexto(text = '') {
	const content = String(text || '');

	const htmlImgMatch = content.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/i);
	if (htmlImgMatch?.[1]) return htmlImgMatch[1];

	const markdownImgMatch = content.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/i);
	if (markdownImgMatch?.[1]) return markdownImgMatch[1];

	const pbsMatch = content.match(/https?:\/\/pbs\.twimg\.com\/[^\s)"']+/i);
	if (pbsMatch?.[0]) return pbsMatch[0];

	return '';
}

function parsearItemsRss(xml = '') {
	const items = [];
	const itemRegex = /<item>([\s\S]*?)<\/item>/g;
	let match = itemRegex.exec(xml);

	while (match) {
		const block = match[1];
		const title = limpiarHtmlBasico(extraerTagXml(block, 'title'));
		const link = extraerTagXml(block, 'link');
		const pubDate = extraerTagXml(block, 'pubDate');
		const guid = extraerTagXml(block, 'guid');

		const encoded = extraerTagXml(block, 'content:encoded');
		const description = extraerTagXml(block, 'description');
		const rawContent = encoded || description;
		const body = limpiarTextoPublicacion(limpiarHtmlBasico(rawContent));
		const image = extraerImagenDesdeTexto(rawContent);

		items.push({
			id: guid || link || `item-${items.length + 1}`,
			title: title || (body ? body.slice(0, 80) : 'Publicacion'),
			body,
			image,
			url: link,
			pubDate,
		});

		match = itemRegex.exec(xml);
	}

	return items;
}

async function obtenerPostsXDesdeNitter(username, limit) {
	const instances = [
		'https://nitter.net',
		'https://nitter.privacydev.net',
		'https://nitter.poast.org',
	];

	for (const baseUrl of instances) {
		try {
			const rssUrl = `${baseUrl}/${encodeURIComponent(username)}/rss`;
			const response = await fetch(rssUrl, {
				headers: {
					'User-Agent': 'Mozilla/5.0',
					Accept: 'application/rss+xml, text/xml;q=0.9, */*;q=0.8',
				},
			});

			if (!response.ok) {
				continue;
			}

			const xml = await response.text();
			const items = parsearItemsRss(xml).slice(0, limit);

			if (items.length) {
				return { items, source: baseUrl };
			}
		} catch (_error) {
			// Prueba con la siguiente instancia si falla la actual.
		}
	}

	const error = new Error('No fue posible obtener publicaciones publicas de X en este momento.');
	error.status = 502;
	throw error;
}

function parsearPostsXDesdeMarkdown(markdown = '', username = '', limit = 5) {
	const lines = String(markdown || '').split(/\r?\n/);
	const posts = [];
	const seen = new Set();

	for (let i = 0; i < lines.length; i += 1) {
		const line = lines[i].trim();
		if (!line) continue;

		const match = line.match(/status\/(\d{8,})/i);
		if (!match) continue;

		const tweetId = match[1];
		if (!tweetId || seen.has(tweetId)) continue;

		let body = '';
		for (let j = i + 1; j < Math.min(i + 12, lines.length); j += 1) {
			const candidate = lines[j].trim();
			if (!candidate) continue;
			if (/^\[.*\]\(https?:\/\//.test(candidate)) continue;
			if (/^(Quote|Replying to|Pinned)$/i.test(candidate)) continue;
			if (/^\d+(\.\d+)?[KMB]?$/i.test(candidate)) continue;
			if (/^\d+(\.\d+)?[KMB]?\s+views?$/i.test(candidate)) continue;
			if (candidate.startsWith('![')) continue;
			body = limpiarTextoPublicacion(limpiarHtmlBasico(candidate));
			if (body) break;
		}

		if (!body) continue;

		const cleanUser = username.replace(/^@/, '');
		const url = `https://x.com/${cleanUser}/status/${tweetId}`;
		posts.push({
			id: tweetId,
			title: body.length > 12 ? body.slice(0, 80) : `Publicacion ${posts.length + 1}`,
			body,
			image: '',
			url,
			pubDate: '',
		});
		seen.add(tweetId);

		if (posts.length >= limit) {
			break;
		}
	}

	if (posts.length) {
		return posts;
	}

	const text = String(markdown || '');
	const statusRegex = /status\/(\d{8,})/gi;
	let statusMatch = statusRegex.exec(text);

	while (statusMatch) {
		const tweetId = statusMatch[1];
		if (!seen.has(tweetId)) {
			const start = statusMatch.index;
			const chunk = text.slice(start, Math.min(text.length, start + 550));
			const chunkLines = chunk.split(/\r?\n/).map((l) => l.trim());
			const image = extraerImagenDesdeTexto(chunk);
			const body = chunkLines.find(
				(l) =>
					l &&
					!/status\/\d{8,}/i.test(l) &&
					!/^(\[.*\]\(https?:\/\/|!\[|Quote|Replying to|Pinned|\d+(\.\d+)?[KMB]? views?$|\d+(\.\d+)?[KMB]?)$/i.test(
						l
					) &&
					l.length > 20
			) || '';

			const cleanUser = username.replace(/^@/, '');
			posts.push({
				id: tweetId,
				title: body ? limpiarTextoPublicacion(body).slice(0, 80) : `Publicacion ${posts.length + 1}`,
				body: limpiarTextoPublicacion(body) || 'Publicacion disponible sin texto legible.',
				image,
				url: `https://x.com/${cleanUser}/status/${tweetId}`,
				pubDate: '',
			});
			seen.add(tweetId);

			if (posts.length >= limit) {
				break;
			}
		}

		statusMatch = statusRegex.exec(text);
	}

	return posts;
}

async function obtenerPostsXFallback(username, limit) {
	const cleanUser = username.replace(/^@/, '');
	const readOnlyUrl = `https://r.jina.ai/http://x.com/${encodeURIComponent(cleanUser)}`;
	const response = await fetch(readOnlyUrl, {
		headers: {
			'User-Agent': 'Mozilla/5.0',
			Accept: 'text/plain, text/markdown;q=0.9, */*;q=0.8',
		},
	});

	if (!response.ok) {
		const error = new Error(`Fallback de X no disponible (${response.status}).`);
		error.status = response.status;
		throw error;
	}

	const markdown = await response.text();
	const items = parsearPostsXDesdeMarkdown(markdown, cleanUser, limit);

	if (!items.length) {
		const error = new Error('No se pudieron extraer publicaciones de X para ese perfil.');
		error.status = 502;
		throw error;
	}

	return { items, source: 'https://r.jina.ai' };
}

function obtenerArregloPublicacionesBrightData(payload) {
	if (Array.isArray(payload)) return payload;
	if (Array.isArray(payload?.data)) return payload.data;
	if (Array.isArray(payload?.results)) return payload.results;
	if (Array.isArray(payload?.items)) return payload.items;
	return [];
}

async function obtenerPostsFacebookBrightData(profileUrl, limit) {
	const apiKey = process.env.BRIGHT_DATA_API_KEY;
	const endpoint = process.env.BRIGHT_DATA_FACEBOOK_POSTS_ENDPOINT;

	if (!apiKey || !endpoint) {
		const error = new Error(
			'Faltan variables de entorno BRIGHT_DATA_API_KEY y BRIGHT_DATA_FACEBOOK_POSTS_ENDPOINT.'
		);
		error.status = 400;
		throw error;
	}

	const payload = {
		profile_url: profileUrl,
		url: profileUrl,
		limit,
		max_posts: limit,
	};

	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		const bodyText = await response.text();
		const error = new Error(
			`Bright Data respondio ${response.status}. Ajusta endpoint/payload segun tu cuenta. Detalle: ${bodyText.slice(0, 300)}`
		);
		error.status = response.status;
		throw error;
	}

	return response.json();
}

const resilienciaCache = new Map();

function guardarEnCache(key, data) {
	resilienciaCache.set(key, {
		updatedAt: Date.now(),
		data,
	});
}

function leerDeCache(key, maxAgeMs = 15 * 60 * 1000) {
	const record = resilienciaCache.get(key);
	if (!record) return null;
	if (Date.now() - record.updatedAt > maxAgeMs) return null;
	return record.data;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 7000) {
	const controller = new AbortController();
	const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
		});

		if (!response.ok) {
			const error = new Error(`Error en servicio externo: ${response.status}`);
			error.status = response.status;
			throw error;
		}

		return response.json();
	} catch (error) {
		if (error.name === 'AbortError') {
			const timeoutError = new Error(`Tiempo de espera agotado (${timeoutMs}ms)`);
			timeoutError.status = 504;
			throw timeoutError;
		}
		throw error;
	} finally {
		clearTimeout(timeoutId);
	}
}

function evaluarRiesgoClimatico(weather = {}) {
	const temperatura = Number(weather.temperaturaC || 0);
	const viento = Number(weather.vientoKmh || 0);
	const lluvia = Number(weather.probLluviaPct || 0);

	if (lluvia >= 70 || viento >= 60) {
		return {
			nivel: 'alto',
			mensaje: 'Condiciones severas detectadas (lluvia/viento).',
		};
	}

	if (temperatura >= 38) {
		return {
			nivel: 'medio',
			mensaje: 'Calor extremo detectado.',
		};
	}

	return {
		nivel: 'normal',
		mensaje: 'Sin alertas climaticas relevantes.',
	};
}

function resumirNoticia(text = '', maxLen = 140) {
	const clean = String(text || '').replace(/\s+/g, ' ').trim();
	if (!clean) return '';
	return clean.length > maxLen ? `${clean.slice(0, maxLen - 3)}...` : clean;
}

async function obtenerClimaPorCiudad(city = 'Monterrey') {
	const citySafe = String(city || 'Monterrey').trim();

	const geocoding = await fetchJsonWithTimeout(
		`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(citySafe)}&count=1&language=es&format=json`
	);

	const lugar = geocoding.results?.[0];
	if (!lugar) {
		const error = new Error(`No se encontro la ciudad: ${citySafe}`);
		error.status = 404;
		throw error;
	}

	const forecast = await fetchJsonWithTimeout(
		`https://api.open-meteo.com/v1/forecast?latitude=${lugar.latitude}&longitude=${lugar.longitude}&current_weather=true&hourly=precipitation_probability&forecast_days=1&timezone=auto`
	);

	const lluviaMax = Math.max(...(forecast.hourly?.precipitation_probability || [0]));
	const current = forecast.current_weather || {};

	const data = {
		ciudad: `${lugar.name}${lugar.country ? `, ${lugar.country}` : ''}`,
		lat: lugar.latitude,
		lon: lugar.longitude,
		temperaturaC: current.temperature,
		vientoKmh: current.windspeed,
		climaCodigo: current.weathercode,
		fechaHora: current.time,
		probLluviaPct: Number.isFinite(lluviaMax) ? lluviaMax : 0,
	};

	return {
		...data,
		alerta: evaluarRiesgoClimatico(data),
	};
}

function normalizarNoticiasReddit(payload = {}, limit = 6) {
	const children = payload?.data?.children || [];
	return children.slice(0, limit).map((entry, index) => {
		const item = entry?.data || {};
		return {
			id: item.id || `reddit-${index + 1}`,
			titulo: item.title || 'Sin titulo',
			resumen: resumirNoticia(item.selftext || item.title),
			fuente: 'Reddit',
			url: item.permalink ? `https://www.reddit.com${item.permalink}` : item.url || '',
			fecha: item.created_utc ? new Date(item.created_utc * 1000).toISOString() : null,
		};
	});
}

function normalizarNoticiasHn(payload = {}, limit = 6) {
	const hits = payload?.hits || [];
	return hits.slice(0, limit).map((item, index) => ({
		id: item.objectID || `hn-${index + 1}`,
		titulo: item.title || item.story_title || 'Sin titulo',
		resumen: resumirNoticia(item.story_text || item.comment_text || item.title),
		fuente: 'Hacker News',
		url: item.url || item.story_url || '',
		fecha: item.created_at || null,
	}));
}

async function obtenerNoticiasPorCiudad({ city = 'Monterrey', topic = 'general', limit = 6 }) {
	const safeLimit = Math.min(12, Math.max(1, Number(limit || 6)));
	const q = topic === 'general' ? city : `${city} ${topic}`;

	const [redditResult, hnResult] = await Promise.allSettled([
		fetchJsonWithTimeout(
			`https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&sort=top&t=day&limit=${safeLimit}`,
			{
				headers: {
					'User-Agent': 'apis-mashup-dashboard/1.0',
					Accept: 'application/json',
				},
			},
			7000
		),
		fetchJsonWithTimeout(
			`https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=${safeLimit}`,
			{},
			7000
		),
	]);

	const noticias = [];
	const fuentes = [];
	const errores = [];

	if (redditResult.status === 'fulfilled') {
		noticias.push(...normalizarNoticiasReddit(redditResult.value, safeLimit));
		fuentes.push('reddit');
	} else {
		errores.push(`reddit: ${redditResult.reason.message}`);
	}

	if (hnResult.status === 'fulfilled') {
		noticias.push(...normalizarNoticiasHn(hnResult.value, safeLimit));
		fuentes.push('hn');
	} else {
		errores.push(`hn: ${hnResult.reason.message}`);
	}

	const unicas = [];
	const seen = new Set();
	for (const noticia of noticias) {
		const key = `${noticia.titulo}-${noticia.url}`;
		if (seen.has(key)) continue;
		seen.add(key);
		unicas.push(noticia);
		if (unicas.length >= safeLimit) break;
	}

	if (!unicas.length) {
		const error = new Error('No se pudieron obtener noticias de las fuentes disponibles.');
		error.status = 502;
		error.details = errores;
		throw error;
	}

	return {
		query: q,
		fuentes,
		noticias: unicas,
		errores,
	};
}

async function ejecutarConFallbackCache({ cacheKey, maxAgeMs = 20 * 60 * 1000, task }) {
	try {
		const data = await task();
		guardarEnCache(cacheKey, data);
		return {
			ok: true,
			data,
			fallback: false,
			error: null,
		};
	} catch (error) {
		const cached = leerDeCache(cacheKey, maxAgeMs);
		if (cached) {
			return {
				ok: true,
				data: cached,
				fallback: true,
				error: error.message,
			};
		}

		return {
			ok: false,
			data: null,
			fallback: false,
			error: error.message,
		};
	}
}

app.get('/api/noticiero/weather', async (req, res) => {
	const city = String(req.query.city || 'Monterrey').trim();
	const result = await ejecutarConFallbackCache({
		cacheKey: `noticiero-weather:${city.toLowerCase()}`,
		task: () => obtenerClimaPorCiudad(city),
	});

	if (!result.ok) {
		return res.status(502).json({
			error: 'No se pudo obtener clima en este momento.',
			detalle: result.error,
		});
	}

	return res.json({
		service: 'weather',
		city,
		fallback: result.fallback,
		data: result.data,
	});
});

app.get('/api/noticiero/news', async (req, res) => {
	const city = String(req.query.city || 'Monterrey').trim();
	const topic = String(req.query.topic || 'general').trim();
	const limit = Math.min(12, Math.max(1, Number(req.query.limit || 6)));

	const result = await ejecutarConFallbackCache({
		cacheKey: `noticiero-news:${city.toLowerCase()}:${topic.toLowerCase()}:${limit}`,
		task: () => obtenerNoticiasPorCiudad({ city, topic, limit }),
	});

	if (!result.ok) {
		return res.status(502).json({
			error: 'No se pudieron obtener noticias en este momento.',
			detalle: result.error,
		});
	}

	return res.json({
		service: 'news',
		city,
		topic,
		fallback: result.fallback,
		data: result.data,
	});
});

app.get('/api/noticiero/home', async (req, res) => {
	const city = String(req.query.city || 'Monterrey').trim();
	const topic = String(req.query.topic || 'general').trim();
	const limit = Math.min(12, Math.max(1, Number(req.query.limit || 6)));

	const [weatherResult, newsResult] = await Promise.allSettled([
		ejecutarConFallbackCache({
			cacheKey: `noticiero-weather:${city.toLowerCase()}`,
			task: () => obtenerClimaPorCiudad(city),
		}),
		ejecutarConFallbackCache({
			cacheKey: `noticiero-news:${city.toLowerCase()}:${topic.toLowerCase()}:${limit}`,
			task: () => obtenerNoticiasPorCiudad({ city, topic, limit }),
		}),
	]);

	const weather = weatherResult.status === 'fulfilled' ? weatherResult.value : {
		ok: false,
		data: null,
		fallback: false,
		error: weatherResult.reason?.message || 'Error inesperado.',
	};

	const news = newsResult.status === 'fulfilled' ? newsResult.value : {
		ok: false,
		data: null,
		fallback: false,
		error: newsResult.reason?.message || 'Error inesperado.',
	};

	const disponibilidad = {
		weather: weather.ok,
		news: news.ok,
	};

	const degradado = !disponibilidad.weather || !disponibilidad.news;
	const statusCode = disponibilidad.weather || disponibilidad.news ? 200 : 503;

	return res.status(statusCode).json({
		city,
		topic,
		degradado,
		disponibilidad,
		weather: {
			ok: weather.ok,
			fallback: weather.fallback,
			error: weather.error,
			data: weather.data,
		},
		news: {
			ok: news.ok,
			fallback: news.fallback,
			error: news.error,
			data: news.data,
		},
		generadoEn: new Date().toISOString(),
	});
});

app.get('/api/health', (_req, res) => {
	res.json({ ok: true, service: 'mashup-apis' });
});

app.get('/api/geolocalizacion', async (req, res) => {
	const query = req.query.query || 'Monterrey';

	try {
		const data = await fetchJson(
			`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
			{
				headers: {
					'User-Agent': 'apis-mashup-dashboard/1.0',
				},
			}
		);

		if (!data.length) {
			return res.status(404).json({ error: 'No se encontro ubicacion.' });
		}

		const place = data[0];
		const lat = Number(place.lat);
		const lon = Number(place.lon);
		const bbox = [lon - 0.05, lat - 0.05, lon + 0.05, lat + 0.05].join(',');

		return res.json({
			query,
			displayName: place.display_name,
			lat,
			lon,
			mapEmbedUrl: `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lon}`,
		});
	} catch (error) {
		return res.status(500).json({ error: error.message });
	}
});

app.get('/api/redes-sociales', async (req, res) => {
	const profileUrl = String(req.query.profileUrl || '').trim();
	const limit = Math.min(20, Math.max(1, Number(req.query.limit || 5)));

	if (!profileUrl) {
		return res.status(400).json({
			error: 'Debes enviar profileUrl. Ejemplo: https://x.com/usuario',
		});
	}

	const parsedProfile = parseSocialProfileUrl(profileUrl);
	if (!parsedProfile) {
		return res.status(400).json({
			error: 'URL no compatible. Se aceptan perfiles publicos de Reddit, Facebook y X.',
		});
	}

	try {
		if (parsedProfile.platform === 'reddit') {
			const username = parsedProfile.username;
			const headers = {
				'User-Agent': 'apis-mashup-dashboard/1.0',
				Accept: 'application/json',
			};

			const [about, submitted] = await Promise.all([
				fetchJson(`https://www.reddit.com/user/${encodeURIComponent(username)}/about.json`, { headers }),
				fetchJson(
					`https://www.reddit.com/user/${encodeURIComponent(username)}/submitted.json?limit=5`,
					{ headers }
				),
			]);

			const profileData = about?.data || {};
			const posts = submitted?.data?.children || [];

			return res.json({
				fuente: 'reddit',
				perfil: {
					id: profileData.id,
					nombre: profileData.subreddit?.title || username,
					usuario: profileData.name || username,
					email: 'No publico',
					empresa: 'Reddit',
					avatar: profileData.icon_img || '',
					karma: profileData.total_karma || 0,
					url: `https://www.reddit.com/user/${username}/`,
				},
				publicaciones: posts.map((item) => ({
					id: item.data.id,
					title: item.data.title,
					body: item.data.selftext || item.data.url,
					url: `https://www.reddit.com${item.data.permalink}`,
					score: item.data.score,
				})),
			});
		}

		if (parsedProfile.platform === 'facebook') {
			const bdResponse = await obtenerPostsFacebookBrightData(profileUrl, limit);
			const posts = obtenerArregloPublicacionesBrightData(bdResponse);
			const firstPost = posts[0] || {};

			const perfilNombre =
				firstPost.author_name ||
				firstPost.page_name ||
				firstPost.author?.name ||
				parsedProfile.username;

			const publicaciones = posts.slice(0, limit).map((post, index) => {
				const text =
					post.text ||
					post.content ||
					post.message ||
					post.caption ||
					'';
				const createdAt =
					post.created_at ||
					post.createdAt ||
					post.timestamp ||
					post.date ||
					'';
				const reactions =
					Number(post.reactions_count ?? post.reaction_count ?? post.likes_count ?? post.likes ?? 0) || 0;
				const postUrl = post.post_url || post.url || post.link || '';
				const title = text ? text.slice(0, 80) : `Publicacion ${index + 1}`;

				return {
					id: String(post.id || post.post_id || `${Date.now()}-${index}`),
					title,
					body: createdAt ? `${text}\n\nPublicado: ${createdAt}` : text || 'Sin texto.',
					url: postUrl,
					score: reactions,
				};
			});

			return res.json({
				fuente: 'facebook-brightdata',
				perfil: {
					id: parsedProfile.username,
					nombre: perfilNombre,
					usuario: parsedProfile.username,
					email: 'No publico',
					empresa: 'Facebook',
					avatar: firstPost.author_image || firstPost.author?.avatar || '',
					url: profileUrl,
				},
				publicaciones,
				totalRecibidas: posts.length,
			});
		}

		if (parsedProfile.platform === 'x') {
			let items = [];
			let source = '';

			try {
				const result = await obtenerPostsXDesdeNitter(parsedProfile.username, limit);
				items = result.items;
				source = result.source;
			} catch (_primaryError) {
				const fallback = await obtenerPostsXFallback(parsedProfile.username, limit);
				items = fallback.items;
				source = fallback.source;
			}

			return res.json({
				fuente: 'x-rss',
				perfil: {
					id: parsedProfile.username,
					nombre: parsedProfile.username,
					usuario: parsedProfile.username,
					email: 'No publico',
					empresa: 'X',
					avatar: '',
					url: `https://x.com/${parsedProfile.username}`,
				},
				publicaciones: items.map((post) => ({
					id: post.id,
					title: post.title,
					body: post.pubDate ? `${post.body}\n\nPublicado: ${post.pubDate}` : post.body,
					url: post.url,
					score: null,
				})),
				meta: {
					proxy: source,
				},
			});
		}

		return res.status(400).json({ error: 'Plataforma no soportada.' });
	} catch (error) {
		return res
			.status(error.status || 500)
			.json({ error: `No se pudo consultar el perfil social: ${error.message}` });
	}
});

app.get('/api/ecommerce', async (req, res) => {
	const query = String(req.query.query || '').trim().toLowerCase();

	if (!query) {
		return res.status(400).json({ error: 'Debes escribir un producto para buscar.' });
	}

	try {
		try {
			const data = await fetchJson(
				`https://api.mercadolibre.com/sites/MLM/search?q=${encodeURIComponent(query)}&limit=20`,
				{
					headers: {
						'User-Agent': 'apis-mashup-dashboard/1.0',
						Accept: 'application/json',
					},
				}
			);

			const product = data.results?.find((item) => item.thumbnail && item.price) || data.results?.[0];

			if (!product) {
				return res.status(404).json({ error: 'No se encontraron productos para esa busqueda.' });
			}

			return res.json({
				id: product.id,
				titulo: product.title,
				precio: product.price,
				imagen: normalizarImagen(product.thumbnail?.replace('-I.', '-O.') || product.thumbnail),
				categoria: product.category_id || 'sin-categoria',
				descripcion: `Producto desde Mercado Libre (${product.condition || 'n/a'})`,
				moneda: product.currency_id,
				url: product.permalink,
			});
		} catch (_apiError) {
			const response = await fetch(
				`https://listado.mercadolibre.com.mx/${encodeURIComponent(query)}`,
				{
					headers: {
						'User-Agent': 'Mozilla/5.0',
						Accept: 'text/html',
					},
				}
			);

			if (!response.ok) {
				return res.status(500).json({ error: `Mercado Libre no disponible (${response.status}).` });
			}

			const html = await response.text();
			const productoFallback = extraerProductoDesdeHtmlMercadoLibre(html);

			if (!productoFallback) {
				return res.status(404).json({ error: 'No se encontraron productos para esa busqueda.' });
			}

			return res.json(productoFallback);
		}
	} catch (error) {
		return res.status(500).json({ error: error.message });
	}
});

app.post('/api/base-datos', async (req, res) => {
	const username = String(req.body.username || '').trim();
	const provider = String(req.body.provider || 'CLOUD_DEFAULT').trim();

	if (!username) {
		return res.status(400).json({ error: 'El nombre de usuario es obligatorio.' });
	}

	try {
		const cloudResponse = await fetchJson('https://jsonplaceholder.typicode.com/posts', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username, provider }),
		});

		const registro = agregarRegistro(username, provider, cloudResponse.id);
		return res.status(201).json({ mensaje: 'Registro guardado en la nube', registro });
	} catch (error) {
		return res.status(500).json({ error: error.message });
	}
});

app.get('/api/base-datos', (_req, res) => {
	res.json({ registros: obtenerRegistros() });
});

app.post('/api/protocolos', (req, res) => {
	const to = String(req.body.to || '').trim();
	const message = String(req.body.message || '').trim();

	if (!to || !message) {
		return res.status(400).json({ error: 'Debes enviar destinatario y mensaje.' });
	}

	const sms = {
		id: `SIM-${Date.now()}`,
		to,
		message,
		status: 'ENVIADO',
		provider: 'SIMULADOR_SMS',
		sentAt: new Date().toISOString(),
	};

	return res.json({ mensaje: 'Notificacion SMS simulada correctamente', sms });
});

app.get('/api/streaming', async (req, res) => {
	const term = String(req.query.term || 'lofi').trim();

	try {
		const data = await fetchJson(
			`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=song&limit=5`
		);

		if (!data.results?.length) {
			return res.status(404).json({ error: 'No hay resultados de streaming para ese termino.' });
		}

		const first = data.results[0];
		return res.json({
			termino: term,
			pista: {
				artista: first.artistName,
				cancion: first.trackName,
				album: first.collectionName,
				portada: first.artworkUrl100?.replace('100x100', '300x300'),
				previewUrl: first.previewUrl,
				plataforma: 'Apple iTunes',
			},
			sugerencias: data.results.map((song) => ({
				artista: song.artistName,
				cancion: song.trackName,
			})),
			videoEmbedUrl: 'https://www.youtube.com/embed/jfKfPfyJRdk',
		});
	} catch (error) {
		return res.status(500).json({ error: error.message });
	}
});

// ── YouTube Data API v3 ───────────────────────────────────────────────────

const YOUTUBE_API_KEY = 'AIzaSyDdMqTix_BpZ1MNen5Klr7CR4mqbvzNawc';
const YT_BASE = 'https://www.googleapis.com/youtube/v3';

function formatearVistas(n) {
	if (!n) return '';
	const num = Number(n);
	if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M vistas`;
	if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K vistas`;
	return `${num} vistas`;
}

function formatearDuracion(iso) {
	if (!iso) return '';
	const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
	if (!match) return '';
	const h = parseInt(match[1] || '0');
	const m = parseInt(match[2] || '0');
	const s = parseInt(match[3] || '0');
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

async function ytSearch(query, maxResults = 16) {
	// 1) Buscar IDs
	const searchUrl =
		`${YT_BASE}/search?part=snippet&type=video&maxResults=${maxResults}` +
		`&q=${encodeURIComponent(query)}&regionCode=MX&relevanceLanguage=es` +
		`&key=${YOUTUBE_API_KEY}`;

	const searchData = await fetchJson(searchUrl);
	const items = searchData.items || [];
	if (!items.length) return [];

	const ids = items.map((i) => i.id.videoId).join(',');

	// 2) Obtener duracion y estadisticas con un segundo request
	const detailUrl =
		`${YT_BASE}/videos?part=contentDetails,statistics&id=${ids}&key=${YOUTUBE_API_KEY}`;
	const detailData = await fetchJson(detailUrl);
	const detailMap = {};
	for (const v of detailData.items || []) {
		detailMap[v.id] = v;
	}

	return items.map((item) => {
		const videoId = item.id.videoId;
		const snip = item.snippet;
		const detail = detailMap[videoId] || {};
		const thumb =
			snip.thumbnails?.maxres?.url ||
			snip.thumbnails?.high?.url ||
			snip.thumbnails?.medium?.url ||
			'';

		return {
			id: videoId,
			titulo: snip.title,
			canal: snip.channelTitle,
			publicado: snip.publishedAt ? new Date(snip.publishedAt).toLocaleDateString('es-MX') : '',
			duracion: formatearDuracion(detail.contentDetails?.duration),
			vistas: formatearVistas(detail.statistics?.viewCount),
			thumbnail: thumb,
			url: `https://www.youtube.com/watch?v=${videoId}`,
		};
	});
}

async function ytTrending(maxResults = 16) {
	const url =
		`${YT_BASE}/videos?part=snippet,contentDetails,statistics` +
		`&chart=mostPopular&regionCode=MX&maxResults=${maxResults}&key=${YOUTUBE_API_KEY}`;

	const data = await fetchJson(url);
	return (data.items || []).map((item) => {
		const snip = item.snippet;
		const thumb =
			snip.thumbnails?.maxres?.url ||
			snip.thumbnails?.high?.url ||
			snip.thumbnails?.medium?.url ||
			'';

		return {
			id: item.id,
			titulo: snip.title,
			canal: snip.channelTitle,
			publicado: snip.publishedAt ? new Date(snip.publishedAt).toLocaleDateString('es-MX') : '',
			duracion: formatearDuracion(item.contentDetails?.duration),
			vistas: formatearVistas(item.statistics?.viewCount),
			thumbnail: thumb,
			url: `https://www.youtube.com/watch?v=${item.id}`,
		};
	});
}

app.get('/api/youtube-busqueda', async (req, res) => {
	const query = String(req.query.query || '').trim();
	if (!query) return res.status(400).json({ error: 'Escribe algo para buscar.' });
	try {
		const videos = await ytSearch(query);
		if (!videos.length) return res.status(404).json({ error: 'No se encontraron videos.' });
		return res.json({ query, videos });
	} catch (error) {
		return res.status(500).json({ error: error.message });
	}
});

app.get('/api/youtube-inicio', async (_req, res) => {
	try {
		const videos = await ytTrending();
		return res.json({ query: 'tendencias', videos });
	} catch (error) {
		return res.status(500).json({ error: error.message });
	}
});

// ─────────────────────────────────────────────────────────────────────────────


// ── Proxy para Mercado Libre (evita CORS desde el browser) ──────────────────
app.get('/api/ml-search', async (req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	const q     = String(req.query.q || '').trim();
	const limit = Math.min(Number(req.query.limit || 8), 20);
	if (!q) return res.status(400).json({ error: 'Falta parametro q.' });
	try {
		try {
			const data = await fetchJson(
				`https://api.mercadolibre.com/sites/MLM/search?q=${encodeURIComponent(q)}&limit=${limit}`,
				{
					headers: {
						'User-Agent':
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
						Accept: 'application/json',
						'Accept-Language': 'es-MX,es;q=0.9,en;q=0.8',
					},
				}
			);
			return res.json(data);
		} catch (_apiError) {
			const response = await fetch(
				`https://listado.mercadolibre.com.mx/${encodeURIComponent(q)}`,
				{
					headers: {
						'User-Agent':
							'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
						Accept: 'text/html',
					},
				}
			);

			if (!response.ok) {
				return res.status(502).json({ error: `ML no disponible (${response.status}).` });
			}

			const html = await response.text();
			const productoFallback = extraerProductoDesdeHtmlMercadoLibre(html);

			if (!productoFallback) {
				return res.status(404).json({ error: 'No se encontraron productos para esa busqueda.' });
			}

			return res.json({
				site_id: 'MLM',
				query: q,
				results: [
					{
						id: productoFallback.id,
						title: productoFallback.titulo,
						price: productoFallback.precio,
						currency_id: productoFallback.moneda,
						thumbnail: productoFallback.imagen,
						permalink: productoFallback.url,
						condition: 'new',
						shipping: { free_shipping: false },
					},
				],
				paging: {
					total: 1,
					limit,
					offset: 0,
				},
				meta: {
					fallback: 'html',
				},
			});
		}
	} catch (error) {
		return res.status(502).json({ error: `ML no disponible: ${error.message}` });
	}
});

app.listen(PORT, () => {
	console.log(`Servidor listo en http://localhost:${PORT}`);
});