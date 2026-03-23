const express = require('express');
const path = require('path');
const { agregarRegistro, obtenerRegistros } = require('./routes/db');

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

		return null;
	} catch (_error) {
		return null;
	}
}

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

	if (!profileUrl) {
		return res.status(400).json({
			error: 'Debes enviar profileUrl. Ejemplo: https://www.reddit.com/user/spez/',
		});
	}

	const parsedProfile = parseSocialProfileUrl(profileUrl);
	if (!parsedProfile) {
		return res.status(400).json({
			error: 'URL no compatible. Por ahora solo se aceptan perfiles publicos de Reddit.',
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

		return res.status(400).json({ error: 'Plataforma no soportada.' });
	} catch (error) {
		return res.status(500).json({ error: `No se pudo consultar el perfil social: ${error.message}` });
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

app.listen(PORT, () => {
	console.log(`Servidor listo en http://localhost:${PORT}`);
});
