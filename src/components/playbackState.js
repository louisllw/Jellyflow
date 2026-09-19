import { fmtClock, ticksToSeconds } from "../api/utils.js";

export function playbackPosition(item, resumePosition) {
  if (Number.isFinite(resumePosition)) return resumePosition;
  return ticksToSeconds(item?.UserData?.PlaybackPositionTicks);
}

export function isPlaybackComplete(item, { resumePosition } = {}) {
  const position = playbackPosition(item, resumePosition);
  return Boolean(item?.UserData?.Played) && position <= 30;
}

export function playActionLabel(item, { resumePosition, seriesLabel = "Play next episode" } = {}) {
  if (item?.Type === "Series") return seriesLabel;
  const position = playbackPosition(item, resumePosition);
  // A current resume point wins over an old Played flag. This matters when a
  // viewer starts rewatching something Jellyfin still considers watched.
  if (position > 30) return `Resume at ${fmtClock(position)}`;
  if (isPlaybackComplete(item, { resumePosition: position })) return "Watched";
  return "Play";
}

export function playbackExitPath(detailItem, activeItem) {
  if (activeItem?.Type !== "Episode" || !activeItem.Id || activeItem.Id === detailItem?.Id) return null;
  return `/item/${encodeURIComponent(activeItem.Id)}`;
}
