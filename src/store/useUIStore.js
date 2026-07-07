import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const STORAGE_KEY = 'teammap-ui-state-v1';

function debouncedLocalStorage(ms) {
  let timer = null;
  let pending = null;
  return {
    getItem: (name) => {
      try { return localStorage.getItem(name); } catch { return null; }
    },
    setItem: (name, value) => {
      pending = { name, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        try { localStorage.setItem(pending.name, pending.value); } catch {}
        pending = null;
        timer = null;
      }, ms);
    },
    removeItem: (name) => {
      if (timer) { clearTimeout(timer); timer = null; pending = null; }
      try { localStorage.removeItem(name); } catch {}
    },
  };
}

export const useUIStore = create(
  persist(
    (set, get) => ({
      view: 'tkd',

      openModal: null,

      viewStates: {},

      scrollPositions: {},

      toast: null,
      _toastTimer: null,

      pendingTemplateData: null,
      pendingEditTemplate: null,

      setToast: (msg, duration = 4000) => {
        const timer = get()._toastTimer;
        if (timer) clearTimeout(timer);
        set({ toast: msg, _toastTimer: setTimeout(() => set({ toast: null, _toastTimer: null }), duration) });
      },

      clearToast: () => {
        const timer = get()._toastTimer;
        if (timer) clearTimeout(timer);
        set({ toast: null, _toastTimer: null });
      },

      clearUIState: () => set({ view: 'tkd', openModal: null, viewStates: {}, scrollPositions: {} }),

      setView: (v) => set({ view: v }),

      setOpenModal: (modal) => set({ openModal: modal }),

      setPendingTemplateData: (data) => set({ pendingTemplateData: data }),

      triggerSaveAsTemplate: (data) => set({ pendingTemplateData: data, view: 'tg2' }),

      setPendingEditTemplate: (data) => set({ pendingEditTemplate: data }),

      triggerEditTemplate: (tmpl) => set({ pendingEditTemplate: tmpl, view: 'tg2' }),

      setViewState: (viewKey, patch) =>
        set((s) => ({
          viewStates: {
            ...s.viewStates,
            [viewKey]: { ...(s.viewStates[viewKey] || {}), ...patch },
          },
        })),

      setScrollPosition: (viewKey, pos) =>
        set((s) => ({
          scrollPositions: { ...s.scrollPositions, [viewKey]: pos },
        })),
    }),
    {
      name: STORAGE_KEY,
      storage: debouncedLocalStorage(300),
      partialize: (state) => ({
        view: state.view,
        openModal: state.openModal,
        viewStates: state.viewStates,
        scrollPositions: state.scrollPositions,
      }),
      merge: (persisted, current) => ({
        ...current,
        ...persisted,
        pendingTemplateData: null,
        pendingEditTemplate: null,
      }),
      version: 1,
    }
  )
);
