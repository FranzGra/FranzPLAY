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

import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageShell, PageHeader, Panel, EmptyState } from "@/components/ui/layout";
import { StatusChip } from "@/components/ui/data-display";

/**
 * Admin > Accessi — migrata al design system.
 * Nessuna misura arbitraria: intestazione, pannello e stato vuoto vengono dai
 * componenti condivisi; i colori di stato dalla palette di data-display.
 */

const itemVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1, transition: { type: "spring", stiffness: 300, damping: 24 } },
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
      if (data.success && data.dati) setAccessi(data.dati);
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
      searchRegex.test(a.Nome_Utente || "") || searchRegex.test(a.indirizzo_Ip || "")
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

  const intestazioni = ["Stato", "Data / Ora", "Utente tentato", "Indirizzo IP"];

  return (
    <PageShell>
      <PageHeader
        icon={Activity}
        title="Log accessi"
        description="Storico dei tentativi di autenticazione al sistema."
        actions={
          <div className="relative w-full md:w-80">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={18}
            />
            <Input
              type="text"
              placeholder="Cerca utente o IP…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-12"
            />
          </div>
        }
      />

      <motion.div variants={itemVariants} initial="hidden" animate="visible">
        <Panel className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="border-hairline hover:bg-transparent">
                {intestazioni.map((h, i) => (
                  <TableHead
                    key={h}
                    className={`text-xs font-black uppercase text-muted-foreground ${
                      i === 0 ? "w-[100px] text-center" : ""
                    } ${i === intestazioni.length - 1 ? "text-right" : ""}`}
                  >
                    {h}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="h-64 text-center">
                    <div className="mx-auto size-8 animate-spin rounded-full border-4 border-surface-3 border-t-primary" />
                  </TableCell>
                </TableRow>
              ) : filteredAccessi.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <EmptyState
                      icon={ShieldAlert}
                      title="Nessun accesso registrato"
                      description={
                        searchTerm
                          ? "Nessun risultato per questa ricerca."
                          : "Qui compariranno i tentativi di autenticazione."
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                filteredAccessi.map((accesso) => {
                  const riuscito = Number(accesso.successo) === 1;
                  const [data, ora] = formatDate(accesso.data_ora_tentativo).split(",");
                  return (
                    <TableRow
                      key={accesso.id}
                      className="border-hairline transition-colors hover:bg-surface-2"
                    >
                      <TableCell className="text-center">
                        <span
                          className={`mx-auto flex size-9 items-center justify-center rounded-lg border ${
                            riuscito
                              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                              : "border-destructive/25 bg-destructive/10 text-destructive"
                          }`}
                          title={riuscito ? "Accesso riuscito" : "Accesso fallito"}
                        >
                          {riuscito ? <CheckCircle size={16} /> : <XCircle size={16} />}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface-3 text-muted-foreground">
                            <Clock size={14} />
                          </span>
                          <div>
                            <div className="text-sm font-bold text-foreground">{ora}</div>
                            <div className="text-xs font-bold uppercase text-muted-foreground">
                              {data}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-bold text-foreground">
                          {accesso.Nome_Utente || (
                            <span className="italic text-muted-foreground">Sconosciuto</span>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="inline-flex rounded-md border border-hairline bg-surface-3 px-2 py-1 font-mono text-xs text-muted-foreground">
                          {accesso.indirizzo_Ip}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Panel>
      </motion.div>

      <div className="text-center">
        <StatusChip icon={ShieldAlert} label="Ultimi 500 log registrati" tone="neutral" />
      </div>
    </PageShell>
  );
}
