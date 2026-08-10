// ============================================================
// LAVADERO PRO - Frontend
// ============================================================
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let CURRENT_USER = null;
let SERVICIOS_CACHE = [];
let PROMO_COLA = [];
const CHARTS = {};

// ---------- helpers ----------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('Sesión expirada');
  }
  const data = await res.json().catch(() => ({ ok: false, error: 'Respuesta inválida' }));
  if (!data.ok) throw new Error(data.error || 'Error');
  return data;
}

function money(n) {
  return '$' + Math.round(n || 0).toLocaleString('es-AR');
}

function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}

function openModal(html) {
  $('#modalBox').innerHTML = html;
  $('#modalOverlay').style.display = 'flex';
}
function closeModal() {
  $('#modalOverlay').style.display = 'none';
  $('#modalBox').innerHTML = '';
}
$('#modalOverlay').addEventListener('click', e => {
  if (e.target.id === 'modalOverlay') closeModal();
});

// ---------- LOGIN ----------
function showLogin() {
  $('#loginScreen').style.display = 'flex';
  $('#app').style.display = 'none';
}
function showApp() {
  $('#loginScreen').style.display = 'none';
  $('#app').style.display = 'flex';
  document.body.style.overflow = '';
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#loginBtn');
  const errBox = $('#loginError');
  errBox.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Ingresando...';
  try {
    const usuario = $('#loginUsuario').value.trim();
    const password = $('#loginPassword').value;
    const res = await fetch('/api/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario, password })
    });
    const data = await res.json();
    if (!data.ok) {
      errBox.textContent = data.error || 'No se pudo iniciar sesión';
      errBox.style.display = 'block';
      return;
    }
    CURRENT_USER = data.user;
    afterLogin();
  } catch (err) {
    errBox.textContent = 'No se pudo conectar con el servidor. Probá de nuevo.';
    errBox.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ingresar';
  }
});

$('#logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
  CURRENT_USER = null;
  $('#loginUsuario').value = '';
  $('#loginPassword').value = '';
  showLogin();
});

function afterLogin() {
  $('#userBadge').textContent = `${CURRENT_USER.name} · ${CURRENT_USER.role === 'admin' ? 'Administrador' : 'Empleado'}`;
  // mostrar/ocultar pestañas según rol
  $$('.tab-btn[data-admin]').forEach(btn => {
    btn.style.display = CURRENT_USER.role === 'admin' ? 'inline-flex' : 'none';
  });
  showApp();
  switchTab('hoy');
  loadServicios();
}

async function checkSession() {
  try {
    const data = await api('/api/me');
    CURRENT_USER = data.user;
    afterLogin();
  } catch (e) {
    showLogin();
  }
}

// ---------- TABS ----------
$$('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  if (tab === 'hoy') loadHoy();
  if (tab === 'clientes') loadClientes();
  if (tab === 'caja') loadCaja();
  if (tab === 'gastos') loadGastos();
  if (tab === 'estadisticas') loadEstadisticas();
  if (tab === 'configuracion') renderServicios();
}

// ============================================================
// PESTAÑA "HOY"
// ============================================================
async function loadHoy() {
  const cont = $('#hoyLista');
  cont.innerHTML = '<p class="muted">Cargando...</p>';
  try {
    const { vehiculos } = await api('/api/vehiculos');
    if (!vehiculos.length) {
      cont.innerHTML = `<div class="empty-state"><div class="icon">🚗</div><p>No hay vehículos ingresados hoy todavía.</p></div>`;
      return;
    }
    vehiculos.sort((a, b) => new Date(b.fechaIngreso) - new Date(a.fechaIngreso));
    cont.innerHTML = vehiculos.map(vehCardHTML).join('');
  } catch (e) {
    cont.innerHTML = `<p class="muted">Error al cargar: ${e.message}</p>`;
  }
}

function vehCardHTML(v) {
  const estadoBadge = { pendiente: 'badge-pendiente', listo: 'badge-listo', entregado: 'badge-entregado' }[v.estado];
  const estadoTxt = { pendiente: 'Pendiente', listo: 'Listo', entregado: 'Entregado' }[v.estado];
  const pagoBadge = v.pagado ? `<span class="badge badge-pagado">Pagado (${v.medioPago})</span>` : `<span class="badge badge-pendiente-pago">Sin cobrar</span>`;

  const whatsappMsg = `Hola ${v.clienteNombre.split(' ')[0]} 👋\n\nTu vehículo ya se encuentra listo para retirar.\n\n¡Muchas gracias por elegirnos! 🚗✨`;
  const tel = (v.clienteTelefono || '').replace(/\D/g, '');
  const waLink = tel ? `https://wa.me/${tel}?text=${encodeURIComponent(whatsappMsg)}` : null;

  let actions = '';
  if (v.estado === 'pendiente') {
    actions += `<button class="btn btn-secondary" onclick="marcarEstado('${v.id}','listo')">Marcar listo</button>`;
  } else if (v.estado === 'listo') {
    actions += `<button class="btn btn-secondary" onclick="marcarEstado('${v.id}','entregado')">Marcar entregado</button>`;
    if (waLink) actions += `<a class="btn btn-whatsapp" target="_blank" rel="noopener" href="${waLink}">📲 Avisar por WhatsApp</a>`;
  } else {
    if (waLink) actions += `<a class="btn btn-whatsapp" target="_blank" rel="noopener" href="${waLink}">📲 WhatsApp</a>`;
  }
  if (!v.pagado) {
    actions += `<button class="btn btn-primary" onclick="abrirModalPago('${v.id}')">Marcar pagado</button>`;
  }

  return `
  <div class="veh-card">
    <div class="veh-top">
      <div>
        <div class="veh-patente">${v.patente || 'S/Patente'}</div>
        <div class="veh-modelo">${v.modelo || ''}</div>
      </div>
      <span class="badge ${estadoBadge}">${estadoTxt}</span>
    </div>
    <div class="veh-cliente">${v.clienteNombre}</div>
    <div class="muted">${v.servicio}</div>
    <div class="veh-precio">${money(v.precio)}</div>
    <div>${pagoBadge}</div>
    <div class="veh-actions">${actions}</div>
  </div>`;
}

async function marcarEstado(id, estado) {
  try {
    await api(`/api/vehiculos/${id}`, { method: 'PUT', body: JSON.stringify({ estado }) });
    toast('Estado actualizado');
    loadHoy();
  } catch (e) { toast('Error: ' + e.message); }
}

function abrirModalPago(id) {
  openModal(`
    <h3>¿Cómo abonó?</h3>
    <div class="pago-options">
      <div class="pago-option" onclick="confirmarPago('${id}','Efectivo')">💵 Efectivo</div>
      <div class="pago-option" onclick="confirmarPago('${id}','Mercado Pago')">📱 Mercado Pago</div>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancelar</button></div>
  `);
}

async function confirmarPago(id, medioPago) {
  try {
    await api(`/api/vehiculos/${id}`, { method: 'PUT', body: JSON.stringify({ pagado: true, medioPago }) });
    closeModal();
    toast('Pago registrado');
    loadHoy();
  } catch (e) { toast('Error: ' + e.message); }
}

// --- Nuevo ingreso ---
$('#btnNuevoVehiculo').addEventListener('click', abrirModalNuevoVehiculo);

function abrirModalNuevoVehiculo() {
  const serviciosOpts = SERVICIOS_CACHE.map(s => `<option value="${s.id}">${s.nombre} — ${money(s.precio)}</option>`).join('');
  openModal(`
    <h3>Nuevo ingreso</h3>
    <div class="form-row">
      <label>Patente</label>
      <input type="text" id="fPatente" class="input" placeholder="AB123CD" autocomplete="off">
    </div>
    <div id="autocompleteInfo" class="muted" style="display:none;margin:-6px 0 10px;"></div>
    <div class="form-row">
      <label>Nombre del cliente</label>
      <input type="text" id="fNombre" class="input" placeholder="Nombre y apellido">
    </div>
    <div class="form-row">
      <label>WhatsApp</label>
      <div style="display:flex;gap:6px;">
        <span class="input" style="max-width:70px;text-align:center;background:#f3f4f6;">+549</span>
        <input type="text" id="fTelefono" class="input" placeholder="1122334455">
      </div>
    </div>
    <div class="form-row">
      <label>Tipo de cliente</label>
      <select id="fTipoCliente" class="input">
        <option>Hombre</option><option>Mujer</option><option>Jubilado</option>
      </select>
    </div>
    <div class="form-row">
      <label>Modelo del vehículo</label>
      <input type="text" id="fModelo" class="input" placeholder="Ej: Toyota Corolla">
    </div>
    <div class="form-row">
      <label>Servicio</label>
      <select id="fServicio" class="input">
        ${serviciosOpts}
        <option value="manual">Precio Manual</option>
      </select>
    </div>
    <div class="form-row" id="fPrecioManualRow" style="display:none;">
      <label>Importe</label>
      <input type="number" id="fPrecioManual" class="input" placeholder="0">
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="btnGuardarVehiculo">Guardar</button>
    </div>
  `);

  let clienteEncontradoId = null;

  $('#fServicio').addEventListener('change', (e) => {
    $('#fPrecioManualRow').style.display = e.target.value === 'manual' ? 'block' : 'none';
  });

  let debounce;
  $('#fPatente').addEventListener('input', (e) => {
    clearTimeout(debounce);
    const patente = e.target.value.trim();
    if (patente.length < 5) { $('#autocompleteInfo').style.display = 'none'; clienteEncontradoId = null; return; }
    debounce = setTimeout(async () => {
      try {
        const data = await api(`/api/clientes/patente/${encodeURIComponent(patente)}`);
        const info = $('#autocompleteInfo');
        if (data.encontrado) {
          clienteEncontradoId = data.cliente.id;
          $('#fNombre').value = data.cliente.nombre;
          $('#fTelefono').value = (data.cliente.telefono || '').replace(/^\+?549/, '');
          $('#fTipoCliente').value = data.cliente.tipoCliente;
          $('#fModelo').value = data.cliente.modelo || '';
          info.style.display = 'block';
          info.innerHTML = `✅ Cliente existente encontrado — se reutilizarán sus datos.`;
        } else {
          clienteEncontradoId = null;
          info.style.display = 'block';
          info.innerHTML = `🆕 Patente nueva — se cargará un cliente nuevo.`;
        }
      } catch (err) { /* silencioso */ }
    }, 400);
  });

  $('#btnGuardarVehiculo').addEventListener('click', async () => {
    const patente = $('#fPatente').value.trim();
    const nombre = $('#fNombre').value.trim();
    if (!nombre) { toast('El nombre es obligatorio'); return; }
    const servicioSel = $('#fServicio').value;
    const servicioObj = SERVICIOS_CACHE.find(s => s.id === servicioSel);
    const payload = {
      clienteId: clienteEncontradoId,
      patente,
      nombre,
      telefono: $('#fTelefono').value.trim() ? '+549' + $('#fTelefono').value.trim() : '',
      tipoCliente: $('#fTipoCliente').value,
      modelo: $('#fModelo').value.trim(),
      servicio: servicioObj ? servicioObj.nombre : 'Precio Manual',
      precio: servicioObj ? servicioObj.precio : 0,
      precioManual: servicioSel === 'manual' ? $('#fPrecioManual').value : null
    };
    try {
      await api('/api/vehiculos', { method: 'POST', body: JSON.stringify(payload) });
      closeModal();
      toast('Vehículo ingresado');
      loadHoy();
    } catch (e) { toast('Error: ' + e.message); }
  });
}

// ============================================================
// CLIENTES
// ============================================================
let CLIENTES_CACHE = [];
async function loadClientes() {
  const cont = $('#clientesLista');
  cont.innerHTML = '<p class="muted">Cargando...</p>';
  try {
    const { clientes } = await api('/api/clientes');
    CLIENTES_CACHE = clientes;
    renderClientes(clientes);
  } catch (e) { cont.innerHTML = `<p class="muted">Error: ${e.message}</p>`; }
}

function renderClientes(clientes) {
  const cont = $('#clientesLista');
  if (!clientes.length) {
    cont.innerHTML = `<div class="empty-state"><div class="icon">👥</div><p>Todavía no hay clientes cargados.</p></div>`;
    return;
  }
  cont.innerHTML = `
  <table>
    <thead><tr><th>Nombre</th><th>Tipo</th><th>Teléfono</th><th>Visitas</th><th>Total gastado</th><th>Última visita</th></tr></thead>
    <tbody>
      ${clientes.map(c => `
        <tr>
          <td>${c.nombre}</td>
          <td>${c.tipoCliente}</td>
          <td>${c.telefono || '-'}</td>
          <td>${c.cantidadVisitas}</td>
          <td>${money(c.totalGastado)}</td>
          <td>${c.ultimaVisita ? new Date(c.ultimaVisita).toLocaleDateString('es-AR') : '-'}</td>
        </tr>`).join('')}
    </tbody>
  </table>`;
}

$('#buscarCliente').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  renderClientes(CLIENTES_CACHE.filter(c => c.nombre.toLowerCase().includes(q)));
});

// ============================================================
// PROMOCIONES
// ============================================================
$('#btnCargarPromo').addEventListener('click', async () => {
  const filtro = $('#promoFiltro').value;
  try {
    const { clientes } = await api(`/api/promociones/filtrar?filtro=${filtro}`);
    $('#promoResumen').innerHTML = `<strong>${clientes.length}</strong> cliente(s) coinciden con el filtro.`;
    window.__promoClientes = clientes;
  } catch (e) { toast('Error: ' + e.message); }
});

$('#btnGenerarCola').addEventListener('click', async () => {
  const mensaje = $('#promoMensaje').value.trim();
  const clientes = window.__promoClientes;
  if (!mensaje) { toast('Escribí un mensaje'); return; }
  if (!clientes || !clientes.length) { toast('Primero buscá los clientes con el filtro'); return; }
  try {
    const data = await api('/api/promociones/enviar', {
      method: 'POST',
      body: JSON.stringify({ clienteIds: clientes.map(c => c.id), mensaje })
    });
    PROMO_COLA = data.cola;
    renderPromoCola();
  } catch (e) { toast('Error: ' + e.message); }
});

function renderPromoCola() {
  const cont = $('#promoCola');
  if (!PROMO_COLA.length) { cont.innerHTML = ''; return; }
  cont.innerHTML = `
    <h3 class="section-title">Cola de envío (${PROMO_COLA.length})</h3>
    <p class="muted">Hacé clic en cada botón para abrir WhatsApp con el mensaje ya cargado y enviarlo. WhatsApp no permite el envío 100% automático sin la API oficial de Meta — este flujo te deja todo listo en un clic por cliente.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Cliente</th><th>Teléfono</th><th></th></tr></thead>
      <tbody>
        ${PROMO_COLA.map(c => `
          <tr>
            <td>${c.nombre}</td>
            <td>${c.telefono || '-'}</td>
            <td><a class="btn btn-whatsapp btn-sm" target="_blank" rel="noopener" href="${c.waLink}">📲 Enviar</a></td>
          </tr>`).join('')}
      </tbody>
    </table></div>`;
}

// ============================================================
// CAJA
// ============================================================
async function loadCaja() {
  try {
    const { dia, mes } = await api('/api/caja');
    $('#cajaDia').innerHTML = cajaCardsHTML(dia);
    $('#cajaMes').innerHTML = cajaCardsHTML(mes);
  } catch (e) { toast('Error: ' + e.message); }
}
function cajaCardsHTML(c) {
  return `
    <div class="card stat-card"><span class="stat-label">Facturación</span><span class="stat-value">${money(c.facturacion)}</span></div>
    <div class="card stat-card"><span class="stat-label">Efectivo</span><span class="stat-value">${money(c.efectivo)}</span></div>
    <div class="card stat-card"><span class="stat-label">Mercado Pago</span><span class="stat-value">${money(c.mercadoPago)}</span></div>
    <div class="card stat-card"><span class="stat-label">Gastos</span><span class="stat-value negative">${money(c.gastos)}</span></div>
    <div class="card stat-card"><span class="stat-label">Ganancia</span><span class="stat-value positive">${money(c.ganancia)}</span></div>`;
}

// ============================================================
// GASTOS
// ============================================================
async function loadGastos() {
  const cont = $('#gastosLista');
  cont.innerHTML = '<p class="muted">Cargando...</p>';
  try {
    const { gastos } = await api('/api/gastos');
    if (!gastos.length) {
      cont.innerHTML = `<div class="empty-state"><div class="icon">🧾</div><p>No hay gastos cargados.</p></div>`;
      return;
    }
    gastos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
    cont.innerHTML = `
    <table>
      <thead><tr><th>Fecha</th><th>Proveedor</th><th>Categoría</th><th>Importe</th><th>Obs.</th></tr></thead>
      <tbody>
        ${gastos.map(g => `
          <tr>
            <td>${new Date(g.fecha).toLocaleDateString('es-AR')}</td>
            <td>${g.proveedor || '-'}</td>
            <td>${g.categoria}</td>
            <td>${money(g.importe)}</td>
            <td>${g.observaciones || '-'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
  } catch (e) { cont.innerHTML = `<p class="muted">Error: ${e.message}</p>`; }
}

$('#btnNuevoGasto').addEventListener('click', () => {
  openModal(`
    <h3>Nuevo gasto</h3>
    <div class="form-row"><label>Proveedor</label><input type="text" id="gProveedor" class="input"></div>
    <div class="form-row"><label>Categoría</label>
      <select id="gCategoria" class="input">
        <option>Proveedores</option><option>Servicios</option><option>Alquiler</option>
        <option>Sueldos</option><option>Mantenimiento</option><option>Otros</option>
      </select>
    </div>
    <div class="form-row"><label>Importe</label><input type="number" id="gImporte" class="input" placeholder="0"></div>
    <div class="form-row"><label>Observaciones</label><input type="text" id="gObs" class="input"></div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary" id="btnGuardarGasto">Guardar</button>
    </div>
  `);
  $('#btnGuardarGasto').addEventListener('click', async () => {
    const importe = Number($('#gImporte').value);
    if (!importe) { toast('Ingresá un importe'); return; }
    try {
      await api('/api/gastos', {
        method: 'POST',
        body: JSON.stringify({
          proveedor: $('#gProveedor').value,
          categoria: $('#gCategoria').value,
          importe,
          observaciones: $('#gObs').value
        })
      });
      closeModal();
      toast('Gasto registrado');
      loadGastos();
    } catch (e) { toast('Error: ' + e.message); }
  });
});

// ============================================================
// ESTADÍSTICAS
// ============================================================
async function loadEstadisticas() {
  try {
    const d = await api('/api/estadisticas');

    $('#alertasBox').innerHTML = d.alertas.map(a => `<div class="alert alert-${a.tipo}">${iconAlerta(a.tipo)} ${a.texto}</div>`).join('') || '';

    $('#statResumen').innerHTML = `
      ${statCard('Facturación de hoy', money(d.resumen.facturacionHoy))}
      ${statCard('Ganancia de hoy', money(d.resumen.gananciaHoy), 'positive')}
      ${statCard('Gastos de hoy', money(d.resumen.gastosHoy), 'negative')}
      ${statCard('Ticket promedio', money(d.resumen.ticketPromedioHoy))}
      ${statCard('Autos lavados', d.resumen.autosLavadosHoy)}
    `;
    $('#statHoy').innerHTML = `
      ${statCard('Autos ingresados', d.hoy.ingresados)}
      ${statCard('Autos entregados', d.hoy.entregados)}
      ${statCard('Cobrado efectivo', money(d.hoy.efectivo))}
      ${statCard('Cobrado Mercado Pago', money(d.hoy.mercadoPago))}
      ${statCard('Pendiente de cobro', money(d.hoy.pendienteCobro), 'negative')}
    `;
    $('#statSemana').innerHTML = `
      ${statCard('Facturación semanal', money(d.semana.facturacion))}
      ${statCard('Gastos semanales', money(d.semana.gastos), 'negative')}
      ${statCard('Ganancia semanal', money(d.semana.ganancia), 'positive')}
      ${statCard('Promedio diario', money(d.semana.promedioDiario))}
    `;
    $('#statMes').innerHTML = `
      ${statCard('Facturación mensual', money(d.mes.facturacion))}
      ${statCard('Gastos mensuales', money(d.mes.gastos), 'negative')}
      ${statCard('Ganancia mensual', money(d.mes.ganancia), 'positive')}
      ${statCard('Clientes nuevos', d.mes.clientesNuevos)}
      ${statCard('Clientes recurrentes', d.mes.clientesRecurrentes)}
      ${statCard('Ticket promedio', money(d.mes.ticketPromedio))}
    `;
    $('#statClientes').innerHTML = `
      ${statCard('Total de clientes', d.clientes.total)}
      ${statCard('Hombres', d.clientes.hombres)}
      ${statCard('Mujeres', d.clientes.mujeres)}
      ${statCard('Jubilados', d.clientes.jubilados)}
      ${statCard('Activos', d.clientes.activos, 'positive')}
      ${statCard('Inactivos', d.clientes.inactivos, 'negative')}
    `;
    $('#statRankings').innerHTML = `
      ${rankingCard('Clientes que más gastaron', d.rankings.clientesGasto, v => money(v))}
      ${rankingCard('Clientes con más visitas', d.rankings.clientesVisitas, v => v)}
      ${rankingCard('Vehículos más frecuentes', d.rankings.vehiculosFrecuentes, v => v)}
      ${rankingCard('Servicios más vendidos', d.rankings.servicios, v => v)}
    `;

    try { renderCharts(d); } catch (chartErr) { console.warn('No se pudieron dibujar los gráficos:', chartErr); }
  } catch (e) { toast('Error: ' + e.message); }
}

function iconAlerta(tipo) {
  return { positivo: '📈', negativo: '📉', info: 'ℹ️' }[tipo] || 'ℹ️';
}
function statCard(label, value, cls = '') {
  return `<div class="card stat-card"><span class="stat-label">${label}</span><span class="stat-value ${cls}">${value}</span></div>`;
}
function rankingCard(title, items, fmt) {
  if (!items.length) return `<div class="card"><h4 style="margin:0 0 8px;">${title}</h4><p class="muted">Sin datos aún</p></div>`;
  return `<div class="card"><h4 style="margin:0 0 8px;">${title}</h4>
    ${items.map(i => `<div class="ranking-item"><span>${i.nombre}</span><span class="val">${fmt(i.valor)}</span></div>`).join('')}
  </div>`;
}

function renderCharts(d) {
  const labels = d.graficoDiario.map(g => new Date(g.fecha).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }));

  mkChart('chartFacturacion', 'line', {
    labels,
    datasets: [{ label: 'Facturación diaria', data: d.graficoDiario.map(g => g.facturacion), borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.12)', fill: true, tension: .35 }]
  });

  mkChart('chartIngresosGastos', 'bar', {
    labels,
    datasets: [
      { label: 'Ingresos', data: d.graficoDiario.map(g => g.facturacion), backgroundColor: '#16a34a' },
      { label: 'Gastos', data: d.graficoDiario.map(g => g.gastos), backgroundColor: '#dc2626' }
    ]
  });

  mkChart('chartMedioPago', 'doughnut', {
    labels: ['Efectivo', 'Mercado Pago'],
    datasets: [{ data: [d.mes.facturacion ? (d.hoy.efectivo || 0) : 0, d.hoy.mercadoPago || 0], backgroundColor: ['#0ea5e9', '#2563eb'] }]
  }, { plugins: { legend: { position: 'bottom' } } });

  mkChart('chartAutos', 'bar', {
    labels,
    datasets: [{ label: 'Autos por día', data: d.graficoDiario.map(g => g.autos), backgroundColor: '#f59e0b' }]
  });
}

function mkChart(canvasId, type, data, extraOpts = {}) {
  if (typeof Chart === 'undefined') {
    const canvas = document.getElementById(canvasId);
    if (canvas && canvas.parentElement) canvas.parentElement.innerHTML = '<p class="muted" style="padding:20px;text-align:center;">No se pudo cargar la librería de gráficos (revisá la conexión a internet).</p>';
    return;
  }
  if (CHARTS[canvasId]) CHARTS[canvasId].destroy();
  const ctx = document.getElementById(canvasId).getContext('2d');
  CHARTS[canvasId] = new Chart(ctx, {
    type, data,
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: type !== 'line' } }, ...extraOpts }
  });
}

// ============================================================
// CONFIGURACIÓN / SERVICIOS
// ============================================================
async function loadServicios() {
  try {
    const { servicios } = await api('/api/servicios');
    SERVICIOS_CACHE = servicios;
  } catch (e) { /* empleado puede no tener acceso total, igual sirve GET */ }
}

function renderServicios() {
  const cont = $('#serviciosLista');
  cont.innerHTML = SERVICIOS_CACHE.map(s => `
    <div class="service-row">
      <span>${s.nombre}</span>
      <input type="number" value="${s.precio}" onchange="actualizarPrecioServicio('${s.id}', this.value)">
    </div>`).join('');
}

async function actualizarPrecioServicio(id, precio) {
  try {
    await api(`/api/servicios/${id}`, { method: 'PUT', body: JSON.stringify({ precio: Number(precio) }) });
    toast('Precio actualizado');
    loadServicios();
  } catch (e) { toast('Error: ' + e.message); }
}

$('#btnAgregarServicio').addEventListener('click', async () => {
  const nombre = $('#nuevoServicioNombre').value.trim();
  const precio = Number($('#nuevoServicioPrecio').value) || 0;
  if (!nombre) { toast('Ingresá un nombre'); return; }
  try {
    await api('/api/servicios', { method: 'POST', body: JSON.stringify({ nombre, precio }) });
    $('#nuevoServicioNombre').value = '';
    $('#nuevoServicioPrecio').value = '';
    toast('Servicio agregado');
    await loadServicios();
    renderServicios();
  } catch (e) { toast('Error: ' + e.message); }
});

// expose to inline handlers
window.marcarEstado = marcarEstado;
window.abrirModalPago = abrirModalPago;
window.confirmarPago = confirmarPago;
window.closeModal = closeModal;
window.actualizarPrecioServicio = actualizarPrecioServicio;

// ---------- init ----------
checkSession();
