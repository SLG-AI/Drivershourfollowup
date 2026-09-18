import { describe, it, expect } from "vitest";
import {
  calculerPaliers,
  etpDe,
  etpDisponibleDe,
  etpSuspenduDe,
  heuresCnsDeLaLigne,
  type SalariePaliers,
} from "../wp-paliers";
import { getWorkableHoursInMonth } from "../wp-calculations";

function salarie(p: Partial<SalariePaliers> & { code_salarie: string }): SalariePaliers {
  return { est_sortie_temporaire: false, ...p };
}

describe("etpDe", () => {
  it("compte un temps plein quand le taux d'occupation est absent", () => {
    expect(etpDe(salarie({ code_salarie: "A" }))).toBe(1);
  });

  it("rapporte le taux d'occupation à 100", () => {
    expect(etpDe(salarie({ code_salarie: "A", taux_occupation: 50 }))).toBe(0.5);
    expect(etpDe(salarie({ code_salarie: "A", taux_occupation: 80 }))).toBe(0.8);
  });
});

describe("etpSuspenduDe / etpDisponibleDe", () => {
  const finMois = "2026-06-30";

  it("retire l'ETP entier d'une suspension sans motif partiel", () => {
    const e = salarie({
      code_salarie: "A",
      est_sortie_temporaire: true,
      description_motif_sortie: "Conge Parental TP",
      date_debut_sortie_temporaire: "2026-05-01",
    });
    expect(etpSuspenduDe(e)).toBe(1);
    expect(etpDisponibleDe(e, finMois)).toBe(0);
  });

  it("ne retire RIEN d'un congé parental à temps partiel encodé par le taux", () => {
    // Drapeau posé, ni motif ni dates, taux abaissé : la réduction est déjà
    // portée par taux_occupation, la retirer une 2e fois doublerait la perte.
    const e = salarie({ code_salarie: "A", est_sortie_temporaire: true, taux_occupation: 50 });
    expect(etpDe(e)).toBe(0.5);
    expect(etpSuspenduDe(e)).toBe(0);
    expect(etpDisponibleDe(e, finMois)).toBe(0.5);
  });

  it("laisse l'ETP entier disponible tant que la suspension n'a pas commencé", () => {
    const e = salarie({
      code_salarie: "A",
      est_sortie_temporaire: true,
      date_sortie: finMois, // sortie le dernier jour = prend effet le mois suivant
      description_motif_sortie: "Conge Parental TP",
    });
    expect(etpDisponibleDe(e, finMois)).toBe(1);
  });
});

describe("heuresCnsDeLaLigne", () => {
  it("additionne tous les motifs CNS", () => {
    expect(
      heuresCnsDeLaLigne({
        code_salarie: "A",
        hrs_maladie: 10,
        hrs_accident: 2,
        hrs_maternite: 1,
        hrs_raisons_familiales: 0.5,
        hrs_conge_accompagnement: 0.25,
        hrs_accueil: 0.25,
      })
    ).toBe(14);
  });
});

describe("calculerPaliers", () => {
  const MOIS = 6;
  const ANNEE = 2026;
  const heuresTravaillables = getWorkableHoursInMonth(ANNEE, MOIS);

  const roster: SalariePaliers[] = [
    salarie({ code_salarie: "A" }),
    salarie({ code_salarie: "B" }),
    salarie({ code_salarie: "C", taux_occupation: 50 }),
    // Suspension pleine en cours : sort de l'effectif disponible
    salarie({
      code_salarie: "D",
      est_sortie_temporaire: true,
      description_motif_sortie: "Conge Parental TP",
      date_debut_sortie_temporaire: "2026-01-01",
    }),
  ];

  it("enchaîne les paliers en retirant chaque perte du précédent", () => {
    const p = calculerPaliers(roster, [], [], [], MOIS, ANNEE);
    expect(p.headcount).toBe(4);
    expect(p.sousContrat).toBe(3.5); // 1 + 1 + 0.5 + 1
    expect(p.etpSuspendu).toBe(1);
    expect(p.nbSuspendus).toBe(1);
    expect(p.apresSuspension).toBe(2.5);
    expect(p.apresInjustifiees).toBe(2.5); // aucune absence
    expect(p.tauxGlobal).toBe(0);
  });

  it("pondère le taux CNS par l'ETP disponible de chaque salarié", () => {
    // A absent à 50 % (1 ETP) et C absent à 100 % (0,5 ETP) → 0,5 + 0,5 = 1 ETP perdu
    const p = calculerPaliers(
      roster,
      [
        { code_salarie: "A", mois: MOIS, pct_absenteisme: 50 },
        { code_salarie: "C", mois: MOIS, pct_absenteisme: 100 },
      ],
      [],
      [],
      MOIS,
      ANNEE
    );
    expect(p.etpPerduCns).toBeCloseTo(1, 10);
    expect(p.tauxCns).toBeCloseTo(40, 10); // 1 / 2,5
    expect(p.apresCns).toBeCloseTo(1.5, 10);
    expect(p.cnsMesure).toBe(true);
  });

  it("ignore un salarié suspendu dans le taux CNS : son ETP disponible est nul", () => {
    const p = calculerPaliers(
      roster,
      [{ code_salarie: "D", mois: MOIS, pct_absenteisme: 100 }],
      [],
      [],
      MOIS,
      ANNEE
    );
    expect(p.etpPerduCns).toBe(0);
    expect(p.tauxCns).toBe(0);
  });

  it("ne compte dans les heures CNS que la population du numérateur", () => {
    // Le tableau de bord affiche ces heures à côté du taux : elles doivent
    // porter sur les mêmes lignes, sinon le volume et le pourcentage ne se
    // correspondent pas.
    const p = calculerPaliers(
      roster,
      [
        { code_salarie: "A", mois: MOIS, pct_absenteisme: 50, hrs_maladie: 80 }, // retenue
        { code_salarie: "B", mois: MOIS, pct_absenteisme: 0, hrs_maladie: 16 }, // % nul → écartée
        { code_salarie: "D", mois: MOIS, pct_absenteisme: 100, hrs_maladie: 40 }, // suspendu → écartée
      ],
      [],
      [],
      MOIS,
      ANNEE
    );
    expect(p.heuresCns).toBe(80);
  });

  it("écarte les lignes d'un autre mois", () => {
    const p = calculerPaliers(
      roster,
      [{ code_salarie: "A", mois: MOIS - 1, pct_absenteisme: 100 }],
      [{ code_salarie: "A", mois: MOIS - 1, duree_hrs: 40 }],
      [{ code_salarie: "A", mois: MOIS - 1, duree_hrs: 8 }],
      MOIS,
      ANNEE
    );
    expect(p.etpPerduCns).toBe(0);
    expect(p.heuresMct).toBe(0);
    expect(p.heuresInjustifiees).toBe(0);
    expect(p.cnsMesure).toBe(false);
    expect(p.mctMesure).toBe(false);
    expect(p.injustifieesMesure).toBe(false);
  });

  it("convertit les heures MCT en ETP par les heures travaillables du mois", () => {
    const p = calculerPaliers(
      roster,
      [],
      [{ code_salarie: "A", mois: MOIS, duree_hrs: heuresTravaillables }],
      [],
      MOIS,
      ANNEE
    );
    expect(p.etpPerduMct).toBeCloseTo(1, 10); // un mois complet d'un salarié
    expect(p.tauxMct).toBeCloseTo(40, 10); // 1 / 2,5
    expect(p.apresMct).toBeCloseTo(1.5, 10);
  });

  it("rapporte MCT et injustifiées à l'effectif APRÈS SUSPENSION, pas au palier précédent", () => {
    const p = calculerPaliers(
      roster,
      [{ code_salarie: "A", mois: MOIS, pct_absenteisme: 100 }], // 1 ETP de CNS
      [{ code_salarie: "B", mois: MOIS, duree_hrs: heuresTravaillables }], // 1 ETP de MCT
      [{ code_salarie: "B", mois: MOIS, duree_hrs: heuresTravaillables / 2 }], // 0,5 ETP
      MOIS,
      ANNEE
    );
    // Les trois taux ont le MÊME dénominateur (2,5), sinon ils seraient
    // incomparables d'un mois à l'autre.
    expect(p.tauxCns).toBeCloseTo(40, 10);
    expect(p.tauxMct).toBeCloseTo(40, 10);
    expect(p.tauxInjustifiees).toBeCloseTo(20, 10);
    expect(p.tauxGlobal).toBeCloseTo(100, 10);
    // Les paliers, eux, se retirent en cascade
    expect(p.apresCns).toBeCloseTo(1.5, 10);
    expect(p.apresMct).toBeCloseTo(0.5, 10);
    expect(p.apresInjustifiees).toBeCloseTo(0, 10);
  });

  it("compte les absences injustifiées d'un salarié absent de la photo", () => {
    // Le fichier peut concerner un salarié sorti depuis : ces heures ont
    // bien manqué au mois.
    const p = calculerPaliers(
      roster,
      [],
      [{ code_salarie: "ZZ", mois: MOIS, duree_hrs: 8 }], // MCT : écartée, hors photo
      [{ code_salarie: "ZZ", mois: MOIS, duree_hrs: 8 }], // injustifiée : comptée
      MOIS,
      ANNEE
    );
    expect(p.heuresMct).toBe(0);
    expect(p.heuresInjustifiees).toBe(8);
  });

  it("n'exclut personne et ne divise pas par zéro sur un mois vide", () => {
    const p = calculerPaliers([], [], [], [], MOIS, ANNEE);
    expect(p.sousContrat).toBe(0);
    expect(p.apresSuspension).toBe(0);
    expect(p.tauxCns).toBe(0);
    expect(p.tauxGlobal).toBe(0);
    expect(Number.isNaN(p.apresInjustifiees)).toBe(false);
  });

  it("expose les étapes dans l'ordre d'affichage, chacune avec son ancre", () => {
    const p = calculerPaliers(roster, [], [], [], MOIS, ANNEE);
    expect(p.etapes.map((e) => e.cle)).toEqual([
      "effectif-sous-contrat",
      "effectif-apres-suspension",
      "taux-cns",
      "taux-mct",
      "taux-injustifiees",
    ]);
    expect(p.etapes[1].retire).toBe(1);
  });

  it("date l'effectif au dernier jour du mois", () => {
    expect(calculerPaliers([], [], [], [], 2, 2026).refDate).toBe("2026-02-28");
    expect(calculerPaliers([], [], [], [], 6, 2026).refDate).toBe("2026-06-30");
  });
});
