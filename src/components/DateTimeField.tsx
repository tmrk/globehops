import { useRef, useState } from 'react';

export interface DateTimeFieldProps {
  kind: 'date' | 'time';
  label: string;
  /** The native control's value: the entered value, else the suggestion it would start from. */
  value: string;
  display: string;
  placeholder: string;
  estimated?: boolean;
  attention?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * A native date/time input under a formatted face. Pointer users see "Fri 20 Nov 2026" and get the
 * platform picker on tap (wheels on iOS, calendar/clock elsewhere); keyboard users get the native
 * segmented editor, made visible while it has keyboard focus.
 */
export function DateTimeField({
  kind,
  label,
  value,
  display,
  placeholder,
  estimated = false,
  attention = false,
  disabled = false,
  onChange,
}: DateTimeFieldProps) {
  const pointer = useRef(false);
  const [typing, setTyping] = useState(false);
  const open = (input: HTMLInputElement) => {
    try {
      input.showPicker?.();
    } catch {
      /* Not allowed here (e.g. already open); the input still has focus for typing. */
    }
  };
  return (
    <span
      className={`dt-field dt-field--${kind}${estimated ? ' is-estimated' : ''}${attention ? ' needs-value' : ''}${
        typing ? ' is-typing' : ''
      }${display ? '' : ' is-empty'}`}
      onPointerDown={() => (pointer.current = true)}
    >
      <span className="dt-field__face" aria-hidden="true">
        {display ? (
          <>
            {estimated && <span className="dt-field__approx">≈</span>}
            {display}
          </>
        ) : (
          placeholder
        )}
      </span>
      <input
        type={kind}
        aria-label={label}
        aria-description={estimated ? 'estimated' : undefined}
        min={kind === 'date' ? '1900-01-01' : undefined}
        max={kind === 'date' ? '2100-12-31' : undefined}
        value={value}
        disabled={disabled}
        onFocus={() => setTyping(!pointer.current)}
        onBlur={() => {
          pointer.current = false;
          setTyping(false);
        }}
        onClick={(e) => open(e.currentTarget)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            open(e.currentTarget);
          }
        }}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  );
}
