const EMPTY_ANNOTATION_STATE = Object.freeze({
  assistantEnabled: false,
  annotations: Object.freeze([]),
  annotationDraft: null,
  annotationPointer: null,
  retryRevision: null,
  revisionPreview: null,
  feedback: '',
});

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/**
 * Return the editor state for a clean annotation-session exit.
 *
 * The function is intentionally pure: callers can apply the returned fields to
 * individual React setters without letting stale notes, retry jobs or previews
 * leak into the next annotation session.
 */
export function exitAnnotationSession(session = {}) {
  return {
    ...session,
    ...EMPTY_ANNOTATION_STATE,
    annotations: [],
  };
}

/**
 * Build the state transition used after a revision has completed.
 *
 * A completed revision becomes the editable working lesson immediately. The
 * candidate is cloned so that later edits cannot mutate a server response or a
 * retained history snapshot by reference.
 */
export function completeRevisionTransition(session = {}, candidateLesson) {
  if (!candidateLesson || typeof candidateLesson !== 'object' || Array.isArray(candidateLesson)) {
    throw new TypeError('candidateLesson must be a lesson object');
  }

  return {
    ...exitAnnotationSession(session),
    lesson: clone(candidateLesson),
    manualEditing: true,
    revising: false,
    revisionStage: 'completed',
    revisionElapsed: 0,
  };
}

/**
 * Select a history item for preview without changing the history collection or
 * producing a new current lesson.
 */
export function selectVersionPreview(history, index) {
  if (!Array.isArray(history) || !Number.isInteger(index) || index < 0 || index >= history.length) {
    return null;
  }

  return {
    index,
    preview: clone(history[index]),
  };
}

/**
 * Explicitly confirm a selected version as the next current lesson.
 *
 * Keeping this separate from selectVersionPreview prevents a list click from
 * silently replacing the active lesson or adding a history entry.
 */
export function confirmVersionRestore(selection) {
  if (!selection?.preview || typeof selection.preview !== 'object' || Array.isArray(selection.preview)) {
    return null;
  }

  return {
    currentLesson: clone(selection.preview),
    selectedIndex: null,
  };
}

