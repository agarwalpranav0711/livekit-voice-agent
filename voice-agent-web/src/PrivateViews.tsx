import type { FormEvent } from 'react'

export type AssistantSettings = {
  assistantName: string
  personality: 'friendly' | 'professional' | 'concise' | 'humorous'
  greeting: string
  language: 'en' | 'es' | 'fr' | 'hi' | 'de' | 'ja'
  responseStyle: 'short' | 'detailed'
  customInstructions: string
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
  transcript: Array<{ segmentId: string; speaker: string; text: string; createdAt: string }>
}

export function SettingsForm({
  settings,
  onChange,
  onSave,
  loading,
  saving,
  message,
  error,
}: {
  settings: AssistantSettings
  onChange: (settings: AssistantSettings) => void
  onSave: (event: FormEvent<HTMLFormElement>) => void
  loading: boolean
  saving: boolean
  message: string
  error: string
}) {
  const update = <K extends keyof AssistantSettings>(key: K, value: AssistantSettings[K]) => {
    onChange({ ...settings, [key]: value })
  }

  if (loading) return <section className="private-card"><p role="status">Loading your saved assistant settings…</p></section>

  return (
    <section className="private-card" aria-labelledby="settings-title">
      <div className="private-heading">
        <div><span className="private-eyebrow">MAKE IT YOURS</span><h2 id="settings-title">Assistant settings</h2></div>
        <span className="private-badge">Local to this browser profile</span>
      </div>
      <p className="private-intro">These saved preferences are included in the instructions for each new voice session. Changes do not rewrite an ongoing session.</p>
      <form className="settings-form" onSubmit={onSave}>
        <label>
          <span>Assistant name</span>
          <input value={settings.assistantName} maxLength={48} required onChange={(event) => update('assistantName', event.target.value)} />
        </label>
        <label>
          <span>Personality</span>
          <select value={settings.personality} onChange={(event) => update('personality', event.target.value as AssistantSettings['personality'])}>
            <option value="friendly">Friendly</option><option value="professional">Professional</option>
            <option value="concise">Concise</option><option value="humorous">Lightly humorous</option>
          </select>
        </label>
        <label className="settings-wide">
          <span>Custom greeting</span>
          <textarea value={settings.greeting} maxLength={240} rows={2} required onChange={(event) => update('greeting', event.target.value)} />
          <small>Spoken aloud when a new agent session starts. Up to 240 characters.</small>
        </label>
        <label>
          <span>Preferred language</span>
          <select value={settings.language} onChange={(event) => update('language', event.target.value as AssistantSettings['language'])}>
            <option value="en">English</option><option value="es">Spanish</option><option value="fr">French</option>
            <option value="hi">Hindi</option><option value="de">German</option><option value="ja">Japanese</option>
          </select>
        </label>
        <label>
          <span>Response style</span>
          <select value={settings.responseStyle} onChange={(event) => update('responseStyle', event.target.value as AssistantSettings['responseStyle'])}>
            <option value="short">Short and conversational</option><option value="detailed">Detailed explanations</option>
          </select>
        </label>
        <label className="settings-wide">
          <span>Additional instructions</span>
          <textarea value={settings.customInstructions} maxLength={1000} rows={5} placeholder="For example: use beginner-friendly examples and explain technical terms." onChange={(event) => update('customInstructions', event.target.value)} />
          <small>Up to 1,000 characters. Do not include secrets; requests to reveal credentials or internal configuration are rejected.</small>
        </label>
        {error && <p className="private-error settings-wide" role="alert">{error}</p>}
        {message && <p className="private-success settings-wide" role="status">{message}</p>}
        <div className="settings-actions settings-wide">
          <button className="talk-button settings-save" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save preferences'}
          </button>
        </div>
      </form>
      <p className="private-note">Settings persist in the local SQLite database on this laptop across app restarts. They are per browser session identity and are not AI memory.</p>
    </section>
  )
}

export function HistoryView({
  conversations,
  selected,
  onSelect,
  onDelete,
  onClear,
  loading,
  error,
}: {
  conversations: ConversationSummary[]
  selected: ConversationDetail | null
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  onClear: () => void
  loading: boolean
  error: string
}) {
  return (
    <section className="private-card history-card" aria-labelledby="history-title">
      <div className="private-heading">
        <div><span className="private-eyebrow">YOUR LOCAL RECORDS</span><h2 id="history-title">Conversation history</h2></div>
        <button className="text-button" type="button" disabled={!conversations.length} onClick={onClear}>Clear all</button>
      </div>
      <p className="private-intro">Only final transcript segments actually received from LiveKit are saved. Microphone audio is never recorded here.</p>
      {error && <p className="private-error" role="alert">{error}</p>}
      <div className="history-layout">
        <aside className="history-list" aria-label="Previous conversations">
          {loading ? <p className="empty-state" role="status">Loading history…</p>
            : conversations.length === 0 ? <p className="empty-state">No conversations yet. Start a voice session; transcripts appear here when the agent publishes them.</p>
              : conversations.map((item) => (
                <button className={`history-item ${selected?.id === item.id ? 'history-item-selected' : ''}`} type="button" key={item.id} onClick={() => onSelect(item.id)}>
                  <strong>{item.title}</strong>
                  <span>{new Date(item.startedAt).toLocaleString()}</span>
                  <small>{item.status === 'completed' ? 'Completed' : 'Incomplete'} · {item.transcriptCount} transcript lines</small>
                </button>
              ))}
        </aside>
        <article className="history-detail">
          {!selected ? <p className="empty-state">Select a conversation to view its transcript.</p> : (
            <>
              <div className="detail-heading">
                <div><h3>{selected.title}</h3><p>{new Date(selected.startedAt).toLocaleString()} · {selected.status === 'completed' ? 'Completed' : 'Incomplete session'}</p></div>
                <button className="text-button danger-text" type="button" onClick={() => onDelete(selected.id)}>Delete</button>
              </div>
              {selected.transcript.length === 0
                ? <p className="empty-state">No transcript was published for this conversation. Audio is not stored.</p>
                : <div className="saved-transcript">{selected.transcript.map((line) => (
                  <div className={`saved-line ${line.speaker === 'You' ? 'saved-line-user' : ''}`} key={line.segmentId}>
                    <span>{line.speaker}<time>{new Date(line.createdAt).toLocaleTimeString()}</time></span>
                    <p>{line.text}</p>
                  </div>
                ))}</div>}
            </>
          )}
        </article>
      </div>
      <p className="private-note">History is stored locally on this laptop. It is separate per private session identity; no facts are remembered by the agent between conversations.</p>
    </section>
  )
}
