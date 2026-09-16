/**
 * Résolution de la période de roster.
 *
 * wp_employees est historisé : il contient une photographie d'effectif par
 * mois. Tout lecteur DOIT donc filtrer sur une période, faute de quoi un même
 * salarié est compté autant de fois qu'il y a de mois en base.
 */

export interface RosterPeriod {
  mois: number;
  annee: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Périodes de roster disponibles, de la plus récente à la plus ancienne.
 *
 * On interroge la vue wp_employee_periods et non wp_employees : PostgREST
 * plafonne une réponse à 1000 lignes, or un seul mois dépasse 1400 salariés.
 * Lire la table renvoyait donc uniquement le mois le plus récent, et tous les
 * autres passaient pour absents.
 */
export async function listRosterPeriods(supabase: any): Promise<RosterPeriod[]> {
  const { data } = await supabase
    .from("wp_employee_periods")
    .select("mois, annee")
    .order("annee", { ascending: false })
    .order("mois", { ascending: false });

  if (!data) return [];
  return (data as RosterPeriod[]).map((r) => ({ mois: r.mois, annee: r.annee }));
}

/** Période de roster la plus récente, ou null si aucun roster n'est importé. */
export async function getLatestRosterPeriod(supabase: any): Promise<RosterPeriod | null> {
  const periodes = await listRosterPeriods(supabase);
  return periodes[0] ?? null;
}

/** Rang absolu d'une période, pour comparer deux mois d'années différentes. */
export function rangPeriode(p: RosterPeriod): number {
  return p.annee * 12 + p.mois;
}

/**
 * Choix pur de la photographie à retenir pour un mois demandé, parmi des
 * périodes triées de la plus récente à la plus ancienne (ordre de
 * listRosterPeriods).
 *
 * Exacte si elle existe. Sinon la plus récente ANTÉRIEURE au mois demandé :
 * un effectif se reconduit, alors qu'un effectif futur ne dit rien du passé.
 * En dernier recours seulement — aucune photo antérieure — la plus ancienne
 * disponible, pour ne pas laisser un trou.
 *
 * Sert aussi à la courbe d'évolution, qui lit CHAQUE mois dans sa propre
 * photo : une seule photo reconstruite par les dates d'entrée/sortie ignore
 * les embauches postérieures et les départs antérieurs à l'export.
 */
export function choisirPeriodeRoster(
  periodes: RosterPeriod[],
  mois: number,
  annee: number
): { periode: RosterPeriod | null; exacte: boolean } {
  if (periodes.length === 0) return { periode: null, exacte: false };

  const triees = periodes.slice().sort((a, b) => rangPeriode(b) - rangPeriode(a));
  const demande = annee * 12 + mois;

  const exacte = triees.find((p) => rangPeriode(p) === demande);
  if (exacte) return { periode: exacte, exacte: true };

  const anterieure = triees.find((p) => rangPeriode(p) < demande);
  if (anterieure) return { periode: anterieure, exacte: false };

  return { periode: triees[triees.length - 1], exacte: false };
}

/**
 * Période à afficher pour un mois demandé (voir choisirPeriodeRoster).
 * `exacte` permet à l'appelant de signaler un affichage par défaut.
 */
export async function resolveRosterPeriod(
  supabase: any,
  mois: number,
  annee: number
): Promise<{ periode: RosterPeriod | null; exacte: boolean }> {
  return choisirPeriodeRoster(await listRosterPeriods(supabase), mois, annee);
}
