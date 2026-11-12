import re
import httpx
from datetime import date
from sqlalchemy import text
from sqlalchemy.orm import Session

def obtener_tipo_cambio_actual(db: Session, gestion: int = 2026) -> dict:
    tasa_bcb = None
    fuente = "Base de datos (Último registro BCB)"

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    # 1. Consultar automáticamente el portal oficial del Banco Central de Bolivia (BCB)
    try:
        resp = httpx.get("https://www.bcb.gob.bo/", headers=headers, timeout=8.0, verify=False, follow_redirects=True)
        if resp.status_code == 200:
            # Limpiar etiquetas HTML para leer el texto plano tal como aparece en la pantalla del BCB
            texto_limpio = re.sub(r"<[^>]+>", " ", resp.text)
            texto_limpio = re.sub(r"\s+", " ", texto_limpio)

            # Buscar primero en el bloque de "Valor referencial del dólar" o "TIPO DE CAMBIO"
            match = re.search(
                r"(?:Valor referencial del d[oó]lar|Bolivianos por d[oó]lar).*?(\d{1,2}[,\.]\d{2})",
                texto_limpio,
                re.IGNORECASE
            )
            if match:
                valor_str = match.group(1).replace(",", ".")
                tasa_bcb = round(float(valor_str), 2)
                fuente = "Banco Central de Bolivia (BCB - Automático)"
    except Exception:
        pass

    # 2. Si logró leer el valor en vivo del BCB, actualizar automáticamente Neon
    if tasa_bcb and tasa_bcb > 0:
        db.execute(
            text("""
                INSERT INTO tipos_de_cambio (gestion, mes, tasa, fecha_vigencia)
                VALUES (:g, 'ACTUAL_BCB', :t, :f)
                ON CONFLICT (gestion, mes) 
                DO UPDATE SET tasa = EXCLUDED.tasa, fecha_vigencia = EXCLUDED.fecha_vigencia
            """),
            {"g": gestion, "t": tasa_bcb, "f": date.today()}
        )
        db.commit()
    else:
        # 3. Solo si la web del BCB estuviera caída, usar el último guardado automáticamente
        tasa_bd = db.execute(
            text("SELECT tasa FROM tipos_de_cambio WHERE gestion = :g AND mes = 'ACTUAL_BCB'"),
            {"g": gestion}
        ).scalar()
        tasa_bcb = float(tasa_bd) if tasa_bd else 11.70

    tasa_historica = db.execute(
        text("SELECT tasa FROM tipos_de_cambio WHERE gestion = :g AND mes = 'REFERENCIAL'"),
        {"g": gestion}
    ).scalar() or 6.96

    return {
        "tasa_actual": float(tasa_bcb),
        "tasa_oficial": float(tasa_historica),
        "fuente": fuente,
        "fecha": str(date.today())
    }