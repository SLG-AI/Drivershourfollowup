"use server";

import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface AnalyseJob {
  id: string;
  thread_id: string;
  question: string;
  status: "queued" | "running" | "done" | "error";
  progress: string[];
  summary: string | null;
  deck_title: string | null;
  deck_path: string | null;
  usage: { coutUsd?: number } | null;
  version: number;
  /** Plan du deck : type et titre de chaque slide, dans l'ordre (le détail reste en base). */
  plan: { type: string; titre: string }[] | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

const COLONNES = "id, thread_id, question, status, progress, summary, deck_title, deck_path, usage, error, created_at, finished_at, version, deck_spec";

/** Ne remonte au navigateur que le plan du deck, pas son contenu ni les sorties d'outils. */
function versClient(ligne: Record<string, unknown> | null): AnalyseJob | null {
  if (!ligne) return null;
  const { deck_spec, ...reste } = ligne;
  const slides = (deck_spec as { slides?: { type: string; title?: string; highlight?: string }[] } | null)?.slides;
  return {
    ...(reste as unknown as AnalyseJob),
    plan: slides?.map((sl) => ({ type: sl.type, titre: [sl.title, sl.highlight].filter(Boolean).join(" ") })) ?? null,
  };
}

export async function estAnalyste(): Promise<boolean> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "analyste");
  return (data?.length ?? 0) > 0;
}

/**
 * Lance l'analyse en tâche de fond. Sur Netlify : fonction de fond (jusqu'à
 * 15 min), appelée avec un secret partagé. En local : `after()`, le serveur
 * de dev restant vivant après la réponse.
 */
async function declencher(jobId: string) {
  if (process.env.NETLIFY && process.env.URL) {
    const reponse = await fetch(`${process.env.URL}/.netlify/functions/analyse-background`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-analyse-secret": process.env.ANALYSES_SECRET ?? "" },
      body: JSON.stringify({ jobId }),
    });
    if (reponse.status !== 202 && !reponse.ok) throw new Error(`Déclenchement de l'analyse refusé (${reponse.status}).`);
    return;
  }
  const { executerAnalyse } = await import("@/lib/analyses/executer");
  after(() => executerAnalyse(jobId));
}

export async function lancerAnalyse(input: { question: string; threadId?: string }): Promise<AnalyseJob> {
  const question = input.question.trim();
  if (question.length < 3) throw new Error("Question trop courte.");
  if (!(await estAnalyste())) throw new Error("Accès réservé aux personnes habilitées (rôle « analyste »).");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("analysis_jobs")
    .insert({ question, thread_id: input.threadId ?? crypto.randomUUID() })
    .select(COLONNES)
    .single();
  if (error || !data) throw new Error(`Création de l'analyse impossible : ${error?.message}`);
  await declencher(data.id);
  return versClient(data)!;
}

export async function listerAnalyses(): Promise<AnalyseJob[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("analysis_jobs").select(COLONNES).order("created_at", { ascending: false }).limit(50);
  return (data ?? []).map((l) => versClient(l)!);
}

export async function etatAnalyse(id: string): Promise<AnalyseJob | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("analysis_jobs").select(COLONNES).eq("id", id).maybeSingle();
  return versClient(data);
}

/** Lien de téléchargement valable 2 minutes (bucket privé, RLS par utilisateur). */
export async function lienDeck(id: string): Promise<string> {
  const job = await etatAnalyse(id);
  if (!job?.deck_path) throw new Error("Deck introuvable.");
  const supabase = await createClient();
  const nom = `${(job.deck_title ?? "SLG analysis").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "_")}_v${job.version}.pptx`;
  const { data, error } = await supabase.storage.from("analyses").createSignedUrl(job.deck_path, 120, { download: nom });
  if (error || !data) throw new Error(`Lien impossible : ${error?.message}`);
  return data.signedUrl;
}
