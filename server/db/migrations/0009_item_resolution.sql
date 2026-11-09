-- Resolución de un item: el texto (Markdown) con que se cerró. Aditiva (expand): la columna admite NULL y el slot
-- anterior no la lee ni la escribe, así que blue y green conviven durante un cambio de slot.
ALTER TABLE items ADD COLUMN resolution TEXT;
