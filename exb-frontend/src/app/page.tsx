"use client";

import React, { useState, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell
} from "recharts";
import {
  FileSpreadsheet, FileText, Upload, LogOut, LayoutDashboard, Table, DollarSign,
  ShieldCheck, AlertCircle, Database, Bot, Send, X, Sparkles, Filter, RotateCcw,
  TrendingUp, Wallet, PiggyBank, Percent, CheckCircle2, ArrowRight, ChevronDown,
  ChevronRight, PanelLeftClose, PanelLeftOpen
} from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

const REPORTES_LISTA = [
  { id: "resumen-general", nombre: "1. Resumen General Consolidado" },
  { id: "rubro-cuenta", nombre: "2. Ejecución por Rubro y Cuenta" },
  { id: "financiador", nombre: "3. Ejecución por Financiador" },
  { id: "area-financiador", nombre: "4. Ejecución por Área y Financiador" },
  { id: "region", nombre: "5. Ejecución por Región" },
  { id: "mes", nombre: "6. Ejecución por Mes" },
  { id: "movimientos", nombre: "7. Detalle de Movimientos" },
];

// Paleta de alto contraste inspirada en Enseña por Bolivia
const COLORES_EXB = ["#009B4D", "#1D4ED8", "#114B2F", "#D97706", "#0D9488", "#7C3AED"];

const ESTILO_TIMES: React.CSSProperties = {
  fontFamily: '"Times New Roman", Times, serif',
  colorScheme: "light",
};

export default function AppControlPresupuestario() {
  const [usuario, setUsuario] = useState<{ token: string; rol: string; nombre: string; email: string } | null>(null);
  const [email, setEmail] = useState("admin@ensenaporbolivia.org");
  const [password, setPassword] = useState("admin123");
  const [errorLogin, setErrorLogin] = useState("");

  const [vista, setVista] = useState<"dashboard" | "reportes" | "importar" | "editor_bd">("dashboard");
  const [reporteActivo, setReporteActivo] = useState("resumen-general");
  const [submenuReportesAbierto, setSubmenuReportesAbierto] = useState(false);
  const [sidebarAbierto, setSidebarAbierto] = useState(true);

  const [gestion, setGestion] = useState(2026);
  const [moneda, setMoneda] = useState<"BS" | "USD">("BS");
  const [usarTcActual, setUsarTcActual] = useState(true);
  const [regionId, setRegionId] = useState("");
  const [financiadorId, setFinanciadorId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [rubroId, setRubroId] = useState("");

  const [filtrosData, setFiltrosData] = useState<any>(null);
  const [reporteData, setReporteData] = useState<any>(null);
  const [dashboardRubros, setDashboardRubros] = useState<any[]>([]);
  const [dashboardMeses, setDashboardMeses] = useState<any[]>([]);
  const [dashboardFondos, setDashboardFondos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);

  const [archivoExcel, setArchivoExcel] = useState<File | null>(null);
  const [mensajeImportacion, setMensajeImportacion] = useState("");
  const [historialCargas, setHistorialCargas] = useState<any[]>([]);

  const [backups, setBackups] = useState<any[]>([]);
  const [mensajeBackup, setMensajeBackup] = useState("");

  const [recargaDatos, setRecargaDatos] = useState(0);

  // Estados del Editor SQL en vivo (Solo Admin)
  const [tablaEditor, setTablaEditor] = useState("presupuestos");
  const [columnasEditor, setColumnasEditor] = useState<string[]>([]);
  const [filasEditor, setFilasEditor] = useState<any[]>([]);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [filaEditada, setFilaEditada] = useState<Record<string, any>>({});
  const [nuevaFila, setNuevaFila] = useState<Record<string, any>>({});
  const [mensajeEditor, setMensajeEditor] = useState("");
  const [editandoTc, setEditandoTc] = useState(false);
  const [nuevoTc, setNuevoTc] = useState("11.70");
  const [alertaSeleccionada, setAlertaSeleccionada] = useState<string | null>(null);

  // Estados del Copiloto IA
  const [chatAbierto, setChatAbierto] = useState(false);
  const [inputChat, setInputChat] = useState("");
  const [cargandoChat, setCargandoChat] = useState(false);
  const [mensajesChat, setMensajesChat] = useState<{ rol: "ia" | "user"; texto: string }[]>([]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorLogin("");
    try {
      const res = await fetch(`${API_URL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error("Credenciales incorrectas");
      const data = await res.json();
      setMensajesChat([]);
      setChatAbierto(false);
      setInputChat("");
      setVista("dashboard");
      setSubmenuReportesAbierto(false);
      setSidebarAbierto(true);
      setUsuario({ token: data.access_token, rol: data.rol, nombre: data.nombre, email: data.email });
    } catch (err: any) {
      setErrorLogin(err.message);
    }
  };

  const handleActualizarTc = async () => {
    if (!usuario) return;
    const valor = parseFloat(nuevoTc);
    if (isNaN(valor) || valor <= 0) return;
    const res = await fetch(`${API_URL}/tipo-cambio?tasa=${valor}&gestion=${gestion}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${usuario.token}` },
    });
    if (res.ok) {
      setEditandoTc(false);
      setRecargaDatos((prev) => prev + 1);
    }
  };

  const handleEnviarChat = async (textoManual?: string) => {
    if (!usuario) return;
    const pregunta = (textoManual ?? inputChat).trim();
    if (!pregunta) return;

    setMensajesChat((prev) => [...prev, { rol: "user", texto: pregunta }]);
    if (!textoManual) setInputChat("");
    setCargandoChat(true);

    try {
      const res = await fetch(`${API_URL}/ia/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${usuario.token}`,
        },
        body: JSON.stringify({
          mensaje: pregunta,
          gestion,
          moneda,
          usar_tc_actual: usarTcActual,
          vista_actual: vista,
        }),
      });
      const data = await res.json();
      setMensajesChat((prev) => [...prev, { rol: "ia", texto: data.respuesta || "Sin respuesta." }]);
    } catch {
      setMensajesChat((prev) => [...prev, { rol: "ia", texto: "❌ No se pudo conectar con el Copiloto IA." }]);
    } finally {
      setCargandoChat(false);
    }
  };

  useEffect(() => {
    if (!usuario) return;
    fetch(`${API_URL}/filtros`)
      .then((r) => r.json())
      .then((data) => setFiltrosData(data));
  }, [usuario, recargaDatos]);

  const buildParams = (extraFormato?: string) => {
    const params = new URLSearchParams({
      gestion: String(gestion),
      moneda,
      usar_tc_actual: String(usarTcActual),
    });
    if (regionId) params.append("region_id", regionId);
    if (financiadorId) params.append("financiador_id", financiadorId);
    if (areaId) params.append("area_id", areaId);
    if (rubroId) params.append("rubro_id", rubroId);
    if (extraFormato) params.append("formato", extraFormato);
    return params.toString();
  };

  useEffect(() => {
    if (!usuario) return;
    setCargando(true);
    const qs = buildParams();

    const cargarDatos = async () => {
      try {
        const rub = await fetch(`${API_URL}/reportes/resumen-general?${qs}`).then((r) => r.json());
        const mes = await fetch(`${API_URL}/reportes/mes?${qs}`).then((r) => r.json());
        const fin = await fetch(`${API_URL}/reportes/financiador?${qs}`).then((r) => r.json());

        setDashboardRubros(rub.datos || []);
        setDashboardMeses((mes.datos || []).filter((m: any) => m.mes !== "PTTO"));

        const mapaFondos: Record<string, number> = {};
        (fin.datos || []).forEach((item: any) => {
          mapaFondos[item.financiador] = (mapaFondos[item.financiador] || 0) + Number(item.ejecucion || 0);
        });
        setDashboardFondos(Object.entries(mapaFondos).map(([name, value]) => ({ name, value })));

        if (reporteActivo === "resumen-general") {
          setReporteData(rub);
        } else if (reporteActivo === "mes") {
          setReporteData(mes);
        } else if (reporteActivo === "financiador") {
          setReporteData(fin);
        } else {
          const rep = await fetch(`${API_URL}/reportes/${reporteActivo}?${qs}`).then((r) => r.json());
          setReporteData(rep);
        }
      } catch (err) {
        console.error("Error cargando datos:", err);
      } finally {
        setCargando(false);
      }
    };

    cargarDatos();
  }, [usuario, reporteActivo, gestion, moneda, usarTcActual, regionId, financiadorId, areaId, rubroId, recargaDatos]);

  const cargarHistorial = () => {
    if (!usuario) return;
    fetch(`${API_URL}/importaciones`, {
      headers: { Authorization: `Bearer ${usuario.token}` },
    })
      .then((r) => r.json())
      .then((data) => setHistorialCargas(Array.isArray(data) ? data : []));
  };

  const cargarBackups = () => {
    if (!usuario || usuario.rol !== "ADMIN") return;
    fetch(`${API_URL}/backups`, {
      headers: { Authorization: `Bearer ${usuario.token}` },
    })
      .then((r) => r.json())
      .then((data) => setBackups(Array.isArray(data) ? data : []));
  };

  useEffect(() => {
    if (vista === "importar") {
      cargarHistorial();
      cargarBackups();
    }
  }, [vista]);

  const handleCrearBackup = async () => {
    if (!usuario) return;
    setMensajeBackup("Creando copia de seguridad...");
    const res = await fetch(`${API_URL}/backups/crear`, {
      method: "POST",
      headers: { Authorization: `Bearer ${usuario.token}` },
    });
    const data = await res.json();
    setMensajeBackup(`✅ ${data.mensaje}`);
    cargarBackups();
  };

  const handleRestaurarBackup = async (id: number, nombre: string) => {
    if (!usuario) return;
    if (!confirm(`¿Seguro que deseas restaurar la base de datos a "${nombre}"?`)) return;
    setMensajeBackup("Restaurando datos...");
    const res = await fetch(`${API_URL}/backups/restaurar/${id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${usuario.token}` },
    });
    const data = await res.json();
    setMensajeBackup(`✅ ${data.mensaje}`);
    setRecargaDatos((prev) => prev + 1);
  };

  const handleSubirExcel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archivoExcel || !usuario) return;
    setMensajeImportacion("Procesando archivo en el servidor...");
    const formData = new FormData();
    formData.append("archivo", archivoExcel);

    try {
      const res = await fetch(`${API_URL}/importar?gestion=${gestion}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${usuario.token}` },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Error al subir");
      setMensajeImportacion(`✅ ${data.mensaje}`);
      cargarHistorial();
      cargarBackups();
      setRecargaDatos((prev) => prev + 1);
    } catch (err: any) {
      setMensajeImportacion(`❌ ${err.message}`);
    }
  };

  // Funciones del Editor SQL
  const cargarTablaEditor = () => {
    if (!usuario || usuario.rol !== "ADMIN") return;
    fetch(`${API_URL}/admin/tabla/${tablaEditor}?gestion=${gestion}&limite=100`, {
      headers: { Authorization: `Bearer ${usuario.token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setColumnasEditor(data.columnas || []);
        setFilasEditor(data.filas || []);
        setEditandoId(null);
        setNuevaFila({});
      });
  };

  useEffect(() => {
    if (vista === "editor_bd") {
      cargarTablaEditor();
    }
  }, [vista, tablaEditor, gestion]);

  const handleGuardarEdicion = async (id: number) => {
    if (!usuario) return;
    const res = await fetch(`${API_URL}/admin/tabla/${tablaEditor}/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${usuario.token}`,
      },
      body: JSON.stringify({ datos: filaEditada }),
    });
    const data = await res.json();
    if (res.ok) {
      setMensajeEditor(`✅ ${data.mensaje}`);
      setEditandoId(null);
      cargarTablaEditor();
      setRecargaDatos((prev) => prev + 1);
    } else {
      setMensajeEditor(`❌ ${data.detail || "Error al guardar"}`);
    }
  };

  const handleCrearRegistro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario) return;
    const res = await fetch(`${API_URL}/admin/tabla/${tablaEditor}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${usuario.token}`,
      },
      body: JSON.stringify({ datos: nuevaFila }),
    });
    const data = await res.json();
    if (res.ok) {
      setMensajeEditor(`✅ ${data.mensaje}`);
      setNuevaFila({});
      cargarTablaEditor();
      setRecargaDatos((prev) => prev + 1);
    } else {
      setMensajeEditor(`❌ ${data.detail || "Error al insertar"}`);
    }
  };

  const handleEliminarRegistro = async (id: number) => {
    if (!usuario || !confirm(`¿Eliminar permanentemente el registro #${id} de ${tablaEditor}?`)) return;
    const res = await fetch(`${API_URL}/admin/tabla/${tablaEditor}/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${usuario.token}` },
    });
    const data = await res.json();
    if (res.ok) {
      setMensajeEditor(`🗑️ ${data.mensaje}`);
      cargarTablaEditor();
      setRecargaDatos((prev) => prev + 1);
    }
  };

  const limpiarFiltros = () => {
    setRegionId("");
    setFinanciadorId("");
    setAreaId("");
    setRubroId("");
  };

  // =========================================================================
  // PANTALLA DE INICIO DE SESIÓN INSTITUCIONAL (TIMES NEW ROMAN)
  // =========================================================================
  if (!usuario) {
    return (
      <div style={ESTILO_TIMES} className="min-h-screen bg-[#F3F6F4] flex items-center justify-center p-4 text-slate-900">
        <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full overflow-hidden grid grid-cols-1 md:grid-cols-12 border border-emerald-900/15">
          {/* Panel Izquierdo */}
          <div className="md:col-span-5 bg-gradient-to-br from-[#0D3B24] via-[#114B2F] to-[#007A3D] text-white p-8 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute -bottom-16 -right-16 w-56 h-56 rounded-full border-[18px] border-emerald-400/15 pointer-events-none" />
            <div className="absolute -bottom-8 -right-8 w-36 h-36 rounded-full border-[12px] border-emerald-300/20 pointer-events-none" />

            <div>
              <span className="inline-block bg-white/15 backdrop-blur-sm text-emerald-100 text-xs font-bold px-3 py-1 rounded-full tracking-wide uppercase">
                Plataforma Financiera ExB
              </span>
              <h2 className="text-2xl font-bold mt-5 leading-snug">
                Transparencia y Control Presupuestario en Tiempo Real
              </h2>
              <p className="text-emerald-100/90 text-sm mt-3 leading-relaxed">
                Sistema integral de seguimiento financiero, auditoría contable automatizada y reportes ejecutivos para impulsar la educación en Bolivia.
              </p>
            </div>

            <div className="space-y-2.5 text-sm text-emerald-100/95 pt-8 border-t border-white/15">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>7 Reportes Oficiales en Excel y PDF</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>Conversión Multimoneda (BS / USD)</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
                <span>Copiloto Financiero con IA</span>
              </div>
            </div>
          </div>

          {/* Panel Derecho */}
          <div className="md:col-span-7 p-8 sm:p-10 flex flex-col justify-center bg-white">
            <div className="flex flex-col items-center text-center mb-7">
              <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm mb-3">
                <img
                  src="/logo-exb.png"
                  alt="Enseña por Bolivia"
                  className="h-16 w-auto object-contain"
                />
              </div>
              <p className="text-sm font-bold uppercase tracking-wider text-[#114B2F]">
                Portal de Gestión Financiera
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-bold uppercase tracking-wide text-slate-700 mb-1">
                  Correo Institucional
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-slate-300 bg-white focus:border-[#009B4D] rounded-xl px-3.5 py-2.5 text-base text-slate-900 outline-none transition"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-bold uppercase tracking-wide text-slate-700 mb-1">
                  Contraseña
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full border border-slate-300 bg-white focus:border-[#009B4D] rounded-xl px-3.5 py-2.5 text-base text-slate-900 outline-none transition"
                  required
                />
              </div>
              {errorLogin && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
                  {errorLogin}
                </div>
              )}
              <button
                type="submit"
                className="w-full bg-[#114B2F] hover:bg-[#007A3D] text-white font-bold py-3 rounded-xl shadow-md hover:shadow-lg transition flex items-center justify-center gap-2 text-base"
              >
                Ingresar al Sistema <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            {/* Accesos rápidos para demostración */}
            <div className="mt-6 pt-5 border-t border-slate-200">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2.5 text-center">
                Perfiles de Demostración (1 clic para autocompletar)
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setEmail("admin@ensenaporbolivia.org");
                    setPassword("admin123");
                  }}
                  className="p-2.5 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-left transition"
                >
                  <p className="text-sm font-bold text-[#114B2F]">Administrador</p>
                  <p className="text-xs text-slate-700">Control total, Excel y SQL</p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEmail("tecnico@ensenaporbolivia.org");
                    setPassword("tecnico123");
                  }}
                  className="p-2.5 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-left transition"
                >
                  <p className="text-sm font-bold text-[#0F174A]">Equipo Técnico</p>
                  <p className="text-xs text-slate-700">Dashboard y 7 Reportes</p>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // CÁLCULOS GLOBALES DEL DASHBOARD
  // =========================================================================
  const totalPtto = dashboardRubros.reduce((acc, r) => acc + Number(r.presupuesto || 0), 0);
  const totalEjec = dashboardRubros.reduce((acc, r) => acc + Number(r.ejecucion || 0), 0);
  const totalSaldo = totalPtto - totalEjec;
  const pctTotal = totalPtto > 0 ? ((totalEjec / totalPtto) * 100).toFixed(2) : "0.00";
  const pctNum = Math.min(Number(pctTotal), 100);
  const simbolo = moneda === "USD" ? "$us" : "Bs";
  const hayFiltrosActivos = Boolean(regionId || financiadorId || areaId || rubroId);

  return (
    <div style={ESTILO_TIMES} className="h-screen overflow-hidden bg-[#F4F7F5] text-slate-900 flex">
      {/* =====================================================================
          SIDEBAR LATERAL FIJO Y OCULTABLE A UN COSTADO
         ===================================================================== */}
      <aside
        className={`${
          sidebarAbierto ? "w-72 border-r" : "w-0 border-r-0"
        } bg-white border-slate-300 h-screen flex flex-col justify-between shrink-0 shadow-md z-30 transition-all duration-300 overflow-hidden`}
      >
        {/* Cabecera del Sidebar: Logo + Botón de Ocultar */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
          <div className="flex flex-col items-center flex-1">
            <img
              src="/logo-exb.png"
              alt="Enseña por Bolivia"
              className="h-12 w-auto object-contain"
            />
            <span className="mt-1.5 text-[11px] font-bold uppercase tracking-widest text-[#114B2F] bg-emerald-100 px-3 py-0.5 rounded-full">
              Control Presupuestario
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSidebarAbierto(false)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-[#114B2F] hover:bg-emerald-50 transition self-start"
            title="Ocultar menú lateral"
          >
            <PanelLeftClose className="w-5 h-5" />
          </button>
        </div>

        {/* Menú de Navegación con Scroll Interno Propio (No empuja el botón de Cerrar Sesión) */}
        <nav className="flex-1 overflow-y-auto p-3.5 space-y-1.5">
          <button
            type="button"
            onClick={() => setVista("dashboard")}
            className={`w-full px-3.5 py-2.5 rounded-xl text-base font-bold flex items-center gap-2.5 transition ${
              vista === "dashboard"
                ? "bg-[#114B2F] text-white shadow-sm"
                : "text-slate-800 hover:bg-emerald-50 hover:text-[#114B2F]"
            }`}
          >
            <LayoutDashboard className="w-4 h-4 shrink-0" />
            <span>Dashboard Ejecutivo</span>
          </button>

          {/* Acordeón Reportes Oficiales: Se abre y se cierra siempre al pulsar */}
          <div className="flex flex-col">
            <button
              type="button"
              onClick={() => setSubmenuReportesAbierto((prev) => !prev)}
              className={`w-full px-3.5 py-2.5 rounded-xl text-base font-bold flex items-center justify-between gap-2 transition ${
                vista === "reportes"
                  ? "bg-[#114B2F] text-white shadow-sm"
                  : "text-slate-800 hover:bg-emerald-50 hover:text-[#114B2F]"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Table className="w-4 h-4 shrink-0" />
                <span>Reportes Oficiales</span>
              </span>
              {submenuReportesAbierto ? (
                <ChevronDown className="w-4 h-4 shrink-0" />
              ) : (
                <ChevronRight className="w-4 h-4 shrink-0" />
              )}
            </button>

            {submenuReportesAbierto && (
              <div className="mt-1.5 ml-3 pl-2.5 border-l-2 border-emerald-400 flex flex-col gap-1">
                {REPORTES_LISTA.map((rep) => {
                  const activo = vista === "reportes" && reporteActivo === rep.id;
                  return (
                    <button
                      key={rep.id}
                      type="button"
                      onClick={() => {
                        setVista("reportes");
                        setReporteActivo(rep.id);
                      }}
                      className={`text-left px-2.5 py-1.5 rounded-lg text-sm transition ${
                        activo
                          ? "bg-emerald-100 text-[#114B2F] font-bold border-l-4 border-[#114B2F]"
                          : "text-slate-800 hover:bg-emerald-50 hover:text-[#114B2F]"
                      }`}
                    >
                      {rep.nombre}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {usuario.rol === "ADMIN" && (
            <>
              <div className="pt-3 pb-1 px-3">
                <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Administración
                </p>
              </div>

              <button
                type="button"
                onClick={() => setVista("importar")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-base font-bold flex items-center gap-2.5 transition ${
                  vista === "importar"
                    ? "bg-[#009B4D] text-white shadow-sm"
                    : "text-slate-800 hover:bg-emerald-50 hover:text-[#007A3D]"
                }`}
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>Importar & Backups</span>
              </button>

              <button
                type="button"
                onClick={() => setVista("editor_bd")}
                className={`w-full px-3.5 py-2.5 rounded-xl text-base font-bold flex items-center gap-2.5 transition ${
                  vista === "editor_bd"
                    ? "bg-[#0F174A] text-white shadow-sm"
                    : "text-slate-800 hover:bg-slate-100 hover:text-[#0F174A]"
                }`}
              >
                <Database className="w-4 h-4 shrink-0" />
                <span>Editor Base de Datos</span>
              </button>
            </>
          )}
        </nav>

        {/* Pie del Sidebar SIEMPRE VISIBLE Y FIJO ABAJO (Con espacio para no chocar con el botón N de Next.js) */}
        <div className="p-4 pb-6 border-t border-slate-200 bg-slate-100 shrink-0">
          <div className="flex items-center justify-between gap-2 pl-8">
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">{usuario.nombre}</p>
              <span
                className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-0.5 rounded-full mt-0.5 ${
                  usuario.rol === "ADMIN"
                    ? "bg-emerald-200 text-[#114B2F]"
                    : "bg-indigo-200 text-[#0F174A]"
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" /> {usuario.rol}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setUsuario(null);
                setMensajesChat([]);
                setChatAbierto(false);
                setInputChat("");
                setVista("dashboard");
                setSubmenuReportesAbierto(false);
              }}
              className="px-3 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm transition shrink-0"
              title="Cerrar sesión"
            >
              <LogOut className="w-3.5 h-3.5" /> Salir
            </button>
          </div>
        </div>
      </aside>

      {/* =====================================================================
          ÁREA PRINCIPAL CON SCROLL PROPIO (EL MENÚ LATERAL NO SE MUEVE)
         ===================================================================== */}
      <div className="flex-1 flex flex-col h-screen overflow-y-auto min-w-0">
        {/* Topbar Institucional */}
        <header className="bg-gradient-to-r from-[#114B2F] via-[#165B39] to-[#007A3D] text-white px-6 py-3.5 flex flex-wrap items-center justify-between gap-4 shadow-sm sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarAbierto((prev) => !prev)}
              className="bg-white/15 hover:bg-white/25 text-white p-2 rounded-xl transition flex items-center gap-1.5 text-xs font-bold"
              title={sidebarAbierto ? "Ocultar menú lateral" : "Mostrar menú lateral"}
            >
              {sidebarAbierto ? (
                <PanelLeftClose className="w-5 h-5" />
              ) : (
                <>
                  <PanelLeftOpen className="w-5 h-5" />
                  <span>Menú</span>
                </>
              )}
            </button>
            <div>
              <h1 className="text-lg sm:text-xl font-bold tracking-tight">
                {vista === "dashboard" && "Panel Ejecutivo de Ejecución Presupuestaria"}
                {vista === "reportes" && "Reportes Financieros Consolidados"}
                {vista === "importar" && "Carga Contable, Auditoría y Respaldos"}
                {vista === "editor_bd" && "Administración Directa de Base de Datos"}
              </h1>
              <p className="text-xs text-emerald-100">
                Enseña por Bolivia • Gestión Financiera {gestion}
              </p>
            </div>
          </div>

          {/* Control de Moneda y Tipo de Cambio en Vivo */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="bg-white/15 border border-white/25 px-3 py-1.5 rounded-xl text-sm flex items-center gap-2">
              <span className="text-white">
                TC: <strong>{reporteData?.tasa_aplicada || 11.7} Bs/USD</strong>
              </span>
              {usuario.rol === "ADMIN" && !editandoTc && (
                <button
                  type="button"
                  onClick={() => {
                    setNuevoTc(String(reporteData?.tasa_aplicada || 11.7));
                    setEditandoTc(true);
                  }}
                  className="bg-white text-[#114B2F] hover:bg-emerald-50 px-2.5 py-0.5 rounded-md text-xs font-bold transition"
                >
                  Editar TC
                </button>
              )}
              {usuario.rol === "ADMIN" && editandoTc && (
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.01"
                    value={nuevoTc}
                    onChange={(e) => setNuevoTc(e.target.value)}
                    className="w-20 px-2 py-0.5 rounded text-slate-900 text-sm font-bold bg-white"
                  />
                  <button
                    type="button"
                    onClick={handleActualizarTc}
                    className="bg-emerald-400 hover:bg-emerald-300 text-slate-950 px-2 py-0.5 rounded text-xs font-bold"
                  >
                    OK
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditandoTc(false)}
                    className="bg-white/20 hover:bg-white/30 text-white px-2 py-0.5 rounded text-xs"
                  >
                    ✕
                  </button>
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => setMoneda(moneda === "BS" ? "USD" : "BS")}
              className="bg-white text-[#114B2F] hover:bg-emerald-50 px-3.5 py-1.5 rounded-xl text-sm font-bold shadow-sm flex items-center gap-1.5 transition"
            >
              <DollarSign className="w-4 h-4 text-[#009B4D]" />
              Moneda: {moneda}
            </button>

            {moneda === "USD" && (
              <select
                value={usarTcActual ? "actual" : "oficial"}
                onChange={(e) => setUsarTcActual(e.target.value === "actual")}
                className="bg-[#0D3B24] text-white border border-white/30 rounded-xl px-2.5 py-1.5 text-sm outline-none"
              >
                <option value="actual">TC BCB ({filtrosData?.tipo_cambio?.tasa_actual || 11.7})</option>
                <option value="oficial">TC Referencial (6.96)</option>
              </select>
            )}
          </div>
        </header>

        {/* Barra de Filtros Globales */}
        {vista !== "importar" && vista !== "editor_bd" && (
          <div className="bg-white border-b border-slate-300 px-6 py-3 flex flex-wrap items-center gap-2.5 shadow-2xs">
            <span className="text-sm font-bold text-[#114B2F] flex items-center gap-1 mr-1">
              <Filter className="w-4 h-4" /> Filtros:
            </span>

            <select
              value={gestion}
              onChange={(e) => setGestion(Number(e.target.value))}
              className="border border-slate-300 bg-white rounded-lg px-3 py-1.5 text-sm font-bold text-slate-900 outline-none focus:border-[#009B4D]"
            >
              {(filtrosData?.gestiones || [2026]).map((g: number) => (
                <option key={g} value={g}>Gestión {g}</option>
              ))}
            </select>

            <select
              value={regionId}
              onChange={(e) => setRegionId(e.target.value)}
              className="border border-slate-300 bg-white rounded-lg px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-[#009B4D]"
            >
              <option value="">Todas las Regiones</option>
              {filtrosData?.regiones?.map((r: any) => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>

            <select
              value={financiadorId}
              onChange={(e) => setFinanciadorId(e.target.value)}
              className="border border-slate-300 bg-white rounded-lg px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-[#009B4D]"
            >
              <option value="">Todos los Financiadores</option>
              {filtrosData?.financiadores?.map((f: any) => (
                <option key={f.id} value={f.id}>{f.nombre}</option>
              ))}
            </select>

            <select
              value={areaId}
              onChange={(e) => setAreaId(e.target.value)}
              className="border border-slate-300 bg-white rounded-lg px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-[#009B4D]"
            >
              <option value="">Todas las Áreas</option>
              {filtrosData?.areas?.map((a: any) => (
                <option key={a.id} value={a.id}>{a.nombre}</option>
              ))}
            </select>

            <select
              value={rubroId}
              onChange={(e) => setRubroId(e.target.value)}
              className="border border-slate-300 bg-white rounded-lg px-3 py-1.5 text-sm text-slate-900 outline-none focus:border-[#009B4D]"
            >
              <option value="">Todos los Rubros</option>
              {filtrosData?.rubros?.map((r: any) => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>

            {hayFiltrosActivos && (
              <button
                type="button"
                onClick={limpiarFiltros}
                className="text-sm text-[#114B2F] hover:text-emerald-950 bg-emerald-100 hover:bg-emerald-200 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Limpiar filtros
              </button>
            )}
          </div>
        )}

        {/* Contenedor Principal */}
        <main className="p-6 max-w-7xl w-full mx-auto flex-1">
          {/* =================================================================
              VISTA 1: DASHBOARD EJECUTIVO
             ================================================================= */}
          {vista === "dashboard" && (
            <div className="space-y-6">
              {/* Tarjetas KPI con números grandes y alto contraste */}
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-300">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-700 uppercase font-bold tracking-wider">Presupuesto Vigente</p>
                    <div className="p-2 rounded-xl bg-blue-100 text-blue-900">
                      <Wallet className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-slate-950 mt-2">
                    {simbolo} {totalPtto.toLocaleString("es-BO", { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">Planificación aprobada {gestion}</p>
                </div>

                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-300">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-700 uppercase font-bold tracking-wider">Ejecución Acumulada</p>
                    <div className="p-2 rounded-xl bg-emerald-100 text-[#114B2F]">
                      <TrendingUp className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-[#007A3D] mt-2">
                    {simbolo} {totalEjec.toLocaleString("es-BO", { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-[#114B2F] font-bold mt-1">Gasto ejecutado verificado</p>
                </div>

                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-300">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-700 uppercase font-bold tracking-wider">Saldo Disponible</p>
                    <div className="p-2 rounded-xl bg-amber-100 text-amber-800">
                      <PiggyBank className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-slate-950 mt-2">
                    {simbolo} {totalSaldo.toLocaleString("es-BO", { minimumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-slate-600 mt-1">Disponible por comprometer</p>
                </div>

                <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-300">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-700 uppercase font-bold tracking-wider">Avance Global</p>
                    <div className="p-2 rounded-xl bg-emerald-100 text-[#114B2F]">
                      <Percent className="w-4 h-4" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-slate-950 mt-2">{pctTotal}%</p>
                  <div className="w-full bg-slate-200 h-2.5 rounded-full mt-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-[#114B2F] to-[#009B4D] h-full rounded-full transition-all duration-500"
                      style={{ width: `${pctNum}%` }}
                    />
                  </div>
                </div>
              </div>

              {/* Gráficos Analíticos con colores brillantes y legibles */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-300">
                  <div className="mb-4">
                    <h3 className="font-bold text-[#114B2F] text-lg">Presupuesto vs. Ejecución por Rubro ({simbolo})</h3>
                    <p className="text-sm text-slate-600">Comparativa entre monto presupuestado y gasto ejecutado por partida</p>
                  </div>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dashboardRubros}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                        <XAxis dataKey="rubro" tick={{ fontSize: 12, fill: "#0f172a", fontWeight: "bold" }} />
                        <YAxis tick={{ fontSize: 12, fill: "#0f172a", fontWeight: "bold" }} />
                        <Tooltip
                          formatter={(val: any) => `${simbolo} ${Number(val).toLocaleString("es-BO", { minimumFractionDigits: 2 })}`}
                          contentStyle={{
                            borderRadius: "12px",
                            borderColor: "#114B2F",
                            backgroundColor: "#ffffff",
                            color: "#0f172a",
                            fontFamily: '"Times New Roman", Times, serif',
                            fontWeight: "bold"
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: "13px", fontWeight: "bold" }} />
                        <Bar dataKey="presupuesto" name="Presupuesto" fill="#1D4ED8" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="ejecucion" name="Ejecución" fill="#009B4D" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-300">
                  <div className="mb-4">
                    <h3 className="font-bold text-[#114B2F] text-lg">Evolución de Ejecución Mensual ({simbolo})</h3>
                    <p className="text-sm text-slate-600">Comportamiento del gasto ejecutado mes a mes</p>
                  </div>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dashboardMeses}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                        <XAxis dataKey="mes" tick={{ fontSize: 12, fill: "#0f172a", fontWeight: "bold" }} />
                        <YAxis tick={{ fontSize: 12, fill: "#0f172a", fontWeight: "bold" }} />
                        <Tooltip
                          formatter={(val: any) => `${simbolo} ${Number(val).toLocaleString("es-BO", { minimumFractionDigits: 2 })}`}
                          contentStyle={{
                            borderRadius: "12px",
                            borderColor: "#114B2F",
                            backgroundColor: "#ffffff",
                            color: "#0f172a",
                            fontFamily: '"Times New Roman", Times, serif',
                            fontWeight: "bold"
                          }}
                        />
                        <Bar dataKey="ejecucion" name="Ejecución Mensual" fill="#009B4D" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-300 lg:col-span-2">
                  <div className="mb-4">
                    <h3 className="font-bold text-[#114B2F] text-lg">Distribución de Ejecución por Financiador ({simbolo})</h3>
                    <p className="text-sm text-slate-600">Participación de cada fuente de financiamiento en la ejecución acumulada</p>
                  </div>
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={dashboardFondos}
                          dataKey="value"
                          nameKey="name"
                          cx="50%"
                          cy="50%"
                          innerRadius={50}
                          outerRadius={90}
                          paddingAngle={3}
                          label
                        >
                          {dashboardFondos.map((_, index) => (
                            <Cell key={`cell-${index}`} fill={COLORES_EXB[index % COLORES_EXB.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(val: any) => `${simbolo} ${Number(val).toLocaleString("es-BO", { minimumFractionDigits: 2 })}`}
                          contentStyle={{
                            borderRadius: "12px",
                            borderColor: "#114B2F",
                            backgroundColor: "#ffffff",
                            color: "#0f172a",
                            fontFamily: '"Times New Roman", Times, serif',
                            fontWeight: "bold"
                          }}
                        />
                        <Legend wrapperStyle={{ fontSize: "13px", fontWeight: "bold" }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =================================================================
              VISTA 2: 7 REPORTES OFICIALES (NÚMEROS EN TIMES NEW ROMAN NEGRO PURO)
             ================================================================= */}
          {vista === "reportes" && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-300 p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#007A3D]">
                    {REPORTES_LISTA.find((r) => r.id === reporteActivo)?.nombre}
                  </span>
                  <h2 className="text-xl font-bold text-[#114B2F] mt-0.5 flex items-center gap-2">
                    <span>{reporteData?.titulo || "Reporte Oficial"}</span>
                    <span className="text-sm font-bold text-[#114B2F] bg-emerald-100 px-3 py-0.5 rounded-full">
                      En {simbolo}
                    </span>
                  </h2>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={`${API_URL}/reportes/${reporteActivo}?${buildParams("excel")}`}
                    className="bg-[#009B4D] hover:bg-[#007A3D] text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 shadow-sm transition"
                  >
                    <FileSpreadsheet className="w-4 h-4" /> Exportar Excel
                  </a>
                  <a
                    href={`${API_URL}/reportes/${reporteActivo}?${buildParams("pdf")}`}
                    className="bg-[#0F174A] hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 shadow-sm transition"
                  >
                    <FileText className="w-4 h-4" /> Exportar PDF
                  </a>
                </div>
              </div>

              {cargando ? (
                <p className="text-slate-700 py-10 text-center text-base font-bold">Calculando reporte financiero...</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-300">
                  <table className="w-full text-base text-left border-collapse bg-white">
                    <thead>
                      <tr className="bg-[#114B2F] text-white">
                        {reporteData?.datos?.[0] &&
                          Object.keys(reporteData.datos[0]).map((col) => (
                            <th key={col} className="px-4 py-3 uppercase text-xs font-bold tracking-wider border border-emerald-800">
                              {col.replace(/_/g, " ")}
                            </th>
                          ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-300">
                      {reporteData?.datos?.map((fila: any, idx: number) => (
                        <tr key={idx} className="even:bg-slate-50 hover:bg-emerald-50 transition">
                          {Object.entries(fila).map(([k, val]: any, i) => (
                            <td
                              key={i}
                              className={`px-4 py-2.5 text-sm border border-slate-200 ${
                                typeof val === "number"
                                  ? "text-right font-bold text-slate-950"
                                  : "text-slate-900 font-medium"
                              }`}
                            >
                              {typeof val === "number"
                                ? val.toLocaleString("es-BO", { minimumFractionDigits: k === "tipo" || k === "numero" ? 0 : 2 })
                                : val}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* =================================================================
              VISTA 3: IMPORTAR EXCEL, AUDITORÍA Y BACKUPS (SOLO ADMIN)
             ================================================================= */}
          {vista === "importar" && usuario.rol === "ADMIN" && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-300 max-w-xl">
                <h2 className="text-xl font-bold text-[#114B2F] mb-1">Importar Base de Datos Contable (Excel)</h2>
                <p className="text-sm text-slate-700 mb-4">
                  Sube el archivo con la hoja <strong>BD</strong>. El motor auditará cuentas, evitará duplicados y actualizará los 7 reportes al instante.
                </p>
                <form onSubmit={handleSubirExcel} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-800 mb-1">Gestión (Año)</label>
                    <input
                      type="number"
                      value={gestion}
                      onChange={(e) => setGestion(Number(e.target.value))}
                      className="border border-slate-300 bg-white text-slate-950 font-bold rounded-xl px-3 py-2 w-32 text-base outline-none focus:border-[#009B4D]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-800 mb-1">Archivo Excel (.xlsx)</label>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={(e) => setArchivoExcel(e.target.files?.[0] || null)}
                      className="block w-full text-sm text-slate-800 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-emerald-100 file:text-[#114B2F] hover:file:bg-emerald-200"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    className="bg-[#009B4D] hover:bg-[#007A3D] text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-sm transition"
                  >
                    Procesar y Actualizar Sistema
                  </button>
                </form>
                {mensajeImportacion && <p className="mt-4 text-sm font-bold text-[#114B2F]">{mensajeImportacion}</p>}
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-300">
                <h3 className="text-lg font-bold text-[#114B2F] mb-3">Historial de Importaciones y Auditoría Contable</h3>
                <div className="overflow-x-auto rounded-xl border border-slate-300">
                  <table className="w-full text-sm text-left bg-white">
                    <thead className="bg-[#114B2F] text-white">
                      <tr>
                        <th className="p-3">Archivo</th>
                        <th className="p-3">Gestión</th>
                        <th className="p-3">Filas</th>
                        <th className="p-3">Presupuesto No Ejec.</th>
                        <th className="p-3">Ejecución</th>
                        <th className="p-3">Auditoría</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-300">
                      {historialCargas.map((h) => (
                        <tr key={h.id} className="hover:bg-slate-50">
                          <td className="p-3 font-bold text-slate-950">{h.nombre_archivo}</td>
                          <td className="p-3 font-bold text-slate-950">{h.gestion}</td>
                          <td className="p-3 font-bold text-slate-950">{h.total_filas_procesadas}</td>
                          <td className="p-3 font-bold text-slate-950">Bs {Number(h.total_presupuesto_bs).toLocaleString("es-BO", { minimumFractionDigits: 2 })}</td>
                          <td className="p-3 font-bold text-slate-950">Bs {Number(h.total_ejecucion_bs).toLocaleString("es-BO", { minimumFractionDigits: 2 })}</td>
                          <td className="p-3">
                            {h.advertencias ? (
                              <button
                                type="button"
                                onClick={() => setAlertaSeleccionada(h.advertencias)}
                                className="text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-400 px-3 py-1 rounded-lg flex items-center gap-1 font-bold transition"
                              >
                                <AlertCircle className="w-4 h-4" /> Ver {h.advertencias.split("\n").length} alertas
                              </button>
                            ) : (
                              <span className="text-[#007A3D] font-bold">Sin alertas</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {alertaSeleccionada && (
                  <div className="mt-4 p-4 bg-amber-50 border border-amber-400 rounded-xl text-sm text-amber-950">
                    <div className="flex justify-between items-center mb-2">
                      <strong className="uppercase">Detalle de Alertas de Auditoría Contable:</strong>
                      <button
                        type="button"
                        onClick={() => setAlertaSeleccionada(null)}
                        className="text-amber-900 hover:text-black font-bold"
                      >
                        Cerrar ✕
                      </button>
                    </div>
                    <ul className="list-disc pl-5 space-y-1 max-h-40 overflow-y-auto">
                      {alertaSeleccionada.split("\n").map((linea, idx) => (
                        <li key={idx}>{linea}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-300 border-t-4 border-t-[#114B2F]">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-[#114B2F]">Copias de Seguridad Rotativas (Máx. 2 versiones)</h3>
                    <p className="text-sm text-slate-700">
                      El sistema crea un respaldo automático antes de cada importación y mantiene las 2 versiones más recientes.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleCrearBackup}
                    className="bg-[#114B2F] hover:bg-[#007A3D] text-white px-4 py-2 rounded-xl text-sm font-bold shadow-sm transition"
                  >
                    + Crear Respaldo Manual
                  </button>
                </div>

                {mensajeBackup && <p className="mb-3 text-sm font-bold text-[#007A3D]">{mensajeBackup}</p>}

                <div className="overflow-x-auto rounded-xl border border-slate-300">
                  <table className="w-full text-sm text-left bg-white">
                    <thead className="bg-[#0F174A] text-white">
                      <tr>
                        <th className="p-3">Nombre del Respaldo</th>
                        <th className="p-3">Creado Por</th>
                        <th className="p-3">Fecha y Hora</th>
                        <th className="p-3">Registros (Ptto / Movs)</th>
                        <th className="p-3 text-right">Acción</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-300">
                      {backups.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="p-4 text-center text-slate-600">
                            Aún no hay copias de seguridad registradas. Crea una manual o sube un Excel.
                          </td>
                        </tr>
                      ) : (
                        backups.map((b) => (
                          <tr key={b.id} className="hover:bg-slate-50">
                            <td className="p-3 font-bold text-[#114B2F]">{b.nombre}</td>
                            <td className="p-3 text-slate-900">{b.creado_por}</td>
                            <td className="p-3 text-slate-900 font-medium">
                              {new Date(b.fecha_creacion.endsWith("Z") ? b.fecha_creacion : `${b.fecha_creacion}Z`).toLocaleString("es-BO", {
                                timeZone: "America/La_Paz",
                              })}
                            </td>
                            <td className="p-3 font-bold text-slate-950">{b.total_ptto} ptto / {b.total_movs} movs</td>
                            <td className="p-3 text-right">
                              <button
                                type="button"
                                onClick={() => handleRestaurarBackup(b.id, b.nombre)}
                                className="bg-amber-600 hover:bg-amber-500 text-white px-3.5 py-1.5 rounded-lg text-xs font-bold transition"
                              >
                                Restaurar versión
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* =================================================================
              VISTA 4: EDITOR SQL EN VIVO (SOLO ADMIN)
             ================================================================= */}
          {vista === "editor_bd" && usuario.rol === "ADMIN" && (
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-300 border-t-4 border-t-[#0F174A]">
                <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                  <div>
                    <h2 className="text-xl font-bold text-[#0F174A]">Editor Directo de Base de Datos (PostgreSQL)</h2>
                    <p className="text-sm text-slate-700">
                      Edita celdas en vivo, inserta registros o elimina filas. Todos los cambios impactan al instante en el Dashboard y Reportes.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-bold uppercase text-slate-800">Tabla:</label>
                    <select
                      value={tablaEditor}
                      onChange={(e) => setTablaEditor(e.target.value)}
                      className="border border-slate-300 rounded-xl px-3 py-2 text-sm font-bold bg-white text-[#114B2F] outline-none"
                    >
                      <option value="presupuestos">presupuestos</option>
                      <option value="movimientos">movimientos</option>
                      <option value="regiones">regiones</option>
                      <option value="financiadores">financiadores</option>
                      <option value="areas">areas</option>
                      <option value="rubros">rubros</option>
                    </select>
                  </div>
                </div>

                {mensajeEditor && <p className="mb-3 text-sm font-bold text-[#114B2F]">{mensajeEditor}</p>}

                <form onSubmit={handleCrearRegistro} className="mb-5 p-4 bg-emerald-50 border border-emerald-300 rounded-xl">
                  <p className="text-xs font-bold uppercase text-[#114B2F] mb-2.5">+ Insertar nueva fila en {tablaEditor}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                    {columnasEditor.map((col) => (
                      <input
                        key={col}
                        type="text"
                        placeholder={col}
                        value={nuevaFila[col] ?? ""}
                        onChange={(e) => setNuevaFila({ ...nuevaFila, [col]: e.target.value })}
                        className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm bg-white text-slate-950 outline-none focus:border-[#009B4D]"
                      />
                    ))}
                    <button
                      type="submit"
                      className="bg-[#009B4D] hover:bg-[#007A3D] text-white px-3 py-1.5 rounded-lg text-sm font-bold transition"
                    >
                      Insertar
                    </button>
                  </div>
                </form>

                <div className="overflow-x-auto max-h-[520px] rounded-xl border border-slate-300">
                  <table className="w-full text-sm text-left bg-white">
                    <thead className="bg-[#0F174A] text-white sticky top-0">
                      <tr>
                        <th className="p-3">ID</th>
                        {columnasEditor.map((col) => (
                          <th key={col} className="p-3 whitespace-nowrap">{col}</th>
                        ))}
                        <th className="p-3 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-300">
                      {filasEditor.map((fila) => {
                        const esEdicion = editandoId === fila.id;
                        return (
                          <tr key={fila.id} className="even:bg-slate-50 hover:bg-emerald-50/60">
                            <td className="p-2.5 font-bold text-slate-950">{fila.id}</td>
                            {columnasEditor.map((col) => (
                              <td key={col} className="p-2">
                                {esEdicion ? (
                                  <input
                                    type="text"
                                    value={filaEditada[col] ?? ""}
                                    onChange={(e) => setFilaEditada({ ...filaEditada, [col]: e.target.value })}
                                    className="border-2 border-[#009B4D] rounded-lg px-2 py-1 w-full min-w-[90px] bg-white text-slate-950 font-bold outline-none"
                                  />
                                ) : (
                                  <span className="block truncate max-w-[190px] text-slate-950 font-medium" title={String(fila[col] ?? "")}>
                                    {fila[col] !== null && fila[col] !== undefined ? String(fila[col]) : "—"}
                                  </span>
                                )}
                              </td>
                            ))}
                            <td className="p-2.5 text-right whitespace-nowrap space-x-1">
                              {esEdicion ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleGuardarEdicion(fila.id)}
                                    className="bg-[#009B4D] hover:bg-[#007A3D] text-white px-3 py-1 rounded-lg font-bold"
                                  >
                                    Guardar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditandoId(null)}
                                    className="bg-slate-200 hover:bg-slate-300 text-slate-900 px-2.5 py-1 rounded-lg font-bold"
                                  >
                                    Cancelar
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditandoId(fila.id);
                                      setFilaEditada({ ...fila });
                                    }}
                                    className="bg-[#114B2F] hover:bg-[#007A3D] text-white px-3 py-1 rounded-lg font-bold"
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleEliminarRegistro(fila.id)}
                                    className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded-lg font-bold"
                                  >
                                    Borrar
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* =====================================================================
          COPILOTO FINANCIERO IA (PALETA INSTITUCIONAL EXB)
         ===================================================================== */}
      <div className="fixed bottom-5 right-5 z-50">
        {!chatAbierto ? (
          <button
            type="button"
            onClick={() => setChatAbierto(true)}
            className="bg-gradient-to-r from-[#114B2F] to-[#009B4D] hover:from-[#0D3B24] hover:to-[#007A3D] text-white px-4 py-3 rounded-full shadow-2xl flex items-center gap-2 font-bold text-sm border-2 border-white transition transform hover:scale-105"
          >
            <Sparkles className="w-4 h-4 text-emerald-200" />
            <Bot className="w-5 h-5" />
            <span>Asistente Inteligente</span>
          </button>
        ) : (
          <div className="bg-white w-80 sm:w-96 h-[510px] rounded-2xl shadow-2xl border border-slate-300 flex flex-col overflow-hidden">
            <div className="bg-gradient-to-r from-[#114B2F] to-[#007A3D] text-white px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="bg-white/15 p-1.5 rounded-lg">
                  <Bot className="w-4 h-4 text-emerald-200" />
                </div>
                <div>
                  <h4 className="text-sm font-bold leading-tight">Copiloto Financiero ExB</h4>
                  <p className="text-[11px] text-emerald-100">Asistente IA • Perfil {usuario.rol}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {mensajesChat.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setMensajesChat([])}
                    className="text-xs bg-white/15 hover:bg-white/25 text-white px-2 py-0.5 rounded-md font-bold transition"
                    title="Vaciar conversación"
                  >
                    Limpiar
                  </button>
                )}
                <button type="button" onClick={() => setChatAbierto(false)} className="text-emerald-100 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 p-3.5 overflow-y-auto space-y-3 bg-[#F4F7F5] text-sm">
              {mensajesChat.length === 0 && (
                <div className="bg-white p-3.5 rounded-2xl border border-slate-300 text-slate-800 space-y-2 shadow-sm">
                  <p className="font-bold text-[#114B2F]">
                    ¡Hola, {usuario.nombre}! Soy tu Copiloto ExB.
                  </p>
                  <p className="leading-relaxed">
                    Analizo en vivo los datos de la gestión <strong>{gestion}</strong> ({moneda}) y te guío según tus permisos de <strong>{usuario.rol}</strong>.
                  </p>
                </div>
              )}

              {mensajesChat.map((m, i) => (
                <div key={i} className={`flex ${m.rol === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] p-3 rounded-2xl whitespace-pre-wrap leading-relaxed ${
                      m.rol === "user"
                        ? "bg-[#114B2F] text-white rounded-br-none shadow-sm"
                        : "bg-white border border-slate-300 text-slate-950 rounded-bl-none shadow-sm"
                    }`}
                  >
                    {m.texto}
                  </div>
                </div>
              ))}

              {cargandoChat && (
                <div className="text-[#114B2F] italic text-sm font-bold">Analizando información financiera...</div>
              )}

              {!cargandoChat && (
                <div className="pt-2 border-t border-slate-300 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleEnviarChat("Hazme un resumen ejecutivo de la ejecución presupuestaria actual.")}
                    className="bg-white hover:bg-emerald-50 text-[#114B2F] border border-emerald-300 px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition"
                  >
                    📊 Analizar datos actuales
                  </button>
                  <button
                    type="button"
                    onClick={() => handleEnviarChat("¿Qué funciones puedo usar con mi rol y dónde están?")}
                    className="bg-white hover:bg-emerald-50 text-[#114B2F] border border-emerald-300 px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition"
                  >
                    🧭 ¿Qué puedo hacer aquí?
                  </button>
                  {usuario.rol === "ADMIN" && (
                    <button
                      type="button"
                      onClick={() => handleEnviarChat("¿Cómo subo un Excel, restauro un backup o edito en SQL?")}
                      className="bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300 px-2.5 py-1.5 rounded-xl text-xs font-bold text-left transition"
                    >
                      🛠️ Guía de Administrador
                    </button>
                  )}
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleEnviarChat();
              }}
              className="p-2.5 bg-white border-t border-slate-300 flex items-center gap-2"
            >
              <input
                type="text"
                value={inputChat}
                onChange={(e) => setInputChat(e.target.value)}
                placeholder="Consulta cifras, gráficas o funciones..."
                className="flex-1 border border-slate-300 bg-white text-slate-950 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-[#009B4D]"
              />
              <button
                type="submit"
                disabled={cargandoChat}
                className="bg-[#114B2F] hover:bg-[#007A3D] disabled:opacity-50 text-white p-2 rounded-xl transition"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}