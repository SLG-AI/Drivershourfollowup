import { describe, expect, it } from "vitest";
import { estJourDeWeekEnd, horsWeekEnd, jourSuivant, joursOuvresEntre } from "../wp-calculations";

describe("estJourDeWeekEnd", () => {
  it("reconnaît samedi et dimanche", () => {
    expect(estJourDeWeekEnd("2026-08-01")).toBe(true); // samedi
    expect(estJourDeWeekEnd("2026-08-02")).toBe(true); // dimanche
    expect(estJourDeWeekEnd("2026-08-03")).toBe(false); // lundi
    expect(estJourDeWeekEnd("2026-08-07")).toBe(false); // vendredi
  });

  it("accepte un horodatage complet et ignore une date absente ou invalide", () => {
    expect(estJourDeWeekEnd("2026-08-02T00:00:00+00:00")).toBe(true);
    expect(estJourDeWeekEnd(null)).toBe(false);
    expect(estJourDeWeekEnd(undefined)).toBe(false);
    expect(estJourDeWeekEnd("n/a")).toBe(false);
  });
});

describe("horsWeekEnd", () => {
  it("écarte les lignes du week-end et garde les autres, sans date comprise", () => {
    const rows = [
      { code_salarie: "1", date_absence: "2026-08-03", duree_hrs: 8 },
      { code_salarie: "1", date_absence: "2026-08-08", duree_hrs: 8 },
      { code_salarie: "2", date_absence: null, duree_hrs: 4 },
    ];
    expect(horsWeekEnd(rows).map((r) => r.date_absence)).toEqual(["2026-08-03", null]);
  });
});

import { effectifReelDuMois, projectHeadcount, type Employee, type ScenarioParams } from "../wp-calculations";

function salarie(code: string, extra: Partial<Employee> = {}): Employee {
  return {
    code_salarie: code,
    date_entree: "1999-01-01",
    date_sortie: null,
    vehicle_type: "BUS",
    taux_occupation: 100,
    est_sortie_temporaire: false,
    description_motif_sortie: "",
    description_departement: "",
    description_equipe: "",
    ...extra,
  };
}

const scenarioVide: ScenarioParams = {
  turnover_rate: 0,
  monthly_params: [],
  known_departures: [],
  arrival_hypotheses: [],
  temp_exit_hypotheses: [],
  departure_hypotheses: [],
};

describe("effectifReelDuMois", () => {
  it("compte les présents en fin de mois et date les sorties, dernier jour du mois ⇒ mois suivant", () => {
    const photo = [
      salarie("A"),
      salarie("B", { date_entree: "2026-03-15" }), // pas encore là en février
      salarie("C", { date_sortie: "2026-02-28" }), // sort le dernier jour ⇒ effet en mars
      salarie("D", { date_sortie: "2026-02-10" }), // déjà parti fin février
      salarie("E", { est_sortie_temporaire: true, date_sortie: "2026-01-20" }),
    ];
    const fev = effectifReelDuMois(photo, 2026, 2);
    expect(fev).toMatchObject({ mois: 2, brut: 3, temp_exits: 1, departures: 1 });
    expect(effectifReelDuMois(photo, 2026, 3).departures).toBe(1);
  });

  it("rattache l'absence CNS aux seuls actifs non suspendus, taux = absents / net", () => {
    const photo = [salarie("A"), salarie("B"), salarie("C"), salarie("E", { est_sortie_temporaire: true, date_sortie: "2026-01-20" })];
    const abs = (code: string, pct: number, mois = 2) => ({
      code_salarie: code, mois, annee: 2026, pct_absenteisme: pct, hrs_maladie: 0, hrs_maternite: 0, hrs_accident: 0, heures_theoriques: 0,
    });
    const fev = effectifReelDuMois(photo, 2026, 2, [
      abs("A", 50), abs("B", 100),
      abs("E", 100),        // suspendu : ne compte pas
      abs("Z", 100),        // hors photo : ne compte pas
      abs("C", 100, 3),     // autre mois
    ]);
    expect(fev.brut).toBe(4);
    expect(fev.temp_exits).toBe(1);
    expect(fev.absents).toBeCloseTo(1.5);
    expect(fev.absenteeism_rate).toBeCloseTo(50); // 1,5 / 3
  });

  it("reclasse en malade une sortie temporaire sans motif structurel qui a des heures maladie CNS", () => {
    const photo = [
      salarie("A"),
      // Encodage SIRH réel des maladies longue durée : drapeau sans date ni motif
      salarie("M", { est_sortie_temporaire: true, description_motif_sortie: "" }),
      salarie("P", { est_sortie_temporaire: true, description_motif_sortie: "Congé parental" }),
    ];
    const abs = (code: string) => ({
      code_salarie: code, mois: 2, annee: 2026, pct_absenteisme: 100, hrs_maladie: 80, hrs_maternite: 0, hrs_accident: 0, heures_theoriques: 0,
    });
    const fev = effectifReelDuMois(photo, 2026, 2, [abs("M"), abs("P")]);
    expect(fev.temp_exits).toBe(1);             // P reste suspendu (motif structurel)
    expect(fev.absents).toBeCloseTo(1);          // M compte comme absent
    expect(fev.absenteeism_rate).toBeCloseTo(50); // 1 / (3 − 1)
    expect(photo[1].est_sortie_temporaire).toBe(true); // la photo d'origine n'est pas mutée
  });
});

describe("projectHeadcount avec effectifs par photo", () => {
  // Année passée : tous les mois sont « réels », aucune projection ne dépend de la date du jour
  const annee = 2000;

  it("lit un mois écoulé dans son effectif constaté plutôt que dans la photo unique", () => {
    const photoUnique = [salarie("A"), salarie("B")];
    const reels = [{ mois: 3, brut: 7, temp_exits: 1, departures: 2, absents: 0.6, absenteeism_rate: 10 }];
    const sans = projectHeadcount(photoUnique, [], scenarioVide, annee);
    const avec = projectHeadcount(photoUnique, [], scenarioVide, annee, undefined, reels);
    expect(sans[2].effectif_brut).toBe(2);
    expect(avec[2]).toMatchObject({ month: 3, effectif_brut: 7, effectif_net: 6, temp_exits: 1, departures: 2, absenteeism_rate: 10, is_projection: false });
    // Les mois sans effectif fourni retombent sur la photo unique
    expect(avec[0].effectif_brut).toBe(2);
  });
});

describe("projectHeadcount — effectif net", () => {
  it("net = sous contrat − suspensions sur un mois réel, l'absentéisme reste un taux à part", () => {
    const photo = [salarie("A"), salarie("B"), salarie("E", { est_sortie_temporaire: true, date_sortie: "1999-06-01" })];
    const abs = { code_salarie: "A", mois: 2, annee: 2000, pct_absenteisme: 100, hrs_maladie: 0, hrs_maternite: 0, hrs_accident: 0, heures_theoriques: 0 };
    const fev = projectHeadcount(photo, [abs], scenarioVide, 2000)[1];
    expect(fev).toMatchObject({ effectif_brut: 3, effectif_net: 2, temp_exits: 1, absenteeism_rate: 50 });
  });

  it("net = brut − suspensions projetées sur un mois à venir", () => {
    const annee = new Date().getFullYear() + 1;
    const photo = [salarie("A"), salarie("B"), salarie("E", { est_sortie_temporaire: true, date_sortie: "2020-06-01" })];
    const janv = projectHeadcount(photo, [], scenarioVide, annee)[0];
    // Sans mois réel avant lui, les suspensions projetées partent de zéro
    expect(janv.is_projection).toBe(true);
    expect(janv.effectif_net).toBe(janv.effectif_brut - janv.temp_exits);
  });
});

describe("joursOuvresEntre", () => {
  it("compte les bornes incluses", () => {
    // Lundi 24 au vendredi 28 août 2026
    expect(joursOuvresEntre("2026-08-24", "2026-08-28")).toBe(5);
  });

  it("écarte les week-ends", () => {
    // Mardi 4 au mercredi 12 août 2026 : 4,5,6,7 puis 10,11,12 = 7
    expect(joursOuvresEntre("2026-08-04", "2026-08-12")).toBe(7);
  });

  it("écarte les jours fériés luxembourgeois", () => {
    // 15 août 2026 (Assomption) tombe un samedi : ne retire rien de plus
    expect(joursOuvresEntre("2026-08-10", "2026-08-21")).toBe(10);
    // Noël 2026 est un vendredi : la semaine du 21 au 25 n'a que 4 jours
    expect(joursOuvresEntre("2026-12-21", "2026-12-25")).toBe(4);
  });

  it("rend 1 pour une absence d'un seul jour ouvré", () => {
    expect(joursOuvresEntre("2026-08-03", "2026-08-03")).toBe(1);
  });

  it("rend 0 pour une date tombant un week-end", () => {
    // Dimanche 30 août 2026
    expect(joursOuvresEntre("2026-08-30", "2026-08-30")).toBe(0);
  });

  it("traverse les mois et les années", () => {
    // 30 et 31 décembre 2026 (mer, jeu) + 1er janvier férié + vendredi 1er ? 
    // 2026-12-30 mer, 31 jeu, 2027-01-01 férié (ven) => 2
    expect(joursOuvresEntre("2026-12-30", "2027-01-01")).toBe(2);
  });

  it("rend 0 quand une borne manque ou que l'ordre est inversé", () => {
    expect(joursOuvresEntre(null, "2026-08-03")).toBe(0);
    expect(joursOuvresEntre("2026-08-03", null)).toBe(0);
    expect(joursOuvresEntre("2026-08-10", "2026-08-03")).toBe(0);
  });
});

describe("jourSuivant", () => {
  it("passe au lendemain, fins de mois et d'année comprises", () => {
    expect(jourSuivant("2026-08-30")).toBe("2026-08-31");
    expect(jourSuivant("2026-08-31")).toBe("2026-09-01");
    expect(jourSuivant("2026-12-31")).toBe("2027-01-01");
    expect(jourSuivant("2028-02-28")).toBe("2028-02-29"); // bissextile
  });

  it("ne saute ni ne répète un jour au changement d'heure, et accepte un horodatage", () => {
    expect(jourSuivant("2026-03-28")).toBe("2026-03-29");
    expect(jourSuivant("2026-10-24")).toBe("2026-10-25");
    expect(jourSuivant("2026-10-25T00:00:00")).toBe("2026-10-26");
  });
});
