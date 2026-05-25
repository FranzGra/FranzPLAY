import React, { useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { apiRequest } from "../../services/api";
import { getAssetUrl, hasAsset } from "../../services/helpers";
import ImageCropper from "../../components/ImageCropper";
import ThumbnailPlaceholder from "../../components/ThumbnailPlaceholder";

/**
 * Miniatura copertina per la dashboard admin.
 * - Se la copertina è presente e si carica → mostra l'immagine.
 * - Se è "mancante" (asset perso o cancellato) → placeholder statico.
 * - Se è ancora null (worker_assets non ha ancora generato) → placeholder
 *   con label "In elaborazione…" così l'admin capisce che è in coda,
 *   invece di vedere un quadrato nero senza contesto.
 */
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
      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Slot drag-and-drop per la copertina o l'anteprima nel modale di modifica.
 * Stati gestiti:
 * - selectedFile presente → anteprima del file appena scelto (in attesa di Salva).
 * - asset presente e caricabile → mostra l'asset reale + hint hover.
 * - asset null (worker in coda) → placeholder gradient con spinner "In elaborazione…".
 * - asset "mancante" o load failed → placeholder + label "Trascina per caricare".
 * Bottone "Rigenera" (top-right) chiama onRegenerate: il chiamante deve
 * rimuovere l'asset dal DB e settare lo state locale a `null` per far
 * comparire subito lo spinner.
 */
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
  // Reset del flag quando cambia il video o l'asset (es. dopo upload o rigenerazione).
  useEffect(() => {
    setLoadFailed(false);
  }, [assetPath]);

  const hasReal = hasAsset(assetPath) && !loadFailed;
  // "In elaborazione" = path NULL nel DB. Distinguiamo da "mancante" che indica
  // un asset volutamente assente / file perso senza essere in coda di rigenerazione.
  const isProcessing = !hasReal && !selectedFile && (assetPath === null || assetPath === undefined);
  const showRegenerateBtn = !selectedFile && assetPath && assetPath !== "mancante";
  const Icon = isVideo ? Film : ImageIcon;

  return (
    <div className="group relative aspect-video rounded-3xl bg-zinc-950 border-2 border-dashed border-zinc-800 transition-all hover:border-primary/30 overflow-hidden cursor-pointer">
      <input
        type="file"
        onChange={onSelectFile}
        className="absolute inset-0 opacity-0 cursor-pointer z-10"
        accept={acceptTypes}
      />

      {/* LAYER 1: contenuto principale (asset reale, preview file, o placeholder) */}
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
        // Placeholder: niente asset reale, niente file in attesa.
        // Mostra gradient + icona + label + (eventuale) spinner di elaborazione.
        <div
          className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-4 text-center"
          style={{
            background:
              "radial-gradient(circle at 30% 20%, rgba(220,38,38,0.12) 0%, transparent 50%), radial-gradient(circle at 70% 80%, rgba(99,102,241,0.08) 0%, transparent 50%), linear-gradient(135deg, hsl(220,25%,14%) 0%, hsl(240,30%,8%) 100%)",
          }}
        >
          <Icon size={32} className="text-zinc-500 mb-2" strokeWidth={1.5} />
          <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wide">{dragLabel}</p>
          {isProcessing ? (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-400 font-semibold">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>In elaborazione…</span>
            </div>
          ) : assetPath === "mancante" ? (
            <p className="mt-1 text-[9px] text-zinc-600 uppercase">Asset mancante</p>
          ) : loadFailed ? (
            <p className="mt-1 text-[9px] text-red-400 uppercase">File non trovato — rigenera</p>
          ) : null}
        </div>
      )}

      {/* LAYER 2: hint hover quando l'asset reale e' presente (asset di sfondo, drag-to-replace overlay) */}
      {!selectedFile && hasReal ? (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center pointer-events-none p-4 text-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
          <Upload className="text-white mb-1" size={24} />
          <p className="text-[10px] font-bold text-white uppercase tracking-wide">{dragLabel}</p>
        </div>
      ) : null}

      {/* LAYER 3: bottone "Rigenera" (visibile se c'e' un path persistito o "mancante") */}
      {showRegenerateBtn ? (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRegenerate();
          }}
          className="absolute top-2 right-2 z-20 p-2.5 bg-amber-500/15 text-amber-300 border border-amber-500/30 rounded-xl hover:bg-amber-500 hover:text-white transition-all hover:scale-105 active:scale-90 flex items-center justify-center shadow-lg"
          title="Rimuovi e rigenera automaticamente"
        >
          <RotateCw size={16} />
        </button>
      ) : null}
    </div>
  );
}
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
} from "lucide-react";

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
    return { key: "ok", label: "Ottimizzato", Icon: ShieldCheck, color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", tooltip: "Remuxato in fMP4 faststart, streaming cross-device garantito" };
  }
  if (opt === 0 || opt === "0") {
    if (cv && !VIDEO_CODECS_OK.includes(cv)) {
      return { key: "ko", label: "Non compatibile", Icon: ShieldX, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", tooltip: `Codec video ${cv.toUpperCase()} non supportato su iOS Safari` };
    }
    if (ca && !AUDIO_CODECS_OK.includes(ca)) {
      return { key: "partial", label: "Parziale", Icon: ShieldAlert, color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", tooltip: `Audio ${ca.toUpperCase()} non compatibile - richiede re-encode` };
    }
    return { key: "ko", label: "Non compatibile", Icon: ShieldX, color: "text-red-400", bg: "bg-red-500/10", border: "border-red-500/20", tooltip: "Worker ha scartato il video (codec non supportato)" };
  }
  // opt === null/undefined: distinguiamo "mai analizzato" da "in coda attiva"
  if (!cv && !ca) {
    return { key: "unknown", label: "Da analizzare", Icon: Hourglass, color: "text-zinc-400", bg: "bg-zinc-500/10", border: "border-zinc-500/20", tooltip: "Worker optimizer non ha ancora processato questo video" };
  }
  return { key: "pending", label: "In coda", Icon: Clock, color: "text-sky-400", bg: "bg-sky-500/10", border: "border-sky-500/20", tooltip: "In attesa del worker optimizer" };
}

function MetaBadge({ Icon, label, color = "text-zinc-300", bg = "bg-zinc-950/60", border = "border-white/5", title }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border ${border} ${bg} ${color} text-[10px] font-black uppercase tracking-widest`}
    >
      {Icon && <Icon size={11} />}
      {label}
    </span>
  );
}

export default function AdminVideos() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [search, setSearch] = useState("");
  const [editingVideo, setEditingVideo] = useState(null);
  const [categories, setCategories] = useState([]);
  const [viewMode, setViewMode] = useState("grid"); // 'grid' o 'table'
  const [cropImage, setCropImage] = useState(null); // Stato per l'immagine da ritagliare

  const searchTimeout = useRef(null);

  const [notification, setNotification] = useState(null);

  const showNotification = (message, type = "success") => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 3000);
  };

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
      console.error(error);
      showNotification("Errore caricamento video", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVideos();
  }, [page, itemsPerPage]);

  const isFirstMount = useRef(true);

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

  const handleDelete = async (id) => {
    if (
      !window.confirm(
        "Sei sicuro di voler eliminare questo video? L'azione è irreversibile.",
      )
    )
      return;

    try {
      await apiRequest("/admin.php", "POST", {
        action: "elimina_video",
        id_video: id,
      });
      setVideos((prev) => prev.filter((v) => v.id !== id));
      showNotification("Video eliminato con successo");
    } catch (error) {
      showNotification("Errore eliminazione: " + error.message, "error");
    }
  };

  const handleReoptimize = async () => {
    if (!editingVideo) return;
    if (!confirm("Ri-accodare il video per l'ottimizzazione? Il worker lo riprocessera al prossimo poll.")) return;
    try {
      await apiRequest("/admin.php", "POST", {
        action: "reottimizza_video",
        id: editingVideo.id,
      });
      showNotification("Video ri-accodato per ottimizzazione");
      setEditingVideo(null);
      fetchVideos();
    } catch (error) {
      showNotification("Errore re-enqueue: " + error.message, "error");
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
      showNotification("Video aggiornato con successo");
      fetchVideos();
    } catch (error) {
      showNotification("Errore aggiornamento: " + error.message, "error");
    }
  };

  /**
   * Gestisce la selezione del file di copertina.
   * Invece di settarlo direttamente, lo legge come DataURL e apre il Cropper.
   */
  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setCropImage(reader.result);
    });
    reader.readAsDataURL(file);
    e.target.value = null; // Reset input per permettere di riselezionare lo stesso file
  };

  /**
   * Callback chiamata quando il ritaglio è completato.
   * Salva il blob nel "newCoverFile" dell'editingVideo e chiude il cropper.
   */
  const handleCropComplete = (croppedBlob) => {
    setEditingVideo((prev) => ({
      ...prev,
      newCoverFile: croppedBlob,
    }));
    setCropImage(null);
  };

  const handleRemoveCover = async () => {
    if (!editingVideo || !editingVideo.percorso_copertina) return;
    if (
      !window.confirm(
        "Rimuovere la copertina attuale? Verrà ricreata automaticamente dal worker.",
      )
    )
      return;

    try {
      const formData = new FormData();
      formData.append("action", "rimuovi_copertina");
      formData.append("id_video", editingVideo.id);

      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        // Stato locale a NULL (non "mancante"): il backend ha settato NULL nel DB
        // → worker_assets riprenderà il video al prossimo poll. Lo spinner
        // "In elaborazione…" appare subito nello slot del modale e nella griglia.
        setEditingVideo((prev) => ({ ...prev, percorso_copertina: null }));
        setVideos((prev) =>
          prev.map((v) =>
            v.id === editingVideo.id ? { ...v, percorso_copertina: null } : v,
          ),
        );
        showNotification("Copertina in coda di rigenerazione");
      }
    } catch (error) {
      showNotification("Errore rimozione: " + error.message, "error");
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
    if (
      !window.confirm(
        "Rimuovere l'anteprima attuale? Verrà ricreata automaticamente dal worker.",
      )
    )
      return;

    try {
      const formData = new FormData();
      formData.append("action", "rimuovi_anteprima");
      formData.append("id_video", editingVideo.id);

      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        // Vedi commento in handleRemoveCover: state a null per mostrare subito
        // "In elaborazione…" mentre worker_assets rigenera.
        setEditingVideo((prev) => ({ ...prev, percorso_anteprima: null }));
        setVideos((prev) =>
          prev.map((v) =>
            v.id === editingVideo.id ? { ...v, percorso_anteprima: null } : v,
          ),
        );
        showNotification("Anteprima in coda di rigenerazione");
      }
    } catch (error) {
      showNotification("Errore rimozione anteprima: " + error.message, "error");
    }
  };

  return (
    <div className="space-y-8 page-enter relative">
      {/* Toast Notification - Portal */}
      {notification &&
        createPortal(
          <div
            className={`fixed top-6 right-6 z-[9999] px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3 toast-enter ${notification.type === "error" ? "bg-red-500 text-white" : "bg-zinc-900 text-white border border-white/10"}`}
          >
            {notification.type === "error" ? (
              <AlertCircle size={20} />
            ) : (
              <Check size={20} className="text-green-400" />
            )}
            <span className="font-bold text-sm">{notification.message}</span>
          </div>,
          document.body,
        )}

      {/* Header section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-white tracking-tight">
            Gestione Video
          </h1>
          <p className="text-zinc-500 font-medium mt-1">
            Modifica, aggiorna o rimuovi i contenuti multimediali.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* View Switcher */}
          <div className="flex bg-zinc-900/50 p-1.5 rounded-2xl border border-white/5 backdrop-blur-md">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2.5 rounded-xl transition-all duration-300 ${viewMode === "grid" ? "bg-primary text-white shadow-lg shadow-primary/20" : "text-zinc-500 hover:text-zinc-300"}`}
              title="Vista Griglia"
            >
              <LayoutGrid size={20} />
            </button>
            <button
              onClick={() => setViewMode("table")}
              className={`p-2.5 rounded-xl transition-all duration-300 ${viewMode === "table" ? "bg-primary text-white shadow-lg shadow-primary/20" : "text-zinc-500 hover:text-zinc-300"}`}
              title="Vista Tabella"
            >
              <List size={20} />
            </button>
          </div>

          <div className="relative min-w-[130px] z-20">
            <details className="group relative w-full">
              <summary className="w-full bg-zinc-900/50 border border-white/5 rounded-2xl py-2.5 px-4 text-zinc-300 focus:outline-none focus:border-white/20 transition-all font-bold text-sm list-none flex justify-between items-center cursor-pointer marker:content-none backdrop-blur-md">
                {itemsPerPage} / pag
                <ChevronRight
                  className="transition-transform group-open:rotate-90 text-zinc-600 pointer-events-none ml-2"
                  size={16}
                />
              </summary>
              <div className="absolute top-full left-0 w-full mt-2 py-2 bg-zinc-900 border border-white/5 rounded-2xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                {[25, 50, 100, 200].map((val) => (
                  <div
                    key={val}
                    className={`px-4 py-2.5 cursor-pointer hover:bg-zinc-800 transition-colors text-sm font-bold ${itemsPerPage === val ? "text-primary" : "text-zinc-300"}`}
                    onClick={(e) => {
                      setItemsPerPage(val);
                      setPage(0);
                      e.target.closest("details").removeAttribute("open");
                    }}
                  >
                    {val} / pag
                  </div>
                ))}
              </div>
            </details>
          </div>

          <div className="relative group w-full md:w-80">
            <Search
              className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-primary transition-colors"
              size={18}
            />
            <input
              type="text"
              placeholder="Cerca per titolo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-zinc-900/50 backdrop-blur-md border border-white/5 rounded-2xl pl-12 pr-4 py-3 focus:border-primary/50 outline-none text-zinc-100 transition-all placeholder:text-zinc-600 focus:bg-zinc-900"
            />
          </div>
        </div>
      </div>

      {/* Grid display */}
      <div className="min-h-[400px]">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div
                key={i}
                className="aspect-video bg-zinc-900/50 rounded-3xl animate-pulse"
              ></div>
            ))}
          </div>
        ) : videos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 admin-card border-zinc-800/50 border-dashed">
            <Film size={48} className="text-zinc-700 mb-4" />
            <p className="text-zinc-500 font-bold">Nessun video trovato.</p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {videos.map((video) => (
              <div
                key={video.id}
                className="admin-card group !p-3 flex flex-col h-full bg-zinc-900/20 hover:bg-zinc-900/40"
              >
                {/* Thumbnail */}
                <div className="relative aspect-video rounded-2xl overflow-hidden bg-zinc-950 mb-4 ring-1 ring-white/5">
                  <AdminCoverThumb video={video} />
                </div>

                {/* Info */}
                <div className="px-2 flex-col flex-1 flex">
                  <h3
                    className="text-white font-bold text-sm truncate mb-3 leading-tight"
                    title={video.Titolo}
                  >
                    {video.Titolo}
                  </h3>

                  {(() => {
                    const st = getCompatibilityStatus(video);
                    const q = getQualityLabel(video.altezza_video);
                    return (
                      <div className="flex flex-wrap items-center gap-1.5 mb-3">
                        <MetaBadge Icon={st.Icon} label={st.label} color={st.color} bg={st.bg} border={st.border} title={st.tooltip} />
                        {q && <MetaBadge label={q} title="Risoluzione" />}
                        {video.Formato && <MetaBadge label={video.Formato} title="Formato file" />}
                        {video.Durata && <MetaBadge Icon={Clock} label={video.Durata} title="Durata" />}
                      </div>
                    );
                  })()}

                  <div className="flex items-center justify-between mb-4 mt-auto">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 bg-zinc-950/50 px-2 py-1 rounded-lg border border-white/5 truncate max-w-[50%]">
                      {video.Nome_Categoria || "NESSUNA"}
                    </span>
                    <div className="flex items-center gap-3 text-zinc-500 text-[10px] font-bold">
                      <span className="flex items-center gap-1">
                        <ThumbsUp size={12} /> {video.Likes || 0}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 w-full pt-3 border-t border-white/5">
                    <button
                      onClick={() => setEditingVideo({ ...video })}
                      className="flex-1 bg-zinc-800 text-white py-2.5 rounded-xl font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 hover:bg-white hover:text-black active:scale-95 transition-all"
                    >
                      <Edit size={14} /> Modifica
                    </button>
                    <button
                      onClick={() => handleDelete(video.id)}
                      className="w-12 h-auto shrink-0 flex items-center justify-center bg-red-500/10 text-red-500 rounded-xl hover:bg-red-500 hover:text-white active:scale-95 transition-all"
                      title="Elimina Video"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* Table View */
          <div className="admin-card !p-0 overflow-hidden border-white/5 bg-zinc-900/10">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-zinc-900/50 border-b border-white/5">
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Video
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Categoria
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                      Info
                    </th>
                    <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 text-right">
                      Azioni
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {videos.map((video) => (
                    <tr
                      key={video.id}
                      className="group hover:bg-white/5 transition-colors"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-4">
                          <div className="relative w-20 aspect-video rounded-lg overflow-hidden bg-zinc-950 ring-1 ring-white/10 flex-shrink-0">
                            <AdminCoverThumb video={video} />
                          </div>
                          <div>
                            <h3
                              className="text-white font-bold text-sm leading-tight max-w-[300px] truncate"
                              title={video.Titolo}
                            >
                              {video.Titolo}
                            </h3>
                            <p className="text-[10px] font-black text-zinc-600 uppercase tracking-tighter mt-1">
                              ID: #{video.id}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-400 bg-zinc-950/50 px-2.5 py-1.5 rounded-lg border border-white/5">
                          {video.Nome_Categoria || "NESSUNA"}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        {(() => {
                          const st = getCompatibilityStatus(video);
                          const q = getQualityLabel(video.altezza_video);
                          return (
                            <div className="flex flex-wrap items-center gap-1.5 max-w-[260px]">
                              <MetaBadge Icon={st.Icon} label={st.label} color={st.color} bg={st.bg} border={st.border} title={st.tooltip} />
                              {q && <MetaBadge label={q} title="Risoluzione" />}
                              {video.Formato && <MetaBadge label={video.Formato} title="Formato file" />}
                              {video.Durata && <MetaBadge Icon={Clock} label={video.Durata} title="Durata" />}
                              <MetaBadge Icon={ThumbsUp} label={video.Likes || 0} title="Likes" />
                            </div>
                          );
                        })()}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-3 md:gap-2">
                          <button
                            onClick={() => setEditingVideo({ ...video })}
                            className="w-12 h-12 md:w-auto md:h-auto md:p-2.5 flex items-center justify-center shrink-0 rounded-xl bg-zinc-800 text-zinc-400 hover:bg-white hover:text-black transition-all active:scale-90"
                            title="Modifica"
                          >
                            <Edit size={20} className="md:w-4 md:h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(video.id)}
                            className="w-12 h-12 md:w-auto md:h-auto md:p-2.5 flex items-center justify-center shrink-0 rounded-xl bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all active:scale-90"
                            title="Elimina"
                          >
                            <Trash2 size={20} className="md:w-4 md:h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!loading &&
        videos.length > 0 &&
        (page > 0 || videos.length === itemsPerPage) && (
          <div className="flex items-center justify-center gap-6 pt-10">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="w-12 h-12 flex items-center justify-center rounded-2xl bg-zinc-900 border border-white/5 hover:bg-zinc-800 disabled:opacity-20 transition-all active:scale-90 text-white"
            >
              <ChevronLeft size={20} />
            </button>
            <div className="glass-card px-6 py-2 rounded-2xl border-white/5 font-black text-sm text-zinc-400">
              PAGINA <span className="text-white">{page + 1}</span>
            </div>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={videos.length < itemsPerPage}
              className="w-12 h-12 flex items-center justify-center rounded-2xl bg-zinc-900 border border-white/5 hover:bg-zinc-800 disabled:opacity-20 transition-all active:scale-90 text-white"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        )}

      {/* MODALE DI MODIFICA (Wider & Cleaner) - Portal */}
      {editingVideo &&
        createPortal(
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 md:p-6 bg-black/60 backdrop-blur-xl animate-in fade-in duration-200">
            <div className="w-full max-w-7xl bg-zinc-950 border border-white/10 rounded-3xl shadow-2xl relative overflow-hidden flex flex-col max-h-full animate-in zoom-in-95 duration-300">
              {/* Modal Header */}
              <div className="px-8 py-4 flex justify-between items-center bg-zinc-900/50 border-b border-white/5 shrink-0">
                <div className="min-w-0">
                  <h2 className="text-2xl font-black text-white tracking-tight">
                    Setup Video
                  </h2>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest">
                      ID: #{editingVideo.id}
                    </p>
                    {(() => {
                      const st = getCompatibilityStatus(editingVideo);
                      const q = getQualityLabel(editingVideo.altezza_video);
                      return (
                        <>
                          <MetaBadge Icon={st.Icon} label={st.label} color={st.color} bg={st.bg} border={st.border} title={st.tooltip} />
                          {q && <MetaBadge label={q} title="Risoluzione" />}
                          {editingVideo.Formato && <MetaBadge label={editingVideo.Formato} title="Formato file" />}
                          {editingVideo.Durata && <MetaBadge Icon={Clock} label={editingVideo.Durata} title="Durata" />}
                          {editingVideo.codec_video && <MetaBadge Icon={Film} label={editingVideo.codec_video.toUpperCase()} title="Codec video" />}
                          {editingVideo.codec_audio && <MetaBadge Icon={Zap} label={editingVideo.codec_audio.toUpperCase()} title="Codec audio" />}
                        </>
                      );
                    })()}
                  </div>
                </div>
                <button
                  onClick={() => setEditingVideo(null)}
                  className="w-10 h-10 flex items-center justify-center rounded-2xl bg-zinc-900 hover:bg-red-500/20 hover:text-red-500 text-zinc-400 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Modal Body */}
              <form onSubmit={handleSaveEdit} className="flex flex-col flex-1 min-h-0">
                <div className="overflow-y-auto custom-scrollbar p-6 flex-1 min-h-0 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 px-1">
                          Titolo Video
                        </label>
                        <input
                          type="text"
                          value={editingVideo.Titolo}
                          onChange={(e) =>
                            setEditingVideo({
                              ...editingVideo,
                              Titolo: e.target.value,
                            })
                          }
                          className="w-full bg-zinc-900/50 border border-white/5 rounded-2xl px-4 py-3.5 text-white focus:outline-none focus:border-primary/50 focus:bg-zinc-900 transition-all font-bold placeholder:text-zinc-700"
                          required
                        />
                      </div>
                    </div>

                    <div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 px-1">
                          Sposta Categoria
                        </label>
                        <details className="group relative w-full">
                          <summary className="w-full bg-zinc-900/50 border border-white/5 rounded-2xl px-4 py-3.5 text-white focus:outline-none focus:border-primary/50 transition-all font-bold list-none flex justify-between items-center cursor-pointer marker:content-none">
                            {categories.find(
                              (c) =>
                                String(c.id) ===
                                String(editingVideo.id_Categoria),
                            )?.Nome || "Seleziona Categoria"}
                            <ChevronRight
                              className="transition-transform group-open:rotate-90 text-zinc-600 pointer-events-none"
                              size={16}
                            />
                          </summary>
                          <div className="absolute top-full left-0 w-full mt-2 py-2 bg-zinc-900 border border-white/5 rounded-2xl shadow-xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                            {categories.map((cat) => (
                              <div
                                key={cat.id}
                                className={`px-4 py-3 cursor-pointer hover:bg-zinc-800 transition-colors font-bold ${String(editingVideo.id_Categoria) === String(cat.id) ? "text-primary" : "text-zinc-300"}`}
                                onClick={(e) => {
                                  setEditingVideo({
                                    ...editingVideo,
                                    id_Categoria: cat.id,
                                  });
                                  e.target
                                    .closest("details")
                                    .removeAttribute("open");
                                }}
                              >
                                {cat.Nome}
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 px-1">
                        Cover Art
                      </label>
                      <AdminAssetSlot
                        assetPath={editingVideo.percorso_copertina}
                        isVideo={false}
                        title={editingVideo.Titolo}
                        selectedFile={editingVideo.newCoverFile}
                        onSelectFile={handleFileSelect}
                        onRegenerate={handleRemoveCover}
                        acceptTypes="image/*"
                        dragLabel="Trascina Immagine"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2 px-1">
                        Anteprima (Video)
                      </label>
                      <AdminAssetSlot
                        assetPath={editingVideo.percorso_anteprima}
                        isVideo={true}
                        title={editingVideo.Titolo}
                        selectedFile={editingVideo.newPreviewFile}
                        onSelectFile={handlePreviewSelect}
                        onRegenerate={handleRemovePreview}
                        acceptTypes="video/mp4,video/webm,image/gif,image/webp"
                        dragLabel="Trascina .MP4 / .GIF"
                      />
                    </div>
                  </div>

                </div>
                <div className="px-6 py-4 flex flex-wrap gap-3 border-t border-white/5 bg-zinc-900/50 shrink-0">
                  <button
                    type="button"
                    onClick={handleReoptimize}
                    className="px-4 py-3.5 rounded-2xl border border-sky-500/30 bg-sky-500/10 text-sky-400 font-bold hover:bg-sky-500 hover:text-white hover:border-sky-500 transition-all active:scale-[0.98] flex items-center gap-2"
                    title="Re-accoda il video al worker_optimizer"
                  >
                    <RotateCw size={16} />
                    Ri-ottimizza
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingVideo(null)}
                    className="flex-1 px-4 py-3.5 rounded-2xl border border-zinc-800 text-zinc-400 font-bold hover:bg-zinc-900 hover:text-white transition-all active:scale-[0.98]"
                  >
                    Annulla
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-3.5 rounded-2xl bg-primary text-white font-black uppercase tracking-widest text-xs shadow-lg shadow-primary/20 hover:brightness-110 transition-all active:scale-[0.98]"
                  >
                    Applica modifiche
                  </button>
                </div>
              </form>
            </div>
          </div>,
          document.body,
        )}

      {/* CROPPER MODAL */}
      {cropImage && (
        <ImageCropper
          imageSrc={cropImage}
          onCropComplete={handleCropComplete}
          onCancel={() => setCropImage(null)}
          aspect={16 / 9} // Forza aspetto 16:9 per i video
          cropShape="rect"
        />
      )}
    </div>
  );
}
