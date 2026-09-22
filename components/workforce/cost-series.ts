import type { SeriesDef } from "./headcount-evolution-chart";

/**
 * Séries de la page Coûts : les mêmes clés et les mêmes couleurs que la courbe
 * des effectifs (un palier se reconnaît d'une page à l'autre), les valeurs en
 * euros. « Réalisé » est la paie du mois (Total SECU des statistiques
 * salariales), tracée seulement sur les mois qui portent des montants.
 */
export const SERIES_COUTS: SeriesDef[] = [
  { key: "effectif_brut", label: "Sous contrat", color: "hsl(221, 83%, 53%)", reportFlag: "brut" },
  { key: "effectif_net", label: "Net (après suspensions)", color: "hsl(262, 83%, 58%)", reportFlag: "net", parent: "effectif_brut" },
  { key: "effectif_reel", label: "Réel (après CNS)", color: "hsl(142, 71%, 45%)", reportFlag: "reel", parent: "effectif_net" },
  { key: "effectif_apres_injustifiees", label: "Payé (après injustifiées)", color: "hsl(45, 93%, 47%)", reportFlag: "injustifiees", parent: "effectif_reel" },
  { key: "effectif_apres_mct", label: "Disponible (après MCT)", color: "hsl(330, 70%, 55%)", reportFlag: "mct", parent: "effectif_apres_injustifiees" },
  { key: "realise", label: "Réalisé (paie du mois)", color: "hsl(215, 14%, 34%)", connectNulls: false },
  { key: "scenario_brut", label: "Sous contrat", color: "hsl(221, 83%, 53%)", dashed: true, isScenario: true },
  { key: "scenario_net", label: "Net", color: "hsl(262, 83%, 58%)", dashed: true, isScenario: true, parent: "scenario_brut" },
  { key: "scenario_reel", label: "Réel (après CNS)", color: "hsl(142, 71%, 45%)", dashed: true, isScenario: true, parent: "scenario_net" },
  { key: "scenario_apres_mct", label: "Après MCT", color: "hsl(330, 70%, 55%)", dashed: true, isScenario: true, parent: "scenario_reel" },
  { key: "scenario_apres_conges", label: "Disponible (après congés)", color: "hsl(30, 90%, 50%)", dashed: true, isScenario: true, parent: "scenario_apres_mct" },
];

/** Pas de l'axe Y adapté à l'ordre de grandeur des montants (10 000 € pour une masse de quelques millions). */
export function pasAxeEuros(maxValeur: number): number {
  if (maxValeur <= 0) return 1000;
  const ordre = 10 ** Math.floor(Math.log10(maxValeur));
  return Math.max(1000, ordre / 100);
}
