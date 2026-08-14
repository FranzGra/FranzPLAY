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
  Globe,
  Hand,
  Youtube,
  Clapperboard,
  Flame,
  Database,
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
import { ModalShell } from "@/components/ui/modal-shell";
import { StatusChip } from "@/components/ui/data-display";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Icone dei database online.
 * Si usano icone GENERICHE di lucide, non i loghi dei marchi: distinguono
 * visivamente senza ridistribuire asset di terzi, che avrebbero implicazioni
 * di trademark su un progetto open source pubblico.
 * La chiave arriva dal catalogo PHP (`icona`), così aggiungere un provider
 * non richiede di toccare questo file se riusa una chiave esistente.
 */
const ICONE_PROVIDER = {
  youtube: { Icon: Youtube, colore: "bg-red-500/10 text-red-500" },
  cinema: { Icon: Clapperboard, colore: "bg-teal-500/10 text-teal-400" },
  adulti: { Icon: Flame, colore: "bg-pink-500/10 text-pink-400" },
  database: { Icon: Database, colore: "bg-surface-3 text-muted-foreground" },
};

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
    return { key: "unknown", label: "Da analizzare", Icon: Hourglass, variant: "secondary", color: "bg-surface-3 text-muted-foreground hover:bg-surface-2", tooltip: "Worker optimizer non ha ancora processato questo video" };
  }
  return { key: "pending", label: "In coda", Icon: Clock, variant: "outline", color: "bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 border-sky-500/20", tooltip: "In attesa del worker optimizer" };
}

function MetaBadge({ Icon, label, variant = "secondary", color = "", title }) {
  return (
    <Badge variant={variant} className={`gap-1.5 px-2.5 py-0.5 text-sm uppercase font-bold rounded-md ${color}`} title={title}>
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
    <div className="group relative aspect-video rounded-xl bg-surface-3 border-2 border-dashed border-hairline-strong transition-all hover:border-primary/50 overflow-hidden cursor-pointer">
      <input
        type="file"
        onChange={onSelectFile}
        className="absolute inset-0 opacity-0 cursor-pointer z-10"
        accept={acceptTypes}
      />

      {selectedFile ? (
        isVideo ? (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-2">
            <div className="text-center px-2">
              <Film size={28} className="text-primary mx-auto mb-2" />
              <p className="text-xs font-bold text-white uppercase break-all">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground mt-1">In attesa di salvataggio…</p>
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
          <Icon size={32} className="text-muted-foreground mb-2" strokeWidth={1.5} />
          <p className="text-sm font-bold text-muted-foreground uppercase tracking-wide">{dragLabel}</p>
          {isProcessing ? (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-500 font-semibold">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>In elaborazione…</span>
            </div>
          ) : assetPath === "mancante" ? (
            <p className="mt-1 text-xs text-muted-foreground uppercase">Asset mancante</p>
          ) : loadFailed ? (
            <p className="mt-1 text-xs text-red-500 uppercase">File non trovato — rigenera</p>
          ) : null}
        </div>
      )}

      {!selectedFile && hasReal && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center pointer-events-none p-4 text-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
          <Upload className="text-white mb-1" size={24} />
          <p className="text-xs font-bold text-white uppercase tracking-wide">{dragLabel}</p>
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

  // --------------------------------------------------------------------
  // RICERCA COPERTINA ONLINE (modulo Admin > Copertine)
  // La ricerca e il download passano SEMPRE dal backend: il token del provider
  // non arriva mai al browser e le miniature dei candidati sono servite dal
  // proxy PHP, cosi' il browser non contatta direttamente CDN esterni.
  // --------------------------------------------------------------------
  // Input file nascosto: la scheda "Da file" della sorgente copertina lo
  // apre programmaticamente, cosi' i tre metodi partono tutti allo stesso modo.
  const coverFileInputRef = useRef(null);

  const [coverSearchOpen, setCoverSearchOpen] = useState(false);
  const [coverQuery, setCoverQuery] = useState("");
  const [coverResults, setCoverResults] = useState([]);
  const [coverSearching, setCoverSearching] = useState(false);
  const [coverApplying, setCoverApplying] = useState(false);
  const [coverSearched, setCoverSearched] = useState(false);
  // Errore REALE (sistema spento, token mancante, provider irraggiungibile).
  // Va tenuto separato da "zero risultati": sono due situazioni diverse e
  // mostrarle allo stesso modo manda l'utente a caccia di un problema
  // inesistente nel testo di ricerca.
  const [coverError, setCoverError] = useState(null);
  const [coverAppliedId, setCoverAppliedId] = useState(null);
  // Database disponibili per la ricerca e quello scelto dall'admin.
  const [coverProviders, setCoverProviders] = useState([]);
  const [coverProvider, setCoverProvider] = useState(null);
  // Query realmente inviata al provider: mostrata come nota, MAI scritta nel
  // campo di input (vedi il commento in runCoverSearch).
  const [coverQueryUsata, setCoverQueryUsata] = useState("");

  /**
   * Apre il modale e AVVIA SUBITO la ricerca, senza far digitare nulla.
   * Non passiamo alcuna query: il backend ricostruisce sito/data/titolo dal
   * percorso del file, che da' match molto migliori del solo titolo (la
   * cartella categoria coincide spesso con lo studio). Il campo di testo
   * viene poi riempito con la query effettivamente usata, cosi' resta
   * modificabile per affinare la ricerca.
   */
  /**
   * Apre il modale MOSTRANDO PRIMA LA SCELTA DEL DATABASE, senza cercare.
   *
   * Perché non si cerca subito: YouTube costa 100 unità di quota per ricerca
   * su 10.000 al giorno. Interrogare tutti i database per un video che
   * proviene da uno solo è uno spreco misurabile. La scelta è un click, quindi
   * non c'è nulla da digitare: resta il comportamento "apri e vai".
   */
  const openCoverSearch = async (video) => {
    const target = video || editingVideo;
    if (!target) return;
    setCoverSearchOpen(true);
    setCoverResults([]);
    setCoverSearched(false);
    setCoverError(null);
    setCoverAppliedId(null);
    setCoverQuery(target.Titolo || "");
    setCoverProvider(null);
    setCoverProviders([]);

    try {
      const res = await apiRequest("/admin.php", "POST", {
        action: "provider_per_ricerca",
        id_video: target.id,
      });
      const lista = res.dati || [];
      setCoverProviders(lista);
      // Un solo database attivo: la scelta non esiste, si parte diretti.
      if (lista.length === 1) {
        setCoverProvider(lista[0].id);
        runCoverSearch(null, target, lista[0].id);
      }
    } catch (error) {
      setCoverError(error.message || "Impossibile leggere i database attivi");
      setCoverSearched(true);
    }
  };

  /**
   * @param {string|null} queryManuale  null = ricerca automatica dal percorso file
   * @param {object|null} video         opzionale, per l'apertura immediata
   */
  const runCoverSearch = async (queryManuale = null, video = null, provider = null) => {
    const target = video || editingVideo;
    if (!target) return;
    const db = provider || coverProvider;
    if (!db) return;              // nessun database scelto: non si spende nulla
    setCoverSearching(true);
    setCoverError(null);
    try {
      const payload = {
        action: "cerca_copertina_online",
        id_video: target.id,
        provider: db,
      };
      // Inviamo `query` SOLO se l'utente ha digitato qualcosa: una stringa
      // vuota farebbe saltare l'euristica sul percorso lato backend.
      if (queryManuale && queryManuale.trim() !== "") {
        payload.query = queryManuale.trim();
      }
      const res = await apiRequest("/admin.php", "POST", payload);
      setCoverResults(res.dati || []);
      setCoverSearched(true);
      // ⚠️ NON si riscrive il campo con la query derivata dal backend.
      // Farlo produceva un "glitch": il titolo digitato spariva e veniva
      // sostituito da una versione accorciata dalle euristiche interne, e la
      // ricerca successiva partiva da quella stringa monca. La query effettiva
      // si mostra come informazione a parte, senza toccare ciò che l'utente
      // vede e può modificare.
      setCoverQueryUsata(res.query || "");
    } catch (error) {
      setCoverResults([]);
      setCoverSearched(true);
      setCoverError(error.message || "Ricerca fallita");
    } finally {
      setCoverSearching(false);
    }
  };

  const applyOnlineCover = async (candidato) => {
    if (!editingVideo) return;
    setCoverApplying(true);
    try {
      const res = await apiRequest("/admin.php", "POST", {
        action: "applica_copertina_online",
        id_video: editingVideo.id,
        url_immagine: candidato.image_url,
        match_id: candidato.id,
        match_titolo: candidato.title,
        match_sito: candidato.site,
        match_data: candidato.date,
        match_score: candidato.score,
      });
      const nuovoPath = res.nuovo_path;
      setCoverAppliedId(candidato.id);
      setEditingVideo((prev) => ({
        ...prev,
        percorso_copertina: nuovoPath,
        copertina_origine: "online",
      }));
      setVideos((prev) =>
        prev.map((v) =>
          v.id === editingVideo.id
            ? { ...v, percorso_copertina: nuovoPath, copertina_origine: "online" }
            : v,
        ),
      );
      toast.success("Copertina scaricata e applicata");
      setCoverSearchOpen(false);
    } catch (error) {
      toast.error("Applicazione fallita: " + error.message);
    } finally {
      setCoverApplying(false);
    }
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
          <h1 className="text-3xl font-black text-foreground tracking-tight">
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
              <Card key={i} className="aspect-video bg-surface-2 rounded-3xl animate-pulse border-hairline" />
            ))}
          </div>
        ) : videos.length === 0 ? (
          <Card className="flex flex-col items-center justify-center py-20 bg-transparent border-dashed border-hairline-strong">
            <Film size={48} className="text-muted-foreground mb-4" />
            <p className="text-muted-foreground font-bold">Nessun video trovato.</p>
          </Card>
        ) : viewMode === "grid" ? (
          <motion.div variants={containerVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {videos.map((video) => (
              <motion.div variants={itemVariants} key={video.id}>
                <Card className="group flex flex-col h-full gap-0 py-0 bg-surface-2/20 hover:bg-surface-2/60 border-hairline hover:border-hairline-strong transition-colors overflow-hidden">
                  <div data-slot="card-media" className="relative w-full aspect-video shrink-0 overflow-hidden bg-surface-3 border-b border-hairline">
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
                      <Badge variant="outline" className="text-xs tracking-widest uppercase bg-surface-3 border-hairline truncate max-w-[50%]">
                        {video.Nome_Categoria || "NESSUNA"}
                      </Badge>
                      <div className="flex items-center gap-1 text-muted-foreground text-xs font-bold">
                        <ThumbsUp size={12} /> {video.Likes || 0}
                      </div>
                    </div>
                    <div className="flex gap-2 w-full pt-3 border-t border-hairline mt-auto">
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
          <Card className="overflow-hidden border-hairline bg-surface-2/10 backdrop-blur-md">
            <Table>
              <TableHeader className="bg-surface-2">
                <TableRow className="border-hairline hover:bg-transparent">
                  <TableHead className="text-xs font-black uppercase tracking-widest text-muted-foreground">Video</TableHead>
                  <TableHead className="text-xs font-black uppercase tracking-widest text-muted-foreground">Categoria</TableHead>
                  <TableHead className="text-xs font-black uppercase tracking-widest text-muted-foreground">Info</TableHead>
                  <TableHead className="text-right text-xs font-black uppercase tracking-widest text-muted-foreground">Azioni</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {videos.map((video) => (
                  <TableRow key={video.id} className="border-hairline group hover:bg-surface-2 transition-colors">
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-4">
                        <div className="relative w-20 aspect-video rounded-md overflow-hidden bg-background border border-hairline-strong shrink-0">
                          <AdminCoverThumb video={video} />
                          <OpenInPlayerButton videoId={video.id} className="top-0.5 right-0.5 w-6 h-6 rounded-md" />
                        </div>
                        <div>
                          <h3 className="text-foreground font-bold text-sm leading-tight max-w-[300px] truncate" title={video.Titolo}>
                            {video.Titolo}
                          </h3>
                          <p className="text-xs font-bold text-muted-foreground uppercase mt-1">ID: #{video.id}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs uppercase tracking-widest bg-surface-3 border-hairline">
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
                        <DropdownMenuContent align="end" className="bg-background border-hairline-strong">
                          <DropdownMenuItem onClick={() => setEditingVideo({ ...video })} className="cursor-pointer">
                            <Edit className="mr-2 h-4 w-4" /> Modifica
                          </DropdownMenuItem>
                          <DropdownMenuSeparator className="bg-hairline-strong" />
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
          <Button variant="outline" size="icon" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="w-12 h-12 rounded-2xl bg-surface-2 border-hairline">
            <ChevronLeft size={20} />
          </Button>
          <div className="bg-background/60 backdrop-blur-xl px-6 py-2 rounded-2xl border border-hairline font-black text-sm text-muted-foreground">
            PAGINA <span className="text-foreground">{page + 1}</span>
          </div>
          <Button variant="outline" size="icon" onClick={() => setPage((p) => p + 1)} disabled={videos.length < itemsPerPage} className="w-12 h-12 rounded-2xl bg-surface-2 border-hairline">
            <ChevronRight size={20} />
          </Button>
        </div>
      )}

      {/* SETUP VIDEO DIALOG */}
      <Dialog open={!!editingVideo} onOpenChange={(open) => !open && setEditingVideo(null)}>
        <DialogContent className="sm:max-w-[1000px] lg:max-w-[1200px] w-[95vw] bg-background border-hairline-strong p-0 overflow-hidden shadow-2xl">
          {displayVideo && (
            <form onSubmit={handleSaveEdit} className="flex flex-col h-full max-h-[90vh]">
              <DialogHeader className="px-6 py-4 border-b border-hairline bg-surface-2 shrink-0">
                <DialogTitle className="text-2xl font-black text-foreground">Setup Video</DialogTitle>
                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <Badge variant="outline" className="text-xs px-3 py-1 rounded-lg bg-surface-2 border-hairline-strong">ID: #{displayVideo.id}</Badge>
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
                      className="bg-surface-2 border-hairline-strong h-11 focus-visible:ring-primary/50 text-foreground font-bold"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Sposta Categoria</Label>
                    <Select
                      value={displayVideo.id_Categoria?.toString() || ""}
                      onValueChange={(val) => setEditingVideo({ ...displayVideo, id_Categoria: val })}
                    >
                      <SelectTrigger className="w-full bg-surface-2 border-hairline-strong h-11 focus:ring-primary/50 font-bold">
                        <SelectValue placeholder="Seleziona Categoria">
                          {displayVideo.id_Categoria && categories.find(c => c.id.toString() === displayVideo.id_Categoria?.toString())?.Nome
                            ? categories.find(c => c.id.toString() === displayVideo.id_Categoria?.toString()).Nome
                            : "Seleziona Categoria"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="bg-background border-hairline-strong max-h-[300px]">
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

                    {/* ---------------------------------------------------------
                        SORGENTE DELLA COPERTINA
                        Tre modi di ottenerla, resi espliciti e scegliibili qui
                        invece di essere sparsi tra un bottone, un drag&drop e
                        un'icona di rigenerazione. La scheda evidenziata mostra
                        da dove viene la copertina ATTUALE (Video.copertina_origine),
                        cliccarne un'altra avvia quel metodo.
                        --------------------------------------------------------- */}
                    <input
                      type="file"
                      accept="image/*"
                      ref={coverFileInputRef}
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <div className="pt-2">
                      <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                        Come ottenere la copertina
                      </Label>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        {[
                          {
                            id: "online",
                            Icona: Globe,
                            titolo: "Online",
                            nota: "Cerca nei database",
                            colore: "text-blue-400",
                            bordo: "border-blue-500/50 bg-blue-500/10",
                            azione: () => openCoverSearch(),
                            // Apre solo un modale di ricerca: ricliccabile
                            // anche quando e' gia' la sorgente attuale, perche'
                            // serve proprio a cercare un'immagine DIVERSA.
                            inerteSeAttiva: false,
                          },
                          {
                            id: "manuale",
                            Icona: Upload,
                            titolo: "Da file",
                            nota: "Carica un'immagine",
                            colore: "text-purple-400",
                            bordo: "border-purple-500/50 bg-purple-500/10",
                            azione: () => coverFileInputRef.current?.click(),
                            // Apre il selettore di file: ricliccabile, si puo'
                            // voler caricare un'immagine diversa.
                            inerteSeAttiva: false,
                          },
                          {
                            id: "ffmpeg",
                            Icona: Film,
                            titolo: "Dal video",
                            nota: "Estrai un fotogramma",
                            colore: "text-foreground",
                            bordo: "border-hairline-strong bg-surface-3",
                            azione: handleRemoveCover,
                            // UNICA scheda inerte quando e' gia' attiva:
                            // l'azione CANCELLA la copertina per farla
                            // rigenerare. Ripremerla quando e' gia' la sorgente
                            // significherebbe distruggere e rifare lo stesso
                            // fotogramma, senza alcun guadagno.
                            inerteSeAttiva: true,
                          },
                        ].map((s) => {
                          const attiva = displayVideo.copertina_origine === s.id;
                          // Inerte SOLO se la scheda e' quella attuale E la sua
                          // azione e' distruttiva (vedi inerteSeAttiva).
                          //
                          // Prima erano inerti TUTTE le schede attive: se la
                          // copertina veniva gia' da un database online, il
                          // riquadro "Online" non rispondeva al clic e non si
                          // poteva piu' cercare un'immagine diversa. Ma cercare
                          // di nuovo online e' proprio l'operazione che si vuole
                          // fare quando l'immagine trovata non convince.
                          const inerte = attiva && s.inerteSeAttiva;
                          return (
                            <button
                              key={s.id}
                              type="button"
                              onClick={inerte ? undefined : s.azione}
                              aria-current={attiva ? "true" : undefined}
                              title={
                                inerte
                                  ? `Sorgente attuale: ${s.nota}`
                                  : attiva
                                    ? `Sorgente attuale · clicca per ${s.nota.toLowerCase()}`
                                    : s.nota
                              }
                              className={`group relative rounded-xl border p-2.5 text-left transition-all ${
                                attiva
                                  ? `${s.bordo} ${inerte ? "cursor-default" : "cursor-pointer hover:brightness-125"}`
                                  : "border-hairline-strong bg-surface-1 hover:border-hairline-strong hover:bg-surface-2"
                              }`}
                            >
                              {attiva && (
                                <span className="absolute right-1.5 top-1.5 flex size-3.5 items-center justify-center rounded-full bg-emerald-500">
                                  <Check size={9} className="text-white" strokeWidth={4} />
                                </span>
                              )}
                              <s.Icona
                                size={16}
                                className={attiva ? s.colore : "text-muted-foreground"}
                              />
                              <p
                                className={`mt-1.5 text-sm font-black uppercase tracking-wide ${
                                  attiva ? "text-white" : "text-muted-foreground"
                                }`}
                              >
                                {s.titolo}
                              </p>
                              <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
                                {s.nota}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                        {displayVideo.copertina_origine === "online"
                          ? "Copertina scaricata da un database online."
                          : displayVideo.copertina_origine === "manuale"
                            ? "Immagine caricata a mano: gli automatismi non la sostituiranno mai."
                            : "Fotogramma estratto dal video dal server."}
                      </p>
                    </div>
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

              <div className="px-6 py-4 flex flex-wrap gap-3 border-t border-hairline bg-surface-2 shrink-0">
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

      {/* ================== RICERCA COPERTINA ONLINE ==================
          Stessa impostazione grafica del modale "Setup Video": larghezza
          piena, p-0 con header/body/footer propri, sfondo del tema.
          NB: la larghezza va dichiarata con i breakpoint (sm:/lg:), perche'
          DialogContent porta un `sm:max-w-sm` che altrimenti vince sopra i
          640px e schiaccia il modale.                                    */}
      <ModalShell
        open={coverSearchOpen}
        onOpenChange={setCoverSearchOpen}
        size="xl"
        icon={Globe}
        iconTone="info"
        title="Copertine online"
        description={editingVideo?.Titolo}
      >
          {/* Barra di ricerca: compare SOLO dopo aver scelto il database,
              perché prima non c'è nulla da affinare. */}
          {coverProvider && (
            <div className="sticky top-0 z-10 -mx-6 -mt-5 mb-5 flex flex-wrap items-center gap-2 border-b border-hairline bg-background/95 px-6 py-4 backdrop-blur">
              {(() => {
                const attuale = coverProviders.find((p) => p.id === coverProvider);
                const ic = ICONE_PROVIDER[attuale?.icona] || ICONE_PROVIDER.database;
                return (
                  <StatusChip
                    label={attuale?.etichetta || "Tutti i database"}
                    icon={coverProvider === "tutti" ? Globe : ic.Icon}
                    tone="info"
                  />
                );
              })()}
              <div className="relative min-w-[220px] flex-1">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={coverQuery}
                  onChange={(e) => setCoverQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      runCoverSearch(coverQuery);
                    }
                  }}
                  placeholder="Affina la ricerca…"
                  className="pl-9"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => runCoverSearch(coverQuery)}
                disabled={coverSearching}
              >
                {coverSearching ? (
                  <Loader2 size={15} className="mr-1.5 animate-spin" />
                ) : (
                  <RotateCw size={15} className="mr-1.5" />
                )}
                Cerca di nuovo
              </Button>
              {coverProviders.length > 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setCoverProvider(null);
                    setCoverResults([]);
                    setCoverSearched(false);
                    setCoverError(null);
                  }}
                >
                  Cambia database
                </Button>
              )}
            </div>
          )}

          {/* ----------------------------------------------------------------
              SCELTA DEL DATABASE — prima di spendere una richiesta.
              Nessuna chiamata parte finché non si sceglie: con YouTube a 100
              unità per ricerca, interrogare tutto per un video che viene da
              una sola fonte è uno spreco misurabile.
              ---------------------------------------------------------------- */}
          {!coverProvider && !coverError && (
            <div className="py-2">
              <p className="mb-1 text-base font-bold text-foreground">
                Dove vuoi cercare?
              </p>
              <p className="mb-5 text-sm text-muted-foreground">
                Nessuna richiesta viene inviata finché non scegli.
              </p>

              {coverProviders.length === 0 ? (
                <div className="rounded-xl border border-hairline bg-surface-2 p-5">
                  <p className="text-sm text-muted-foreground">
                    Nessun database online attivo.{" "}
                    <a href="/admin/covers" className="font-bold text-primary hover:underline">
                      Attivane uno in Admin › Copertine →
                    </a>
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {coverProviders.map((p) => {
                    const ic = ICONE_PROVIDER[p.icona] || ICONE_PROVIDER.database;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setCoverProvider(p.id);
                          runCoverSearch(null, null, p.id);
                        }}
                        className="group rounded-xl border border-hairline bg-surface-2 p-4 text-left transition-all hover:border-primary/60 hover:bg-surface-3"
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`flex size-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105 ${ic.colore}`}
                          >
                            <ic.Icon size={20} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-bold text-foreground">{p.etichetta}</p>
                              <StatusChip
                                label={p.gratis ? "Gratis" : "A consumo"}
                                tone={p.gratis ? "success" : "warning"}
                              />
                            </div>
                            <p className="mt-0.5 text-sm text-muted-foreground">{p.contenuti}</p>
                            <p className="mt-1.5 text-sm text-muted-foreground">{p.costo}</p>
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {coverProviders.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCoverProvider("tutti");
                        runCoverSearch(null, null, "tutti");
                      }}
                      className="rounded-xl border border-dashed border-hairline-strong bg-surface-2 p-4 text-left transition-all hover:border-primary/60 sm:col-span-2"
                    >
                      <p className="text-sm font-bold text-foreground">Cerca in tutti</p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        Più risultati, ma consuma una richiesta per ogni database attivo.
                      </p>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

            <div>
              {/* Area risultati: attiva solo dopo la scelta del database,
                  altrimenti mostrerebbe "nessun risultato" per una ricerca
                  che non e' mai partita. */}
              {!coverProvider && !coverError ? null : coverError ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
                    <AlertCircle size={26} />
                  </div>
                  <p className="text-base font-bold text-foreground">
                    Ricerca non riuscita
                  </p>
                  <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                    {coverError}
                  </p>
                  {/* Causa piu' probabile: modulo spento o token assente */}
                  {/disattivat|token/i.test(coverError) && (
                    <a
                      href="/admin/covers"
                      className="mt-1 text-sm font-bold text-primary hover:underline"
                    >
                      Vai alle impostazioni Copertine →
                    </a>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    onClick={() => runCoverSearch(coverQuery)}
                  >
                    <RotateCw size={14} className="mr-1.5" />
                    Riprova
                  </Button>
                </div>
              ) : coverSearching && coverResults.length === 0 ? (
                /* Scheletro di caricamento invece di uno spinner nudo */
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <div
                      key={i}
                      className="overflow-hidden rounded-xl border border-hairline-strong bg-surface-1"
                    >
                      <div className="aspect-video animate-pulse bg-surface-3/60" />
                      <div className="space-y-2 p-3">
                        <div className="h-3 w-3/4 animate-pulse rounded bg-surface-3" />
                        <div className="h-2 w-1/2 animate-pulse rounded bg-surface-3/70" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : coverResults.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-16 text-center">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-surface-3/60 text-muted-foreground">
                    <ImageIcon size={26} />
                  </div>
                  <p className="text-base font-bold text-foreground">
                    Nessuna copertina trovata
                  </p>
                  <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
                    Il database non ha risultati per{" "}
                    <span className="text-foreground">“{coverQuery}”</span>. Prova con il
                    nome dello studio seguito dal titolo, oppure con il nome di
                    un&apos;interprete.
                  </p>
                </div>
              ) : (
                <>
                  <p className="mb-3 text-sm text-muted-foreground">
                    {coverResults.length} risultati · clicca su una copertina per
                    applicarla subito
                    {coverQueryUsata && coverQueryUsata !== coverQuery && (
                      <span className="text-muted-foreground/70">
                        {" "}· cercato: “{coverQueryUsata}”
                      </span>
                    )}
                  </p>
                  {/* Massimo 2 colonne fino a 1280px: la copertina e' l'unica
                      cosa che conta in questa schermata, va vista grande. */}
                  <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
                    {coverResults.map((c, i) => {
                      const applicata = coverAppliedId && coverAppliedId === c.id;
                      return (
                        <button
                          key={c.id || i}
                          type="button"
                          disabled={coverApplying}
                          onClick={() => applyOnlineCover(c)}
                          className={`group relative overflow-hidden rounded-xl border text-left transition-all disabled:cursor-wait ${
                            applicata
                              ? "border-emerald-500/60 ring-2 ring-emerald-500/30"
                              : "border-hairline-strong bg-surface-1 hover:border-primary/60 hover:bg-surface-2"
                          } ${coverApplying && !applicata ? "opacity-40" : ""}`}
                        >
                          <div className="relative aspect-video bg-surface-2">
                            {c.image_url && (
                              <img
                                src={`/api/admin.php?action=proxy_immagine_online&url=${encodeURIComponent(c.image_url)}`}
                                alt={c.title}
                                loading="lazy"
                                className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                              />
                            )}

                            {/* Punteggio di affidabilita' */}
                            {typeof c.score === "number" && (
                              <span
                                className={`absolute right-2 top-2 rounded-md px-2 py-0.5 text-sm font-black shadow-lg ${
                                  c.score >= 85
                                    ? "bg-emerald-500 text-white"
                                    : c.score >= 70
                                      ? "bg-amber-500 text-white"
                                      : "bg-surface-3 text-foreground"
                                }`}
                                title="Affidabilità del riconoscimento"
                              >
                                {c.score}%
                              </span>
                            )}

                            {/* Invito all'azione in hover */}
                            <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                              <span className="rounded-lg bg-primary px-3 py-1.5 text-xs font-black uppercase tracking-wider text-white shadow-xl">
                                Usa questa
                              </span>
                            </div>

                            {applicata && (
                              <div className="absolute inset-0 flex items-center justify-center bg-emerald-950/70">
                                <span className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-white">
                                  <Check size={14} /> Applicata
                                </span>
                              </div>
                            )}
                          </div>

                          <div className="p-3">
                            <p className="line-clamp-2 text-sm font-bold text-foreground">
                              {c.title}
                            </p>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              {c.site && (
                                <Badge
                                  variant="secondary"
                                  className="bg-blue-500/10 px-1.5 py-0 text-xs font-bold uppercase text-blue-400"
                                >
                                  {c.site}
                                </Badge>
                              )}
                              {c.date && (
                                <span className="text-sm text-muted-foreground">{c.date}</span>
                              )}
                            </div>
                            {c.performers?.length > 0 && (
                              <p className="mt-1.5 line-clamp-1 text-sm text-muted-foreground">
                                {c.performers.join(", ")}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
      </ModalShell>

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
