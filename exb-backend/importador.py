import pandas as pd
from sqlalchemy import text
from database import SessionLocal

def limpiar_texto(valor):
    if pd.isna(valor):
        return ""
    return str(valor).strip()

def procesar_excel_bd(ruta_archivo: str, gestion: int = 2026, usuario_id: int = 1):
    db = SessionLocal()
    advertencias = []
    
    try:
        # 1. Leer hoja BD detectando encabezados en la fila 2 (header=1)
        df = pd.read_excel(ruta_archivo, sheet_name="BD", header=1)
        df = df.dropna(subset=["mes", "rubro", "area", "fondo"])

        # 2. Control de duplicados: limpiar registros previos de la misma gestión
        db.execute(text("DELETE FROM movimientos WHERE gestion = :g"), {"g": gestion})
        db.execute(text("DELETE FROM presupuestos WHERE gestion = :g"), {"g": gestion})
        db.execute(text("DELETE FROM importaciones WHERE gestion = :g"), {"g": gestion})
        db.commit()

        # 3. Registrar nueva importación en auditoría
        nombre_limpio = ruta_archivo.split("/")[-1].split("\\")[-1].replace("temp_", "")
        res_imp = db.execute(
            text("""
                INSERT INTO importaciones (nombre_archivo, gestion, usuario_id, estado)
                VALUES (:nombre, :gestion, :uid, 'PROCESANDO')
                RETURNING id
            """),
            {"nombre": nombre_limpio, "gestion": gestion, "uid": usuario_id}
        )
        importacion_id = res_imp.scalar()

        # Funciones auxiliares para obtener o crear catálogos sin duplicar
        cache_regiones = {r[1]: r[0] for r in db.execute(text("SELECT id, codigo FROM regiones")).fetchall()}
        cache_fondos = {r[1]: r[0] for r in db.execute(text("SELECT id, nombre FROM financiadores")).fetchall()}
        cache_areas = {r[1]: r[0] for r in db.execute(text("SELECT id, nombre FROM areas")).fetchall()}
        cache_rubros = {r[1]: r[0] for r in db.execute(text("SELECT id, nombre FROM rubros")).fetchall()}
        cache_cuentas = {(r[1], r[2]): r[0] for r in db.execute(text("SELECT id, rubro_id, nombre FROM cuentas")).fetchall()}

        def get_or_create_region(cod):
            cod = limpiar_texto(cod) or "S/R"
            if cod not in cache_regiones:
                rid = db.execute(text("INSERT INTO regiones (codigo, nombre) VALUES (:c, :n) RETURNING id"), {"c": cod, "n": cod}).scalar()
                cache_regiones[cod] = rid
            return cache_regiones[cod]

        def get_or_create_fondo(nombre):
            nombre = limpiar_texto(nombre)
            if nombre not in cache_fondos:
                fid = db.execute(text("INSERT INTO financiadores (nombre) VALUES (:n) RETURNING id"), {"n": nombre}).scalar()
                cache_fondos[nombre] = fid
            return cache_fondos[nombre]

        def get_or_create_area(nombre):
            nombre = limpiar_texto(nombre)
            if nombre not in cache_areas:
                aid = db.execute(text("INSERT INTO areas (nombre) VALUES (:n) RETURNING id"), {"n": nombre}).scalar()
                cache_areas[nombre] = aid
            return cache_areas[nombre]

        def get_or_create_rubro(nombre):
            nombre = limpiar_texto(nombre)
            if nombre not in cache_rubros:
                cod = nombre.split(".")[0] if "." in nombre else ""
                rub_id = db.execute(text("INSERT INTO rubros (codigo, nombre) VALUES (:c, :n) RETURNING id"), {"c": cod, "n": nombre}).scalar()
                cache_rubros[nombre] = rub_id
            return cache_rubros[nombre]

        def get_or_create_cuenta(rubro_id, nombre_rubro, nombre_cuenta):
            nombre_cuenta = limpiar_texto(nombre_cuenta) or nombre_rubro
            pref_rubro = nombre_rubro.split(".")[0].strip()
            pref_cuenta = nombre_cuenta.split(".")[0].strip()
            if pref_rubro.isdigit() and pref_cuenta.isdigit() and pref_rubro != pref_cuenta:
                advertencias.append(f"Desalineación: Rubro '{nombre_rubro}' tiene asignada cuenta '{nombre_cuenta}'")
            
            key = (rubro_id, nombre_cuenta)
            if key not in cache_cuentas:
                cid = db.execute(
                    text("INSERT INTO cuentas (rubro_id, nombre) VALUES (:rid, :n) RETURNING id"),
                    {"rid": rubro_id, "n": nombre_cuenta}
                ).scalar()
                cache_cuentas[key] = cid
            return cache_cuentas[key]

        presupuestos_batch = []
        movimientos_batch = []
        total_ptto_bs = 0.0
        total_ejec_bs = 0.0

        # 4. Recorrer filas y clasificar Presupuesto vs Movimiento
        for _, row in df.iterrows():
            mes = limpiar_texto(row["mes"]).upper()
            ref = limpiar_texto(row["ref"])
            
            region_id = get_or_create_region(row["region"])
            fondo_id = get_or_create_fondo(row["fondo"])
            area_id = get_or_create_area(row["area"])
            rubro_txt = limpiar_texto(row["rubro"])
            rubro_id = get_or_create_rubro(rubro_txt)
            cuenta_id = get_or_create_cuenta(rubro_id, rubro_txt, row["Cuenta"])

            if ref.upper() == "PRESUPUESTO":
                monto = float(row["presupuesto Bs"]) if pd.notna(row["presupuesto Bs"]) else 0.0
                total_ptto_bs += monto
                presupuestos_batch.append({
                    "gestion": gestion, "mes": mes, "region_id": region_id,
                    "financiador_id": fondo_id, "area_id": area_id,
                    "rubro_id": rubro_id, "cuenta_id": cuenta_id,
                    "monto_bs": monto, "importacion_id": importacion_id
                })
            else:
                ejec_bs = float(row["Ejecución"]) if pd.notna(row["Ejecución"]) else 0.0
                haber_bs = float(row["haber"]) if pd.notna(row["haber"]) else 0.0
                debe_usd = float(row["dsus"]) if pd.notna(row["dsus"]) else 0.0
                haber_usd = float(row["hsus"]) if pd.notna(row["hsus"]) else 0.0
                tasa = float(row["tasa"]) if pd.notna(row["tasa"]) else 6.96
                
                fecha_comp = pd.to_datetime(row["cfecha"], dayfirst=True, errors="coerce")
                fecha_val = fecha_comp.date() if pd.notna(fecha_comp) else None

                total_ejec_bs += ejec_bs
                movimientos_batch.append({
                    "gestion": gestion, "mes": mes, "fecha_comprobante": fecha_val,
                    "codigo_contable": str(int(row["codigo"])) if pd.notna(row["codigo"]) else None,
                    "nombre_cuenta_contable": limpiar_texto(row["nombre"]),
                    "tipo_comprobante": int(row["tipo"]) if pd.notna(row["tipo"]) else None,
                    "numero_comprobante": int(row["numero"]) if pd.notna(row["numero"]) else None,
                    "no_cheque": limpiar_texto(row["no_cheque"]),
                    "referencia": ref, "region_id": region_id,
                    "financiador_id": fondo_id, "area_id": area_id,
                    "rubro_id": rubro_id, "cuenta_id": cuenta_id,
                    "debe_bs": ejec_bs, "haber_bs": haber_bs,
                    "debe_usd": debe_usd, "haber_usd": haber_usd,
                    "tasa_cambio": tasa, "importacion_id": importacion_id
                })

        # 5. Inserción masiva rápida en PostgreSQL
        if presupuestos_batch:
            db.execute(
                text("""
                    INSERT INTO presupuestos (gestion, mes, region_id, financiador_id, area_id, rubro_id, cuenta_id, monto_bs, importacion_id)
                    VALUES (:gestion, :mes, :region_id, :financiador_id, :area_id, :rubro_id, :cuenta_id, :monto_bs, :importacion_id)
                """),
                presupuestos_batch
            )

        if movimientos_batch:
            db.execute(
                text("""
                    INSERT INTO movimientos (
                        gestion, mes, fecha_comprobante, codigo_contable, nombre_cuenta_contable,
                        tipo_comprobante, numero_comprobante, no_cheque, referencia,
                        region_id, financiador_id, area_id, rubro_id, cuenta_id,
                        debe_bs, haber_bs, debe_usd, haber_usd, tasa_cambio, importacion_id
                    ) VALUES (
                        :gestion, :mes, :fecha_comprobante, :codigo_contable, :nombre_cuenta_contable,
                        :tipo_comprobante, :numero_comprobante, :no_cheque, :referencia,
                        :region_id, :financiador_id, :area_id, :rubro_id, :cuenta_id,
                        :debe_bs, :haber_bs, :debe_usd, :haber_usd, :tasa_cambio, :importacion_id
                    )
                """),
                movimientos_batch
            )

        # 6. Actualizar resumen de la importación
        adv_unicas = list(set(advertencias))
        db.execute(
            text("""
                UPDATE importaciones 
                SET total_filas_procesadas = :filas,
                    total_presupuesto_bs = :ptto,
                    total_ejecucion_bs = :ejec,
                    estado = 'COMPLETADO',
                    advertencias = :adv
                WHERE id = :id
            """),
            {
                "filas": len(presupuestos_batch) + len(movimientos_batch),
                "ptto": round(total_ptto_bs, 2),
                "ejec": round(total_ejec_bs, 2),
                "adv": "\n".join(adv_unicas) if adv_unicas else None,
                "id": importacion_id
            }
        )
        db.commit()

        print("¡Importación exitosa!")
        print(f"Filas Presupuesto: {len(presupuestos_batch)} | Saldo Presupuestado No Ejecutado: Bs {total_ptto_bs:,.2f}")
        print(f"Filas Movimientos: {len(movimientos_batch)} | Ejecución Total: Bs {total_ejec_bs:,.2f}")
        print(f"Presupuesto Total Vigente (Ptto + Ejec): Bs {(total_ptto_bs + total_ejec_bs):,.2f}")
        print(f"Advertencias detectadas: {len(adv_unicas)}")

    except Exception as e:
        db.rollback()
        print("Error durante la importación:", e)
        raise
    finally:
        db.close()

if __name__ == "__main__":
    procesar_excel_bd("Prueba ExB Nov 2026 (1) (1).xlsx", gestion=2026)