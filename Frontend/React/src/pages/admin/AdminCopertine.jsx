import React, { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "../../services/api";
import { getAssetUrl, hasAsset } from "../../services/helpers";
import ThumbnailPlaceholder from "../../components/ThumbnailPlaceholder";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  Globe,
  Hand,
  HelpCircle,
  Image as ImageIcon,
  Key,
  Layers,
  Loader2,
  Play,
  Power,
  RefreshCw,
  Search,
  ShieldCheck,
  Undo2,
  Wifi,
  X,
  XCircle,
  Zap,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ModalShell } from "@/components/ui/modal-shell";
import {
  PageShell,
  PageHeader,
  Panel,
  PanelHeader,
  PanelBody,
  Section,
  EmptyState,
} from "@/components/ui/layout";
import {
  StatusChip,
  OptionCardGroup,
  FieldRow,
  Field,
  Callout,
} from "@/components/ui/data-display";
import { toast } from "sonner";

/**
 * ============================================================================
 * Admin > Copertine — PAGINA DI RIFERIMENTO DEL DESIGN SYSTEM
 * ============================================================================
 * Questa pagina non contiene NESSUNA misura arbitraria: niente text-[10px],
 * niente bg-zinc-900/40, niente border-white/5. Tutto viene da
 * components/ui/layout.jsx e data-display.jsx.
 *
 * Se una schermata richiede qualcosa che qui non si riesce a comporre, il
 * pezzo mancante va aggiunto al design system, non scritto in linea.
 * ============================================================================
 */

/** Stati della coda -> pastiglia condivisa (icona + tono del design system). */
const STATI = {
  in_coda: { label: "In coda", icon: Clock, tone: "info" },
  elaborazione: { label: "In corso", icon: Loader2, tone: "warning", spin: true },
  da_confermare: { label: "Da confermare", icon: AlertCircle, tone: "accent" },
  applicato: { label: "Applicata", icon: CheckCircle2, tone: "success" },
  nessun_match: { label: "Nessun risultato", icon: XCircle, tone: "neutral" },
  errore: { label: "Errore", icon: XCircle, tone: "danger" },
  ignorato: { label: "Escluso", icon: Hand, tone: "neutral" },
};

const ORIGINI = {
  online: { label: "Online", icon: Globe, tone: "info" },
  manuale: { label: "Da file", icon: Hand, tone: "accent" },
  ffmpeg: { label: "Dal video", icon: Play, tone: "neutral" },
};

const proxyUrl = (url) =>
  `/api/admin.php?action=proxy_immagine_online&url=${encodeURIComponent(url)}`;

/** Traduce la soglia numerica in una frase comprensibile. */
function descriviSoglia(v) {
  const n = Number(v);
  if (n >= 90) return { testo: "Molto prudente — quasi tutto passa da conferma", tono: "text-sky-400" };
  if (n >= 70) return { testo: "Equilibrato — applica solo i risultati affidabili", tono: "text-emerald-400" };
  if (n >= 50) return { testo: "Permissivo — qualche copertina sbagliata è probabile", tono: "text-amber-400" };
  return { testo: "Molto permissivo — sconsigliato, applica quasi tutto", tono: "text-destructive" };
}

function GrigliaCandidati({ candidati, onScegli, inCorso }) {
  if (!candidati || candidati.length === 0) {
    return (
      <EmptyState
        icon={ImageIcon}
        title="Nessun risultato disponibile"
        description="Per questo video il database non ha restituito copertine utilizzabili."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {candidati.map((c, i) => (
        <button
          key={c.id || i}
          type="button"
          disabled={inCorso}
          onClick={() => onScegli(c, i)}
          className="group overflow-hidden rounded-xl border border-hairline bg-surface-2 text-left transition-all hover:border-primary/60 disabled:opacity-50"
        >
          <div className="relative aspect-video bg-surface-3">
            {c.image_url ? (
              <img
                src={proxyUrl(c.image_url)}
                alt={c.title}
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <ImageIcon size={28} />
              </div>
            )}
            {typeof c.score === "number" && (
              <span className="absolute right-2 top-2">
                <StatusChip
                  label={`${c.score}%`}
                  tone={c.score >= 85 ? "success" : c.score >= 70 ? "warning" : "neutral"}
                />
              </span>
            )}
          </div>
          <div className="p-4">
            <p className="line-clamp-2 text-sm font-bold text-foreground">{c.title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {[c.site, c.date].filter(Boolean).join(" · ")}
            </p>
            {c.performers?.length > 0 && (
              <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                {c.performers.join(", ")}
              </p>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}

export default function AdminCopertine() {
  useDocumentTitle("Copertine · Admin");

  const [config, setConfig] = useState(null);
  const [categorie, setCategorie] = useState([]);
  const [coda, setCoda] = useState([]);
  const [conteggi, setConteggi] = useState({});
  const [caricamento, setCaricamento] = useState(true);
  const [salvataggio, setSalvataggio] = useState(false);
  const [modificato, setModificato] = useState(false);
  // testInCorso contiene l'id del provider in prova (null = nessuna prova):
  // cosi' lo spinner compare solo sulla riga giusta.
  const [testInCorso, setTestInCorso] = useState(null);
  const [esitoTest, setEsitoTest] = useState(null);
  // Token digitati ma non ancora salvati, uno per provider.
  const [tokenBozza, setTokenBozza] = useState({});
  const [azioneInCorso, setAzioneInCorso] = useState(false);
  const [avanzateAperte, setAvanzateAperte] = useState(false);
  // Guida "come ottengo la chiave" aperta, per provider.
  const [guidaAperta, setGuidaAperta] = useState({});
  const [jobAperto, setJobAperto] = useState(null);

  // --- Libreria copertine (endpoint stato_copertine) ---
  // La sezione "Coda" mostra solo i job NON conclusi: i video in stato
  // applicato / nessun_match / ignorato non comparivano da nessuna parte,
  // quindi da questa pagina non si poteva rivedere una copertina applicata,
  // ripristinare il frame ffmpeg o riaccodare un "nessun match". L'azione
  // stato_copertine esisteva gia' nel backend ma nessuna pagina la chiamava.
  const LIBRERIA_PAGINA = 24;
  const [libreria, setLibreria] = useState([]);
  const [filtroLib, setFiltroLib] = useState("tutti");
  const [ricercaLib, setRicercaLib] = useState("");
  const [offsetLib, setOffsetLib] = useState(0);
  const [caricamentoLib, setCaricamentoLib] = useState(false);

  const pollingRef = useRef(null);

  const caricaConfig = useCallback(async () => {
    try {
      const res = await apiRequest("/admin.php", "POST", { action: "copertine_impostazioni" });
      setConfig(res.dati);
      setModificato(false);
    } catch (e) {
      toast.error("Impossibile caricare la configurazione: " + e.message);
    }
  }, []);

  const caricaCategorie = useCallback(async () => {
    try {
      const res = await apiRequest("/admin.php", "POST", { action: "lista_categorie" });
      setCategorie(res.dati || res.data || []);
    } catch {
      /* non bloccante */
    }
  }, []);

  const caricaLibreria = useCallback(async () => {
    setCaricamentoLib(true);
    try {
      const res = await apiRequest("/admin.php", "POST", {
        action: "stato_copertine",
        filtro: filtroLib,
        query: ricercaLib,
        limit: LIBRERIA_PAGINA,
        offset: offsetLib,
      });
      setLibreria(res.dati || []);
    } catch (e) {
      console.error("Libreria copertine:", e);
    } finally {
      setCaricamentoLib(false);
    }
  }, [filtroLib, ricercaLib, offsetLib]);

  // Cambiando filtro o testo si riparte da pagina 1: restare a un offset alto
  // su un risultato piu' corto mostrerebbe una lista vuota. Il reset sta negli
  // handler e non in un useEffect, per non innescare un render a cascata.
  const cambiaFiltroLib = (valore) => {
    setFiltroLib(valore);
    setOffsetLib(0);
  };
  const cambiaRicercaLib = (valore) => {
    setRicercaLib(valore);
    setOffsetLib(0);
  };

  const caricaCoda = useCallback(async () => {
    try {
      const res = await apiRequest("/admin.php", "POST", { action: "coda_copertine" });
      setCoda(res.dati || []);
      setConteggi(res.conteggi || {});
    } catch (e) {
      console.error("Coda copertine:", e);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setCaricamento(true);
      await Promise.all([caricaConfig(), caricaCategorie(), caricaCoda()]);
      setCaricamento(false);
    })();
  }, [caricaConfig, caricaCategorie, caricaCoda]);

  useEffect(() => {
    const t = setTimeout(caricaLibreria, 300);
    return () => clearTimeout(t);
  }, [caricaLibreria]);

  // Il polling si ferma da solo quando la coda e' ferma: su hardware limitato
  // non ha senso tenere sveglio il backend per niente.
  useEffect(() => {
    const inMovimento = (conteggi.in_coda || 0) > 0 || (conteggi.elaborazione || 0) > 0;
    if (!inMovimento) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
      return;
    }
    if (pollingRef.current) return;
    pollingRef.current = setInterval(caricaCoda, 5000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
  }, [conteggi, caricaCoda]);

  const setCampo = (chiave, valore) => {
    setConfig((c) => ({ ...c, [chiave]: valore }));
    setModificato(true);
  };

  const salvaConfig = async () => {
    if (!config) return;
    setSalvataggio(true);
    try {
      const payload = { action: "salva_copertine_impostazioni" };
      [
        "copertine_online_abilitato",
        "copertine_online_provider",
        "copertine_online_modalita",
        "copertine_online_ambito",
        "copertine_online_sovrascrivi",
        "copertine_online_soglia_auto",
        "copertine_online_conferma_sempre",
        "copertine_online_categorie",
        "copertine_online_finestra",
        "copertine_online_max_giorno",
        "copertine_online_pausa_richieste",
        "copertine_online_max_tentativi",
        "copertine_online_priorita_ffmpeg",
        "copertine_online_attesa_max",
      ].forEach((k) => {
        payload[k] = config[k];
      });
      await apiRequest("/admin.php", "POST", payload);
      toast.success("Configurazione salvata");
      setModificato(false);
    } catch (e) {
      toast.error("Salvataggio fallito: " + e.message);
    } finally {
      setSalvataggio(false);
    }
  };

  /**
   * Salva attivazione e/o token di UN database.
   * Le modifiche ai provider sono immediate e non passano dal pulsante "Salva"
   * generale: sono azioni atomiche e indipendenti dal resto della
   * configurazione, e trattarle come modifiche in sospeso confonderebbe.
   */
  const salvaProvider = async (id, campi) => {
    setSalvataggio(true);
    try {
      await apiRequest("/admin.php", "POST", {
        action: "salva_provider",
        provider: id,
        ...campi,
      });
      if ("token" in campi) {
        toast.success(campi.token === "" ? "Token rimosso" : "Token salvato");
        setTokenBozza((t) => ({ ...t, [id]: "" }));
      } else {
        toast.success(campi.attivo === "1" ? "Database attivato" : "Database disattivato");
      }
      await caricaConfig();
    } catch (e) {
      toast.error("Salvataggio fallito: " + e.message);
    } finally {
      setSalvataggio(false);
    }
  };

  const testaConnessione = async (id) => {
    setTestInCorso(id);
    setEsitoTest(null);
    try {
      const res = await apiRequest("/admin.php", "POST", {
        action: "test_provider",
        provider: id,
      });
      setEsitoTest(res.dati);
      if (res.dati?.ok) toast.success("Connessione riuscita");
      else toast.error(res.dati?.messaggio || "Test fallito");
    } catch (e) {
      setEsitoTest({ provider: id, ok: false, messaggio: e.message });
    } finally {
      setTestInCorso(null);
    }
  };

  const accoda = async (payload, messaggio) => {
    setAzioneInCorso(true);
    try {
      const res = await apiRequest("/admin.php", "POST", {
        action: "accoda_copertina_online",
        ...payload,
      });
      toast.success(res.message || messaggio);
      await Promise.all([caricaCoda(), caricaLibreria()]);
    } catch (e) {
      toast.error("Accodamento fallito: " + e.message);
    } finally {
      setAzioneInCorso(false);
    }
  };

  const confermaCandidato = async (idMeta, indice) => {
    setAzioneInCorso(true);
    try {
      await apiRequest("/admin.php", "POST", {
        action: "conferma_copertina",
        id_meta: idMeta,
        indice_candidato: indice,
      });
      toast.success("Copertina applicata");
      setJobAperto(null);
      await Promise.all([caricaCoda(), caricaLibreria()]);
    } catch (e) {
      toast.error("Applicazione fallita: " + e.message);
    } finally {
      setAzioneInCorso(false);
    }
  };

  const ignoraVideo = async (idVideo) => {
    try {
      await apiRequest("/admin.php", "POST", { action: "ignora_copertina", id_video: idVideo });
      toast.success("Video escluso dalla ricerca online");
      await Promise.all([caricaCoda(), caricaLibreria()]);
    } catch (e) {
      toast.error(e.message);
    }
  };

  const ripristinaFfmpeg = async (idVideo) => {
    try {
      await apiRequest("/admin.php", "POST", {
        action: "ripristina_copertina_ffmpeg",
        id_video: idVideo,
      });
      toast.success("Copertina rimossa: verrà rigenerata dal video");
      await Promise.all([caricaCoda(), caricaLibreria()]);
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (caricamento || !config) {
    return (
      <PageShell>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-48 animate-pulse rounded-2xl border border-hairline bg-surface-1"
          />
        ))}
      </PageShell>
    );
  }

  const attivo = config.copertine_online_abilitato === "1";
  const automatico = config.copertine_online_modalita === "automatico";
  const confermaSempre = config.copertine_online_conferma_sempre === "1";
  const soglia = descriviSoglia(config.copertine_online_soglia_auto);

  const categorieSelezionate = (() => {
    try {
      const v = JSON.parse(config.copertine_online_categorie || "[]");
      return Array.isArray(v) ? v.map(Number) : [];
    } catch {
      return [];
    }
  })();

  const toggleCategoria = (id) => {
    const s = new Set(categorieSelezionate);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setCampo("copertine_online_categorie", JSON.stringify([...s]));
  };

  const riepilogo = (() => {
    if (!attivo) return "Il sistema è spento: non viene contattato alcun server esterno.";
    const dove =
      categorieSelezionate.length === 0
        ? "tutte le categorie"
        : `${categorieSelezionate.length} categoria/e selezionate`;
    const quando = config.copertine_online_finestra
      ? `tra le ${config.copertine_online_finestra}`
      : "in qualsiasi momento";
    const ambito = {
      senza_copertina: "solo i video senza copertina",
      solo_nuovi: "solo i video mai analizzati",
      tutti: "tutti i video",
    }[config.copertine_online_ambito];

    if (!automatico) {
      return `Cerco solo quando lo chiedi tu, dal pulsante nel singolo video o dalle azioni di massa.${
        confermaSempre ? " Ogni risultato aspetta la tua conferma." : ""
      }`;
    }
    if (confermaSempre) {
      return `Cerco da solo ${ambito} in ${dove}, ${quando}, ma non scarico nulla: ogni risultato aspetta la tua conferma.`;
    }
    return `Cerco da solo ${ambito} in ${dove}, ${quando}, e scarico la copertina quando la confidenza supera il ${config.copertine_online_soglia_auto}%. Sotto quella soglia chiedo conferma.`;
  })();

  return (
    <PageShell>
      <PageHeader
        icon={Download}
        title="Copertine online"
        description="Scarica le copertine dei video dai database esterni invece di usare un fotogramma."
        actions={Object.entries(conteggi)
          .filter(([stato, n]) => n > 0 && STATI[stato])
          .map(([stato, n]) => (
            <StatusChip
              key={stato}
              label={`${STATI[stato].label} · ${n}`}
              icon={STATI[stato].icon}
              tone={STATI[stato].tone}
              spin={STATI[stato].spin}
            />
          ))}
      />

      {/* ---------- Interruttore principale ---------- */}
      <Panel className={attivo ? "border-emerald-500/25" : undefined}>
        <PanelBody className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
                attivo ? "bg-emerald-500/15 text-emerald-400" : "bg-surface-3 text-muted-foreground"
              }`}
            >
              <Power size={20} />
            </span>
            <div>
              <p className="text-base font-black text-foreground">
                {attivo ? "Sistema attivo" : "Sistema spento"}
              </p>
              <p className="mt-0.5 max-w-xl text-sm leading-relaxed text-muted-foreground">
                {attivo
                  ? "Le ricerche sono consentite secondo le regole impostate qui sotto."
                  : "Nessuna connessione verso l'esterno. Il comportamento è identico a prima dell'installazione del modulo."}
              </p>
            </div>
          </div>
          <Switch
            checked={attivo}
            onCheckedChange={(v) => setCampo("copertine_online_abilitato", v ? "1" : "0")}
          />
        </PanelBody>
      </Panel>

      <Callout icon={Zap} title="Cosa farà il sistema" tone="primary">
        {riepilogo}
      </Callout>

      {/* ---------- Configurazione ---------- */}
      <Panel>
        <PanelHeader
          title="Configurazione"
          actions={
            <>
              {modificato && (
                <span className="text-sm font-bold text-amber-400">Modifiche non salvate</span>
              )}
              <Button onClick={salvaConfig} disabled={salvataggio || !modificato}>
                {salvataggio && <Loader2 size={15} className="mr-2 animate-spin" />}
                Salva
              </Button>
            </>
          }
        />
        <PanelBody className={attivo ? undefined : "pointer-events-none opacity-40"}>
          {/* ------------------------------------------------------------
              DATABASE ONLINE
              Elenco dei provider configurabili. Ognuno ha interruttore,
              token e prova di connessione indipendenti. L'ordine in cui
              compaiono e' l'ordine in cui vengono interrogati: il worker si
              ferma al primo che trova un risultato convincente.
              ------------------------------------------------------------ */}
          <Section
            icon={Key}
            title="Database online"
            description="Vengono interrogati nell'ordine mostrato, finché uno non trova un risultato convincente. I token restano sul server: al browser arriva solo una versione mascherata."
          >
            <div className="space-y-3">
              {(config.providers || []).map((p, indice) => (
                <div
                  key={p.id}
                  className={`rounded-xl border p-4 transition-colors ${
                    p.attivo
                      ? "border-hairline-strong bg-surface-3"
                      : "border-hairline bg-surface-2 opacity-70"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-black text-primary">
                        {indice + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-foreground">{p.etichetta}</p>
                        <p className="text-sm text-muted-foreground">{p.contenuti}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.attivo && !p.utilizzabile && (
                        <StatusChip label="Token mancante" icon={AlertCircle} tone="warning" />
                      )}
                      <Switch
                        checked={!!p.attivo}
                        onCheckedChange={(v) => salvaProvider(p.id, { attivo: v ? "1" : "0" })}
                      />
                    </div>
                  </div>

                  {p.attivo && (
                    <div className="mt-4 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type="password"
                          value={tokenBozza[p.id] ?? ""}
                          onChange={(e) =>
                            setTokenBozza((t) => ({ ...t, [p.id]: e.target.value }))
                          }
                          placeholder={
                            p.token_configurato
                              ? `Attuale: ${p.token_masked} — scrivi per sostituirlo`
                              : p.token_obbligatorio
                                ? "Token obbligatorio"
                                : "Token (facoltativo)"
                          }
                          className="min-w-[240px] flex-1"
                        />
                        <Button
                          variant="secondary"
                          disabled={salvataggio || (tokenBozza[p.id] ?? "") === ""}
                          onClick={() =>
                            salvaProvider(p.id, { token: tokenBozza[p.id] ?? "" })
                          }
                        >
                          Salva token
                        </Button>
                        <Button
                          variant="outline"
                          disabled={testInCorso === p.id}
                          onClick={() => testaConnessione(p.id)}
                        >
                          {testInCorso === p.id ? (
                            <Loader2 size={15} className="mr-1.5 animate-spin" />
                          ) : (
                            <Wifi size={15} className="mr-1.5" />
                          )}
                          Prova
                        </Button>
                      </div>

                      <p className="text-sm text-muted-foreground">{p.nota}</p>

                      {/* ----------------------------------------------------
                          GUIDA PASSO PASSO
                          Ottenere una chiave API non è ovvio — su YouTube il
                          passaggio dell'abilitazione dell'API è quello in cui
                          ci si blocca più spesso. I passi arrivano dal catalogo
                          PHP, così ogni provider documenta il proprio percorso.
                          ---------------------------------------------------- */}
                      {p.guida?.length > 0 && (
                        <div className="rounded-xl border border-hairline bg-surface-2">
                          <button
                            type="button"
                            onClick={() =>
                              setGuidaAperta((g) => ({ ...g, [p.id]: !g[p.id] }))
                            }
                            className="flex w-full items-center justify-between gap-3 p-3 text-left"
                          >
                            <span className="flex items-center gap-2 text-sm font-bold text-foreground">
                              <HelpCircle size={15} className="text-primary" />
                              Come ottengo la chiave di {p.etichetta}?
                            </span>
                            <ChevronDown
                              size={16}
                              className={`shrink-0 text-muted-foreground transition-transform ${
                                guidaAperta[p.id] ? "rotate-180" : ""
                              }`}
                            />
                          </button>

                          {guidaAperta[p.id] && (
                            <div className="space-y-3 border-t border-hairline p-4">
                              <ol className="space-y-2.5">
                                {p.guida.map((passo, i) => (
                                  <li key={i} className="flex gap-3">
                                    <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-black text-primary">
                                      {i + 1}
                                    </span>
                                    <span className="text-sm leading-relaxed text-foreground/90">
                                      {passo}
                                    </span>
                                  </li>
                                ))}
                              </ol>

                              {p.guida_nota && (
                                <Callout icon={Zap} tone="info">
                                  {p.guida_nota}
                                </Callout>
                              )}

                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  window.open(p.url_token, "_blank", "noopener,noreferrer")
                                }
                              >
                                <ExternalLink size={14} className="mr-1.5" />
                                Apri la pagina per ottenere la chiave
                              </Button>
                            </div>
                          )}
                        </div>
                      )}

                      {esitoTest?.provider === p.id && (
                        <Callout
                          icon={esitoTest.ok ? CheckCircle2 : XCircle}
                          tone={esitoTest.ok ? "success" : "danger"}
                        >
                          {esitoTest.messaggio}
                          {esitoTest.latenza_ms != null && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {esitoTest.latenza_ms} ms
                            </span>
                          )}
                        </Callout>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>

          <Section
            icon={Layers}
            title="Quando cercare"
            description="Decide se il sistema lavora da solo o solo su tuo comando."
          >
            <OptionCardGroup
              value={config.copertine_online_modalita}
              onChange={(v) => setCampo("copertine_online_modalita", v)}
              options={[
                {
                  value: "manuale",
                  title: "Manuale",
                  description:
                    "Non parte nulla da solo. Usi il pulsante nel singolo video o le azioni di massa.",
                },
                {
                  value: "automatico",
                  title: "Automatica",
                  description:
                    "Il sistema cerca da solo, rispettando i limiti impostati qui sotto.",
                },
              ]}
            />

            {automatico && (
              <div className="mt-4 space-y-4 rounded-xl border border-hairline bg-surface-3 p-4">
                <Field label="Su quali video">
                  <OptionCardGroup
                    columns={3}
                    value={config.copertine_online_ambito}
                    onChange={(v) => setCampo("copertine_online_ambito", v)}
                    options={[
                      { value: "senza_copertina", title: "Senza copertina", description: "Solo quelli che non ne hanno" },
                      { value: "solo_nuovi", title: "Mai analizzati", description: "Solo i video nuovi" },
                      { value: "tutti", title: "Tutta la libreria", description: "Anche quelli già a posto" },
                    ]}
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Fascia oraria"
                    hint="Vuoto = sempre. I comandi manuali partono comunque subito."
                  >
                    <Input
                      value={config.copertine_online_finestra}
                      onChange={(e) => setCampo("copertine_online_finestra", e.target.value)}
                      placeholder="02:00-06:00"
                    />
                  </Field>
                  <Field label="Categorie incluse" hint="Nessuna selezionata = tutte.">
                    <div className="flex flex-wrap gap-1.5">
                      {categorie.length === 0 && (
                        <span className="text-sm text-muted-foreground">Nessuna categoria.</span>
                      )}
                      {categorie.map((cat) => {
                        const sel = categorieSelezionate.includes(Number(cat.id));
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => toggleCategoria(Number(cat.id))}
                            className={`rounded-lg border px-2.5 py-1 text-sm font-bold transition-all ${
                              sel
                                ? "border-primary/50 bg-primary/20 text-foreground"
                                : "border-hairline bg-surface-2 text-muted-foreground hover:border-hairline-strong"
                            }`}
                          >
                            {sel && <Check size={10} className="mr-1 inline" />}
                            {cat.Nome}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </div>
              </div>
            )}
          </Section>

          <Section
            icon={ShieldCheck}
            title="Quanto fidarsi dei risultati"
            description="Il punteggio di confidenza confronta titolo, studio, data e durata."
          >
            <div className="space-y-3">
              <FieldRow
                title="Chiedi sempre conferma"
                description="Nessun download automatico: ogni risultato resta in attesa della tua approvazione. È il modo più sicuro per iniziare."
                control={
                  <Switch
                    checked={confermaSempre}
                    onCheckedChange={(v) =>
                      setCampo("copertine_online_conferma_sempre", v ? "1" : "0")
                    }
                  />
                }
              />

              <div
                className={`rounded-xl border border-hairline bg-surface-2 p-4 ${
                  confermaSempre ? "opacity-40" : ""
                }`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-bold text-foreground">
                    Soglia di applicazione automatica
                  </p>
                  <span className="text-xl font-black text-foreground">
                    {config.copertine_online_soglia_auto}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  disabled={confermaSempre}
                  value={config.copertine_online_soglia_auto}
                  onChange={(e) => setCampo("copertine_online_soglia_auto", e.target.value)}
                  className="mt-3 h-2 w-full cursor-pointer appearance-none rounded-full bg-surface-3 accent-[var(--primary-color)] disabled:cursor-not-allowed"
                />
                <div className="mt-1.5 flex justify-between text-xs font-black uppercase text-muted-foreground">
                  <span>Permissivo</span>
                  <span>Prudente</span>
                </div>
                <p className={`mt-2 text-sm font-bold ${soglia.tono}`}>{soglia.testo}</p>
              </div>

              <FieldRow
                title="Sostituisci le copertine esistenti"
                description="Rimpiazza anche i fotogrammi già estratti dal video. Le copertine caricate a mano non vengono mai toccate, in nessun caso."
                control={
                  <Switch
                    checked={config.copertine_online_sovrascrivi === "1"}
                    onCheckedChange={(v) =>
                      setCampo("copertine_online_sovrascrivi", v ? "1" : "0")
                    }
                  />
                }
              />
            </div>
          </Section>

          {/* ---------- Avanzate ---------- */}
          <div className="rounded-xl border border-hairline bg-surface-2">
            <button
              type="button"
              onClick={() => setAvanzateAperte((v) => !v)}
              className="flex w-full items-center justify-between gap-3 p-4 text-left"
            >
              <div>
                <h3 className="text-xs font-black uppercase text-foreground/80">
                  Opzioni avanzate
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Limiti tecnici e ordine di generazione. I valori predefiniti vanno bene
                  nella maggior parte dei casi.
                </p>
              </div>
              <ChevronDown
                size={18}
                className={`shrink-0 text-muted-foreground transition-transform ${
                  avanzateAperte ? "rotate-180" : ""
                }`}
              />
            </button>

            {avanzateAperte && (
              <div className="space-y-4 border-t border-hairline p-4">
                <Field label="Ordine di generazione">
                  <OptionCardGroup
                    value={config.copertine_online_priorita_ffmpeg}
                    onChange={(v) => setCampo("copertine_online_priorita_ffmpeg", v)}
                    options={[
                      {
                        value: "1",
                        title: "Fotogramma subito (consigliato)",
                        description:
                          "Il video ha una copertina immediata, sostituita quando arriva quella online.",
                      },
                      {
                        value: "0",
                        title: "Attendi l'esito online",
                        description:
                          "Nessun fotogramma provvisorio. Se il provider non risponde si procede dopo l'attesa massima.",
                      },
                    ]}
                  />
                </Field>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {[
                    ["copertine_online_max_giorno", "Richieste al giorno", "0 = illimitato"],
                    ["copertine_online_pausa_richieste", "Pausa tra richieste", "secondi"],
                    ["copertine_online_max_tentativi", "Tentativi max", "prima di arrendersi"],
                    ["copertine_online_attesa_max", "Attesa massima", "minuti"],
                  ].map(([chiave, etichetta, nota]) => (
                    <Field key={chiave} label={etichetta} hint={nota}>
                      <Input
                        type="number"
                        min="0"
                        value={config[chiave]}
                        onChange={(e) => setCampo(chiave, e.target.value)}
                      />
                    </Field>
                  ))}
                </div>
              </div>
            )}
          </div>
        </PanelBody>
      </Panel>

      {/* ---------- Azioni di massa ---------- */}
      <Panel>
        <PanelHeader
          title="Avvia una ricerca"
          description={attivo ? undefined : "Attiva il sistema per usare queste azioni."}
        />
        <PanelBody className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={!attivo || azioneInCorso}
            onClick={() => accoda({ filtro: "senza_copertina" }, "Accodati")}
          >
            <Search size={15} className="mr-1.5" />
            Solo i video senza copertina
          </Button>
          <Button
            variant="outline"
            disabled={!attivo || azioneInCorso}
            onClick={() => accoda({ filtro: "tutti" }, "Accodata tutta la libreria")}
          >
            <RefreshCw size={15} className="mr-1.5" />
            Tutta la libreria
          </Button>
        </PanelBody>
      </Panel>

      {/* ---------- Coda ---------- */}
      <Panel>
        <PanelHeader
          title="Coda e proposte"
          actions={
            <Button variant="ghost" size="sm" onClick={caricaCoda}>
              <RefreshCw size={15} className="mr-1.5" />
              Aggiorna
            </Button>
          }
        />
        <PanelBody>
          {coda.length === 0 ? (
            <EmptyState
              icon={ImageIcon}
              title="Nessun lavoro in corso"
              description="Le copertine già applicate si vedono nella pagina Video."
            />
          ) : (
            <div className="space-y-2">
              {coda.map((r) => {
                const st = STATI[r.stato];
                const or = ORIGINI[r.copertina_origine];
                return (
                  <div
                    key={r.id_meta}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-surface-2 p-3"
                  >
                    <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-surface-3">
                      {hasAsset(r.percorso_copertina) ? (
                        <img
                          src={getAssetUrl(r.percorso_copertina)}
                          alt=""
                          className="absolute inset-0 h-full w-full object-cover"
                        />
                      ) : (
                        <ThumbnailPlaceholder title={r.Titolo} />
                      )}
                    </div>

                    <div className="min-w-[200px] flex-1">
                      <p className="line-clamp-1 text-sm font-bold text-foreground">
                        {r.Titolo}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {st && (
                          <StatusChip
                            label={st.label}
                            icon={st.icon}
                            tone={st.tone}
                            spin={st.spin}
                          />
                        )}
                        {or && <StatusChip label={or.label} icon={or.icon} tone={or.tone} />}
                        {r.Nome_Categoria && (
                          <span className="text-sm text-muted-foreground">
                            {r.Nome_Categoria}
                          </span>
                        )}
                      </div>
                      {r.match_titolo && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Trovato:{" "}
                          <span className="text-foreground/80">{r.match_titolo}</span>
                          {r.match_sito && ` · ${r.match_sito}`}
                          {r.match_score != null && ` · ${r.match_score}%`}
                        </p>
                      )}
                      {r.errore_msg && (
                        <p className="mt-1 text-sm text-amber-400">{r.errore_msg}</p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {r.stato === "da_confermare" && (
                        <Button size="sm" onClick={() => setJobAperto(r)}>
                          <Check size={14} className="mr-1" />
                          Scegli
                        </Button>
                      )}
                      {r.stato === "errore" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => accoda({ id_video: r.id_Video }, "Riaccodato")}
                        >
                          <RefreshCw size={14} className="mr-1" />
                          Riprova
                        </Button>
                      )}
                      {r.copertina_origine === "online" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          title="Elimina la copertina scaricata e torna al fotogramma"
                          onClick={() => ripristinaFfmpeg(r.id_Video)}
                        >
                          <Undo2 size={14} />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Escludi questo video dalla ricerca online"
                        onClick={() => ignoraVideo(r.id_Video)}
                      >
                        <X size={14} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* ---------------------------------------------------------------
          LIBRERIA COPERTINE
          La coda qui sopra mostra solo i lavori APERTI. Questa sezione da'
          accesso a tutta la libreria — comprese le copertine gia' applicate e
          i "nessun risultato" — cosi' ripristino e riaccodamento restano
          raggiungibili anche per i video che hanno concluso il loro giro.
          --------------------------------------------------------------- */}
      <Section
        icon={Layers}
        title="Libreria copertine"
        description="Tutti i video e la provenienza della loro copertina. Da qui puoi cercarne una nuova o tornare al fotogramma estratto dal video."
      >
        <Panel>
          <PanelHeader
            title="Sfoglia e filtra"
            description="La ricerca funziona sul titolo del video."
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={caricaLibreria}
                disabled={caricamentoLib}
              >
                <RefreshCw
                  size={15}
                  className={`mr-1.5 ${caricamentoLib ? "animate-spin" : ""}`}
                />
                Aggiorna
              </Button>
            }
          />
          <PanelBody>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                value={ricercaLib}
                onChange={(e) => cambiaRicercaLib(e.target.value)}
                placeholder="Cerca per titolo…"
                className="max-w-xs"
              />
              <div className="flex flex-wrap gap-1.5">
                {[
                  ["tutti", "Tutti"],
                  ["online", "Da database online"],
                  ["ffmpeg", "Dal video"],
                  ["senza", "Senza copertina"],
                  ["da_confermare", "Da confermare"],
                  ["errore", "Con errore"],
                ].map(([valore, etichetta]) => (
                  <Button
                    key={valore}
                    size="sm"
                    variant={filtroLib === valore ? "default" : "outline"}
                    onClick={() => cambiaFiltroLib(valore)}
                  >
                    {etichetta}
                  </Button>
                ))}
              </div>
            </div>

            {libreria.length === 0 ? (
              <EmptyState
                icon={ImageIcon}
                title={caricamentoLib ? "Caricamento…" : "Nessun video con questo filtro"}
                description={
                  caricamentoLib
                    ? undefined
                    : "Prova a cambiare filtro o a svuotare la ricerca."
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {libreria.map((v) => {
                  const or = ORIGINI[v.copertina_origine];
                  const st = STATI[v.stato];
                  return (
                    <div
                      key={v.id}
                      className="flex gap-3 rounded-xl border border-hairline bg-surface-2 p-3"
                    >
                      <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-surface-3">
                        {hasAsset(v.percorso_copertina) ? (
                          <img
                            src={getAssetUrl(v.percorso_copertina)}
                            alt=""
                            loading="lazy"
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                        ) : (
                          <ThumbnailPlaceholder title={v.Titolo} />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="line-clamp-1 text-sm font-bold text-foreground">
                          {v.Titolo}
                        </p>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {or && (
                            <StatusChip label={or.label} icon={or.icon} tone={or.tone} />
                          )}
                          {st && (
                            <StatusChip
                              label={st.label}
                              icon={st.icon}
                              tone={st.tone}
                              spin={st.spin}
                            />
                          )}
                        </div>
                        {v.Nome_Categoria && (
                          <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                            {v.Nome_Categoria}
                          </p>
                        )}

                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {v.stato === "da_confermare" && v.candidati_json && (
                            <Button
                              size="sm"
                              onClick={() =>
                                setJobAperto({ ...v, id_meta: v.id_meta, id_Video: v.id })
                              }
                            >
                              <Check size={13} className="mr-1" />
                              Scegli
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={azioneInCorso}
                            title="Cerca online una copertina per questo video"
                            onClick={() => accoda({ id_video: v.id }, "Riaccodato")}
                          >
                            <Search size={13} />
                          </Button>
                          {v.copertina_origine === "online" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Elimina la copertina scaricata e torna al fotogramma del video"
                              onClick={() => ripristinaFfmpeg(v.id)}
                            >
                              <Undo2 size={13} />
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            title="Escludi questo video dalla ricerca online"
                            onClick={() => ignoraVideo(v.id)}
                          >
                            <X size={13} />
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Paginazione: il backend non restituisce il totale, quindi ci
                regoliamo sulla dimensione della pagina ricevuta. */}
            <div className="flex items-center justify-between pt-1">
              <Button
                variant="outline"
                size="sm"
                disabled={offsetLib === 0 || caricamentoLib}
                onClick={() => setOffsetLib((o) => Math.max(0, o - LIBRERIA_PAGINA))}
              >
                Precedenti
              </Button>
              <span className="text-sm text-muted-foreground">
                {libreria.length > 0
                  ? `${offsetLib + 1}–${offsetLib + libreria.length}`
                  : "—"}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={libreria.length < LIBRERIA_PAGINA || caricamentoLib}
                onClick={() => setOffsetLib((o) => o + LIBRERIA_PAGINA)}
              >
                Successivi
              </Button>
            </div>
          </PanelBody>
        </Panel>
      </Section>

      {/* ---------- Modale conferma ---------- */}
      <ModalShell
        open={!!jobAperto}
        onOpenChange={(o) => !o && setJobAperto(null)}
        size="xl"
        icon={Globe}
        iconTone="info"
        title="Scegli la copertina"
        description={
          jobAperto
            ? `${jobAperto.Titolo}${
                jobAperto.query_usata ? ` · cercato: “${jobAperto.query_usata}”` : ""
              }`
            : undefined
        }
      >
        {jobAperto && (
          <GrigliaCandidati
            candidati={(() => {
              try {
                return JSON.parse(jobAperto.candidati_json || "[]");
              } catch {
                return [];
              }
            })()}
            inCorso={azioneInCorso}
            onScegli={(_, i) => confermaCandidato(jobAperto.id_meta, i)}
          />
        )}
      </ModalShell>
    </PageShell>
  );
}
