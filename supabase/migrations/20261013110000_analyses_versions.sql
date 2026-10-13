-- Analyste IA : retouches d'un deck dans le même fil. Chaque analyse garde le
-- plan de son deck et les sorties des outils qu'elle a appelés (des AGRÉGATS,
-- aucune donnée individuelle) : une retouche part du deck précédent au lieu de
-- tout refaire, et la vérification des chiffres accepte ceux déjà calculés.
ALTER TABLE public.analysis_jobs
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN deck_spec jsonb,
  ADD COLUMN tool_outputs jsonb;
