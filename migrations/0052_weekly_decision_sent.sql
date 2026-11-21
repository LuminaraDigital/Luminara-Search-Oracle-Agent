-- Weekly digest sends once: a claimed row has been (or is being) sent to Telegram.
ALTER TABLE weekly_decisions ADD COLUMN telegram_sent_at INTEGER;
