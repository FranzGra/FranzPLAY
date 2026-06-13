import React, { useEffect, useState } from "react";
import { apiRequest } from "../../services/api";
import { motion } from "framer-motion";
import {
  Activity,
  CheckCircle,
  XCircle,
  Search,
  Clock,
  ShieldAlert,
} from "lucide-react";

import {
  Card,
  CardContent,
} from "@/components/ui/card";
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

export default function AdminAccessi() {
  const [accessi, setAccessi] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const fetchAccessi = async () => {
    try {
      const formData = new FormData();
      formData.append("action", "lista_accessi");
      const data = await apiRequest("/admin.php", "POST", formData);
      if (data.success && data.dati) {
        setAccessi(data.dati);
      }
    } catch (error) {
      console.error("Errore caricamento accessi:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccessi();
  }, []);

  const filteredAccessi = accessi.filter((a) => {
    const searchRegex = new RegExp(
      searchTerm.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&"),
      "i",
    );
    return (
      searchRegex.test(a.Nome_Utente || "") ||
      searchRegex.test(a.indirizzo_Ip || "")
    );
  });

  const formatDate = (dateString) => {
    const d = new Date(dateString);
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(d);
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-8"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-foreground tracking-tight flex items-center gap-3">
            <Activity className="h-8 w-8 text-primary" />
            Log Accessi
          </h1>
          <p className="text-muted-foreground font-medium mt-1">
            Storico dei tentativi di autenticazione al sistema.
          </p>
        </div>
        <div className="relative group w-full md:w-80">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors" size={20} />
          <Input
            type="text"
            placeholder="Cerca utente o IP..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-12 h-12 w-full bg-background"
          />
        </div>
      </div>

      <motion.div variants={itemVariants}>
        <Card className="overflow-hidden border-white/5 bg-zinc-900/40 backdrop-blur-md">
          <Table>
            <TableHeader className="bg-zinc-900/50">
              <TableRow className="border-white/5 hover:bg-transparent">
                <TableHead className="w-[100px] text-[10px] font-black uppercase tracking-widest text-muted-foreground text-center">Stato</TableHead>
                <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Data / Ora</TableHead>
                <TableHead className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Utente Tentato</TableHead>
                <TableHead className="text-right text-[10px] font-black uppercase tracking-widest text-muted-foreground">Indirizzo IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-64 text-center">
                    <div className="w-8 h-8 border-4 border-zinc-800 border-t-primary rounded-full animate-spin mx-auto"></div>
                  </TableCell>
                </TableRow>
              ) : filteredAccessi.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-48 text-center text-muted-foreground font-bold">
                    Nessun log trovato.
                  </TableCell>
                </TableRow>
              ) : (
                filteredAccessi.map((accesso) => (
                  <TableRow key={accesso.id} className="border-white/5 hover:bg-white/5 transition-colors">
                    <TableCell className="text-center">
                      {Number(accesso.successo) === 1 ? (
                        <div className="w-8 h-8 rounded-lg bg-green-500/10 text-green-500 flex items-center justify-center border border-green-500/20 mx-auto">
                          <CheckCircle size={16} />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center border border-red-500/20 mx-auto">
                          <XCircle size={16} />
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-zinc-800/50 text-zinc-500 flex items-center justify-center border border-white/5 shrink-0">
                          <Clock size={14} />
                        </div>
                        <div>
                          <div className="text-sm font-bold text-foreground">
                            {formatDate(accesso.data_ora_tentativo).split(",")[1]}
                          </div>
                          <div className="text-[10px] text-muted-foreground font-bold uppercase">
                            {formatDate(accesso.data_ora_tentativo).split(",")[0]}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="font-bold text-sm text-zinc-300">
                        {accesso.Nome_Utente || <span className="text-zinc-600 italic">Sconosciuto</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant="outline" className="font-mono text-[10px] bg-zinc-950/50 border-white/5 text-zinc-400 py-1 px-2">
                        {accesso.indirizzo_Ip}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </motion.div>

      <div className="text-center pt-4">
        <Badge variant="outline" className="gap-2 bg-zinc-900/50 border-white/5 text-muted-foreground py-1.5 px-4 font-black uppercase tracking-widest text-[10px]">
          <ShieldAlert size={14} /> Ultimi 500 Log registrati
        </Badge>
      </div>
    </motion.div>
  );
}
