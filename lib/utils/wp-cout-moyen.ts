/**
 * Coût employeur moyen d'un ETP pour un PROFIL de salarié, par repli
 * successif.
 *
 * POURQUOI : la projection embauche des salariés qui n'existent pas encore,
 * et le tableau de bord rencontre des salariés sans brut (entrés après
 * l'export des salaires, absents de la photo). Il faut leur prêter un coût.
 * Le meilleur estimateur est la moyenne des salariés qui leur ressemblent le
 * plus ; faute de comparable assez proche, on élargit le cercle, et on DIT à
 * quel niveau on s'est arrêté (`niveau`) pour que la page puisse l'afficher.
 *
 * OÙ : la chaîne de repli, du plus précis au plus large :
 *   (1) même cost center, même fonction, même famille de contrat (CDI/CDD)
 *   (2) même dépôt, même fonction, même famille
 *   (3) toute l'entreprise, même fonction, même famille
 *   (4) même cost center, même fonction
 *   (5) toute l'entreprise, même fonction
 *   (6) toute l'entreprise
 *   (7) la valeur par défaut fournie par l'appelant
 * Un critère vide dans le profil fait sauter les niveaux qui l'exigent : sans
 * cost center on saute (1) et (4), sans dépôt (2), sans fonction on va
 * directement à (6).
 *
 * La moyenne porte sur les bruts À PLEIN TEMPS, sans pondération par le taux
 * d'occupation : on cherche le coût d'UN ETP, un mi-temps renseigne autant
 * qu'un temps plein sur ce que vaut le poste.
 */

import { familleContrat } from "./wp-filtres";
import { brutPleinTempsDe, type SalarieCout } from "./wp-couts";

export interface ProfilCout {
  fonction: string | null;
  famille: "CDI" | "CDD" | "";
  centre_cout: string | null;
  /** Dépôt = `description_service` du SIRH. */
  depot: string | null;
}

export type NiveauRepli =
  | "cc_profil"
  | "depot_profil"
  | "entreprise_profil"
  | "cc_fonction"
  | "entreprise_fonction"
  | "entreprise"
  | "defaut";

export interface CoutMoyen {
  /** Coût employeur d'un ETP = brut plein temps moyen × coef (ou la valeur par défaut). */
  coutEtp: number;
  niveau: NiveauRepli;
  /** Nombre de salariés comparables ayant servi à la moyenne (0 au niveau par défaut). */
  n: number;
  /** Brut plein temps moyen des comparables (0 au niveau par défaut). */
  brutPleinTempsMoyen: number;
}

export const LIBELLES_REPLI: Record<NiveauRepli, string> = {
  cc_profil: "même cost center et même profil",
  depot_profil: "même dépôt et même profil",
  entreprise_profil: "même profil dans toute l'entreprise",
  cc_fonction: "même cost center et même fonction",
  entreprise_fonction: "même fonction dans toute l'entreprise",
  entreprise: "moyenne de toute l'entreprise",
  defaut: "coût moyen du périmètre (aucun salarié comparable avec salaire)",
};

/** Profil de comparaison d'un salarié de la photo. */
export function profilDe(e: SalarieCout): ProfilCout {
  return {
    fonction: e.description_fonction ?? null,
    famille: familleContrat(e.type_contrat),
    centre_cout: e.centre_cout ?? null,
    depot: e.description_service ?? null,
  };
}

/** Clé de comparaison : insensible à la casse et aux espaces de bord ; vide pour null. */
function cle(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function memeFonction(e: SalarieCout, profil: ProfilCout): boolean {
  return cle(e.description_fonction) === cle(profil.fonction);
}
function memeFamille(e: SalarieCout, profil: ProfilCout): boolean {
  return familleContrat(e.type_contrat) === profil.famille;
}
function memeCentreCout(e: SalarieCout, profil: ProfilCout): boolean {
  return cle(e.centre_cout) === cle(profil.centre_cout);
}
function memeDepot(e: SalarieCout, profil: ProfilCout): boolean {
  return cle(e.description_service) === cle(profil.depot);
}

/**
 * Coût employeur moyen d'un ETP pour un profil, au niveau de repli le plus
 * précis qui trouve au moins un comparable AVEC brut. `defaut` est déjà un
 * coût employeur : il n'est pas multiplié par `coef`.
 */
export function coutMoyenEtp(population: SalarieCout[], profil: ProfilCout, coef: number, defaut: number): CoutMoyen {
  const avecBrut = population.filter((e) => brutPleinTempsDe(e) !== null);
  const aFonction = cle(profil.fonction) !== "";
  const aCentreCout = cle(profil.centre_cout) !== "";
  const aDepot = cle(profil.depot) !== "";

  const niveaux: Array<{ niveau: NiveauRepli; actif: boolean; filtre: (e: SalarieCout) => boolean }> = [
    {
      niveau: "cc_profil",
      actif: aFonction && aCentreCout,
      filtre: (e) => memeCentreCout(e, profil) && memeFonction(e, profil) && memeFamille(e, profil),
    },
    {
      niveau: "depot_profil",
      actif: aFonction && aDepot,
      filtre: (e) => memeDepot(e, profil) && memeFonction(e, profil) && memeFamille(e, profil),
    },
    {
      niveau: "entreprise_profil",
      actif: aFonction,
      filtre: (e) => memeFonction(e, profil) && memeFamille(e, profil),
    },
    {
      niveau: "cc_fonction",
      actif: aFonction && aCentreCout,
      filtre: (e) => memeCentreCout(e, profil) && memeFonction(e, profil),
    },
    { niveau: "entreprise_fonction", actif: aFonction, filtre: (e) => memeFonction(e, profil) },
    { niveau: "entreprise", actif: true, filtre: () => true },
  ];

  for (const { niveau, actif, filtre } of niveaux) {
    if (!actif) continue;
    const comparables = avecBrut.filter(filtre);
    if (comparables.length === 0) continue;
    const brutMoyen = comparables.reduce((s, e) => s + (brutPleinTempsDe(e) ?? 0), 0) / comparables.length;
    return { coutEtp: brutMoyen * coef, niveau, n: comparables.length, brutPleinTempsMoyen: brutMoyen };
  }
  return { coutEtp: defaut, niveau: "defaut", n: 0, brutPleinTempsMoyen: 0 };
}
