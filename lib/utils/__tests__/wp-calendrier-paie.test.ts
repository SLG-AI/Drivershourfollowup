import { describe, expect, it } from "vitest";
import { evenementsPaieDuMois, mentionCalendrierPaie } from "../wp-calendrier-paie";

describe("calendrier de la paie", () => {
  it("janvier, mai et septembre portent le décompte de fin de période", () => {
    for (const m of [1, 5, 9]) expect(evenementsPaieDuMois(m)[0]).toContain("décompte de fin de période");
  });

  it("mai ajoute les bonus annuels, décembre le 13e mois, janvier le reliquat de décembre", () => {
    expect(evenementsPaieDuMois(5)).toContain("bonus annuels");
    expect(evenementsPaieDuMois(12).join()).toContain("13e mois");
    expect(evenementsPaieDuMois(1).join()).toContain("primes de décembre");
  });

  it("un mois ordinaire n'a pas de mention", () => {
    for (const m of [2, 3, 4, 6, 7, 8, 10, 11]) expect(mentionCalendrierPaie(m)).toBeNull();
  });

  it("énumère les versements en une phrase", () => {
    expect(mentionCalendrierPaie(5)).toBe(
      "Mois de versements calendaires : décompte de fin de période de référence (4 mois), qui gonfle la part liée au planning ; bonus annuels. Le contractuel ne les modélise pas."
    );
  });
});
