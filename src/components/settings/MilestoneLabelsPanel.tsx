interface MilestoneLabel {
  id: string; name: string; order?: number; hidden?: boolean;
}

interface Props {
  labels: MilestoneLabel[];
  onEdit: (index: number) => void;
  onAdd: () => void;
  onToggleVisibility: (id: string) => void;
}

export default function MilestoneLabelsPanel({ labels, onEdit, onAdd, onToggleVisibility }: Props) {
  return (
    <div className="st-panel">
      <div className="st-panel-head">
        <h3>Milestone Labels</h3>
        <button className="btn btn-sm btn-p" onClick={onAdd}>+ Add</button>
      </div>
      <div className="st-panel-body">
        {labels.map((l, i) => (
          <div key={l.id} className="st-li">
            <span style={{ fontSize: 15 }}>◆</span>
            <span className="st-li-name">{l.name}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <button className="btn btn-xs"
                style={!l.hidden
                  ? { background: '#dcfce7', color: '#16a34a', border: '1px solid #bbf7d0' }
                  : { background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca' }}
                onClick={() => onToggleVisibility(l.id)}
                title={!l.hidden ? 'Click to hide' : 'Click to show'}>
                {!l.hidden ? 'Visible' : 'Hidden'}
              </button>
              <button className="btn btn-xs" onClick={() => onEdit(i)}>Edit</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
