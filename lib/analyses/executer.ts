/**
 * Exécution d'une analyse en tâche de fond : lit la tâche, charge les
 * données, fait travailler l'agent, rend le deck et le dépose dans le bucket
 * privé « analyses ». Tourne avec la clé de SERVICE (une tâche peut durer
 * plusieurs minutes, au-delà d'une session utilisateur ou d'une fonction
 * Netlify synchrone) : le contrôle d'accès est fait à la création de la tâche.
 */

import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { analyser, type SortieOutil, type Tour } from "./agent";
import { DeckSpec } from "./deck-spec";
import { chargerDonnees } from "./donnees";
import { renderDeck } from "./render-deck";

export function clientService(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !cle) throw new Error("NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis pour exécuter une analyse.");
  return createClient(url, cle, { auth: { persistSession: false } });
}

/** Les erreurs de configuration et d'API, dites en clair dans le chat. */
function messageErreur(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError || (e instanceof Error && /authentication method/i.test(e.message))) {
    return "Clé API Anthropic absente ou invalide : renseigner ANTHROPIC_API_KEY (.env.local en local, variables Netlify en production).";
  }
  if (e instanceof Anthropic.APIError && /workspace/i.test(e.message)) {
    return "Clé API Anthropic non rattachée à un workspace : créer une clé dans un workspace (console Anthropic), ou renseigner ANTHROPIC_WORKSPACE_ID avec l'identifiant du workspace (wrkspc_…).";
  }
  if (e instanceof Anthropic.RateLimitError) return "Limite de débit de l'API Anthropic atteinte : réessayer dans une minute.";
  if (e instanceof Anthropic.APIError) return `Erreur de l'API Anthropic (${e.status}) : ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

export async function executerAnalyse(jobId: string, supabase: SupabaseClient = clientService()): Promise<void> {
  const { data: job, error } = await supabase.from("analysis_jobs").select("*").eq("id", jobId).single();
  if (error || !job) throw new Error(`Analyse ${jobId} introuvable.`);
  if (job.status !== "queued") return; // déjà prise en charge : un double déclenchement ne relance rien

  const { data: prise } = await supabase.from("analysis_jobs").update({ status: "running" }).eq("id", jobId).eq("status", "queued").select("id");
  if (!prise?.length) return;

  const progression: string[] = [];
  try {
    const { data: precedents } = await supabase
      .from("analysis_jobs")
      .select("question, summary, version, deck_spec, tool_outputs")
      .eq("thread_id", job.thread_id)
      .eq("status", "done")
      .lt("created_at", job.created_at)
      .order("created_at");
    const historique: Tour[] = (precedents ?? []).map((p) => ({ question: p.question, resume: p.summary ?? "" }));
    // Retouche : on part de la dernière version réussie du fil, si son deck est relisible
    const dernier = precedents?.at(-1);
    const deckPrecedent = dernier?.deck_spec ? DeckSpec.safeParse(dernier.deck_spec) : null;
    const precedent = dernier && deckPrecedent?.success
      ? { deck: deckPrecedent.data, sorties: (dernier.tool_outputs ?? []) as SortieOutil[], version: dernier.version as number }
      : undefined;

    const donnees = await chargerDonnees(supabase);
    const resultat = await analyser({
      question: job.question,
      donnees,
      historique,
      precedent,
      surProgression: async (etape) => {
        progression.push(etape);
        await supabase.from("analysis_jobs").update({ progress: progression }).eq("id", jobId);
      },
    });
    if (!resultat.deck) throw new Error(resultat.resume || "L'analyse n'a pas produit de deck valide.");

    const fichier = await renderDeck(resultat.deck);
    const chemin = `${job.user_id}/${jobId}.pptx`;
    const { error: errDepot } = await supabase.storage.from("analyses").upload(chemin, fichier, {
      contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      upsert: true,
    });
    if (errDepot) throw new Error(`Dépôt du deck impossible : ${errDepot.message}`);

    const couverture = resultat.deck.slides.find((s) => s.type === "cover");
    await supabase.from("analysis_jobs").update({
      status: "done",
      summary: resultat.resume,
      deck_title: couverture && "title" in couverture ? couverture.title : resultat.deck.topic,
      deck_path: chemin,
      version: (precedent?.version ?? 0) + 1,
      deck_spec: resultat.deck,
      tool_outputs: resultat.sorties,
      usage: { ...resultat.usage, outils: resultat.outilsAppeles },
      finished_at: new Date().toISOString(),
    }).eq("id", jobId);
  } catch (e) {
    await supabase.from("analysis_jobs").update({
      status: "error",
      error: messageErreur(e),
      finished_at: new Date().toISOString(),
    }).eq("id", jobId);
  }
}
