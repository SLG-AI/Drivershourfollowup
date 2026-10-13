/**
 * Fonction de FOND Netlify (suffixe -background : jusqu'à 15 min, réponse 202
 * immédiate) qui exécute une analyse IA. Appelée par l'action `lancerAnalyse`
 * avec le secret partagé ANALYSES_SECRET ; jamais directement par le navigateur.
 */
import { executerAnalyse } from "../../lib/analyses/executer";

export default async (req: Request) => {
  const secret = process.env.ANALYSES_SECRET;
  if (!secret || req.headers.get("x-analyse-secret") !== secret) return new Response("Forbidden", { status: 403 });
  const { jobId } = (await req.json()) as { jobId?: string };
  if (!jobId) return new Response("jobId manquant", { status: 400 });
  await executerAnalyse(jobId);
  return new Response("ok");
};
