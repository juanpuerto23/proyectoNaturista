-- =================================================
-- MODELO DE BASE DE DATOS - FARMACIA HOMEOPÁTICA
-- =================================================

CREATE DATABASE farmacia_homeopatica
    WITH
    OWNER = postgres
    ENCODING = 'UTF8'
    LC_COLLATE = 'Spanish_Spain.1252'
    LC_CTYPE = 'Spanish_Spain.1252'
    TABLESPACE = pg_default
    CONNECTION LIMIT = -1
    IS_TEMPLATE = False;
	
-- Conectar a la base de datos
\c farmacia_homeopatica;

-- =================================================
-- CREACIÓN DE ROLES Y USUARIOS
-- =================================================

-- Crear rol de administrador
CREATE ROLE admin_farmacia WITH
    LOGIN
    SUPERUSER
    CREATEDB
    CREATEROLE
    INHERIT
    NOREPLICATION
    CONNECTION LIMIT -1
    PASSWORD 'admin_password_2024';

-- Crear rol de usuario regular
CREATE ROLE usuario_farmacia WITH
    LOGIN
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    INHERIT
    NOREPLICATION
    CONNECTION LIMIT -1
    PASSWORD 'usuario_password_2024';

-- =================================================
-- CREACIÓN DE TABLAS
-- =================================================

-- Tabla de Categorías de categorias
CREATE TABLE categorias (
    id_categoria SERIAL PRIMARY KEY,
    nombre_categoria VARCHAR(100) NOT NULL UNIQUE,
    descripcion_categoria TEXT,
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Proveedores
CREATE TABLE proveedores (
    id_proveedor SERIAL PRIMARY KEY,
    nombre_proveedor VARCHAR(200) NOT NULL,
    nit_proveedor VARCHAR(20) UNIQUE,
    telefono_proveedor VARCHAR(20),
    email_proveedor VARCHAR(100),
    direccion_proveedor TEXT,
    contacto_proveedor VARCHAR(100),
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Lotes
CREATE TABLE lotes (
    id_lote SERIAL PRIMARY KEY,    
    id_proveedor INTEGER REFERENCES proveedores(id_proveedor),
    fecha_recepcion DATE NOT NULL DEFAULT CURRENT_DATE,
    costo_envio DECIMAL(10,2) DEFAULT 0.00,
    total_lote DECIMAL(12,2) DEFAULT 0.00,
    observaciones TEXT,
    estado VARCHAR(20) DEFAULT 'RECIBIDO' CHECK (estado IN ('RECIBIDO', 'EN_PROCESO', 'COMPLETADO')),
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Productos
CREATE TABLE productos (
    id_producto SERIAL PRIMARY KEY,
    nombre_producto VARCHAR(200) NOT NULL,
    descripcion_producto TEXT,
    fecha_vencimiento DATE,
    fecha_recepcion DATE NOT NULL DEFAULT CURRENT_DATE,
    precio_venta DECIMAL(10,2) NOT NULL CHECK (precio_venta >= 0),
    precio_compra DECIMAL(10,2),
    stock_actual INTEGER DEFAULT 0 CHECK (stock_actual >= 0),
    stock_minimo INTEGER DEFAULT 1,
    codigo_barras VARCHAR(50) NULL,
    unidad_medida VARCHAR(20) DEFAULT 'UNIDAD',
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
	id_categoria INTEGER REFERENCES categorias(id_categoria),
    id_lote INTEGER REFERENCES lotes(id_lote),
	id_proveedor INTEGER REFERENCES proveedores(id_proveedor)
);

-- Tabla de Clientes
CREATE TABLE clientes (
    id_cliente SERIAL PRIMARY KEY,
    nombre_completo VARCHAR(200) NOT NULL,
    tipo_identificacion VARCHAR(10) DEFAULT 'CC' CHECK (tipo_identificacion IN ('CC', 'TI', 'CE', 'PP', 'NIT')),
    numero_identificacion VARCHAR(20) UNIQUE,
    telefono VARCHAR(20),
    email VARCHAR(100),
    direccion TEXT,
    fecha_nacimiento DATE,
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Empleados
CREATE TABLE empleados (
    id_empleado SERIAL PRIMARY KEY,
    nombre_completo VARCHAR(200) NOT NULL,
    numero_identificacion VARCHAR(20) UNIQUE NOT NULL,
    telefono VARCHAR(20),
    email VARCHAR(100),
    direccion TEXT,
    fecha_contratacion DATE DEFAULT CURRENT_DATE,
    salario DECIMAL(10,2),
    cargo VARCHAR(100),
    activo BOOLEAN DEFAULT TRUE,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Métodos de Pago
CREATE TABLE metodos_pago (
    id_metodo_pago SERIAL PRIMARY KEY,
    nombre_metodo VARCHAR(50) NOT NULL UNIQUE,
    descripcion VARCHAR(100),
    activo BOOLEAN DEFAULT TRUE
);

-- Insertar métodos de pago por defecto
INSERT INTO metodos_pago (nombre_metodo, descripcion) VALUES
('EFECTIVO', 'Pago en efectivo'),
('TARJETA_CREDITO', 'Tarjeta de crédito'),
('TARJETA_DEBITO', 'Tarjeta de débito'),
('NEQUI', 'Pago por Nequi'),
('BANCOLOMBIA', 'Transferencia Bancolombia'),
('DAVIPLATA', 'Pago por Daviplata'),
('PSE', 'Pago por PSE'),
('TRANSFERENCIA', 'Transferencia bancaria');

-- Tabla de Ventas (Compras hechas en la farmacia)
CREATE TABLE ventas (
    id_venta SERIAL PRIMARY KEY,
    numero_factura VARCHAR(50) UNIQUE,
    fecha_venta TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    subtotal DECIMAL(12,2) NOT NULL CHECK (subtotal >= 0),
    descuento_porcentaje DECIMAL(5,2) NULL DEFAULT 0.00 CHECK (descuento_porcentaje >= 0 AND descuento_porcentaje <= 100),
    descuento_valor DECIMAL(10,2) NULL DEFAULT 0.00 CHECK (descuento_valor >= 0),
    iva_porcentaje DECIMAL(5,2),
    iva_valor DECIMAL(10,2) DEFAULT 0.00,
    total_pagar DECIMAL(12,2) NOT NULL CHECK (total_pagar >= 0),
    observaciones TEXT,
    estado VARCHAR(20) DEFAULT 'COMPLETADA' CHECK (estado IN ('PENDIENTE', 'COMPLETADA', 'CANCELADA', 'DEVUELTA')),
	id_cliente INTEGER REFERENCES clientes(id_cliente),
    id_empleado INTEGER REFERENCES empleados(id_empleado),
	id_metodo_pago INTEGER REFERENCES metodos_pago(id_metodo_pago) NOT NULL
);

-- Tabla de Detalle de Ventas
CREATE TABLE detalle_ventas (
    id_detalle_venta SERIAL PRIMARY KEY,
    id_venta INTEGER REFERENCES ventas(id_venta) ON DELETE CASCADE,
    id_producto INTEGER REFERENCES productos(id_producto),
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    precio_unitario DECIMAL(10,2) NOT NULL CHECK (precio_unitario >= 0),
    subtotal_detalle DECIMAL(10,2) NOT NULL CHECK (subtotal_detalle >= 0),
    descuento_detalle DECIMAL(10,2) DEFAULT 0.00,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =================================================
-- AGREGAR RELACIONES CON ALTER TABLE
-- =================================================

-- Relaciones para tabla lotes
ALTER TABLE lotes 
ADD CONSTRAINT fk_lotes_proveedor 
FOREIGN KEY (id_proveedor) REFERENCES proveedores(id_proveedor);

-- Relaciones para tabla productos
ALTER TABLE productos 
ADD CONSTRAINT fk_productos_categoria 
FOREIGN KEY (id_categoria) REFERENCES categorias(id_categoria);

ALTER TABLE productos 
ADD CONSTRAINT fk_productos_lote 
FOREIGN KEY (id_lote) REFERENCES lotes(id_lote);

-- Relaciones para tabla ventas
ALTER TABLE ventas 
ADD CONSTRAINT fk_ventas_cliente 
FOREIGN KEY (id_cliente) REFERENCES clientes(id_cliente);

ALTER TABLE ventas 
ADD CONSTRAINT fk_ventas_empleado 
FOREIGN KEY (id_empleado) REFERENCES empleados(id_empleado);

ALTER TABLE ventas 
ADD CONSTRAINT fk_ventas_metodo_pago 
FOREIGN KEY (id_metodo_pago) REFERENCES metodos_pago(id_metodo_pago);

-- Relaciones para tabla detalle_ventas
ALTER TABLE detalle_ventas 
ADD CONSTRAINT fk_detalle_ventas_venta 
FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE;

ALTER TABLE detalle_ventas 
ADD CONSTRAINT fk_detalle_ventas_producto 
FOREIGN KEY (id_producto) REFERENCES productos(id_producto);

-- =================================================
-- ÍNDICES PARA OPTIMIZACIÓN
-- =================================================

-- Índices para búsquedas frecuentes
CREATE INDEX idx_productos_nombre ON productos(nombre_producto);
CREATE INDEX idx_productos_categoria ON productos(id_categoria);
CREATE INDEX idx_productos_lote ON productos(id_lote);
CREATE INDEX idx_productos_vencimiento ON productos(fecha_vencimiento);
CREATE INDEX idx_productos_stock ON productos(stock_actual);

CREATE INDEX idx_ventas_fecha ON ventas(fecha_venta);
CREATE INDEX idx_ventas_cliente ON ventas(id_cliente);
CREATE INDEX idx_ventas_empleado ON ventas(id_empleado);
CREATE INDEX idx_ventas_numero_factura ON ventas(numero_factura);

CREATE INDEX idx_clientes_identificacion ON clientes(numero_identificacion);
CREATE INDEX idx_empleados_identificacion ON empleados(numero_identificacion);

CREATE INDEX idx_lotes_fecha ON lotes(fecha_recepcion);
CREATE INDEX idx_lotes_proveedor ON lotes(id_proveedor);

-- =================================================
-- TRIGGERS Y FUNCIONES
-- =================================================

-- Función para actualizar stock después de una venta
CREATE OR REPLACE FUNCTION actualizar_stock_venta()
RETURNS TRIGGER AS $$
BEGIN
    -- Actualizar stock del producto
    UPDATE productos 
    SET stock_actual = stock_actual - NEW.cantidad
    WHERE id_producto = NEW.id_producto;
    
    -- Verificar si el stock no queda negativo
    IF (SELECT stock_actual FROM productos WHERE id_producto = NEW.id_producto) < 0 THEN
        RAISE EXCEPTION 'Stock insuficiente para el producto: %', NEW.nombre_producto;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para actualizar stock en ventas
CREATE TRIGGER trigger_actualizar_stock_venta
    AFTER INSERT ON detalle_ventas
    FOR EACH ROW
    EXECUTE FUNCTION actualizar_stock_venta();

-- Función para generar número de lote automáticamente
CREATE OR REPLACE FUNCTION generar_numero_lote()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.numero_lote IS NULL OR NEW.numero_lote = '' THEN
        NEW.numero_lote := 'LT' || to_char(NEW.fecha_recepcion, 'DDMMYYYY') || '-' || 
                          LPAD(NEW.id_lote::text, 4, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para generar número de lote
CREATE TRIGGER trigger_generar_numero_lote
    BEFORE INSERT ON lotes
    FOR EACH ROW
    EXECUTE FUNCTION generar_numero_lote();

-- Función para generar número de factura
CREATE OR REPLACE FUNCTION generar_numero_factura()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.numero_factura IS NULL OR NEW.numero_factura = '' THEN
        NEW.numero_factura := 'FAC' || to_char(NEW.fecha_venta, 'DDMMYYYY') || '-' || 
                             LPAD(NEW.id_venta::text, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger para generar número de factura
CREATE TRIGGER trigger_generar_numero_factura
    BEFORE INSERT ON ventas
    FOR EACH ROW
    EXECUTE FUNCTION generar_numero_factura();

-- =================================================
-- PERMISOS PARA USUARIOS
-- =================================================

-- Permisos para administrador (ya tiene todos los permisos)

-- Permisos para usuario regular
GRANT CONNECT ON DATABASE farmacia_homeopatica TO usuario_farmacia;
GRANT USAGE ON SCHEMA public TO usuario_farmacia;

-- Permisos de lectura y escritura en todas las tablas
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO usuario_farmacia;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO usuario_farmacia;

-- Restricción: usuario regular no puede eliminar registros principales
REVOKE DELETE ON productos, clientes, empleados, categorias, proveedores FROM usuario_farmacia;

-- =================================================
-- DATOS DE EJEMPLO
-- =================================================

-- Insertar categorías de ejemplo
INSERT INTO categorias (nombre_categoria, descripcion_categoria) VALUES
('MEDICAMENTOS_HOMEOPATICOS', 'Medicamentos homeopáticos tradicionales'),
('FLORES_BACH', 'Esencias florales de Bach'),
('SUPLEMENTOS', 'Suplementos nutricionales y vitaminas'),
('FITOTERAPIA', 'Productos de fitoterapia y plantas medicinales'),
('COSMÉTICA_NATURAL', 'Productos de cosmética natural y orgánica'),
('AROMATERAPIA', 'Aceites esenciales y productos de aromaterapia');

-- Insertar proveedor de ejemplo
INSERT INTO proveedores (nombre_proveedor, nit_proveedor, telefono_proveedor, email_proveedor, direccion_proveedor, contacto_proveedor) VALUES
('Laboratorios Homeopáticos S.A.S', '900123456-1', '3001234567', 'ventas@labhomeo.com', 'Carrera 10 #45-67, Bogotá', 'Ana García');

-- Insertar empleado de ejemplo
INSERT INTO empleados (nombre_completo, numero_identificacion, telefono, email, cargo) VALUES
('María Elena Rodríguez', '12345678', '3009876543', 'maria@farmacia.com', 'Administradora'),
('Carlos Andrés López', '87654321', '3001112233', 'carlos@farmacia.com', 'Vendedor');

-- =================================================
-- VISTAS ÚTILES
-- =================================================

-- Vista de productos con información completa
CREATE VIEW vista_productos_completa AS
SELECT 
    p.id_producto,
    p.nombre_producto,
    c.nombre_categoria,
    p.descripcion_producto,
    p.fecha_vencimiento,
    p.precio_venta,
    p.stock_actual,
    p.stock_minimo,
    l.numero_lote,
    l.fecha_recepcion,
    pr.nombre_proveedor,
    CASE 
        WHEN p.fecha_vencimiento < CURRENT_DATE THEN 'VENCIDO'
        WHEN p.fecha_vencimiento <= CURRENT_DATE + INTERVAL '30 days' THEN 'POR_VENCER'
        ELSE 'VIGENTE'
    END as estado_vencimiento,
    CASE 
        WHEN p.stock_actual <= p.stock_minimo THEN 'STOCK_BAJO'
        ELSE 'STOCK_OK'
    END as estado_stock
FROM productos p
LEFT JOIN categorias c ON p.id_categoria = c.id_categoria
LEFT JOIN lotes l ON p.id_lote = l.id_lote
LEFT JOIN proveedores pr ON l.id_proveedor = pr.id_proveedor
WHERE p.activo = TRUE;

-- Vista de ventas del día
CREATE VIEW vista_ventas_hoy AS
SELECT 
    v.id_venta,
    v.numero_factura,
    c.nombre_completo as cliente,
    e.nombre_completo as empleado,
    v.fecha_venta,
    v.subtotal,
    v.descuento_valor,
    v.iva_valor,
    v.total_pagar,
    mp.nombre_metodo as metodo_pago
FROM ventas v
LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
JOIN empleados e ON v.id_empleado = e.id_empleado
JOIN metodos_pago mp ON v.id_metodo_pago = mp.id_metodo_pago
WHERE DATE(v.fecha_venta) = CURRENT_DATE
ORDER BY v.fecha_venta DESC;

-- =================================================
-- COMENTARIOS EN TABLAS
-- =================================================

COMMENT ON TABLE productos IS 'Tabla principal de productos de la farmacia homeopática';
COMMENT ON TABLE ventas IS 'Tabla de registros de ventas/compras realizadas en la farmacia';
COMMENT ON TABLE lotes IS 'Tabla de control de lotes de productos recibidos';
COMMENT ON TABLE clientes IS 'Tabla de información de clientes de la farmacia';
COMMENT ON TABLE empleados IS 'Tabla de empleados de la farmacia';
