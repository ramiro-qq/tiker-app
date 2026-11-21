import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import './Select.css';

type Option = { value: string; label: string };
type Props = { label: string; value: string[]; options: Option[]; onChange: (value: string[]) => void };

export default function MultiSelect({ label, value, options, onChange }: Props) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.findIndex(option => option.value === (value[0] ?? ''));
  const show = () => { setActive(Math.max(0, selected)); setOpen(true); };
  const choose = (option: Option) => {
    onChange(!option.value ? [] : value.includes(option.value) ? value.filter(item => item !== option.value) : [...value, option.value]);
  };
  const selectedLabel = options[selected]?.label ?? label;

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, id]);

  return <div className="ui-select" ref={root} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <button type="button" className="ui-select-trigger" role="combobox" aria-label={label}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={id}
      aria-activedescendant={open ? `${id}-${active}` : undefined}
      onClick={() => open ? setOpen(false) : show()} onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!open) show();
          else setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
        } else if (open && (event.key === 'Home' || event.key === 'End')) {
          event.preventDefault(); setActive(event.key === 'Home' ? 0 : options.length - 1);
        } else if (open && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault(); if (options[active]) choose(options[active]);
        } else if (open && event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); setOpen(false);
        } else if (event.key === 'Tab') setOpen(false);
      }}>
      <span title={value.length ? value.map(item => options.find(option => option.value === item)?.label ?? item).join('、') : selectedLabel}>{selectedLabel}{value.length > 1 ? ` +${value.length - 1}` : ''}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div className="ui-select-options" id={id} role="listbox" aria-label={label} aria-multiselectable="true">
      {options.map((option, index) => <div key={option.value} id={`${id}-${index}`} role="option"
        aria-selected={option.value ? value.includes(option.value) : !value.length} className={`ui-select-option${active === index ? ' is-active' : ''}`}
        onMouseDown={event => event.preventDefault()} onMouseMove={() => setActive(index)} onClick={() => choose(option)}>
        <span>{option.label}</span><span className="ui-select-check" aria-hidden="true">{(option.value ? value.includes(option.value) : !value.length) && <Check size={14} />}</span>
      </div>)}
    </div>}
  </div>;
}
