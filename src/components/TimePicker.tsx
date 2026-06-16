import { WheelColumn } from './WheelColumn';

const ITEM = 38;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
// 1-minute steps so real booking times (e.g. 21:48) prefill and edit exactly.
const MINS = Array.from({ length: 60 }, (_, i) => i);
const pad = (v: number) => String(v).padStart(2, '0');

interface Props {
  edge: 'start' | 'end';
  /** total minutes since midnight for this edge */
  total: number;
  color: string;
  onChange: (total: number) => void;
}

/** A labeled hour:minute wheel picker for one edge of a booking. */
export function TimePicker({ edge, total, color, onChange }: Props) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return (
    <div style={{ flex: '1 1 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 }}>
      <span
        style={{
          fontSize: 11,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: '#878C91',
          fontWeight: 700,
        }}
      >
        {edge === 'start' ? 'Start' : 'Ende'}
      </span>
      <div style={{ position: 'relative', width: '100%', background: '#F3F4F4', border: '1px solid #E2E6E8' }}>
        {/* center selection band */}
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: 6,
            right: 6,
            height: ITEM,
            transform: 'translateY(-50%)',
            background: '#FEFFFF',
            borderTop: '1px solid ' + color,
            borderBottom: '1px solid ' + color,
            pointerEvents: 'none',
            zIndex: 0,
          }}
        />
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', padding: '0 4px' }}>
          <WheelColumn values={HOURS} value={h} fmt={pad} suffix="Std" onChange={(nh) => onChange(nh * 60 + m)} />
          <span style={{ fontSize: 22, fontWeight: 700, color, marginBottom: 2 }}>:</span>
          <WheelColumn values={MINS} value={m} fmt={pad} suffix="Min" onChange={(nm) => onChange(h * 60 + nm)} />
        </div>
      </div>
    </div>
  );
}
