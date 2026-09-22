"use client";

import { Fragment, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ChevronDown } from "lucide-react";
import type { PaliersDuPoint } from "@/lib/utils/wp-effectif-moyen";
import { formatEuros } from "@/lib/utils/format";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Brush,
} from "recharts";

export interface HeadcountDataPoint {
  month: string;
  effectif_brut: number;
  effectif_net: number;
  effectif_reel?: number;
  effectif_apres_mct?: number;
  projected_apres_mct?: number;
  /** Sous contrat et net en moyenne journalière du mois (intermédiaire de calcul). */
  moyenne_brute?: { brut: number; net: number };
  /** Les mêmes paliers en MOYENNE du mois, pour la vue « Moyenne ». */
  moyenne?: PaliersDuPoint;
  /** Réel − MCT, sans les injustifiées : point de départ des scénarios, qui ne les modélisent pas. Non tracé. */
  base_scenario_apres_mct?: number;
  effectif_apres_injustifiees?: number;
  projected_apres_injustifiees?: number;
  is_projection: boolean;
  /** Par ligne, la valeur du mois est REPORTÉE (photo reconduite ou taux repris) : tracée en pointillé. */
  reporte?: Reporte;
  /** Taux d'absence effectivement appliqués au mois (mesurés ou repris), en % : nécessaires à la page Coûts. */
  taux_appliques?: { cns: number | null; inj: number | null; mct: number | null };
  /** Page Coûts : paie réalisée du mois (brut + charges patronales), absente sur un mois sans montants. */
  realise?: number;
  target?: number;
  scenario_brut?: number;
  scenario_net?: number;
  scenario_reel?: number;
  scenario_apres_injustifiees?: number;
  scenario_apres_mct?: number;
  scenario_apres_conges?: number;
}

export interface ScenarioOption {
  id: string;
  name: string;
}

export interface ScenarioProjectionData {
  scenario_id: string;
  /** One entry per projected month (only future months) */
  months: {
    month_index: number; // 1-12
    scenario_brut: number;
    scenario_net: number;
    scenario_reel: number;
    scenario_apres_injustifiees?: number;
    scenario_apres_mct: number;
    scenario_apres_conges?: number;
  }[];
}

/** Drapeaux de report d'un point : une clé par ligne mesurée (+ `cout` pour la page Coûts). */
export interface Reporte {
  brut?: boolean; net?: boolean; reel?: boolean; injustifiees?: boolean; mct?: boolean; cout?: boolean;
}

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
  dashed?: boolean;
  isScenario?: boolean;
  /**
   * Série MESURÉE : tracée en deux traits, plein sur les mois mesurés et
   * pointillé sur les mois où ce drapeau de `reporte` est levé.
   */
  reportFlag?: keyof Reporte;
  /** Série dont l'infobulle affiche l'écart : le palier précédent de la chaîne. */
  parent?: string;
  /** Une série mesurée mais trouée (ex. paie réalisée) : pas de raccord entre les trous. */
  connectNulls?: boolean;
}

const mesureKey = (key: string) => `mesure_${key}`;
const reportKey = (key: string) => `report_${key}`;

/** Les 5 paliers d'effectif, la cible et les séries de scénario. Les clés servent aussi, en euros, à la page Coûts. */
export const ALL_SERIES: SeriesDef[] = [
  { key: "effectif_brut", label: "Sous contrat", color: "hsl(221, 83%, 53%)", reportFlag: "brut" },
  { key: "effectif_net", label: "Net", color: "hsl(262, 83%, 58%)", reportFlag: "net", parent: "effectif_brut" },
  { key: "effectif_reel", label: "Réel (après maladie)", color: "hsl(142, 71%, 45%)", reportFlag: "reel", parent: "effectif_net" },
  // Ordre de la chaîne : réel −injustifiées→ payé −MCT→ disponible (wp-paliers.ts)
  { key: "effectif_apres_injustifiees", label: "Après abs. injustifiées (payé)", color: "hsl(45, 93%, 47%)", reportFlag: "injustifiees", parent: "effectif_reel" },
  { key: "effectif_apres_mct", label: "Après MCT (disponible)", color: "hsl(330, 70%, 55%)", reportFlag: "mct", parent: "effectif_apres_injustifiees" },
  { key: "target", label: "Cible", color: "hsl(0, 84%, 60%)", dashed: true },
  { key: "scenario_brut", label: "Sous contrat", color: "hsl(221, 83%, 53%)", dashed: true, isScenario: true },
  { key: "scenario_net", label: "Net", color: "hsl(262, 83%, 58%)", dashed: true, isScenario: true, parent: "scenario_brut" },
  { key: "scenario_reel", label: "Réel (après CNS)", color: "hsl(142, 71%, 45%)", dashed: true, isScenario: true, parent: "scenario_net" },
  { key: "scenario_apres_injustifiees", label: "Après abs. injustifiées (payé)", color: "hsl(45, 93%, 47%)", dashed: true, isScenario: true, parent: "scenario_reel" },
  { key: "scenario_apres_mct", label: "Après MCT (disponible)", color: "hsl(330, 70%, 55%)", dashed: true, isScenario: true, parent: "scenario_apres_injustifiees" },
  { key: "scenario_apres_conges", label: "Disponible (après congés)", color: "hsl(30, 90%, 50%)", dashed: true, isScenario: true, parent: "scenario_apres_mct" },
];

/** Valeur telle que la courbe ETP l'affiche : au dixième. */
const formatDefaut = (n: number) => String(Math.round(n * 10) / 10);

interface Props {
  data: HeadcountDataPoint[];
  title?: string;
  scenarios?: ScenarioOption[];
  scenarioProjections?: ScenarioProjectionData[];
  initialSelectedScenarios?: string[];
  initialTurnoverSrc?: string | null;
  initialAbsSrc?: string | null;
  initialLeaveSrc?: string | null;
  combinedProjection?: ScenarioProjectionData | null;
  /** Séries à tracer, dans l'ordre de la chaîne (défaut : les effectifs). */
  series?: SeriesDef[];
  /** Unité des valeurs (infobulle, axe, écarts) : ETP au dixième, ou euros à l'euro près. Une prop sérialisable, la page étant un composant serveur. */
  unite?: "etp" | "euros";
  /** Pas d'arrondi des bornes de l'axe Y. Défaut 10 (effectifs) ; en euros, un pas à l'échelle des montants. */
  axeStep?: number;
  /** Série de la réglette de zoom. */
  brushDataKey?: string;
  /** Message quand `data` est vide. */
  libelleVide?: string;
}

export function HeadcountEvolutionChart({
  data,
  title = "Évolution des effectifs",
  scenarios = [],
  scenarioProjections = [],
  initialSelectedScenarios = [],
  initialTurnoverSrc = null,
  initialAbsSrc = null,
  initialLeaveSrc = null,
  combinedProjection = null,
  series = ALL_SERIES,
  unite = "etp",
  axeStep = 10,
  brushDataKey = "effectif_brut",
  libelleVide = "Importez des données pour visualiser l'évolution des effectifs.",
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const formatValue = unite === "euros" ? formatEuros : formatDefaut;
  // Visibilité des séries (pastilles) — toutes visibles par défaut. Déclaré ici,
  // avant tout retour conditionnel : les hooks doivent s'exécuter dans le même ordre.
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
  // Dérivés des séries : quelle ligne se dédouble en mesuré/reporté, et la chaîne des écarts
  const cleReport = new Map(series.filter((s) => s.reportFlag).map((s) => [s.key, s.reportFlag!]));
  const deltaParent = new Map(series.filter((s) => s.parent).map((s) => [s.key, s.parent!]));

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelectedScenarios));
  const [turnoverSrc, setTurnoverSrc] = useState<string | null>(initialTurnoverSrc);
  const [absSrc, setAbsSrc] = useState<string | null>(initialAbsSrc);
  const [leaveSrc, setLeaveSrc] = useState<string | null>(initialLeaveSrc);
  const [urlDirty, setUrlDirty] = useState(false);
  // Lecture de la courbe : effectif au dernier jour du mois, ou moyenne du
  // mois pondérée par les jours (celle des cartes KPI).
  const [vue, setVue] = useState<"fin" | "moyenne">("fin");

  // Sync selection to URL query params via useEffect (avoids setState during render)
  useEffect(() => {
    if (!urlDirty) return;
    setUrlDirty(false);

    const params = new URLSearchParams(searchParams.toString());

    if (selectedIds.size > 0) {
      params.set("scenarios", Array.from(selectedIds).join(","));
    } else {
      params.delete("scenarios");
    }

    if (turnoverSrc && selectedIds.has(turnoverSrc)) {
      params.set("turnover_src", turnoverSrc);
    } else {
      params.delete("turnover_src");
    }

    if (absSrc && selectedIds.has(absSrc)) {
      params.set("abs_src", absSrc);
    } else {
      params.delete("abs_src");
    }

    if (leaveSrc && selectedIds.has(leaveSrc)) {
      params.set("leave_src", leaveSrc);
    } else {
      params.delete("leave_src");
    }

    router.replace(`?${params.toString()}`, { scroll: false });
  }, [urlDirty, selectedIds, turnoverSrc, absSrc, leaveSrc, router, searchParams]);

  const toggleScenario = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (turnoverSrc === id) {
          setTurnoverSrc(next.size > 0 ? Array.from(next)[0] : null);
        }
        if (absSrc === id) {
          setAbsSrc(next.size > 0 ? Array.from(next)[0] : null);
        }
        if (leaveSrc === id) {
          setLeaveSrc(next.size > 0 ? Array.from(next)[0] : null);
        }
      } else {
        next.add(id);
        if (!turnoverSrc || !next.has(turnoverSrc)) {
          setTurnoverSrc(id);
        }
        if (!absSrc || !next.has(absSrc)) {
          setAbsSrc(id);
        }
        if (!leaveSrc || !next.has(leaveSrc)) {
          setLeaveSrc(id);
        }
      }
      return next;
    });
    setUrlDirty(true);
  };

  const setTurnoverSource = (id: string) => {
    setTurnoverSrc(id);
    setUrlDirty(true);
  };

  const setAbsSource = (id: string) => {
    setAbsSrc(id);
    setUrlDirty(true);
  };

  const setLeaveSource = (id: string) => {
    setLeaveSrc(id);
    setUrlDirty(true);
  };

  const showScenario = selectedIds.size > 0 && combinedProjection != null;

  // Use combined projection when multi-select is active
  const selectedProjection = showScenario ? combinedProjection : null;

  const firstProjectedMonthIdx = selectedProjection
    ? Math.min(...selectedProjection.months.map((m) => m.month_index))
    : null;
  const lastRealMonthIdx = firstProjectedMonthIdx != null ? firstProjectedMonthIdx - 1 : null;

  const lastMctRealMonth = data.reduce((last, d, i) => d.effectif_apres_mct != null ? i + 1 : last, 0);

  // Vue Moyenne : les mois mesurés portent leur moyenne pondérée par les
  // jours ; un mois projeté par un scénario, qui n'a qu'une valeur de fin de
  // mois, prend la moyenne de ses deux fins de mois (la précédente et la
  // sienne), une interpolation linéaire à l'intérieur du mois.
  const moyenneDisponible = data.some((d) => d.moyenne != null);
  const vueMoyenne = vue === "moyenne" && moyenneDisponible;
  const CLE_FIN_MESUREE: Record<string, (d: HeadcountDataPoint) => number | undefined> = {
    scenario_brut: (d) => d.effectif_brut,
    scenario_net: (d) => d.effectif_net,
    scenario_reel: (d) => d.effectif_reel,
    scenario_apres_injustifiees: (d) => d.effectif_apres_injustifiees ?? d.projected_apres_injustifiees,
    scenario_apres_mct: (d) => d.effectif_apres_mct ?? d.projected_apres_mct ?? d.effectif_reel,
    scenario_apres_conges: (d) => d.effectif_apres_mct ?? d.projected_apres_mct ?? d.effectif_reel,
  };
  /** Valeur de FIN du mois d'indice `i` pour une série de scénario : celle du scénario s'il couvre ce mois, sinon la mesure. */
  const finDuMois = (i: number, key: string): number | undefined => {
    if (i < 0) return undefined;
    const md = selectedProjection?.months.find((m) => m.month_index === i + 1);
    const v = md ? (md as unknown as Record<string, number | undefined>)[key] : undefined;
    if (v != null) return v;
    return CLE_FIN_MESUREE[key]?.(data[i]);
  };
  const moyenneProjetee = (i: number, key: string, cur: number | undefined): number | undefined => {
    if (!vueMoyenne || cur == null) return cur;
    const prev = finDuMois(i - 1, key);
    return prev == null ? cur : (prev + cur) / 2;
  };

  const chartDataFusionne = data.map((d, idx) => {
    // Merge projected_* into effectif_* for a single continuous line
    let merged = vueMoyenne && d.moyenne ? { ...d, ...d.moyenne } : d;
    if (merged.projected_apres_mct != null && merged.effectif_apres_mct == null) {
      merged = { ...merged, effectif_apres_mct: merged.projected_apres_mct };
    }
    if (merged.projected_apres_injustifiees != null && merged.effectif_apres_injustifiees == null) {
      merged = { ...merged, effectif_apres_injustifiees: merged.projected_apres_injustifiees };
    }
    if (!showScenario || !selectedProjection) return merged;
    const monthIndex = idx + 1;

    if (monthIndex === lastMctRealMonth && lastMctRealMonth < (lastRealMonthIdx ?? 0)) {
      return {
        ...merged,
        scenario_apres_mct: merged.effectif_apres_mct,
      };
    }

    if (monthIndex === lastRealMonthIdx) {
      return {
        ...merged,
        scenario_brut: merged.effectif_brut,
        scenario_net: merged.effectif_net,
        scenario_reel: merged.effectif_reel,
        scenario_apres_injustifiees: merged.effectif_apres_injustifiees,
        scenario_apres_mct: merged.effectif_apres_mct ?? merged.effectif_reel,
      };
    }

    const monthData = selectedProjection.months.find((m) => m.month_index === monthIndex);
    if (!monthData) return merged;
    return {
      ...merged,
      effectif_brut: undefined,
      effectif_net: undefined,
      effectif_reel: undefined,
      effectif_apres_mct: undefined,
      effectif_apres_injustifiees: undefined,
      scenario_brut: moyenneProjetee(idx, "scenario_brut", monthData.scenario_brut),
      scenario_net: moyenneProjetee(idx, "scenario_net", monthData.scenario_net),
      scenario_reel: moyenneProjetee(idx, "scenario_reel", monthData.scenario_reel),
      scenario_apres_injustifiees: moyenneProjetee(idx, "scenario_apres_injustifiees", monthData.scenario_apres_injustifiees),
      scenario_apres_mct: moyenneProjetee(idx, "scenario_apres_mct", monthData.scenario_apres_mct),
      scenario_apres_conges: moyenneProjetee(idx, "scenario_apres_conges", monthData.scenario_apres_conges),
    };
  });

  // Chaque ligne mesurée se trace en deux traits : plein sur les mois mesurés,
  // pointillé sur les mois reportés (`reporte`). La valeur fusionnée reste
  // sous sa clé d'origine (échelle, infobulle) ; les traits lisent
  // `mesure_*` / `report_*`, raccordés par un point commun à chaque bascule.
  const chartData: Record<string, unknown>[] = chartDataFusionne.map((d) => {
    const row: Record<string, unknown> = { ...d };
    for (const [key, flag] of cleReport) {
      const valeur = row[key] as number | undefined;
      const estReporte = d.reporte?.[flag] === true;
      row[mesureKey(key)] = estReporte ? undefined : valeur;
      row[reportKey(key)] = estReporte ? valeur : undefined;
    }
    return row;
  });
  for (const key of cleReport.keys()) {
    const m = mesureKey(key), r = reportKey(key);
    for (let i = 0; i + 1 < chartData.length; i++) {
      const a = chartData[i], b = chartData[i + 1];
      if (a[m] != null && b[m] == null && b[r] != null) a[r] = a[m];
      if (a[r] != null && a[m] == null && b[m] != null) b[r] = b[m];
    }
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-8">{libelleVide}</p>
        </CardContent>
      </Card>
    );
  }

  // Les séries mesurées restent tracées sur les mois réels quand un scénario
  // est affiché (le pointillé du scénario prend le relais à partir du premier
  // mois projeté) ; une série de scénario n'existe que dans ce cas.
  const aDesValeurs = (key: string) => chartData.some((d) => d[key] != null);
  // Sans taux de congés, « après congés » se confond avec « après MCT » et le
  // recouvrirait : la série n'est proposée que si elle s'en écarte quelque part.
  // Comparaison sur les mois PROJETÉS, les seuls où les deux viennent de la
  // même projection (sur le mois de raccord, « après MCT » vaut la mesure).
  const congesDistincts = chartData.some(
    (d) => d.is_projection === true && d.scenario_apres_conges != null && d.scenario_apres_mct != null && d.scenario_apres_conges !== d.scenario_apres_mct
  );
  const availableSeries = series.filter(
    (s) => (s.isScenario ? showScenario : true) && aDesValeurs(s.key) && (s.key !== "scenario_apres_conges" || congesDistincts)
  );
  const libelle = (s: SeriesDef) => (s.isScenario ? `${s.label} — scénario` : s.label);

  const toggleSeries = (key: string) => {
    setHiddenSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const visibleSeries = availableSeries.filter((s) => !hiddenSeries.has(s.key));

  const projectionStartIndex = chartData.findIndex((d) => d.is_projection);

  const allValues = chartData.flatMap((d) =>
    visibleSeries.map((s) => (d as Record<string, unknown>)[s.key] as number | undefined).filter((v): v is number => v != null)
  );
  const dataMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const dataMax = allValues.length > 0 ? Math.max(...allValues) : 100;
  const range = dataMax - dataMin || 1;
  const padding = Math.max(range * 0.15, axeStep / 2);
  const yMin = Math.max(0, Math.floor((dataMin - padding) / axeStep) * axeStep);
  const yMax = Math.ceil((dataMax + padding) / axeStep) * axeStep;

  // Helper to get scenario name by id
  const getScenarioName = (id: string | null) => scenarios.find((s) => s.id === id)?.name ?? "—";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base">
            {title}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {vueMoyenne ? (showScenario ? "moyenne du mois — scénario : moyenne des deux fins de mois" : "moyenne du mois, pondérée par les jours") : "au dernier jour du mois"}
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
          {moyenneDisponible && (
            <div
              role="group"
              aria-label="Lecture de la courbe"
              className="inline-flex h-8 items-center rounded-md border p-0.5 text-xs"
              title={showScenario ? "Un scénario est projeté en fin de mois : en vue Moyenne, chaque mois projeté vaut la moyenne de ses deux fins de mois." : undefined}
            >
              {([["fin", "Fin de mois"], ["moyenne", "Moyenne"]] as const).map(([cle, libelle]) => {
                const actif = cle === "moyenne" ? vueMoyenne : !vueMoyenne;
                return (
                  <button
                    key={cle}
                    type="button"
                    aria-pressed={actif}
                    onClick={() => setVue(cle)}
                    className={`h-full rounded px-2.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${actif ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
                  >
                    {libelle}
                  </button>
                );
              })}
            </div>
          )}
          {scenarios.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                  {selectedIds.size > 0 ? (
                    <>
                      <Badge variant="secondary" className="text-xs px-1.5 py-0">
                        {selectedIds.size} scénario{selectedIds.size > 1 ? "s" : ""}
                      </Badge>
                      <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                    </>
                  ) : (
                    <>
                      Scénarios
                      <ChevronDown className="h-3.5 w-3.5 opacity-50" />
                    </>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[380px] p-0" align="end">
                <div className="p-3 border-b">
                  <p className="text-sm font-medium">Combiner des scénarios</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Les hypothèses s&apos;additionnent. Choisissez la source des taux.
                  </p>
                </div>
                <div className="max-h-[300px] overflow-y-auto p-2 space-y-1">
                  {scenarios.map((sc) => {
                    const isSelected = selectedIds.has(sc.id);
                    return (
                      <div
                        key={sc.id}
                        className={`rounded-md border p-2 transition-colors ${isSelected ? "border-primary/30 bg-primary/5" : "border-transparent"}`}
                      >
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id={`sc-${sc.id}`}
                            checked={isSelected}
                            onCheckedChange={() => toggleScenario(sc.id)}
                          />
                          <label
                            htmlFor={`sc-${sc.id}`}
                            className="text-sm font-medium cursor-pointer flex-1"
                          >
                            {sc.name}
                          </label>
                        </div>
                        {isSelected && (
                          <div className="flex gap-3 mt-2 ml-6">
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name="turnover_src"
                                checked={turnoverSrc === sc.id}
                                onChange={() => setTurnoverSource(sc.id)}
                                className="h-3 w-3 accent-primary"
                              />
                              <span className="text-xs text-muted-foreground">Turnover</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name="abs_src"
                                checked={absSrc === sc.id}
                                onChange={() => setAbsSource(sc.id)}
                                className="h-3 w-3 accent-primary"
                              />
                              <span className="text-xs text-muted-foreground">Absentéisme</span>
                            </label>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="radio"
                                name="leave_src"
                                checked={leaveSrc === sc.id}
                                onChange={() => setLeaveSource(sc.id)}
                                className="h-3 w-3 accent-primary"
                              />
                              <span className="text-xs text-muted-foreground">Congés</span>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {selectedIds.size > 0 && (
                  <div className="p-2 border-t text-xs text-muted-foreground space-y-0.5">
                    <div>Turnover : <span className="font-medium text-foreground">{getScenarioName(turnoverSrc)}</span></div>
                    <div>Absentéisme : <span className="font-medium text-foreground">{getScenarioName(absSrc)}</span></div>
                    <div>Congés : <span className="font-medium text-foreground">{getScenarioName(leaveSrc)}</span></div>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          )}
          </div>
        </div>

        {/* Series toggles */}
        <div className="flex flex-wrap gap-2 pt-2">
          {availableSeries.map((s) => {
            const active = !hiddenSeries.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => toggleSeries(s.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  active
                    ? "border-transparent text-white"
                    : "border-border bg-muted/40 text-muted-foreground"
                }`}
                style={active ? { backgroundColor: s.color } : undefined}
              >
                <span
                  className="inline-block h-2 w-4 rounded-sm"
                  style={{
                    backgroundColor: active ? "rgba(255,255,255,0.6)" : s.color,
                    borderBottom: s.dashed ? `2px dashed ${active ? "rgba(255,255,255,0.8)" : s.color}` : undefined,
                  }}
                />
                {libelle(s)}
              </button>
            );
          })}
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="month"
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              className="text-muted-foreground"
              domain={[yMin, yMax]}
              tickFormatter={(v: number) => formatValue(v)}
              width={axeStep >= 1000 ? 80 : 60}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as Record<string, unknown>;
                // L'ordre des séries est celui de la chaîne ; les écarts suivent `parent`
                const visibles = series.map((s) => s.key).filter((k) => visibleSeries.some((s) => s.key === k) && row[k] != null);
                return (
                  <div style={{ borderRadius: "8px", border: "1px solid var(--border)", backgroundColor: "var(--background)", padding: "8px 12px", fontSize: 12 }}>
                    {visibles.map((key) => {
                      const serie = series.find((s) => s.key === key)!;
                      const val = row[key] as number;
                      const flag = cleReport.get(key);
                      const reporte = flag != null && row.reporte != null && (row.reporte as Record<string, boolean>)[flag] === true;
                      // Série parente masquée : on remonte la chaîne jusqu'à une série affichée
                      let parentKey: string | undefined = deltaParent.get(key);
                      while (parentKey && !visibles.includes(parentKey)) parentKey = deltaParent.get(parentKey);
                      const parent = parentKey ? (row[parentKey] as number) : null;
                      const delta = parent != null ? val - parent : null;
                      return (
                        <div key={key} style={{ color: serie.color, padding: "2px 0" }}>
                          {libelle(serie)} : {formatValue(val)}
                          {delta != null && <span style={{ fontSize: "0.75em", color: "#999" }}> ({delta >= 0 ? "+" : "−"}{formatValue(Math.abs(delta))})</span>}
                          {reporte && <span style={{ fontSize: "0.75em", color: "#999", fontStyle: "italic" }}> reporté</span>}
                        </div>
                      );
                    })}
                  </div>
                );
              }}
            />
            <Legend
              content={() => null}
            />

            {visibleSeries.map((s) =>
              cleReport.has(s.key) ? (
                // Mesuré en trait plein, reporté en pointillé (même couleur, même pastille)
                <Fragment key={s.key}>
                  <Line type="monotone" dataKey={mesureKey(s.key)} name={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} activeDot={s.key === brushDataKey ? { r: 5 } : undefined} isAnimationActive={false} />
                  <Line type="monotone" dataKey={reportKey(s.key)} name={s.key} stroke={s.color} strokeWidth={2} strokeDasharray="8 4" dot={{ r: 3, fill: "var(--background)" }} activeDot={s.key === brushDataKey ? { r: 5 } : undefined} isAnimationActive={false} />
                </Fragment>
              ) : (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  strokeDasharray={s.dashed ? (s.isScenario ? "6 3" : "8 4") : undefined}
                  dot={s.key === "target" ? false : { r: s.isScenario ? 2 : 3 }}
                  connectNulls={s.connectNulls ?? s.dashed === true}
                  isAnimationActive={false}
                />
              )
            )}

            {projectionStartIndex > 0 && (
              <ReferenceLine
                x={data[projectionStartIndex].month}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                label={{ value: "Projection", position: "top", fontSize: 11 }}
              />
            )}

            <Brush
              dataKey="month"
              height={24}
              stroke="#d1d5db"
              fill="#f9fafb"
              travellerWidth={8}
              startIndex={0}
              endIndex={chartData.length - 1}
            >
              <LineChart data={chartData}>
                <Line type="monotone" dataKey={brushDataKey} stroke="#93c5fd" strokeWidth={1} dot={false} />
              </LineChart>
            </Brush>
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
