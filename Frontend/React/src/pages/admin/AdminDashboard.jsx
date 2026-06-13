import React, { useEffect, useState } from "react";
import {
  HardDrive,
  Database,
  Server,
  Activity,
  Clock,
  ShieldCheck,
  Palette,
  Check as CheckIcon,
  AlertCircle,
  CheckCircle,
  Film,
  Sparkles,
  Users,
  FolderTree,
  MessageSquare,
  Captions,
  Loader2,
  RotateCcw,
  Zap,
  UserPlus,
  UserX,
} from "lucide-react";
import { apiRequest } from "../../services/api";
import { useSettings } from "../../context/SettingsContext";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { COLOR_PRESETS } from "../../components/profile/ThemeTab";
import { motion } from "framer-motion";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";

// Framer motion variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.07 } },
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: "spring", stiffness: 300, damping: 24 },
  },
};

// --- Card statistica infrastruttura riutilizzabile ---
function StatCard({ icon: Icon, accent, label, value, unit, children, glow }) {
  return (
    <Card
      className={`group relative overflow-hidden bg-zinc-900/40 backdrop-blur-md border-white/5 hover:border-white/10 transition-colors h-full ${glow || ""}`}
    >
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{ backgroundColor: accent, opacity: 0.12 }}
      />
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div
          className="p-3 rounded-2xl group-hover:scale-110 transition-transform duration-500"
          style={{ backgroundColor: `${accent}1a` }}
        >
          <Icon size={24} style={{ color: accent }} />
        </div>
        <div className="text-right">
          <CardTitle className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {label}
          </CardTitle>
          <div className="text-2xl font-black text-foreground mt-1">
            {value}
            {unit && (
              <span className="text-xs text-muted-foreground font-bold ml-1">
                {unit}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// --- Riga sintetica nel pannello pipeline ---
function PipelineRow({ icon: Icon, accent, label, value, hint, badge, badgeTone }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl bg-zinc-950/40 border border-white/5">
      <div
        className="p-2.5 rounded-xl shrink-0"
        style={{ backgroundColor: `${accent}1a` }}
      >
        <Icon size={18} style={{ color: accent }} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-lg font-black text-foreground leading-none">
            {value}
          </span>
          {badge != null && (
            <span
              className={`text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${badgeTone}`}
            >
              {badge}
            </span>
          )}
        </div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground truncate mt-0.5">
          {label}
        </p>
      </div>
      {hint && (
        <span className="text-[10px] font-bold text-muted-foreground/70 shrink-0">
          {hint}
        </span>
      )}
    </div>
  );
}

export default function AdminDashboard() {
  useDocumentTitle("Dashboard Admin");
  const { logoParts, defaultTheme, fetchSettings, registrationEnabled } = useSettings();

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  const [logo1, setLogo1] = useState(logoParts?.part1 || "FRANZ");
  const [logo2, setLogo2] = useState(logoParts?.part2 || "PLAY");
  const [isLogoSaving, setIsLogoSaving] = useState(false);

  const [globalTheme, setGlobalTheme] = useState(defaultTheme || "#dc2626");
  const [isThemeSaving, setIsThemeSaving] = useState(false);

  const [regEnabled, setRegEnabled] = useState(registrationEnabled);
  const [isRegSaving, setIsRegSaving] = useState(false);

  const [message, setMessage] = useState(null);

  const showMessage = (type, text) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  // Orologio live
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setLogo1(logoParts?.part1 || "FRANZ");
    setLogo2(logoParts?.part2 || "PLAY");
  }, [logoParts]);

  useEffect(() => {
    setGlobalTheme(defaultTheme || "#dc2626");
  }, [defaultTheme]);

  useEffect(() => {
    setRegEnabled(registrationEnabled);
  }, [registrationEnabled]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await apiRequest("/admin.php", "POST", {
          action: "stato_server",
        });
        if (res.success) {
          setStats(res.data || res.dati);
        }
      } catch (error) {
        console.error("Errore fetch stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const handleLogoSubmit = async (e) => {
    e.preventDefault();
    setIsLogoSaving(true);
    try {
      const formData = new FormData();
      formData.append("action", "salva_logo");
      formData.append("logo_part_1", logo1);
      formData.append("logo_part_2", logo2);

      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        showMessage("success", "Logo aggiornato con successo");
        fetchSettings();
      }
    } catch (error) {
      showMessage("error", "Errore salvataggio logo");
    } finally {
      setIsLogoSaving(false);
    }
  };

  const handleToggleRegistration = async (next) => {
    setRegEnabled(next); // optimistic
    setIsRegSaving(true);
    try {
      const formData = new FormData();
      formData.append("action", "salva_registrazione");
      formData.append("abilitata", next ? "1" : "0");
      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        showMessage("success", next ? "Registrazione abilitata" : "Registrazione disabilitata");
        fetchSettings();
      } else {
        setRegEnabled(!next); // rollback
      }
    } catch (error) {
      setRegEnabled(!next); // rollback
      showMessage("error", "Errore salvataggio registrazione");
    } finally {
      setIsRegSaving(false);
    }
  };

  const handleThemeSubmit = async (e) => {
    e.preventDefault();
    setIsThemeSaving(true);
    try {
      const formData = new FormData();
      formData.append("action", "salva_impostazioni_globali");
      formData.append("tema_default", globalTheme);

      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        showMessage("success", "Tema aggiornato con successo");
        fetchSettings();
      }
    } catch (error) {
      showMessage("error", "Errore salvataggio tema");
    } finally {
      setIsThemeSaving(false);
    }
  };

  const isValidHex = /^#[0-9a-fA-F]{6}$/.test(globalTheme);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="h-40 animate-pulse bg-zinc-900/50 border-white/5" />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="h-64 animate-pulse bg-zinc-900/50 border-white/5" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <Card className="border-red-500/20 bg-red-500/5 flex flex-col items-center justify-center py-12">
        <ShieldCheck size={48} className="text-red-500 mb-4 opacity-50" />
        <p className="text-red-500 font-bold">Errore caricamento dati server.</p>
        <Button
          onClick={() => window.location.reload()}
          variant="destructive"
          className="mt-4 font-bold"
        >
          Riprova
        </Button>
      </Card>
    );
  }

  const diskColor =
    stats.disco_percentuale > 90
      ? "bg-red-500"
      : stats.disco_percentuale > 70
        ? "bg-yellow-500"
        : "bg-primary";

  const totVideo = stats.video_totali || 0;
  const optPerc =
    totVideo > 0 ? Math.round(((stats.video_ottimizzati || 0) / totVideo) * 100) : 0;

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-10 pb-10"
    >
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="flex h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
              Sistema Operativo
            </span>
          </div>
          <h1 className="text-4xl font-extrabold text-foreground tracking-tight">
            Dashboard
          </h1>
          <p className="text-muted-foreground mt-2 font-medium">
            Monitoring in tempo reale di FranzPLAY.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="bg-zinc-950/60 backdrop-blur-xl px-4 py-2 rounded-2xl flex items-center gap-2 border border-white/5">
            <Film size={16} className="text-primary" />
            <span className="text-xs font-bold text-zinc-300">
              {totVideo} video
            </span>
          </div>
          <div className="bg-zinc-950/60 backdrop-blur-xl px-4 py-2 rounded-2xl flex items-center gap-2 border border-white/5">
            <Users size={16} className="text-muted-foreground" />
            <span className="text-xs font-bold text-zinc-300">
              {stats.utenti_totali || 0} utenti
            </span>
          </div>
          <div className="bg-zinc-950/60 backdrop-blur-xl px-4 py-2 rounded-2xl flex items-center gap-2 border border-white/5 tabular-nums">
            <Clock size={16} className="text-muted-foreground" />
            <span className="text-xs font-bold text-zinc-300">
              {now.toLocaleTimeString()}
            </span>
          </div>
        </div>
      </div>

      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`p-4 rounded-xl flex items-center gap-3 shadow-lg ${
            message.type === "success"
              ? "bg-green-950/50 text-green-400 border border-green-800"
              : "bg-red-950/50 text-red-400 border border-red-800"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
          <span className="font-medium">{message.text}</span>
        </motion.div>
      )}

      {/* Stats Grid - Infrastruttura */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <motion.div variants={itemVariants}>
          <StatCard
            icon={HardDrive}
            accent="#60a5fa"
            label="Archiviazione"
            value={stats.disco_usato_gb}
            unit="GB"
          >
            <Progress
              value={stats.disco_percentuale}
              className="h-2 mb-3 bg-zinc-800"
              indicatorColor={diskColor}
            />
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-tighter">
              <span className="text-muted-foreground">
                {stats.disco_percentuale}% Usato
              </span>
              <span className="text-muted-foreground">
                Libero: {stats.disco_libero_gb} GB
              </span>
            </div>
          </StatCard>
        </motion.div>

        <motion.div variants={itemVariants}>
          <StatCard
            icon={Film}
            accent="#f87171"
            label="Libreria"
            value={totVideo}
            unit="video"
          >
            <Progress
              value={optPerc}
              className="h-2 mb-3 bg-zinc-800"
              indicatorColor="bg-emerald-500"
            />
            <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-tighter">
              <span className="text-emerald-400">{optPerc}% Ottimizzati</span>
              <span className="text-muted-foreground">
                {stats.categorie_totali || 0} categorie
              </span>
            </div>
          </StatCard>
        </motion.div>

        <motion.div variants={itemVariants}>
          <StatCard
            icon={Server}
            accent="#c084fc"
            label="PHP Upload"
            value={stats.php_upload_max}
          >
            <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground bg-zinc-950/40 p-2 rounded-xl border border-white/5 mt-2">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
              Post Max: {stats.php_post_max}
            </div>
          </StatCard>
        </motion.div>

        <motion.div variants={itemVariants}>
          <StatCard
            icon={Activity}
            accent="#34d399"
            label="API Status"
            value="Online"
            glow="border-green-500/10 hover:border-green-500/30"
          >
            <div className="flex items-center justify-between gap-2 text-xs font-bold text-muted-foreground mt-2">
              <span className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-green-500" />
                Protezione attiva
              </span>
              <span
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider"
                title={stats.db_version}
              >
                <Database size={12} className="text-yellow-500" />
                {(stats.db_version || "MariaDB").split("-")[0]}
              </span>
            </div>
          </StatCard>
        </motion.div>
      </div>

      {/* Pipeline / Health */}
      <motion.div variants={itemVariants}>
        <div className="flex items-center gap-3 mb-6">
          <div className="w-8 h-[2px] bg-emerald-500 rounded-full"></div>
          <h2 className="text-xl font-black text-foreground uppercase tracking-wider flex items-center gap-2">
            <Zap size={20} className="text-emerald-500" /> Pipeline & Contenuti
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <PipelineRow
            icon={Loader2}
            accent="#38bdf8"
            label="In ingestione"
            value={stats.video_in_ingestione || 0}
            badge={stats.video_in_ingestione > 0 ? "Attivo" : "Idle"}
            badgeTone={
              stats.video_in_ingestione > 0
                ? "bg-sky-500/15 text-sky-400"
                : "bg-zinc-700/40 text-zinc-400"
            }
          />
          <PipelineRow
            icon={Sparkles}
            accent="#fbbf24"
            label="Asset mancanti"
            value={stats.asset_mancanti || 0}
            hint="cover / anteprime"
          />
          <PipelineRow
            icon={ShieldCheck}
            accent="#34d399"
            label="Da analizzare"
            value={stats.video_da_analizzare || 0}
            hint="optimizer"
          />
          <PipelineRow
            icon={Captions}
            accent="#a78bfa"
            label="Sottotitoli pronti"
            value={stats.sottotitoli_totali || 0}
            badge={stats.sottotitoli_in_coda > 0 ? `${stats.sottotitoli_in_coda} in coda` : null}
            badgeTone="bg-violet-500/15 text-violet-400"
          />
          <PipelineRow
            icon={FolderTree}
            accent="#22d3ee"
            label="Categorie"
            value={stats.categorie_totali || 0}
          />
          <PipelineRow
            icon={MessageSquare}
            accent="#f472b6"
            label="Commenti"
            value={stats.commenti_totali || 0}
          />
        </div>
      </motion.div>

      {/* Settings Area */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 pt-4 pb-8">
        {/* LOGO */}
        <motion.div variants={itemVariants} className="xl:col-span-1">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-[2px] bg-primary rounded-full"></div>
            <h2 className="text-xl font-black text-foreground uppercase tracking-wider">
              Logo
            </h2>
          </div>
          <Card className="bg-zinc-900/40 backdrop-blur-md border-white/5">
            <CardContent className="pt-6">
              <form onSubmit={handleLogoSubmit} className="space-y-5">
                {/* Anteprima logo live */}
                <div className="flex items-center justify-center rounded-2xl bg-zinc-950/50 border border-white/5 py-6">
                  <span className="text-3xl font-black tracking-tight text-foreground">
                    {logo1 || "FRANZ"}
                    <span style={{ color: globalTheme }}>{logo2 || "PLAY"}</span>
                  </span>
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-muted-foreground">
                    Parte 1 (Testo Normale)
                  </Label>
                  <Input
                    type="text"
                    value={logo1}
                    onChange={(e) => setLogo1(e.target.value)}
                    required
                    className="bg-zinc-950/50 border-white/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs font-bold text-muted-foreground">
                    Parte 2 (Testo Evidenziato)
                  </Label>
                  <Input
                    type="text"
                    value={logo2}
                    onChange={(e) => setLogo2(e.target.value)}
                    required
                    className="bg-zinc-950/50 border-white/10"
                  />
                </div>
                <div className="flex justify-end pt-2">
                  <Button
                    type="submit"
                    disabled={isLogoSaving}
                    className="font-bold shadow-lg shadow-primary/20"
                  >
                    {isLogoSaving ? "Salvataggio..." : "Salva Logo"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* TOGGLE REGISTRAZIONE */}
          <div className="flex items-center gap-3 mt-8 mb-6">
            <div className="w-8 h-[2px] bg-emerald-500 rounded-full"></div>
            <h2 className="text-xl font-black text-foreground uppercase tracking-wider">
              Accesso
            </h2>
          </div>
          <Card className="bg-zinc-900/40 backdrop-blur-md border-white/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div
                  className={`p-3 rounded-2xl shrink-0 transition-colors ${
                    regEnabled ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-700/40 text-zinc-400"
                  }`}
                >
                  {regEnabled ? <UserPlus size={22} /> : <UserX size={22} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-foreground leading-tight">
                    Registrazione nuovi account
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {regEnabled
                      ? "I visitatori possono creare un account dalla pagina di accesso."
                      : "Disattivata: solo un admin può creare nuovi utenti. Il pulsante “Registrati” è nascosto."}
                  </p>
                </div>
                <Switch
                  checked={regEnabled}
                  onCheckedChange={handleToggleRegistration}
                  disabled={isRegSaving}
                  className="mt-1 shrink-0"
                />
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* TEMA GLOBALE */}
        <motion.div variants={itemVariants} className="xl:col-span-2">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-[2px] bg-blue-500 rounded-full"></div>
            <h2 className="text-xl font-black text-foreground uppercase tracking-wider flex items-center gap-2">
              <Palette size={20} className="text-blue-500" /> Tema Globale
            </h2>
          </div>
          <Card className="bg-zinc-900/40 backdrop-blur-md border-white/5">
            <CardContent className="pt-6">
              <form onSubmit={handleThemeSubmit} className="space-y-6">
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                  {/* Colonna selezione */}
                  <div className="lg:col-span-3 space-y-6">
                    <div>
                      <Label className="text-xs font-bold text-muted-foreground mb-1 block">
                        Colore Predefinito Accesso/App
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        Colore base per la pagina di Login e per gli utenti che
                        non hanno scelto un colore personale.
                      </p>
                    </div>

                    <div className="grid grid-cols-6 sm:grid-cols-7 gap-2.5">
                      {COLOR_PRESETS.map((preset) => {
                        const active =
                          globalTheme.toLowerCase() === preset.value.toLowerCase();
                        return (
                          <motion.button
                            whileHover={{ scale: 1.08 }}
                            whileTap={{ scale: 0.92 }}
                            key={preset.value}
                            type="button"
                            onClick={() => setGlobalTheme(preset.value)}
                            className="relative aspect-square rounded-xl flex items-center justify-center transition-shadow"
                            style={{
                              backgroundColor: preset.value,
                              boxShadow: active
                                ? `0 0 0 2px var(--color-zinc-950, #09090b), 0 0 0 4px ${preset.value}`
                                : "none",
                            }}
                            title={preset.name}
                          >
                            {active && (
                              <CheckIcon className="h-5 w-5 text-white drop-shadow-md" />
                            )}
                          </motion.button>
                        );
                      })}
                    </div>

                    <div>
                      <Label className="text-xs font-bold text-muted-foreground mb-2 block">
                        Oppure usa un Colore Personalizzato
                      </Label>
                      <div className="flex items-center gap-4 bg-zinc-950/50 border border-white/5 rounded-2xl p-3">
                        <div
                          className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 shadow-lg border border-white/10"
                          style={{
                            backgroundColor: isValidHex ? globalTheme : "#3f3f46",
                            boxShadow: isValidHex ? `0 0 20px ${globalTheme}40` : "none",
                          }}
                        >
                          <input
                            type="color"
                            value={isValidHex ? globalTheme : "#dc2626"}
                            onChange={(e) => setGlobalTheme(e.target.value)}
                            className="absolute inset-0 w-[200%] h-[200%] -top-1/2 -left-1/2 cursor-pointer opacity-0"
                          />
                        </div>
                        <div className="flex-1">
                          <span className="block text-[10px] font-black uppercase text-muted-foreground tracking-wider mb-1">
                            Codice Esadecimale
                          </span>
                          <Input
                            type="text"
                            value={globalTheme.toUpperCase()}
                            onChange={(e) => {
                              let v = e.target.value.trim();
                              if (!v.startsWith("#")) v = "#" + v.replace(/#/g, "");
                              setGlobalTheme(v);
                            }}
                            maxLength={7}
                            className={`bg-transparent border-none shadow-none text-xl font-black uppercase focus-visible:ring-0 w-full tracking-wider px-0 ${
                              isValidHex ? "text-foreground" : "text-red-400"
                            }`}
                            placeholder="#DC2626"
                          />
                        </div>
                        {!isValidHex && (
                          <span className="text-[10px] font-bold text-red-400 shrink-0">
                            Hex non valido
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Colonna anteprima live */}
                  <div className="lg:col-span-2">
                    <Label className="text-xs font-bold text-muted-foreground mb-2 block">
                      Anteprima Live
                    </Label>
                    <div className="rounded-2xl border border-white/5 bg-zinc-950/60 p-5 space-y-4 h-[calc(100%-1.75rem)]">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-10 w-10 rounded-xl shrink-0"
                          style={{ backgroundColor: isValidHex ? globalTheme : "#3f3f46" }}
                        />
                        <div>
                          <p className="text-sm font-black text-foreground leading-none">
                            FranzPLAY
                          </p>
                          <p
                            className="text-xs font-bold mt-1"
                            style={{ color: isValidHex ? globalTheme : undefined }}
                          >
                            Accento testo
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="w-full py-2.5 rounded-xl text-white font-bold text-sm shadow-lg"
                        style={{
                          backgroundColor: isValidHex ? globalTheme : "#3f3f46",
                          boxShadow: isValidHex ? `0 8px 24px ${globalTheme}33` : "none",
                        }}
                      >
                        Bottone Primario
                      </button>

                      <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: "65%",
                            backgroundColor: isValidHex ? globalTheme : "#3f3f46",
                          }}
                        />
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full"
                          style={{
                            color: isValidHex ? globalTheme : undefined,
                            backgroundColor: isValidHex ? `${globalTheme}1f` : "#27272a",
                          }}
                        >
                          Badge
                        </span>
                        <div
                          className="h-6 w-6 rounded-full border-2"
                          style={{ borderColor: isValidHex ? globalTheme : "#3f3f46" }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t border-white/5">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setGlobalTheme("#dc2626")}
                    className="text-muted-foreground hover:text-foreground font-bold gap-2"
                  >
                    <RotateCcw size={15} /> Ripristina default
                  </Button>
                  <Button
                    type="submit"
                    disabled={isThemeSaving || !isValidHex}
                    className="font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20"
                  >
                    {isThemeSaving ? "Salvataggio..." : "Salva Tema Globale"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </motion.div>
  );
}
