import { describe, expect, it } from "vitest";
import { indexerPhotos } from "../roster-photos";
import { analyserTurnover, classerMotifSortie, sortiesDeLAnnee, type LignePhotoTurnover, type MouvementSortie } from "../wp-turnover";

describe("classerMotifSortie", () => {
  it("suit la classification de l'auteur, accents et casse ignorés", () => {
    ["Demission", "Démission", "Résiliation commun accord", "Transfert société", "Préretraite", "Pension de vieillesse"]
      .forEach((m) => expect(classerMotifSortie(m), m).toBe("volontaire"));
    ["Licenciement", "PeriodeEssaiNonConcluante", "Reclassement externe", "Décès", "Deces"]
      .forEach((m) => expect(classerMotifSortie(m), m).toBe("involontaire"));
    expect(classerMotifSortie("Fin de mission")).toBe("fin_de_mission");
    expect(classerMotifSortie("")).toBe("autre");
    expect(classerMotifSortie("Mutation interne")).toBe("autre");
  });
});

const ligne = (code: string, mois: number, extra: Partial<LignePhotoTurnover> = {}): LignePhotoTurnover => ({
  code_salarie: code, mois, annee: 2026, date_entree: "2020-01-01", date_sortie: null,
  est_sortie_temporaire: false, description_motif_sortie: "", taux_occupation: 100, description_service: "Depot A", ...extra,
});
const mv = (code: string, date: string, motif: string, type = "sortie"): MouvementSortie => ({
  code_salarie: code, type, motif_sortie: motif, date_sortie: date, mois: Number(date.slice(5, 7)), annee: Number(date.slice(0, 4)),
});

describe("sortiesDeLAnnee", () => {
  const photos = indexerPhotos([
    ligne("A", 1), ligne("B", 1, { taux_occupation: 50, description_service: "Depot B" }), ligne("C", 1),
    ligne("A", 2), ligne("C", 2),
  ]);

  it("lit l'export IN/OUT quand il couvre l'année : ETP et dépôt de la dernière fiche, dernier jour ⇒ mois suivant", () => {
    const sorties = sortiesDeLAnnee(2026, photos, [
      mv("B", "2026-01-31", "Demission"),
      mv("B", "2026-01-31", "Demission", "sortie_temporaire"), // ignoré
      mv("Z", "2026-03-10", "Licenciement"),                    // inconnu des photos
      mv("C", "2025-12-15", "Décès"),                            // autre année
    ]);
    expect(sorties).toHaveLength(2);
    const b = sorties.find((s) => s.code_salarie === "B")!;
    expect(b).toMatchObject({ mois: 2, etp: 0.5, depot: "Depot B", categorie: "volontaire" });
    const z = sorties.find((s) => s.code_salarie === "Z")!;
    expect(z).toMatchObject({ mois: 3, etp: 1, depot: "Non renseigné", categorie: "involontaire" });
  });

  it("sans IN/OUT, lit les dates de sortie photo par photo, sans doublon", () => {
    const p = indexerPhotos([
      ligne("A", 1, { date_sortie: "2026-02-10", description_motif_sortie: "Licenciement" }),
      ligne("A", 2, { date_sortie: "2026-02-10", description_motif_sortie: "Licenciement" }),
      ligne("T", 2, { date_sortie: "2026-02-20", est_sortie_temporaire: true }),
    ]);
    const sorties = sortiesDeLAnnee(2026, p, []);
    expect(sorties).toHaveLength(1);
    expect(sorties[0]).toMatchObject({ code_salarie: "A", mois: 2, categorie: "involontaire" });
  });
});

describe("analyserTurnover", () => {
  const photos = indexerPhotos([
    ligne("A", 1), ligne("B", 1), ligne("C", 1, { description_service: "Depot B" }), ligne("D", 1, { description_service: "Depot B" }),
    ligne("A", 2), ligne("B", 2), ligne("C", 2, { description_service: "Depot B" }),
  ]);
  const mouvements = [
    mv("D", "2026-01-15", "Demission"),
    mv("B", "2026-02-10", "Licenciement"),
    mv("C", "2026-02-12", "Fin de mission"),
  ];
  const r = analyserTurnover(2026, [1, 2], photos, mouvements);

  it("rapporte les catégories à l'effectif moyen, fin de mission à part", () => {
    expect(r.effectifMoyenEtp).toBe(3.5); // (4 + 3) / 2
    expect(r.categories.volontaire).toEqual({ nb: 1, etp: 1, taux: 28.6 });
    expect(r.categories.involontaire).toEqual({ nb: 1, etp: 1, taux: 28.6 });
    expect(r.categories.fin_de_mission.nb).toBe(1);
    expect(r.tauxTotal).toBe(57.1); // 2 / 3.5, fin de mission exclue
  });

  it("ventile par mois et par motif", () => {
    expect(r.parMois[0]).toEqual({ mois: 1, volontaire: 1, involontaire: 0, autre: 0 });
    expect(r.parMois[1]).toEqual({ mois: 2, volontaire: 0, involontaire: 1, autre: 0 });
    expect(r.parMotif.map((m) => m.motif)).toEqual(expect.arrayContaining(["Demission", "Licenciement", "Fin de mission"]));
  });

  it("classe les dépôts par taux, les petits effectifs non classables", () => {
    const a = r.parDepot.find((d) => d.depot === "Depot A")!;
    const b = r.parDepot.find((d) => d.depot === "Depot B")!;
    expect(a).toMatchObject({ effectifMoyenEtp: 2, sortiesEtp: 1, involontaireEtp: 1, taux: 50, tauxVolontaire: 0, tauxInvolontaire: 50, classable: false });
    expect(b).toMatchObject({ effectifMoyenEtp: 1.5, sortiesEtp: 1, volontaireEtp: 1, taux: 66.7 });
    expect(r.parDepot[0].depot).toBe("Depot B");
  });

  it("place les dépôts classables avant les petits, quel que soit leur taux", () => {
    const grand = Array.from({ length: 12 }, (_, i) => ligne(`G${i}`, 1, { description_service: "Grand" }));
    const p = indexerPhotos([...grand, ligne("P", 1, { description_service: "Petit" })]);
    const res = analyserTurnover(2026, [1], p, [mv("P", "2026-01-10", "Demission"), mv("G0", "2026-01-10", "Demission")]);
    expect(res.parDepot.map((d) => d.depot)).toEqual(["Grand", "Petit"]);
    expect(res.parDepot[0]).toMatchObject({ classable: true, taux: 8.3 });
    expect(res.parDepot[1]).toMatchObject({ classable: false, taux: 100 });
  });
});
