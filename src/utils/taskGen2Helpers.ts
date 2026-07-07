
export interface TemplateSubtask {
  text: string;
  completed: boolean;
  order: number;
}

export interface TemplateLink {
  title: string;
  url: string;
  order: number;
}

export interface Template {
  id: string;
  clientId: string;
  name: string;
  freqId?: string;
  freqIds?: string[];
  mood: string;
  assignedTo: string[];
  estH: number;
  estM: number;
  notes: string;
  tags?: string[];
  subtasks?: TemplateSubtask[];
  links?: TemplateLink[];
  createdAt: number;
  updatedAt: number;
}

export interface FreqTag {
  id: string;
  label: string;
  order: number;
}

export interface TG2View {
  name: string;
  filters: { freqs: string[]; clients: string[]; members: string[]; moods: string[] };
  sort: string;
}

export interface TG2AllMulti {
  freqs: string[];
  clients: string[];
  members: string[];
  moods: string[];
}

export function filterTemplatesAll(
  templates: Template[],
  multi: TG2AllMulti,
  sort: string,
  freqTags: FreqTag[],
  clients: any[],
  moods: any[],
): Template[] {
  let result = [...templates];
  if (multi.freqs.length) result = result.filter(t => (t.freqIds || [t.freqId]).some((f: string) => multi.freqs.includes(f)));
  if (multi.clients.length) result = result.filter(t => multi.clients.includes(t.clientId));
  if (multi.members.length) result = result.filter(t => (t.assignedTo || []).some((m: string) => multi.members.includes(m)));
  if (multi.moods.length) result = result.filter(t => multi.moods.includes(t.mood));

  if (sort === 'freq') {
    const fo = freqTags.map(f => f.id);
    result.sort((a, b) => {
      const ai = fo.indexOf((a.freqIds || [a.freqId || ''])[0]);
      const bi = fo.indexOf((b.freqIds || [b.freqId || ''])[0]);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  } else if (sort === 'client') {
    result.sort((a, b) => {
      const ca = clients.find(c => c.id === a.clientId);
      const cb = clients.find(c => c.id === b.clientId);
      return (ca ? ca.name : '').localeCompare(cb ? cb.name : '');
    });
  } else if (sort === 'name') {
    result.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sort === 'mood') {
    const moodOrder = moods.map(m => m.id);
    result.sort((a, b) => moodOrder.indexOf(a.mood) - moodOrder.indexOf(b.mood));
  }
  return result;
}

export function toggleMulti(arr: string[], id: string): string[] {
  if (id === '__clear') return [];
  const idx = arr.indexOf(id);
  if (idx >= 0) return arr.filter(x => x !== id);
  return [...arr, id];
}

export function saveView(views: TG2View[], name: string, filters: TG2AllMulti, sort: string): TG2View[] {
  return [...views, { name, filters: JSON.parse(JSON.stringify(filters)), sort }];
}

export function loadView(view: TG2View): { filters: TG2AllMulti; sort: string } {
  return {
    filters: JSON.parse(JSON.stringify(view.filters)),
    sort: view.sort || 'freq',
  };
}

export function deleteView(views: TG2View[], i: number): TG2View[] {
  return views.filter((_, idx) => idx !== i);
}

export function reorderItems<T extends { id: string }>(items: T[], dragId: string, targetId: string): T[] {
  const di = items.findIndex(x => x.id === dragId);
  const ti = items.findIndex(x => x.id === targetId);
  if (di === -1 || ti === -1) return items;
  const copy = [...items];
  const [dr] = copy.splice(di, 1);
  copy.splice(ti, 0, dr);
  return copy;
}

export function getDayFreqTagIds(freqTags: FreqTag[]): string[] {
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const todayName = dayNames[new Date().getDay()];
  return freqTags
    .filter(ft => {
      const label = ft.label.toLowerCase();
      return label === 'daily' || label === todayName;
    })
    .map(ft => ft.id);
}

export function sortTemplatesByFreq(templates: Template[], freqTags: FreqTag[]): Template[] {
  const fo = freqTags.map(f => f.id);
  return [...templates].sort((a, b) => {
    const ai = fo.indexOf(a.freqId || '');
    const bi = fo.indexOf(b.freqId || '');
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });
}

export function getTemplateFormData(existing?: Template): any {
  if (existing) {
    return {
      name: existing.name,
      clientId: existing.clientId,
      freqIds: existing.freqIds || (existing.freqId ? [existing.freqId] : []),
      mood: existing.mood || 'rapid',
      assignedTo: [...(existing.assignedTo || [])],
      estH: existing.estH || 0,
      estM: existing.estM || 0,
      notes: existing.notes || '',
      tags: existing.tags ? [...existing.tags] : [],
      subtasks: existing.subtasks ? existing.subtasks.map(s => ({ ...s })) : [],
      links: existing.links ? existing.links.map(l => ({ ...l })) : [],
    };
  }
  return {
    name: '',
    clientId: '',
    freqIds: [],
    mood: 'rapid',
    assignedTo: [],
    estH: 0,
    estM: 0,
    notes: '',
    tags: [],
    subtasks: [],
    links: [],
  };
}
