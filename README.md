# Lavadero Pro — Sistema de Gestión (SaaS)

Sistema completo de gestión para lavaderos de autos: login con sesiones reales,
clientes, vehículos del día, caja, gastos, promociones por WhatsApp y estadísticas.

## 👤 Usuarios

| Usuario    | Contraseña     | Rol           | Acceso                                  |
|------------|----------------|---------------|------------------------------------------|
| `andres`   | `andres128010` | Administrador | Todo el sistema                          |
| `empleado` | `mario123`     | Empleado      | Solo la pestaña "Hoy"                    |

## 🚀 Cómo subirlo a internet (gratis) — Render.com

Este sistema tiene un servidor real (no son solo archivos HTML), por eso necesita
un hosting que ejecute Node.js. **Google Sites / Google Drive no sirven para esto**
porque solo alojan archivos estáticos. La opción gratuita más simple es **Render**:

1. Entrá a **https://render.com** y creá una cuenta gratis (podés usar tu cuenta de Google).
2. Subí esta carpeta a un repositorio de GitHub:
   - Entrá a **https://github.com/new**, creá un repositorio (por ejemplo `lavadero-pro`).
   - Subí todos los archivos de esta carpeta a ese repositorio (podés arrastrar los
     archivos directamente desde la web de GitHub con el botón "uploading an existing file").
3. En Render, hacé clic en **New +** → **Web Service**.
4. Conectá tu cuenta de GitHub y seleccioná el repositorio `lavadero-pro`.
5. Configurá:
   - **Name**: `lavadero-pro` (o el nombre que quieras — será parte del link)
   - **Environment**: `Node`
   - **Build Command**: dejar vacío (no tiene dependencias externas)
   - **Start Command**: `node server.js`
   - **Instance Type**: `Free`
6. Hacé clic en **Create Web Service** y esperá 2-3 minutos.
7. Render te va a dar un link del tipo:
   ```
   https://lavadero-pro.onrender.com
   ```
   Ese es el link que le compartís a Andrés y al Empleado para entrar desde
   cualquier celular o computadora.

> ⚠️ **Plan gratuito de Render**: el servidor "se duerme" tras 15 minutos sin uso
> y tarda unos 30-50 segundos en despertar la primera vez que alguien entra en el
> día. Si eso molesta, se puede pasar al plan pago (~7 USD/mes) para que esté
> siempre activo al instante. Puedo ayudarte con ese cambio cuando quieras.

## 💾 Sobre los datos

Los datos (clientes, vehículos, gastos, etc.) se guardan en un archivo dentro del
propio servidor (`data/db.json`), así que **no se pierden** cuando se reinicia,
salvo que Render borre el disco (en el plan free, el disco es persistente mientras
el servicio no se elimine; si en el futuro querés más garantías, puedo migrar
esto a una base de datos como PostgreSQL, incluida gratis en Render).

## 📲 Sobre los mensajes de WhatsApp

WhatsApp no permite enviar mensajes 100% automáticos sin la API oficial de Meta
(que requiere aprobación, número de teléfono verificado y tiene costo). Por eso
el sistema arma el mensaje automáticamente y te deja **un botón por cliente**
que abre WhatsApp con el mensaje ya escrito — solo hay que tocar "Enviar". Es el
mismo método que usan la mayoría de los comercios chicos. Si en el futuro querés
automatizar el envío al 100%, se puede integrar la API oficial de WhatsApp Business.

## 🖥️ Probarlo en tu computadora (opcional, antes de subirlo)

Si tenés Node.js instalado:
```
node server.js
```
Y abrís `http://localhost:3000` en el navegador.

## 🧱 Estructura del proyecto

```
lavadero-pro/
├── server.js          → todo el backend (login, sesiones, API, base de datos)
├── package.json
├── data/               → acá se guarda la base de datos (se crea sola)
└── public/
    ├── index.html      → login + estructura de la app
    ├── app.js           → toda la lógica del frontend
    └── styles.css       → diseño
```

## 🔮 Preparado para crecer

La arquitectura ya está lista para agregar en el futuro, sin romper nada:
agenda de turnos, fidelización, cupones, recordatorios automáticos, múltiples
sucursales, exportación a Excel/PDF, integración de cobros con Mercado Pago,
y backup automático.
