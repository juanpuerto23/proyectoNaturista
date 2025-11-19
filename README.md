# Proyecto Naturista

Sistema integral para la gestión de una Farmacia / Tienda Naturista: inventario, clientes, proveedores, ventas (facturación electrónica interna) y reportes. Implementado con HTML/CSS/Bootstrap en el frontend y Node.js + Express en el backend. Persistencia en PostgreSQL (local o remota) con opción de usar Supabase como capa de servicio administrada.

[![License: Apache-2.0](https://img.shields.io/github/license/aniyomiorg/aniyomi?labelColor=27303D&color=818cf8)](/LICENSE)
![GitHub](https://img.shields.io/github/commit-activity/m/juanpuerto23/ProyectoNaturista)

---
## Tabla de Contenido
1. Resumen Rápido
2. Arquitectura
3. Requisitos Previos
4. Instalación y Puesta en Marcha
5. Variables de Entorno (.env)
6. Estructura del Proyecto
7. Endpoints API (Backend Express)
8. Flujos Principales de Uso
9. Esquema de Base de Datos y Capacidades (Triggers / Índices / Vistas)
10. Ejemplos de Requests
11. Seguridad y Buenas Prácticas
12. Troubleshooting (Problemas Comunes)
13. Roadmap / Mejoras Futuras
14. Créditos

---
## 1. Resumen Rápido
El proyecto ofrece:
- Gestión de productos (categorías, stock, vencimientos, lotes, proveedores).
- Gestión de clientes y control básico de ventas.
- Facturación interna con generación automática de número de factura (trigger en DB).
- Integración opcional con Supabase para transición/migración hacia BaaS.
- Vistas y triggers para optimizar procesos (stock, vencimientos, numeraciones).

Modo de ejecución mínimo: `npm install` + `.env` + `npm start` y acceder a `http://localhost:3000`.

---
## 2. Arquitectura

| Capa | Descripción |
|------|-------------|
| Presentación | Archivos HTML estáticos en `public/` (login, menú, inventario, reportes, facturas). Estilos en `public/css/` y Bootstrap 5.3.3. |
| Lógica Frontend | Scripts simples en `public/js/` (ej. `index.js` simula login; pendiente integrar con `/login`). |
| Backend API | `public/server.js` (Express). Expone endpoints REST para productos, categorías, proveedores, clientes, ventas, autenticación y sincronización de secuencias. |
| Persistencia | PostgreSQL accesible vía `postgres` (DATABASE_URL) y/o Supabase (`@supabase/supabase-js`). Fallback automático: si existen credenciales Supabase se usa Supabase, si no, conexión directa. |
| Seguridad | Hash de contraseñas soporta bcrypt y formato `pbkdf2_sha256` estilo Django. Validaciones básicas y uso de `crypto.timingSafeEqual` para comparar hashes PBKDF2. |
| Integraciones | Entorno `.env` para credenciales. Supabase como alternativa administrada. |
| Optimización | Índices y vistas (`vista_productos_completa`, `vista_ventas_hoy`). Triggers para stock y numeración. |

Patrón de migración progresiva: código intenta primero Supabase y recurre a SQL directo como fallback. Permite transición sin romper el frontend.

---
## 3. Requisitos Previos
- Node.js >= 18
- PostgreSQL (local o remoto) ó cuenta Supabase
- Git
- (Opcional) Extensión VS Code: Live Server para iterar interfaz

---
## 4. Instalación y Puesta en Marcha

```bash
git clone https://github.com/juanpuerto23/proyectoNaturista.git
cd proyectoNaturista
npm install
```

Crear archivo `.env` (ver sección 5) y luego:

```bash
npm start
```

Acceder: `http://localhost:3000/index.html` (login) o directamente `http://localhost:3000/menu.html` si ya autenticado.

Si solo desea ver el frontend sin backend, puede usar Live Server, pero las operaciones CRUD/ventas no funcionarán.

---
## 5. Variables de Entorno (.env)

Ejemplo mínimo si usa conexión directa (DATABASE_URL):
```
DATABASE_URL=postgres://usuario:password@host:5432/farmacia_homeopatica
ADMIN_SECRET=un_valor_seguro_opcional
```

Para Supabase:
```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_KEY=clave_anon_ou_service
DATABASE_URL=postgres://usuario:password@host:5432/farmacia_homeopatica   # (opcional fallback)
```

Variables legacy vistas en `main.js` (pool manual):
```
DB_HOST=host
DB_PORT=5432
DB_NAME=farmacia_homeopatica
DB_USER=usuario
DB_PASSWORD=password
```
Recomendado centralizar en `DATABASE_URL` y eliminar uso duplicado progresivamente.

`ADMIN_SECRET` protege la ruta `/admin/sync-sequences` (header `x-admin-secret`).

---
## 6. Estructura del Proyecto
```
proyectoNaturista/
├── db/
│   └── DataBase.sql              # Script completo de schema, índices, triggers, vistas
├── public/
│   ├── server.js                 # API Express principal
│   ├── supabaseClient.js         # Inicialización condicional Supabase
│   ├── db.js                     # Conexión postgres vía DATABASE_URL
│   ├── index.html                # Login
│   ├── menu.html                 # Menú principal
│   ├── pages/                    # Módulos específicos (inventario, clientes, ventas, reportes)
│   │   ├── inventario.html
│   │   ├── facturasElectronicas.html
│   │   ├── gestorClientesMenu.html
│   │   └── reportes.html
│   ├── js/
│   │   ├── index.js              # Login simulado (pendiente: integrar /login)
│   │   └── main.js               # Código conceptual de servicios (mezcla ESM/CommonJS, revisar)
│   ├── css/                      # Estilos por pantalla
│   └── img/                      # Recursos gráficos
├── package.json
├── README.md
└── .env (no versionado)
```

Notas:
- `main.js` mezcla `import` y `require`; no operativo en modo `type: module` actual. Sirve como blueprint de servicios (ProductoService, VentaService, etc.).
- En producción, mover servicios a carpeta `src/services` y unificar estilo (ESM).

---
## 7. Endpoints API (Resumen)

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | /productos | Lista productos |
| POST | /productos | Crear producto |
| PATCH | /productos/:id | Actualizar campos producto |
| DELETE | /productos/:id | Eliminar producto |
| GET | /productos/ids | Diagnóstico columnas/ids |
| GET | /categorias | Listar categorías |
| POST | /categorias | Crear categoría |
| GET | /proveedores | Listar proveedores |
| POST | /proveedores | Crear proveedor |
| GET | /clientes | Listar clientes |
| GET | /clientes/:id | Obtener cliente |
| POST | /clientes | Crear cliente |
| PATCH | /clientes/:id | Actualizar cliente |
| DELETE | /clientes/:id | Eliminar cliente |
| GET | /ventas | Listar ventas (últimas) |
| POST | /ventas | Crear venta con detalles y decremento de stock |
| POST | /login | Autenticación (bcrypt/pbkdf2) |
| POST | /admin/sync-sequences | Re-sincroniza secuencias (requiere `ADMIN_SECRET`) |
| GET | /api/supabase/categorias | Categorías via Supabase |
| GET | /api/supabase/clientes | Clientes via Supabase |
| POST | /api/supabase/query | Query genérica segura limitada |

Todas retornan JSON. Errores estandarizados via `error` / `detail`.

---
## 8. Flujos Principales de Uso

### 8.1 Login
1. Usuario ingresa credenciales en `index.html`.
2. (Actual) `index.js` valida contra hardcode (`admin/admin`).
3. (Recomendado) Reemplazar por fetch:
	 ```js
	 fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})})
	 ```
4. Al éxito guardar token/sesión (actualmente localStorage flag simple) y redirigir a `menu.html`.

### 8.2 Inventario
- GET `/productos` para poblar tabla.
- POST `/productos` para agregar nuevos items.
- PATCH para ajustes de stock o precio.

### 8.3 Facturación / Ventas
1. Frontend reúne cliente, detalles y totales.
2. POST `/ventas` con `detalles[]`.
3. Backend valida stock, inserta venta y detalles, decrementa stock.
4. Trigger DB genera `numero_factura` si no se envía.

### 8.4 Clientes
- CRUD completo para gestión y futuras segmentaciones.

### 8.5 Reportes
- Usar vistas: `vista_ventas_hoy`, `vista_productos_completa` para métricas básicas (estado vencimiento / stock). En endpoints actuales se devuelve tabla base; puede ampliarse exponiendo estas vistas.

---
## 9. Esquema de Base de Datos (Resumen)
Archivo completo: `db/DataBase.sql` (contiene DDL, índices, triggers, vistas, datos de ejemplo). Componentes clave:
- Tablas: `categorias`, `proveedores`, `lotes`, `productos`, `clientes`, `empleados`, `metodos_pago`, `ventas`, `detalle_ventas`.
- Índices: prefijo `idx_` optimiza búsquedas frecuentes (nombre, categoría, fecha, cliente, factura, stock, vencimientos).
- Triggers:
	- `trigger_actualizar_stock_venta` (descuenta stock tras insertar detalle de venta).
	- `trigger_generar_numero_lote` / `trigger_generar_numero_factura` (autogeneran códigos únicos). 
- Vistas:
	- `vista_productos_completa`: estado vencimiento / stock.
	- `vista_ventas_hoy`: resumen ventas día.

---
## 10. Ejemplos de Requests

### Crear Producto
```bash
curl -X POST http://localhost:3000/productos \
	-H "Content-Type: application/json" \
	-d '{
		"nombre_producto": "Tintura Caléndula",
		"descripcion_producto": "Extracto concentrado",
		"id_categoria": 1,
		"id_proveedor": 1,
		"stock_actual": 20,
		"precio_venta": 15000,
		"fecha_vencimiento": "2025-12-31"
	}'
```

### Crear Cliente
```bash
curl -X POST http://localhost:3000/clientes \
	-H "Content-Type: application/json" \
	-d '{
		"nombre_completo": "Juan Pérez",
		"numero_identificacion": "123456789",
		"telefono": "3001112233",
		"email": "juan@example.com"
	}'
```

### Login
```bash
curl -X POST http://localhost:3000/login \
	-H "Content-Type: application/json" \
	-d '{"username":"admin","password":"admin"}'
```

### Crear Venta
```bash
curl -X POST http://localhost:3000/ventas \
	-H "Content-Type: application/json" \
	-d '{
		"id_cliente": 1,
		"subtotal": 30000,
		"descuento_porcentaje": 0,
		"descuento_valor": 0,
		"iva_porcentaje": 0,
		"iva_valor": 0,
		"total_pagar": 30000,
		"detalles": [
			{"id_producto": 5, "cantidad": 2, "precio_unitario": 15000, "subtotal_detalle": 30000}
		]
	}'
```

### Sincronizar Secuencias (admin)
```bash
curl -X POST http://localhost:3000/admin/sync-sequences \
	-H "x-admin-secret: un_valor_seguro"
```

---
## 11. Seguridad y Buenas Prácticas
- Contraseñas: usar siempre bcrypt al crear nuevas (cost ~10-12). El backend soporta también hashes pbkdf2 estilo Django para migraciones.
- Nunca exponer `SUPABASE_KEY` pública si es service role; usar la anon key para frontend.
- Validar entrada en el frontend (números, fechas, precios >= 0).
- Implementar control de sesiones/token (JWT o cookie segura) — actualmente faltante.
- Limitar `/api/supabase/query` o eliminarlo en producción (riesgo de abuso si se amplía sin validación estricta).
- Usar HTTPS en despliegue y variables en entorno (Vercel / Railway / Render).

### Recomendaciones Corto Plazo
1. Sustituir login simulado por consumo real de `/login`.
2. Unificar servicios en carpeta `src/` y eliminar código duplicado (`main.js`).
3. Añadir validaciones de esquema (zod / joi) para POST/PATCH.
4. Agregar paginación en listados grandes (`/productos`, `/clientes`, `/ventas`).
5. Añadir capa de autorización por rol (admin / vendedor). 

---
## 12. Troubleshooting
| Problema | Causa | Solución |
|----------|-------|----------|
| Error conexión DB | `DATABASE_URL` inválida | Revisar formato `postgres://user:pass@host:port/db` |
| Supabase no configurado | Faltan `SUPABASE_URL` / `SUPABASE_KEY` | Definir en `.env` o ignorar si no usa |
| Login siempre falla | Hash distinto o usuario inactivo | Verificar tabla `usuarios` y formato hash |
| Factura duplicada | Condiciones de carrera en inserción | Backend ya reintenta; revisar secuencia y locks |
| Stock negativo | Datos inconsistentes previos | Validar triggers y corregir registros manuales |

Logs útiles: consola al arrancar muestra inicialización Supabase y URL DB.

---
## 13. Roadmap / Mejoras Futuras
- Autenticación JWT + refresco.
- Panel de reportes con gráficos (ventas por período, rotación de stock).
- Exportaciones CSV/PDF de facturas y productos.
- Sistema de roles granular (lectura/escritura).
- Integración pasarela de pagos.
- Tests automatizados (unitarios y de integración) — actualmente inexistentes.
- Dockerización (Dockerfile + compose para Postgres).

---
## 14. Créditos
Autor(es): Equipo académico / juanpuerto23. 
Base de datos y modelo: diseñado para farmacia naturista con prácticas de integridad (FK, checks, triggers).

---
## Anexos Visuales
### ERD
![Modelo ERD](public/img/modeloERD.png)
### Login
![Captura Login](public/img/login.png)
### Menú Responsive
![Captura Menu](public/img/menu_responsive.png)
### Animación Menú
![Captura Menu Animacion](public/img/menu_animation.png)
