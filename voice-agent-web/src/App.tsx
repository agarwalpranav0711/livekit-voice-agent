import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type { Participant, Room as LiveKitRoom, TranscriptionSegment } from 'livekit-client'
import { defaultSettings } from './assistantDefaults'
import { HistoryView, SettingsForm } from './PrivateViews'
import type { AssistantSettings, ConversationDetail, ConversationSummary } from './PrivateViews'
import './App.css'

type ConnectionState = 'idle' | 'authorizing' | 'connecting' | 'connected' | 'error'
type TranscriptLine = { id: string; speaker: string; text: string; final: boolean }
type Page = 'voice' | 'settings' | 'history'
type TokenResponse = {
  serverUrl: string
  token: string
  roomName: string
  identity: string
  expiresInSeconds: number
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => null) as { error?: string } | null
  return payload?.error ?? fallback
}

function Icon({
  name,
  size = 20,
}: {
  name: 'wave' | 'mic' | 'micOff' | 'lock' | 'sound' | 'close' | 'arrow'
  size?: number
}) {
  const paths = {
    wave: <><path d="M2 10v4" /><path d="M6 6v12" /><path d="M10 3v18" /><path d="M14 7v10" /><path d="M18 5v14" /><path d="M22 10v4" /></>,
    mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v5" /><path d="M8 22h8" /></>,
    micOff: <><path d="M2 2l20 20" /><path d="M9 9v3a3 3 0 0 0 5.1 2.1" /><path d="M15 9V5a3 3 0 0 0-5.8-1" /><path d="M5 10a7 7 0 0 0 12 5" /><path d="M19 10a7 7 0 0 1-.5 2.6" /><path d="M12 17v5" /><path d="M8 22h8" /></>,
    lock: <><rect x="4" y="10" width="16" height="12" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /><path d="M12 15v2" /></>,
    sound: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a10 10 0 0 1 0 14" /></>,
    close: <><path d="m18 6-12 12" /><path d="m6 6 12 12" /></>,
    arrow: <><path d="M7 17 17 7" /><path d="M7 7h10v10" /></>,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  )
}

function App() {
  const [accessCode, setAccessCode] = useState('')
  const [page, setPage] = useState<Page>('voice')
  const [lockedPage, setLockedPage] = useState<Page | null>(null)
  const [settings, setSettings] = useState<AssistantSettings>(defaultSettings)
  const [settingsLoading, setSettingsLoading] = useState(false)
  const [settingsSaving, setSettingsSaving] = useState(false)
  const [settingsMessage, setSettingsMessage] = useState('')
  const [settingsError, setSettingsError] = useState('')
  const [history, setHistory] = useState<ConversationSummary[]>([])
  const [selectedConversation, setSelectedConversation] = useState<ConversationDetail | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [state, setState] = useState<ConnectionState>('idle')
  const [error, setError] = useState('')
  const [muted, setMuted] = useState(false)
  const [agentConnected, setAgentConnected] = useState(false)
  const [agentTimedOut, setAgentTimedOut] = useState(false)
  const [speakerNeedsGesture, setSpeakerNeedsGesture] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [activeSpeaker, setActiveSpeaker] = useState<'assistant' | 'you' | 'none'>('none')
  const [transcript, setTranscript] = useState<TranscriptLine[]>([])
  const [roomName, setRoomName] = useState('')
  const [transcriptSaveError, setTranscriptSaveError] = useState('')
  const [reducedMotion, setReducedMotion] = useState(false)
  const roomRef = useRef<LiveKitRoom | null>(null)
  const audioRootRef = useRef<HTMLDivElement>(null)
  const agentTimeoutRef = useRef<number | undefined>(undefined)
  const pageRequestRef = useRef(0)

  const loadSettings = async () => {
    setSettingsLoading(true)
    setSettingsError('')
    setSettingsMessage('')
    try {
      const response = await fetch('/api/settings')
      if (response.status === 401) {
        setLockedPage('settings')
        return
      }
      if (!response.ok) throw new Error(await responseError(response, 'Could not load settings.'))
      const payload = await response.json() as { settings: AssistantSettings }
      setSettings(payload.settings)
    } catch (loadError) {
      setSettingsError(loadError instanceof Error ? loadError.message : 'Could not load settings.')
    } finally {
      setSettingsLoading(false)
    }
  }

  const loadHistory = async () => {
    const requestId = ++pageRequestRef.current
    setHistoryLoading(true)
    setHistoryError('')
    try {
      const response = await fetch('/api/history')
      if (response.status === 401) {
        setLockedPage('history')
        return
      }
      if (!response.ok) throw new Error(await responseError(response, 'Could not load conversation history.'))
      const payload = await response.json() as { conversations: ConversationSummary[] }
      if (requestId === pageRequestRef.current) {
        setHistory(payload.conversations)
        setSelectedConversation(null)
      }
    } catch (loadError) {
      setHistoryError(loadError instanceof Error ? loadError.message : 'Could not load conversation history.')
    } finally {
      setHistoryLoading(false)
    }
  }

  const openPrivatePage = async (destination: 'settings' | 'history') => {
    setPage(destination)
    setLockedPage(null)
    if (destination === 'settings') await loadSettings()
    else await loadHistory()
  }

  const unlockPrivatePage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const destination = lockedPage
    if (!destination) return
    setError('')
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Could not unlock private settings and history.'))
      setAccessCode('')
      setLockedPage(null)
      if (destination === 'settings') await loadSettings()
      else await loadHistory()
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : 'Could not unlock private settings and history.')
    }
  }

  const saveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSettingsSaving(true)
    setSettingsError('')
    setSettingsMessage('')
    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      if (response.status === 401) {
        setLockedPage('settings')
        return
      }
      if (!response.ok) throw new Error(await responseError(response, 'Could not save settings.'))
      const payload = await response.json() as { settings: AssistantSettings }
      setSettings(payload.settings)
      setSettingsMessage('Saved. These preferences will be used for your next conversation.')
    } catch (saveError) {
      setSettingsError(saveError instanceof Error ? saveError.message : 'Could not save settings.')
    } finally {
      setSettingsSaving(false)
    }
  }

  const openConversation = async (conversationId: string) => {
    setHistoryError('')
    setSelectedConversation(null)
    try {
      const response = await fetch(`/api/history/${encodeURIComponent(conversationId)}`)
      if (response.status === 401) {
        setLockedPage('history')
        return
      }
      if (!response.ok) throw new Error(await responseError(response, 'Could not open that conversation.'))
      const payload = await response.json() as { conversation: ConversationDetail }
      setSelectedConversation(payload.conversation)
    } catch (loadError) {
      setHistoryError(loadError instanceof Error ? loadError.message : 'Could not open that conversation.')
    }
  }

  const deleteConversation = async (conversationId: string) => {
    if (!window.confirm('Delete this conversation and its saved transcript? This cannot be undone.')) return
    try {
      const response = await fetch(`/api/history/${encodeURIComponent(conversationId)}`, { method: 'DELETE' })
      if (!response.ok) throw new Error(await responseError(response, 'Could not delete conversation.'))
      setSelectedConversation(null)
      await loadHistory()
    } catch (deleteError) {
      setHistoryError(deleteError instanceof Error ? deleteError.message : 'Could not delete conversation.')
    }
  }

  const clearHistory = async () => {
    if (!window.confirm('Clear all of your saved conversations and transcripts? This cannot be undone.')) return
    try {
      const response = await fetch('/api/history', { method: 'DELETE' })
      if (!response.ok) throw new Error(await responseError(response, 'Could not clear history.'))
      setSelectedConversation(null)
      setHistory([])
      setHistoryError('')
    } catch (clearError) {
      setHistoryError(clearError instanceof Error ? clearError.message : 'Could not clear history.')
    }
  }

  useEffect(() => {
    const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updateMotionPreference = () => setReducedMotion(motionPreference.matches)
    updateMotionPreference()
    motionPreference.addEventListener('change', updateMotionPreference)

    return () => {
      motionPreference.removeEventListener('change', updateMotionPreference)
      window.clearTimeout(agentTimeoutRef.current)
      void roomRef.current?.disconnect()
    }
  }, [])

  const connect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setTranscript([])
    setAgentConnected(false)
    setAgentTimedOut(false)
    setSpeakerNeedsGesture(false)
    setAudioLevel(0)
    audioRootRef.current?.querySelectorAll('audio').forEach((element) => element.remove())

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setState('error')
      setError('Microphone access requires a secure browser connection (HTTPS or localhost).')
      return
    }

    setState('authorizing')

    try {
      const response = await fetch('/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode }),
      })

      if (!response.ok) {
        if (response.status === 401) throw new Error('That access code was not accepted.')
        if (response.status === 429) throw new Error('Too many connection attempts. Wait a few minutes and try again.')
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error ?? 'Could not prepare a secure LiveKit session.')
      }

      const credentials = await response.json() as TokenResponse
      setAccessCode('')
      setTranscriptSaveError('')
      setRoomName(credentials.roomName)
      setLockedPage(null)
      const { ParticipantKind, Room, RoomEvent, Track } = await import('livekit-client')
      const room = new Room({ adaptiveStream: true, dynacast: true })
      roomRef.current = room
      setState('connecting')

      room.on(RoomEvent.ParticipantConnected, (participant) => {
        if (participant.kind === ParticipantKind.AGENT) {
          setAgentConnected(true)
          setAgentTimedOut(false)
          window.clearTimeout(agentTimeoutRef.current)
        }
      })
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (participant.kind === ParticipantKind.AGENT) {
          setAgentConnected(false)
          setAgentTimedOut(true)
        }
      })
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const level = speakers.reduce((highest, participant) => Math.max(highest, participant.audioLevel), 0)
        setAudioLevel(Math.min(1, level))
        setActiveSpeaker(speakers.some((participant) => participant.kind === ParticipantKind.AGENT)
          ? 'assistant'
          : speakers.some((participant) => participant.identity === room.localParticipant.identity)
            ? 'you'
            : 'none')
      })
      room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
        if (track.kind !== Track.Kind.Audio || !audioRootRef.current) return
        const element = track.attach()
        element.autoplay = true
        element.setAttribute('playsinline', 'true')
        element.dataset.participant = participant.identity
        audioRootRef.current.appendChild(element)
        void element.play().catch(() => setSpeakerNeedsGesture(true))
      })
      room.on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((element) => element.remove())
      })
      room.on(RoomEvent.TranscriptionReceived, (segments: TranscriptionSegment[], participant?: Participant) => {
        const speaker = participant?.identity === room.localParticipant.identity
          ? 'You'
          : participant?.kind === ParticipantKind.AGENT
            ? 'Assistant'
            : 'Participant'

        setTranscript((current) => {
          const updated = [...current]
          for (const segment of segments) {
            const entry = { id: segment.id, speaker, text: segment.text, final: segment.final }
            const existing = updated.findIndex((line) => line.id === segment.id)
            if (existing === -1) updated.push(entry)
            else updated[existing] = entry
          }
          return updated.slice(-24)
        })
        const finalSegments = segments
          .filter((segment) => segment.final && segment.text.trim())
          .map((segment) => ({
            segmentId: segment.id,
            speaker,
            text: segment.text.trim(),
          }))
        if (finalSegments.length > 0) {
          void fetch(`/api/history/${encodeURIComponent(credentials.roomName)}/transcript`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segments: finalSegments }),
          }).then(async (saveResponse) => {
            if (!saveResponse.ok) throw new Error(await responseError(saveResponse, 'Could not save transcript entries.'))
          }).catch((persistError: unknown) => {
            setTranscriptSaveError(persistError instanceof Error ? persistError.message : 'Could not save transcript entries.')
          })
        }
      })
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current === room) {
          roomRef.current = null
          setState('error')
          setError('The LiveKit connection ended. Reconnect to start a new conversation.')
          setAgentConnected(false)
          setAudioLevel(0)
        }
      })

      await room.connect(credentials.serverUrl, credentials.token)
      setState('connected')
      setAgentConnected([...room.remoteParticipants.values()].some((participant) => participant.kind === ParticipantKind.AGENT))
      if (![...room.remoteParticipants.values()].some((participant) => participant.kind === ParticipantKind.AGENT)) {
        agentTimeoutRef.current = window.setTimeout(() => {
          if (roomRef.current === room && ![...room.remoteParticipants.values()].some((participant) => participant.kind === ParticipantKind.AGENT)) {
            setAgentTimedOut(true)
          }
        }, 20000)
      }

      try {
        await room.localParticipant.setMicrophoneEnabled(true)
        setMuted(false)
      } catch {
        await room.disconnect()
        throw new Error('Microphone permission was not granted. Allow microphone access in your browser and try again.')
      }
    } catch (connectionError) {
      await roomRef.current?.disconnect()
      roomRef.current = null
      setState('error')
      setError(connectionError instanceof Error ? connectionError.message : 'Could not connect. Please try again.')
    }
  }

  const disconnect = async () => {
    window.clearTimeout(agentTimeoutRef.current)
    const room = roomRef.current
    roomRef.current = null
    if (roomName) {
      try {
        const response = await fetch(`/api/history/${encodeURIComponent(roomName)}/finish`, { method: 'POST' })
        if (!response.ok) setTranscriptSaveError('The session ended, but its completion status could not be saved.')
      } catch {
        setTranscriptSaveError('The session ended, but its completion status could not be saved.')
      }
    }
    if (room) await room.disconnect()
    setState('idle')
    setMuted(false)
    setAgentConnected(false)
    setAgentTimedOut(false)
    setAudioLevel(0)
    setTranscript([])
    setRoomName('')
  }

  const toggleMicrophone = async () => {
    const room = roomRef.current
    if (!room) return

    try {
      const enabled = await room.localParticipant.setMicrophoneEnabled(muted)
      setMuted(!enabled)
      setError('')
    } catch {
      setError('Could not change the microphone state. Check your browser permissions.')
    }
  }

  const enableSpeaker = async () => {
    try {
      await roomRef.current?.startAudio()
      setSpeakerNeedsGesture(false)
    } catch {
      setError('Browser audio is still blocked. Check your device volume and site sound settings.')
    }
  }

  const isConnecting = state === 'authorizing' || state === 'connecting'
  const visualizerMode = state === 'connected' ? (audioLevel > 0.04 ? 'active' : 'ready') : 'idle'
  const bars = [0.34, 0.52, 0.72, 0.44, 0.86, 0.6, 0.38, 0.76, 0.48, 0.92, 0.54, 0.36, 0.78, 0.5, 0.68, 0.42, 0.88, 0.56, 0.32, 0.74, 0.46, 0.82, 0.58, 0.4, 0.7, 0.5, 0.9, 0.36, 0.64, 0.46, 0.78, 0.54, 0.34, 0.72, 0.44, 0.84]

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Aural home">
          <span className="brand-mark"><Icon name="wave" size={19} /></span>
          <span>aural<span className="brand-period">.</span></span>
        </a>
        <nav className="primary-nav" aria-label="Main navigation">
          <button className={page === 'voice' ? 'nav-active' : ''} type="button" onClick={() => { setPage('voice'); setLockedPage(null) }}>Voice</button>
          <button className={page === 'settings' ? 'nav-active' : ''} type="button" onClick={() => void openPrivatePage('settings')}>Settings</button>
          <button className={page === 'history' ? 'nav-active' : ''} type="button" onClick={() => void openPrivatePage('history')}>History</button>
        </nav>
        <div className="topbar-right">
          <span className="privacy-note"><Icon name="lock" size={14} /> Private session</span>
          <span className="topbar-divider" aria-hidden="true" />
          <span className="livekit-label"><span className="livekit-dot" /> LiveKit</span>
        </div>
      </header>

      <section className="hero" aria-labelledby="page-title">
        <div className="eyebrow"><span className="eyebrow-line" /> {page === 'voice' ? 'YOUR VOICE, YOUR ASSISTANT' : page === 'settings' ? 'PERSONALIZE YOUR ASSISTANT' : 'YOUR PRIVATE CONVERSATIONS'}</div>
        <h1 id="page-title">{page === 'voice' ? <>A little more human.<br /><span>A lot more helpful.</span></> : page === 'settings' ? <>Make it sound<br /><span>like your assistant.</span></> : <>Your conversations.<br /><span>Saved on this device.</span></>}</h1>
        <p className="hero-copy">{page === 'voice' ? 'A real-time conversation with your AI assistant. No typing, no waiting — just talk.' : page === 'settings' ? 'Choose how your assistant greets you and responds.' : 'Review actual transcript events from previous LiveKit sessions.'}</p>
      </section>

      {page === 'voice' && (
      <section className="assistant-card" aria-label="Voice assistant controls">
        <div className="card-topline">
          <div className="assistant-identity">
            <div className={`avatar ${state === 'connected' ? 'avatar-connected' : ''}`}>
              <Icon name="wave" size={22} />
            </div>
            <div>
              <div className="assistant-name">Your voice assistant</div>
              <div className="assistant-model">Technology · Programming · Everyday help</div>
            </div>
          </div>
          <div className={`connection-pill connection-${state}`}>
            <span className="status-indicator" />
            {state === 'connected' ? (agentConnected ? 'Assistant ready' : 'Room connected') :
              state === 'authorizing' ? 'Securing session' :
                state === 'connecting' ? 'Connecting' :
                  state === 'error' ? 'Needs attention' : 'Ready when you are'}
          </div>
        </div>

        <div className={`visualizer visualizer-${visualizerMode} ${state === 'connected' ? 'visualizer-connected' : ''}`} aria-label={audioLevel > 0.04 ? 'Audio activity detected' : 'Audio visualizer'} role="img">
          <div className="visualizer-halo" />
          <div className="visualizer-orb"><Icon name="wave" size={28} /></div>
          <div className="wave-bars" style={{ '--audio-level': audioLevel } as CSSProperties} aria-hidden="true">
            {bars.map((height, index) => (
              <span
                key={index}
                style={{
                  '--bar-height': `${height * 42}px`,
                  '--bar-delay': `${(index % 11) * -0.13}s`,
                  '--bar-index': index,
                  animationPlayState: reducedMotion ? 'paused' : undefined,
                } as CSSProperties}
              />
            ))}
          </div>
        </div>

        <div className="status-copy" aria-live="polite">
          <h2>{state === 'connected'
            ? (agentConnected
              ? activeSpeaker === 'assistant' ? 'Your assistant is speaking.' : activeSpeaker === 'you' ? 'I’m listening.' : 'I’m here.'
              : 'You’re in the room.')
            : state === 'authorizing'
              ? 'Preparing your private room…'
              : state === 'connecting'
                ? 'Finding your assistant…'
                : state === 'error'
                  ? 'Let’s try that again.'
                  : 'Ready for a real conversation?'}</h2>
          <p>{state === 'connected'
            ? (agentConnected
              ? (muted ? 'Your microphone is muted.' : activeSpeaker === 'assistant' ? 'Your assistant is speaking.' : activeSpeaker === 'you' ? 'Listening to your voice.' : 'Go ahead — I’m here.')
              : 'Waiting for the assistant to join this room.')
            : state === 'authorizing' || state === 'connecting'
              ? 'Connecting securely to your LiveKit session.'
              : state === 'error'
                ? error
                : 'Press the button and say hello. Your microphone stays off until you choose to connect.'}</p>
        </div>

        {state !== 'connected' ? (
          <form className="connect-form" onSubmit={connect}>
            <label className="access-code-label" htmlFor="access-code">Private access code</label>
            <div className="input-wrap">
              <Icon name="lock" size={18} />
              <input
                id="access-code"
                type="password"
                autoComplete="current-password"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                placeholder="Enter the code from your project setup"
                minLength={24}
                maxLength={256}
                required
                disabled={isConnecting}
                aria-describedby="access-help"
              />
            </div>
            <span id="access-help" className="field-help">Your code is checked by the private backend and is never saved in the browser.</span>
            <button className="talk-button" type="submit" disabled={isConnecting || accessCode.length < 24}>
              <span className="talk-button-icon">{isConnecting ? <span className="spinner" /> : <Icon name="mic" size={19} />}</span>
              {state === 'authorizing' ? 'Securing connection…' : state === 'connecting' ? 'Connecting…' : 'Start talking'}
              {!isConnecting && <span className="button-arrow"><Icon name="arrow" size={17} /></span>}
            </button>
          </form>
        ) : (
          <div className="active-controls">
            <button className={`control-button ${muted ? 'control-muted' : ''}`} type="button" onClick={toggleMicrophone} aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}>
              <Icon name={muted ? 'micOff' : 'mic'} size={19} />
              <span>{muted ? 'Unmute' : 'Mute'}</span>
            </button>
            {speakerNeedsGesture && (
              <button className="control-button" type="button" onClick={enableSpeaker}>
                <Icon name="sound" size={19} /><span>Enable sound</span>
              </button>
            )}
            <button className="end-button" type="button" onClick={() => void disconnect()}>
              <Icon name="close" size={18} /><span>End conversation</span>
            </button>
          </div>
        )}

        {agentTimedOut && state === 'connected' && (
          <div className="inline-alert" role="status">
            The room is connected, but no agent has joined yet. Check that your Python worker is online in the same LiveKit project, then reconnect.
          </div>
        )}

        {state === 'error' && error.includes('Microphone access requires') && (
          <div className="inline-alert" role="status">Use localhost for development or deploy the site over HTTPS.</div>
        )}

        {state === 'connected' && (
          <div className="session-meta"><span className="session-dot" /> Private room <code>{roomName}</code><span className="session-separator">·</span> Mic {muted ? 'muted' : 'on'}</div>
        )}

        {transcript.length > 0 && (
          <section className="transcript" aria-label="Conversation transcript" aria-live="polite">
            <div className="transcript-heading"><span>LIVE TRANSCRIPT</span><span className="transcript-live"><i /> LIVE</span></div>
            <div className="transcript-lines">
              {transcript.map((line) => (
                <p className={`transcript-line ${line.speaker === 'You' ? 'transcript-user' : ''}`} key={line.id}>
                  <span>{line.speaker}</span>{line.text}{!line.final && <i className="interim-cursor" />}
                </p>
              ))}
            </div>
          </section>
        )}
        {transcriptSaveError && <p className="inline-alert" role="status">{transcriptSaveError}</p>}

        <div className="card-footnote"><Icon name="lock" size={13} /> Your audio is sent directly through LiveKit to your configured agent.</div>
        <div ref={audioRootRef} className="remote-audio" aria-hidden="true" />
      </section>
      )}

      {page !== 'voice' && lockedPage === page && (
        <section className="private-card access-card" aria-labelledby="unlock-title">
          <span className="private-eyebrow">PRIVATE AREA</span>
          <h2 id="unlock-title">Enter your access code</h2>
          <p className="private-intro">Your settings and conversation history are protected by the same private access code as your voice sessions.</p>
          <form className="connect-form" onSubmit={unlockPrivatePage}>
            <label className="access-code-label" htmlFor="private-access-code">Private access code</label>
            <div className="input-wrap"><Icon name="lock" size={18} /><input id="private-access-code" type="password" autoComplete="current-password" value={accessCode} onChange={(event) => setAccessCode(event.target.value)} minLength={24} maxLength={256} required /></div>
            {error && <p className="private-error" role="alert">{error}</p>}
            <button className="talk-button settings-save" type="submit" disabled={accessCode.length < 24}>Unlock private area</button>
          </form>
        </section>
      )}

      {page === 'settings' && lockedPage !== 'settings' && (
        <SettingsForm settings={settings} onChange={setSettings} onSave={saveSettings} loading={settingsLoading} saving={settingsSaving} message={settingsMessage} error={settingsError} />
      )}

      {page === 'history' && lockedPage !== 'history' && (
        <HistoryView conversations={history} selected={selectedConversation} onSelect={(id) => void openConversation(id)} onDelete={(id) => void deleteConversation(id)} onClear={() => void clearHistory()} loading={historyLoading} error={historyError} />
      )}

      <section className="benefits" aria-label="About the voice assistant">
        <article className="benefit">
          <span className="benefit-number">01</span>
          <div><h3>Just your voice</h3><p>Speak naturally. Your browser asks before the microphone turns on.</p></div>
        </article>
        <article className="benefit">
          <span className="benefit-number">02</span>
          <div><h3>Connected to your agent</h3><p>Your existing Python agent joins a fresh, private LiveKit room.</p></div>
        </article>
        <article className="benefit">
          <span className="benefit-number">03</span>
          <div><h3>Built for conversation</h3><p>Live audio, an active microphone control, and a transcript when available.</p></div>
        </article>
      </section>

      <footer className="footer"><span>aural<span className="brand-period">.</span> &nbsp;·&nbsp; A voice interface for your LiveKit agent</span><span>Audio is processed by the LiveKit project and providers you configure.</span></footer>
    </main>
  )
}

export default App
