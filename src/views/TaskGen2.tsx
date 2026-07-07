import { useState, useEffect } from 'react';
import { useStore, sel } from '../store/useStore';
import { useUIStore } from '../store/useUIStore';

import useTaskGen2 from '../hooks/useTaskGen2';
import ProjectSidebar from '../components/taskgen2/ProjectSidebar';
import TemplateCard from '../components/taskgen2/TemplateCard';
import FrequencySelector from '../components/taskgen2/FrequencySelector';
import FilterPanel from '../components/taskgen2/FilterPanel';
import SavedViews from '../components/taskgen2/SavedViews';
import MilestoneLinks from '../components/taskgen2/MilestoneLinks';
import TaskModal from '../components/TaskModal';
import RichTextEditor from '../components/ui/RichTextEditor';
import Modal from '../components/Modal';
import type { Template } from '../utils/taskGen2Helpers';

export default function TaskGen2() {
  const S = useStore(s => s.S);
  const upsertClient = useStore(s => s.upsertClient);
  const upsertMilestone = useStore(s => s.upsertMilestone);

  const {
    freqTags, sortedClients, proj, milestones,
    tg2Tab, tg2SelProject,
    tg2AllMulti, tg2AllSort, tg2ActiveView,
    dragId, taskModal, createConfirm,
    sortedProjectTemplates, allFilteredTemplates,
    setTg2Tab, setTg2SelProject, setProjectSort, projectSortMode,
    openAddTemplate, openEditTemplate, saveTemplate, deleteTemplate,
    createTaskFromTemplate,
    handleToggleMulti, handleSetMulti, clearAllMulti,
    handleSaveView, handleLoadView, handleDeleteView, handleSetAllSort,
    toggleMSLink,
    setDragId, reorderProjects, setTaskModal, setCreateConfirm,
  } = useTaskGen2();

  const [saveViewModal, setSaveViewModal] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const hasAllFilters = tg2AllMulti.freqs.length || tg2AllMulti.clients.length ||
    tg2AllMulti.members.length || tg2AllMulti.moods.length;

  // —— Template modal form state ——
  const [tmplForm, setTmplForm] = useState<any>(null);

  const handleOpenAddTmpl = (clientId: string, freqId: string) => {
    setTmplForm({
      _mode: 'new',
      clientId,
      freqId,
      freqIds: [freqId],
      name: '',
      mood: 'rapid',
      assignedTo: [],
      estH: 0,
      estM: 0,
      notes: '',
      tags: [],
      subtasks: [],
      links: [],
    });
  };

  const handleOpenEditTmpl = (tmpl: Template) => {
    setTmplForm({
      _mode: 'edit',
      _id: tmpl.id,
      clientId: tmpl.clientId,
      freqId: tmpl.freqId || '',
      freqIds: tmpl.freqIds || (tmpl.freqId ? [tmpl.freqId] : []),
      name: tmpl.name,
      mood: tmpl.mood || 'rapid',
      assignedTo: [...(tmpl.assignedTo || [])],
      estH: tmpl.estH || 0,
      estM: tmpl.estM || 0,
      notes: tmpl.notes || '',
      tags: tmpl.tags ? [...tmpl.tags] : [],
      subtasks: tmpl.subtasks ? tmpl.subtasks.map((s: any) => ({ ...s })) : [],
      links: tmpl.links ? tmpl.links.map((l: any) => ({ ...l })) : [],
    });
  };

  const handleSaveTmplForm = async () => {
    if (!tmplForm.name.trim()) return;
    await saveTemplate(tmplForm);
    setTmplForm(null);
  };

  const handleDeleteTmpl = async (id: string) => {
    await deleteTemplate(id);
  };

  const handleSaveAsTemplate = (taskData: any) => {
    setTmplForm({
      _mode: 'new',
      clientId: taskData.clientId || '',
      freqId: '',
      freqIds: [],
      name: taskData.name || '',
      mood: taskData.mood || 'rapid',
      assignedTo: taskData.assignedTo ? [...taskData.assignedTo] : [],
      estH: taskData.estH || 0,
      estM: taskData.estM || 0,
      notes: taskData.notes || '',
      tags: taskData.tags ? [...taskData.tags] : [],
      subtasks: taskData.subtasks
        ? taskData.subtasks.map((s: any, i: number) => ({ text: s.text, completed: s.done ?? false, order: i }))
        : [],
      links: taskData.links
        ? taskData.links.map((l: any, i: number) => ({ title: l.label || l.title || '', url: l.url, order: i }))
        : [],
    });
  };

  const pendingTemplateData = useUIStore(s => s.pendingTemplateData);
  const setPendingTemplateData = useUIStore(s => s.setPendingTemplateData);
  const pendingEditTemplate = useUIStore(s => s.pendingEditTemplate);
  const setPendingEditTemplate = useUIStore(s => s.setPendingEditTemplate);

  useEffect(() => {
    if (pendingTemplateData) {
      handleSaveAsTemplate(pendingTemplateData);
      setPendingTemplateData(null);
    }
  }, [pendingTemplateData]);

  useEffect(() => {
    if (pendingEditTemplate) {
      handleOpenEditTmpl(pendingEditTemplate);
      setPendingEditTemplate(null);
    }
  }, [pendingEditTemplate]);

  const [tmplTDetailTab, setTmplTDetailTab] = useState('sub');
  const [tmplNewSubtask, setTmplNewSubtask] = useState('');
  const [tmplNewLinkLabel, setTmplNewLinkLabel] = useState('');
  const [tmplNewLinkUrl, setTmplNewLinkUrl] = useState('');

  const addTmplSubtask = () => {
    const text = tmplNewSubtask.trim();
    if (!text) return;
    setTmplForm((f: any) => ({
      ...f,
      subtasks: [...(f.subtasks || []), { text, completed: false, order: (f.subtasks || []).length }],
    }));
    setTmplNewSubtask('');
  };

  const toggleTmplSubtask = (i: number) => {
    setTmplForm((f: any) => ({
      ...f,
      subtasks: (f.subtasks || []).map((s: any, idx: number) =>
        idx === i ? { ...s, completed: !s.completed } : s
      ),
    }));
  };

  const editTmplSubtaskText = (i: number, text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setTmplForm((f: any) => ({
      ...f,
      subtasks: (f.subtasks || []).map((s: any, idx: number) =>
        idx === i ? { ...s, text: trimmed } : s
      ),
    }));
  };

  const delTmplSubtask = (i: number) => {
    setTmplForm((f: any) => ({
      ...f,
      subtasks: (f.subtasks || []).filter((_: any, idx: number) => idx !== i),
    }));
  };

  const moveTmplSubtask = (i: number, dir: number) => {
    setTmplForm((f: any) => {
      const arr = [...(f.subtasks || [])];
      const t = i + dir;
      if (t < 0 || t >= arr.length) return f;
      [arr[i], arr[t]] = [arr[t], arr[i]];
      return { ...f, subtasks: arr };
    });
  };

  const addTmplLink = () => {
    const url = tmplNewLinkUrl.trim();
    if (!url) return;
    const title = tmplNewLinkLabel.trim();
    setTmplForm((f: any) => ({
      ...f,
      links: [...(f.links || []), { title, url, order: (f.links || []).length }],
    }));
    setTmplNewLinkLabel('');
    setTmplNewLinkUrl('');
  };

  const delTmplLink = (i: number) => {
    setTmplForm((f: any) => ({
      ...f,
      links: (f.links || []).filter((_: any, idx: number) => idx !== i),
    }));
  };

  const moveTmplLink = (i: number, dir: number) => {
    setTmplForm((f: any) => {
      const arr = [...(f.links || [])];
      const t = i + dir;
      if (t < 0 || t >= arr.length) return f;
      [arr[i], arr[t]] = [arr[t], arr[i]];
      return { ...f, links: arr };
    });
  };

  const tmplFormClient = tmplForm ? (sel.gc(S, tmplForm.clientId) || sel.scl(S)[0]) : null;
  const tmplFormFreq = tmplForm ? (freqTags.find((f: any) => f.id === tmplForm.freqId)) : null;

  // Milestone modal state
  const [msModal, setMsModal] = useState<any>(null);

  // Tab switch
  const switchTab = (tab: string) => {
    setTg2Tab(tab);
    if (tab === 'ms' && !tg2SelProject && sortedClients.length) {
      setTg2SelProject(sortedClients[0].id);
    }
  };

  const sidebarContent = (tab: string) => {
    if (tab === 'templates') {
      return (
        <ProjectSidebar
          clients={sortedClients}
          templates={S.templates || []}
          selectedId={tg2SelProject}
          dragId={dragId}
          onSelect={(id) => { setTg2SelProject(id); setMobileSidebarOpen(false); }}
          onDragStart={(id) => setDragId(id)}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={(e) => { (e.target as HTMLElement).classList.remove('drag-over'); }}
          onDrop={(targetId) => { reorderProjects(targetId); }}
          onAddProject={() => {
            const c = window.confirm('Add project from Builder view');
            if (c) { /* Placeholder */ }
          }}
        />
      );
    }
    if (tab === 'ms') {
      return (
        <ProjectSidebar
          clients={sortedClients}
          templates={[]}
          selectedId={tg2SelProject}
          dragId={null}
          onSelect={(id) => setTg2SelProject(id)}
          onDragStart={() => {}}
          onDragEnd={() => {}}
          onDragOver={(e) => e.preventDefault()}
          onDragLeave={() => {}}
          onDrop={() => {}}
          onAddProject={() => {}}
        />
      );
    }
    return null;
  };

  return (
    <div className="tg2-app">
      <div className="tg2-subnav">
        <button className="tg2-mobile-sidebar-btn" onClick={() => setMobileSidebarOpen(o => !o)} aria-label="Toggle sidebar">
          &#9776;
        </button>
        <div className={`tg2-tab${tg2Tab === 'all' ? ' active' : ''}`} onClick={() => switchTab('all')}>
          &#9783; All Templates
        </div>
        <div className={`tg2-tab${tg2Tab === 'templates' ? ' active' : ''}`} onClick={() => switchTab('templates')}>
          &#128196; Project Templates
        </div>
        <div className={`tg2-tab${tg2Tab === 'ms' ? ' active' : ''}`} onClick={() => switchTab('ms')}>
          &#127937; Milestone Links
        </div>
      </div>

      <div className="tg2-body">
        {/* ── PROJECT TEMPLATES ── */}
        {tg2Tab === 'templates' && (
          <>
            <div className="tg2-left">{sidebarContent('templates')}</div>
            <div className="tg2-right">
              {proj ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: proj.color }} />
                    <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-.4px' }}>{proj.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--t3)' }}>{proj.industry}</span>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 11, color: 'var(--t3)' }}>Sort:</span>
                      <button
                        className={`btn btn-xs${projectSortMode === 'freq' ? ' btn-p' : ''}`}
                        onClick={() => setProjectSort('freq')}
                      >By frequency</button>
                      <button
                        className={`btn btn-xs${projectSortMode === 'name' ? ' btn-p' : ''}`}
                        onClick={() => setProjectSort('name')}
                      >A&ndash;Z</button>
                    </div>
                  </div>
                  <FrequencySelector
                    freqTags={freqTags}
                    clientId={proj.id}
                    onSelect={handleOpenAddTmpl}
                  />
                  {sortedProjectTemplates.length ? (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>
                        Templates ({sortedProjectTemplates.length})
                      </div>
                      {sortedProjectTemplates.map((t: Template) => (
                        <TemplateCard
                          key={t.id}
                          template={t}
                          S={S}
                          createConfirm={createConfirm}
                          onCreateTask={createTaskFromTemplate}
                          onEdit={handleOpenEditTmpl}
                          onDelete={handleDeleteTmpl}
                        />
                      ))}
                    </>
                  ) : (
                    <div style={{ fontSize: 13, color: 'var(--t3)', padding: '20px 0', textAlign: 'center', border: '1.5px dashed var(--border)', borderRadius: 'var(--r)' }}>
                      No templates yet &mdash; click a frequency tag above to create one
                    </div>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 10, color: 'var(--t3)' }}>
                  <div style={{ fontSize: 40 }}>&#128196;</div>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--t2)' }}>Select a project</p>
                  <p style={{ fontSize: 12 }}>Click any project on the left to set up task templates</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── ALL TEMPLATES ── */}
        {tg2Tab === 'all' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', flex: 1 }}>
            <SavedViews
              views={S.tg2Views || []}
              activeIndex={tg2ActiveView}
              onLoad={handleLoadView}
              onDelete={handleDeleteView}
            />
            <FilterPanel
              freqTags={freqTags}
              clients={sortedClients}
              members={S.members}
              moods={S.moods.filter((m: any) => !m.hidden)}
              multi={tg2AllMulti}
              onToggle={handleToggleMulti}
              onSelect={handleSetMulti}
              onClearAll={clearAllMulti}
              hasFilters={hasAllFilters}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--t2)' }}>{allFilteredTemplates.length} of {(S.templates || []).length} templates</span>
              {hasAllFilters ? <button className="btn btn-xs" onClick={clearAllMulti}>&#10005; Clear all</button> : null}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, color: 'var(--t3)' }}>Sort:</span>
                {['freq', 'client', 'mood', 'name'].map(s => (
                  <button
                    key={s}
                    className={`btn btn-xs${tg2AllSort === s ? ' btn-p' : ''}`}
                    onClick={() => handleSetAllSort(s)}
                  >
                    {s === 'freq' ? 'Frequency' : s === 'client' ? 'Project' : s === 'mood' ? 'Mood' : 'A\u2013Z'}
                  </button>
                ))}
                {hasAllFilters ? (
                  <button className="btn btn-sm btn-p" onClick={() => { setSaveViewName(''); setSaveViewModal(true); }}>
                    &#128190; Save view
                  </button>
                ) : null}
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {!allFilteredTemplates.length ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--t3)' }}>
                  <div style={{ fontSize: 36, marginBottom: 10 }}>&#128196;</div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t2)' }}>No templates match</div>
                  <p style={{ fontSize: 12, marginTop: 4 }}>Try clearing some filters</p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {allFilteredTemplates.map((t: Template) => (
                    <TemplateCard
                      key={t.id}
                      template={t}
                      S={S}
                      compact
                      createConfirm={createConfirm}
                      onCreateTask={createTaskFromTemplate}
                      onEdit={handleOpenEditTmpl}
                      onDelete={handleDeleteTmpl}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── MILESTONE LINKS ── */}
        {tg2Tab === 'ms' && (
          <>
            <div className="tg2-left">{sidebarContent('ms')}</div>
            <MilestoneLinks
              S={S}
              milestones={milestones}
              selectedProjectId={tg2SelProject}
              onToggleLink={toggleMSLink}
              onAddMilestone={async () => {
                setMsModal({ _mode: 'new', name: '', description: '', assignedTo: [] });
              }}
              onAddTask={(msId) => {
                const ms = milestones.find((m: any) => m.id === msId);
                if (ms) setTaskModal({ milestoneId: msId, name: '' });
              }}
              onEditMilestone={(msId) => {
                const ms = milestones.find((m: any) => m.id === msId);
                if (ms) setMsModal({ _mode: 'edit', _id: msId, ...ms });
              }}
            />
          </>
        )}
      </div>

      {/* Mobile sidebar drawer */}
      {mobileSidebarOpen && (
        <div className="tg2-mobile-drawer" onClick={() => setMobileSidebarOpen(false)}>
          <div className="tg2-mobile-drawer-content" onClick={e => e.stopPropagation()}>
            {sidebarContent(tg2Tab)}
          </div>
        </div>
      )}

      {/* ── Template form modal ── */}
      {tmplForm && (
        <Modal onClose={() => setTmplForm(null)} large>
          <h2>{tmplForm._mode === 'edit' ? 'Edit template' : 'New template'}</h2>
          {tmplFormClient ? (
            <div style={{ marginBottom: 12 }}>
              <span className="tmpl-freq-badge">{tmplFormFreq ? tmplFormFreq.label : 'Custom'}</span>
              &nbsp;<span style={{ fontSize: 12, color: 'var(--t3)' }}>for {tmplFormClient.name}</span>
            </div>
          ) : null}
          <label className="fl" style={{ marginTop: 0 }}>Template name *</label>
          <input type="text" placeholder="e.g. Weekly report, Campaign review\u2026"
            value={tmplForm.name} onChange={e => setTmplForm({ ...tmplForm, name: e.target.value })} autoFocus />

          <label className="fl">Mood</label>
          <div className="mood-pick-row horizontal-scroll">
            {S.moods.map((m: any) => {
              const on = tmplForm.mood === m.id;
              return (
                <div key={m.id} className={`mood-opt-btn${on ? ' on' : ''}`}
                  style={on ? { background: m.bg, color: m.color, borderColor: m.color, borderWidth: 2 } : {}}
                  onClick={() => setTmplForm({ ...tmplForm, mood: m.id })}>
                  {m.icon} {m.label}
                </div>
              );
            })}
          </div>

          <label className="fl">Default assign to</label>
          <div className="ttag-row horizontal-scroll">
            {S.members.map((m: any) => {
              const on = tmplForm.assignedTo.includes(m.id);
              return (
                <div key={m.id} className={`ttagopt${on ? ' on' : ''}`}
                  onClick={() => {
                    const next = on
                      ? tmplForm.assignedTo.filter((x: string) => x !== m.id)
                      : [...tmplForm.assignedTo, m.id];
                    setTmplForm({ ...tmplForm, assignedTo: next });
                  }}>
                  <span style={{ width: 16, height: 16, borderRadius: '50%', background: m.color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
                    {(m.name || '').split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                  {m.name}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginTop: 14 }}>
            <div>
              <label className="fl" style={{ marginTop: 0 }}>Est. time</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                <input type="number" placeholder="0" min="0" max="99" value={tmplForm.estH}
                  onChange={e => setTmplForm({ ...tmplForm, estH: parseInt(e.target.value) || 0 })}
                  style={{ width: 58 }} /> <span style={{ fontSize: 12, color: 'var(--t2)' }}>h</span>
                <input type="number" placeholder="0" min="0" max="59" value={tmplForm.estM}
                  onChange={e => setTmplForm({ ...tmplForm, estM: parseInt(e.target.value) || 0 })}
                  style={{ width: 58 }} /> <span style={{ fontSize: 12, color: 'var(--t2)' }}>m</span>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <label className="fl" style={{ marginTop: 0 }}>Notes / description</label>
              <RichTextEditor value={tmplForm.notes}
                onChange={v => setTmplForm({ ...tmplForm, notes: v })} />
            </div>
          </div>

          {/* ── Subtasks & Links tabs ── */}
          <div className="tdetail-tabs">
            <div className={`tdetail-tab${tmplTDetailTab === 'sub' ? ' active' : ''}`} onClick={() => setTmplTDetailTab('sub')}>
              ☑ Subtasks {(tmplForm.subtasks || []).length ? `(${(tmplForm.subtasks || []).filter((s: any) => s.completed).length}/${(tmplForm.subtasks || []).length})` : ''}
            </div>
            <div className={`tdetail-tab${tmplTDetailTab === 'links' ? ' active' : ''}`} onClick={() => setTmplTDetailTab('links')}>
              🔗 Links {(tmplForm.links || []).length ? `(${(tmplForm.links || []).length})` : ''}
            </div>
          </div>

          {/* ── Subtasks tab content ── */}
          <div className={`tdetail-tab-content${tmplTDetailTab === 'sub' ? ' active' : ''}`}>
            {(tmplForm.subtasks || []).length > 0 && (
              <div className="subtask-progress-mini">
                <div className="subtask-bar-track">
                  <div className="subtask-bar-fill" style={{ width: `${Math.round((tmplForm.subtasks || []).filter((s: any) => s.completed).length / (tmplForm.subtasks || []).length * 100)}%` }} />
                </div>
                <span style={{ fontSize: 11, color: 'var(--t2)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                  {(tmplForm.subtasks || []).filter((s: any) => s.completed).length}/{(tmplForm.subtasks || []).length}
                </span>
              </div>
            )}
            <div>
              {(tmplForm.subtasks || []).map((s: any, i: number) => (
                <div key={i} className={`subtask-row${s.completed ? ' done' : ''}`}>
                  <div className={`subtask-check${s.completed ? ' checked' : ''}`} onClick={() => toggleTmplSubtask(i)}>
                    {s.completed ? '✓' : ''}
                  </div>
                  <span className="subtask-text"
                    contentEditable suppressContentEditableWarning
                    onBlur={(e) => editTmplSubtaskText(i, e.currentTarget.textContent)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}>
                    {s.text}
                  </span>
                  <button className="subtask-del" onClick={() => delTmplSubtask(i)}>✕</button>
                </div>
              ))}
            </div>
            <div className="subtask-add-row">
              <input type="text" placeholder="Add a subtask + Enter" value={tmplNewSubtask}
                onChange={e => setTmplNewSubtask(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTmplSubtask(); } }}
                style={{ flex: 1, fontSize: 13 }} />
              <button className="btn btn-sm" onClick={addTmplSubtask}>+ Add</button>
            </div>
          </div>

          {/* ── Links tab content ── */}
          <div className={`tdetail-tab-content${tmplTDetailTab === 'links' ? ' active' : ''}`}>
            <div>
              {(tmplForm.links || []).map((l: any, i: number) => {
                let safeUrl = l.url;
                if (!/^https?:\/\//i.test(safeUrl)) safeUrl = 'https://' + safeUrl;
                return (
                  <div key={i} className="link-row">
                    <span style={{ flexShrink: 0 }}>🔗</span>
                    <a href={safeUrl} target="_blank" rel="noopener noreferrer">{l.title || l.url}</a>
                    <button className="link-del" onClick={() => delTmplLink(i)}>✕</button>
                  </div>
                );
              })}
            </div>
            <div className="link-add-row">
              <input type="text" placeholder="Label (optional)" value={tmplNewLinkLabel}
                onChange={e => setTmplNewLinkLabel(e.target.value)} style={{ width: 140, fontSize: 12 }} />
              <input type="text" placeholder="https://\u2026" value={tmplNewLinkUrl}
                onChange={e => setTmplNewLinkUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTmplLink(); } }}
                style={{ flex: 1, fontSize: 12 }} />
              <button className="btn btn-sm" onClick={addTmplLink}>+ Add</button>
            </div>
          </div>

          <label className="fl">Frequency tags (select all that apply)</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            {freqTags.map((f: any) => {
              const on = tmplForm.freqIds.includes(f.id);
              return (
                <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 20, border: '1.5px solid var(--border)', fontSize: 12, cursor: 'pointer', background: 'var(--s2)', transition: '.15s' }}>
                  <input type="checkbox" checked={on}
                    onChange={() => {
                      const next = on
                        ? tmplForm.freqIds.filter((x: string) => x !== f.id)
                        : [...tmplForm.freqIds, f.id];
                      setTmplForm({ ...tmplForm, freqIds: next });
                    }}
                    style={{ width: 13, height: 13, accentColor: 'var(--accent)' }} />
                  {f.label}
                </label>
              );
            })}
          </div>

          <div className="ma">
            {tmplForm._mode === 'edit' && (
              <button className="btn btn-d" onClick={async () => {
                await handleDeleteTmpl(tmplForm._id);
                setTmplForm(null);
              }}>Delete</button>
            )}
            <button className="btn btn-g" onClick={() => setTmplForm(null)}>Cancel</button>
            <button className="btn btn-p" onClick={handleSaveTmplForm}>Save template</button>
          </div>
        </Modal>
      )}

      {/* ── Save view modal ── */}
      {saveViewModal && (
        <Modal onClose={() => setSaveViewModal(false)}>
          <h2>Save view</h2>
          <label className="fl">View name</label>
          <input type="text" placeholder="e.g. Daily tasks for Parth"
            value={saveViewName} onChange={e => setSaveViewName(e.target.value)} autoFocus />
          <div className="ma">
            <button className="btn btn-g" onClick={() => setSaveViewModal(false)}>Cancel</button>
            <button className="btn btn-p" onClick={() => {
              if (saveViewName.trim()) {
                handleSaveView(saveViewName.trim());
                setSaveViewModal(false);
              }
            }}>Save</button>
          </div>
        </Modal>
      )}

      {/* ── Milestone modal ── */}
      {msModal && (
        <Modal onClose={() => setMsModal(null)}>
          <h2>{msModal._mode === 'edit' ? 'Edit Milestone' : 'New Milestone'}</h2>
          <label className="fl">Name *</label>
          <input type="text" placeholder="e.g. Q3 Campaign Launch"
            value={msModal.name} onChange={e => setMsModal({ ...msModal, name: e.target.value })} autoFocus />
          <label className="fl">Description</label>
          <textarea placeholder="What does this milestone represent?"
            value={msModal.description || ''} onChange={e => setMsModal({ ...msModal, description: e.target.value })} />
          <label className="fl">Assign to</label>
          <div className="ttag-row horizontal-scroll">
            {S.members.map((m: any) => {
              const on = (msModal.assignedTo || []).includes(m.id);
              return (
                <div key={m.id} className={`ttagopt${on ? ' on' : ''}`}
                  onClick={() => {
                    const next = on
                      ? (msModal.assignedTo || []).filter((x: string) => x !== m.id)
                      : [...(msModal.assignedTo || []), m.id];
                    setMsModal({ ...msModal, assignedTo: next });
                  }}>
                  {m.name}
                </div>
              );
            })}
          </div>
          <div className="ma">
            <button className="btn btn-g" onClick={() => setMsModal(null)}>Cancel</button>
            <button className="btn btn-p" onClick={async () => {
              if (!msModal.name.trim()) return;
              await upsertMilestone({
                ...(msModal._id ? { id: msModal._id } : {}),
                name: msModal.name.trim(),
                description: msModal.description || '',
                assignedTo: msModal.assignedTo || [],
                color: S.moods[0]?.color || '#7c3aed',
              });
              setMsModal(null);
            }}>{msModal._mode === 'edit' ? 'Save' : 'Create'}</button>
          </div>
        </Modal>
      )}

      {/* ── TaskModal (for creating tasks from "+ Add task" in milestone links) ── */}
      {taskModal && (
        <TaskModal
          task={taskModal}
          onClose={() => setTaskModal(null)}
          onSaveAsTemplate={handleSaveAsTemplate}
        />
      )}
    </div>
  );
}
