CREATE DATABASE FarmaciaHomeopatica;
USE FarmaciaHomeopatica;

CREATE TABLE Productos(
    id_producto INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR NOT NULL,
    tipo VARCHAR NOT NULL,
    fecha_vencimiento DATE NULL,
    precio DECIMAL(10, 2) NOT NULL
);

CREATE TABLE Lote(
    id_lote INT AUTO_INCREMENT PRIMARY KEY,
    id_producto INT NOT NULL, -- Foreign key from producto
    fecha_llegada DATE NOT NULL,
    cantidad INT NOT NULL
);

CREATE TABLE Proveedores(
    id_proveedor INT AUTO_INCREMENT PRIMARY KEY,
    nombre_proveedor VARCHAR NOT NULL,
    costo_envio DECIMAL(10, 2) NULL
);

CREATE TABLE Compras(
    id_compra INT AUTO_INCREMENT PRIMARY KEY,
    id_producto INT NOT NULL, -- Foreign Key from producto
    id_proveedor INT NOT NULL, -- Foreing Key from proveedor
    fecha_compra DATE NOT NULL,
    cantidad INT NOT NULL,
    costo_total DECIMAL(10, 2) NOT NULL,
    descuento DECIMAL(5, 2) NOT NULL
);

CREATE TABLE Usuarios(
    id_usuario INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR NOT NULL,
    rol ENUM('Admin', 'Empleado') NOT NULL,
    password VARCHAR NOT NULL
);