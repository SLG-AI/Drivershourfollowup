/**
 * Restitution sans identification : un groupe de moins de SEUIL_ANONYMAT
 * personnes livrerait le salaire de chacune. Ces groupes sont fondus en un
 * « Autres » ; si ce regroupement reste lui-même sous le seuil, il absorbe
 * les plus petits des autres groupes jusqu'à l'atteindre. Arbitrage
 * utilisateur du 29/09/2026 : seuil de 3.
 */

export const SEUIL_ANONYMAT = 3;

export function regrouperPetitsGroupes<T>(
  groupes: T[],
  taille: (g: T) => number,
  fusionner: (petits: T[]) => T,
  seuil: number = SEUIL_ANONYMAT
): T[] {
  const petits = groupes.filter((g) => taille(g) < seuil);
  if (petits.length === 0) return groupes;
  const grands = groupes.filter((g) => taille(g) >= seuil);
  const total = () => petits.reduce((s, g) => s + taille(g), 0);
  while (total() < seuil && grands.length > 0) {
    const plusPetit = grands.reduce((min, g) => (taille(g) < taille(min) ? g : min));
    grands.splice(grands.indexOf(plusPetit), 1);
    petits.push(plusPetit);
  }
  return [...grands, fusionner(petits)];
}
