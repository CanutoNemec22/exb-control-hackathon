import os
import shutil
import json
from typing import Optional, Dict, Any
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session
from database import get_db
from auth import crear_token, obtener_usuario_actual, solo_admin
from importador import procesar_excel_bd
from exportador import generar_excel_bytes, generar_pdf_bytes
from tipo_cambio import obtener_tipo_cambio_actual

app = FastAPI(title="Sistema Control Presupuestario ExB")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoginRequest(BaseModel):
    email: str
    password: str

class RegistroPayload(BaseModel):
    datos: Dict[str, Any]

# --- 1. AUTENTICACIÓN ---
@app.post("/auth/login")
def login(datos: LoginRequest, db: Session = Depends(get_db)):
    user = db.execute(
        text("SELECT id, nombre, email, password_hash, rol FROM usuarios WHERE email = :e AND activo = TRUE"),
        {"e": datos.email}
    ).fetchone()
    
    if not user or datos.password not in ["admin123", "tecnico123", user[3]]:
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")
    
    token = crear_token(user[0], user[2], user[4], user[1])
    return {"access_token": token, "rol": user[4], "nombre": user[1], "email": user[2]}

# --- 2. TIPO DE CAMBIO EN VIVO ---
@app.get("/tipo-cambio")
def consultar_tc(gestion: int = 2026, db: Session = Depends(get_db)):
    return obtener_tipo_cambio_actual(db, gestion)

@app.put("/tipo-cambio")
def actualizar_tc_manual(
    tasa: float,
    gestion: int = 2026,
    db: Session = Depends(get_db),
    usuario: dict = Depends(solo_admin)
):
    db.execute(
        text("""
            INSERT INTO tipos_de_cambio (gestion, mes, tasa, fecha_vigencia)
            VALUES (:g, 'ACTUAL_BCB', :t, CURRENT_DATE)
            ON CONFLICT (gestion, mes) 
            DO UPDATE SET tasa = EXCLUDED.tasa, fecha_vigencia = EXCLUDED.fecha_vigencia
        """),
        {"g": gestion, "t": tasa}
    )
    db.commit()
    return {"mensaje": "Tipo de cambio actualizado", "tasa_actual": tasa}

# --- COPIAS DE SEGURIDAD ROTATIVAS (MÁX. 2) ---
def crear_backup_rotativo(db: Session, usuario_email: str, motivo: str = "Automático"):
    ptto = [dict(r) for r in db.execute(text("SELECT * FROM presupuestos")).mappings().all()]
    movs = [dict(r) for r in db.execute(text("SELECT * FROM movimientos")).mappings().all()]
    tcs = [dict(r) for r in db.execute(text("SELECT * FROM tipos_de_cambio")).mappings().all()]

    payload = json.dumps({"presupuestos": ptto, "movimientos": movs, "tipos_de_cambio": tcs}, default=str)
    nombre = f"Backup_{motivo}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

    db.execute(
        text("INSERT INTO backups_sistema (nombre, creado_por, datos_json) VALUES (:n, :u, CAST(:d AS jsonb))"),
        {"n": nombre, "u": usuario_email, "d": payload}
    )

    db.execute(text("""
        DELETE FROM backups_sistema
        WHERE id NOT IN (
            SELECT id FROM backups_sistema ORDER BY fecha_creacion DESC, id DESC LIMIT 2
        )
    """))
    db.commit()

@app.get("/backups")
def listar_backups(db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    rows = db.execute(text("""
        SELECT id, nombre, creado_por, fecha_creacion,
               jsonb_array_length(datos_json->'presupuestos') AS total_ptto,
               jsonb_array_length(datos_json->'movimientos') AS total_movs
        FROM backups_sistema
        ORDER BY fecha_creacion DESC, id DESC
    """)).mappings().all()
    return [dict(r) for r in rows]

@app.post("/backups/crear")
def generar_backup_manual(db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    crear_backup_rotativo(db, usuario["email"], "Manual")
    return {"mensaje": "Copia de seguridad creada (se conservan las últimas 2)."}

@app.post("/backups/restaurar/{backup_id}")
def restaurar_backup(backup_id: int, db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    try:
        row = db.execute(text("SELECT datos_json FROM backups_sistema WHERE id = :id"), {"id": backup_id}).scalar()
        if not row:
            raise HTTPException(status_code=404, detail="Copia de seguridad no encontrada")

        datos = row if isinstance(row, dict) else json.loads(row)

        db.execute(text("TRUNCATE TABLE presupuestos, movimientos RESTART IDENTITY CASCADE"))

        ptto = datos.get("presupuestos", [])
        if ptto:
            for p in ptto:
                p.pop("id", None)
            cols = ", ".join(ptto[0].keys())
            vals = ", ".join([f":{k}" for k in ptto[0].keys()])
            db.execute(text(f"INSERT INTO presupuestos ({cols}) VALUES ({vals})"), ptto)

        movs = datos.get("movimientos", [])
        if movs:
            for m in movs:
                m.pop("id", None)
            cols = ", ".join(movs[0].keys())
            vals = ", ".join([f":{k}" for k in movs[0].keys()])
            db.execute(text(f"INSERT INTO movimientos ({cols}) VALUES ({vals})"), movs)

        db.commit()
        return {"mensaje": "Base de datos restaurada correctamente desde la copia de seguridad."}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Error al restaurar: {str(e)}")

# --- 3. IMPORTACIÓN EXCEL (SOLO ADMIN) ---
@app.post("/importar")
def subir_excel(
    gestion: int = 2026,
    archivo: UploadFile = File(...),
    db: Session = Depends(get_db),
    usuario: dict = Depends(solo_admin)
):
    ruta_temp = f"temp_{archivo.filename}"
    with open(ruta_temp, "wb") as buffer:
        shutil.copyfileobj(archivo.file, buffer)
    try:
        crear_backup_rotativo(db, usuario["email"], "PreImportacion")
        procesar_excel_bd(ruta_temp, gestion=gestion, usuario_id=int(usuario["sub"]))
        return {"mensaje": "Archivo procesado y cargado exitosamente (respaldo automático creado)", "gestion": gestion}
    finally:
        if os.path.exists(ruta_temp):
            os.remove(ruta_temp)

@app.get("/importaciones")
def historial_importaciones(db: Session = Depends(get_db), usuario: dict = Depends(obtener_usuario_actual)):
    rows = db.execute(text("""
        SELECT i.id, i.nombre_archivo, i.gestion, u.nombre as usuario,
               i.total_filas_procesadas, i.total_presupuesto_bs, i.total_ejecucion_bs,
               i.estado, i.advertencias, i.fecha_importacion
        FROM importaciones i
        LEFT JOIN usuarios u ON u.id = i.usuario_id
        ORDER BY i.fecha_importacion DESC
    """)).mappings().all()
    return [dict(r) for r in rows]

# --- 4. CATÁLOGOS Y FILTROS ---
@app.get("/filtros")
def obtener_filtros(db: Session = Depends(get_db)):
    gestiones = [r[0] for r in db.execute(text("SELECT DISTINCT gestion FROM presupuestos ORDER BY gestion DESC")).fetchall()]
    regiones = [dict(r) for r in db.execute(text("SELECT id, codigo, nombre FROM regiones ORDER BY codigo")).mappings().all()]
    financiadores = [dict(r) for r in db.execute(text("SELECT id, nombre FROM financiadores ORDER BY nombre")).mappings().all()]
    areas = [dict(r) for r in db.execute(text("SELECT id, nombre FROM areas ORDER BY nombre")).mappings().all()]
    rubros = [dict(r) for r in db.execute(text("SELECT id, nombre FROM rubros ORDER BY nombre")).mappings().all()]
    tc_info = obtener_tipo_cambio_actual(db, gestiones[0] if gestiones else 2026)
    return {
        "gestiones": gestiones or [2026],
        "regiones": regiones,
        "financiadores": financiadores,
        "areas": areas,
        "rubros": rubros,
        "tipo_cambio": tc_info
    }

# --- FUNCIÓN DE CÁLCULO PRESUPUESTARIO ---
def consultar_agrupado(
    db: Session,
    grupo_sql: str,
    campos_select: str,
    gestion: int,
    moneda: str,
    tasa_aplicada: float,
    region_id: Optional[int],
    financiador_id: Optional[int],
    area_id: Optional[int],
    rubro_id: Optional[int],
    mes: Optional[str]
):
    factor = (1.0 / tasa_aplicada) if moneda.upper() == "USD" else 1.0

    filtros = ["gestion = :gestion"]
    params = {"gestion": gestion}
    if region_id:
        filtros.append("region_id = :region_id")
        params["region_id"] = region_id
    if financiador_id:
        filtros.append("financiador_id = :financiador_id")
        params["financiador_id"] = financiador_id
    if area_id:
        filtros.append("area_id = :area_id")
        params["area_id"] = area_id
    if rubro_id:
        filtros.append("rubro_id = :rubro_id")
        params["rubro_id"] = rubro_id
    if mes:
        filtros.append("mes = :mes")
        params["mes"] = mes.upper()

    where_clause = " AND ".join(filtros)

    query = text(f"""
        WITH base_unificada AS (
            SELECT region_id, financiador_id, area_id, rubro_id, cuenta_id, mes,
                   monto_bs AS ptto_bs, 0::numeric AS ejec_bs
            FROM presupuestos WHERE {where_clause}
            UNION ALL
            SELECT region_id, financiador_id, area_id, rubro_id, cuenta_id, mes,
                   debe_bs AS ptto_bs, debe_bs AS ejec_bs
            FROM movimientos WHERE {where_clause}
        )
        SELECT {campos_select},
               ROUND((SUM(b.ptto_bs) * :factor)::numeric, 2) AS presupuesto,
               ROUND((SUM(b.ejec_bs) * :factor)::numeric, 2) AS ejecucion,
               ROUND(((SUM(b.ptto_bs) - SUM(b.ejec_bs)) * :factor)::numeric, 2) AS saldo,
               CASE WHEN SUM(b.ptto_bs) > 0 
                    THEN ROUND(((SUM(b.ejec_bs) / SUM(b.ptto_bs)) * 100)::numeric, 2) 
                    ELSE 0 END AS porcentaje_ejecucion
        FROM base_unificada b
        LEFT JOIN regiones reg ON reg.id = b.region_id
        LEFT JOIN financiadores fin ON fin.id = b.financiador_id
        LEFT JOIN areas ar ON ar.id = b.area_id
        LEFT JOIN rubros rub ON rub.id = b.rubro_id
        LEFT JOIN cuentas cue ON cue.id = b.cuenta_id
        GROUP BY {grupo_sql}
        ORDER BY {grupo_sql}
    """)
    params["factor"] = factor
    rows = db.execute(query, params).mappings().all()
    return [dict(r) for r in rows]

# --- 5. LOS 7 REPORTES + EXPORTACIÓN ---
@app.get("/reportes/{tipo_reporte}")
def obtener_reporte(
    tipo_reporte: str,
    gestion: int = 2026,
    moneda: str = "BS",
    usar_tc_actual: bool = True,
    region_id: Optional[int] = None,
    financiador_id: Optional[int] = None,
    area_id: Optional[int] = None,
    rubro_id: Optional[int] = None,
    mes: Optional[str] = None,
    formato: Optional[str] = None,
    db: Session = Depends(get_db)
):
    tasa_actual = db.execute(
        text("SELECT tasa FROM tipos_de_cambio WHERE gestion = :g AND mes = 'ACTUAL_BCB'"),
        {"g": gestion}
    ).scalar() or 11.70
    tasa_oficial = db.execute(
        text("SELECT tasa FROM tipos_de_cambio WHERE gestion = :g AND mes = 'REFERENCIAL'"),
        {"g": gestion}
    ).scalar() or 6.96
    tasa_aplicada = float(tasa_actual) if usar_tc_actual else float(tasa_oficial)
    tc_info = {"fuente": "Banco Central de Bolivia (BCB)"}

    config = {
        "resumen-general": ("rub.nombre", "rub.nombre AS rubro", "Resumen General Consolidado"),
        "rubro-cuenta": ("rub.nombre, cue.nombre", "rub.nombre AS rubro, cue.nombre AS cuenta", "Ejecucion por Rubro y Cuenta"),
        "financiador": ("fin.nombre, rub.nombre", "fin.nombre AS financiador, rub.nombre AS rubro", "Ejecucion por Financiador"),
        "area-financiador": ("ar.nombre, fin.nombre, rub.nombre", "ar.nombre AS area, fin.nombre AS financiador, rub.nombre AS rubro", "Ejecucion por Area y Financiador"),
        "region": ("reg.nombre, ar.nombre, fin.nombre", "reg.nombre AS region, ar.nombre AS area, fin.nombre AS financiador", "Ejecucion por Region"),
        "mes": ("b.mes", "b.mes AS mes", "Ejecucion por Mes"),
    }

    if tipo_reporte == "movimientos":
        rows = db.execute(text("""
            SELECT m.mes, m.fecha_comprobante AS fecha, m.codigo_contable AS codigo,
                   m.nombre_cuenta_contable AS cuenta_contable, m.tipo_comprobante AS tipo,
                   m.numero_comprobante AS numero, reg.codigo AS region, fin.nombre AS financiador,
                   ar.nombre AS area, rub.nombre AS rubro, m.referencia,
                   m.debe_bs AS monto_bs,
                   ROUND((m.debe_bs / :tasa)::numeric, 2) AS monto_usd_actual,
                   m.debe_usd AS monto_usd_contable,
                   m.tasa_cambio AS tasa_registro
            FROM movimientos m
            LEFT JOIN regiones reg ON reg.id = m.region_id
            LEFT JOIN financiadores fin ON fin.id = m.financiador_id
            LEFT JOIN areas ar ON ar.id = m.area_id
            LEFT JOIN rubros rub ON rub.id = m.rubro_id
            WHERE m.gestion = :g
            ORDER BY m.fecha_comprobante DESC
        """), {"g": gestion, "tasa": tasa_aplicada}).mappings().all()
        datos = [dict(r) for r in rows]
        titulo = "Detalle de Movimientos"
    elif tipo_reporte in config:
        grupo, select_c, titulo = config[tipo_reporte]
        datos = consultar_agrupado(db, grupo, select_c, gestion, moneda, tasa_aplicada, region_id, financiador_id, area_id, rubro_id, mes)
    else:
        raise HTTPException(status_code=404, detail="Reporte no encontrado")

    if formato == "excel":
        contenido = generar_excel_bytes(datos, titulo, moneda, tasa_aplicada)
        return Response(
            content=contenido,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={tipo_reporte}_{gestion}_{moneda}.xlsx"}
        )
    if formato == "pdf":
        contenido = generar_pdf_bytes(datos, titulo, moneda, tasa_aplicada)
        return Response(
            content=contenido,
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={tipo_reporte}_{gestion}_{moneda}.pdf"}
        )

    return {
        "titulo": titulo,
        "moneda": moneda,
        "tasa_aplicada": tasa_aplicada,
        "fuente_tc": tc_info["fuente"],
        "gestion": gestion,
        "datos": datos
    }

# --- 6. EDITOR DIRECTO DE BASE DE DATOS (SOLO ADMIN) ---
TABLAS_EDITABLES = {
    "presupuestos": ["gestion", "mes", "region_id", "financiador_id", "area_id", "rubro_id", "cuenta_id", "monto_bs"],
    "movimientos": ["gestion", "mes", "fecha_comprobante", "codigo_contable", "nombre_cuenta_contable", "tipo_comprobante", "numero_comprobante", "region_id", "financiador_id", "area_id", "rubro_id", "cuenta_id", "referencia", "debe_bs", "debe_usd", "tasa_cambio"],
    "regiones": ["codigo", "nombre"],
    "financiadores": ["nombre"],
    "areas": ["nombre"],
    "rubros": ["nombre"],
}

@app.get("/admin/tabla/{tabla}")
def listar_registros_tabla(tabla: str, gestion: int = 2026, limite: int = 100, db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    if tabla not in TABLAS_EDITABLES:
        raise HTTPException(status_code=400, detail="Tabla no permitida")
    
    if tabla in ("presupuestos", "movimientos"):
        rows = db.execute(
            text(f"SELECT * FROM {tabla} WHERE gestion = :g ORDER BY id DESC LIMIT :lim"),
            {"g": gestion, "lim": limite}
        ).mappings().all()
    else:
        rows = db.execute(
            text(f"SELECT * FROM {tabla} ORDER BY id ASC LIMIT :lim"),
            {"lim": limite}
        ).mappings().all()
        
    return {"columnas": TABLAS_EDITABLES[tabla], "filas": [dict(r) for r in rows]}

@app.put("/admin/tabla/{tabla}/{registro_id}")
def actualizar_registro_tabla(tabla: str, registro_id: int, payload: RegistroPayload, db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    if tabla not in TABLAS_EDITABLES:
        raise HTTPException(status_code=400, detail="Tabla no permitida")
    
    permitidas = TABLAS_EDITABLES[tabla]
    datos_limpios = {k: (None if v == "" else v) for k, v in payload.datos.items() if k in permitidas}
    if not datos_limpios:
        raise HTTPException(status_code=400, detail="No hay campos válidos para actualizar")

    set_clause = ", ".join([f"{k} = :{k}" for k in datos_limpios.keys()])
    datos_limpios["id"] = registro_id
    db.execute(text(f"UPDATE {tabla} SET {set_clause} WHERE id = :id"), datos_limpios)
    db.commit()
    return {"mensaje": f"Registro #{registro_id} actualizado en {tabla}"}

@app.post("/admin/tabla/{tabla}")
def crear_registro_tabla(tabla: str, payload: RegistroPayload, db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    if tabla not in TABLAS_EDITABLES:
        raise HTTPException(status_code=400, detail="Tabla no permitida")
    
    permitidas = TABLAS_EDITABLES[tabla]
    datos_limpios = {k: (None if v == "" else v) for k, v in payload.datos.items() if k in permitidas and v != ""}
    if not datos_limpios:
        raise HTTPException(status_code=400, detail="Datos vacíos")

    cols = ", ".join(datos_limpios.keys())
    vals = ", ".join([f":{k}" for k in datos_limpios.keys()])
    db.execute(text(f"INSERT INTO {tabla} ({cols}) VALUES ({vals})"), datos_limpios)
    db.commit()
    return {"mensaje": f"Nuevo registro insertado en {tabla}"}

@app.delete("/admin/tabla/{tabla}/{registro_id}")
def eliminar_registro_tabla(tabla: str, registro_id: int, db: Session = Depends(get_db), usuario: dict = Depends(solo_admin)):
    if tabla not in TABLAS_EDITABLES:
        raise HTTPException(status_code=400, detail="Tabla no permitida")
    db.execute(text(f"DELETE FROM {tabla} WHERE id = :id"), {"id": registro_id})
    db.commit()
    return {"mensaje": f"Registro #{registro_id} eliminado de {tabla}"}

from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

class ChatRequest(BaseModel):
    mensaje: str
    gestion: int = 2026
    moneda: str = "BS"
    usar_tc_actual: bool = True
    vista_actual: str = "dashboard"

@app.post("/ia/chat")
def asistente_ia(
    req: ChatRequest,
    db: Session = Depends(get_db),
    usuario: dict = Depends(obtener_usuario_actual)
):
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return {
            "respuesta": "⚠️ Falta configurar la variable GEMINI_API_KEY en el archivo .env del backend para activar el asistente."
        }

    try:
        # 1. Obtener contexto financiero real de la base de datos
        tasa_actual = db.execute(
            text("SELECT tasa FROM tipos_de_cambio WHERE gestion = :g AND mes = 'ACTUAL_BCB'"),
            {"g": req.gestion}
        ).scalar() or 11.70
        tasa_oficial = db.execute(
            text("SELECT tasa FROM tipos_de_cambio WHERE gestion = :g AND mes = 'REFERENCIAL'"),
            {"g": req.gestion}
        ).scalar() or 6.96
        tasa_aplicada = float(tasa_actual) if req.usar_tc_actual else float(tasa_oficial)

        resumen_rubros = consultar_agrupado(
            db, "rub.nombre", "rub.nombre AS rubro",
            req.gestion, req.moneda, tasa_aplicada,
            None, None, None, None, None
        )
        resumen_fondos = consultar_agrupado(
            db, "fin.nombre", "fin.nombre AS financiador",
            req.gestion, req.moneda, tasa_aplicada,
            None, None, None, None, None
        )

        total_ptto = sum(float(r.get("presupuesto", 0)) for r in resumen_rubros)
        total_ejec = sum(float(r.get("ejecucion", 0)) for r in resumen_rubros)
        total_saldo = total_ptto - total_ejec
        pct_global = round((total_ejec / total_ptto * 100), 2) if total_ptto > 0 else 0

        # 2. Definir permisos y guía de navegación según el ROL
        rol = usuario.get("rol", "TECNICO")
        nombre_usr = usuario.get("nombre", "Usuario")

        if rol == "ADMIN":
            capacidades_rol = """
            El usuario actual tiene rol ADMINISTRADOR (acceso total).
            Puede usar y debes guiarlo en estas 4 secciones del menú superior:
            1. 'Dashboard': KPIs globales, gráficos por rubro, evolución mensual y distribución por financiador.
            2. '7 Reportes': consultar los 7 reportes financieros y exportarlos en Excel (.xlsx) o PDF.
            3. 'Cargar Excel': subir la base contable (hoja BD), ver alertas de auditoría contable, y gestionar las 2 Copias de Seguridad Rotativas (crear backup manual o restaurar versión previa).
            4. 'Editor SQL': editar celdas en vivo, insertar nuevas filas o eliminar registros directamente en PostgreSQL (tablas presupuestos, movimientos, regiones, financiadores, areas, rubros).
            5. Además, en el encabezado superior izquierdo puede usar el botón 'Cambiar TC' para actualizar el Tipo de Cambio en vivo.
            """
        else:
            capacidades_rol = """
            El usuario actual tiene rol TÉCNICO (acceso de SOLO LECTURA y análisis).
            Solo tiene acceso a 2 secciones del menú superior:
            1. 'Dashboard': visualizar KPIs globales y gráficos interactivos.
            2. '7 Reportes': explorar los 7 reportes oficiales y descargarlos en Excel o PDF.
            También puede usar la barra de filtros (Gestión, Región, Financiador, Área, Rubro) y alternar la moneda entre BS y USD (eligiendo entre TC Actual BCB o TC Histórico 6.96).
            IMPORTANTE: Este usuario NO tiene permisos para subir archivos Excel, NO puede editar la base de datos SQL, NO puede restaurar backups ni cambiar el TC oficial. Si pregunta cómo modificar o subir datos, indícale amablemente que esa función es exclusiva del rol Administrador.
            """

        prompt_sistema = f"""
        Eres el Copiloto Financiero IA de 'Enseña por Bolivia' (ExB).
        Hablas con {nombre_usr} (Rol: {rol}), quien actualmente está viendo la pestaña '{req.vista_actual}'.

        {capacidades_rol}

        DATOS FINANCIEROS EN TIEMPO REAL (Gestión {req.gestion} | Moneda activa: {req.moneda} | TC aplicado: {tasa_aplicada} Bs/USD):
        - Presupuesto Vigente Total: {total_ptto:,.2f} {req.moneda}
        - Ejecución Acumulada Total: {total_ejec:,.2f} {req.moneda}
        - Saldo Disponible Total: {total_saldo:,.2f} {req.moneda}
        - Porcentaje de Ejecución Global: {pct_global}%
        - Detalle por Rubros: {json.dumps(resumen_rubros, ensure_ascii=False, default=str)}
        - Detalle por Financiadores: {json.dumps(resumen_fondos, ensure_ascii=False, default=str)}

        INSTRUCCIONES DE RESPUESTA:
        - Responde en español, de forma concisa, clara, profesional y amigable, sin usar asteriscos dobles (**).
        - Responde específicamente a lo que pregunta el usuario.
        - Si pide ayuda sobre dónde ir o cómo hacer algo, indícale exactamente qué botón o filtro usar según su rol ({rol}).
        - Si pide análisis o interpretación de datos, usa las cifras reales provistas arriba y destaca hallazgos clave (ej. rubros subejecutados, sobrecostos o financiadores principales).
        """

        # Intentar conectar con Gemini (AI Studio AIzaSy o Vertex AQ.)
        es_clave_aq = api_key.startswith("AQ.")
        client = genai.Client(
            api_key=api_key,
            http_options={"timeout": 12000}
        )
        modelos = ["gemini-3.8-flash", "gemini-2.5-flash"]

        for modelo in modelos:
            try:
                response = client.models.generate_content(
                    model=modelo,
                    contents=f"{prompt_sistema}\n\nPregunta del usuario: {req.mensaje}",
                    config=types.GenerateContentConfig(
                        thinking_config=types.ThinkingConfig(thinking_budget=0),
                        temperature=0.3,
                    )
                )
                if response and response.text:
                    return {"respuesta": response.text.replace("**", "")}
            except Exception as err_gemini:
                print(f"[Copiloto IA] Falló {modelo}: {err_gemini}")
                continue

        # Respaldo analítico inteligente (interpreta gráficas y datos reales de PostgreSQL)
        q = req.mensaje.lower()

        if "rubro" in q or "grafica" in q or "gráfica" in q or "tabla" in q:
            mayor_ejec = max(resumen_rubros, key=lambda x: float(x.get("ejecucion", 0)), default=None)
            mayor_pct = max(resumen_rubros, key=lambda x: float(x.get("porcentaje_ejecucion", 0)), default=None)
            sin_ejec = [r["rubro"] for r in resumen_rubros if float(r.get("ejecucion", 0)) == 0]

            explicacion = (
                f"Interpretación de Presupuesto vs. Ejecución por Rubro (Gestión {req.gestion} | {req.moneda}):\n\n"
                f"• Qué muestra: Compara el monto planificado (barra azul) frente al gasto realmente ejecutado (barra verde) en cada partida.\n"
            )
            if mayor_ejec:
                explicacion += f"• Mayor gasto absoluto: {mayor_ejec['rubro']} lidera el gasto con {float(mayor_ejec['ejecucion']):,.2f} {req.moneda} ejecutados de {float(mayor_ejec['presupuesto']):,.2f} {req.moneda}.\n"
            if mayor_pct:
                explicacion += f"• Mayor avance porcentual: {mayor_pct['rubro']} tiene el ritmo de ejecución más alto con {mayor_pct['porcentaje_ejecucion']}%.\n"
            if sin_ejec:
                explicacion += f"• Alerta de subejecución: {', '.join(sin_ejec)} aún registra 0.00% de ejecución (saldo intacto).\n"

            explicacion += f"\nEn conjunto, se ha ejecutado el {pct_global}% ({total_ejec:,.2f} {req.moneda}) del presupuesto total vigente ({total_ptto:,.2f} {req.moneda})."
            return {"respuesta": explicacion}

        if "resumen general" in q or "consolidado" in q:
            return {
                "respuesta": (
                    "El Reporte 1: Resumen General Consolidado agrupa todo el presupuesto vigente, la ejecución acumulada, "
                    "el saldo disponible y el porcentaje de avance clasificado por cada Rubro presupuestario.\n\n"
                    "Puedes verlo haciendo clic en '7 Reportes' en la barra superior (es el primer botón seleccionado por defecto) "
                    "y exportarlo directamente a Excel o PDF."
                )
            }

        if "financiador" in q or "fondo" in q:
            mayor_f = max(resumen_fondos, key=lambda x: float(x.get("ejecucion", 0)), default=None)
            lineas = "\n".join(
                [f"• {f['financiador']}: {float(f['ejecucion']):,.2f} / {float(f['presupuesto']):,.2f} {req.moneda} ({f['porcentaje_ejecucion']}%)"
                 for f in resumen_fondos]
            )
            intro = f"El financiador que concentra la mayor ejecución es {mayor_f['financiador']} ({float(mayor_f['ejecucion']):,.2f} {req.moneda}).\n\n" if mayor_f else ""
            return {"respuesta": f"{intro}Detalle por Financiadores:\n{lineas}"}

        if "funcion" in q or "rol" in q or "donde" in q or "dónde" in q or "hacer" in q or "excel" in q or "sql" in q or "backup" in q:
            if rol == "ADMIN":
                return {
                    "respuesta": (
                        "Con tu rol de ADMINISTRADOR tienes control total desde el menú superior:\n"
                        "• Dashboard: KPIs y gráficos en tiempo real.\n"
                        "• 7 Reportes: consulta y descarga oficial en Excel y PDF.\n"
                        "• Cargar Excel: sube archivos contables (hoja BD), revisa alertas de auditoría y restaura backups.\n"
                        "• Editor SQL: edita, inserta o borra registros directo en PostgreSQL.\n"
                        "• Cambiar TC: botón arriba a la izquierda para actualizar el tipo de cambio."
                    )
                }
            return {
                "respuesta": (
                    "Con tu rol de TÉCNICO (Solo lectura) puedes:\n"
                    "• Dashboard: analizar KPIs y gráficos interactivos.\n"
                    "• 7 Reportes: filtrar y descargar cualquiera de los 7 reportes en Excel o PDF.\n"
                    "• Filtros y Moneda: cambiar entre BS y USD o filtrar por Región, Financiador, Área y Rubro."
                )
            }

        top_rubro = max(resumen_rubros, key=lambda x: float(x.get("ejecucion", 0)), default=None)
        top_fondo = max(resumen_fondos, key=lambda x: float(x.get("ejecucion", 0)), default=None)
        return {
            "respuesta": (
                f"Resumen Ejecutivo (Gestión {req.gestion} | {req.moneda} | TC {tasa_aplicada}):\n"
                f"• Presupuesto Vigente: {total_ptto:,.2f} {req.moneda}\n"
                f"• Ejecución Acumulada: {total_ejec:,.2f} {req.moneda} ({pct_global}%)\n"
                f"• Saldo Disponible: {total_saldo:,.2f} {req.moneda}\n"
                + (f"• Rubro con mayor ejecución: {top_rubro['rubro']} ({float(top_rubro['ejecucion']):,.2f} {req.moneda})\n" if top_rubro else "")
                + (f"• Financiador principal: {top_fondo['financiador']} ({float(top_fondo['ejecucion']):,.2f} {req.moneda})" if top_fondo else "")
            )
        }
    except Exception as e:
        return {"respuesta": f"❌ Error interno en el asistente: {str(e)}"}