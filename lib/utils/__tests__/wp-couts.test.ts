import { describe, it, expect } from "vitest";
import {
  COEF_CHARGES_DEFAUT,
  appliquerTauxReporte,
  brutPleinTempsDe,
  calculerCoefficientCharges,
  calculerCoutsPaliers,
  construireSourceSalaires,
  ligneAvecMontants,
  photoAvecMontants,
  realiseDuMois,
  type LigneStatSalariale,
  type SalarieCout,
  type SourceSalaires,
} from "../wp-couts";
import { calculerPaliers } from "../wp-paliers";
import { getWorkableHoursInMonth } from "../wp-calculations";

function salarie(p: Partial<SalarieCout> & { code_salarie: string }): SalarieCout {
  return { est_sortie_temporaire: false, ...p };
}

function ligne(p: Partial<LigneStatSalariale> & { code_salarie: string; mois: number; annee: number }): LigneStatSalariale {
  return { ...p };
}

/** Source qui sert les bruts d'une photo directement, sans report. */
function sourceDe(photo: SalarieCout[]): SourceSalaires {
  return construireSourceSalaires(photo, null);
}

describe("brutPleinTempsDe", () => {
  it("lit un nombre ou une chaîne numérique", () => {
    expect(brutPleinTempsDe(salarie({ code_salarie: "A", brut_indice: 3200 }))).toBe(3200);
    expect(brutPleinTempsDe(salarie({ code_salarie: "A", brut_indice: "3200.50" }))).toBe(3200.5);
  });

  it("rend null pour un brut absent, nul ou illisible", () => {
    expect(brutPleinTempsDe(salarie({ code_salarie: "A" }))).toBeNull();
    expect(brutPleinTempsDe(salarie({ code_salarie: "A", brut_indice: null }))).toBeNull();
    expect(brutPleinTempsDe(salarie({ code_salarie: "A", brut_indice: 0 }))).toBeNull();
    expect(brutPleinTempsDe(salarie({ code_salarie: "A", brut_indice: "abc" }))).toBeNull();
  });
});

describe("ligneAvecMontants / photoAvecMontants", () => {
  it("détecte un montant sur n'importe quelle colonne en euros", () => {
    expect(ligneAvecMontants(ligne({ code_salarie: "A", mois: 1, annee: 2026 }))).toBe(false);
    expect(ligneAvecMontants(ligne({ code_salarie: "A", mois: 1, annee: 2026, total_brut: 0, charges_patronales: 0 }))).toBe(false);
    expect(ligneAvecMontants(ligne({ code_salarie: "A", mois: 1, annee: 2026, supplements: 12 }))).toBe(true);
  });

  it("une photo porte des montants dès qu'un salarié a un brut", () => {
    expect(photoAvecMontants([salarie({ code_salarie: "A" }), salarie({ code_salarie: "B", brut_indice: 0 })])).toBe(false);
    expect(photoAvecMontants([salarie({ code_salarie: "A" }), salarie({ code_salarie: "B", brut_indice: 10 })])).toBe(true);
  });
});

describe("realiseDuMois", () => {
  const stats: LigneStatSalariale[] = [
    ligne({ code_salarie: "A", mois: 6, annee: 2026, total_brut: 3000, brut_base: 2800, supplements: 200, charges_patronales: 400 }),
    ligne({ code_salarie: "B", mois: 6, annee: 2026, total_brut: "1000", brut_base: 1000, supplements: 0, charges_patronales: 130 }),
    ligne({ code_salarie: "A", mois: 5, annee: 2026, total_brut: 9999, charges_patronales: 0 }),
    ligne({ code_salarie: "A", mois: 6, annee: 2025, total_brut: 9999, charges_patronales: 0 }),
  ];

  it("additionne les colonnes du mois et de l'année demandés seulement", () => {
    const r = realiseDuMois(stats, 6, 2026);
    expect(r).toMatchObject({ brut: 4000, brutBase: 3800, supplements: 200, employeur: 4530, chargesPatronales: 530, n: 2, mesure: true, employeurMesure: true });
  });

  it("se restreint au périmètre de codes", () => {
    const r = realiseDuMois(stats, 6, 2026, new Set(["B"]));
    expect(r.brut).toBe(1000);
    expect(r.n).toBe(1);
  });

  it("ne mesure rien quand toutes les lignes sont à 0", () => {
    const r = realiseDuMois(
      [ligne({ code_salarie: "A", mois: 6, annee: 2026, total_brut: 0, charges_patronales: 0 })],
      6,
      2026
    );
    expect(r.n).toBe(1);
    expect(r.mesure).toBe(false);
    expect(r.brut).toBe(0);
  });
});

describe("calculerCoefficientCharges", () => {
  const stats: LigneStatSalariale[] = [
    // Mai : coef 1,20 sur A, 1,10 sur B
    ligne({ code_salarie: "A", mois: 5, annee: 2026, total_brut: 1000, charges_patronales: 200 }),
    ligne({ code_salarie: "B", mois: 5, annee: 2026, total_brut: 1000, charges_patronales: 100 }),
    // Juin : A seulement, coef 1,30
    ligne({ code_salarie: "A", mois: 6, annee: 2026, total_brut: 1000, charges_patronales: 300 }),
    // Juillet : fichier sans salaire (lignes à 0) → ignoré
    ligne({ code_salarie: "A", mois: 7, annee: 2026, total_brut: 0, charges_patronales: 0 }),
    ligne({ code_salarie: "B", mois: 7, annee: 2026, total_brut: 0, charges_patronales: 0 }),
  ];

  it("prend le DERNIER mois qui a des montants, pas le dernier fichier", () => {
    const r = calculerCoefficientCharges(stats);
    expect(r.coef).toBeCloseTo(1.3, 10);
    expect(r.source).toEqual({ mois: 6, annee: 2026, n: 1, brut: 1000, employeur: 1300, perimetre: "entreprise" });
  });

  it("préfère le périmètre demandé quand il y a des lignes avec montants", () => {
    // B n'a de montants qu'en mai : le dernier mois DU PÉRIMÈTRE est mai.
    const r = calculerCoefficientCharges(stats, new Set(["B"]));
    expect(r.coef).toBeCloseTo(1.1, 10);
    expect(r.source?.perimetre).toBe("filtre");
    expect(r.source?.mois).toBe(5);
  });

  it("retombe sur l'entreprise quand le périmètre n'a aucune ligne avec montants", () => {
    const r = calculerCoefficientCharges(stats, new Set(["ZZ"]));
    expect(r.coef).toBeCloseTo(1.3, 10);
    expect(r.source?.perimetre).toBe("entreprise");
  });

  it("ordonne les mois par année puis par mois", () => {
    const r = calculerCoefficientCharges([
      ligne({ code_salarie: "A", mois: 12, annee: 2025, total_brut: 1000, charges_patronales: 500 }),
      ligne({ code_salarie: "A", mois: 1, annee: 2026, total_brut: 1000, charges_patronales: 100 }),
    ]);
    expect(r.coef).toBeCloseTo(1.1, 10);
    expect(r.source?.annee).toBe(2026);
  });

  it("rend le défaut avec une source nulle quand rien n'est mesurable", () => {
    expect(calculerCoefficientCharges([])).toEqual({ coef: COEF_CHARGES_DEFAUT, source: null });
    expect(calculerCoefficientCharges([], undefined, 1.2)).toEqual({ coef: 1.2, source: null });
    const sansSalaire = [ligne({ code_salarie: "A", mois: 7, annee: 2026, total_brut: 0, charges_patronales: 0 })];
    expect(calculerCoefficientCharges(sansSalaire).source).toBeNull();
  });

  it("ne divise pas par zéro quand le brut est nul mais les charges non", () => {
    const r = calculerCoefficientCharges([
      ligne({ code_salarie: "A", mois: 6, annee: 2026, total_brut: 0, charges_patronales: 500 }),
    ]);
    expect(r.coef).toBe(COEF_CHARGES_DEFAUT);
    expect(r.source).toBeNull();
  });
});

describe("construireSourceSalaires", () => {
  it("sert les bruts de la photo du mois quand elle en porte", () => {
    const s = construireSourceSalaires(
      [salarie({ code_salarie: "A", brut_indice: 3000 }), salarie({ code_salarie: "B", brut_indice: "2500" })],
      [salarie({ code_salarie: "A", brut_indice: 9999 })]
    );
    expect(s.brutDe("A")).toBe(3000);
    expect(s.brutDe("B")).toBe(2500);
    expect(s.reporte).toBe(false);
    expect(s.manquants).toEqual([]);
  });

  it("lit la photo de référence quand celle du mois n'a aucun montant, et le signale", () => {
    const s = construireSourceSalaires(
      [salarie({ code_salarie: "A" }), salarie({ code_salarie: "B", brut_indice: 0 })],
      [salarie({ code_salarie: "A", brut_indice: 3000 }), salarie({ code_salarie: "B", brut_indice: 2500 })]
    );
    expect(s.brutDe("A")).toBe(3000);
    expect(s.brutDe("B")).toBe(2500);
    expect(s.reporte).toBe(true);
    expect(s.manquants).toEqual([]);
  });

  it("dénombre les codes sans brut nulle part", () => {
    const s = construireSourceSalaires(
      [salarie({ code_salarie: "A" }), salarie({ code_salarie: "B" })],
      [salarie({ code_salarie: "A", brut_indice: 3000 })]
    );
    expect(s.brutDe("B")).toBeNull();
    expect(s.manquants).toEqual(["B"]);
    expect(s.reporte).toBe(true);
  });

  it("sans photo de référence, tout code sans brut est manquant et rien n'est reporté", () => {
    const s = construireSourceSalaires([salarie({ code_salarie: "A" })], null);
    expect(s.brutDe("A")).toBeNull();
    expect(s.manquants).toEqual(["A"]);
    expect(s.reporte).toBe(false);
  });

  it("ne sert pas un code absent de la photo du mois, même présent dans la référence", () => {
    const s = construireSourceSalaires(
      [salarie({ code_salarie: "A", brut_indice: 3000 })],
      [salarie({ code_salarie: "PARTI", brut_indice: 3000 })]
    );
    expect(s.brutDe("PARTI")).toBeNull();
    expect(s.manquants).toEqual([]);
  });

  it("complète par la référence un salarié sans brut dans une photo qui en porte", () => {
    // Entré après l'export des salaires : présent dans la photo, brut vide.
    const s = construireSourceSalaires(
      [salarie({ code_salarie: "A", brut_indice: 3000 }), salarie({ code_salarie: "NOUVEAU" })],
      [salarie({ code_salarie: "NOUVEAU", brut_indice: 2000 })]
    );
    expect(s.brutDe("NOUVEAU")).toBe(2000);
    expect(s.reporte).toBe(true);
  });
});

describe("calculerCoutsPaliers", () => {
  const MOIS = 6;
  const ANNEE = 2026;
  const heuresTravaillables = getWorkableHoursInMonth(ANNEE, MOIS);
  const COEF = 1.1;

  // Le roster de wp-paliers.test.ts, avec des bruts.
  const roster = (brut: (code: string) => number | undefined): SalarieCout[] => [
    salarie({ code_salarie: "A", brut_indice: brut("A") }),
    salarie({ code_salarie: "B", brut_indice: brut("B") }),
    salarie({ code_salarie: "C", taux_occupation: 50, brut_indice: brut("C") }),
    salarie({
      code_salarie: "D",
      est_sortie_temporaire: true,
      description_motif_sortie: "Conge Parental TP",
      date_debut_sortie_temporaire: "2026-01-01",
      brut_indice: brut("D"),
    }),
  ];

  it("est l'homothétie de la chaîne ETP quand tous les salariés ont le même brut", () => {
    // Valeurs choisies pour que chaque palier tombe sur un euro rond : l'arrondi
    // de sortie ne masque alors aucun écart.
    const BRUT = 3000;
    const employes = roster(() => BRUT);
    const cns = [
      { code_salarie: "A", mois: MOIS, pct_absenteisme: 50 },
      { code_salarie: "C", mois: MOIS, pct_absenteisme: 100 },
      { code_salarie: "D", mois: MOIS, pct_absenteisme: 100 }, // suspendu : 0
    ];
    const mct = [{ code_salarie: "B", mois: MOIS, duree_hrs: heuresTravaillables / 2 }];
    const inj = [
      { code_salarie: "A", mois: MOIS, duree_hrs: heuresTravaillables / 4 },
      { code_salarie: "ZZ", mois: MOIS, duree_hrs: heuresTravaillables / 4 }, // hors photo : coût moyen = même brut
    ];
    const etp = calculerPaliers(employes, cns, mct, inj, MOIS, ANNEE);
    const eur = calculerCoutsPaliers(employes, cns, mct, inj, MOIS, ANNEE, { coef: COEF, source: sourceDe(employes) });

    const k = BRUT * COEF;
    expect(eur.sousContrat).toBeCloseTo(etp.sousContrat * k, 6);
    expect(eur.coutSuspendu).toBeCloseTo(etp.etpSuspendu * k, 6);
    expect(eur.apresSuspension).toBeCloseTo(etp.apresSuspension * k, 6);
    expect(eur.coutPerduCns).toBeCloseTo(etp.etpPerduCns * k, 6);
    expect(eur.apresCns).toBeCloseTo(etp.apresCns * k, 6);
    expect(eur.coutPerduInjustifiees).toBeCloseTo(etp.etpPerduInjustifiees * k, 6);
    expect(eur.apresInjustifiees).toBeCloseTo(etp.apresInjustifiees * k, 6);
    expect(eur.coutPerduMct).toBeCloseTo(etp.etpPerduMct * k, 6);
    expect(eur.apresMct).toBeCloseTo(etp.apresMct * k, 6);
    expect(eur.coutMoyenEtp).toBeCloseTo(k, 6);
    etp.etapes.forEach((e, i) => {
      expect(eur.etapes[i].cle).toBe(e.cle);
      expect(eur.etapes[i].mesure).toBe(e.mesure);
      expect(eur.etapes[i].cout).toBeCloseTo(e.etp * k, 6);
      expect(eur.etapes[i].retire).toBeCloseTo(e.retire * k, 6);
    });
    expect(eur.reporte).toEqual({ cout: false, codesManquants: 0 });
  });

  it("reste homothétique à l'euro près avec des montants quelconques", () => {
    const BRUT = 3217.43;
    const employes = roster(() => BRUT);
    const cns = [{ code_salarie: "A", mois: MOIS, pct_absenteisme: 37 }];
    const mct = [{ code_salarie: "C", mois: MOIS, duree_hrs: 13 }];
    const inj = [{ code_salarie: "B", mois: MOIS, duree_hrs: 3 }];
    const etp = calculerPaliers(employes, cns, mct, inj, MOIS, ANNEE);
    const eur = calculerCoutsPaliers(employes, cns, mct, inj, MOIS, ANNEE, { coef: 1.137, source: sourceDe(employes) });
    const k = BRUT * 1.137;
    expect(Math.abs(eur.apresMct - etp.apresMct * k)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(eur.coutPerduCns - etp.etpPerduCns * k)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(eur.coutPerduMct - etp.etpPerduMct * k)).toBeLessThanOrEqual(0.5);
    expect(Number.isInteger(eur.apresMct)).toBe(true);
  });

  it("proratise le coût par l'ETP : le brut est un plein temps", () => {
    const employes = [salarie({ code_salarie: "C", taux_occupation: 50, brut_indice: 3000 })];
    const eur = calculerCoutsPaliers(employes, [], [], [], MOIS, ANNEE, { coef: 1, source: sourceDe(employes) });
    expect(eur.sousContrat).toBe(1500);
    expect(eur.coutMoyenEtp).toBe(3000); // 1500 / 0,5 ETP
  });

  it("retire davantage pour la suspension d'un haut salaire que d'un bas", () => {
    const suspendu = (code: string, brut: number) =>
      salarie({
        code_salarie: code,
        brut_indice: brut,
        est_sortie_temporaire: true,
        description_motif_sortie: "Conge Parental TP",
        date_debut_sortie_temporaire: "2026-01-01",
      });
    const haut = [salarie({ code_salarie: "A", brut_indice: 3000 }), suspendu("D", 6000)];
    const bas = [salarie({ code_salarie: "A", brut_indice: 3000 }), suspendu("D", 2000)];
    const rHaut = calculerCoutsPaliers(haut, [], [], [], MOIS, ANNEE, { coef: 1, source: sourceDe(haut) });
    const rBas = calculerCoutsPaliers(bas, [], [], [], MOIS, ANNEE, { coef: 1, source: sourceDe(bas) });
    expect(rHaut.coutSuspendu).toBe(6000);
    expect(rBas.coutSuspendu).toBe(2000);
    // Même ETP retiré (1) dans les deux cas, mais des euros très différents.
    expect(rHaut.apresSuspension).toBe(3000);
    expect(rBas.apresSuspension).toBe(3000);
  });

  it("ne retire que la fraction suspendue d'un congé parental à temps partiel encodé par le taux", () => {
    const employes = [salarie({ code_salarie: "A", brut_indice: 3000, est_sortie_temporaire: true, taux_occupation: 50 })];
    const eur = calculerCoutsPaliers(employes, [], [], [], MOIS, ANNEE, { coef: 1, source: sourceDe(employes) });
    expect(eur.sousContrat).toBe(1500);
    expect(eur.coutSuspendu).toBe(0); // déjà porté par le taux
  });

  it("pèse la CNS par le coût DISPONIBLE de chaque salarié", () => {
    const employes = [
      salarie({ code_salarie: "A", brut_indice: 4000 }),
      salarie({ code_salarie: "C", taux_occupation: 50, brut_indice: 2000 }),
      salarie({
        code_salarie: "D",
        brut_indice: 5000,
        est_sortie_temporaire: true,
        description_motif_sortie: "Conge Parental TP",
        date_debut_sortie_temporaire: "2026-01-01",
      }),
    ];
    const cns = [
      { code_salarie: "A", mois: MOIS, pct_absenteisme: 50 }, // 0,5 × 4000
      { code_salarie: "C", mois: MOIS, pct_absenteisme: 100 }, // 1 × 1000 (0,5 ETP × 2000)
      { code_salarie: "D", mois: MOIS, pct_absenteisme: 100 }, // suspendu : coût disponible nul
      { code_salarie: "ZZ", mois: MOIS, pct_absenteisme: 100 }, // hors actifs : 0
    ];
    const eur = calculerCoutsPaliers(employes, cns, [], [], MOIS, ANNEE, { coef: 1, source: sourceDe(employes) });
    expect(eur.coutPerduCns).toBe(3000);
    expect(eur.apresCns).toBe(eur.apresSuspension - 3000);
    expect(eur.etapes[2].mesure).toBe(true);
  });

  it("valorise les heures d'un salarié au brut chargé de CE salarié", () => {
    const employes = [salarie({ code_salarie: "A", brut_indice: 1000 }), salarie({ code_salarie: "B", brut_indice: 5000 })];
    const mct = [{ code_salarie: "B", mois: MOIS, duree_hrs: heuresTravaillables / 2 }];
    const inj = [{ code_salarie: "A", mois: MOIS, duree_hrs: heuresTravaillables / 2 }];
    const eur = calculerCoutsPaliers(employes, [], mct, inj, MOIS, ANNEE, { coef: 1, source: sourceDe(employes) });
    expect(eur.coutPerduMct).toBe(2500);
    expect(eur.coutPerduInjustifiees).toBe(500);
    expect(eur.apresInjustifiees).toBe(6000 - 500); // payé : le MCT l'est encore
    expect(eur.apresMct).toBe(6000 - 500 - 2500); // disponible
  });

  it("valorise les injustifiées d'un salarié hors photo au coût de repli, sinon au coût moyen", () => {
    const employes = [salarie({ code_salarie: "A", brut_indice: 1000 }), salarie({ code_salarie: "B", brut_indice: 3000 })];
    const inj = [{ code_salarie: "ZZ", mois: MOIS, duree_hrs: heuresTravaillables }];
    const sansRepli = calculerCoutsPaliers(employes, [], [], inj, MOIS, ANNEE, { coef: 1, source: sourceDe(employes) });
    expect(sansRepli.coutMoyenEtp).toBe(2000);
    expect(sansRepli.coutPerduInjustifiees).toBe(2000);
    const avecRepli = calculerCoutsPaliers(employes, [], [], inj, MOIS, ANNEE, {
      coef: 1,
      source: sourceDe(employes),
      coutEtpRepli: 2500,
    });
    expect(avecRepli.coutPerduInjustifiees).toBe(2500);
  });

  it("écarte le MCT d'un salarié hors photo, comme la chaîne ETP", () => {
    const employes = [salarie({ code_salarie: "A", brut_indice: 1000 })];
    const mct = [{ code_salarie: "ZZ", mois: MOIS, duree_hrs: heuresTravaillables }];
    const eur = calculerCoutsPaliers(employes, [], mct, [], MOIS, ANNEE, { coef: 1, source: sourceDe(employes) });
    expect(eur.coutPerduMct).toBe(0);
    expect(eur.etapes[4].mesure).toBe(false);
  });

  it("applique le coefficient de charges une seule fois", () => {
    const employes = [salarie({ code_salarie: "A", brut_indice: 1000 })];
    const cns = [{ code_salarie: "A", mois: MOIS, pct_absenteisme: 100 }];
    const inj = [{ code_salarie: "A", mois: MOIS, duree_hrs: heuresTravaillables }];
    const eur = calculerCoutsPaliers(employes, cns, [], inj, MOIS, ANNEE, { coef: 1.5, source: sourceDe(employes) });
    expect(eur.sousContrat).toBe(1500);
    expect(eur.coutPerduCns).toBe(1500);
    expect(eur.coutPerduInjustifiees).toBe(1500);
    expect(eur.coutMoyenEtp).toBe(1500);
    expect(eur.coef).toBe(1.5);
  });

  it("compte un actif sans brut au coût de repli, sans le recharger, et le dénombre", () => {
    const employes = [salarie({ code_salarie: "A", brut_indice: 2000 }), salarie({ code_salarie: "B", taux_occupation: 50 })];
    const source = sourceDe(employes);
    const sansRepli = calculerCoutsPaliers(employes, [], [], [], MOIS, ANNEE, { coef: 1.1, source });
    expect(sansRepli.sousContrat).toBe(2200);
    expect(sansRepli.reporte.codesManquants).toBe(1);

    // coutEtpRepli est déjà chargé : 3000 × 0,5 ETP, PAS × 1,1.
    const avecRepli = calculerCoutsPaliers(employes, [], [], [], MOIS, ANNEE, { coef: 1.1, source, coutEtpRepli: 3000 });
    expect(avecRepli.sousContrat).toBe(2200 + 1500);
    expect(avecRepli.reporte.codesManquants).toBe(1);

    // Ses heures d'absence aussi sont valorisées au repli, sans coefficient.
    const mct = [{ code_salarie: "B", mois: MOIS, duree_hrs: heuresTravaillables }];
    const heures = calculerCoutsPaliers(employes, [], mct, [], MOIS, ANNEE, { coef: 1.1, source, coutEtpRepli: 3000 });
    expect(heures.coutPerduMct).toBe(3000);
  });

  it("propage le report de la source", () => {
    const employes = [salarie({ code_salarie: "A" })];
    const source = construireSourceSalaires(employes, [salarie({ code_salarie: "A", brut_indice: 2000 })]);
    const eur = calculerCoutsPaliers(employes, [], [], [], MOIS, ANNEE, { coef: 1, source });
    expect(eur.sousContrat).toBe(2000);
    expect(eur.reporte).toEqual({ cout: true, codesManquants: 0 });
  });

  it("ignore les lignes d'un autre mois et le dit par `mesure`", () => {
    const employes = [salarie({ code_salarie: "A", brut_indice: 2000 })];
    const eur = calculerCoutsPaliers(
      employes,
      [{ code_salarie: "A", mois: MOIS - 1, pct_absenteisme: 100 }],
      [{ code_salarie: "A", mois: MOIS - 1, duree_hrs: 40 }],
      [{ code_salarie: "A", mois: MOIS - 1, duree_hrs: 8 }],
      MOIS,
      ANNEE,
      { coef: 1, source: sourceDe(employes) }
    );
    expect(eur.apresMct).toBe(2000);
    expect(eur.etapes.map((e) => e.mesure)).toEqual([true, true, false, false, false]);
  });

  it("expose les mêmes étapes que la chaîne ETP, dans le même ordre", () => {
    const employes = roster(() => 3000);
    const eur = calculerCoutsPaliers(employes, [], [], [], MOIS, ANNEE, { coef: 1, source: sourceDe(employes) });
    expect(eur.etapes.map((e) => e.cle)).toEqual([
      "effectif-sous-contrat",
      "effectif-apres-suspension",
      "taux-cns",
      "taux-injustifiees",
      "taux-mct",
    ]);
    expect(eur.etapes[0].retire).toBe(0);
    expect(eur.etapes[1].retire).toBe(3000);
  });

  it("ne divise pas par zéro sur un mois vide", () => {
    const eur = calculerCoutsPaliers([], [], [], [], MOIS, ANNEE, { coef: 1.13, source: sourceDe([]) });
    expect(eur.sousContrat).toBe(0);
    expect(eur.coutMoyenEtp).toBe(0);
    expect(eur.apresMct).toBe(0);
    expect(Number.isNaN(eur.apresInjustifiees)).toBe(false);
  });
});

describe("appliquerTauxReporte", () => {
  it("applique les trois taux au même coût net", () => {
    const r = appliquerTauxReporte(10000, { cns: 10, inj: 5, mct: 20 });
    expect(r.apresCns).toBeCloseTo(9000, 10);
    expect(r.apresInjustifiees).toBeCloseTo(8500, 10);
    expect(r.apresMct).toBeCloseTo(6500, 10);
  });

  it("laisse absents les paliers dont le taux est inconnu", () => {
    expect(appliquerTauxReporte(10000, { cns: null, inj: 5, mct: 20 })).toEqual({});
    const sansMct = appliquerTauxReporte(10000, { cns: 10, inj: 5, mct: null });
    expect(sansMct.apresMct).toBeUndefined();
    expect(sansMct.apresInjustifiees).toBeCloseTo(8500, 10);
    const sansInj = appliquerTauxReporte(10000, { cns: 10, inj: null, mct: 20 });
    expect(sansInj.apresCns).toBeCloseTo(9000, 10);
    expect(sansInj.apresInjustifiees).toBeUndefined();
    expect(sansInj.apresMct).toBeUndefined();
  });
});
