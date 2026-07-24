import { useState } from 'react';
import Modal from '../Modal';

interface Props {
  label?: any | null;
  index: number;
  onSave: (index: number, data: any) => void;
  onClose: () => void;
}

export default function MilestoneLabelModal({ label, index, onSave, onClose }: Props) {
  const [name, setName] = useState(label?.name || '');

  const save = () => {
    if (!name.trim()) return;
    onSave(index, { name: name.trim() });
    onClose();
  };

  return (
    <Modal onClose={onClose}>
      <h2>{label ? 'Edit milestone label' : 'Add milestone label'}</h2>
      <label className="fl">Label name *</label>
      <input type="text" placeholder="e.g. Checklist" value={name}
        onChange={e => setName(e.target.value)} autoFocus />

      <div className="ma">
        <button className="btn btn-g" onClick={onClose}>Cancel</button>
        <button className="btn btn-p" onClick={save}>{label ? 'Save' : 'Add label'}</button>
      </div>
    </Modal>
  );
}
