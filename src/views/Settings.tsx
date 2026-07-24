import { useState, useCallback, useRef } from 'react';
import { useStore, sel } from '../store/useStore';
import { COLORS, uid } from '../lib/constants';
import useSettings from '../hooks/useSettings';
import MembersPanel from '../components/settings/MembersPanel';
import ClientsPanel from '../components/settings/ClientsPanel';
import MoodsPanel from '../components/settings/MoodsPanel';
import MilestoneLabelsPanel from '../components/settings/MilestoneLabelsPanel';
import TagsPanel from '../components/settings/TagsPanel';
import FrequencyPanel from '../components/settings/FrequencyPanel';
import StatusPanel from '../components/settings/StatusPanel';
import NavigationPanel from '../components/settings/NavigationPanel';
import PreferencesPanel from '../components/settings/PreferencesPanel';
import MemberModal from '../components/modals/MemberModal';
import ClientModal from '../components/modals/ClientModal';
import MoodModal from '../components/modals/MoodModal';
import MilestoneLabelModal from '../components/modals/MilestoneLabelModal';
import TagModal from '../components/modals/TagModal';
import FrequencyModal from '../components/modals/FrequencyModal';
import StatusModal from '../components/modals/StatusModal';

export default function Settings() {
  const S = useStore(s => s.S);
  const upsertMember = useStore(s => s.upsertMember);
  const upsertClient = useStore(s => s.upsertClient);
  const setMoods = useStore(s => s.setMoods);
  const upsertTag = useStore(s => s.upsertTag);
  const upsertServiceCategory = useStore(s => s.upsertServiceCategory);
  const delServiceCategoryStore = useStore(s => s.delServiceCategory);
  const setStateKey = useStore(s => s.setStateKey);
  const setNavOrder = useStore(s => s.setNavOrder);
  const setNavLabels = useStore(s => s.setNavLabels);
  const importJSON = useStore(s => s.importJSON);

  const {
    stDrag, ftDragId, setStDrag, setFtDragId,
    delMember, delClient, toggleMoodVisibility,
    saveMilestoneLabel, toggleMilestoneLabelVisibility,
    delTag,
    addServiceCategory, saveServiceCategory, delServiceCategory,
    delFreqTag,
    addStatus, saveStatus, delStatus, reorderStatuses,
    reorderMembers, reorderClientsFn, reorderMoods, reorderTags, reorderServiceCategories,
    reorderFreqTags, reorderNav, renameNav,
    resetNav, updateSettings, exportJSON,
  } = useSettings();

  const [memberModal, setMemberModal] = useState<any | null>(null);
  const [clientModal, setClientModal] = useState<any | null>(null);
  const [moodModal, setMoodModal] = useState<{ index: number; mood?: any } | null>(null);
  const [msLabelModal, setMsLabelModal] = useState<{ index: number; label?: any } | null>(null);
  const [tagModal, setTagModal] = useState<any | null>(null);
  const [serviceCategoryModal, setServiceCategoryModal] = useState<any | null>(null);
  const [freqModal, setFreqModal] = useState<any | null>(null);
  const [statusModal, setStatusModal] = useState<any | null>(null);

  const navDragRef = useRef<string | null>(null);

  const handleStDragStart = useCallback((id: string, type: string) => {
    setStDrag({ id, type });
  }, [setStDrag]);

  const handleStDrop = useCallback((type: string, targetId: string) => {
    if (type === 'member') reorderMembers(targetId);
    else if (type === 'client') reorderClientsFn(targetId);
    else if (type === 'mood') reorderMoods(targetId);
    else if (type === 'tag') reorderTags(targetId);
    else if (type === 'serviceCategory') reorderServiceCategories(targetId);
    else if (type === 'status') reorderStatuses(targetId);
  }, [reorderMembers, reorderClientsFn, reorderMoods, reorderTags, reorderServiceCategories, reorderStatuses]);

  const handleNavDrop = useCallback((targetId: string) => {
    const dragId = navDragRef.current;
    if (!dragId || dragId === targetId) return;
    const order = [...(S.navOrder || [])];
    const fi = order.indexOf(dragId);
    const ti = order.indexOf(targetId);
    if (fi < 0 || ti < 0) return;
    const [dr] = order.splice(fi, 1);
    order.splice(ti, 0, dr);
    setNavOrder(order);
  }, [S.navOrder, setNavOrder]);

  const handleNavRename = useCallback(async (id: string, label: string) => {
    const labels = { ...(S.navLabels || {}), [id]: label.trim() || id };
    await setNavLabels(labels);
  }, [S.navLabels, setNavLabels]);

  return (
    <div className="view active" style={{ overflowY: 'auto' }}>
      <div style={{ fontSize: 22, fontWeight: 800, marginBottom: 16, letterSpacing: '-.8px', padding: '20px 20px 0' }}>
        Settings
      </div>
      <div className="st-grid">
        <MembersPanel
          members={S.members}
          onEdit={(m) => setMemberModal(m)}
          onDelete={delMember}
          onAdd={() => setMemberModal({ _new: true })}
          upsertMember={upsertMember}
        />

        <ClientsPanel
          clients={sel.scl(S)}
          stDrag={stDrag}
          onDragStart={handleStDragStart}
          onDragEnd={() => {}}
          onDrop={handleStDrop}
          onEdit={(c) => setClientModal(c)}
          onDelete={delClient}
          onAdd={() => setClientModal({ _new: true })}
        />

        <MoodsPanel
          moods={S.moods}
          stDrag={stDrag}
          onDragStart={handleStDragStart}
          onDragEnd={() => {}}
          onDrop={handleStDrop}
          onEdit={(i) => setMoodModal({ index: i, mood: S.moods[i] })}
          onAdd={() => setMoodModal({ index: -1 })}
          onToggleVisibility={toggleMoodVisibility}
        />

        <MilestoneLabelsPanel
          labels={S.milestoneLabels || []}
          onEdit={(i) => setMsLabelModal({ index: i, label: (S.milestoneLabels || [])[i] })}
          onAdd={() => setMsLabelModal({ index: -1 })}
          onToggleVisibility={toggleMilestoneLabelVisibility}
        />

        <TagsPanel
          tags={S.tags}
          stDrag={stDrag}
          onDragStart={handleStDragStart}
          onDragEnd={() => {}}
          onDrop={handleStDrop}
          onAdd={async (label) => {
            if (S.tags.find(t => t.label.toLowerCase() === label.toLowerCase())) return;
            await upsertTag({ label, color: COLORS[S.tags.length % COLORS.length] });
          }}
          onEdit={(tg) => setTagModal(tg)}
          onDelete={delTag}
        />

        <TagsPanel
          title="Service Categories"
          typeKey="serviceCategory"
          tags={S.serviceCategories}
          stDrag={stDrag}
          onDragStart={handleStDragStart}
          onDragEnd={() => {}}
          onDrop={handleStDrop}
          onAdd={addServiceCategory}
          onEdit={(sc) => setServiceCategoryModal(sc)}
          onDelete={delServiceCategory}
        />

        <FrequencyPanel
          freqTags={S.freqTags || []}
          ftDragId={ftDragId}
          onDragStart={setFtDragId}
          onDragEnd={() => {}}
          onDrop={reorderFreqTags}
          onAdd={async (label) => {
            const freqTags = S.freqTags || [];
            if (freqTags.find((f: any) => f.label.toLowerCase() === label.toLowerCase())) return;
            const updated = [...freqTags, { id: uid(), label, order: freqTags.length }];
            await setStateKey('freqTags', updated);
          }}
          onEdit={(f) => setFreqModal(f)}
          onDelete={delFreqTag}
        />

        <StatusPanel
          statuses={S.task_statuses || []}
          stDrag={stDrag}
          onDragStart={handleStDragStart}
          onDragEnd={() => {}}
          onDrop={handleStDrop}
          onAdd={addStatus}
          onEdit={(s) => setStatusModal(s)}
          onDelete={delStatus}
        />

        <NavigationPanel
          navOrder={S.navOrder || []}
          navLabels={S.navLabels || {}}
          navDragId={navDragRef.current}
          onDragStart={(id) => { navDragRef.current = id; }}
          onDragEnd={() => {}}
          onDrop={handleNavDrop}
          onRename={handleNavRename}
          onReset={resetNav}
        />

        <PreferencesPanel
          maxCap={S.settings.maxCap}
          weekends={!!S.settings.weekends}
          onUpdateSettings={updateSettings}
          onExport={exportJSON}
          onImport={importJSON}
        />
      </div>

      {memberModal && (
        <MemberModal
          member={memberModal._new ? null : memberModal}
          defaultCap={S.settings.maxCap}
          onSave={async (id, name, role, capacity, color) => {
            await upsertMember({ ...(id ? { id } : {}), name, role, capacity, color });
          }}
          onClose={() => setMemberModal(null)}
        />
      )}

      {clientModal && (
        <ClientModal
          client={clientModal._new ? null : clientModal}
          serviceCategories={S.serviceCategories}
          onSave={async (id, name, industry, color, serviceCategoryIds) => {
            if (id) {
              await upsertClient({ id, name, industry, serviceCategoryIds: serviceCategoryIds || [] });
            } else {
              await upsertClient({ name, industry, color, order: S.clients.length, serviceCategoryIds: serviceCategoryIds || [] });
            }
          }}
          onClose={() => setClientModal(null)}
        />
      )}

      {moodModal && (
        <MoodModal
          mood={moodModal.index >= 0 ? moodModal.mood : null}
          index={moodModal.index}
          onSave={async (idx, data) => {
            const moods = [...S.moods];
            if (idx >= 0 && idx < moods.length) {
              moods[idx] = { ...moods[idx], ...data };
            } else {
              moods.push({
                id: uid(), ...data,
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                bg: '#f2f0ec',
              });
            }
            await setMoods(moods);
          }}
          onClose={() => setMoodModal(null)}
        />
      )}

      {msLabelModal && (
        <MilestoneLabelModal
          label={msLabelModal.index >= 0 ? msLabelModal.label : null}
          index={msLabelModal.index}
          onSave={saveMilestoneLabel}
          onClose={() => setMsLabelModal(null)}
        />
      )}

      {tagModal && (
        <TagModal
          tag={tagModal}
          onSave={async (id, label) => {
            const existing = S.tags.find(t => t.id === id);
            if (existing) {
              await upsertTag({ id, label, color: existing.color });
            }
          }}
          onClose={() => setTagModal(null)}
        />
      )}

      {serviceCategoryModal && (
        <TagModal
          tag={serviceCategoryModal}
          onSave={async (id, label) => {
            const existing = S.serviceCategories.find((t: any) => t.id === id);
            if (existing) {
              await upsertServiceCategory({ id, label, color: existing.color });
            }
          }}
          onClose={() => setServiceCategoryModal(null)}
        />
      )}

      {freqModal && (
        <FrequencyModal
          freq={freqModal}
          onSave={async (id, label) => {
            const updated = (S.freqTags || []).map((f: any) =>
              f.id === id ? { ...f, label: label.trim() || f.label } : f
            );
            await setStateKey('freqTags', updated);
          }}
          onClose={() => setFreqModal(null)}
        />
      )}

      {statusModal && (
        <StatusModal
          status={statusModal}
          onSave={async (id, label) => {
            const updated = (S.task_statuses || []).map((s: any) =>
              s.id === id ? { ...s, label: label.trim() || s.label } : s
            );
            await setStateKey('task_statuses', updated);
          }}
          onClose={() => setStatusModal(null)}
        />
      )}
    </div>
  );
}
