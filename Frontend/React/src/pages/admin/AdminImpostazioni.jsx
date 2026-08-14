import React, { useState } from "react";
import {
  Palette,
  Check as CheckIcon,
  Type,
  RotateCcw,
  UserPlus,
  UserX,
  Settings2,
  DoorOpen,
} from "lucide-react";
import { apiRequest } from "../../services/api";
import { useSettings } from "../../context/SettingsContext";
import { useDocumentTitle } from "../../hooks/useDocumentTitle";
import { COLOR_PRESETS } from "../../components/profile/ThemeTab";
import { motion } from "framer-motion";
import { toast } from "sonner";

import { PageShell, PageHeader, Section, Panel, PanelBody } from "@/components/ui/layout";
import { Field, FieldRow } from "@/components/ui/data-display";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

/**
 * ============================================================================
 * AdminImpostazioni — Impostazioni generali del sito
 * ============================================================================
 *
 * PERCHE' ESISTE:
 * Logo, colore globale e apertura delle registrazioni vivevano in fondo alla
 * Dashboard. Sono configurazioni che si toccano una volta ogni tanto, mentre
 * la Dashboard serve a capire a colpo d'occhio lo stato del sistema:
 * mescolarle rendeva la Dashboard lunga e le impostazioni difficili da trovare.
 *
 * La logica di salvataggio e' identica a prima (stesse action del backend:
 * salva_logo, salva_impostazioni_globali, salva_registrazione).
 * ============================================================================
 */

export default function AdminImpostazioni() {
  useDocumentTitle("Impostazioni · Admin");
  const { logoParts, defaultTheme, fetchSettings, registrationEnabled } = useSettings();

  const [logo1, setLogo1] = useState(logoParts?.part1 || "FRANZ");
  const [logo2, setLogo2] = useState(logoParts?.part2 || "PLAY");
  const [isLogoSaving, setIsLogoSaving] = useState(false);

  const [globalTheme, setGlobalTheme] = useState(defaultTheme || "#dc2626");
  const [isThemeSaving, setIsThemeSaving] = useState(false);

  const [regEnabled, setRegEnabled] = useState(registrationEnabled);
  const [isRegSaving, setIsRegSaving] = useState(false);

  // Le impostazioni arrivano dal server DOPO il primo render, quindi i campi
  // vanno riallineati quando cambiano. Si usa l'aggiustamento in fase di
  // render (il pattern raccomandato da React per "adattare lo stato quando
  // cambiano le props") e non un useEffect: un effect che chiama setState
  // provoca un secondo render a vuoto a ogni caricamento.
  const [precedenti, setPrecedenti] = useState({
    logoParts,
    defaultTheme,
    registrationEnabled,
  });
  if (
    precedenti.logoParts !== logoParts ||
    precedenti.defaultTheme !== defaultTheme ||
    precedenti.registrationEnabled !== registrationEnabled
  ) {
    setPrecedenti({ logoParts, defaultTheme, registrationEnabled });
    setLogo1(logoParts?.part1 || "FRANZ");
    setLogo2(logoParts?.part2 || "PLAY");
    setGlobalTheme(defaultTheme || "#dc2626");
    setRegEnabled(registrationEnabled);
  }

  const handleLogoSubmit = async (e) => {
    e.preventDefault();
    setIsLogoSaving(true);
    try {
      const formData = new FormData();
      formData.append("action", "salva_logo");
      formData.append("logo_part_1", logo1);
      formData.append("logo_part_2", logo2);
      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        toast.success("Logo aggiornato");
        fetchSettings();
      } else {
        toast.error(res.message || "Salvataggio non riuscito");
      }
    } catch {
      toast.error("Errore nel salvataggio del logo");
    } finally {
      setIsLogoSaving(false);
    }
  };

  const handleToggleRegistration = async (next) => {
    setRegEnabled(next); // ottimistico
    setIsRegSaving(true);
    try {
      const formData = new FormData();
      formData.append("action", "salva_registrazione");
      formData.append("abilitata", next ? "1" : "0");
      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        toast.success(next ? "Registrazione abilitata" : "Registrazione disabilitata");
        fetchSettings();
      } else {
        setRegEnabled(!next);
        toast.error(res.message || "Salvataggio non riuscito");
      }
    } catch {
      setRegEnabled(!next);
      toast.error("Errore nel salvataggio");
    } finally {
      setIsRegSaving(false);
    }
  };

  const handleThemeSubmit = async (e) => {
    e.preventDefault();
    setIsThemeSaving(true);
    try {
      const formData = new FormData();
      formData.append("action", "salva_impostazioni_globali");
      formData.append("tema_default", globalTheme);
      const res = await apiRequest("/admin.php", "POST", formData);
      if (res.success) {
        toast.success("Colore del sito aggiornato");
        fetchSettings();
      } else {
        toast.error(res.message || "Salvataggio non riuscito");
      }
    } catch {
      toast.error("Errore nel salvataggio del colore");
    } finally {
      setIsThemeSaving(false);
    }
  };

  const isValidHex = /^#[0-9a-fA-F]{6}$/.test(globalTheme);

  return (
    <PageShell>
      <PageHeader
        icon={Settings2}
        title="Impostazioni generali"
        description="Aspetto del sito e regole di accesso. Le modifiche valgono per tutti gli utenti."
      />

      {/* ---------------- IDENTITÀ ---------------- */}
      <Section
        icon={Type}
        title="Identità"
        description="Il nome mostrato in alto a sinistra su tutte le pagine e nella schermata di accesso. È composto da due parti: la seconda prende il colore del tema."
      >
        <Panel>
          <PanelBody>
            <form onSubmit={handleLogoSubmit}>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                <div className="space-y-4">
                  <Field label="Prima parte (colore normale)">
                    <Input
                      type="text"
                      value={logo1}
                      onChange={(e) => setLogo1(e.target.value)}
                      required
                    />
                  </Field>
                  <Field label="Seconda parte (colore del tema)">
                    <Input
                      type="text"
                      value={logo2}
                      onChange={(e) => setLogo2(e.target.value)}
                      required
                    />
                  </Field>
                </div>

                <Field label="Come apparirà">
                  <div className="flex items-center justify-center rounded-2xl bg-surface-2 border border-hairline py-10">
                    <span className="text-4xl font-black tracking-tight text-foreground">
                      {logo1 || "FRANZ"}
                      <span style={{ color: isValidHex ? globalTheme : undefined }}>
                        {logo2 || "PLAY"}
                      </span>
                    </span>
                  </div>
                </Field>
              </div>

              <div className="flex justify-end pt-5 mt-5 border-t border-hairline">
                <Button type="submit" disabled={isLogoSaving} className="font-bold">
                  {isLogoSaving ? "Salvataggio…" : "Salva logo"}
                </Button>
              </div>
            </form>
          </PanelBody>
        </Panel>
      </Section>

      {/* ---------------- COLORE ---------------- */}
      <Section
        icon={Palette}
        title="Colore del sito"
        description="Colore usato nella schermata di accesso e per tutti gli utenti che non ne hanno scelto uno personale dal proprio profilo."
      >
        <Panel>
          <PanelBody>
            <form onSubmit={handleThemeSubmit} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                <div className="lg:col-span-3 space-y-6">
                  <Field label="Scegli un colore">
                    <div className="grid grid-cols-6 sm:grid-cols-7 gap-2.5">
                      {COLOR_PRESETS.map((preset) => {
                        const active =
                          globalTheme.toLowerCase() === preset.value.toLowerCase();
                        return (
                          <motion.button
                            whileHover={{ scale: 1.08 }}
                            whileTap={{ scale: 0.92 }}
                            key={preset.value}
                            type="button"
                            onClick={() => setGlobalTheme(preset.value)}
                            className="relative aspect-square rounded-xl flex items-center justify-center transition-shadow"
                            style={{
                              backgroundColor: preset.value,
                              boxShadow: active
                                ? `0 0 0 2px var(--surface-1), 0 0 0 4px ${preset.value}`
                                : "none",
                            }}
                            title={preset.name}
                          >
                            {active && (
                              <CheckIcon className="h-5 w-5 text-white drop-shadow-md" />
                            )}
                          </motion.button>
                        );
                      })}
                    </div>
                  </Field>

                  <Field
                    label="Oppure inseriscine uno tuo"
                    hint={!isValidHex ? "Codice colore non valido" : undefined}
                  >
                    <div className="flex items-center gap-4 bg-surface-2 border border-hairline rounded-2xl p-3">
                      <div
                        className="relative w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-hairline-strong"
                        style={{
                          backgroundColor: isValidHex ? globalTheme : "var(--surface-3)",
                          boxShadow: isValidHex ? `0 0 20px ${globalTheme}40` : "none",
                        }}
                      >
                        <input
                          type="color"
                          value={isValidHex ? globalTheme : "#dc2626"}
                          onChange={(e) => setGlobalTheme(e.target.value)}
                          className="absolute inset-0 w-[200%] h-[200%] -top-1/2 -left-1/2 cursor-pointer opacity-0"
                        />
                      </div>
                      <Input
                        type="text"
                        value={globalTheme.toUpperCase()}
                        onChange={(e) => {
                          let v = e.target.value.trim();
                          if (!v.startsWith("#")) v = "#" + v.replace(/#/g, "");
                          setGlobalTheme(v);
                        }}
                        maxLength={7}
                        className={`bg-transparent border-none shadow-none text-xl font-black uppercase focus-visible:ring-0 tracking-wider px-0 ${
                          isValidHex ? "text-foreground" : "text-destructive"
                        }`}
                        placeholder="#DC2626"
                      />
                    </div>
                  </Field>
                </div>

                <div className="lg:col-span-2">
                  <Field label="Anteprima">
                    <div className="rounded-2xl border border-hairline bg-surface-2 p-5 space-y-4">
                      <div className="flex items-center gap-3">
                        <div
                          className="h-10 w-10 rounded-xl shrink-0"
                          style={{
                            backgroundColor: isValidHex ? globalTheme : "var(--surface-3)",
                          }}
                        />
                        <div>
                          <p className="text-sm font-black text-foreground leading-none">
                            {logo1}
                            <span style={{ color: isValidHex ? globalTheme : undefined }}>
                              {logo2}
                            </span>
                          </p>
                          <p
                            className="text-xs font-bold mt-1"
                            style={{ color: isValidHex ? globalTheme : undefined }}
                          >
                            Testo in evidenza
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="w-full py-2.5 rounded-xl text-white font-bold text-sm"
                        style={{
                          backgroundColor: isValidHex ? globalTheme : "var(--surface-3)",
                          boxShadow: isValidHex ? `0 8px 24px ${globalTheme}33` : "none",
                        }}
                      >
                        Pulsante
                      </button>

                      <div className="h-2 w-full rounded-full bg-surface-3 overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: "65%",
                            backgroundColor: isValidHex ? globalTheme : "var(--surface-3)",
                          }}
                        />
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full"
                          style={{
                            color: isValidHex ? globalTheme : undefined,
                            backgroundColor: isValidHex
                              ? `${globalTheme}1f`
                              : "var(--surface-3)",
                          }}
                        >
                          Etichetta
                        </span>
                        <div
                          className="h-6 w-6 rounded-full border-2"
                          style={{
                            borderColor: isValidHex ? globalTheme : "var(--surface-3)",
                          }}
                        />
                      </div>
                    </div>
                  </Field>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-hairline">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setGlobalTheme("#dc2626")}
                  className="text-muted-foreground hover:text-foreground font-bold gap-2"
                >
                  <RotateCcw size={15} /> Ripristina il colore originale
                </Button>
                <Button
                  type="submit"
                  disabled={isThemeSaving || !isValidHex}
                  className="font-bold"
                >
                  {isThemeSaving ? "Salvataggio…" : "Salva colore"}
                </Button>
              </div>
            </form>
          </PanelBody>
        </Panel>
      </Section>

      {/* ---------------- ACCESSO ---------------- */}
      <Section
        icon={DoorOpen}
        title="Accesso al sito"
        description="Decide se chi arriva sulla pagina di accesso può crearsi un account da solo."
      >
        <Panel>
          <PanelBody>
            <FieldRow
              title="Chiunque può registrarsi"
              description={
                regEnabled
                  ? "Attivo: sulla pagina di accesso compare il pulsante “Registrati” e chiunque conosca l’indirizzo del sito può creare un account."
                  : "Disattivato: il pulsante “Registrati” è nascosto e i nuovi utenti puoi crearli solo tu dalla sezione Utenti."
              }
              control={
                <div className="flex items-center gap-3">
                  <span
                    className={
                      regEnabled ? "text-emerald-400" : "text-muted-foreground"
                    }
                  >
                    {regEnabled ? <UserPlus size={20} /> : <UserX size={20} />}
                  </span>
                  <Switch
                    checked={regEnabled}
                    onCheckedChange={handleToggleRegistration}
                    disabled={isRegSaving}
                  />
                </div>
              }
            />
          </PanelBody>
        </Panel>
      </Section>
    </PageShell>
  );
}
