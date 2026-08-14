import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  HardDrive,
  Database,
  Activity,
  Clock,
  Film,
  Sparkles,
  Users,
  FolderTree,
  MessageSquare,
  Captions,
  ImageDown,
  Loader2,
  Zap,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Gauge,
  Inbox,
  ShieldCheck,
  ServerCrash,
  LayoutDashboard,
} from "lucide-react";
import { apiRequest } from "../../services/api";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  PageShell,
  PageHeader,
  Panel,
  PanelHeader,
  PanelBody,
  Section,
  EmptyState,
} from "@/components/ui/layout";
import { StatTile, StatusChip, Callout } from "@/components/ui/data-display";

/**
 * ============================================================================
 * Admin > Dashboard — stato del sito a colpo d'occhio
 * ============================================================================
 *
 * FILOSOFIA DELLA PAGINA:
 * Una dashboard non serve a mostrare tutti i numeri che abbiamo: serve a far
 * capire in tre secondi se c'e' qualcosa da fare. Per questo l'ordine e':
 *
 *   1. "Da sistemare"      -> SOLO cio' che richiede un intervento, con il link
 *                             diretto alla pagina che lo risolve. Se non c'e'
 *                             nulla lo dice, invece di restare vuota.
 *   2. "Cosa c'e' nel sito" -> inventario dei contenuti, riquadri cliccabili.
 *   3. "Lavori automatici"  -> cosa stanno facendo i processi in background.
 *   4. "Sistema"            -> disco, database, cache.
 *
 * Le impostazioni (logo, colore, registrazioni) NON stanno piu' qui: vivono in
 * Admin > Impostazioni. Erano configurazioni che si toccano una volta ogni
 * tanto e allungavano la pagina senza aggiungere informazione.
 *
 * Come Admin > Copertine, questa pagina non usa misure ne' colori arbitrari:
 * tutto viene da components/ui/layout.jsx e data-display.jsx.
 * ============================================================================
 */

export default function AdminDashboard() {
  useDocumentTitle("Dashboard Admin");

  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [aggiornando, setAggiornando] = useState(false);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const caricaStats = useCallback(async (silenzioso = false) => {
    if (!silenzioso) setAggiornando(true);
    try {
      const res = await apiRequest("/admin.php", "POST", { action: "stato_server" });
      if (res.success) setStats(res.data || res.dati);
    } catch (error) {
      console.error("Errore lettura stato server:", error);
    } finally {
      setLoading(false);
      setAggiornando(false);
    }
  }, []);

  useEffect(() => {
    caricaStats(true);
  }, [caricaStats]);

  // ---------------------------------------------------------------- caricamento
  if (loading) {
    return (
      <PageShell>
        <div className="h-12 w-64 animate-pulse rounded-xl bg-surface-2" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-surface-2" />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-surface-2" />
          ))}
        </div>
      </PageShell>
    );
  }

  if (!stats) {
    return (
      <PageShell>
        <Panel>
          <PanelBody>
            <EmptyState
              icon={ServerCrash}
              title="Impossibile leggere lo stato del server"
              description="Il backend non ha risposto. Controlla che i container siano attivi."
            />
            <div className="flex justify-center">
              <Button onClick={() => caricaStats()} className="font-bold">
                <RefreshCw size={15} className="mr-2" /> Riprova
              </Button>
            </div>
          </PanelBody>
        </Panel>
      </PageShell>
    );
  }

  // ---------------------------------------------------------------- derivati
  const totaleVideo = stats.video_totali || 0;
  const percOttimizzati = totaleVideo
    ? Math.round(((stats.video_ottimizzati || 0) / totaleVideo) * 100)
    : 0;
  const discoPerc = stats.disco_percentuale || 0;
  const discoCritico = discoPerc >= 90;
  const discoAvviso = discoPerc >= 75 && !discoCritico;

  // Lista costruita dinamicamente: se resta vuota mostriamo "tutto a posto".
  const attenzioni = [];

  if (discoCritico || discoAvviso) {
    attenzioni.push({
      key: "disco",
      icon: HardDrive,
      tone: discoCritico ? "danger" : "warning",
      valore: `${discoPerc}%`,
      titolo: discoCritico ? "Disco quasi pieno" : "Il disco si sta riempiendo",
      spiegazione: `Restano ${stats.disco_libero_gb} GB liberi su ${stats.disco_totale_gb} GB. Quando lo spazio finisce, i nuovi video non vengono più elaborati.`,
    });
  }
  if ((stats.copertine_online_da_confermare || 0) > 0) {
    attenzioni.push({
      key: "conferme",
      icon: ImageDown,
      tone: "accent",
      valore: stats.copertine_online_da_confermare,
      titolo: "Copertine da confermare",
      spiegazione:
        "Sono state trovate delle copertine online, ma la somiglianza non è abbastanza alta per applicarle da sole. Serve una tua conferma.",
      link: "/admin/covers",
      testoLink: "Vai a confermarle",
    });
  }
  if ((stats.copertine_online_errore || 0) > 0) {
    attenzioni.push({
      key: "erroriCover",
      icon: AlertTriangle,
      tone: "danger",
      valore: stats.copertine_online_errore,
      titolo: "Ricerche copertina fallite",
      spiegazione:
        "Dopo più tentativi la ricerca non è riuscita. Di solito è un problema di rete o un nome file poco riconoscibile.",
      link: "/admin/covers",
      testoLink: "Vedi i dettagli",
    });
  }
  if ((stats.asset_mancanti || 0) > 0) {
    attenzioni.push({
      key: "asset",
      icon: Sparkles,
      tone: "warning",
      valore: stats.asset_mancanti,
      titolo: "Video senza copertina o anteprima",
      spiegazione:
        "Vengono generate da sole in background. Se il numero non scende da tempo, il processo potrebbe essersi fermato.",
      link: "/admin/videos",
      testoLink: "Vedi i video",
    });
  }
  if (stats.sessioni_su_file) {
    attenzioni.push({
      key: "redis",
      icon: Zap,
      tone: "warning",
      valore: "Cache",
      titolo: "Cache non disponibile",
      spiegazione:
        "Il sito funziona ma è più lento: le pagine vengono ricalcolate ogni volta invece di essere riusate. Controlla il container della cache.",
    });
  }

  const tuttoAPosto = attenzioni.length === 0;

  return (
    <PageShell>
      <PageHeader
        icon={LayoutDashboard}
        title="Dashboard"
        description="Lo stato di FranzPLAY in un colpo d'occhio."
        actions={
          <div className="flex items-center gap-2">
            <StatusChip
              label={tuttoAPosto ? "Tutto regolare" : "Richiede attenzione"}
              icon={tuttoAPosto ? CheckCircle2 : AlertTriangle}
              tone={tuttoAPosto ? "success" : "warning"}
            />
            <StatusChip label={now.toLocaleTimeString("it-IT")} icon={Clock} tone="neutral" />
            <Button
              variant="outline"
              size="sm"
              onClick={() => caricaStats()}
              disabled={aggiornando}
              className="font-bold"
            >
              <RefreshCw size={14} className={`mr-1.5 ${aggiornando ? "animate-spin" : ""}`} />
              Aggiorna
            </Button>
          </div>
        }
      />

      {/* ---------------- 1. DA SISTEMARE ---------------- */}
      <Section
        icon={AlertTriangle}
        title="Da sistemare"
        description="Solo le cose che richiedono una tua azione. Se è vuoto, non c'è nulla da fare."
      >
        {tuttoAPosto ? (
          <Callout icon={CheckCircle2} tone="success" title="Non c'è nulla in sospeso">
            Spazio su disco a posto, nessuna copertina da confermare, nessun errore
            da controllare.
          </Callout>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {attenzioni.map((a) => (
              <Callout key={a.key} icon={a.icon} tone={a.tone} title={a.titolo}>
                <p className="text-2xl font-black leading-none text-foreground">
                  {a.valore}
                </p>
                <p className="mt-2">{a.spiegazione}</p>
                {a.link && (
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="mt-2 justify-start px-0 font-bold"
                  >
                    <Link to={a.link}>
                      {a.testoLink} <ArrowRight size={14} className="ml-1.5" />
                    </Link>
                  </Button>
                )}
              </Callout>
            ))}
          </div>
        )}
      </Section>

      {/* ---------------- 2. COSA C'È NEL SITO ---------------- */}
      <Section
        icon={Film}
        title="Cosa c'è nel sito"
        description="I contenuti presenti adesso. Clicca un riquadro per aprire la sezione corrispondente."
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <Link to="/admin/videos">
            <StatTile
              icon={Film}
              tone="primary"
              label="Video"
              value={totaleVideo}
              hint={`${percOttimizzati}% pronti per tutti i dispositivi`}
            />
          </Link>
          <Link to="/admin/categories">
            <StatTile
              icon={FolderTree}
              tone="success"
              label="Categorie"
              value={stats.categorie_totali || 0}
              hint="Una per cartella sul disco"
            />
          </Link>
          <Link to="/admin/users">
            <StatTile
              icon={Users}
              tone="info"
              label="Utenti"
              value={stats.utenti_totali || 0}
              hint={`di cui ${stats.utenti_admin || 0} amministratori`}
            />
          </Link>
          <Link to="/admin/subtitles">
            <StatTile
              icon={Captions}
              tone="accent"
              label="Sottotitoli"
              value={stats.sottotitoli_totali || 0}
              hint="Pronti da guardare"
            />
          </Link>
          <Link to="/admin/covers">
            <StatTile
              icon={ImageDown}
              tone="info"
              label="Copertine online"
              value={stats.copertine_online_applicate || 0}
              hint="Scaricate dai database esterni"
            />
          </Link>
          <StatTile
            icon={MessageSquare}
            tone="neutral"
            label="Commenti"
            value={stats.commenti_totali || 0}
            hint="Scritti dagli utenti"
          />
        </div>
      </Section>

      {/* ---------------- 3. LAVORI AUTOMATICI ---------------- */}
      <Section
        icon={Zap}
        title="Lavori automatici"
        description="Cosa stanno facendo i processi in background. Questi numeri scendono da soli col tempo."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <StatTile
            icon={Inbox}
            tone="info"
            label="In arrivo"
            value={stats.video_in_ingestione || 0}
            hint={
              (stats.video_in_ingestione || 0) === 0
                ? "Nessun file nuovo da elaborare."
                : "File appena copiati, in attesa di entrare nel catalogo."
            }
          />
          <StatTile
            icon={Loader2}
            tone="warning"
            label="Da ottimizzare"
            value={stats.video_da_analizzare || 0}
            hint="Non ancora resi compatibili con iPhone e riproduzione immediata."
          />
          <StatTile
            icon={Captions}
            tone="accent"
            label="Sottotitoli in coda"
            value={stats.sottotitoli_in_coda || 0}
            hint={
              (stats.sottotitoli_in_coda || 0) === 0
                ? "Nessuna generazione richiesta."
                : "Generazione in corso: può richiedere parecchi minuti per video."
            }
          />
        </div>
      </Section>

      {/* ---------------- 4. SISTEMA ---------------- */}
      <Section
        icon={Gauge}
        title="Sistema"
        description="Spazio, database e cache: la salute della macchina che regge il sito."
      >
        <Panel>
          <PanelHeader
            title="Spazio su disco"
            description={`${stats.disco_libero_gb} GB ancora liberi su ${stats.disco_totale_gb} GB totali.`}
            actions={
              <StatusChip
                label={`${discoPerc}% usato`}
                tone={discoCritico ? "danger" : discoAvviso ? "warning" : "success"}
              />
            }
          />
          <PanelBody>
            <Progress value={discoPerc} className="h-2" />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <StatTile
                icon={Database}
                tone="success"
                label="Database"
                value="Connesso"
                hint={`MariaDB ${stats.db_version}`}
              />
              <StatTile
                icon={stats.redis_attivo ? ShieldCheck : AlertTriangle}
                tone={stats.redis_attivo ? "success" : "warning"}
                label="Cache"
                value={stats.redis_attivo ? "Attiva" : "Non attiva"}
                hint={
                  stats.redis_attivo
                    ? "Le pagine più viste vengono riusate: navigazione più rapida."
                    : "Il sito funziona lo stesso, ma più lentamente."
                }
              />
            </div>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Activity size={13} />
              Caricamento massimo per file: {stats.php_upload_max} · i valori si
              aggiornano a ogni ricarica della pagina.
            </p>
          </PanelBody>
        </Panel>
      </Section>
    </PageShell>
  );
}
