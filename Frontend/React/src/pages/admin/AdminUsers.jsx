import React, { useEffect, useState } from "react";
import { apiRequest } from "../../services/api";
import { getUserAvatarUrl } from "../../services/helpers";
import { motion } from "framer-motion";
import {
  Trash2,
  Shield,
  ShieldOff,
  User,
  Calendar,
  Key,
  Eye,
  EyeOff,
  UserPlus,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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

export default function AdminUsers() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);

  const [showAddUserModal, setShowAddUserModal] = useState(false);
  const [newUser, setNewUser] = useState({
    username: "",
    password: "",
    isAdmin: false,
  });

  const [resetPasswordUserId, setResetPasswordUserId] = useState(null);
  const [resetPasswordField, setResetPasswordField] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await apiRequest("/admin.php", "POST", { action: "lista_utenti" });
      if (res.success) {
        setUsers(res.data || res.dati);
      }
    } catch (error) {
      toast.error("Errore caricamento utenti");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAddUser = async (e) => {
    e.preventDefault();
    try {
      await apiRequest("/admin.php", "POST", {
        action: "aggiungi_utente",
        username: newUser.username,
        password: newUser.password,
        is_admin: newUser.isAdmin,
      });
      toast.success("Utente creato con successo");
      setShowAddUserModal(false);
      setNewUser({ username: "", password: "", isAdmin: false });
      fetchUsers();
    } catch (error) {
      toast.error("Errore: " + error.message);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!resetPasswordField || resetPasswordField.length < 4) {
      toast.error("La password deve avere almeno 4 caratteri.");
      return;
    }

    setIsResetting(true);
    try {
      const formData = new FormData();
      formData.append("action", "reset_password_utente");
      formData.append("id_utente", resetPasswordUserId);
      formData.append("nuova_password", resetPasswordField);

      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        toast.success("Password reimpostata con successo.");
        setResetPasswordUserId(null);
        setResetPasswordField("");
        setShowResetPassword(false);
      } else {
        toast.error(res.message || "Impossibile ripristinare la password.");
      }
    } catch (error) {
      toast.error("Errore critico durante l'operazione.");
    } finally {
      setIsResetting(false);
    }
  };

  const handleToggleAdmin = async (id, currentStatus) => {
    if (id === currentUser.id) {
      toast.error("Non puoi modificare i tuoi permessi da qui.");
      return;
    }

    const actionName = currentStatus === "1" ? "rimuovere" : "concedere";
    if (!window.confirm(`Sei sicuro di voler ${actionName} i privilegi di Admin?`)) return;

    try {
      await apiRequest("/admin.php", "POST", {
        action: "toggle_admin",
        id_utente: id,
      });
      setUsers((prev) =>
        prev.map((u) => (u.id === id ? { ...u, Admin: u.Admin == "1" ? "0" : "1" } : u))
      );
      toast.success(`Permessi ${actionName === "rimuovere" ? "rimossi" : "concessi"} con successo`);
    } catch (error) {
      toast.error("Errore: " + error.message);
    }
  };

  const handleDeleteUser = async (id) => {
    if (id === currentUser.id) return;
    if (!window.confirm("Attenzione: Questa azione eliminerà permanentemente l'utente e tutti i suoi dati. Continuare?")) return;

    try {
      await apiRequest("/admin.php", "POST", {
        action: "elimina_utente",
        id_utente: id,
      });
      setUsers((prev) => prev.filter((u) => u.id !== id));
      toast.success("Utente eliminato definitivamente");
    } catch (error) {
      toast.error("Errore: " + error.message);
    }
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-foreground tracking-tight">Gestione Utenti</h1>
          <p className="text-muted-foreground font-medium mt-1">Amministra i permessi e gli accessi alla piattaforma.</p>
        </div>
        <Button onClick={() => setShowAddUserModal(true)} className="gap-2 shadow-lg shadow-primary/20">
          <UserPlus size={18} />
          Aggiungi Utente
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {loading ? (
          [1, 2, 3].map((i) => (
            <Card key={i} className="h-48 bg-zinc-900/50 rounded-3xl animate-pulse border-white/5" />
          ))
        ) : users.length === 0 ? (
          <Card className="col-span-full flex flex-col items-center justify-center py-20 bg-transparent border-dashed border-zinc-800">
            <User size={48} className="text-zinc-700 mb-4" />
            <p className="text-zinc-500 font-bold">Nessun utente trovato.</p>
          </Card>
        ) : (
          users.map((u) => {
            const isAdmin = u.Admin == "1";
            const isMe = u.id === currentUser?.id;

            return (
              <motion.div variants={itemVariants} key={u.id}>
                <Card className="group relative overflow-hidden flex flex-col h-full gap-0 py-0 bg-zinc-900/40 hover:bg-zinc-900/80 border-white/5 hover:border-white/10 transition-colors">
                  <CardContent className="p-5 flex-1 flex flex-col gap-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className={`w-14 h-14 shrink-0 rounded-2xl flex items-center justify-center overflow-hidden transition-all duration-300 ${isAdmin ? "bg-primary text-white shadow-lg shadow-primary/25" : "bg-zinc-800 text-zinc-500"}`}>
                          {u.Immagine_Profilo ? (
                            <img
                              src={u.Immagine_Profilo.startsWith("http") ? u.Immagine_Profilo : `${getUserAvatarUrl(u.Immagine_Profilo)}?t=${Date.now()}`}
                              alt={u.Nome_Utente}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-xl font-black uppercase opacity-40">
                              {u.Nome_Utente?.substring(0, 2)}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-lg text-foreground truncate">{u.Nome_Utente}</h3>
                          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mt-0.5">ID #{u.id}</p>
                        </div>
                      </div>
                      {isAdmin ? (
                        <Badge variant="default" className="shrink-0 text-[10px] font-black tracking-widest bg-primary/20 text-primary hover:bg-primary/30 gap-1 border-primary/20">
                          <Shield size={12} /> PRO
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="shrink-0 text-[10px] font-black tracking-widest text-zinc-500 bg-zinc-950/50 border-white/5">
                          UTENTE
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground bg-zinc-950/40 px-3.5 py-3 rounded-xl border border-white/5">
                      <Calendar size={14} className="opacity-50 shrink-0" />
                      <span className="shrink-0">Ultimo Accesso:</span>
                      <span className="text-zinc-300 truncate">{u.ultimo_Accesso || "Mai"}</span>
                    </div>
                  </CardContent>

                  {!isMe ? (
                    <CardFooter className="p-4 gap-2 border-t border-white/5 mt-auto bg-zinc-950/30">
                      <Button
                        variant={isAdmin ? "secondary" : "default"}
                        size="sm"
                        className="flex-1 font-bold text-xs"
                        onClick={() => handleToggleAdmin(u.id, u.Admin)}
                      >
                        {isAdmin ? <ShieldOff size={16} className="mr-2" /> : <Shield size={16} className="mr-2" />}
                        {isAdmin ? "Rimuovi Admin" : "Fai Admin"}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        className="h-9 w-9 shrink-0 bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500 hover:text-white"
                        onClick={() => setResetPasswordUserId(u.id)}
                        title="Reset Password"
                      >
                        <Key size={16} />
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon-sm"
                        className="h-9 w-9 shrink-0"
                        onClick={() => handleDeleteUser(u.id)}
                        title="Elimina utente"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </CardFooter>
                  ) : (
                    <CardFooter className="p-4 border-t border-white/5 flex items-center justify-center mt-auto bg-zinc-950/30">
                      <span className="text-[10px] font-black uppercase tracking-[0.2em] text-muted-foreground italic">Il tuo Profilo</span>
                    </CardFooter>
                  )}
                </Card>
              </motion.div>
            );
          })
        )}
      </div>

      <Dialog open={showAddUserModal} onOpenChange={setShowAddUserModal}>
        <DialogContent className="sm:max-w-[425px] bg-zinc-950 border-white/10 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black text-foreground">Nuovo Utente</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddUser} className="space-y-6 pt-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Username</Label>
                <Input
                  required
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                  placeholder="Nome utente"
                  className="bg-zinc-900/50 border-white/10 h-11 text-foreground"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Password</Label>
                <Input
                  type="password"
                  required
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  placeholder="Password"
                  className="bg-zinc-900/50 border-white/10 h-11 text-foreground"
                />
              </div>
              <div className="flex items-center justify-between p-4 bg-zinc-900/50 border border-white/5 rounded-xl">
                <Label htmlFor="isAdmin" className="font-bold text-sm cursor-pointer">Permessi Admin</Label>
                <Switch
                  id="isAdmin"
                  checked={newUser.isAdmin}
                  onCheckedChange={(checked) => setNewUser({ ...newUser, isAdmin: checked })}
                />
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="ghost" onClick={() => setShowAddUserModal(false)}>Annulla</Button>
              <Button type="submit" className="shadow-lg shadow-primary/20">Crea Utente</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetPasswordUserId} onOpenChange={(open) => !open && !isResetting && setResetPasswordUserId(null)}>
        <DialogContent className="sm:max-w-[425px] bg-zinc-950 border-white/10 shadow-2xl">
          <DialogHeader className="flex flex-row items-center gap-4">
            <div className="w-12 h-12 bg-blue-500/10 text-blue-500 rounded-2xl flex items-center justify-center shrink-0">
              <Key size={24} />
            </div>
            <div>
              <DialogTitle className="text-xl font-black text-foreground">Reset Password</DialogTitle>
              <p className="text-sm font-medium text-muted-foreground mt-1">Imposta una nuova password per l'utente.</p>
            </div>
          </DialogHeader>
          <form onSubmit={handleResetPassword} className="space-y-6 pt-4">
            <div className="space-y-2">
              <Label className="text-xs font-bold text-muted-foreground uppercase tracking-widest">Nuova Password</Label>
              <div className="relative">
                <Input
                  type={showResetPassword ? "text" : "password"}
                  required
                  minLength={4}
                  value={resetPasswordField}
                  onChange={(e) => setResetPasswordField(e.target.value)}
                  placeholder="Digita la nuova password..."
                  className="bg-zinc-900/50 border-white/10 h-11 pr-10 text-foreground"
                />
                <button
                  type="button"
                  onClick={() => setShowResetPassword(!showResetPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-foreground transition-colors"
                >
                  {showResetPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <Button type="button" variant="ghost" onClick={() => setResetPasswordUserId(null)} disabled={isResetting}>Annulla</Button>
              <Button type="submit" disabled={isResetting} className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/20">
                {isResetting ? "Salvataggio..." : "Conferma Reset"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
