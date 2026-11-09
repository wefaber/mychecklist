-- Identificador corto de un item (ADR 0012): `<ORG>-<LISTA>-<NUM>`. Aditiva (expand): el slot anterior ignora las
-- columnas nuevas, y los triggers numeran lo que ese slot inserte o mueva durante un cambio de slot.

-- Código de la org (solo las de equipo lo llevan; las personales no). Lo asigna el servidor; NULL = sin prefijo.
ALTER TABLE orgs ADD COLUMN code TEXT;
CREATE UNIQUE INDEX orgs_code ON orgs (code) WHERE code IS NOT NULL;

-- Código de la lista, único dentro de la org (borradas incluidas: al restaurar no pisa a otra). `item_seq` es el
-- último número entregado: los números no se reutilizan aunque el item se borre o cambie de lista.
ALTER TABLE lists ADD COLUMN code TEXT;
ALTER TABLE lists ADD COLUMN item_seq INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX lists_code ON lists (org_id, code) WHERE code IS NOT NULL;

ALTER TABLE items ADD COLUMN number INTEGER;

-- Los items que ya existen se numeran por orden de creación dentro de su lista.
UPDATE items SET number = r.n
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY list_id ORDER BY created_at, id) AS n FROM items
) AS r
WHERE items.id = r.id;

UPDATE lists SET item_seq = COALESCE((SELECT MAX(number) FROM items WHERE items.list_id = lists.id), 0);

-- Sin UNIQUE a propósito: al mover, la fila llega a la lista nueva con su número viejo hasta que corre el trigger.
CREATE INDEX items_number ON items (list_id, number);

-- Un item nuevo toma el siguiente número de su lista; uno que cambia de lista, el siguiente de la lista nueva (su
-- identificador cambia con ella; las referencias guardadas son por ULID y no se rompen).
CREATE TRIGGER items_number_insert AFTER INSERT ON items WHEN NEW.number IS NULL
BEGIN
  UPDATE lists SET item_seq = item_seq + 1 WHERE id = NEW.list_id;
  UPDATE items SET number = (SELECT item_seq FROM lists WHERE id = NEW.list_id) WHERE id = NEW.id;
END;

CREATE TRIGGER items_number_move AFTER UPDATE OF list_id ON items WHEN NEW.list_id != OLD.list_id
BEGIN
  UPDATE lists SET item_seq = item_seq + 1 WHERE id = NEW.list_id;
  UPDATE items SET number = (SELECT item_seq FROM lists WHERE id = NEW.list_id) WHERE id = NEW.id;
END;
