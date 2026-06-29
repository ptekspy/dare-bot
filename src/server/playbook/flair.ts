import {
  COMMUNITY_DARE_FLAIR,
  PLAYBOOK_FLAIR,
} from "./config.ts";

export function isPlaybookFlair(flair: string | undefined): boolean {
  return (flair ?? "").toLowerCase().includes(PLAYBOOK_FLAIR);
}

export function isCommunityDareFlair(flair: string | undefined): boolean {
  return (flair ?? "").toLowerCase().includes(COMMUNITY_DARE_FLAIR);
}

export function isTrackedDareFlair(flair: string | undefined): boolean {
  return isPlaybookFlair(flair) || isCommunityDareFlair(flair);
}
