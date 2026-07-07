import { COLORS, uid } from '../lib/constants';

export function reorderArray<T>(arr: T[], fromId: string, toId: string, idKey: keyof T = 'id' as keyof T): T[] {
  const fi = arr.findIndex((x: any) => x[idKey] === fromId);
  const ti = arr.findIndex((x: any) => x[idKey] === toId);
  if (fi === -1 || ti === -1) return arr;
  const copy = [...arr];
  const [dr] = copy.splice(fi, 1);
  copy.splice(ti, 0, dr);
  return copy;
}

export function reorderClients(clients: any[], fromId: string, toId: string): any[] {
  const sorted = [...clients].sort((a, b) => (a.order || 0) - (b.order || 0));
  const fi = sorted.findIndex(c => c.id === fromId);
  const ti = sorted.findIndex(c => c.id === toId);
  if (fi === -1 || ti === -1) return clients;
  const copy = [...sorted];
  const [dr] = copy.splice(fi, 1);
  copy.splice(ti, 0, dr);
  return copy.map((c, i) => ({ ...c, order: i }));
}

export function randomColor(): string {
  return COLORS[Math.floor(Math.random() * COLORS.length)];
}

export function makeMood(label: string, icon: string, desc: string, max: number | null): any {
  return {
    id: uid(), label, icon: icon || '📌', desc: desc || '',
    max, cardSize: 'narrow', visible: true,
    color: randomColor(), bg: '#f2f0ec',
  };
}

export const NAV_ICONS: Record<string, string> = {
  tkd: '📊', tg2: '🔄', lu: '📋', lv: '☷',
  tk: '☰', td: '▣', bl: '◯', pg: '◢', st: '⚙',
};

export const DEFAULT_NAV_ORDER = ['tkd', 'tg2', 'lu', 'lv', 'tk', 'td', 'bl', 'pg', 'st'];
export const DEFAULT_NAV_LABELS: Record<string, string> = {
  tkd: 'Task Dashboard', tg2: 'Routines', lu: 'Line Up', lv: 'List View',
  tk: 'Tasks & Milestones', td: 'Team Dashboard', bl: 'Builder', pg: 'Playground', st: 'Settings',
};
