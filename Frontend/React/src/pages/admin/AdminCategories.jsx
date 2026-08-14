import React, { useEffect, useState } from "react";
import { apiRequest } from "../../services/api";
import { getAssetUrl } from "../../services/helpers";
import { motion, AnimatePresence } from "framer-motion";
import {
  Edit,
  Upload,
  Check,
  Folder,
  FolderOpen,
  Film,
  Trash2,
  Palette,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PageShell, PageHeader, Panel, EmptyState } from "@/components/ui/layout";

const CARD_GRADIENTS = [
  "from-red-600 to-red-950",
  "from-blue-600 to-blue-950",
  "from-emerald-600 to-emerald-950",
  "from-violet-600 to-violet-950",
  "from-amber-600 to-amber-950",
  "from-pink-600 to-pink-950",
  "from-cyan-600 to-cyan-950",
  "from-indigo-600 to-indigo-950",
];

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

export default function AdminCategories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");

  const [uploadingId, setUploadingId] = useState(null);
  const [colorPickerOpen, setColorPickerOpen] = useState(null);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("/admin.php", "POST", { action: "lista_categorie" });
      if (res.success) setCategories(res.data || res.dati);
    } catch (error) {
      toast.error("Errore caricamento categorie");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);

  const startEdit = (cat) => {
    setEditingId(cat.id);
    setEditName(cat.Nome);
  };

  const saveEdit = async () => {
    try {
      await apiRequest("/admin.php", "POST", {
        action: "aggiorna_categoria",
        id: editingId,
        nome: editName,
      });
      setCategories((prev) =>
        prev.map((c) => (c.id === editingId ? { ...c, Nome: editName } : c)),
      );
      setEditingId(null);
      toast.success("Categoria aggiornata");
    } catch (error) {
      toast.error("Errore: " + error.message);
    }
  };

  const handleSaveColor = async (id, colore) => {
    try {
      await apiRequest("/admin.php", "POST", {
        action: "salva_colore_categoria",
        id_categoria: id,
        colore: colore,
      });
      toast.success("Colore aggiornato");
      setCategories((prev) =>
        prev.map((c) => (c.id === id ? { ...c, Colore_Default: colore } : c)),
      );
      setColorPickerOpen(null);
    } catch (error) {
      toast.error("Errore: " + error.message);
    }
  };

  const handleUploadBackground = async (id, file) => {
    if (!file) return;
    setUploadingId(id);

    const formData = new FormData();
    formData.append("action", "upload_sfondo_categoria");
    formData.append("id_categoria", id);
    formData.append("file_sfondo", file);

    try {
      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        setCategories((prev) =>
          prev.map((c) => (c.id === id ? { ...c, Immagine_Sfondo: res.nuovo_path } : c)),
        );
        toast.success("Sfondo aggiornato");
      }
    } catch (error) {
      toast.error("Errore upload: " + error.message);
    } finally {
      setUploadingId(null);
    }
  };

  const handleRemoveBackground = async (id) => {
    if (!window.confirm("Rimuovere lo sfondo della categoria?")) return;

    try {
      const formData = new FormData();
      formData.append("action", "rimuovi_sfondo_categoria");
      formData.append("id_categoria", id);

      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        setCategories((prev) =>
          prev.map((c) => (c.id === id ? { ...c, Immagine_Sfondo: null } : c)),
        );
        toast.success("Sfondo rimosso");
      }
    } catch (error) {
      toast.error("Errore rimozione: " + error.message);
    }
  };

  return (
    <PageShell>
      <PageHeader
        icon={FolderOpen}
        title="Categorie"
        description="Organizza i contenuti e gestisci le copertine dei cataloghi."
      />

      {!loading && categories.length === 0 && (
        <Panel>
          <EmptyState
            icon={FolderOpen}
            title="Nessuna categoria"
            description="Le categorie nascono dalle cartelle presenti nel percorso video: creane una sul disco e comparirà qui."
          />
        </Panel>
      )}

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
      >
        {loading
          ? [1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-64 animate-pulse rounded-2xl border border-hairline bg-surface-1"
              />
            ))
          : categories.map((cat) => (
              <motion.div variants={itemVariants} key={cat.id}>
                <Card className="group overflow-hidden flex flex-col h-full bg-surface-1 hover:bg-surface-2 border-hairline hover:border-hairline-strong transition-colors p-0 rounded-2xl">
                  {/* Anteprima Sfondo con Glass Overlay */}
                  <div className="relative h-48 bg-background overflow-hidden">
                    {cat.Immagine_Sfondo ? (
                      <img
                        src={`${getAssetUrl(cat.Immagine_Sfondo)}&t=${Date.now()}`}
                        alt={cat.Nome}
                        className="w-full h-full object-cover opacity-60 group-hover:opacity-80 group-hover:scale-110 transition-all duration-700"
                        onError={(e) => (e.target.style.display = "none")}
                      />
                    ) : (
                      <>
                        {cat.Colore_Default ? (
                          <>
                            <div className={`absolute inset-0 bg-gradient-to-br ${cat.Colore_Default} opacity-100 transition-colors duration-500`} />
                            <div className="absolute inset-0 opacity-50 bg-[url('https://www.transparenttextures.com/patterns/stardust.png')]" />
                            <Folder className="absolute -right-4 -bottom-8 h-32 w-32 sm:h-45 sm:w-45 text-foreground/5 -rotate-12 group-hover:-bottom-0 group-hover:-right-0 group-hover:h-40 group-hover:w-40 group-hover:rotate-0 transition-all duration-500" />
                          </>
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground bg-surface-2">
                            <Folder size={48} className="mb-2 opacity-50" />
                            <span className="text-xs font-black uppercase tracking-widest italic opacity-50">Nessuno Sfondo</span>
                          </div>
                        )}
                      </>
                    )}

                    {/* Overlay flottante per upload e rimozione */}
                    <div className={`absolute top-4 right-4 z-20 md:-translate-y-[150%] md:opacity-0 md:pointer-events-none translate-y-0 opacity-100 pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto transition-all duration-300 flex gap-2 ${colorPickerOpen === cat.id ? "!translate-y-0 !opacity-100 !pointer-events-auto" : ""}`}>
                      {cat.Immagine_Sfondo && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleRemoveBackground(cat.id)}
                          className="w-10 h-10 rounded-2xl bg-background/80 backdrop-blur-md border-hairline-strong text-muted-foreground hover:text-red-500 hover:bg-red-500/10 hover:border-red-500/50"
                          title="Rimuovi Sfondo"
                        >
                          <Trash2 size={18} />
                        </Button>
                      )}

                      <Label className="w-10 h-10 flex items-center justify-center rounded-2xl bg-background/80 backdrop-blur-md border border-hairline-strong text-muted-foreground hover:text-white cursor-pointer transition-all active:scale-90 hover:bg-primary hover:border-primary m-0">
                        {uploadingId === cat.id ? (
                          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                          <Upload size={18} />
                        )}
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*"
                          onChange={(e) => handleUploadBackground(cat.id, e.target.files[0])}
                          disabled={uploadingId === cat.id}
                        />
                      </Label>

                      {!cat.Immagine_Sfondo && (
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => setColorPickerOpen(colorPickerOpen === cat.id ? null : cat.id)}
                          className="w-10 h-10 rounded-2xl bg-background/80 backdrop-blur-md border-hairline-strong text-muted-foreground hover:text-white hover:bg-emerald-500 hover:border-emerald-500"
                          title="Scegli Colore"
                        >
                          <Palette size={18} />
                        </Button>
                      )}
                    </div>

                    {/* Selezione Colore in Overlay */}
                    <AnimatePresence>
                      {colorPickerOpen === cat.id && !cat.Immagine_Sfondo && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="absolute inset-0 bg-background/90 backdrop-blur-sm z-30 flex flex-col p-3"
                        >
                          <div className="flex justify-between items-center mb-2 border-b border-hairline-strong pb-2">
                            <span className="text-xs font-black uppercase tracking-widest text-muted-foreground">Tinta Unita</span>
                            <button onClick={() => setColorPickerOpen(null)} className="text-muted-foreground hover:text-white"><X size={16} /></button>
                          </div>
                          <div className="flex-1 overflow-y-auto no-scrollbar" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
                            <div className="grid grid-cols-5 gap-4 px-6 py-4 content-start">
                              <button
                                onClick={() => handleSaveColor(cat.id, "")}
                                className={`w-11 h-11 rounded-xl bg-surface-3 transition-all flex items-center justify-center outline-none shrink-0 relative ${!cat.Colore_Default ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "hover:scale-105"}`}
                                title="Predefinito / Nessuno"
                              >
                                {!cat.Colore_Default && <Check size={20} className="text-primary" />}
                              </button>
                              {CARD_GRADIENTS.map((grad, i) => (
                                <button
                                  key={i}
                                  onClick={() => handleSaveColor(cat.id, grad)}
                                  className={`w-11 h-11 rounded-xl bg-gradient-to-br ${grad} transition-all flex items-center justify-center outline-none shrink-0 relative ${cat.Colore_Default === grad ? "ring-2 ring-white ring-offset-2 ring-offset-background scale-105 z-10" : "hover:scale-105"}`}
                                >
                                  {cat.Colore_Default === grad && <Check size={22} className="text-white drop-shadow-md" />}
                                </button>
                              ))}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Titolo in overlay */}
                    <div className="absolute inset-0 p-6 flex items-end bg-gradient-to-t from-background/95 to-transparent pointer-events-none">
                      <div className="w-full pointer-events-auto">
                        {editingId === cat.id ? (
                          <div className="flex items-center gap-2 animate-in slide-in-from-bottom-2 duration-300">
                            <Input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              className="bg-background/80 backdrop-blur-xl border-primary/50 text-white font-bold h-10"
                              autoFocus
                              onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                            />
                            <Button onClick={saveEdit} size="icon" className="w-10 h-10 rounded-xl flex-shrink-0 shadow-lg">
                              <Check size={18} />
                            </Button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between group/title">
                            <h3 className="font-black text-2xl text-white tracking-tight drop-shadow-2xl">{cat.Nome}</h3>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => startEdit(cat)}
                              className="opacity-100 translate-x-0 md:opacity-0 group-hover:opacity-100 md:translate-x-2 group-hover:translate-x-0 transition-all duration-300 w-8 h-8 bg-foreground/10 backdrop-blur-md rounded-lg text-white hover:bg-foreground hover:text-background"
                            >
                              <Edit size={14} />
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Info Footer */}
                  <CardContent className="p-6 bg-surface-2 flex items-center justify-between mt-auto">
                    <div className="flex items-center gap-2">
                      <div className="p-2 bg-surface-3 rounded-lg text-muted-foreground">
                        <Film size={14} />
                      </div>
                      <span className="text-xs font-black text-muted-foreground uppercase tracking-widest">
                        {cat.num_video} Contenuti
                      </span>
                    </div>
                    <div className="px-3 py-1.5 bg-surface-3 rounded-full border border-hairline text-xs font-black text-muted-foreground tracking-widest uppercase">
                      ID #{cat.id}
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
      </motion.div>
    </PageShell>
  );
}
