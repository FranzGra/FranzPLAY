import React, { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { apiRequest } from "../../services/api";
import { getAssetUrl, hasAsset } from "../../services/helpers";
import ThumbnailPlaceholder from "../../components/ThumbnailPlaceholder";
import OpenInPlayerButton from "../../components/admin/OpenInPlayerButton";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Search,
  Captions,
  Languages,
  Wand2,
  Trash2,
  RotateCw,
  Check,
  AlertCircle,
  Loader2,
  Clock,
  CheckCircle2,
  CircleSlash,
  LayoutGrid,
  List,
  ListVideo,
  AudioLines,
  Mic,
  Inbox,
  X,
  StopCircle,
  Cpu,
} from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: "spring", stiffness: 300, damping: 24 }
  }
};

const LINGUE = [
  { code: "it", label: "Italiano" },
  { code: "en", label: "Inglese" },
  { code: "es", label: "Spagnolo" },
  { code: "fr", label: "Francese" },
  { code: "de", label: "Tedesco" },
  { code: "pt", label: "Portoghese" },
];
const LABEL_LINGUA = Object.fromEntries(LINGUE.map((l) => [l.code, l.label]));

const STATO_STYLE = {
  completato: { color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", Icon: CheckCircle2, label: "Pronto" },
  in_coda: { color: "text-sky-400", bg: "bg-sky-500/10", border: "border-sky-500/20", Icon: Clock, label: "In coda" },
  elaborazione: { color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", Icon: Loader2, label: "Elaborazione" },
  errore: { color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", Icon: AlertCircle, label: "Errore" },
};

function SubBadge({ lingua, stato }) {
  const st = STATO_STYLE[stato] || STATO_STYLE.in_coda;
  return (
    <Badge variant="outline" title={`${LABEL_LINGUA[lingua] || lingua} — ${st.label}`} className={`gap-1 px-2 py-0.5 text-[10px] uppercase font-bold tracking-widest ${st.border} ${st.bg} ${st.color}`}>
      <st.Icon size={11} className={stato === "elaborazione" ? "animate-spin" : ""} />
      {lingua}
    </Badge>
  );
}

function CoverThumb({ video, className = "" }) {
  const [failed, setFailed] = useState(false);
  const has = hasAsset(video.percorso_copertina) && !failed;
  if (!has) return <ThumbnailPlaceholder title={video.Titolo} processing={false} />;
  return (
    <img
      src={`${getAssetUrl(video.percorso_copertina)}&t=${Date.now()}`}
      alt="Cover"
      className={`w-full h-full object-cover ${className}`}
      onError={() => setFailed(true)}
    />
  );
}

function parseSubsRaw(raw) {
  if (!raw) return [];
  return raw.split(",").map((tok) => {
    const [lingua, stato, tipo] = tok.split(":");
    return { lingua, stato, tipo };
  }).filter((s) => s.lingua);
}

export default function AdminSubtitles() {
  const [tab, setTab] = useState("libreria");
  const [queueCount, setQueueCount] = useState(0);

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-8 relative">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-foreground tracking-tight flex items-center gap-3">
            <Captions className="text-primary" size={34} /> Sottotitoli
          </h1>
          <p className="text-muted-foreground font-medium mt-1">
            Genera e gestisci i sottotitoli dei video (trascrizione + traduzione).
          </p>
        </div>

        <div className="flex bg-zinc-900/50 p-1.5 rounded-2xl border border-white/5 backdrop-blur-md self-start md:self-auto">
          <Button
            variant={tab === "libreria" ? "default" : "ghost"}
            onClick={() => setTab("libreria")}
            className={`gap-2 rounded-xl text-sm font-black uppercase tracking-wider ${tab === "libreria" ? "shadow-lg shadow-primary/20" : ""}`}
          >
            <ListVideo size={16} /> Libreria
          </Button>
          <Button
            variant={tab === "coda" ? "default" : "ghost"}
            onClick={() => setTab("coda")}
            className={`gap-2 rounded-xl text-sm font-black uppercase tracking-wider relative ${tab === "coda" ? "shadow-lg shadow-primary/20" : ""}`}
          >
            <AudioLines size={16} /> Coda
            {queueCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-amber-500 text-black text-[10px] font-black">
                {queueCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {tab === "libreria" ? <LibraryView /> : <QueueView onCount={setQueueCount} />}
      <QueueCounter onCount={setQueueCount} active={tab !== "coda"} />
    </motion.div>
  );
}

function QueueCounter({ onCount, active }) {
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const fetchCount = async () => {
      try {
        const res = await apiRequest("/admin.php", "POST", { action: "coda_sottotitoli" });
        if (!alive) return;
        const rows = res.data || res.dati || [];
        const n = rows.filter((r) => r.stato === "in_coda" || r.stato === "elaborazione").length;
        onCount(n);
      } catch (e) {}
    };
    fetchCount();
    const t = setInterval(fetchCount, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [active, onCount]);
  return null;
}

function LibraryView() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filtro, setFiltro] = useState("tutti");
  const [linguaFiltro, setLinguaFiltro] = useState("");
  const [viewMode, setViewMode] = useState("grid");
  const [modalVideo, setModalVideo] = useState(null);
  const searchTimeout = useRef(null);
  // Trattiene l'ultimo video aperto così il contenuto resta montato durante
  // l'animazione di CHIUSURA della modale (altrimenti sparirebbe di colpo).
  const lastModalVideo = useRef(null);
  if (modalVideo) lastModalVideo.current = modalVideo;

  const fetchVideos = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiRequest("/admin.php", "POST", {
        action: "lista_video_sottotitoli", limit: 60, offset: 0, query: search, filtro, lingua: linguaFiltro,
      });
      if (res.success) setVideos(res.data || res.dati || []);
    } catch (e) {
      if (!silent) toast.error("Errore caricamento lista");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [search, filtro, linguaFiltro]);

  useEffect(() => { fetchVideos(); }, [filtro, linguaFiltro]);

  const isFirst = useRef(true);
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => fetchVideos(), 500);
    return () => clearTimeout(searchTimeout.current);
  }, [search]);

  useEffect(() => {
    const hasRunning = videos.some((v) => Number(v.sub_in_corso) > 0);
    if (!hasRunning) return;
    const t = setInterval(() => fetchVideos(true), 5000);
    return () => clearInterval(t);
  }, [videos, fetchVideos]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 justify-end">
        <div className="flex bg-zinc-900/50 p-1.5 rounded-2xl border border-white/5 backdrop-blur-md mr-auto">
          <Button variant={viewMode === "grid" ? "default" : "ghost"} size="icon" onClick={() => setViewMode("grid")} className="w-10 h-10 rounded-xl">
            <LayoutGrid size={18} />
          </Button>
          <Button variant={viewMode === "list" ? "default" : "ghost"} size="icon" onClick={() => setViewMode("list")} className="w-10 h-10 rounded-xl">
            <List size={18} />
          </Button>
        </div>

        <div className="flex bg-zinc-900/50 p-1.5 rounded-2xl border border-white/5 backdrop-blur-md">
          {[{ k: "tutti", l: "Tutti" }, { k: "con", l: "Con sub" }, { k: "senza", l: "Senza sub" }].map((opt) => (
            <Button
              key={opt.k}
              variant={filtro === opt.k ? "default" : "ghost"}
              onClick={() => setFiltro(opt.k)}
              className="rounded-xl text-xs font-black uppercase tracking-wider h-9"
            >
              {opt.l}
            </Button>
          ))}
        </div>

        <div className="relative min-w-[150px] z-20">
          <select
            value={linguaFiltro}
            onChange={(e) => setLinguaFiltro(e.target.value)}
            className="w-full bg-zinc-900/50 border border-white/5 rounded-2xl py-2.5 px-4 text-zinc-300 focus:outline-none focus:border-primary/50 transition-all font-bold text-sm appearance-none cursor-pointer"
          >
            <option value="">Tutte le lingue</option>
            {LINGUE.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>

        <div className="relative group w-full md:w-72">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={18} />
          <Input
            type="text"
            placeholder="Cerca per titolo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-12 pr-4 h-11 bg-zinc-900/50 border-white/5 rounded-2xl focus-visible:ring-primary/50 text-foreground"
          />
        </div>
      </div>

      <div className="min-h-[400px]">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => <Card key={i} className="aspect-video bg-zinc-900/50 rounded-3xl animate-pulse border-white/5" />)}
          </div>
        ) : videos.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-20 bg-transparent border-dashed border-zinc-800">
            <Captions size={48} className="text-zinc-700 mb-4" />
            <p className="text-muted-foreground font-bold">Nessun video trovato con questi filtri.</p>
          </Card>
        ) : viewMode === "grid" ? (
          <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {videos.map((video) => {
              const subs = parseSubsRaw(video.sottotitoli_raw);
              return (
                <motion.div variants={itemVariants} key={video.id}>
                  <Card className="group relative transform-gpu hover:z-10 flex flex-col h-full gap-0 py-0 overflow-hidden bg-zinc-900/40 hover:bg-zinc-900/70 border-white/5 hover:border-white/10 transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/40">
                    {/* Cover full-bleed con overlay durata e stato sottotitoli */}
                    <div data-slot="card-media" className="relative aspect-video overflow-hidden bg-zinc-950">
                      <CoverThumb video={video} className="transition-transform duration-700 group-hover:scale-[1.06]" />
                      <OpenInPlayerButton videoId={video.id} />
                      <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/85 via-black/30 to-transparent pointer-events-none" />
                      {video.Durata && (
                        <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-white text-[10px] font-bold">
                          <Clock size={11} /> {video.Durata}
                        </div>
                      )}
                      <div className="absolute bottom-2.5 left-2.5">
                        {subs.length === 0 ? (
                          <Badge variant="outline" className="gap-1 bg-black/70 backdrop-blur-sm border-zinc-500/20 text-zinc-300 text-[10px]">
                            <CircleSlash size={11} /> Nessun sub
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1 bg-emerald-500/20 backdrop-blur-sm border-emerald-500/30 text-emerald-300 text-[10px]">
                            <Captions size={11} /> {subs.length} {subs.length === 1 ? "lingua" : "lingue"}
                          </Badge>
                        )}
                      </div>
                    </div>

                    {/* Contenuto */}
                    <CardContent className="p-4 flex flex-col flex-1 gap-3">
                      <h3 className="text-foreground font-bold text-sm leading-snug line-clamp-2 min-h-[2.5rem]" title={video.Titolo}>
                        {video.Titolo}
                      </h3>

                      <div className="flex flex-wrap items-center gap-1.5 min-h-[24px]">
                        {subs.length > 0 ? (
                          subs.map((s) => <SubBadge key={s.lingua} lingua={s.lingua} stato={s.stato} />)
                        ) : (
                          <span className="text-[11px] text-zinc-600 italic">Nessun sottotitolo generato</span>
                        )}
                      </div>

                      <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                        <Badge variant="outline" className="text-[10px] bg-zinc-950/50 border-white/5 truncate max-w-full uppercase">
                          {video.Nome_Categoria || "NESSUNA"}
                        </Badge>
                      </div>

                      <Button onClick={() => setModalVideo(video)} className="w-full font-black text-xs uppercase tracking-wider gap-2 shadow-lg shadow-primary/20">
                        <Wand2 size={14} /> Gestisci
                      </Button>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </motion.div>
        ) : (
          <Card className="overflow-hidden border-white/5 bg-zinc-900/10 backdrop-blur-md">
            <Table>
              <TableHeader className="bg-zinc-900/50">
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Video</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Categoria</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Sottotitoli</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase tracking-widest text-muted-foreground">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {videos.map((video) => {
                  const subs = parseSubsRaw(video.sottotitoli_raw);
                  return (
                    <TableRow key={video.id} className="border-white/5 group hover:bg-white/5 transition-colors">
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-4">
                          <div className="relative w-20 aspect-video rounded-lg overflow-hidden bg-zinc-950 border border-white/10 shrink-0">
                            <CoverThumb video={video} />
                            <OpenInPlayerButton videoId={video.id} className="top-0.5 right-0.5 w-6 h-6 rounded-md" />
                          </div>
                          <h3 className="text-foreground font-bold text-sm leading-tight max-w-[300px] truncate" title={video.Titolo}>{video.Titolo}</h3>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[9px] uppercase tracking-widest bg-zinc-950/50 border-white/5">
                          {video.Nome_Categoria || "NESSUNA"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5 max-w-[280px]">
                          {subs.length === 0 ? (
                            <Badge variant="outline" className="gap-1 text-zinc-600 text-[10px] border-zinc-800">
                              <CircleSlash size={11} /> Nessuno
                            </Badge>
                          ) : (
                            subs.map((s) => <SubBadge key={s.lingua} lingua={s.lingua} stato={s.stato} />)
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button onClick={() => setModalVideo(video)} size="sm" className="gap-2 rounded-xl font-black text-xs uppercase tracking-wider">
                          <Wand2 size={14} /> Gestisci
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      <Dialog open={!!modalVideo} onOpenChange={(open) => !open && setModalVideo(null)}>
        <DialogContent className="sm:max-w-5xl! w-[calc(100%-2rem)] bg-zinc-950 border-white/10 p-0 overflow-hidden shadow-2xl">
          {(modalVideo || lastModalVideo.current) && (
            <SubtitleModalContent
              video={modalVideo || lastModalVideo.current}
              onClose={() => setModalVideo(null)}
              onChanged={() => fetchVideos(true)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SubtitleModalContent({ video, onClose, onChanged }) {
  const [righe, setRighe] = useState([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [source, setSource] = useState("auto");
  const [targets, setTargets] = useState(["en", "it"]);
  const [modello, setModello] = useState("small");
  const [submitting, setSubmitting] = useState(false);

  const loadRows = useCallback(async (silent = false) => {
    if (!silent) setLoadingRows(true);
    try {
      const res = await apiRequest("/admin.php", "POST", { action: "stato_sottotitoli", id_video: video.id });
      if (res.success) setRighe(res.data || res.dati || []);
    } catch (e) {} finally {
      if (!silent) setLoadingRows(false);
    }
  }, [video.id]);

  useEffect(() => { loadRows(); }, [loadRows]);

  useEffect(() => {
    const running = righe.some((r) => r.stato === "in_coda" || r.stato === "elaborazione");
    if (!running) return;
    const t = setInterval(() => loadRows(true), 4000);
    return () => clearInterval(t);
  }, [righe, loadRows]);

  const toggleTarget = (code) => setTargets((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));

  const handleGenera = async () => {
    if (targets.length === 0) return toast.error("Seleziona almeno una lingua sottotitoli");
    setSubmitting(true);
    try {
      const res = await apiRequest("/admin.php", "POST", { action: "genera_sottotitoli", id_video: video.id, lingua_origine: source, lingue: targets, modello });
      if (res.success) {
        toast.success(res.message || "Generazione accodata");
        await loadRows(true);
        onChanged();
      }
    } catch (e) {
      toast.error("Errore accodamento: " + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRigenera = async (id) => {
    try {
      await apiRequest("/admin.php", "POST", { action: "rigenera_sottotitolo", id_sottotitolo: id });
      toast.success("Rimesso in coda");
      await loadRows(true);
      onChanged();
    } catch (e) { toast.error("Errore: " + e.message); }
  };

  const handleElimina = async (id) => {
    if (!window.confirm("Eliminare questo sottotitolo? Il file .vtt verrà rimosso.")) return;
    try {
      await apiRequest("/admin.php", "POST", { action: "elimina_sottotitolo", id_sottotitolo: id });
      toast.success("Sottotitolo eliminato");
      await loadRows(true);
      onChanged();
    } catch (e) { toast.error("Errore: " + e.message); }
  };

  return (
    <div className="flex flex-col h-full max-h-[90vh]">
      <DialogHeader className="px-6 py-4 border-b border-white/5 bg-zinc-900/30 shrink-0 flex flex-row items-center justify-between">
        <div className="flex flex-col">
          <DialogTitle className="text-xl font-black text-foreground flex items-center gap-2">
            <Captions size={20} className="text-primary shrink-0" /> {video.Titolo}
          </DialogTitle>
          <p className="text-muted-foreground text-xs font-bold uppercase tracking-widest mt-1">Gestione sottotitoli</p>
        </div>
      </DialogHeader>

      <div className="overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
        <div>
          <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-3">Sottotitoli del video</h3>
          {loadingRows ? (
            <div className="flex items-center gap-2 text-zinc-500 text-sm py-4"><Loader2 size={16} className="animate-spin" /> Caricamento…</div>
          ) : righe.length === 0 ? (
            <p className="text-muted-foreground text-sm italic py-2">Nessun sottotitolo ancora generato.</p>
          ) : (
            <div className="space-y-2">
              {righe.map((r) => {
                const st = STATO_STYLE[r.stato] || STATO_STYLE.in_coda;
                return (
                  <div key={r.id} className="flex items-center gap-3 bg-zinc-900/40 border border-white/5 rounded-2xl px-4 py-3">
                    <Badge variant="outline" className={`gap-1.5 px-2.5 py-1 ${st.border} ${st.bg} ${st.color} text-[10px]`}>
                      <st.Icon size={12} className={r.stato === "elaborazione" ? "animate-spin" : ""} /> {st.label}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-foreground">
                        {LABEL_LINGUA[r.lingua] || r.lingua}
                        <span className="text-muted-foreground font-medium ml-2 text-xs uppercase tracking-wide">{r.tipo}</span>
                      </p>
                      {r.stato === "errore" && r.errore_msg && <p className="text-[11px] text-red-400/80 truncate" title={r.errore_msg}>{r.errore_msg}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button variant="ghost" size="icon" onClick={() => handleRigenera(r.id)} title="Rimetti in coda" className="hover:bg-amber-500 hover:text-white bg-zinc-800 text-zinc-400 w-8 h-8 rounded-xl"><RotateCw size={15} /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleElimina(r.id)} title="Elimina" className="hover:bg-red-500 hover:text-white bg-red-500/10 text-red-500 w-8 h-8 rounded-xl"><Trash2 size={15} /></Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-5 lg:border-l lg:border-white/5 lg:pl-8">
          <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Genera nuovi sottotitoli</h3>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-2">Lingua parlata nel video</label>
            <div className="flex flex-wrap gap-2">
              <Button variant={source === "auto" ? "default" : "outline"} onClick={() => setSource("auto")} className={`rounded-xl text-xs font-bold ${source !== "auto" ? "bg-zinc-900/50 border-white/5" : ""}`}>
                ✨ Auto (rileva)
              </Button>
              {LINGUE.map((l) => (
                <Button key={l.code} variant={source === l.code ? "default" : "outline"} onClick={() => setSource(l.code)} className={`rounded-xl text-xs font-bold ${source !== l.code ? "bg-zinc-900/50 border-white/5" : ""}`}>
                  {l.label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-2">Lingue dei sottotitoli da produrre</label>
            <div className="flex flex-wrap gap-2">
              {LINGUE.map((l) => {
                const active = targets.includes(l.code);
                return (
                  <Button
                    key={l.code}
                    variant={active ? "outline" : "outline"}
                    onClick={() => toggleTarget(l.code)}
                    className={`rounded-xl text-xs font-bold flex items-center gap-1.5 ${active ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/40" : "bg-zinc-900/50 border-white/5"}`}
                  >
                    {active && <Check size={13} />} {l.label}
                  </Button>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-600 mt-2 leading-relaxed">
              La lingua uguale a quella parlata diventa la <strong>trascrizione</strong>; le altre vengono <strong>tradotte</strong> automaticamente.
            </p>
          </div>

          <div>
            <label className="block text-xs font-bold text-muted-foreground mb-2">Modello di trascrizione</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { code: "small", titolo: "Small", desc: "Veloce · leggero", hint: "Consigliato" },
                { code: "medium", titolo: "Medium", desc: "Più preciso · più lento", hint: "Più RAM/CPU" },
              ].map((m) => {
                const active = modello === m.code;
                return (
                  <button
                    key={m.code}
                    type="button"
                    onClick={() => setModello(m.code)}
                    className={`text-left rounded-2xl border p-3 transition-colors ${
                      active
                        ? "bg-primary/15 border-primary/50 ring-1 ring-primary/50"
                        : "bg-zinc-900/50 border-white/5 hover:border-white/10"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-primary/20 text-primary" : "bg-zinc-800 text-zinc-400"}`}>
                        <Cpu size={15} />
                      </span>
                      <span className={`font-black text-sm ${active ? "text-foreground" : "text-zinc-300"}`}>{m.titolo}</span>
                      {active && <Check size={15} className="ml-auto text-primary" />}
                    </div>
                    <p className="text-[11px] text-muted-foreground font-semibold mt-1.5">{m.desc}</p>
                    <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-bold mt-0.5">{m.hint}</p>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-zinc-600 mt-2 leading-relaxed">
              Il modello <strong>Medium</strong> migliora l'accuratezza su audio difficili (accenti, rumore) ma richiede più tempo e memoria. Viene scaricato alla prima esecuzione.
            </p>
          </div>
        </div>
      </div>

      <div className="px-6 py-4 flex gap-3 border-t border-white/5 bg-zinc-900/30 shrink-0 justify-end">
        <Button variant="ghost" onClick={onClose} className="rounded-xl">Chiudi</Button>
        <Button
          onClick={handleGenera}
          disabled={submitting || targets.length === 0}
          className="rounded-xl shadow-lg shadow-primary/20 gap-2 font-black uppercase tracking-widest text-xs"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />} Accoda generazione
        </Button>
      </div>
    </div>
  );
}

function analyzeGroup(rows) {
  const total = rows.length;
  const done = rows.filter((r) => r.stato === "completato").length;
  const states = rows.map((r) => r.stato);
  const anyProc = states.includes("elaborazione");
  const anyQueued = states.includes("in_coda");
  const anyErr = states.includes("errore");
  const allTerminal = states.every((s) => s === "completato" || s === "errore");

  const transRow = rows.find((r) => r.tipo === "trascrizione");
  const sourceRaw = rows.find((r) => r.lingua_origine)?.lingua_origine || "auto";
  const source = transRow && transRow.lingua !== "auto" ? transRow.lingua : sourceRaw;
  const hasTranslations = rows.some((r) => r.tipo === "traduzione");

  let phase;
  if (allTerminal && anyErr && done < total) phase = "errore";
  else if (states.every((s) => s === "in_coda")) phase = "in_coda";
  else if (anyProc && done === 0) phase = "trascrizione";
  else if (done > 0 && (anyProc || anyQueued)) phase = "traduzione";
  else if (done === total) phase = "completato";
  else phase = "trascrizione";

  const order = ["in_coda", "trascrizione", "traduzione", "completato"];
  const curIdx = order.indexOf(phase === "errore" ? "trascrizione" : phase);

  const stepStatus = (key) => {
    if (phase === "errore" && key !== "in_coda" && key !== "completato") return "errore";
    const idx = order.indexOf(key);
    if (idx < curIdx) return "done";
    if (idx === curIdx) return phase === "completato" ? "done" : "active";
    return "pending";
  };

  return { total, done, source, hasTranslations, phase, stepStatus, modello: rows.find((r) => r.modello_usato)?.modello_usato };
}

const STEP_COLORS = {
  done: { ring: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400", label: "text-emerald-300", sub: "text-emerald-400/70" },
  active: { ring: "border-primary bg-primary/20 text-primary shadow-lg shadow-primary/20", label: "text-foreground", sub: "text-primary" },
  pending: { ring: "border-zinc-700 bg-zinc-900 text-zinc-600", label: "text-zinc-600", sub: "text-zinc-700" },
  errore: { ring: "border-red-500/40 bg-red-500/15 text-red-400", label: "text-red-300", sub: "text-red-400/80" },
};

// Una "tacca" della timeline: icona centrata nella propria colonna (flex-1, quindi
// distribuita uniformemente) con i due semi-connettori allineati alla riga dell'icona.
function FlowStep({ Icon, label, sub, status, isFirst, isLast, lineInDone, lineOutDone }) {
  const c = STEP_COLORS[status] || STEP_COLORS.pending;
  const lineColor = (filled) => (filled ? "bg-emerald-500/40" : "bg-zinc-800");
  return (
    <div className="flex flex-col items-center flex-1 min-w-0">
      {/* Riga icona + connettori: tutto allineato verticalmente all'icona */}
      <div className="flex items-center w-full">
        <div className={`h-0.5 flex-1 rounded-full ${isFirst ? "opacity-0" : lineColor(lineInDone)}`} />
        <div className={`w-11 h-11 shrink-0 rounded-2xl border flex items-center justify-center transition-colors ${c.ring}`}>
          <Icon size={18} className={status === "active" ? "animate-pulse" : ""} />
        </div>
        <div className={`h-0.5 flex-1 rounded-full ${isLast ? "opacity-0" : lineColor(lineOutDone)}`} />
      </div>
      {/* Etichette centrate sotto l'icona */}
      <p className={`mt-2 text-[10px] font-black uppercase tracking-wider text-center ${c.label}`}>{label}</p>
      {sub && <p className={`text-[9px] font-bold text-center truncate max-w-[100px] ${c.sub}`}>{sub}</p>}
    </div>
  );
}

function QueueCard({ rows, reload }) {
  const a = analyzeGroup(rows);
  const v = rows[0];
  const pct = a.total > 0 ? Math.round((a.done / a.total) * 100) : 0;
  const [cancelling, setCancelling] = useState(false);
  // C'è ancora qualcosa di attivo da fermare? (job in coda o in elaborazione)
  const hasActive = rows.some((r) => r.stato === "in_coda" || r.stato === "elaborazione");
  // Mostriamo il pulsante anche se ci sono SOLO errori: serve per ripulire dalla
  // coda i vecchi job falliti, che altrimenti resterebbero qui per sempre.
  const canCancel = rows.some((r) => r.stato !== "completato");

  const rigenera = async (id) => {
    try {
      await apiRequest("/admin.php", "POST", { action: "rigenera_sottotitolo", id_sottotitolo: id });
      toast.success("Rimesso in coda");
      reload();
    } catch (e) { toast.error("Errore: " + e.message); }
  };

  const annulla = async () => {
    const msg = hasActive
      ? `Annullare la generazione dei sottotitoli per "${v.Titolo}"?\nI sottotitoli già completati resteranno disponibili.`
      : `Rimuovere dalla coda i sottotitoli falliti di "${v.Titolo}"?\nI sottotitoli già completati resteranno disponibili.`;
    if (!window.confirm(msg)) return;
    setCancelling(true);
    try {
      await apiRequest("/admin.php", "POST", { action: "annulla_sottotitoli", id_video: v.id_Video });
      toast.success(hasActive ? "Generazione annullata" : "Rimossi dalla coda");
      reload();
    } catch (e) {
      toast.error("Errore: " + e.message);
    } finally {
      setCancelling(false);
    }
  };

  return (
    <Card className="p-5 bg-zinc-900/30 border-white/5 space-y-5 rounded-3xl">
      <div className="flex items-center gap-5">
        <div className="group relative w-28 aspect-video rounded-xl overflow-hidden bg-zinc-950 ring-1 ring-white/10 flex-shrink-0">
          <CoverThumb video={v} />
          <OpenInPlayerButton videoId={v.id_Video} className="top-1 right-1 w-7 h-7 rounded-lg" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-foreground font-black text-lg md:text-xl leading-tight truncate" title={v.Titolo}>{v.Titolo}</h3>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <Badge variant="outline" className="text-xs uppercase tracking-wider bg-zinc-950/50 border-white/5 px-2.5 py-1">
              Sorgente: {a.source === "auto" ? "auto (rileva)" : (LABEL_LINGUA[a.source] || a.source)}
            </Badge>
            {a.modello && (
              <Badge variant="outline" className="text-xs uppercase tracking-wider bg-zinc-950/50 border-white/5 px-2.5 py-1">
                Whisper · {a.modello}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="text-right">
            <p className="text-3xl font-black text-foreground leading-none">{pct}%</p>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mt-1">{a.done}/{a.total} pronte</p>
          </div>
          {canCancel && (
            <Button
              variant="outline"
              onClick={annulla}
              disabled={cancelling}
              title={hasActive ? "Ferma e annulla la generazione" : "Rimuovi dalla coda i job falliti"}
              className="gap-2 rounded-xl font-black uppercase tracking-wider text-xs bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500 hover:text-white hover:border-red-500"
            >
              {cancelling ? <Loader2 size={16} className="animate-spin" /> : (hasActive ? <StopCircle size={16} /> : <Trash2 size={16} />)}
              {hasActive ? "Annulla" : "Rimuovi"}
            </Button>
          )}
        </div>
      </div>

      <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-700 ${a.phase === "errore" ? "bg-red-500" : "bg-primary"}`} style={{ width: `${Math.max(pct, a.phase !== "in_coda" ? 8 : 0)}%` }} />
      </div>

      {(() => {
        // Stato e testo chiaro per ciascuna tacca della pipeline.
        const subText = (key, status) => {
          if (key === "traduzione" && !a.hasTranslations) return "Non richiesta";
          if (status === "errore") return "Errore";
          switch (key) {
            case "in_coda": return status === "done" ? "Ricevuto" : "In attesa";
            case "audio": return status === "active" ? "Estrazione…" : status === "done" ? "Estratto" : "In attesa";
            case "trascrizione": return status === "active" ? "In corso…" : status === "done" ? "Completata" : "In attesa";
            case "traduzione": return status === "active" ? "In corso…" : status === "done" ? "Completata" : "In attesa";
            case "completato": return status === "done" ? "Pronto" : "In attesa";
            default: return "";
          }
        };

        const steps = [
          { key: "in_coda", Icon: Inbox, label: "In coda", status: a.stepStatus("in_coda") },
          { key: "audio", Icon: AudioLines, label: "Audio", status: a.stepStatus("trascrizione") },
          { key: "trascrizione", Icon: Mic, label: "Trascrizione", status: a.stepStatus("trascrizione") },
          { key: "traduzione", Icon: Languages, label: "Traduzione", status: a.hasTranslations ? a.stepStatus("traduzione") : "pending" },
          { key: "completato", Icon: CheckCircle2, label: "Completato", status: a.stepStatus("completato") },
        ];

        return (
          <div className="flex items-start bg-zinc-950/40 rounded-2xl px-4 py-5 border border-white/5">
            {steps.map((s, i) => (
              <FlowStep
                key={s.key}
                Icon={s.Icon}
                label={s.label}
                sub={subText(s.key, s.status)}
                status={s.status}
                isFirst={i === 0}
                isLast={i === steps.length - 1}
                lineInDone={i > 0 && (steps[i - 1].status === "done")}
                lineOutDone={s.status === "done"}
              />
            ))}
          </div>
        );
      })()}

      <div className="flex flex-wrap gap-2">
        {rows.map((r) => {
          const st = STATO_STYLE[r.stato] || STATO_STYLE.in_coda;
          return (
            <Badge key={r.id} variant="outline" className={`gap-1.5 px-2.5 py-1.5 rounded-xl ${st.border} ${st.bg} ${st.color}`}>
              <st.Icon size={13} className={r.stato === "elaborazione" ? "animate-spin" : ""} />
              <span className="text-xs font-bold">{LABEL_LINGUA[r.lingua] || r.lingua}</span>
              <span className="text-[9px] uppercase tracking-wide opacity-70">{r.tipo}</span>
              {r.stato === "errore" && (
                <button onClick={() => rigenera(r.id)} title="Riprova" className="ml-1 hover:scale-110 transition-transform"><RotateCw size={13} /></button>
              )}
            </Badge>
          );
        })}
      </div>
    </Card>
  );
}

function QueueView({ onCount }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiRequest("/admin.php", "POST", { action: "coda_sottotitoli" });
      const data = res.data || res.dati || [];
      setRows(data);
      onCount(data.filter((r) => r.stato === "in_coda" || r.stato === "elaborazione").length);
    } catch (e) {
      if (!silent) toast.error("Errore caricamento coda");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [onCount]);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 3000);
    return () => clearInterval(t);
  }, [load]);

  const groups = [];
  const idx = {};
  for (const r of rows) {
    if (!(r.id_Video in idx)) {
      idx[r.id_Video] = groups.length;
      groups.push([]);
    }
    groups[idx[r.id_Video]].push(r);
  }

  const attivi = rows.filter((r) => r.stato === "in_coda" || r.stato === "elaborazione").length;
  const errori = rows.filter((r) => r.stato === "errore").length;

  return (
    <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4 bg-zinc-900/30 border-white/5 flex-row items-center gap-4 rounded-3xl">
          <div className="w-11 h-11 shrink-0 rounded-2xl bg-amber-500/15 text-amber-400 flex items-center justify-center"><AudioLines size={20} /></div>
          <div className="text-left min-w-0">
            <p className="text-2xl font-black text-foreground leading-none">{attivi}</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-1">In lavorazione</p>
          </div>
        </Card>
        <Card className="p-4 bg-zinc-900/30 border-white/5 flex-row items-center gap-4 rounded-3xl">
          <div className="w-11 h-11 shrink-0 rounded-2xl bg-sky-500/15 text-sky-400 flex items-center justify-center"><ListVideo size={20} /></div>
          <div className="text-left min-w-0">
            <p className="text-2xl font-black text-foreground leading-none">{groups.length}</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-1">Video coinvolti</p>
          </div>
        </Card>
        <Card className="p-4 bg-zinc-900/30 border-white/5 flex-row items-center gap-4 rounded-3xl">
          <div className="w-11 h-11 shrink-0 rounded-2xl bg-red-500/15 text-red-400 flex items-center justify-center"><AlertCircle size={20} /></div>
          <div className="text-left min-w-0">
            <p className="text-2xl font-black text-foreground leading-none">{errori}</p>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mt-1">Errori</p>
          </div>
        </Card>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1, 2].map((i) => <Card key={i} className="h-44 bg-zinc-900/50 rounded-3xl animate-pulse border-white/5" />)}
        </div>
      ) : groups.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-24 bg-transparent border-zinc-800/50 border-dashed rounded-3xl">
          <Inbox size={48} className="text-zinc-700 mb-4" />
          <p className="text-muted-foreground font-bold">La coda è vuota.</p>
          <p className="text-zinc-600 text-sm mt-1">Accoda una generazione dalla Libreria per vederla qui.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => <QueueCard key={g[0].id_Video} rows={g} reload={() => load(true)} />)}
        </div>
      )}
    </motion.div>
  );
}
