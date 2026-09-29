"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { JourEffectif, LigneJour, MotifJour, TauxMois } from "@/lib/utils/wp-effectif-journalier";

interface Props {
  jours: JourEffectif[];
  debut: string;
  fin: string;
  aujourdhui: string;
  premierJourProjete: string;
  scenarios: { id: string; name: string }[];
  scenarioId: string | null;
  hypotheses: { libelle: string; type: string; nbPersonnes: number; debut: string; fin: string | null }[];
  departsDonnees: number;
  tauxAffiches: { mois: string; mesure: { cns: boolean; mct: boolean; inj: boolean }; taux: TauxMois }[];
  jourChoisi: string | null;
  liste: LigneJour[] | null;
  filtresActifs: boolean;
}

type Unite = "tetes" | "etp";

const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const court = (date: string) => `${Number(date.slice(8, 10))} ${MOIS[Number(date.slice(5, 7)) - 1]}`;
const long = (date: string, js: number) => `${JOURS[js]} ${court(date)} ${date.slice(0, 4)}`;
const nb = (v: number, unite: Unite) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: unite === "etp" ? 1 : 0 });
const pct = (v: number) => `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;

const MOTIFS: Record<MotifJour, string> = {
  present: "Présent",
  suspendu: "Suspendu",
  suspendu_partiel: "Suspendu partiel",
  mct: "MCT",
  injustifiee: "Absence injustifiée",
  cns_partiel: "Présent (maladie CNS dans le mois)",
};

const SERIES = [
  { cle: "sousContrat", libelle: "Sous contrat", couleur: "hsl(221, 83%, 53%)" },
  { cle: "net", libelle: "Net (après suspensions)", couleur: "hsl(262, 83%, 58%)" },
  { cle: "disponibles", libelle: "Disponibles attendus", couleur: "hsl(142, 71%, 38%)" },
] as const;

export function EffectifJournalierClient(p: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [unite, setUnite] = useState<Unite>("tetes");
  const [debut, setDebut] = useState(p.debut);
  const [fin, setFin] = useState(p.fin);

  const naviguer = useCallback((maj: Record<string, string | null>, defiler = true) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(maj)) {
      if (v === null || v === "") params.delete(k);
      else params.set(k, v);
    }
    router.push(`${pathname}?${params.toString()}`, { scroll: defiler });
  }, [router, pathname, searchParams]);

  const raccourci = (mois: number) => {
    const d = new Date(`${p.aujourdhui}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + mois);
    d.setUTCDate(d.getUTCDate() - 1);
    naviguer({ debut: p.aujourdhui, fin: d.toISOString().slice(0, 10), jour: null });
  };

  const maxSerie = useMemo(() => Math.max(0, ...p.jours.map((j) => j.sousContrat[unite])), [p.jours, unite]);
  const data = p.jours.map((j) => ({
    date: j.date,
    label: court(j.date),
    sousContrat: j.sousContrat[unite],
    net: j.net[unite],
    disponibles: j.disponibles[unite],
    besoin: j.besoin ? j.besoin[unite] : null,
    // Bande grise des week-ends et fériés
    ombre: j.weekEnd || j.ferie ? maxSerie : 0,
  }));
  const aujourdhuiDansPlage = p.jours.some((j) => j.date === p.aujourdhui);
  const jour = p.jourChoisi ? p.jours.find((j) => j.date === p.jourChoisi) ?? null : null;

  const choisirJour = (date: string) => naviguer({ jour: date === p.jourChoisi ? null : date }, false);

  const parMotif = useMemo(() => {
    const m = new Map<MotifJour, { n: number; etp: number }>();
    for (const l of p.liste ?? []) {
      const g = m.get(l.motif) ?? { n: 0, etp: 0 };
      m.set(l.motif, { n: g.n + 1, etp: g.etp + l.etp });
    }
    return m;
  }, [p.liste]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Effectif jour par jour</h1>
        <p className="text-sm text-muted-foreground">
          Salariés disponibles pour travailler chaque jour{p.filtresActifs ? ", sur le périmètre filtré" : ""} : sous contrat, hors suspensions, puis hors maladie (CNS), MCT, absences injustifiées et congés.
          Jusqu&apos;au {court(p.premierJourProjete)} exclu, les absences sont celles des fichiers importés ; au-delà, elles sont des taux appliqués au net.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 pt-6">
          <div className="space-y-1">
            <Label htmlFor="debut" className="text-xs">Du</Label>
            <Input id="debut" type="date" value={debut} onChange={(e) => setDebut(e.target.value)} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fin" className="text-xs">Au</Label>
            <Input id="fin" type="date" value={fin} onChange={(e) => setFin(e.target.value)} className="w-40" />
          </div>
          <Button variant="secondary" onClick={() => naviguer({ debut, fin, jour: null })} disabled={!debut || !fin || fin < debut}>Afficher</Button>
          <div className="flex gap-1">
            {[1, 3, 6, 12].map((m) => (
              <Button key={m} variant="outline" size="sm" onClick={() => raccourci(m)}>+{m} mois</Button>
            ))}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Scénario</Label>
            <Select value={p.scenarioId ?? "__aucun__"} onValueChange={(v) => naviguer({ scenario: v === "__aucun__" ? null : v, jour: null })}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__aucun__">Aucun (roster seul)</SelectItem>
                {p.scenarios.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="ml-auto flex overflow-hidden rounded-md border text-sm">
            {(["tetes", "etp"] as Unite[]).map((u) => (
              <button key={u} type="button" onClick={() => setUnite(u)} className={`px-3 py-1.5 ${unite === u ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                {u === "tetes" ? "Têtes" : "ETP"}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Disponibles par jour — {court(p.debut)} au {court(p.fin)}</CardTitle>
          <CardDescription>
            Cliquer un jour pour la liste des salariés. Bandes grises : samedis, dimanches et fériés ; les taux d&apos;absence s&apos;y appliquent comme en semaine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart
              data={data}
              margin={{ top: 10, right: 20, bottom: 5, left: 5 }}
              onClick={(e) => { const i = e?.activeTooltipIndex; if (typeof i === "number" && data[i]) choisirJour(data[i].date); }}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={20} />
              <YAxis tick={{ fontSize: 12 }} width={60} domain={["auto", "auto"]} />
              <Tooltip
                formatter={(v: number | string | undefined, name: string | undefined) => (name === "ombre" ? null : [nb(Number(v ?? 0), unite), name ?? ""])}
                labelFormatter={(_, payload) => { const d = payload?.[0]?.payload?.date as string | undefined; const j = d ? p.jours.find((x) => x.date === d) : null; return j ? `${long(j.date, j.jourSemaine)}${j.ferie ? " — férié" : ""}${j.projete ? " (projeté)" : ""}` : ""; }}
                contentStyle={{ borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--background)" }}
              />
              <Legend />
              <Bar dataKey="ombre" fill="hsl(215, 16%, 60%)" fillOpacity={0.12} barSize={100} isAnimationActive={false} legendType="none" />
              {SERIES.map((s) => (
                <Line key={s.cle} type="monotone" dataKey={s.cle} name={s.libelle} stroke={s.couleur} strokeWidth={2} dot={false} isAnimationActive={false} />
              ))}
              {aujourdhuiDansPlage && <ReferenceLine x={court(p.aujourdhui)} stroke="hsl(0, 70%, 55%)" strokeDasharray="4 3" label={{ value: "aujourd'hui", fontSize: 11, position: "top" }} />}
              {p.jourChoisi && <ReferenceLine x={court(p.jourChoisi)} stroke="hsl(215, 25%, 27%)" />}
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {jour && (
        <Card id="jour-choisi">
          <CardHeader>
            <CardTitle className="text-base">{long(jour.date, jour.jourSemaine)}{jour.ferie ? " — férié" : ""}{jour.projete ? " (projeté)" : ""}</CardTitle>
            <CardDescription>
              {nb(jour.disponibles[unite], unite)} disponibles attendus sur {nb(jour.sousContrat[unite], unite)} sous contrat.
              {jour.projete ? " Jour projeté : la liste ne montre que les salariés dont la présence est certaine ; maladie, MCT, injustifiées et congés sont des taux, sans nom." : " Absences des fichiers importés : MCT au jour près, injustifiées sur leur plage ; la maladie CNS n'est connue qu'en % du mois."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4 lg:grid-cols-7">
              {[
                ["Sous contrat", jour.sousContrat],
                ["Suspendus", jour.suspendus],
                ["Turnover attendu", jour.turnover],
                ["Maladie (CNS)", jour.absences.cns],
                ["MCT", jour.absences.mct],
                ["Injustifiées", jour.absences.inj],
                ["Congés", jour.absences.conges],
              ].map(([libelle, c]) => (
                <div key={libelle as string} className="rounded-md border px-3 py-2">
                  <div className="text-xs text-muted-foreground">{libelle as string}</div>
                  <div className="font-medium">{nb((c as { tetes: number; etp: number })[unite], unite)}</div>
                </div>
              ))}
            </div>
            {p.liste && p.liste.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  {[...parMotif.entries()].map(([m, g]) => (
                    <span key={m} className="rounded-md border px-2 py-1">{MOTIFS[m]} : <span className="font-medium">{g.n}</span> ({nb(g.etp, "etp")} ETP)</span>
                  ))}
                </div>
                <div className="max-h-[28rem] overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Salarié</TableHead>
                        <TableHead className="text-xs">Dépôt</TableHead>
                        <TableHead className="text-xs">Fonction</TableHead>
                        <TableHead className="text-xs text-right">ETP</TableHead>
                        <TableHead className="text-xs">Situation</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {p.liste.map((l) => (
                        <TableRow key={l.code_salarie}>
                          <TableCell className="text-sm">{l.nom_salarie || l.code_salarie} <span className="text-xs text-muted-foreground">{l.code_salarie}</span></TableCell>
                          <TableCell className="text-sm">{l.depot || "—"}</TableCell>
                          <TableCell className="text-sm">{l.fonction || "—"}</TableCell>
                          <TableCell className="text-sm text-right">{nb(l.etp, "etp")}</TableCell>
                          <TableCell className={`text-sm ${l.motif === "present" ? "" : "text-amber-700"}`}>
                            {MOTIFS[l.motif]}{l.motif === "cns_partiel" && l.cnsMois != null ? ` : ${pct(l.cnsMois)}` : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Aucun salarié sous contrat ce jour sur le périmètre.</p>
            )}
            {p.hypotheses.length > 0 && (
              <div className="text-xs text-muted-foreground">
                <p className="font-semibold uppercase tracking-wide">Hypothèses du scénario actives ce jour</p>
                <ul>
                  {p.hypotheses
                    .filter((h) => (h.type === "arrivee" ? jour.date >= h.debut && (!h.fin || jour.date <= h.fin) : h.type === "depart" ? jour.date > h.debut : jour.date >= h.debut && (!h.fin || jour.date < h.fin)))
                    .map((h, i) => <li key={i}>{h.nbPersonnes} × {h.libelle} ({h.type === "depart" ? "parti depuis le" : "depuis le"} {court(h.debut)}{h.fin ? `, jusqu'au ${court(h.fin)}` : ""})</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Détail par jour</CardTitle>
          <CardDescription>
            En {unite === "tetes" ? "têtes" : "ETP"}. Les jours projetés sont en italique ; cliquer une ligne pour sa liste de salariés.
            {p.scenarioId ? ` Scénario : ${p.hypotheses.length} hypothèse${p.hypotheses.length > 1 ? "s" : ""} datée${p.hypotheses.length > 1 ? "s" : ""} sur le périmètre${p.departsDonnees > 0 ? `, ${p.departsDonnees} départ${p.departsDonnees > 1 ? "s" : ""} de salarié${p.departsDonnees > 1 ? "s" : ""} identifié${p.departsDonnees > 1 ? "s" : ""}` : ""}, turnover réparti jour par jour.` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-h-[32rem] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {["Jour", "Sous contrat", "Suspendus", "Turnover", "Net", "CNS", "MCT", "Injust.", "Congés", "Disponibles", "Entrées / sorties"].map((h, i) => (
                    <TableHead key={h} className={`text-xs ${i > 0 ? "text-right" : ""}`}>{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {p.jours.map((j) => (
                  <TableRow
                    key={j.date}
                    onClick={() => choisirJour(j.date)}
                    className={`cursor-pointer ${j.projete ? "italic" : ""} ${j.weekEnd || j.ferie ? "bg-muted/40" : ""} ${j.date === p.jourChoisi ? "ring-1 ring-primary" : ""}`}
                  >
                    <TableCell className="whitespace-nowrap text-sm">{long(j.date, j.jourSemaine)}{j.ferie ? " · férié" : ""}</TableCell>
                    {[j.sousContrat, j.suspendus, j.turnover, j.net, j.absences.cns, j.absences.mct, j.absences.inj, j.absences.conges].map((c, i) => (
                      <TableCell key={i} className="text-right text-sm tabular-nums">{c[unite] === 0 ? "—" : nb(c[unite], unite)}</TableCell>
                    ))}
                    <TableCell className="text-right text-sm font-medium tabular-nums">{nb(j.disponibles[unite], unite)}</TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{j.mouvements.entrees || j.mouvements.sorties ? `+${j.mouvements.entrees} / −${j.mouvements.sorties}` : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="text-xs text-muted-foreground">
            <p className="mb-1 font-semibold uppercase tracking-wide">Taux d&apos;absence appliqués (% du net)</p>
            <div className="flex flex-wrap gap-2">
              {p.tauxAffiches.map((t) => (
                <span key={t.mois} className="rounded-md border px-2 py-1">
                  {MOIS[Number(t.mois.slice(5, 7)) - 1]} {t.mois.slice(0, 4)} : CNS {t.mesure.cns ? "mesurée" : pct(t.taux.cns)} · MCT {t.mesure.mct ? "mesurée" : pct(t.taux.mct)} · injust. {t.mesure.inj ? "mesurées" : pct(t.taux.inj)} · congés {pct(t.taux.conges)}
                </span>
              ))}
            </div>
            <p className="mt-1">
              Mois sans fichier : taux du scénario (maladie, congés), sinon celui du même mois de l&apos;an passé, sinon la moyenne des 3 derniers mois mesurés. Sans scénario, les congés ne sont pas déduits.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
