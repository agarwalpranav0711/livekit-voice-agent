import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { defaultAssistantSettings, type AssistantSettings } from './settings.js'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const defaultDatabasePath = resolve(webRoot, 'data', 'aural.sqlite')

export type TranscriptSpeaker = 'You' | 'Assistant' | 'Participant'
export type TranscriptInput = {
  segmentId: string
  speaker: TranscriptSpeaker
  text: string
}

export type ConversationSummary = {
  id: string
  title: string
  startedAt: string
  endedAt: string | null
  status: 'in_progress' | 'completed'
  transcriptCount: number
}

export type ConversationDetail = ConversationSummary & {
  transcript: Array<TranscriptInput & { createdAt: string }>
}

export class LocalStore {
  private readonly database: DatabaseSync

  constructor(databasePath = defaultDatabasePath) {
    mkdirSync(dirname(databasePath), { recursive: true })
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS assistant_settings (
        owner_id TEXT PRIMARY KEY,
        settings_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        title TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
        settings_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS conversations_owner_started
        ON conversations(owner_id, started_at DESC);
      CREATE TABLE IF NOT EXISTS transcript_lines (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        segment_id TEXT NOT NULL,
        speaker TEXT NOT NULL CHECK (speaker IN ('You', 'Assistant', 'Participant')),
        text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (conversation_id, segment_id)
      );
      CREATE INDEX IF NOT EXISTS transcript_conversation_created
        ON transcript_lines(conversation_id, created_at);
    `)
  }

  getSettings(ownerId: string) {
    const row = this.database.prepare(
      'SELECT settings_json AS settingsJson, updated_at AS updatedAt FROM assistant_settings WHERE owner_id = ?',
    ).get(ownerId) as { settingsJson: string; updatedAt: string } | undefined

    if (!row) return { settings: { ...defaultAssistantSettings }, updatedAt: null }
    return {
      settings: JSON.parse(row.settingsJson) as AssistantSettings,
      updatedAt: row.updatedAt,
    }
  }

  saveSettings(ownerId: string, settings: AssistantSettings) {
    const updatedAt = new Date().toISOString()
    this.database.prepare(`
      INSERT INTO assistant_settings (owner_id, settings_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(owner_id) DO UPDATE SET
        settings_json = excluded.settings_json,
        updated_at = excluded.updated_at
    `).run(ownerId, JSON.stringify(settings), updatedAt)
    return { settings, updatedAt }
  }

  createConversation(ownerId: string, id: string, settings: AssistantSettings) {
    this.database.prepare(`
      INSERT INTO conversations (id, owner_id, title, started_at, status, settings_json)
      VALUES (?, ?, 'New conversation', ?, 'in_progress', ?)
    `).run(id, ownerId, new Date().toISOString(), JSON.stringify(settings))
  }

  addTranscript(ownerId: string, conversationId: string, lines: TranscriptInput[]) {
    const insert = this.database.prepare(`
      INSERT INTO transcript_lines (conversation_id, segment_id, speaker, text, created_at)
      SELECT ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM conversations WHERE id = ? AND owner_id = ?
      )
      ON CONFLICT(conversation_id, segment_id) DO UPDATE SET
        speaker = excluded.speaker,
        text = excluded.text
    `)
    const updateTitle = this.database.prepare(`
      UPDATE conversations SET title = ?
      WHERE id = ? AND owner_id = ? AND title = 'New conversation'
    `)
    let written = 0
    for (const line of lines) {
      const result = insert.run(
        conversationId,
        line.segmentId,
        line.speaker,
        line.text,
        new Date().toISOString(),
        conversationId,
        ownerId,
      )
      written += Number(result.changes)
      if (line.speaker === 'You' && line.text.trim()) {
        updateTitle.run(line.text.trim().slice(0, 80), conversationId, ownerId)
      }
    }
    return written
  }

  finishConversation(ownerId: string, conversationId: string) {
    const result = this.database.prepare(`
      UPDATE conversations
      SET status = 'completed', ended_at = COALESCE(ended_at, ?)
      WHERE id = ? AND owner_id = ?
    `).run(new Date().toISOString(), conversationId, ownerId)
    return Number(result.changes) > 0
  }

  listConversations(ownerId: string): ConversationSummary[] {
    return this.database.prepare(`
      SELECT c.id, c.title, c.started_at AS startedAt, c.ended_at AS endedAt,
        c.status, COUNT(t.segment_id) AS transcriptCount
      FROM conversations c
      LEFT JOIN transcript_lines t ON t.conversation_id = c.id
      WHERE c.owner_id = ?
      GROUP BY c.id
      ORDER BY c.started_at DESC
    `).all(ownerId) as ConversationSummary[]
  }

  getConversation(ownerId: string, conversationId: string): ConversationDetail | null {
    const row = this.database.prepare(`
      SELECT id, title, started_at AS startedAt, ended_at AS endedAt, status,
        (SELECT COUNT(*) FROM transcript_lines WHERE conversation_id = c.id) AS transcriptCount
      FROM conversations c
      WHERE id = ? AND owner_id = ?
    `).get(conversationId, ownerId) as Omit<ConversationDetail, 'transcript'> | undefined

    if (!row) return null
    const transcript = this.database.prepare(`
      SELECT segment_id AS segmentId, speaker, text, created_at AS createdAt
      FROM transcript_lines
      WHERE conversation_id = ?
      ORDER BY created_at, rowid
    `).all(conversationId) as Array<TranscriptInput & { createdAt: string }>

    return { ...row, transcript }
  }

  deleteConversation(ownerId: string, conversationId: string) {
    const result = this.database.prepare(
      'DELETE FROM conversations WHERE id = ? AND owner_id = ?',
    ).run(conversationId, ownerId)
    return Number(result.changes) > 0
  }

  clearConversations(ownerId: string) {
    const result = this.database.prepare(
      'DELETE FROM conversations WHERE owner_id = ?',
    ).run(ownerId)
    return Number(result.changes)
  }

  close() {
    this.database.close()
  }
}

export { defaultDatabasePath }
