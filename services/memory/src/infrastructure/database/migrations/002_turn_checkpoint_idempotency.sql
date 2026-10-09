ALTER TABLE oicunt_memory.conversation_messages
    ADD COLUMN IF NOT EXISTS turn_ordinal INTEGER;

WITH numbered AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY conversation_id, turn_id
               ORDER BY sequence_number ASC
           ) - 1 AS ordinal
    FROM oicunt_memory.conversation_messages
)
UPDATE oicunt_memory.conversation_messages AS messages
SET turn_ordinal = numbered.ordinal
FROM numbered
WHERE messages.id = numbered.id
  AND messages.turn_ordinal IS NULL;

ALTER TABLE oicunt_memory.conversation_messages
    ALTER COLUMN turn_ordinal SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_conversation_turn_ordinal
    ON oicunt_memory.conversation_messages (conversation_id, turn_id, turn_ordinal);
