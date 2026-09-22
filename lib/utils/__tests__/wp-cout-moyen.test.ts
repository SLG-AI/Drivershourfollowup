import { describe, it, expect } from "vitest";
import { LIBELLES_REPLI, coutMoyenEtp, profilDe, type ProfilCout } from "../wp-cout-moyen";
import type { SalarieCout } from "../wp-couts";

function salarie(p: Partial<SalarieCout> & { code_salarie: string }): SalarieCout {
  return { est_sortie_temporaire: false, ...p };
}

const DEFAUT = 9999;

describe("profilDe", () => {
  it("lit fonction, famille de contrat, cost center et dépôt", () => {
    expect(
      profilDe(
        salarie({
          code_salarie: "A",
          description_fonction: "Chauffeur",
          type_contrat: "CDD CHAUF. BUS",
          centre_cout: "CC1",
          description_service: "Dépôt Nord",
        })
      )
    ).toEqual({ fonction: "Chauffeur", famille: "CDD", centre_cout: "CC1", depot: "Dépôt Nord" });
  });

  it("rend des null et une famille vide quand rien n'est renseigné", () => {
    expect(profilDe(salarie({ code_salarie: "A" }))).toEqual({ fonction: null, famille: "", centre_cout: null, depot: null });
  });
});

describe("coutMoyenEtp", () => {
  // Une population où chaque niveau de repli a exactement un comparable
  // distinct, pour vérifier que la chaîne s'arrête au bon endroit.
  const population: SalarieCout[] = [
    // (1) même cc, même fonction, même famille
    salarie({ code_salarie: "N1", centre_cout: "CC1", description_service: "Nord", description_fonction: "Chauffeur", type_contrat: "CDI CHAUFF. BUS", brut_indice: 1000 }),
    // (2) même dépôt, autre cc
    salarie({ code_salarie: "N2", centre_cout: "CC2", description_service: "Nord", description_fonction: "Chauffeur", type_contrat: "CDI CHAUFF. BUS", brut_indice: 2000 }),
    // (3) même fonction, même famille, ailleurs
    salarie({ code_salarie: "N3", centre_cout: "CC3", description_service: "Sud", description_fonction: "Chauffeur", type_contrat: "CDI CHAUFF. BUS", brut_indice: 3000 }),
    // (4) même cc, même fonction, autre famille
    salarie({ code_salarie: "N4", centre_cout: "CC1", description_service: "Nord", description_fonction: "Chauffeur", type_contrat: "CDD CHAUF. BUS", brut_indice: 4000 }),
    // (5) même fonction, autre famille, ailleurs
    salarie({ code_salarie: "N5", centre_cout: "CC3", description_service: "Sud", description_fonction: "Chauffeur", type_contrat: "CDD CHAUF. BUS", brut_indice: 5000 }),
    // (6) autre fonction
    salarie({ code_salarie: "N6", centre_cout: "CC9", description_service: "Est", description_fonction: "Mécanicien", type_contrat: "CDI", brut_indice: 6000 }),
  ];
  const profil: ProfilCout = { fonction: "Chauffeur", famille: "CDI", centre_cout: "CC1", depot: "Nord" };

  const sans = (codes: string[]) => population.filter((e) => !codes.includes(e.code_salarie));

  it("(1) même cost center et même profil", () => {
    const r = coutMoyenEtp(population, profil, 1, DEFAUT);
    expect(r).toEqual({ coutEtp: 1000, niveau: "cc_profil", n: 1, brutPleinTempsMoyen: 1000 });
  });

  it("(2) même dépôt et même profil", () => {
    const r = coutMoyenEtp(sans(["N1"]), profil, 1, DEFAUT);
    expect(r.niveau).toBe("depot_profil");
    expect(r.coutEtp).toBe(2000);
  });

  it("(3) même profil dans l'entreprise", () => {
    const r = coutMoyenEtp(sans(["N1", "N2"]), profil, 1, DEFAUT);
    expect(r.niveau).toBe("entreprise_profil");
    expect(r.coutEtp).toBe(3000);
  });

  it("(4) même cost center et même fonction, famille ignorée", () => {
    const r = coutMoyenEtp(sans(["N1", "N2", "N3"]), profil, 1, DEFAUT);
    expect(r.niveau).toBe("cc_fonction");
    expect(r.coutEtp).toBe(4000);
  });

  it("(5) même fonction dans l'entreprise", () => {
    const r = coutMoyenEtp(sans(["N1", "N2", "N3", "N4"]), profil, 1, DEFAUT);
    expect(r.niveau).toBe("entreprise_fonction");
    expect(r.coutEtp).toBe(5000);
  });

  it("(6) toute l'entreprise", () => {
    const r = coutMoyenEtp(sans(["N1", "N2", "N3", "N4", "N5"]), profil, 1, DEFAUT);
    expect(r.niveau).toBe("entreprise");
    expect(r.coutEtp).toBe(6000);
  });

  it("(7) défaut quand personne n'a de brut, sans coefficient", () => {
    const r = coutMoyenEtp(
      [salarie({ code_salarie: "X", description_fonction: "Chauffeur", brut_indice: 0 }), salarie({ code_salarie: "Y" })],
      profil,
      1.13,
      DEFAUT
    );
    expect(r).toEqual({ coutEtp: DEFAUT, niveau: "defaut", n: 0, brutPleinTempsMoyen: 0 });
  });

  it("saute (1) et (4) sans cost center", () => {
    const r = coutMoyenEtp(population, { ...profil, centre_cout: null }, 1, DEFAUT);
    expect(r.niveau).toBe("depot_profil");
    const r2 = coutMoyenEtp(sans(["N1", "N2", "N3"]), { ...profil, centre_cout: "  " }, 1, DEFAUT);
    expect(r2.niveau).toBe("entreprise_fonction");
  });

  it("saute (2) sans dépôt", () => {
    const r = coutMoyenEtp(sans(["N1"]), { ...profil, depot: null }, 1, DEFAUT);
    expect(r.niveau).toBe("entreprise_profil");
  });

  it("va droit à (6) sans fonction", () => {
    const r = coutMoyenEtp(population, { ...profil, fonction: null }, 1, DEFAUT);
    expect(r.niveau).toBe("entreprise");
    expect(r.n).toBe(6);
    expect(r.brutPleinTempsMoyen).toBe(3500);
  });

  it("respecte la famille de contrat lue par familleContrat", () => {
    // « CDI CHAUFF. BUS » et « CDD CHAUF. BUS » sont deux familles : un profil
    // CDD ne trouve pas N1 au niveau (1) mais N4.
    const r = coutMoyenEtp(population, { ...profil, famille: "CDD" }, 1, DEFAUT);
    expect(r.niveau).toBe("cc_profil");
    expect(r.coutEtp).toBe(4000);
  });

  it("compare fonction, cost center et dépôt sans tenir compte de la casse ni des espaces", () => {
    const r = coutMoyenEtp(population, { ...profil, fonction: "  CHAUFFEUR ", centre_cout: "cc1 ", depot: " NORD" }, 1, DEFAUT);
    expect(r.niveau).toBe("cc_profil");
    expect(r.coutEtp).toBe(1000);
  });

  it("moyenne les bruts plein temps sans pondérer par le taux, puis applique le coefficient", () => {
    const pop = [
      salarie({ code_salarie: "A", description_fonction: "Chauffeur", brut_indice: 2000, taux_occupation: 50 }),
      salarie({ code_salarie: "B", description_fonction: "Chauffeur", brut_indice: "4000" }),
    ];
    const r = coutMoyenEtp(pop, { fonction: "Chauffeur", famille: "", centre_cout: null, depot: null }, 1.13, DEFAUT);
    expect(r.niveau).toBe("entreprise_profil");
    expect(r.n).toBe(2);
    expect(r.brutPleinTempsMoyen).toBe(3000);
    expect(r.coutEtp).toBeCloseTo(3390, 10);
  });

  it("a un libellé pour chaque niveau", () => {
    const niveaux = ["cc_profil", "depot_profil", "entreprise_profil", "cc_fonction", "entreprise_fonction", "entreprise", "defaut"] as const;
    niveaux.forEach((n) => expect(LIBELLES_REPLI[n]).toBeTruthy());
  });
});
