import { fmtClock } from "../api/utils.js";

export function playActionLabel(item, { resumePosition = 0, seriesLabel = "Play next episode" } = {}) {
  if (item?.Type === "Series") return seriesLabel;
  if (item?.UserData?.Played) return "Watched";
  if (resumePosition > 30) return `Resume at ${fmtClock(resumePosition)}`;
  return "Play";
}

export function playbackExitPath(detailItem, activeItem) {
  if (activeItem?.Type !== "Episode" || !activeItem.Id || activeItem.Id === detailItem?.Id) return null;
  return `/item/${encodeURIComponent(activeItem.Id)}`;
}
