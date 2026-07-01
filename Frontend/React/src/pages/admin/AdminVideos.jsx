import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest } from "../../services/api";
import { getAssetUrl, hasAsset } from "../../services/helpers";
import ImageCropper from "../../components/ImageCropper";
import ThumbnailPlaceholder from "../../components/ThumbnailPlaceholder";
import OpenInPlayerButton from "../../components/admin/OpenInPlayerButton";
import {
  Search,
  Trash2,
  Edit,
  X,
  Upload,
  Check,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Film,
  ThumbsUp,
  LayoutGrid,
  List,
  Zap,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
  Clock,
  Hourglass,
  RotateCw,
  Loader2,
  MoreVertical,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// --- Helpers metadati video ---
const VIDEO_CODECS_OK = ["h264", "hevc"];
const AUDIO_CODECS_OK = ["aac", "ac3", "eac3"];

function getQualityLabel(altezza) {
  const h = Number(altezza);
  if (!h || h <= 0) return null;
  if (h >= 4000) return "4K";
  if (h >= 1400) return "2K";
  if (h >= 1000) return "1080p";
  if (h >= 700) return "720p";
  if (h >= 400) return "480p";
  return `${h}p`;
}

function getCompatibilityStatus(video) {
  const opt = video.ottimizzato;
  const cv = (video.codec_video || "").toLowerCase();
  const ca = (video.codec_audio || "").toLowerCase();

  if (opt === 1 || opt === "1") {
    return { key: "ok", label: "Ottimizzato", Icon: ShieldCheck, variant: "default", color: "bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20", tooltip: "Remuxato in fMP4 faststart, streaming cross-device garantito" };
  }
  if (opt === 0 || opt === "0") {
    if (cv && !VIDEO_CODECS_OK.includes(cv)) {
      return { key: "ko", label: "Non compatibile", Icon: ShieldX, variant: "destructive", color: "bg-red-500/10 text-red-500 hover:bg-red-500/20", tooltip: `Codec video ${cv.toUpperCase()} non supportato su iOS Safari` };
    }
    if (ca && !AUDIO_CODECS_OK.includes(ca)) {
      return { key: "partial", label: "Parziale", Icon: ShieldAlert, variant: "outline", color: "bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20", tooltip: `Audio ${ca.toUpperCase()} non compatibile - richiede re-encode` };
    }
    return { key: "ko", label: "Non compatibile", Icon: ShieldX, variant: "destructive", color: "bg-red-500/10 text-red-500 hover:bg-red-500/20", tooltip: "Worker ha scartato il video (codec non supportato)" };
  }
  if (!cv && !ca) {
    return { key: "unknown", label: "Da analizzare", Icon: Hourglass, variant: "secondary", color: "bg-zinc-500/10 text-zinc-400 hover:bg-zinc-500/20", tooltip: "Worker optimizer non ha ancora processato questo video" };
  }
  return { key: "pending", label: "In coda", Icon: Clock, variant: "outline", color: "bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border-sky-500/20", tooltip: "In attesa del worker optimizer" };
}

function MetaBadge({ Icon, label, variant = "secondary", color = "", title }) {
  return (
    <Badge variant={variant} className={`gap-1.5 px-2.5 py-0.5 text-[11px] uppercase font-bold rounded-md ${color}`} title={title}>
      {Icon && <Icon size={13} />}
      {label}
    </Badge>
  );
}

function AdminCoverThumb({ video }) {
  const [failed, setFailed] = useState(false);
  const has = hasAsset(video.percorso_copertina) && !failed;
  const isProcessing = !has && video.percorso_copertina !== "mancante";

  if (!has) {
    return <ThumbnailPlaceholder title={video.Titolo} processing={isProcessing} />;
  }
  return (
    <img
      src={`${getAssetUrl(video.percorso_copertina)}&t=${Date.now()}`}
      alt="Cover"
      className="block m-0 p-0 absolute inset-0 w-full h-full object-cover object-center group-hover:scale-[1.07] transition-transform duration-700"
      onError={() => setFailed(true)}
    />
  );
}

function AdminAssetSlot({
  assetPath,
  isVideo,
  title,
  selectedFile,
  onSelectFile,
  onRegenerate,
  acceptTypes,
  dragLabel,
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    setLoadFailed(false);
  }, [assetPath]);

  const hasReal = hasAsset(assetPath) && !loadFailed;
  const isProcessing = !hasReal && !selectedFile && (assetPath === null || assetPath === undefined);
  const showRegenerateBtn = !selectedFile && assetPath && assetPath !== "mancante";
  const Icon = isVideo ? Film : ImageIcon;

  return (
    <div className="group relative aspect-video rounded-xl bg-zinc-950/50 border-2 border-dashed border-zinc-800 transition-all hover:border-primary/50 overflow-hidden cursor-pointer">
      <input
        type="file"
        onChange={onSelectFile}
        className="absolute inset-0 opacity-0 cursor-pointer z-10"
        accept={acceptTypes}
      />

      {selectedFile ? (
        isVideo ? (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80">
            <div className="text-center px-2">
              <Film size={28} className="text-primary mx-auto mb-2" />
              <p className="text-[10px] font-bold text-white uppercase break-all">{selectedFile.name}</p>
              <p className="text-[9px] text-zinc-400 mt-1">In attesa di salvataggio…</p>
            </div>
          </div>
        ) : (
          <img
            src={URL.createObjectURL(selectedFile)}
            alt="Nuovo upload"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )
      ) : hasReal ? (
        isVideo ? (
          <video
            src={`${getAssetUrl(assetPath)}&t=${Date.now()}`}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            loop
            autoPlay
            playsInline
            onError={() => setLoadFailed(true)}
          />
        ) : (
          <img
            src={`${getAssetUrl(assetPath)}&t=${Date.now()}`}
            alt="Copertina attuale"
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => setLoadFailed(true)}
          />
        )
      ) : (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-4 text-center"
        >
          <Icon size={32} className="text-zinc-600 mb-2" strokeWidth={1.5} />
          <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wide">{dragLabel}</p>
          {isProcessing ? (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-500 font-semibold">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>In elaborazione…</span>
            </div>
          ) : assetPath === "mancante" ? (
            <p className="mt-1 text-[9px] text-zinc-600 uppercase">Asset mancante</p>
          ) : loadFailed ? (
            <p className="mt-1 text-[9px] text-red-500 uppercase">File non trovato — rigenera</p>
          ) : null}
        </div>
      )}

      {!selectedFile && hasReal && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center pointer-events-none p-4 text-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
          <Upload className="text-white mb-1" size={24} />
          <p className="text-[10px] font-bold text-white uppercase tracking-wide">{dragLabel}</p>
        </div>
      )}

      {showRegenerateBtn && (
        <Button
          variant="outline"
          size="icon"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRegenerate();
          }}
          className="absolute top-2 right-2 z-20 w-8 h-8 bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500 hover:text-white rounded-lg shadow-md transition-all"
          title="Rimuovi e rigenera automaticamente"
        >
          <RotateCw size={14} />
        </Button>
      )}
    </div>
  );
}

// Framer Motion Variants
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 }
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

export default function AdminVideos() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [search, setSearch] = useState("");
  const [editingVideo, setEditingVideo] = useState(null);
  const [categories, setCategories] = useState([]);
  const [viewMode, setViewMode] = useState("grid");
  const [cropImage, setCropImage] = useState(null);
  const [rescanning, setRescanning] = useState(false);

  const searchTimeout = useRef(null);
  const isFirstMount = useRef(true);

  // Mantiene l'ultimo video durante l'animazione di chiusura del modale:
  // senza questo, azzerare editingVideo svuoterebbe il contenuto prima
  // che il Dialog finisca di animarsi in uscita.
  const lastEditingVideo = useRef(null);
  if (editingVideo) lastEditingVideo.current = editingVideo;
  const displayVideo = editingVideo || lastEditingVideo.current;

  const fetchVideos = async (resetPage = false) => {
    setLoading(true);
    const currentPage = resetPage ? 0 : page;
    if (resetPage) setPage(0);

    try {
      const res = await apiRequest("/admin.php", "POST", {
        action: "lista_video",
        limit: itemsPerPage,
        offset: currentPage * itemsPerPage,
        query: search,
      });
      if (res.success) {
        setVideos(res.data || res.dati);
      }
    } catch (error) {
      toast.error("Errore caricamento video");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, [page, itemsPerPage]);

  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      return;
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      fetchVideos(true);
    }, 500);
    return () => clearTimeout(searchTimeout.current);
  }, [search]);

  useEffect(() => {
    apiRequest("/admin.php", "POST", { action: "lista_categorie" }).then(
      (res) => res.success && setCategories(res.data || res.dati),
    );
  }, []);

  const handleRescan = async () => {
    setRescanning(true);
    try {
      const res = await apiRequest("/admin.php", "POST", { action: "rescan_video" });
      if (res.success) {
        const n = res.accodati ?? 0;
        if (n > 0) {
          toast.success(`Rescan completato: ${n} nuovi video accodati per l'elaborazione.`);
          fetchVideos();
        } else {
          toast.info("Rescan completato: nessun nuovo video trovato sul disco.");
        }
        if (res.da_sanificare > 0) {
          toast.info(`${res.da_sanificare} file con nomi non conformi saranno sanificati e accodati dal watcher.`);
        }
      } else {
        toast.error(res.message || "Errore durante il rescan");
      }
    } catch (error) {
      toast.error("Errore rescan: " + error.message);
    } finally {
      setRescanning(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Sei sicuro di voler eliminare questo video? L'azione è irreversibile.")) return;
    try {
      await apiRequest("/admin.php", "POST", {
        action: "elimina_video",
        id_video: id,
      });
      setVideos((prev) => prev.filter((v) => v.id !== id));
      toast.success("Video eliminato con successo");
    } catch (error) {
      toast.error("Errore eliminazione: " + error.message);
    }
  };

  const handleReoptimize = async () => {
    if (!editingVideo) return;
    if (!window.confirm("Ri-accodare il video per l'ottimizzazione?")) return;
    try {
      await apiRequest("/admin.php", "POST", {
        action: "reottimizza_video",
        id: editingVideo.id,
      });
      toast.success("Video ri-accodato per ottimizzazione");
      setEditingVideo(null);
      fetchVideos();
    } catch (error) {
      toast.error("Errore re-enqueue: " + error.message);
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/admin.php", "POST", {
        action: "aggiorna_info_video",
        id: editingVideo.id,
        titolo: editingVideo.Titolo,
        id_categoria: editingVideo.id_Categoria,
      });

      if (editingVideo.newCoverFile) {
        const formData = new FormData();
        formData.append("action", "upload_copertina");
        formData.append("id_video", editingVideo.id);
        formData.append("file_copertina", editingVideo.newCoverFile);
        await apiRequest("/admin.php", "POST", formData);
      }

      if (editingVideo.newPreviewFile) {
        const formData = new FormData();
        formData.append("action", "upload_anteprima");
        formData.append("id_video", editingVideo.id);
        formData.append("file_anteprima", editingVideo.newPreviewFile);
        await apiRequest("/admin.php", "POST", formData);
      }

      setEditingVideo(null);
      toast.success("Video aggiornato con successo");
      fetchVideos();
    } catch (error) {
      toast.error("Errore aggiornamento: " + error.message);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setCropImage(reader.result);
    });
    reader.readAsDataURL(file);
    e.target.value = null;
  };

  const handleCropComplete = (croppedBlob) => {
    setEditingVideo((prev) => ({
      ...prev,
      newCoverFile: croppedBlob,
    }));
    setCropImage(null);
  };

  const handleRemoveCover = async () => {
    if (!editingVideo || !editingVideo.percorso_copertina) return;
    if (!window.confirm("Rimuovere la copertina attuale? Verrà ricreata automaticamente.")) return;

    try {
      const formData = new FormData();
      formData.append("action", "rimuovi_copertina");
      formData.append("id_video", editingVideo.id);

      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        setEditingVideo((prev) => ({ ...prev, percorso_copertina: null }));
        setVideos((prev) =>
          prev.map((v) => (v.id === editingVideo.id ? { ...v, percorso_copertina: null } : v)),
        );
        toast.info("Copertina in coda di rigenerazione");
      }
    } catch (error) {
      toast.error("Errore rimozione: " + error.message);
    }
  };

  const handlePreviewSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setEditingVideo((prev) => ({ ...prev, newPreviewFile: file }));
    e.target.value = null;
  };

  const handleRemovePreview = async () => {
    if (!editingVideo || !editingVideo.percorso_anteprima) return;
    if (!window.confirm("Rimuovere l'anteprima attuale? Verrà ricreata automaticamente.")) return;

    try {
      const formData = new FormData();
      formData.append("action", "rimuovi_anteprima");
      formData.append("id_video", editingVideo.id);

      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        setEditingVideo((prev) => ({ ...prev, percorso_anteprima: null }));
        setVideos((prev) =>
          prev.map((v) => (v.id === editingVideo.id ? { ...v, percorso_anteprima: null } : v)),
        );
        toast.info("Anteprima in coda di rigenerazione");
      }
    } catch (error) {
      toast.error("Errore rimozione anteprima: " + error.message);
    }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8 relative"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-foreground tracking-tight">
            Gestione Video
          </h1>
          <p className="text-muted-foreground font-medium mt-1">
            Modifica, aggiorna o rimuovi i contenuti multimediali.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={handleRescan}
            disabled={rescanning}
            className="h-12 gap-2 font-bold bg-background"
            title="Scansiona il disco e accoda i video non ancora presenti nel database"
          >
            {rescanning ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <RotateCw size={18} />
            )}
            <span className="hidden sm:inline">{rescanning ? "Scansione…" : "Rescan"}</span>
          </Button>

          <div className="inline-flex h-12 items-center justify-center rounded-xl bg-muted p-1.5 text-muted-foreground border">
            <button
              onClick={() => setViewMode("grid")}
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-base font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${viewMode === "grid" ? "bg-background text-foreground shadow-sm" : "hover:text-foreground hover:bg-background/50"}`}
            >
              <LayoutGrid size={20} />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`inline-flex items-center justify-center whitespace-nowrap rounded-md px-4 py-2 text-base font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${viewMode === "table" ? "bg-background text-foreground shadow-sm" : "hover:text-foreground hover:bg-background/50"}`}
            >
              <List size={20} />
            </button>
          </div>

          <div className="relative z-20">
            <Select value={itemsPerPage.toString()} onValueChange={(val) => { setItemsPerPage(Number(val)); setPage(0); }}>
              <SelectTrigger className="w-[140px] h-12 font-medium">
                <SelectValue placeholder="Video / Pagina" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25" className="font-medium">25 / pag</SelectItem>
                <SelectItem value="50" className="font-medium">50 / pag</SelectItem>
                <SelectItem value="100" className="font-medium">100 / pag</SelectItem>
                <SelectItem value="200" className="font-medium">200 / pag</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="relative group w-full md:w-80">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={20} />
            <Input
              type="text"
              placeholder="Cerca per titolo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-12 h-12 w-full bg-background"
            />
          </div>
        </div>
      </div>

      <div className="min-h-[400px]">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Card key={i} className="aspect-video bg-zinc-900/50 rounded-3xl animate-pulse border-white/5" />
            ))}
          </div>
        ) : videos.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-20 bg-transparent border-dashed border-zinc-800">
            <Film size={48} className="text-zinc-700 mb-4" />
            <p className="text-muted-foreground font-bold">Nessun video trovato.</p>
          </Card>
        ) : viewMode === "grid" ? (
          <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {videos.map((video) => (
              <motion.div variants={itemVariants} key={video.id}>
                <Card className="group flex flex-col h-full gap-0 py-0 bg-zinc-900/20 hover:bg-zinc-900/60 border-white/5 hover:border-white/10 transition-colors overflow-hidden">
                  <div data-slot="card-media" className="relative w-full aspect-video shrink-0 overflow-hidden bg-zinc-950/50 border-b border-white/5">
                    <AdminCoverThumb video={video} />
                    <OpenInPlayerButton videoId={video.id} />
                  </div>
                  <CardContent className="p-4 flex-col flex-1 flex">
                    <h3 className="text-foreground font-bold text-sm truncate mb-3" title={video.Titolo}>
                      {video.Titolo}
                    </h3>
                    <div className="flex flex-wrap items-center gap-1.5 mb-3">
                      {(() => {
                        const st = getCompatibilityStatus(video);
                        const q = getQualityLabel(video.altezza_video);
                        return (
                          <>
                            <MetaBadge Icon={st.Icon} label={st.label} variant={st.variant} color={st.color} title={st.tooltip} />
                            {q && <MetaBadge label={q} title="Risoluzione" />}
                            {video.Formato && <MetaBadge label={video.Formato} title="Formato file" />}
                            {video.Durata && <MetaBadge Icon={Clock} label={video.Durata} title="Durata" />}
                          </>
                        );
                      })()}
                    </div>
                    <div className="flex items-center justify-between mb-4 mt-auto">
                      <Badge variant="outline" className="text-[10px] tracking-widest uppercase bg-zinc-950/50 border-white/5 truncate max-w-[50%]">
                        {video.Nome_Categoria || "NESSUNA"}
                      </Badge>
                      <div className="flex items-center gap-1 text-muted-foreground text-[10px] font-bold">
                        <ThumbsUp size={12} /> {video.Likes || 0}
                      </div>
                    </div>
                    <div className="flex gap-2 w-full pt-3 border-t border-white/5 mt-auto">
                      <Button variant="secondary" size="sm" className="flex-1 font-bold text-xs h-9" onClick={() => setEditingVideo({ ...video })}>
                        <Edit size={14} className="mr-2" /> Modifica
                      </Button>
                      <Button variant="destructive" size="icon" className="w-9 h-9 shrink-0" onClick={() => handleDelete(video.id)}>
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </motion.div>
        ) : (
          <Card className="overflow-hidden border-white/5 bg-zinc-900/10 backdrop-blur-md">
            <Table>
              <TableHeader className="bg-zinc-900/50">
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Video</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Categoria</TableHead>
                  <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Info</TableHead>
                  <TableHead className="text-right text-[10px] font-black uppercase tracking-widest text-muted-foreground">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {videos.map((video) => (
                  <TableRow key={video.id} className="border-white/5 group hover:bg-white/5 transition-colors">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-4">
                        <div className="relative w-20 aspect-video rounded-md overflow-hidden bg-zinc-950 border border-white/10 shrink-0">
                          <AdminCoverThumb video={video} />
                          <OpenInPlayerButton videoId={video.id} className="top-0.5 right-0.5 w-6 h-6 rounded-md" />
                        </div>
                        <div>
                          <h3 className="text-foreground font-bold text-sm leading-tight max-w-[300px] truncate" title={video.Titolo}>
                            {video.Titolo}
                          </h3>
                          <p className="text-[10px] font-bold text-muted-foreground uppercase mt-1">ID: #{video.id}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[9px] uppercase tracking-widest bg-zinc-950/50 border-white/5">
                        {video.Nome_Categoria || "NESSUNA"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5 max-w-[260px]">
                        {(() => {
                          const st = getCompatibilityStatus(video);
                          const q = getQualityLabel(video.altezza_video);
                          return (
                            <>
                              <MetaBadge Icon={st.Icon} label={st.label} variant={st.variant} color={st.color} title={st.tooltip} />
                              {q && <MetaBadge label={q} title="Risoluzione" />}
                              {video.Formato && <MetaBadge label={video.Formato} title="Formato file" />}
                              {video.Durata && <MetaBadge Icon={Clock} label={video.Durata} title="Durata" />}
                            </>
                          );
                        })()}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Apri menu</span>
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-zinc-950 border-white/10">
                          <DropdownMenuItem onClick={() => setEditingVideo({ ...video })} className="cursor-pointer">
                            <Edit className="mr-2 h-4 w-4" /> Modifica
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-white/10" />
                          <DropdownMenuItem onClick={() => handleDelete(video.id)} className="cursor-pointer text-red-500 hover:text-red-400 hover:bg-red-500/10">
                            <Trash2 className="mr-2 h-4 w-4" /> Elimina
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {!loading && videos.length > 0 && (page > 0 || videos.length === itemsPerPage) && (
        <div className="flex items-center justify-center gap-6 pt-10">
          <Button variant="outline" size="icon" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="w-12 h-12 rounded-2xl bg-zinc-900 border-white/5">
            <ChevronLeft size={20} />
          </Button>
          <div className="bg-zinc-950/60 backdrop-blur-xl px-6 py-2 rounded-2xl border border-white/5 font-black text-sm text-muted-foreground">
            PAGINA <span className="text-foreground">{page + 1}</span>
          </div>
          <Button variant="outline" size="icon" onClick={() => setPage((p) => p + 1)} disabled={videos.length < itemsPerPage} className="w-12 h-12 rounded-2xl bg-zinc-900 border-white/5">
            <ChevronRight size={20} />
          </Button>
        </div>
      )}

      {/* SETUP VIDEO DIALOG */}
      <Dialog open={!!editingVideo} onOpenChange={(open) => !open && setEditingVideo(null)}>
        <DialogContent className="sm:max-w-[1000px] lg:max-w-[1200px] w-[95vw] bg-zinc-950 border-white/10 p-0 overflow-hidden shadow-2xl">
          {displayVideo && (
            <form onSubmit={handleSaveEdit} className="flex flex-col h-full max-h-[90vh]">
              <DialogHeader className="px-6 py-4 border-b border-white/5 bg-zinc-900/30 shrink-0">
                <DialogTitle className="text-2xl font-black text-foreground">Setup Video</DialogTitle>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <Badge variant="outline" className="text-xs px-3 py-1 rounded-lg bg-zinc-900 border-white/10">ID: #{displayVideo.id}</Badge>
                  {(() => {
                    const st = getCompatibilityStatus(displayVideo);
                    const q = getQualityLabel(displayVideo.altezza_video);
                    return (
                      <>
                        <MetaBadge Icon={st.Icon} label={st.label} variant={st.variant} color={st.color} title={st.tooltip} />
                        {q && <MetaBadge label={q} title="Risoluzione" />}
                        {displayVideo.Formato && <MetaBadge label={displayVideo.Formato} title="Formato file" />}
                        {displayVideo.Durata && <MetaBadge Icon={Clock} label={displayVideo.Durata} title="Durata" />}
                        {displayVideo.codec_video && <MetaBadge Icon={Film} label={displayVideo.codec_video.toUpperCase()} title="Codec video" />}
                        {displayVideo.codec_audio && <MetaBadge Icon={Zap} label={displayVideo.codec_audio.toUpperCase()} title="Codec audio" />}
                      </>
                    );
                  })()}
                </div>
              </DialogHeader>

              <div className="overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Titolo Video</Label>
                    <Input
                      type="text"
                      value={displayVideo.Titolo}
                      onChange={(e) => setEditingVideo({ ...displayVideo, Titolo: e.target.value })}
                      className="bg-zinc-900/50 border-white/10 h-11 focus-visible:ring-primary/50 text-foreground font-bold"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Sposta Categoria</Label>
                    <Select
                      value={displayVideo.id_Categoria?.toString() || ""}
                      onValueChange={(val) => setEditingVideo({ ...displayVideo, id_Categoria: val })}
                    >
                      <SelectTrigger className="w-full bg-zinc-900/50 border-white/10 h-11 focus:ring-primary/50 font-bold">
                        <SelectValue placeholder="Seleziona Categoria">
                          {displayVideo.id_Categoria && categories.find(c => c.id.toString() === displayVideo.id_Categoria?.toString())?.Nome
                            ? categories.find(c => c.id.toString() === displayVideo.id_Categoria?.toString()).Nome
                            : "Seleziona Categoria"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-950 border-white/10 max-h-[300px]">
                        {categories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id.toString()}>{cat.Nome}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Cover Art</Label>
                    <AdminAssetSlot
                      assetPath={displayVideo.percorso_copertina}
                      isVideo={false}
                      title={displayVideo.Titolo}
                      selectedFile={displayVideo.newCoverFile}
                      onSelectFile={handleFileSelect}
                      onRegenerate={handleRemoveCover}
                      acceptTypes="image/*"
                      dragLabel="Trascina Immagine"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Anteprima (Video)</Label>
                    <AdminAssetSlot
                      assetPath={displayVideo.percorso_anteprima}
                      isVideo={true}
                      title={displayVideo.Titolo}
                      selectedFile={displayVideo.newPreviewFile}
                      onSelectFile={handlePreviewSelect}
                      onRegenerate={handleRemovePreview}
                      acceptTypes="video/mp4,video/webm,image/gif,image/webp"
                      dragLabel="Trascina .MP4 / .GIF"
                    />
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 flex flex-wrap gap-3 border-t border-white/5 bg-zinc-900/30 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleReoptimize}
                  className="bg-sky-500/10 text-sky-400 border-sky-500/30 hover:bg-sky-500 hover:text-white"
                >
                  <RotateCw size={16} className="mr-2" /> Ri-ottimizza
                </Button>
                <div className="flex-1 flex gap-3 justify-end">
                  <Button type="button" variant="ghost" onClick={() => setEditingVideo(null)}>
                    Annulla
                  </Button>
                  <Button type="submit" className="font-bold shadow-lg shadow-primary/20">
                    Applica modifiche
                  </Button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* CROPPER MODAL */}
      {cropImage && (
        <ImageCropper
          imageSrc={cropImage}
          onCropComplete={handleCropComplete}
          onCancel={() => setCropImage(null)}
          aspect={16 / 9}
          cropShape="rect"
        />
      )}
    </motion.div>
  );
}
