import type { TG2AllMulti } from '../../utils/taskGen2Helpers';

interface ChipItem {
  id: string;
  label: string;
  color?: string;
  icon?: string;
}

interface Props {
  freqTags: any[];
  clients: any[];
  members: any[];
  moods: any[];
  multi: TG2AllMulti;
  onToggle: (key: keyof TG2AllMulti, id: string) => void;
  onSelect: (key: keyof TG2AllMulti, ids: string[]) => void;
  onClearAll: () => void;
  hasFilters: boolean;
}

function ChipRow({
  label, items, selectedIds, onToggle,
}: {
  label: string;
  items: ChipItem[];
  selectedIds: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="frequency-row" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', whiteSpace: 'nowrap' }}>{label}</span>
      {items.map(item => {
        const on = selectedIds.includes(item.id);
        return (
          <div
            key={item.id}
            onClick={() => onToggle(item.id)}
            style={{
              padding: '3px 10px', borderRadius: 20,
              border: `1.5px solid ${on ? item.color || 'var(--accent)' : 'var(--border)'}`,
              background: on ? (item.color || 'var(--accent)') + '18' : 'var(--s2)',
              color: on ? item.color || 'var(--accent)' : 'var(--t2)',
              fontSize: 12, fontWeight: on ? 700 : 500,
              cursor: 'pointer', whiteSpace: 'nowrap', transition: '.15s',
            }}
          >
            {item.icon ? item.icon + ' ' : ''}{item.label}
          </div>
        );
      })}
      {selectedIds.length ? (
        <button className="btn btn-xs" onClick={() => onToggle('__clear')}>&#10005;</button>
      ) : null}
    </div>
  );
}

function SelectFilter({
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="filter-select-group" style={{ display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
      <span className="filter-select-label" style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)' }}>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: '4px 8px', borderRadius: 6, border: '1.5px solid var(--border)',
          background: 'var(--s2)', color: 'var(--text)', fontSize: 12,
          cursor: 'pointer',
        }}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}

export default function FilterPanel({ freqTags, clients, members, moods, multi, onToggle, onSelect, onClearAll, hasFilters }: Props) {
  if (!freqTags.length && !clients.length && !members.length && !moods.length) return null;

  const clientVal = multi.clients.length ? multi.clients[0] : '';
  const memberVal = multi.members.length ? multi.members[0] : '';
  const moodVal = multi.moods.length ? multi.moods[0] : '';

  return (
    <div className="filter-panel" style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--surface)', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <ChipRow
          label="Frequency"
          items={freqTags.map((f: any) => ({ id: f.id, label: f.label, color: 'var(--accent)' }))}
          selectedIds={multi.freqs}
          onToggle={(id) => onToggle('freqs', id)}
        />
        <div className="filter-select-row">
          <SelectFilter
            label="Project"
            value={clientVal}
            onChange={(val) => onSelect('clients', val ? [val] : [])}
            options={[
              { value: '', label: 'All projects' },
              ...clients.map((c: any) => ({ value: c.id, label: c.name })),
            ]}
          />
          <SelectFilter
            label="Member"
            value={memberVal}
            onChange={(val) => onSelect('members', val ? [val] : [])}
            options={[
              { value: '', label: 'All members' },
              ...members.map((m: any) => ({ value: m.id, label: m.name })),
            ]}
          />
          <SelectFilter
            label="Mood"
            value={moodVal}
            onChange={(val) => onSelect('moods', val ? [val] : [])}
            options={[
              { value: '', label: 'All moods' },
              ...moods.map((m: any) => ({ value: m.id, label: m.icon ? m.icon + ' ' + m.label : m.label })),
            ]}
          />
        </div>
      </div>
      {hasFilters ? (
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-xs" onClick={onClearAll}>&#10005; Clear all</button>
        </div>
      ) : null}
    </div>
  );
}
