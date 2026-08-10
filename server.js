// ============================================================
// LAVADERO PRO - Servidor (Node.js puro, sin dependencias)
// ============================================================
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const url = require('url');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------------------------------------------------------
// USUARIOS (fijos, definidos por el dueño del negocio)
// ---------------------------------------------------------
const USERS = {
  'andres': { password: 'andres128010', role: 'admin', name: 'Andrés' },
  'empleado': { password: 'mario123', role: 'empleado', name: 'Empleado' }
};

// ---------------------------------------------------------
// SESIONES en memoria (cookie httpOnly + expiración 12hs)
// ---------------------------------------------------------
const SESSIONS = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

function createSession(username) {
  const id = crypto.randomBytes(32).toString('hex');
  SESSIONS.set(id, {
    username,
    role: USERS[username].role,
    name: USERS[username].name,
    expires: Date.now() + SESSION_TTL_MS
  });
  return id;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const sid = cookies['lavadero_sid'];
  if (!sid) return null;
  const s = SESSIONS.get(sid);
  if (!s) return null;
  if (Date.now() > s.expires) {
    SESSIONS.delete(sid);
    return null;
  }
  // renovar expiración con actividad
  s.expires = Date.now() + SESSION_TTL_MS;
  return s;
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

// ---------------------------------------------------------
// BASE DE DATOS (archivo JSON, con escritura atómica)
// ---------------------------------------------------------
function defaultDB() {
  return {
    clientes: [],
    vehiculos: [],
    servicios: [
      { id: 'srv_1', nombre: 'Lavado Básico', precio: 4000 },
      { id: 'srv_2', nombre: 'Lavado Premium', precio: 7000 },
      { id: 'srv_3', nombre: 'Lavado Completo', precio: 9000 },
      { id: 'srv_4', nombre: 'Aspirado', precio: 2500 },
      { id: 'srv_5', nombre: 'Encerado', precio: 5000 },
      { id: 'srv_6', nombre: 'Lavado de Motor', precio: 4500 }
    ],
    gastos: [],
    promociones_enviadas: [],
    nextId: 1
  };
}

let DB = null;

function loadDB() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    DB = defaultDB();
    saveDB();
  } else {
    try {
      DB = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (e) {
      console.error('DB corrupta, se reinicia:', e.message);
      DB = defaultDB();
      saveDB();
    }
  }
}

function saveDB() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(DB, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function newId(prefix) {
  const id = `${prefix}_${DB.nextId++}`;
  return id;
}

// ---------------------------------------------------------
// HELPERS
// ---------------------------------------------------------
function capitalizeName(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.length ? w[0].toUpperCase() + w.slice(1) : w)
    .join(' ');
}

function normalizePatente(str) {
  return String(str || '').trim().toUpperCase().replace(/\s+/g, '');
}

function todayStr(d = new Date()) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function isSameMonth(dateStr, ref = new Date()) {
  const d = new Date(dateStr);
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

function isSameDay(dateStr, ref = new Date()) {
  return todayStr(new Date(dateStr)) === todayStr(ref);
}

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 5 * 1024 * 1024) { req.destroy(); reject(new Error('Body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------
// LÓGICA DE NEGOCIO: recalcular datos de cliente
// ---------------------------------------------------------
function recalcCliente(clienteId) {
  const cliente = DB.clientes.find(c => c.id === clienteId);
  if (!cliente) return;
  const vehsCliente = DB.vehiculos.filter(v => v.clienteId === clienteId && v.pagado);
  cliente.cantidadVisitas = vehsCliente.length;
  cliente.totalGastado = vehsCliente.reduce((sum, v) => sum + (v.precio || 0), 0);
  const fechas = vehsCliente.map(v => v.fechaIngreso).sort();
  if (fechas.length) cliente.ultimaVisita = fechas[fechas.length - 1];
}

// ---------------------------------------------------------
// ESTADÍSTICAS Y ALERTAS
// ---------------------------------------------------------
function calcCaja(vehiculos, gastos) {
  const facturacion = vehiculos.filter(v => v.pagado).reduce((s, v) => s + v.precio, 0);
  const efectivo = vehiculos.filter(v => v.pagado && v.medioPago === 'Efectivo').reduce((s, v) => s + v.precio, 0);
  const mp = vehiculos.filter(v => v.pagado && v.medioPago === 'Mercado Pago').reduce((s, v) => s + v.precio, 0);
  const totalGastos = gastos.reduce((s, g) => s + g.importe, 0);
  return {
    facturacion,
    efectivo,
    mercadoPago: mp,
    gastos: totalGastos,
    ganancia: facturacion - totalGastos
  };
}

// ---------------------------------------------------------
// ROUTER
// ---------------------------------------------------------
const routes = [];
function route(method, pattern, handler, requireAuth = true, requireAdmin = false) {
  const paramNames = [];
  const regex = new RegExp('^' + pattern.replace(/:[a-zA-Z]+/g, (m) => {
    paramNames.push(m.slice(1));
    return '([^/]+)';
  }) + '$');
  routes.push({ method, regex, paramNames, handler, requireAuth, requireAdmin });
}

// ---- AUTH ----
route('POST', '/api/login', async (req, res, params, body) => {
  const { usuario, password } = body;
  const u = String(usuario || '').trim().toLowerCase();
  const rec = USERS[u];
  if (!rec || rec.password !== password) {
    return sendJSON(res, 401, { ok: false, error: 'Usuario o contraseña incorrectos' });
  }
  const sid = createSession(u);
  res.setHeader('Set-Cookie', `lavadero_sid=${sid}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`);
  sendJSON(res, 200, { ok: true, user: { name: rec.name, role: rec.role } });
}, false);

route('POST', '/api/logout', async (req, res) => {
  const cookies = parseCookies(req);
  if (cookies['lavadero_sid']) SESSIONS.delete(cookies['lavadero_sid']);
  res.setHeader('Set-Cookie', `lavadero_sid=; HttpOnly; Path=/; Max-Age=0`);
  sendJSON(res, 200, { ok: true });
}, false);

route('GET', '/api/me', async (req, res, params, body, session) => {
  sendJSON(res, 200, { ok: true, user: { name: session.name, role: session.role } });
});

// ---- SERVICIOS ----
route('GET', '/api/servicios', async (req, res) => {
  sendJSON(res, 200, { ok: true, servicios: DB.servicios });
});

route('POST', '/api/servicios', async (req, res, p, body, session) => {
  if (session.role !== 'admin') return sendJSON(res, 403, { ok: false, error: 'No autorizado' });
  const nombre = String(body.nombre || '').trim();
  const precio = Number(body.precio) || 0;
  if (!nombre) return sendJSON(res, 400, { ok: false, error: 'Nombre requerido' });
  const s = { id: newId('srv'), nombre, precio };
  DB.servicios.push(s);
  saveDB();
  sendJSON(res, 200, { ok: true, servicio: s });
}, true, true);

route('PUT', '/api/servicios/:id', async (req, res, p, body, session) => {
  if (session.role !== 'admin') return sendJSON(res, 403, { ok: false, error: 'No autorizado' });
  const s = DB.servicios.find(x => x.id === p.id);
  if (!s) return sendJSON(res, 404, { ok: false, error: 'No encontrado' });
  if (body.nombre !== undefined) s.nombre = String(body.nombre).trim();
  if (body.precio !== undefined) s.precio = Number(body.precio) || 0;
  saveDB();
  sendJSON(res, 200, { ok: true, servicio: s });
}, true, true);

// ---- CLIENTES ----
route('GET', '/api/clientes', async (req, res) => {
  sendJSON(res, 200, { ok: true, clientes: DB.clientes });
});

route('GET', '/api/clientes/patente/:patente', async (req, res, p) => {
  const patente = normalizePatente(p.patente);
  const veh = DB.vehiculos.slice().reverse().find(v => v.patente === patente);
  if (!veh) return sendJSON(res, 200, { ok: true, encontrado: false });
  const cliente = DB.clientes.find(c => c.id === veh.clienteId);
  if (!cliente) return sendJSON(res, 200, { ok: true, encontrado: false });
  const historial = DB.vehiculos.filter(v => v.patente === patente)
    .sort((a, b) => new Date(b.fechaIngreso) - new Date(a.fechaIngreso))
    .slice(0, 5)
    .map(v => ({ servicio: v.servicio, precio: v.precio, fecha: v.fechaIngreso }));
  sendJSON(res, 200, {
    ok: true,
    encontrado: true,
    cliente: {
      id: cliente.id,
      nombre: cliente.nombre,
      telefono: cliente.telefono,
      tipoCliente: cliente.tipoCliente,
      modelo: veh.modelo
    },
    historial
  });
});

route('POST', '/api/clientes', async (req, res, p, body) => {
  const nombre = capitalizeName(body.nombre);
  const telefono = String(body.telefono || '').trim();
  const tipoCliente = body.tipoCliente || 'Hombre';
  if (!nombre) return sendJSON(res, 400, { ok: false, error: 'Nombre requerido' });
  const c = {
    id: newId('cli'),
    nombre,
    telefono,
    tipoCliente,
    fechaAlta: new Date().toISOString(),
    ultimaVisita: null,
    cantidadVisitas: 0,
    totalGastado: 0,
    vehiculos: [],
    promoRecibida: false
  };
  DB.clientes.push(c);
  saveDB();
  sendJSON(res, 200, { ok: true, cliente: c });
});

// ---- VEHÍCULOS / "HOY" ----
route('GET', '/api/vehiculos', async (req, res, p, body, session, query) => {
  const fecha = query.fecha || todayStr();
  const list = DB.vehiculos.filter(v => todayStr(new Date(v.fechaIngreso)) === fecha);
  sendJSON(res, 200, { ok: true, vehiculos: list });
});

route('POST', '/api/vehiculos', async (req, res, p, body) => {
  let clienteId = body.clienteId;
  const patente = normalizePatente(body.patente);

  if (!clienteId) {
    // crear cliente nuevo si no vino uno existente
    const nombre = capitalizeName(body.nombre);
    if (!nombre) return sendJSON(res, 400, { ok: false, error: 'Nombre requerido' });
    const c = {
      id: newId('cli'),
      nombre,
      telefono: String(body.telefono || '').trim(),
      tipoCliente: body.tipoCliente || 'Hombre',
      fechaAlta: new Date().toISOString(),
      ultimaVisita: null,
      cantidadVisitas: 0,
      totalGastado: 0,
      vehiculos: [],
      promoRecibida: false
    };
    DB.clientes.push(c);
    clienteId = c.id;
  }

  const cliente = DB.clientes.find(c => c.id === clienteId);
  if (!cliente) return sendJSON(res, 400, { ok: false, error: 'Cliente inválido' });

  if (patente && !cliente.vehiculos.some(v => v.patente === patente)) {
    cliente.vehiculos.push({ patente, modelo: body.modelo || '' });
  }

  const precio = body.precioManual !== undefined && body.precioManual !== null && body.precioManual !== ''
    ? Number(body.precioManual)
    : Number(body.precio) || 0;

  const veh = {
    id: newId('veh'),
    patente,
    modelo: body.modelo || '',
    clienteId,
    clienteNombre: cliente.nombre,
    clienteTelefono: cliente.telefono,
    servicio: body.servicio || 'Precio Manual',
    precio,
    estado: 'pendiente', // pendiente -> listo -> entregado
    pagado: false,
    medioPago: null,
    fechaIngreso: new Date().toISOString(),
    fechaListo: null,
    fechaEntregado: null
  };
  DB.vehiculos.push(veh);
  saveDB();
  sendJSON(res, 200, { ok: true, vehiculo: veh });
});

route('PUT', '/api/vehiculos/:id', async (req, res, p, body) => {
  const veh = DB.vehiculos.find(v => v.id === p.id);
  if (!veh) return sendJSON(res, 404, { ok: false, error: 'No encontrado' });

  if (body.estado) {
    veh.estado = body.estado;
    if (body.estado === 'listo' && !veh.fechaListo) veh.fechaListo = new Date().toISOString();
    if (body.estado === 'entregado' && !veh.fechaEntregado) veh.fechaEntregado = new Date().toISOString();
  }
  if (body.pagado !== undefined) {
    veh.pagado = !!body.pagado;
    if (body.medioPago) veh.medioPago = body.medioPago;
    recalcCliente(veh.clienteId);
  }
  saveDB();
  sendJSON(res, 200, { ok: true, vehiculo: veh });
});

// ---- GASTOS ----
route('GET', '/api/gastos', async (req, res, p, body, session, query) => {
  sendJSON(res, 200, { ok: true, gastos: DB.gastos });
}, true, true);

route('POST', '/api/gastos', async (req, res, p, body, session) => {
  if (session.role !== 'admin') return sendJSON(res, 403, { ok: false, error: 'No autorizado' });
  const g = {
    id: newId('gas'),
    fecha: body.fecha || new Date().toISOString(),
    proveedor: String(body.proveedor || '').trim(),
    categoria: body.categoria || 'Otros',
    importe: Number(body.importe) || 0,
    observaciones: String(body.observaciones || '').trim()
  };
  DB.gastos.push(g);
  saveDB();
  sendJSON(res, 200, { ok: true, gasto: g });
}, true, true);

// ---- CAJA ----
route('GET', '/api/caja', async (req, res, p, body, session) => {
  if (session.role !== 'admin') return sendJSON(res, 403, { ok: false, error: 'No autorizado' });
  const now = new Date();
  const vehHoy = DB.vehiculos.filter(v => isSameDay(v.fechaIngreso, now));
  const gasHoy = DB.gastos.filter(g => isSameDay(g.fecha, now));
  const vehMes = DB.vehiculos.filter(v => isSameMonth(v.fechaIngreso, now));
  const gasMes = DB.gastos.filter(g => isSameMonth(g.fecha, now));
  sendJSON(res, 200, {
    ok: true,
    dia: calcCaja(vehHoy, gasHoy),
    mes: calcCaja(vehMes, gasMes)
  });
}, true, true);

// ---- PROMOCIONES ----
route('GET', '/api/promociones/filtrar', async (req, res, p, body, session, query) => {
  if (session.role !== 'admin') return sendJSON(res, 403, { ok: false, error: 'No autorizado' });
  const filtro = query.filtro || 'todos';
  const now = new Date();
  let list = DB.clientes.slice();

  if (filtro === 'Hombre' || filtro === 'Mujer' || filtro === 'Jubilado') {
    list = list.filter(c => c.tipoCliente === filtro);
  } else if (filtro === 'nuevos') {
    const hace30 = new Date(now); hace30.setDate(hace30.getDate() - 30);
    list = list.filter(c => new Date(c.fechaAlta) >= hace30);
  } else if (filtro === 'frecuentes') {
    list = list.filter(c => c.cantidadVisitas >= 5);
  } else if (filtro === 'inactivos30') {
    const hace30 = new Date(now); hace30.setDate(hace30.getDate() - 30);
    list = list.filter(c => c.ultimaVisita && new Date(c.ultimaVisita) < hace30);
  } else if (filtro === 'sinPromo') {
    list = list.filter(c => !c.promoRecibida);
  }
  sendJSON(res, 200, { ok: true, clientes: list });
}, true, true);

route('POST', '/api/promociones/enviar', async (req, res, p, body, session) => {
  if (session.role !== 'admin') return sendJSON(res, 403, { ok: false, error: 'No autorizado' });
  const { clienteIds, mensaje } = body;
  if (!Array.isArray(clienteIds) || !mensaje) return sendJSON(res, 400, { ok: false, error: 'Datos inválidos' });
  const cola = [];
  clienteIds.forEach(id => {
    const c = DB.clientes.find(x => x.id === id);
    if (!c) return;
    const texto = mensaje.replace(/\{nombre\}/g, c.nombre);
    const tel = c.telefono.replace(/\D/g, '');
    cola.push({ clienteId: c.id, nombre: c.nombre, telefono: tel, mensaje: texto, waLink: `https://wa.me/${tel}?text=${encodeURIComponent(texto)}` });
    c.promoRecibida = true;
  });
  DB.promociones_enviadas.push({ id: newId('promo'), fecha: new Date().toISOString(), cantidad: cola.length, mensaje });
  saveDB();
  sendJSON(res, 200, { ok: true, cola });
}, true, true);

// ---- ESTADÍSTICAS ----
route('GET', '/api/estadisticas', async (req, res, p, body, session) => {
  if (session.role !== 'admin') return sendJSON(res, 403, { ok: false, error: 'No autorizado' });
  const now = new Date();
  const vehHoy = DB.vehiculos.filter(v => isSameDay(v.fechaIngreso, now));
  const gasHoy = DB.gastos.filter(g => isSameDay(g.fecha, now));
  const cajaHoy = calcCaja(vehHoy, gasHoy);

  const hace7 = new Date(now); hace7.setDate(hace7.getDate() - 7);
  const vehSemana = DB.vehiculos.filter(v => new Date(v.fechaIngreso) >= hace7);
  const gasSemana = DB.gastos.filter(g => new Date(g.fecha) >= hace7);
  const cajaSemana = calcCaja(vehSemana, gasSemana);

  const vehMes = DB.vehiculos.filter(v => isSameMonth(v.fechaIngreso, now));
  const gasMes = DB.gastos.filter(g => isSameMonth(g.fecha, now));
  const cajaMes = calcCaja(vehMes, gasMes);

  const hace30 = new Date(now); hace30.setDate(hace30.getDate() - 30);
  const clientesNuevosMes = DB.clientes.filter(c => isSameMonth(c.fechaAlta, now)).length;
  const clientesRecurrentes = DB.clientes.filter(c => c.cantidadVisitas > 1).length;

  const pagados = vehHoy.filter(v => v.pagado);
  const ticketPromHoy = pagados.length ? Math.round(cajaHoy.facturacion / pagados.length) : 0;

  const ultimoMes = new Date(now); ultimoMes.setMonth(ultimoMes.getMonth() - 1);
  const vehMesAnterior = DB.vehiculos.filter(v => isSameMonth(v.fechaIngreso, ultimoMes));
  const facturacionMesAnterior = vehMesAnterior.filter(v => v.pagado).reduce((s, v) => s + v.precio, 0);

  // rankings
  const rankingGasto = DB.clientes.slice().sort((a, b) => b.totalGastado - a.totalGastado).slice(0, 5)
    .map(c => ({ nombre: c.nombre, valor: c.totalGastado }));
  const rankingVisitas = DB.clientes.slice().sort((a, b) => b.cantidadVisitas - a.cantidadVisitas).slice(0, 5)
    .map(c => ({ nombre: c.nombre, valor: c.cantidadVisitas }));

  const servicioCount = {};
  DB.vehiculos.forEach(v => { servicioCount[v.servicio] = (servicioCount[v.servicio] || 0) + 1; });
  const rankingServicios = Object.entries(servicioCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([nombre, valor]) => ({ nombre, valor }));

  const patenteCount = {};
  DB.vehiculos.forEach(v => { if (v.patente) patenteCount[v.patente] = (patenteCount[v.patente] || 0) + 1; });
  const rankingVehiculos = Object.entries(patenteCount).sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([nombre, valor]) => ({ nombre, valor }));

  // gráfico: últimos 14 días
  const graficoDiario = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = todayStr(d);
    const vehD = DB.vehiculos.filter(v => todayStr(new Date(v.fechaIngreso)) === key && v.pagado);
    const gasD = DB.gastos.filter(g => todayStr(new Date(g.fecha)) === key);
    graficoDiario.push({
      fecha: key,
      facturacion: vehD.reduce((s, v) => s + v.precio, 0),
      gastos: gasD.reduce((s, g) => s + g.importe, 0),
      autos: vehD.length
    });
  }

  // alertas inteligentes
  const alertas = [];
  if (facturacionMesAnterior > 0) {
    const variacion = ((cajaMes.facturacion - facturacionMesAnterior) / facturacionMesAnterior) * 100;
    if (variacion > 5) alertas.push({ tipo: 'positivo', texto: `La facturación subió ${variacion.toFixed(0)}% respecto al mes pasado.` });
    else if (variacion < -5) alertas.push({ tipo: 'negativo', texto: `La facturación bajó ${Math.abs(variacion).toFixed(0)}% respecto al mes pasado.` });
  }
  const inactivos30 = DB.clientes.filter(c => c.ultimaVisita && new Date(c.ultimaVisita) < hace30).length;
  if (inactivos30 > 0) alertas.push({ tipo: 'info', texto: `Hay ${inactivos30} cliente(s) que hace más de 30 días no vienen.` });
  if (cajaMes.facturacion > 0) {
    const pctEfectivo = Math.round((cajaMes.efectivo / cajaMes.facturacion) * 100);
    alertas.push({ tipo: 'info', texto: `El ${pctEfectivo}% de los pagos del mes fueron en efectivo.` });
  }

  sendJSON(res, 200, {
    ok: true,
    resumen: {
      facturacionHoy: cajaHoy.facturacion,
      gananciaHoy: cajaHoy.ganancia,
      gastosHoy: cajaHoy.gastos,
      ticketPromedioHoy: ticketPromHoy,
      autosLavadosHoy: pagados.length
    },
    hoy: {
      ingresados: vehHoy.length,
      entregados: vehHoy.filter(v => v.estado === 'entregado').length,
      efectivo: cajaHoy.efectivo,
      mercadoPago: cajaHoy.mercadoPago,
      pendienteCobro: vehHoy.filter(v => !v.pagado).reduce((s, v) => s + v.precio, 0)
    },
    semana: {
      facturacion: cajaSemana.facturacion,
      gastos: cajaSemana.gastos,
      ganancia: cajaSemana.ganancia,
      promedioDiario: Math.round(cajaSemana.facturacion / 7)
    },
    mes: {
      facturacion: cajaMes.facturacion,
      gastos: cajaMes.gastos,
      ganancia: cajaMes.ganancia,
      clientesNuevos: clientesNuevosMes,
      clientesRecurrentes,
      ticketPromedio: vehMes.filter(v => v.pagado).length ? Math.round(cajaMes.facturacion / vehMes.filter(v => v.pagado).length) : 0
    },
    clientes: {
      total: DB.clientes.length,
      hombres: DB.clientes.filter(c => c.tipoCliente === 'Hombre').length,
      mujeres: DB.clientes.filter(c => c.tipoCliente === 'Mujer').length,
      jubilados: DB.clientes.filter(c => c.tipoCliente === 'Jubilado').length,
      activos: DB.clientes.filter(c => c.ultimaVisita && new Date(c.ultimaVisita) >= hace30).length,
      inactivos: inactivos30
    },
    rankings: {
      clientesGasto: rankingGasto,
      clientesVisitas: rankingVisitas,
      vehiculosFrecuentes: rankingVehiculos,
      servicios: rankingServicios
    },
    graficoDiario,
    alertas
  });
}, true, true);

// ---------------------------------------------------------
// SERVIDOR HTTP
// ---------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(PUBLIC_DIR, filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No encontrado');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const query = parsed.query;

  if (!pathname.startsWith('/api/')) {
    return serveStatic(req, res, pathname);
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const m = pathname.match(r.regex);
    if (!m) continue;
    const params = {};
    r.paramNames.forEach((name, i) => { params[name] = decodeURIComponent(m[i + 1]); });

    let session = null;
    if (r.requireAuth) {
      session = getSession(req);
      if (!session) return sendJSON(res, 401, { ok: false, error: 'Sesión inválida o expirada' });
      if (r.requireAdmin && session.role !== 'admin') {
        return sendJSON(res, 403, { ok: false, error: 'No autorizado' });
      }
    }

    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      body = await readBody(req);
    }

    try {
      await r.handler(req, res, params, body, session, query);
    } catch (e) {
      console.error(e);
      sendJSON(res, 500, { ok: false, error: 'Error interno del servidor' });
    }
    return;
  }

  sendJSON(res, 404, { ok: false, error: 'Ruta no encontrada' });
});

loadDB();
server.listen(PORT, () => {
  console.log(`Lavadero Pro escuchando en puerto ${PORT}`);
});
