/**
 * Courbe des coûts : les douze points de l'année en euros, calqués sur les
 * douze points en ETP de `wp-courbe-effectifs.ts`.
 *
 * PRINCIPE. Chaque point € reprend le point ETP du même mois : mêmes photos,
 * mêmes drapeaux de report, mêmes taux d'absence. Un palier mesuré en ETP
 * (fichier d'absence présent) est valorisé salarié par salarié
 * (`calculerCoutsPaliers`, un absent bien payé coûte plus qu'un absent au
 * salaire minimum) ; un palier repris en ETP applique le même taux repris au
 * coût net (`appliquerTauxReporte`). Les clés de sortie sont celles de la
 * courbe ETP (`effectif_brut`…) pour que le graphique et la vue Moyenne
 * fonctionnent sans rien savoir de l'unité.
 *
 * SALAIRES. Le brut d'un salarié vient de la photo du mois si elle en porte,
 * sinon de la photo de référence (dernière photo avec salaires) : dans ce cas
 * le point est reporté (`reporte.cout`) et tracé en pointillé.
 */

import type { HeadcountDataPoint, Reporte } from "@/components/workforce/headcount-evolution-chart";
import { paliersEnMoyenne } from "./wp-effectif-moyen";
import { injustifieesDuPerimetre, type LigneCns, type LigneHeures } from "./wp-paliers";
import {
  appliquerTauxReporte,
  calculerCoutsPaliers,
  construireSourceSalaires,
  realiseDuMois,
  type ComplementsRecurrents,
  type CoutsMois,
  type LigneStatSalariale,
  type SalarieCout,
} from "./wp-couts";

export interface EntreesCourbeCouts {
  /** Les douze points ETP de l'année (avec `reporte`, `taux_appliques`, `moyenne_brute`). */
  headcountData: HeadcountDataPoint[];
  selectedYear: number;
  filtresActifs: boolean;
  /** Photo d'un mois, filtrée et reclassifiée, avec `brut_indice`. */
  photoDuMois: (mois: number) => SalarieCout[];
  /** Dernière photo portant des salaires (non filtrée), ou null si aucune. */
  photoReference: SalarieCout[] | null;
  coef: number;
  /** Coefficient par cost center lu dans la paie (voir calculerCoefficientsParCostCenter), optionnel. */
  coefParCc?: Map<string, { coef: number }>;
  /** Compléments récurrents mesurés sur la Liste des salaires (voir calculerComplementsRecurrents), optionnel. */
  complements?: ComplementsRecurrents | null;
  absences: LigneCns[];
  mctHorsWeekEnd: LigneHeures[];
  absencesInjustifiees: LigneHeures[];
  /** Statistiques salariales de l'année (paie réalisée). */
  stats: LigneStatSalariale[];
}

export interface PointCouts {
  /** Chaîne détaillée du mois (coûts perdus, coût moyen ETP, codes sans brut). */
  couts: CoutsMois;
  realise: ReturnType<typeof realiseDuMois>;
  /** Le point tel que le graphique le trace, en euros. */
  point: HeadcountDataPoint;
}

const arrondi = (n: number | undefined) => (n == null ? undefined : Math.round(n));

export function construireCourbeCouts(e: EntreesCourbeCouts): PointCouts[] {
  return e.headcountData.map((etp, idx) => {
    const m = idx + 1;
    const photo = e.photoDuMois(m);
    const codes = new Set(photo.map((s) => s.code_salarie));
    const source = construireSourceSalaires(photo, e.photoReference);
    const couts = calculerCoutsPaliers(
      photo,
      e.absences,
      e.mctHorsWeekEnd,
      injustifieesDuPerimetre(e.absencesInjustifiees, e.filtresActifs, codes),
      m,
      e.selectedYear,
      { coef: e.coef, source, coefParCc: e.coefParCc, complements: e.complements }
    );

    // Un palier suit la règle de son homologue ETP : mesuré ⇒ valorisé
    // salarié par salarié ; repris ⇒ taux repris appliqué au coût net.
    const rep = etp.reporte ?? {};
    const taux = etp.taux_appliques ?? { cns: null, inj: null, mct: null };
    const net = couts.apresSuspension;
    const mesure = (cle: string) => couts.etapes.find((x) => x.cle === cle)?.mesure === true;
    const repris = appliquerTauxReporte(net, taux);
    const apresCns = mesure("taux-cns") ? couts.apresCns : repris.apresCns;
    const perduInj = mesure("taux-injustifiees") ? couts.coutPerduInjustifiees : taux.inj != null ? net * (taux.inj / 100) : undefined;
    const apresInj = apresCns != null && perduInj != null ? apresCns - perduInj : undefined;
    const perduMct = mesure("taux-mct") ? couts.coutPerduMct : taux.mct != null ? net * (taux.mct / 100) : undefined;
    const apresMct = apresInj != null && perduMct != null ? apresInj - perduMct : undefined;

    const realise = realiseDuMois(e.stats, m, e.selectedYear, e.filtresActifs ? codes : undefined);

    // Report : celui du palier ETP, ou un salaire lu hors de la photo du mois
    const reporte: Reporte = {
      brut: rep.brut || source.reporte,
      net: rep.net || source.reporte,
      reel: rep.reel || source.reporte,
      injustifiees: rep.injustifiees || source.reporte,
      mct: rep.mct || source.reporte,
      cout: source.reporte,
    };

    const point: HeadcountDataPoint = {
      month: etp.month,
      effectif_brut: Math.round(couts.sousContrat),
      effectif_net: Math.round(net),
      effectif_reel: arrondi(apresCns),
      effectif_apres_injustifiees: arrondi(apresInj),
      effectif_apres_mct: arrondi(apresMct),
      // Réalisé employeur : brut + charges patronales quand la paie les porte,
      // sinon le brut réel × coefficient (estimation)
      realise: realise.mesure ? Math.round(realise.employeurMesure ? realise.employeur : realise.brut * e.coef) : undefined,
      is_projection: etp.is_projection,
      reporte,
      taux_appliques: etp.taux_appliques,
    };
    // Vue Moyenne : mêmes ratios moyenne/fin de mois que les ETP
    if (etp.moyenne_brute && etp.effectif_brut > 0 && etp.effectif_net > 0) {
      const moyenne = {
        brut: couts.sousContrat * (etp.moyenne_brute.brut / etp.effectif_brut),
        net: net * (etp.moyenne_brute.net / etp.effectif_net),
      };
      point.moyenne_brute = moyenne;
      point.moyenne = paliersEnMoyenne(point, moyenne);
    }
    return { couts, realise, point };
  });
}
