import { BallLegend } from '../physics/BallLegend';
import { type ComponentKind, type KindInfo, kinds, type NodeStatus, statusText } from './kinds';
import { SystemNode } from './SystemNode';

const statuses: NodeStatus[] = ['ok', 'warn', 'bad'];

/** Renders the visual language reference straight from `kinds`, so the page can never drift from the diagrams. */
export default function KindGallery() {
  const entries = Object.entries(kinds) as [ComponentKind, KindInfo][];
  return (
    <div className="not-content">
      <ul className="sdv-kinds">
        {entries.map(([kind, info]) => (
          <li key={kind}>
            <svg
              viewBox="0 0 160 84"
              role="img"
              aria-label={`${info.name}: ${info.shape.toLowerCase()}, ${info.color.toLowerCase()}`}
            >
              <SystemNode kind={kind} x={80} y={42} />
            </svg>
            <h3>{info.name}</h3>
            <p>{info.role}</p>
            <p>
              {info.shape}. {info.color}.
            </p>
          </li>
        ))}
      </ul>
      <h3>Health badges</h3>
      <ul className="sdv-kinds">
        {statuses.map((status) => (
          <li key={status}>
            <svg
              viewBox="0 0 160 84"
              role="img"
              aria-label={`Server marked ${statusText[status].toLowerCase()}`}
            >
              <SystemNode kind="server" x={80} y={42} status={status} />
            </svg>
            <h3>{statusText[status]}</h3>
            <p>{badgeText[status]}</p>
          </li>
        ))}
      </ul>
      <h3>Requests in physics scenes</h3>
      <BallLegend />
    </div>
  );
}

const badgeText: Record<NodeStatus, string> = {
  ok: 'A check mark badge. The component keeps up with its work.',
  warn: 'An exclamation mark badge. The component is busy and its queue grows.',
  bad: 'A cross badge and a dashed, faded outline. The component has stopped answering.',
};
