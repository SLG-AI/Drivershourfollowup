-- Analyste IA : questions en langage naturel → deck PowerPoint (lib/analyses).
--
-- Premiers RÔLES de l'application : jusqu'ici tout utilisateur connecté voyait
-- tout. L'analyste IA compare dépôts et concentrations de charge : il est
-- réservé aux personnes habilitées (rôle « analyste »), attribué à la main :
--   insert into public.user_roles (user_id, role) values ('<uuid>', 'analyste');
--
-- Les tâches sont créées par l'utilisateur (RLS) et exécutées par une fonction
-- de fond avec la clé de service, qui seule les met à jour.

CREATE TABLE public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('analyste')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
-- Chacun lit ses propres rôles ; personne ne se les attribue (pas de policy d'écriture).
CREATE POLICY "lire ses roles" ON public.user_roles FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE FUNCTION public.a_le_role(r text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = r) $$;

CREATE TABLE public.analysis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  -- Un fil = une conversation : les retouches reprennent les échanges précédents
  thread_id uuid NOT NULL,
  question text NOT NULL CHECK (length(question) BETWEEN 3 AND 4000),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
  -- Étapes franchies (outils appelés), pour la progression affichée
  progress text[] NOT NULL DEFAULT '{}',
  summary text,
  deck_title text,
  deck_path text,
  -- Jetons et coût estimé de l'appel à l'API
  usage jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX analysis_jobs_user_created ON public.analysis_jobs (user_id, created_at DESC);
CREATE INDEX analysis_jobs_thread ON public.analysis_jobs (thread_id, created_at);
ALTER TABLE public.analysis_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "analyste lit ses analyses" ON public.analysis_jobs FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.a_le_role('analyste'));
CREATE POLICY "analyste cree ses analyses" ON public.analysis_jobs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'queued' AND public.a_le_role('analyste'));

GRANT SELECT ON public.user_roles TO authenticated;
GRANT SELECT, INSERT ON public.analysis_jobs TO authenticated;
GRANT ALL ON public.user_roles, public.analysis_jobs TO service_role;
GRANT EXECUTE ON FUNCTION public.a_le_role(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.a_le_role(text) FROM anon, public;

-- Decks : bucket privé, un dossier par utilisateur (<user_id>/<job_id>.pptx)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('analyses', 'analyses', false, 20971520, ARRAY['application/vnd.openxmlformats-officedocument.presentationml.presentation'])
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "analyste lit ses decks" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'analyses' AND (storage.foldername(name))[1] = auth.uid()::text AND public.a_le_role('analyste'));
