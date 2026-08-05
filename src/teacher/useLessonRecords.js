import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import {
  hydrateLessonRecord,
  lessonIdFromPath,
  lessonListFromResponse,
  lessonRecordFromResponse,
  lessonSummary,
  migrateLegacyLessonToServer,
} from '../lib/lessonRecords.js';
import { useAccount } from './components.jsx';

const migrationsInFlight = new Map();

async function listLessonsWithLegacyMigration(ownerRef) {
  let response = await api.getLessons();
  let records = lessonListFromResponse(response);
  if (records.length) return records;
  if (!migrationsInFlight.has(ownerRef)) {
    const migration = migrateLegacyLessonToServer(api, globalThis.localStorage, globalThis.sessionStorage, ownerRef)
      .finally(() => { migrationsInFlight.delete(ownerRef); });
    migrationsInFlight.set(ownerRef, migration);
  }
  const migrated = await migrationsInFlight.get(ownerRef);
  if (!migrated) return records;
  response = await api.getLessons();
  records = lessonListFromResponse(response);
  return records;
}

export function useLessonList() {
  const account = useAccount();
  const ownerRef = String(account?.id || account?.account || '');
  const [state, setState] = useState({ loading: true, error: '', records: [], lessons: [] });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      const records = await listLessonsWithLegacyMigration(ownerRef);
      setState({ loading: false, error: '', records, lessons: records.map(lessonSummary).filter((item) => item.id) });
    } catch (error) {
      setState({ loading: false, error: error.message || '教案列表暂时无法读取，请稍后重试。', records: [], lessons: [] });
    }
  }, [ownerRef]);

  useEffect(() => { void load(); }, [load]);
  return { ...state, reload: load };
}

export function useLessonRecord(path, { latestWhenMissing = true } = {}) {
  const account = useAccount();
  const ownerRef = String(account?.id || account?.account || '');
  const explicitId = lessonIdFromPath(path);
  const [state, setState] = useState({ loading: true, error: '', lesson: null, canonical: null, record: null, lessonId: explicitId });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try {
      let lessonId = explicitId;
      if (!lessonId && latestWhenMissing) {
        lessonId = String((await listLessonsWithLegacyMigration(ownerRef))[0]?.id || '');
      }
      if (!lessonId) {
        setState({ loading: false, error: '', lesson: null, canonical: null, record: null, lessonId: '' });
        return;
      }
      let response;
      try {
        response = await api.getLesson(lessonId);
      } catch (error) {
        if (Number(error.status || 0) !== 404 || !explicitId) throw error;
        const records = await listLessonsWithLegacyMigration(ownerRef);
        if (!records.some((item) => item.id === explicitId)) throw error;
        response = await api.getLesson(explicitId);
      }
      const record = lessonRecordFromResponse(response);
      const lesson = hydrateLessonRecord(record);
      if (!lesson) throw new Error('服务器返回的教案内容不完整。');
      setState({ loading: false, error: '', lesson, canonical: record.lessonPlan || record.lesson_plan || null, record, lessonId });
    } catch (error) {
      const missing = Number(error.status || 0) === 404;
      setState({
        loading: false,
        error: missing ? '这份教案不存在，或不属于当前账户。' : (error.message || '教案暂时无法读取，请稍后重试。'),
        lesson: null,
        canonical: null,
        record: null,
        lessonId: explicitId,
      });
    }
  }, [explicitId, latestWhenMissing, ownerRef]);

  useEffect(() => { void load(); }, [load]);
  return { ...state, reload: load };
}
