export type {
  BackfillTaskData,
  CompletedDare,
  Dare,
  ReviewStatus,
  ScanUserResult,
  TrackPostResult,
  UntrackPostResult,
} from "./playbook/types.ts";
export {
  matchDareFromTitle,
  parsePlaybookDares,
  resolveDareFromTitleAndFlair,
} from "./playbook/dare-matching.ts";
export { getCompletedDares } from "./playbook/completion-store.ts";
export { fetchPlaybookDares } from "./playbook/wiki.ts";
export {
  getUserDares,
  handleTriggerPostFlairUpdate,
  removeCompletionForDeletedPost,
  reviewPlaybookDare,
  runBackfillChunk,
  scanUserDares,
  trackTriggerPostAndComment,
} from "./playbook/service.ts";
