export interface TranscriptEvent {
  tick: number;
  text: string;
  marker: boolean;
}

/** Numbered markers for a TraceChart, matching the transcript's numbering. */
export function chartMarkers(events: TranscriptEvent[]) {
  return events
    .filter((event) => event.marker)
    .map((event, index) => ({ tick: event.tick, number: index + 1 }));
}

/** The "What happened" log under a trace chart. Wrap up notes follow the numbered list. */
export function RunTranscript({ events, tickSeconds }: { events: TranscriptEvent[]; tickSeconds: number }) {
  const markers = events.filter((event) => event.marker);
  const notes = events.filter((event) => !event.marker);
  return (
    <div className="sdv-trace__log">
      <p className="sdv-trace__log-title">What happened</p>
      {events.length === 0 && (
        <p className="sdv-trace__empty">Events appear here, numbered to match the chart, as the run plays.</p>
      )}
      {markers.length > 0 && (
        <ol>
          {markers.map((event, index) => (
            <li key={`${event.tick}-${event.text}`}>
              <span className="sdv-trace__num" aria-hidden="true">
                {index + 1}
              </span>
              <time>{(event.tick * tickSeconds).toFixed(1)} s</time> {event.text}
            </li>
          ))}
        </ol>
      )}
      {notes.map((event) => (
        <p key={`${event.tick}-${event.text}`} className="sdv-trace__note">
          {event.text}
        </p>
      ))}
    </div>
  );
}
