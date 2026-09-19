import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../state/Session.jsx";
import { ErrorBox, Loading } from "../components/Cards.jsx";
import { Player } from "../components/Player.jsx";
import { IconClock, IconHeart, IconPlay } from "../components/Icons.jsx";

const HOUR = 60 * 60 * 1000;

function asDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function time(value) {
  const date = asDate(value);
  return date ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
}

function dateTime(value) {
  const date = asDate(value);
  return date
    ? date.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";
}

function duration(program) {
  const start = asDate(program.StartDate);
  const end = asDate(program.EndDate);
  if (!start || !end) return "";
  const mins = Math.max(1, Math.round((end - start) / 60000));
  return `${mins} min`;
}

function isAiring(program) {
  const now = Date.now();
  const start = asDate(program.StartDate)?.getTime();
  const end = asDate(program.EndDate)?.getTime();
  return Boolean(start && end && start <= now && now < end);
}

export function LiveTv() {
  const { client } = useSession();
  const [tab, setTab] = useState("guide");
  const [channels, setChannels] = useState(undefined);
  const [programs, setPrograms] = useState(undefined);
  const [recordings, setRecordings] = useState(undefined);
  const [selected, setSelected] = useState(null);
  const [playing, setPlaying] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    const now = new Date();
    Promise.all([
      client.liveTvChannels({ limit: 250 }),
      client.liveTvPrograms({
        MinEndDate: now.toISOString(),
        MaxStartDate: new Date(now.getTime() + 6 * HOUR).toISOString(),
        limit: 1000,
      }),
      client.liveTvRecordings({ limit: 200 }),
    ])
      .then(([channelResult, programResult, recordingResult]) => {
        if (!alive) return;
        setChannels(channelResult?.Items || []);
        setPrograms(programResult?.Items || []);
        setRecordings(recordingResult?.Items || []);
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [client, tick]);

  const byChannel = useMemo(() => {
    const map = new Map();
    for (const program of programs || []) {
      const list = map.get(program.ChannelId) || [];
      list.push(program);
      map.set(program.ChannelId, list);
    }
    for (const list of map.values()) list.sort((a, b) => new Date(a.StartDate) - new Date(b.StartDate));
    return map;
  }, [programs]);

  const favoriteChannels = (channels || []).filter((channel) => channel.UserData?.IsFavorite);

  const toggleFavorite = async (channel) => {
    const next = !channel.UserData?.IsFavorite;
    setBusy(`favorite-${channel.Id}`);
    try {
      await client.setFavorite(channel.Id, next);
      setChannels((current) =>
        current.map((item) =>
          item.Id === channel.Id
            ? { ...item, UserData: { ...(item.UserData || {}), IsFavorite: next } }
            : item,
        ),
      );
      setNotice(next ? `${channel.Name} added to favourites` : `${channel.Name} removed from favourites`);
    } catch (e) {
      setNotice(e.message || "The favourite could not be changed.");
    } finally {
      setBusy("");
    }
  };

  const changeRecording = async (program, series) => {
    const timerId = series ? program.SeriesTimerId : program.TimerId;
    const key = `${series ? "series" : "program"}-${program.Id}`;
    setBusy(key);
    try {
      if (timerId) await client.cancelRecording(timerId, { series });
      else await client.recordProgram(program.Id, { series });
      setNotice(timerId ? "Recording cancelled" : series ? "Series recording scheduled" : "Recording scheduled");
      setSelected(null);
      setTick((value) => value + 1);
    } catch (e) {
      setNotice(e.message || "The recording could not be changed.");
    } finally {
      setBusy("");
    }
  };

  if (error && !channels) return <ErrorBox error={error} onRetry={() => setTick((value) => value + 1)} />;
  if (!channels || !programs || !recordings) return <Loading label="Tuning the guide" />;

  const visibleChannels = tab === "favorites" ? favoriteChannels : channels;

  return (
    <>
      <header className="page-heading live-heading reveal">
        <div className="page-eyebrow">Live from your server</div>
        <div className="page-title-row">
          <h1>Live TV</h1>
          <span>{channels.length} channels</span>
        </div>
      </header>

      <div className="live-tabs" role="tablist" aria-label="Live TV sections">
        <button className={tab === "guide" ? "on" : ""} onClick={() => setTab("guide")}>Guide</button>
        <button className={tab === "favorites" ? "on" : ""} onClick={() => setTab("favorites")}>
          Favourites <span>{favoriteChannels.length}</span>
        </button>
        <button className={tab === "recordings" ? "on" : ""} onClick={() => setTab("recordings")}>
          Recordings <span>{recordings.length}</span>
        </button>
      </div>

      {notice && (
        <button className="live-notice" onClick={() => setNotice("")} aria-label="Dismiss message">
          {notice}
        </button>
      )}

      {tab === "recordings" ? (
        recordings.length ? (
          <div className="recording-grid">
            {recordings.map((recording) => (
              <Link className="recording-card" to={`/item/${recording.Id}`} key={recording.Id}>
                <div className="recording-art">
                  {recording.ImageTags?.Primary ? (
                    <img src={client.image(recording, "Primary", { w: 560, h: 315 })} alt="" loading="lazy" />
                  ) : (
                    <span className="recording-fallback">{recording.Name?.slice(0, 1) || "TV"}</span>
                  )}
                  <span className="recording-status">Recorded</span>
                </div>
                <strong>{recording.Name}</strong>
                <span>{recording.SeriesName || dateTime(recording.DateCreated)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="live-empty"><b>No recordings yet</b>Schedule something from the guide and it will appear here.</div>
        )
      ) : visibleChannels.length ? (
        <div className="guide">
          <div className="guide-time"><span>Channel</span><b>Now and next</b><span>Next six hours</span></div>
          {visibleChannels.map((channel) => {
            const schedule = byChannel.get(channel.Id) || (channel.CurrentProgram ? [channel.CurrentProgram] : []);
            return (
              <section className="guide-row" key={channel.Id}>
                <div className="guide-channel">
                  <button className="guide-channel-play" onClick={() => setPlaying(channel)} aria-label={`Play ${channel.Name}`}>
                    {channel.ImageTags?.Primary ? (
                      <img src={client.image(channel, "Primary", { w: 160, h: 90 })} alt="" />
                    ) : (
                      <span>{channel.Number || channel.Name.slice(0, 2)}</span>
                    )}
                    <i><IconPlay size={14} /></i>
                  </button>
                  <div><strong>{channel.Name}</strong>{channel.Number && <span>Channel {channel.Number}</span>}</div>
                  <button
                    className={`favorite-button ${channel.UserData?.IsFavorite ? "on" : ""}`}
                    onClick={() => toggleFavorite(channel)}
                    disabled={busy === `favorite-${channel.Id}`}
                    aria-label={`${channel.UserData?.IsFavorite ? "Remove" : "Add"} ${channel.Name} ${channel.UserData?.IsFavorite ? "from" : "to"} favourites`}
                  >
                    <IconHeart size={17} />
                  </button>
                </div>
                <div className="guide-programs">
                  {schedule.length ? schedule.map((program) => (
                    <button
                      key={program.Id}
                      className={`guide-program ${isAiring(program) ? "airing" : ""} ${program.TimerId || program.SeriesTimerId ? "scheduled" : ""}`}
                      onClick={() => setSelected(program)}
                    >
                      <span className="guide-program-time">{time(program.StartDate)}–{time(program.EndDate)}</span>
                      <strong>{program.Name}</strong>
                      {program.EpisodeTitle && <span>{program.EpisodeTitle}</span>}
                      {(program.TimerId || program.SeriesTimerId) && <i>Recording set</i>}
                    </button>
                  )) : <div className="guide-no-data">No guide information</div>}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <div className="live-empty"><b>No favourite channels yet</b>Use the heart beside a channel in the guide to keep it here.</div>
      )}

      {selected && (
        <div className="program-dialog-backdrop" role="presentation" onMouseDown={() => setSelected(null)}>
          <section className="program-dialog" role="dialog" aria-modal="true" aria-labelledby="program-title" onMouseDown={(e) => e.stopPropagation()}>
            <button className="program-close" onClick={() => setSelected(null)} aria-label="Close">×</button>
            <div className="page-eyebrow">{selected.ChannelName || "Programme details"}</div>
            <h2 id="program-title">{selected.Name}</h2>
            {selected.EpisodeTitle && <h3>{selected.EpisodeTitle}</h3>}
            <div className="program-when"><IconClock size={16} /> {dateTime(selected.StartDate)} · {duration(selected)}</div>
            {selected.Overview && <p>{selected.Overview}</p>}
            <div className="program-actions">
              <button className="btn btn-primary" onClick={() => changeRecording(selected, false)} disabled={busy === `program-${selected.Id}`}>
                <span className="record-dot" /> {selected.TimerId ? "Cancel recording" : "Record programme"}
              </button>
              {selected.IsSeries && (
                <button className="btn" onClick={() => changeRecording(selected, true)} disabled={busy === `series-${selected.Id}`}>
                  {selected.SeriesTimerId ? "Cancel series recording" : "Record series"}
                </button>
              )}
            </div>
          </section>
        </div>
      )}

      {playing && <Player item={playing} client={client} onClose={() => setPlaying(null)} initialPosition={0} />}
    </>
  );
}
