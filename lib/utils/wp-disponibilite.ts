/**
 * Effectif disponible après congés, mois par mois sur une année (onglet
 * « Disponibilité » de l'analyse historique).
 *
 * Chaque mois se lit dans SA photo (roster-photos.ts), reclassifiée comme au
 * tableau de bord, et passe par la même chaîne de paliers (`calculerPaliers`).
 *
 * RÈGLE (arbitrée le 2026-10-09) : le disponible et les congés ne s'affichent
 * QUE sur les mois aux congés complets (`moisCongesComplets`). Un mois où
 * seuls les congés des services supports sont importés vaut `null`, comme un
 * mois sans congés : aucune estimation, aucun report. Un mois sans absence
 * MCT importée est omis.
 */

import { estJourDeWeekEnd } from "./wp-calculations";
import { photoPourLeMois, type PhotosParRang } from "./roster-photos";
import { reclassifierSortiesTemporaires } from "./wp-suspension";
import { calculerPaliers, injustifieesDuPerimetre, type LigneCns, type LigneHeures, type SalariePaliers } from "./wp-paliers";
import type { LigneConge } from "./wp-conges";

export interface DisponibiliteMois {
  mois: number;
  sousContrat: number;
  apresMct: number;
  /** null quand les congés du mois ne sont pas complets. */
  heuresConges: number | null;
  etpConges: number | null;
  heuresExtra: number | null;
  etpExtra: number | null;
  /** Taux de congés (congés + extraordinaires) en %, rapporté à l'effectif après suspension. */
  tauxConges: number | null;
  disponible: number | null;
}

export interface DisponibiliteAnnee {
  annee: number;
  parMois: DisponibiliteMois[];
  /** Mois aux congés complets, base de la synthèse. */
  moisComplets: number[];
  disponibleMoyen: number | null;
  tauxCongesMoyen: number | null;
  /** Mois complet où les congés retirent le plus d'ETP. */
  moisPlusCharge: { mois: number; etp: number } | null;
}

const arrondi1 = (x: number) => Math.round(x * 10) / 10;
const moyenne = (xs: number[]) => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function analyserDisponibilite<T extends SalariePaliers & { mois?: number | string | null; annee?: number | string | null }>(
  annee: number,
  moisCouverts: number[],
  photos: PhotosParRang<T>,
  cns: LigneCns[],
  mct: (LigneHeures & { annee?: number | string | null; date_absence?: string | null })[],
  injustifiees: (LigneHeures & { annee?: number | string | null })[],
  conges: (LigneConge & { annee?: number | string | null })[],
  complets: Set<number>,
  filtresActifs: boolean
): DisponibiliteAnnee {
  const deLAnnee = <L extends { annee?: number | string | null }>(lignes: L[]) => lignes.filter((l) => Number(l.annee) === annee);
  const cnsAnnee = deLAnnee(cns as (LigneCns & { annee?: number | string | null })[]);
  const mctAnnee = deLAnnee(mct).filter((a) => !estJourDeWeekEnd(a.date_absence));
  const injAnnee = deLAnnee(injustifiees);
  const congesAnnee = deLAnnee(conges).filter((c) => !estJourDeWeekEnd(c.date_conge));
  const codesAvecMaladieCns = new Set(cnsAnnee.filter((a) => Number(a.hrs_maladie || 0) > 0).map((a) => a.code_salarie));

  const parMois: DisponibiliteMois[] = [];
  moisCouverts.forEach((m) => {
    const photo = reclassifierSortiesTemporaires(
      photoPourLeMois(photos, m, annee).lignes.map((e) => ({ ...e })),
      codesAvecMaladieCns
    );
    if (photo.length === 0) return;
    const codes = new Set(photo.map((e) => e.code_salarie));
    const complet = complets.has(m);
    const p = calculerPaliers(
      photo,
      cnsAnnee.filter((a) => codes.has(a.code_salarie)),
      mctAnnee,
      injustifieesDuPerimetre(injAnnee, filtresActifs, codes),
      m,
      annee,
      complet ? congesAnnee : []
    );
    // Un mois sans absence MCT (mois en cours, pas encore importé) n'a pas
    // d'« après MCT » : on ne trace rien plutôt qu'un faux saut.
    if (!p.mctMesure) return;
    const etpConges = complet && p.heuresTravaillables > 0 ? p.heuresConges / p.heuresTravaillables : null;
    const etpExtra = complet && p.heuresTravaillables > 0 ? p.heuresCongesExtra / p.heuresTravaillables : null;
    parMois.push({
      mois: m,
      sousContrat: arrondi1(p.sousContrat),
      apresMct: arrondi1(p.apresMct),
      heuresConges: complet ? Math.round(p.heuresConges) : null,
      etpConges: etpConges === null ? null : arrondi1(etpConges),
      heuresExtra: complet ? Math.round(p.heuresCongesExtra) : null,
      etpExtra: etpExtra === null ? null : arrondi1(etpExtra),
      tauxConges: complet ? arrondi1(p.tauxConges) : null,
      disponible: complet ? arrondi1(p.apresConges) : null,
    });
  });

  const completsMesures = parMois.filter((x) => x.disponible !== null);
  const plusCharge = completsMesures.reduce<DisponibiliteMois | null>(
    (best, x) => (best === null || (x.etpConges ?? 0) + (x.etpExtra ?? 0) > (best.etpConges ?? 0) + (best.etpExtra ?? 0) ? x : best),
    null
  );
  const disponibleMoyen = moyenne(completsMesures.map((x) => x.disponible as number));
  const tauxCongesMoyen = moyenne(completsMesures.map((x) => x.tauxConges as number));

  return {
    annee,
    parMois,
    moisComplets: completsMesures.map((x) => x.mois),
    disponibleMoyen: disponibleMoyen === null ? null : arrondi1(disponibleMoyen),
    tauxCongesMoyen: tauxCongesMoyen === null ? null : arrondi1(tauxCongesMoyen),
    moisPlusCharge: plusCharge
      ? { mois: plusCharge.mois, etp: arrondi1((plusCharge.etpConges ?? 0) + (plusCharge.etpExtra ?? 0)) }
      : null,
  };
}
