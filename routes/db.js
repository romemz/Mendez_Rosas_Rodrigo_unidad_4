const registros = [];

function agregarRegistro(username, provider, cloudId) {
	const nuevo = {
		id: registros.length + 1,
		username,
		provider,
		cloudId,
		createdAt: new Date().toISOString(),
	};

	registros.unshift(nuevo);
	return nuevo;
}

function obtenerRegistros() {
	return registros;
}

module.exports = {
	agregarRegistro,
	obtenerRegistros,
};