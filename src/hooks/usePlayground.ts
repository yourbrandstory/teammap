import { useState, useCallback, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { supabase } from '../lib/supabase';
import { uid } from '../lib/constants';
import useSpreadsheet from './useSpreadsheet';
import type { TabData } from '../utils/playgroundHelpers';

export default function usePlayground() {
  const S = useStore(s => s.S);
  const session = useStore(s => s.session);
  const upsertTask = useStore(s => s.upsertTask);

  const ownerId = session?.memberId;
  const [serverTabs, setServerTabs] = useState<TabData[]>([{ id: uid(), name: 'Sheet 1', data: {} }]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!ownerId || loaded) return;
    (async () => {
      try { await supabase.auth.getSession().catch(() => {}); } catch (e) {}

      const { data, error } = await supabase
        .from('pg_sheets')
        .select('data')
        .eq('owner_id', ownerId)
        .maybeSingle();

      if (!error && data?.data?.tabs) {
        setServerTabs(data.data.tabs);
        setLoaded(true);
        return;
      }

      const defaults = [{ id: uid(), name: 'Sheet 1', data: {} }];
      setServerTabs(defaults);
      await supabase.from('pg_sheets').upsert(
        { owner_id: ownerId, data: { tabs: defaults }, updated_at: new Date().toISOString() },
        { onConflict: 'owner_id' }
      ).then(({ error: e }) => {
        if (e) console.warn('[usePlayground] failed to persist defaults:', e.message);
      });
      setLoaded(true);
    })();
  }, [ownerId, loaded]);

  const persist = useCallback((tabs: TabData[]) => {
    setServerTabs(tabs);
    if (!ownerId) return;
    supabase.from('pg_sheets').upsert(
      { owner_id: ownerId, data: { tabs }, updated_at: new Date().toISOString() },
      { onConflict: 'owner_id' }
    ).then(({ error }) => {
      if (error) console.error('[usePlayground] persist error:', error);
    });
  }, [ownerId]);

  return useSpreadsheet({ initialTabs: serverTabs, persist, S, upsertTask });
}
