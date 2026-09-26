/**
 * Taux d'absence CNS par salarié : plafond à 100 % et contrôle à l'import.
 *
 * POURQUOI. `pct_absenteisme` est repris TEL QUEL du fichier des absences CNS,
 * et l'application le multiplie par l'ETP du salarié pour obtenir l'ETP perdu.
 * Or le SIRH crédite parfois des journées pleines sur des jours NON ouvrés :
 * 248 h de maladie (8 h × 31 jours calendaires) pour 168 h théoriques en août
 * 2026, soit 147,6 %. Tel quel, ce salarié « faisait perdre » 1,48 ETP — plus
 * que ce qu'il pèse. Un salarié ne peut pas être absent plus qu'à 100 %.
 *
 * OÙ. Le plafond s'applique À LA LECTURE de `wp_absences`, une fois, avant
 * tous les calculs (tableau de bord, historique, méthodologie, scénarios,
 * besoins cibles). La base garde la valeur du fichier : c'est la donnée
 * source, et c'est elle qu'il faut pouvoir remonter au SIRH.
 *
 * Les HEURES ne sont pas touchées : elles restent celles du fichier.
 */

export const TAUX_CNS_MAX = 100;

export interface LigneTauxCns {
  pct_absenteisme?: number | string | null;
}

/**
 * Ramène à 100 % les taux qui le dépassent. La valeur du fichier est conservée
 * dans `pct_absenteisme_source` sur les seules lignes plafonnées.
 */
export function plafonnerTauxCns<T extends LigneTauxCns>(
  lignes: T[]
): (T & { pct_absenteisme_source?: number })[] {
  return lignes.map((l) => {
    const pct = Number(l.pct_absenteisme);
    if (!Number.isFinite(pct) || pct <= TAUX_CNS_MAX) return l;
    return { ...l, pct_absenteisme: TAUX_CNS_MAX, pct_absenteisme_source: pct };
  });
}

// ============================================================
// Contrôle à l'import
// ============================================================

export interface LigneCnsAControler extends LigneTauxCns {
  code_salarie?: string | null;
  heures_theoriques?: number | string | null;
  hrs_maladie?: number | string | null;
  hrs_accident?: number | string | null;
  hrs_maternite?: number | string | null;
  hrs_raisons_familiales?: number | string | null;
  hrs_conge_accompagnement?: number | string | null;
  hrs_accueil?: number | string | null;
}

export interface AnomalieTauxCns {
  code_salarie: string;
  pct: number;
  heuresAbsence: number;
  heuresTheoriques: number;
}

const n = (v: number | string | null | undefined): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** Lignes dont le taux dépasse 100 %, les plus fortes d'abord. */
export function controlerTauxCns(lignes: LigneCnsAControler[]): AnomalieTauxCns[] {
  return lignes
    .filter((l) => n(l.pct_absenteisme) > TAUX_CNS_MAX)
    .map((l) => ({
      code_salarie: String(l.code_salarie || ""),
      pct: n(l.pct_absenteisme),
      heuresAbsence:
        n(l.hrs_maladie) + n(l.hrs_accident) + n(l.hrs_maternite) +
        n(l.hrs_raisons_familiales) + n(l.hrs_conge_accompagnement) + n(l.hrs_accueil),
      heuresTheoriques: n(l.heures_theoriques),
    }))
    .sort((a, b) => b.pct - a.pct);
}

const nf1 = (x: number) => x.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf0 = (x: number) => x.toLocaleString("fr-FR", { maximumFractionDigits: 0 });

/** Avertissement pour l'écran d'import. Tableau vide quand il n'y a rien à dire. */
export function messagesControleTauxCns(anomalies: AnomalieTauxCns[], exemplesMax = 3): string[] {
  if (anomalies.length === 0) return [];
  const pluriel = anomalies.length > 1;
  const exemples = anomalies
    .slice(0, exemplesMax)
    .map((a) => `${a.code_salarie} ${nf1(a.pct)} % (${nf0(a.heuresAbsence)} h d'absence pour ${nf0(a.heuresTheoriques)} h théoriques)`)
    .join(" ; ");
  const reste = anomalies.length - Math.min(exemplesMax, anomalies.length);
  return [
    `${anomalies.length} salarié${pluriel ? "s" : ""} ${pluriel ? "ont" : "a"} un taux d'absence supérieur à 100 % — ${exemples}${reste > 0 ? `, et ${reste} autre${reste > 1 ? "s" : ""}` : ""}. ` +
      `Le fichier compte plus d'heures d'absence que d'heures théoriques (absence créditée sur des jours non ouvrés ?). ` +
      `L'import conserve ces valeurs ; les indicateurs plafonnent le taux à 100 %. À vérifier dans le SIRH.`,
  ];
}
