import { useState } from 'react';
import { getStatusMaps, getReviewStatus } from '../../utils/statusUtils';
import { useStore, sel } from '../../store/useStore';
import type { LVFilters, LVSort } from '../../utils/listViewHelpers';

interface Props {
  S: any;
  lvSort: LVSort;
  lvFilters: LVFilters;
  activeCount: number;
  totalCount: number;
  onSetFilter: (key: string, value: string) => void;
  onClearFilters: () => void;
  onToggleHideCompleted: () => void;
  onSetSort: (col: string, dir: 'asc' | 'desc') => void;
  onNewTask: () => void;
}

const SORT_OPTIONS = [
  { label: 'Date ↓', col: 'date', dir: 'desc' },
  { label: 'Date ↑', col: 'date', dir: 'asc' },
  { label: 'Name A–Z', col: 'name', dir: 'asc' },
  { label: 'Name Z–A', col: 'name', dir: 'desc' },
  { label: 'Mood', col: 'mood', dir: 'asc' },
  { label: 'Status', col: 'status', dir: 'asc' },
  { label: 'Client', col: 'client', dir: 'asc' },
];

export default function ListToolbar({
  S, lvSort, lvFilters, activeCount, totalCount,
  onSetFilter, onClearFilters, onToggleHideCompleted, onSetSort, onNewTask,
}: Props) {
  const session = useStore(s => s.session);
  const isManager = session?.role === 'admin' || session?.role === 'manager';
  const sortedClients = sel.scl(S);
  const { STATS } = getStatusMaps(S.task_statuses);
  const reviewLabel = getReviewStatus(S.task_statuses);

  return (
    <div className="lv-toolbar">
      <span className="stl" style={{ whiteSpace: 'nowrap' }}>&#9783; Tasks</span>
      <span style={{ fontSize: 11, color: 'var(--t2)', whiteSpace: 'nowrap', flexShrink: 0 }}>
        {activeCount}/{totalCount}
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--t3)' }}>Search</span>
        <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Search tasks..."
            value={lvFilters.search}
            onChange={e => onSetFilter('search', e.target.value)}
            style={{ width: 140, padding: '3px 20px 3px 6px', fontSize: 12, borderRadius: 4, border: '1px solid var(--border)', outline: 'none' }}
          />
          {lvFilters.search && (
            <span
              onClick={() => onSetFilter('search', '')}
              style={{ position: 'absolute', right: 4, cursor: 'pointer', fontSize: 14, lineHeight: 1, color: 'var(--t3)', userSelect: 'none' }}
            >
              &times;
            </span>
          )}
        </div>
      </div>

      <FilterSelect label="Date Range" value={lvFilters.dateRange} onChange={v => onSetFilter('dateRange', v)}>
        <option value="all">All Tasks</option>
        <option value="today">Today</option>
        <option value="last3">Last 3 Days</option>
        <option value="last7">Last 7 Days</option>
        <option value="last30">Last 30 Days</option>
        <option value="older30">Older Than 30 Days</option>
      </FilterSelect>

      <FilterSelect label="Member" value={lvFilters.member} onChange={v => onSetFilter('member', v)}>
        <option value="">All members</option>
        {S.members.map((m: any) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </FilterSelect>

      <FilterSelect label="Client" value={lvFilters.client} onChange={v => onSetFilter('client', v)}>
        <option value="">All clients</option>
        {sortedClients.map((c: any) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </FilterSelect>

      <FilterSelect label="Mood" value={lvFilters.mood} onChange={v => onSetFilter('mood', v)}>
        <option value="">All moods</option>
        {S.moods.filter((m: any) => !m.hidden).map((m: any) => (
          <option key={m.id} value={m.id}>{m.icon} {m.label}</option>
        ))}
      </FilterSelect>

      <FilterSelect label="Status" value={lvFilters.status} onChange={v => onSetFilter('status', v)}>
        <option value="">All statuses</option>
        {STATS.map((s: string) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </FilterSelect>

      {isManager && (
        <button
          className={`btn btn-xs${lvFilters.status === reviewLabel ? ' btn-p' : ''}`}
          onClick={() => onSetFilter('status', lvFilters.status === reviewLabel ? '' : reviewLabel)}
          style={{ flexShrink: 0 }}
        >
          Review
        </button>
      )}

      <FilterSelect label="Tag" value={lvFilters.tag} onChange={v => onSetFilter('tag', v)}>
        <option value="">All tags</option>
        {(S.tags || []).map((t: any) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </FilterSelect>

      <FilterSelect label="Sort" value={`${lvSort.col}:${lvSort.dir}`} onChange={v => { const [col, dir] = v.split(':'); onSetSort(col, dir as 'asc' | 'desc'); }}>
        {SORT_OPTIONS.map(o => (
          <option key={`${o.col}:${o.dir}`} value={`${o.col}:${o.dir}`}>{o.label}</option>
        ))}
      </FilterSelect>

      <button className="btn btn-sm" style={{ flexShrink: 0 }} onClick={onClearFilters}>
        &#10005; Clear
      </button>

      <button
        className="btn btn-sm"
        style={{
          flexShrink: 0,
          background: lvFilters.hideCompleted ? 'var(--al)' : '',
          color: lvFilters.hideCompleted ? 'var(--accent)' : 'var(--t2)',
          borderColor: lvFilters.hideCompleted ? 'var(--accent)' : 'var(--border)',
        }}
        onClick={onToggleHideCompleted}
      >
        {lvFilters.hideCompleted ? '\u2713 Hiding' : 'Show'} completed
      </button>

      <button className="btn btn-sm btn-p" style={{ flexShrink: 0, marginLeft: 'auto' }} onClick={onNewTask}>
        + New task
      </button>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
    }}>
      <span style={{ fontSize: 11, color: 'var(--t3)' }}>{label}</span>
      <select className="fsel" value={value} onChange={e => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}
