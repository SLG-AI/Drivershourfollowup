/**
 * Calendrier de la paie SLA : les versements qui reviennent à date fixe et que
 * le contractuel ne modélise pas. Sans eux, un pic de janvier, mai, septembre
 * ou décembre se lit comme une dérive alors que c'est un rythme de paiement.
 *
 * Périodes de référence de 4 mois : le décompte de fin de période (heures,
 * 6e jour…) est payé en janvier, mai et septembre. Mai porte aussi les bonus
 * annuels ; décembre le 13e mois des employés (ni chauffeurs, ni cadres — les
 * chauffeurs le touchent proratisé chaque mois) et certaines primes, dont une
 * partie glisse parfois en janvier. Arbitrage utilisateur du 28/09/2026.
 */

export const MOIS_DECOMPTE_PERIODE = [1, 5, 9] as const;

/** Les versements calendaires attendus un mois donné (1–12), dans l'ordre de lecture. */
export function evenementsPaieDuMois(mois: number): string[] {
  const evenements: string[] = [];
  if ((MOIS_DECOMPTE_PERIODE as readonly number[]).includes(mois)) {
    evenements.push("décompte de fin de période de référence (4 mois), qui gonfle la part liée au planning");
  }
  if (mois === 5) evenements.push("bonus annuels");
  if (mois === 12) evenements.push("13e mois des employés (hors chauffeurs et cadres) et certaines primes");
  if (mois === 1) evenements.push("reliquat éventuel des primes de décembre");
  return evenements;
}

/** Phrase prête à afficher, ou null pour un mois sans versement calendaire. */
export function mentionCalendrierPaie(mois: number): string | null {
  const e = evenementsPaieDuMois(mois);
  if (e.length === 0) return null;
  return `Mois de versements calendaires : ${e.join(" ; ")}. Le contractuel ne les modélise pas.`;
}
