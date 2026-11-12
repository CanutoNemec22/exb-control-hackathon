import io
import pandas as pd
from fpdf import FPDF

def generar_excel_bytes(datos: list[dict], titulo: str, moneda: str = "BS", tasa: float = 1.0) -> bytes:
    df = pd.DataFrame(datos)
    output = io.BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name="Reporte", startrow=3)
        ws = writer.sheets["Reporte"]
        ws["A1"] = "ENSEÑA POR BOLIVIA (ExB) - CONTROL PRESUPUESTARIO"
        subtitulo = f"{titulo} - Moneda: {moneda}"
        if moneda.upper() == "USD":
            subtitulo += f" (Tipo de cambio aplicado: {tasa} Bs/USD)"
        ws["A2"] = subtitulo
    return output.getvalue()

def generar_pdf_bytes(datos: list[dict], titulo: str, moneda: str = "BS", tasa: float = 1.0) -> bytes:
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.add_page()
    pdf.set_font("Helvetica", "B", 14)
    pdf.cell(0, 8, "ENSENA POR BOLIVIA (ExB)", ln=True)
    pdf.set_font("Helvetica", "", 10)
    subtitulo = f"{titulo} | Moneda: {moneda}"
    if moneda.upper() == "USD":
        subtitulo += f" (TC aplicado: {tasa} Bs/USD)"
    pdf.cell(0, 7, subtitulo, ln=True)
    pdf.ln(3)

    if not datos:
        pdf.cell(0, 10, "Sin registros para los filtros seleccionados.", ln=True)
        return bytes(pdf.output())

    columnas = list(datos[0].keys())
    ancho_col = 275 / len(columnas)

    pdf.set_font("Helvetica", "B", 8)
    pdf.set_fill_color(30, 58, 138)
    pdf.set_text_color(255, 255, 255)
    for col in columnas:
        pdf.cell(ancho_col, 8, str(col)[:22], border=1, fill=True, align="C")
    pdf.ln()

    pdf.set_font("Helvetica", "", 8)
    pdf.set_text_color(0, 0, 0)
    for fila in datos[:250]:
        for col in columnas:
            val = fila[col]
            txt = f"{val:,.2f}" if isinstance(val, float) else str(val or "")
            pdf.cell(ancho_col, 7, txt[:24], border=1, align="R" if isinstance(val, (int, float)) else "L")
        pdf.ln()

    return bytes(pdf.output())