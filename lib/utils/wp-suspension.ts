/**
 * Fraction d'ETP retirée par une suspension de contrat.
 *
 * Jusqu'ici toute sortie temporaire retirait l'ETP ENTIER du salarié, ce qui
 * est juste pour un congé parental à temps plein (code SIRH « Conge Parental
 * TP »), une maternité ou un congé sans solde. Un congé parental à TEMPS
 * PARTIEL laisse le salarié travailler une fraction de son temps : il ne
 * doit retirer que la fraction suspendue.
 *
 * Le SIRH n'a encore émis aucun code de congé parental à temps partiel. La
 * table ci-dessous anticipe les libellés plausibles ; le jour où le code réel
 * apparaît, il suffit de l'ajouter ici. En attendant, un motif parental qui
 * n'est ni le temps plein ni un temps partiel reconnu est signalé à l'import
 * et traité comme une suspension complète (choix prudent : sous-estimer
 * l'effectif plutôt que le surestimer).
 */

/** Code SIRH du congé parental à temps plein. */
export const MOTIF_PARENTAL_TEMPS_PLEIN = "Conge Parental TP";

export interface SuspensionPartielle {
  /** Libellé affiché dans les tableaux. */
  label: string;
  /** Fraction du temps de travail SUSPENDUE (0.5 = mi-temps). */
  fraction: number;
  /** Reconnaît le motif SIRH (comparé en minuscules, sans accents). */
  match: (motifNormalise: string) => boolean;
}

function normaliser(motif: string): string {
  return motif
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * Suspensions partielles reconnues, de la plus spécifique à la plus générale.
 * Les libellés SIRH étant inconnus, on accepte plusieurs graphies.
 */
export const SUSPENSIONS_PARTIELLES: SuspensionPartielle[] = [
  {
    label: "Congé parental temps partiel",
    fraction: 0.5,
    match: (m) =>
      m.includes("parental") &&
      (m.includes("partiel") ||
        m.includes("mi-temps") ||
        m.includes("mi temps") ||
        m.includes("50") ||
        /\btpart\b/.test(m) ||
        /\bmt\b/.test(m)),
  },
];

/** Suspension partielle correspondant à un motif, ou null si c'est une suspension complète. */
export function suspensionPartielle(motif: string | null | undefined): SuspensionPartielle | null {
  if (!motif) return null;
  const m = normaliser(motif);
  return SUSPENSIONS_PARTIELLES.find((s) => s.match(m)) ?? null;
}

/** Fraction d'ETP retirée par la suspension : 1 (complète) par défaut. */
export function fractionSuspendue(motif: string | null | undefined): number {
  return suspensionPartielle(motif)?.fraction ?? 1;
}

/** Libellé affiché pour un congé parental à temps partiel, quelle que soit sa forme dans l'export. */
export const LABEL_PARENTAL_TEMPS_PARTIEL = "Congé parental temps partiel";

export interface SuspensionEmploye {
  est_sortie_temporaire?: boolean | null;
  description_motif_sortie?: string | null;
  date_debut_sortie_temporaire?: string | null;
  date_fin_sortie_temporaire?: string | null;
}

/**
 * Congé parental à temps partiel tel que le SIRH l'encode RÉELLEMENT (vérifié
 * sur les exports 2026) : drapeau « sortie temporaire » posé, SANS motif ni
 * dates, et taux d'occupation ABAISSÉ à la part travaillée (100 → 50 pour un
 * mi-temps, 80 pour un congé à 20 %). La réduction est donc déjà portée par
 * le taux : il ne faut rien retirer de plus à l'effectif net.
 *
 * Le même encodage sert aux maladies de longue durée ; le tableau de bord
 * les écarte en amont (heures CNS ⇒ absent maladie, drapeau retiré).
 */
export function estCongeParentalTempsPartielParTaux(e: SuspensionEmploye): boolean {
  return (
    !!e.est_sortie_temporaire &&
    !(e.description_motif_sortie || "").trim() &&
    !e.date_debut_sortie_temporaire &&
    !e.date_fin_sortie_temporaire
  );
}

/**
 * Fraction d'ETP retirée par la suspension d'un salarié :
 *  - 0 pour un congé parental à temps partiel encodé par le taux (déjà déduit) ;
 *  - la fraction du motif sinon (0.5 pour un motif « temps partiel » explicite, 1 par défaut).
 */
export function fractionSuspendueEmploye(e: SuspensionEmploye): number {
  if (estCongeParentalTempsPartielParTaux(e)) return 0;
  return fractionSuspendue(e.description_motif_sortie);
}

/**
 * Motif de congé parental que l'application ne sait pas classer : ni le code
 * temps plein, ni un temps partiel reconnu. À signaler à l'import.
 */
export function estMotifParentalInconnu(motif: string | null | undefined): boolean {
  if (!motif) return false;
  const m = normaliser(motif);
  if (!m.includes("parental")) return false;
  if (normaliser(MOTIF_PARENTAL_TEMPS_PLEIN) === m) return false;
  return suspensionPartielle(motif) === null;
}

// ============================================================
// Reclassification des sorties temporaires (partagée tableau de bord,
// mouvements et moteur de projection)
// ============================================================

/** Motifs de sortie temporaire structurelle (par opposition à la maladie). */
export function isCongeStructurel(motif: string): boolean {
  const m = motif.toLowerCase();
  return (
    m.includes("parental") ||
    m.includes("maternité") ||
    m.includes("maternite") ||
    m.includes("sans solde") ||
    m.includes("accompagnement") ||
    m.includes("dispense")
  );
}

/**
 * Reclassification des sorties temporaires, APPLIQUÉE SUR PLACE.
 *
 * - Flaggé « sortie temporaire » avec un motif non structurel ET des heures
 *   maladie CNS → en réalité un absent maladie (flag retiré).
 * - Motif structurel avec une date de sortie mais pas encore flaggé (départ
 *   futur) → sortie temporaire.
 *
 * Extraite du tableau de bord pour être appliquée à l'identique à la
 * photographie du mois précédent.
 */
export function reclassifierSortiesTemporaires<
  T extends { code_salarie: string; est_sortie_temporaire?: boolean | null; date_sortie?: string | null; description_motif_sortie?: string | null; _reclassified_maladie?: boolean }
>(employees: T[], codesAvecMaladieCns: Set<string>): T[] {
  employees.forEach((e) => {
    if (
      e.est_sortie_temporaire &&
      !isCongeStructurel(e.description_motif_sortie || "") &&
      codesAvecMaladieCns.has(e.code_salarie)
    ) {
      e.est_sortie_temporaire = false;
      e._reclassified_maladie = true;
    }
  });
  employees.forEach((e) => {
    if (
      !e.est_sortie_temporaire &&
      e.date_sortie &&
      isCongeStructurel(e.description_motif_sortie || "")
    ) {
      e.est_sortie_temporaire = true;
    }
  });
  return employees;
}

// ============================================================
// Turnover : sorties qui n'en relèvent pas
// ============================================================

/**
 * Fin de mission = terme prévu d'un CDD. Exclue du turnover (arbitrage
 * 2026-09-15) : on mesure les départs subis ou choisis, pas les contrats
 * arrivés à leur terme. Libellé de l'export IN/OUT : « Fin de mission ».
 */
export function estFinDeMission(motif: string | null | undefined): boolean {
  return /fin\s+de\s+mission/i.test(motif || "");
}

/** Sortie d'une photo de roster à écarter du turnover : temporaire, CDD ou fin de mission. */
export function estSortieHorsTurnover(e: {
  est_sortie_temporaire?: boolean | null;
  type_contrat?: string | null;
  description_motif_sortie?: string | null;
}): boolean {
  return Boolean(e.est_sortie_temporaire) || (e.type_contrat || "").toUpperCase() === "CDD" || estFinDeMission(e.description_motif_sortie);
}
