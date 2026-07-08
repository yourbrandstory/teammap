import { useState } from 'react';

function isHtml(str) {
  if (!str || typeof str !== 'string') return false;
  return /<[a-z][\s\S]*>/i.test(str);
}

export default function NotesField({ value, onChange }) {
  const [editing, setEditing] = useState(false);
  const html = isHtml(value);

  if (!html || editing) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <label className="fl" style={{ margin: 0, flex: 1 }}>Notes</label>
          {html && (
            <button className="btn btn-xs" onClick={() => setEditing(false)} style={{ color: 'var(--accent)' }}>
              Preview
            </button>
          )}
        </div>
        <textarea placeholder="Add any notes about this task…" value={value}
          onChange={e => onChange(e.target.value)}
          style={{ width: '100%', minHeight: 60, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit',
            border: '1.5px solid var(--border)', borderRadius: 'var(--r)', outline: 'none',
            background: 'var(--surface)', color: 'var(--text)', resize: 'vertical', lineHeight: 1.5 }}
          onFocus={e => e.target.style.borderColor = 'var(--accent)'}
          onBlur={e => e.target.style.borderColor = 'var(--border)'} />
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <label className="fl" style={{ margin: 0, flex: 1 }}>Notes</label>
        <button className="btn btn-xs" onClick={() => setEditing(true)} style={{ color: 'var(--accent)' }}>
          Edit
        </button>
      </div>
      <div
        className="notes-render"
        style={{
          width: '100%', minHeight: 60, padding: '9px 12px', fontSize: 13, fontFamily: 'inherit',
          border: '1.5px solid var(--border)', borderRadius: 'var(--r)',
          background: 'var(--surface)', color: 'var(--text)', lineHeight: 1.6, cursor: 'pointer',
        }}
        onClick={() => setEditing(true)}
        dangerouslySetInnerHTML={{ __html: value }}
      />
    </div>
  );
}
