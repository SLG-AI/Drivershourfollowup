import { describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { analyser, type SortieOutil } from "../agent";
import type { DeckSpec } from "../deck-spec";
import type { DonneesAnalyse } from "../donnees";

/** API simulée : rejoue des réponses écrites d'avance et garde les requêtes envoyées. */
function apiSimulee(reponses: Anthropic.Beta.BetaContentBlock[][]) {
  const requetes: { messages: { role: string; content: unknown }[]; system: unknown }[] = [];
  let n = 0;
  const fetch = async (_url: RequestInfo | URL, init?: RequestInit) => {
    requetes.push(JSON.parse(String(init?.body)));
    const content = reponses[n++];
    const fin = content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn";
    return new Response(JSON.stringify({
      id: `msg_${n}`, type: "message", role: "assistant", model: "claude-opus-5-5", content,
      stop_reason: fin, stop_sequence: null,
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { client: new Anthropic({ apiKey: "test", fetch, maxRetries: 0 }), requetes };
}

const deckV1: DeckSpec = {
  topic: "Schedule hardship",
  slides: [
    { type: "cover", title: "Schedule hardship", date: "Oct 2026" },
    { type: "kpis", title: "Key", highlight: "figures", items: [{ label: "Long days per driver", value: "2.46" }], sources: ["long_days_by_depot"] },
    { type: "limits", title: "What the data", highlight: "does not show", items: ["Payroll premiums only."] },
  ],
};
const sortiesV1: SortieOutil[] = [{ outil: "long_days_by_depot", entree: { activity_year: 2026, activity_month: 7 }, sortie: { overall: { long_days_per_driver: 2.46, drivers_paid: 1250 }, by_depot: [{ depot: "Allerborn", deviation_from_average_pct: 65.9 }] } }];
const donnees = {} as DonneesAnalyse;

const soumettre = (deck: DeckSpec, id: string): Anthropic.Beta.BetaContentBlock => ({ type: "tool_use", id, name: "submit_deck", input: deck } as Anthropic.Beta.BetaContentBlock);

describe("analyser — retouche d'un deck", () => {
  it("transmet le deck numéroté et les sorties déjà calculées, et accepte un chiffre de la v1 sans relancer d'outil", async () => {
    const deckV2: DeckSpec = {
      ...deckV1,
      slides: [deckV1.slides[0], { type: "kpis", title: "Key", highlight: "figures", items: [{ label: "Long days per driver", value: "2.46" }], commentary: "Allerborn is 65.9% above the average.", sources: ["long_days_by_depot"] }, deckV1.slides[2]],
    };
    const { client, requetes } = apiSimulee([[soumettre(deckV2, "tu_1")], [{ type: "text", text: "Slide 2 : commentaire ajouté sur Allerborn.", citations: null } as Anthropic.Beta.BetaContentBlock]]);

    const r = await analyser({
      question: "slide 2 : ajoute un commentaire sur Allerborn",
      donnees,
      historique: [{ question: "Analyse la pénibilité", resume: "Deck v1." }],
      precedent: { deck: deckV1, sorties: sortiesV1, version: 1 },
      client,
    });

    const premier = JSON.stringify(requetes[0].messages[0].content);
    expect(premier).toContain("Current deck (version 1)");
    expect(premier).toContain("slide_number");
    expect(premier).toContain("deviation_from_average_pct");
    expect(premier).toContain("slide 2 : ajoute un commentaire sur Allerborn");
    expect(JSON.stringify(requetes[1].messages)).toContain("ACCEPTED");
    expect(r.deck?.slides[1]).toMatchObject({ commentary: "Allerborn is 65.9% above the average." });
    expect(r.resume).toBe("Slide 2 : commentaire ajouté sur Allerborn.");
    expect(r.outilsAppeles).toEqual([]);
    expect(r.sorties).toEqual(sortiesV1);
    expect(r.usage.coutUsd).toBeGreaterThan(0);
  });

  it("refuse un chiffre absent des sorties, puis accepte la correction", async () => {
    const invente: DeckSpec = { ...deckV1, slides: [deckV1.slides[0], { type: "findings", title: "Findings", items: [{ headline: "Allerborn", detail: "is 80% above the average" }], sources: [] }, deckV1.slides[2]] };
    const corrige: DeckSpec = { ...deckV1, slides: [deckV1.slides[0], { type: "findings", title: "Findings", items: [{ headline: "Allerborn", detail: "is 65.9% above the average" }], sources: [] }, deckV1.slides[2]] };
    const { client, requetes } = apiSimulee([[soumettre(invente, "tu_1")], [soumettre(corrige, "tu_2")], [{ type: "text", text: "Fait.", citations: null } as Anthropic.Beta.BetaContentBlock]]);

    const r = await analyser({ question: "slide 2 : précise l'écart d'Allerborn", donnees, precedent: { deck: deckV1, sorties: sortiesV1, version: 1 }, client });

    expect(JSON.stringify(requetes[1].messages)).toContain("REJECTED");
    expect(JSON.stringify(requetes[1].messages)).toContain("80");
    expect(r.deck?.slides[1]).toMatchObject({ items: [{ detail: "is 65.9% above the average" }] });
  });
});
