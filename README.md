# Sistema de Control Presupuestario y Gestión Financiera — Enseña por Bolivia (ExB)

Plataforma integral de seguimiento presupuestario, auditoría contable automatizada y análisis financiero en tiempo real diseñada para **Enseña por Bolivia**.

---

## Características Principales

* **Dashboard Ejecutivo Interactivo:** Visualización de Presupuesto Vigente, Ejecución Acumulada, Saldo Disponible y Avance Global mediante gráficos comparativos por rubro, evolución mensual y distribución por financiador.
* **7 Reportes Oficiales Consolidados:** Generación dinámica con filtros cruzados (Gestión, Región, Financiador, Área y Rubro) y exportación directa a **Excel (`.xlsx`)** y **PDF (`.pdf`)**:
  1. Resumen General Consolidado
  2. Ejecución por Rubro y Cuenta
  3. Ejecución por Financiador
  4. Ejecución por Área y Financiador
  5. Ejecución por Región
  6. Ejecución por Mes
  7. Detalle de Movimientos
* **Conversión Multimoneda en Vivo (`BS` / `USD`):** Cálculo instantáneo utilizando el tipo de cambio configurable o referencial.
* **Motor de Importación y Auditoría Contable:** Carga masiva desde hojas de cálculo Excel (`BD`) con detección de alertas contables, prevención de duplicados y sistema de **copias de seguridad rotativas** con restauración a un clic.
* **Copiloto Financiero con IA:** Asistente conversacional integrado (impulsado por **Google Gemini**) que analiza los datos financieros en vivo según los filtros activos y el rol del usuario.
* **Control de Acceso por Roles (`ADMIN` / `TECNICO`) y Editor SQL:** Gestión de permisos diferenciados y administración directa sobre PostgreSQL para perfiles administradores.

---

## Arquitectura y Tecnologías

| Capa | Tecnologías |
| :--- | :--- |
| **Frontend** | Next.js (App Router), React, TypeScript, Tailwind CSS, Recharts, Lucide Icons |
| **Backend** | Python 3.11+, FastAPI, SQLAlchemy, Pydantic, Pandas, OpenPyXL, ReportLab |
| **Base de Datos** | PostgreSQL en la nube (Neon) |
| **Inteligencia Artificial** | Google Gemini API (`google-genai`) |
| **Seguridad** | Autenticación JWT (`python-jose`) y hashing de contraseñas (`passlib` / `bcrypt`) |

---

## Estructura del Proyecto

```text
exb-control-hackathon/
├── exb-backend/          # API REST en FastAPI, lógica contable, reportes e IA
│   ├── main.py           # Endpoints principales y middleware CORS
│   ├── database.py       # Conexión y modelos SQLAlchemy para PostgreSQL
│   ├── auth.py           # Gestión de tokens JWT y roles
│   ├── importador.py     # Procesamiento y auditoría de archivos Excel
│   ├── exportador.py     # Generación de reportes en Excel y PDF
│   ├── tipo_cambio.py    # Gestión de tasas de cambio BS/USD
│   └── requirements.txt  # Dependencias de Python
│
└── exb-frontend/         # Interfaz ejecutiva en Next.js
    └── src/app/
        └── page.tsx      # Dashboard, reportes, editor BD y Copiloto IA
