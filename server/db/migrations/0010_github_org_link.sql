-- M7b: org de equipo vinculada a una org de GitHub (ADR 0011). Aditiva (expand): el slot anterior ignora las columnas.
-- `orgs.github_org_id` es el id numérico de GitHub (estable ante renombres); `github_org_login` es solo para mostrar.
-- `org_members.source` distingue a quien entró por el vínculo (`github`, el sync lo sube, baja o saca según GitHub) de
-- quien fue invitado o creó la org (`manual`, el sync no lo toca). Un cambio de rol hecho a mano lo pasa a `manual`.
ALTER TABLE orgs ADD COLUMN github_org_id INTEGER;
ALTER TABLE orgs ADD COLUMN github_org_login TEXT;
CREATE UNIQUE INDEX orgs_github_org ON orgs (github_org_id) WHERE github_org_id IS NOT NULL;

ALTER TABLE org_members ADD COLUMN source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'github'));
