(function () {
  "use strict";

  const ARCHIVE_SCHEMA_VERSION = 4;
  const DB_NAME = "tv-time-capsule";
  const DB_STORE = "archives";
  const REMEMBERED_KEY = "remembered";
  const TMDB_KEY_STORAGE = "tv-time-capsule-tmdb-key";
  const MOVIE_REFRESH_BATCH_SIZE = 12;
  const SEARCH_DEBOUNCE_MS = 120;
  const REACTION_LABELS = {
    1: "Touched",
    2: "Confused",
    3: "Sad",
    6: "Amused",
    7: "Bored",
    8: "Frustrated",
    28: "Shocked",
    29: "Frustrated",
    30: "Sad",
    31: "Reflective",
    32: "Touched",
    33: "Amused",
    34: "Scared",
    35: "Bored",
    36: "Understood",
    37: "Thrilled",
    38: "Confused",
    39: "Tense"
  };
  const REACTION_EMOJIS = {
    Shocked: "😵",
    Frustrated: "😤",
    Sad: "😭",
    Reflective: "🤔",
    Touched: "🥺",
    Amused: "😆",
    Scared: "😱",
    Bored: "😑",
    Understood: "☺️",
    Thrilled: "🤩",
    Confused: "🙃",
    Tense: "😬"
  };
  const RATING_LABELS = {
    3: "Wow",
    27: "Good",
    29: "Meh"
  };
  const STATS_METADATA_BATCH_SIZE = 18;
  const TMDB_GENRES = {
    12: "Adventure",
    14: "Fantasy",
    16: "Animation",
    18: "Drama",
    27: "Horror",
    28: "Action",
    35: "Comedy",
    36: "History",
    37: "Western",
    53: "Thriller",
    80: "Crime",
    99: "Documentary",
    878: "Science Fiction",
    9648: "Mystery",
    10402: "Music",
    10749: "Romance",
    10751: "Family",
    10752: "War",
    10759: "Action & Adventure",
    10762: "Kids",
    10763: "News",
    10764: "Reality",
    10765: "Sci-Fi & Fantasy",
    10766: "Soap",
    10767: "Talk",
    10768: "War & Politics",
    10770: "TV Movie"
  };

  const SAFE_IMPORT_FILES = new Set([
    "tracking-prod-records.csv",
    "tracking-prod-records-v2.csv",
    "followed_tv_show.csv",
    "user_tv_show_data.csv",
    "user_statistics.csv",
    "user_badge.csv",
    "user_tv_show_data.csv",
    "show_seen_episode_latest.csv",
    "seen_episode_latest.csv",
    "seen_episode_source.csv",
    "show_addiction_score.csv",
    "user_show_special_status.csv",
    "episode_comment.csv",
    "show_comment.csv",
    "comments-prod-comments.csv",
    "emotions-3-prod-episode_votes.csv",
    "emotions-live-votes.csv",
    "episode_emotion.csv",
    "tv_show_user_emotion_count.csv",
    "ratings-3-prod-episode_votes.csv",
    "ratings-live-votes.csv",
    "ratings-prod-episode_votes.csv",
    "ratings-v2-prod-votes.csv",
    "show_character_episode_vote.csv",
    "stats-prod-cache.csv",
    "tracking-prod-count-by-timeframe.csv"
  ]);

  const SENSITIVE_FILES = new Set([
    "access_token.csv",
    "refresh_token.csv",
    "auth-prod-login.csv",
    "ip_address.csv",
    "ad_identifier.csv",
    "device_token.csv",
    "device_data.csv",
    "user_device.csv",
    "user_session.csv",
    "user_agent.csv",
    "user.csv",
    "user_personal_data.csv",
    "user_facebook_data.csv",
    "user_social_data.csv",
    "_appsflyer_ids.csv",
    "webhook_data.csv",
    "install_tracking.csv",
    "installed_app.csv"
  ]);

  const state = {
    archive: null,
    route: "dashboard",
    query: "",
    dashboardKind: "shows",
    dashboardLetter: "all",
    historyMode: "watched",
    historyKind: "all",
    historyRange: "all",
    historyStart: "",
    historyEnd: "",
    statsKind: "shows",
    statsRefreshInProgress: false,
    selectedHistoryTitle: "",
    settingsConfirmDelete: false,
    refreshInProgress: false,
    dialogReturnFocus: null,
    searchTimer: null
  };

  const els = {
    emptyState: document.getElementById("emptyState"),
    statusPanel: document.getElementById("statusPanel"),
    statusTitle: document.getElementById("statusTitle"),
    statusText: document.getElementById("statusText"),
    statusProgress: document.getElementById("statusProgress"),
    appView: document.getElementById("appView"),
    toolbar: document.querySelector("#appView .toolbar"),
    archiveTitle: document.getElementById("archiveTitle"),
    zipInput: document.getElementById("zipInput"),
    searchInput: document.getElementById("searchInput"),
    exportHelpButton: document.getElementById("exportHelpButton"),
    exportHelpDialog: document.getElementById("exportHelpDialog"),
    loadRememberedButton: document.getElementById("loadRememberedButton"),
    historyDialog: document.getElementById("historyDialog"),
    historyDialogContent: document.getElementById("historyDialogContent"),
    views: {
      dashboard: document.getElementById("dashboardView"),
      stats: document.getElementById("statsView"),
      history: document.getElementById("historyView"),
      settings: document.getElementById("settingsView")
    }
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    els.zipInput.addEventListener("change", handleZipInput);
    els.searchInput.addEventListener("input", function (event) {
      clearTimeout(state.searchTimer);
      const value = event.target.value.trim().toLowerCase();
      state.searchTimer = setTimeout(function () {
        state.query = value;
        resetVisibleCounts();
        render();
      }, SEARCH_DEBOUNCE_MS);
    });
    els.loadRememberedButton.addEventListener("click", loadRememberedArchive);
    els.exportHelpButton.addEventListener("click", openExportHelpDialog);
    els.exportHelpDialog.addEventListener("click", function (event) {
      if (event.target === els.exportHelpDialog) closeExportHelpDialog();
    });
    els.exportHelpDialog.querySelector("[data-close-export-help]").addEventListener("click", closeExportHelpDialog);
    els.historyDialog.addEventListener("click", function (event) {
      if (event.target === els.historyDialog) closeHistoryDialog();
    });
    els.historyDialog.addEventListener("close", restoreDialogFocus);
    els.exportHelpDialog.addEventListener("close", restoreDialogFocus);
    els.appView.addEventListener("click", handleAppClick);
    els.appView.addEventListener("change", handleAppChange);
    els.historyDialogContent.addEventListener("click", handleHistoryDialogClick);
    els.historyDialogContent.addEventListener("keydown", handleHistoryDialogKeydown);
    document.querySelectorAll("[data-route]").forEach(function (node) {
      node.addEventListener("click", function (event) {
        event.preventDefault();
        setRoute(node.dataset.route);
      });
    });
    hasRememberedArchive().then(function (hasArchive) {
      els.loadRememberedButton.hidden = !hasArchive;
      if (hasArchive) loadRememberedArchive();
    });
  }

  function resetVisibleCounts() {
  }

  function handleAppClick(event) {
    const button = event.target.closest("button");
    if (!button || !els.appView.contains(button)) return;

    if (button.dataset.dashboardKind) {
      state.dashboardKind = button.dataset.dashboardKind;
      state.dashboardLetter = "all";
      renderDashboard();
      return;
    }
    if (button.dataset.dashboardLetter) {
      state.dashboardLetter = button.dataset.dashboardLetter;
      renderDashboard();
      return;
    }
    if (button.id === "refreshPostersButton") {
      refreshPosterMetadata({ force: false });
      return;
    }
    if (button.dataset.statsKind) {
      state.statsKind = button.dataset.statsKind;
      renderStats();
      return;
    }
    if (button.id === "refreshStatsMetadata") {
      refreshStatsMetadata();
      return;
    }
    if (button.dataset.historyMode) {
      state.historyMode = button.dataset.historyMode;
      state.selectedHistoryTitle = "";
      renderHistory();
      return;
    }
    if (button.dataset.historyKind) {
      state.historyKind = button.dataset.historyKind;
      state.selectedHistoryTitle = "";
      renderHistory();
      return;
    }
    if (button.dataset.historyRange) {
      state.historyRange = button.dataset.historyRange;
      state.selectedHistoryTitle = "";
      renderHistory();
      return;
    }
    if (button.dataset.historyTitle) {
      state.selectedHistoryTitle = button.dataset.historyKey;
      openHistoryDialog(state.selectedHistoryTitle);
      return;
    }
    if (button.dataset.watchlistKey) {
      openWatchListDialog(button.dataset.watchlistKey);
      return;
    }
    if (button.id === "forgetArchive") {
      state.settingsConfirmDelete = true;
      renderSettings();
      return;
    }
    if (button.id === "cancelForgetArchive") {
      state.settingsConfirmDelete = false;
      renderSettings();
      return;
    }
    if (button.id === "confirmForgetArchive") {
      deleteLocalLibrary();
      return;
    }
    if (button.id === "saveTmdbKey") {
      saveTmdbKey();
      return;
    }
    if (button.id === "refreshAllPosters") {
      refreshPosterMetadata({ force: true });
      return;
    }
    if (button.dataset.reviewSearch) {
      reviewPosterMatch(button);
    }
  }

  function handleAppChange(event) {
    if (event.target.id === "historyStart") {
      state.historyStart = event.target.value;
      state.selectedHistoryTitle = "";
      renderHistory();
    }
    if (event.target.id === "historyEnd") {
      state.historyEnd = event.target.value;
      state.selectedHistoryTitle = "";
      renderHistory();
    }
  }

  function handleHistoryDialogClick(event) {
    const close = event.target.closest("[data-close-history]");
    if (close) {
      closeHistoryDialog();
      return;
    }
    const tab = event.target.closest("[data-modal-tab]");
    if (tab) activateModalTab(tab);
  }

  function handleHistoryDialogKeydown(event) {
    const tab = event.target.closest("[data-modal-tab]");
    if (!tab || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const tabs = Array.from(els.historyDialogContent.querySelectorAll("[data-modal-tab]"));
    const index = tabs.indexOf(tab);
    if (index < 0) return;
    event.preventDefault();
    let nextIndex = index;
    if (event.key === "ArrowLeft") nextIndex = index <= 0 ? tabs.length - 1 : index - 1;
    if (event.key === "ArrowRight") nextIndex = index >= tabs.length - 1 ? 0 : index + 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    tabs[nextIndex].focus();
    activateModalTab(tabs[nextIndex]);
  }

  async function handleZipInput(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;

    try {
      showStatus("Reading ZIP", "Opening your TV Time GDPR export...", 2);
      const archive = await importGdprZip(file);
      state.archive = archive;
      showStatus("Saving local library", "Storing the cleaned archive in this browser...", 96);
      await rememberArchiveBestEffort(archive);
      showApp();
      setRoute("dashboard");
      render();
      showStatus("Dashboard ready", "Your TV Time data was saved locally in this browser.", 100);
      setTimeout(hideStatus, 1800);
    } catch (error) {
      console.error(error);
      showStatus("Import failed", error.message || "The selected file could not be imported.", 100);
    }
  }

  async function importGdprZip(file) {
    const zip = await JSZip.loadAsync(file);
    const files = Object.values(zip.files).filter(function (entry) {
      return !entry.dir && entry.name.toLowerCase().endsWith(".csv");
    });
    if (!files.length) {
      throw new Error("No CSV files were found in this ZIP.");
    }

    const parsed = {};
    const skipped = [];
    const importedFiles = [];
    for (let i = 0; i < files.length; i += 1) {
      const entry = files[i];
      const name = basename(entry.name);
      const pct = Math.round((i / files.length) * 45);
      showStatus("Importing CSV files", `${name} (${i + 1} of ${files.length})`, pct);

      if (SENSITIVE_FILES.has(name)) {
        skipped.push({ file: name, reason: "Sensitive account, device, token, identity, or session data" });
        continue;
      }
      if (!SAFE_IMPORT_FILES.has(name)) {
        skipped.push({ file: name, reason: "Not used by this viewer yet" });
        continue;
      }

      const text = await entry.async("text");
      const rows = parseCsv(text);
      parsed[name] = rows;
      importedFiles.push({ file: name, rows: rows.length });
    }

    showStatus("Building archive", "Normalizing safe TV Time data...", 52);
    const normalized = normalizeData(parsed);
    const archive = {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      app: "TV Time Capsule",
      createdAt: new Date().toISOString(),
      source: {
        zipName: file.name,
        zipSize: file.size
      },
      summary: buildSummary(normalized),
      data: normalized,
      metadata: {
        provider: "TVmaze + Cinemeta/Stremio",
        shows: {},
        movies: {},
        fetchedAt: null,
        attribution: "Show metadata and images can be provided by TVmaze. Movie posters can be provided by Cinemeta/Stremio or optional TMDb."
      },
      importReport: {
        importedFiles,
        skippedFiles: skipped,
        notes: [
          "Sensitive authentication, IP, device, ad identifier, and private identity files are not imported.",
          "Poster image binaries are not embedded. The archive stores metadata and image URLs only."
        ]
      }
    };

    await enrichShowsWithTvmaze(archive);
    finalizeArchive(archive);
    archive.summary = buildSummary(archive.data);
    return archive;
  }

  function parseCsv(text) {
    const result = Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: function (header) {
        return String(header || "").trim();
      }
    });
    if (result.errors && result.errors.length) {
      console.warn("CSV parse warnings", result.errors.slice(0, 5));
    }
    return result.data.filter(function (row) {
      return Object.values(row).some(function (value) {
        return value !== null && value !== undefined && String(value).trim() !== "";
      });
    });
  }

  function normalizeData(parsed) {
    const shows = new Map();
    const movies = new Map();
    const watchHistory = [];
    const comments = [];
    const reactions = [];
    const ratings = [];
    const characterVotes = [];
    const badges = [];
    const timeframeStats = [];
    const statsCache = [];
    const stats = {};
    const historyKeys = new Set();

    function ensureShow(row, titleField) {
      const title = clean(row[titleField || "tv_show_name"] || row.series_name || row.tv_show_name);
      if (!title) return null;
      const id = clean(row.tv_show_id || row.series_id || row.s_id || row.series_uuid || "");
      const key = `show:${canonicalTitleKey(title)}`;
      if (!shows.has(key)) {
        shows.set(key, {
          id: key,
          type: "show",
          title,
          tvTimeIds: id ? [id] : [],
          followed: false,
          favorited: false,
          archived: false,
          watchedEpisodes: 0,
          runtimeSeconds: 0,
          firstWatchedAt: null,
          lastWatchedAt: null,
          releaseDate: clean(row.release_date),
          ratingCount: 0,
          characterVoteCount: 0,
          reactionCount: 0,
          commentCount: 0,
          metadataKey: canonicalTitleKey(title)
        });
      }
      const show = shows.get(key);
      if (id && !show.tvTimeIds.includes(id)) show.tvTimeIds.push(id);
      return show;
    }

    function ensureMovie(row) {
      const title = clean(row.movie_name);
      if (!title) return null;
      const id = clean(row.entity_uuid || row.uuid || row.movie_id || "");
      const key = `movie:${canonicalTitleKey(title)}`;
      if (!movies.has(key)) {
        movies.set(key, {
          id: key,
          type: "movie",
          title,
          tvTimeIds: id ? [id] : [],
          watchedCount: 0,
          runtimeSeconds: 0,
          firstWatchedAt: null,
          lastWatchedAt: null,
          followed: false,
          forLater: false,
          archived: false,
          ratingCount: 0,
          characterVoteCount: 0,
          reactionCount: 0,
          commentCount: 0,
          metadataKey: canonicalTitleKey(title)
        });
      }
      const movie = movies.get(key);
      if (id && !movie.tvTimeIds.includes(id)) movie.tvTimeIds.push(id);
      movie.releaseDate = earliest(movie.releaseDate, clean(row.release_date));
      return movie;
    }

    (parsed["followed_tv_show.csv"] || []).forEach(function (row) {
      const show = ensureShow(row, "tv_show_name");
      if (!show) return;
      show.followed = truthy(row.active) || show.followed;
      show.archived = truthy(row.archived) || show.archived;
      show.followedAt = clean(row.created_at) || show.followedAt || null;
    });

    (parsed["user_tv_show_data.csv"] || []).forEach(function (row) {
      const show = ensureShow(row, "tv_show_name");
      if (!show) return;
      show.followed = truthy(row.is_followed) || show.followed;
      show.favorited = truthy(row.is_favorited) || show.favorited;
      show.watchedEpisodes = Math.max(show.watchedEpisodes, number(row.nb_episodes_seen));
    });

    (parsed["user_show_special_status.csv"] || []).forEach(function (row) {
      const show = ensureShow(row, "tv_show_name");
      if (!show) return;
      show.specialStatus = clean(row.status) || show.specialStatus || null;
      if (show.specialStatus === "for_later") show.forLater = true;
    });

    addWatchRows(parsed["tracking-prod-records-v2.csv"] || [], "tracking-prod-records-v2.csv");
    addWatchRows(parsed["tracking-prod-records.csv"] || [], "tracking-prod-records.csv");
    addLatestRows(parsed["show_seen_episode_latest.csv"] || []);
    addLatestRows(parsed["seen_episode_latest.csv"] || []);
    addLatestRows(parsed["seen_episode_source.csv"] || []);
    addOldEpisodeComments(parsed["episode_comment.csv"] || []);
    addOldShowComments(parsed["show_comment.csv"] || []);
    addNewComments(parsed["comments-prod-comments.csv"] || []);
    addEpisodeReactions(parsed["emotions-3-prod-episode_votes.csv"] || [], "emotions-3-prod-episode_votes.csv");
    addMovieReactions(parsed["emotions-live-votes.csv"] || [], "emotions-live-votes.csv");
    addLegacyEpisodeEmotions(parsed["episode_emotion.csv"] || []);
    addShowEmotionCounts(parsed["tv_show_user_emotion_count.csv"] || []);
    addEpisodeRatings(parsed["ratings-3-prod-episode_votes.csv"] || [], "ratings-3-prod-episode_votes.csv");
    addEpisodeRatings(parsed["ratings-prod-episode_votes.csv"] || [], "ratings-prod-episode_votes.csv");
    addEpisodeRatings(parsed["ratings-v2-prod-votes.csv"] || [], "ratings-v2-prod-votes.csv");
    addMovieRatings(parsed["ratings-live-votes.csv"] || [], "ratings-live-votes.csv");
    addCharacterVotes(parsed["show_character_episode_vote.csv"] || []);
    addAggregateRuntimeRows(parsed["tracking-prod-records-v2.csv"] || []);
    addAggregateRuntimeRows(parsed["tracking-prod-records.csv"] || []);
    addTimeframeStats(parsed["tracking-prod-count-by-timeframe.csv"] || []);
    addStatsCache(parsed["stats-prod-cache.csv"] || []);

    (parsed["user_badge.csv"] || []).forEach(function (row) {
      badges.push({
        badgeId: clean(row.badge_id),
        createdAt: clean(row.created_at),
        updatedAt: clean(row.updated_at)
      });
    });

    (parsed["user_statistics.csv"] || []).forEach(function (row) {
      Object.assign(stats, pick(row, [
        "nb_episodes_watched",
        "nb_memes",
        "nb_likes",
        "time_spent",
        "nb_shows_followed",
        "nb_friends",
        "nb_comments",
        "nb_reviews",
        "score",
        "created_at",
        "updated_at"
      ]));
    });

    function addWatchRows(rows, sourceFile) {
      rows.forEach(function (row) {
        const movie = ensureMovie(row);
        const show = movie ? null : ensureShow(row, "series_name");
        if (!movie && !show) return;

        const rowType = clean(row.type).toLowerCase();
        const watchedAt = clean(row.created_at || row.watch_date || row.updated_at);
        const season = clean(row.season_number || row.s_no);
        const episode = clean(row.episode_number || row.ep_no);
        const episodeId = clean(row.episode_id || row.ep_id);
        const runtimeSeconds = number(row.runtime);

        if (movie) {
          if (rowType === "follow") {
            movie.followed = true;
            movie.followedAt = clean(row.created_at) || movie.followedAt || null;
            return;
          }
          if (rowType === "towatch") {
            movie.forLater = true;
            movie.forLaterAt = clean(row.created_at) || movie.forLaterAt || null;
            return;
          }
          if (rowType && rowType !== "watch" && rowType !== "rewatch") return;
        }

        if (show) {
          show.followed = truthy(row.is_followed) || show.followed;
          show.forLater = truthy(row.is_for_later) || show.forLater;
          show.archived = truthy(row.is_archived) || show.archived;
          if (show.forLater) show.specialStatus = show.specialStatus || "for_later";
          if (!episode && !episodeId) return;
          if (rowType && rowType.startsWith("count-")) return;
        }

        const record = {
          id: clean(row.uuid || row.key || row.episode_id || row.ep_id || row.entity_uuid) || `${sourceFile}:${watchHistory.length}`,
          sourceFile,
          type: movie ? "movie" : "episode",
          title: movie ? movie.title : show.title,
          showId: show ? show.id : null,
          movieId: movie ? movie.id : null,
          episodeId,
          seasonNumber: season,
          episodeNumber: episode,
          watchedAt,
          runtimeSeconds,
          rewatchCount: number(row.rewatch_count),
          watchCount: number(row.watch_count || row.ep_watch_count || row.movie_watch_count) || 1
        };
        const key = [record.type, record.title, record.episodeId, record.seasonNumber, record.episodeNumber, record.watchedAt, sourceFile].join("|");
        if (historyKeys.has(key)) return;
        historyKeys.add(key);
        watchHistory.push(record);

        const item = movie || show;
        if (movie) item.watchedCount += 1;
        if (show && episode) show.watchedEpisodes = Math.max(show.watchedEpisodes, 1);
        item.runtimeSeconds += runtimeSeconds;
        item.firstWatchedAt = earliest(item.firstWatchedAt, watchedAt);
        item.lastWatchedAt = latest(item.lastWatchedAt, watchedAt);
      });
    }

    function addLatestRows(rows) {
      rows.forEach(function (row) {
        const show = ensureShow(row, "tv_show_name");
        if (!show) return;
        show.lastWatchedAt = latest(show.lastWatchedAt, clean(row.updated_at || row.created_at));
      });
    }

    function addOldEpisodeComments(rows) {
      rows.forEach(function (row) {
        const show = ensureShow(row, "tv_show_name");
        const text = clean(row.comment);
        if (!show || !text) return;
        comments.push({
          id: clean(row.id) || `episode-comment:${comments.length}`,
          type: "episode",
          showTitle: show.title,
          movieTitle: "",
          title: show.title,
          showId: show.id,
          movieId: null,
          episodeId: clean(row.episode_id),
          seasonNumber: clean(row.episode_season_number),
          episodeNumber: clean(row.episode_number),
          text,
          createdAt: clean(row.created_at),
          updatedAt: clean(row.updated_at),
          likeCount: number(row.nb_likes),
          isSpoiler: number(row.spoiler_count) > 0,
          sourceFile: "episode_comment.csv"
        });
        show.commentCount += 1;
      });
    }

    function addOldShowComments(rows) {
      rows.forEach(function (row) {
        const show = ensureShow(row, "tv_show_name");
        const text = clean(row.comment);
        if (!show || !text) return;
        comments.push({
          id: clean(row.id) || `show-comment:${comments.length}`,
          type: "show",
          showTitle: show.title,
          movieTitle: "",
          title: show.title,
          showId: show.id,
          movieId: null,
          episodeId: "",
          seasonNumber: "",
          episodeNumber: "",
          text,
          createdAt: clean(row.created_at),
          updatedAt: clean(row.updated_at),
          likeCount: number(row.nb_likes),
          isSpoiler: number(row.spoiler_count) > 0,
          sourceFile: "show_comment.csv"
        });
        show.commentCount += 1;
      });
    }

    function addNewComments(rows) {
      rows.forEach(function (row) {
        const text = clean(row.text);
        if (!text) return;
        const commentType = clean(row.type).toLowerCase();
        if (commentType === "like") return;
        const movie = ensureMovie(row);
        const show = movie ? null : ensureShow(row, "series_name");
        if (!movie && !show) return;
        const entityType = clean(row.entity_type).toLowerCase();
        const type = movie ? "movie" : entityType === "episode" ? "episode" : "show";
        comments.push({
          id: clean(row.uuid || row.comment_uuid || row.comment_id) || `comments-prod:${comments.length}`,
          type,
          showTitle: show ? show.title : "",
          movieTitle: movie ? movie.title : "",
          title: movie ? movie.title : show.title,
          showId: show ? show.id : null,
          movieId: movie ? movie.id : null,
          episodeId: clean(row.comment_id),
          seasonNumber: "",
          episodeNumber: "",
          text,
          createdAt: clean(row.created_at),
          updatedAt: clean(row.updated_at),
          likeCount: number(row.like_count),
          isSpoiler: truthy(row.is_spoiler) || number(row.spoiler_count) > 0,
          sourceFile: "comments-prod-comments.csv"
        });
        if (movie) movie.commentCount += 1;
        if (show) show.commentCount += 1;
      });
    }

    function addEpisodeReactions(rows, sourceFile) {
      rows.forEach(function (row) {
        const show = ensureShow(row, "series_name");
        const reactionId = parseVoteValue(row.vote_key);
        if (!show || !reactionId) return;
        reactions.push({
          id: clean(row.vote_key) || `${sourceFile}:${reactions.length}`,
          type: "episode",
          showTitle: show.title,
          movieTitle: "",
          title: show.title,
          showId: show.id,
          movieId: null,
          episodeId: clean(row.episode_id),
          seasonNumber: clean(row.season_number),
          episodeNumber: clean(row.episode_number),
          reactionId,
          count: 1,
          createdAt: "",
          sourceFile
        });
        show.reactionCount += 1;
      });
    }

    function addMovieReactions(rows, sourceFile) {
      rows.forEach(function (row) {
        const movie = ensureMovie(row);
        const reactionId = parseVoteValue(row.vote_key);
        if (!movie || !reactionId) return;
        reactions.push({
          id: clean(row.vote_key || row.uuid) || `${sourceFile}:${reactions.length}`,
          type: "movie",
          showTitle: "",
          movieTitle: movie.title,
          title: movie.title,
          showId: null,
          movieId: movie.id,
          episodeId: "",
          seasonNumber: "",
          episodeNumber: "",
          reactionId,
          count: 1,
          createdAt: "",
          sourceFile
        });
        movie.reactionCount += 1;
      });
    }

    function addLegacyEpisodeEmotions(rows) {
      rows.forEach(function (row) {
        const show = ensureShow(row, "tv_show_name");
        const reactionId = clean(row.emotion_id);
        if (!show || !reactionId) return;
        reactions.push({
          id: `episode-emotion:${clean(row.episode_id)}:${reactionId}:${clean(row.created_at)}`,
          type: "episode",
          showTitle: show.title,
          movieTitle: "",
          title: show.title,
          showId: show.id,
          movieId: null,
          episodeId: clean(row.episode_id),
          seasonNumber: clean(row.episode_season_number),
          episodeNumber: clean(row.episode_number),
          reactionId,
          count: 1,
          createdAt: clean(row.created_at),
          sourceFile: "episode_emotion.csv"
        });
        show.reactionCount += 1;
      });
    }

    function addShowEmotionCounts(rows) {
      rows.forEach(function (row) {
        const show = ensureShow(row, "tv_show_name");
        const reactionId = clean(row.emotion_id);
        const count = number(row.count) || 1;
        if (!show || !reactionId) return;
        reactions.push({
          id: `show-emotion:${show.id}:${reactionId}`,
          type: "show",
          showTitle: show.title,
          movieTitle: "",
          title: show.title,
          showId: show.id,
          movieId: null,
          episodeId: "",
          seasonNumber: "",
          episodeNumber: "",
          reactionId,
          count,
          createdAt: clean(row.created_at),
          sourceFile: "tv_show_user_emotion_count.csv"
        });
        show.reactionCount += count;
      });
    }

    function addEpisodeRatings(rows, sourceFile) {
      rows.forEach(function (row) {
        const show = ensureShow(row, "series_name");
        const ratingId = parseVoteValue(row.vote_key);
        if (!show || !ratingId) return;
        ratings.push({
          id: clean(row.vote_key) || `${sourceFile}:${ratings.length}`,
          type: "episode",
          showTitle: show.title,
          movieTitle: "",
          title: show.title,
          showId: show.id,
          movieId: null,
          episodeId: clean(row.episode_id),
          seasonNumber: clean(row.season_number),
          episodeNumber: clean(row.episode_number),
          ratingId,
          ratingLabel: ratingLabel(ratingId),
          createdAt: clean(row.created_at || row.updated_at),
          sourceFile
        });
        show.ratingCount += 1;
      });
    }

    function addMovieRatings(rows, sourceFile) {
      rows.forEach(function (row) {
        const movie = ensureMovie(row);
        const ratingId = parseVoteValue(row.vote_key);
        if (!movie || !ratingId) return;
        ratings.push({
          id: clean(row.uuid || row.vote_key) || `${sourceFile}:${ratings.length}`,
          type: "movie",
          showTitle: "",
          movieTitle: movie.title,
          title: movie.title,
          showId: null,
          movieId: movie.id,
          episodeId: clean(row.episode_id),
          seasonNumber: "",
          episodeNumber: "",
          ratingId,
          ratingLabel: ratingLabel(ratingId),
          createdAt: clean(row.created_at || row.updated_at),
          sourceFile
        });
        movie.ratingCount += 1;
      });
    }

    function addCharacterVotes(rows) {
      rows.forEach(function (row) {
        const show = ensureShow(row, "tv_show_name");
        if (!show) return;
        characterVotes.push({
          id: [clean(row.episode_id), clean(row.show_character_id), clean(row.created_at)].join(":") || `character-vote:${characterVotes.length}`,
          type: "episode",
          showTitle: show.title,
          title: show.title,
          showId: show.id,
          episodeId: clean(row.episode_id),
          characterId: clean(row.show_character_id),
          seasonNumber: clean(row.episode_season_number),
          episodeNumber: clean(row.episode_number),
          createdAt: clean(row.created_at),
          updatedAt: clean(row.updated_at),
          sourceFile: "show_character_episode_vote.csv"
        });
        show.characterVoteCount += 1;
      });
    }

    function addTimeframeStats(rows) {
      rows.forEach(function (row) {
        timeframeStats.push({
          type: clean(row.type),
          count: number(row.count),
          runtimeSeconds: number(row.runtime),
          expiresAt: clean(row.expires_at),
          sourceFile: "tracking-prod-count-by-timeframe.csv"
        });
      });
    }

    function addAggregateRuntimeRows(rows) {
      rows.forEach(function (row) {
        const tvRuntime = number(row.total_series_runtime);
        const movieRuntime = number(row.total_movies_runtime);
        if (tvRuntime) stats.total_series_runtime = String(Math.max(number(stats.total_series_runtime), tvRuntime));
        if (movieRuntime) stats.total_movies_runtime = String(Math.max(number(stats.total_movies_runtime), movieRuntime));
      });
    }

    function addStatsCache(rows) {
      rows.forEach(function (row) {
        statsCache.push({
          statType: clean(row.stat_type),
          type: clean(row.type),
          interactionType: clean(row.interaction_type),
          entityType: clean(row.entity_type),
          stats: clean(row.stats),
          version: clean(row.version),
          timestamp: clean(row.timestamp),
          sourceFile: "stats-prod-cache.csv"
        });
      });
    }

    const sortedHistory = watchHistory.sort(function (a, b) {
      return String(b.watchedAt || "").localeCompare(String(a.watchedAt || ""));
    });

    return {
      shows: Array.from(shows.values()).sort(sortByTitle),
      movies: Array.from(movies.values()).sort(sortByTitle),
      watchHistory: sortedHistory,
      ratings: ratings.sort(sortMemoryItems),
      reactions: reactions.sort(sortMemoryItems),
      comments: comments.sort(sortMemoryItems),
      characterVotes: characterVotes.sort(sortMemoryItems),
      badges,
      timeframeStats,
      statsCache,
      stats
    };
  }

  async function enrichShowsWithTvmaze(archive) {
    const shows = archive.data.shows.slice().sort(sortByTitle);
    const limit = shows.length;
    const matchedAt = new Date().toISOString();
    let found = 0;

    for (let i = 0; i < limit; i += 1) {
      const show = shows[i];
      showStatus("Finding show posters", `${show.title} (${i + 1} of ${limit})`, 60 + Math.round((i / Math.max(limit, 1)) * 35));
      try {
        const result = await fetchBestMetadata(show.title);
        if (result) {
          archive.metadata.shows[show.metadataKey] = result;
          found += 1;
        }
      } catch (error) {
        archive.importReport.notes.push(`TVmaze lookup stopped or failed: ${error.message || "network error"}`);
        break;
      }
      await wait(550);
    }

    archive.metadata.fetchedAt = matchedAt;
    archive.metadata.matchSummary = {
      attempted: limit,
      matched: found,
      remaining: Math.max(0, shows.length - limit)
    };
  }

  async function tvmazeSearch(title) {
    const response = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(searchableTitle(title))}`);
    if (!response.ok) {
      throw new Error(`TVmaze returned ${response.status}`);
    }
    const results = await response.json();
    const best = chooseTvmazeMatch(title, Array.isArray(results) ? results : []);
    if (!best) return null;
    return {
      id: best.id,
      name: best.name,
      url: best.url,
      image: best.image || null,
      genres: best.genres || [],
      status: best.status || "",
      premiered: best.premiered || "",
      ended: best.ended || "",
      networkName: best.network && best.network.name ? best.network.name : "",
      webChannelName: best.webChannel && best.webChannel.name ? best.webChannel.name : "",
      averageRuntime: number(best.averageRuntime || best.runtime),
      summary: stripHtml(best.summary || ""),
      score: best._matchScore || 0,
      provider: "TVmaze"
    };
  }

  async function fetchBestMetadata(title) {
    const tvmaze = await tvmazeSearch(title);
    if (hasPoster(tvmaze)) return tvmaze;
    let tmdb = null;
    try {
      tmdb = await tmdbTvSearch(title);
    } catch (error) {
      console.warn("TMDb fallback failed.", error);
    }
    if (hasPoster(tmdb)) return tmdb;
    return tvmaze || tmdb;
  }

  async function fetchStatsMetadata(item, kind) {
    if (kind === "movies") return fetchStatsMovieMetadata(item);
    const base = await fetchBestMetadata(item.title || item);
    if (!base || base.provider !== "TVmaze" || !base.id) return base;
    try {
      const details = await tvmazeShowDetails(base.id);
      return Object.assign({}, base, details);
    } catch (error) {
      console.warn("TVmaze show detail lookup failed.", error);
      return base;
    }
  }

  async function fetchStatsMovieMetadata(item) {
    const base = await fetchBestMovieMetadata(item);
    let tmdb = null;
    try {
      tmdb = await tmdbMovieSearch(typeof item === "string" ? item : item.title);
      if (tmdb && tmdb.id) {
        tmdb = Object.assign({}, tmdb, await tmdbMovieDetails(tmdb.id));
      }
    } catch (error) {
      console.warn("TMDb movie stats lookup failed.", error);
    }
    if (!base) return tmdb;
    if (!tmdb) return base;
    return Object.assign({}, base, {
      genres: Array.isArray(tmdb.genres) && tmdb.genres.length ? tmdb.genres : base.genres,
      runtimeSeconds: number(tmdb.runtimeSeconds) || number(base.runtimeSeconds),
      summary: base.summary || tmdb.summary,
      provider: base.provider === tmdb.provider ? base.provider : `${base.provider} + ${tmdb.provider}`
    });
  }

  async function tvmazeShowDetails(id) {
    const response = await fetch(`https://api.tvmaze.com/shows/${encodeURIComponent(id)}?embed[]=episodes&embed[]=nextepisode`);
    if (!response.ok) {
      throw new Error(`TVmaze returned ${response.status}`);
    }
    const body = await response.json();
    const episodes = body._embedded && Array.isArray(body._embedded.episodes) ? body._embedded.episodes : [];
    const nextEpisode = body._embedded && body._embedded.nextepisode ? body._embedded.nextepisode : null;
    return {
      genres: body.genres || [],
      status: body.status || "",
      premiered: body.premiered || "",
      ended: body.ended || "",
      networkName: body.network && body.network.name ? body.network.name : "",
      webChannelName: body.webChannel && body.webChannel.name ? body.webChannel.name : "",
      averageRuntime: number(body.averageRuntime || body.runtime),
      episodeCount: episodes.length,
      nextEpisode: nextEpisode ? {
        name: nextEpisode.name || "",
        season: nextEpisode.season || "",
        number: nextEpisode.number || "",
        airdate: nextEpisode.airdate || ""
      } : null,
      provider: "TVmaze"
    };
  }

  async function fetchBestMovieMetadata(input) {
    const title = typeof input === "string" ? input : input.title;
    const releaseYear = typeof input === "string" ? "" : yearFromDate(input.releaseDate);
    let cinemeta = null;
    try {
      cinemeta = await cinemetaMovieSearch(title, releaseYear);
    } catch (error) {
      console.warn("Cinemeta movie lookup failed.", error);
    }
    if (hasPoster(cinemeta)) return cinemeta;
    let itunes = null;
    try {
      itunes = await itunesMovieSearch(title);
    } catch (error) {
      console.warn("iTunes movie lookup failed.", error);
    }
    if (hasPoster(itunes)) return itunes;
    let tmdb = null;
    try {
      tmdb = await tmdbMovieSearch(title);
    } catch (error) {
      console.warn("TMDb movie fallback failed.", error);
    }
    if (hasPoster(tmdb)) return tmdb;
    return itunes || tmdb;
  }

  async function cinemetaMovieSearch(title, releaseYear) {
    const url = `https://v3-cinemeta.strem.io/catalog/movie/top/search=${encodeURIComponent(searchableTitle(title))}.json`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Cinemeta returned ${response.status}`);
    }
    const body = await response.json();
    const best = chooseCinemetaMovieMatch(title, releaseYear, Array.isArray(body.metas) ? body.metas : []);
    if (!best) return null;
    return {
      id: best.id || best.imdb_id,
      name: best.name,
      url: best.id ? `https://www.imdb.com/title/${best.id}/` : "",
      image: best.poster ? { medium: best.poster, original: best.poster } : null,
      genres: Array.isArray(best.genres) ? best.genres : [],
      status: "",
      premiered: best.releaseInfo || "",
      ended: "",
      summary: "",
      score: best._matchScore || 0,
      provider: "Cinemeta"
    };
  }

  function chooseCinemetaMovieMatch(title, releaseYear, results) {
    const wanted = normalizeTitle(title);
    let best = null;
    results.forEach(function (item) {
      const name = normalizeTitle(item.name || "");
      if (!name) return;
      let score = 0;
      if (name === wanted) score += 5;
      if (name.includes(wanted) || wanted.includes(name)) score += 2;
      if (item.poster) score += 1;
      if (releaseYear && String(item.releaseInfo || "").includes(releaseYear)) score += 2;
      item._matchScore = score;
      if (!best || score > best._matchScore) best = item;
    });
    if (!best || best._matchScore < 1) return null;
    return best;
  }

  async function itunesMovieSearch(title) {
    const query = encodeURIComponent(searchableTitle(title));
    const url = `https://itunes.apple.com/search?media=movie&entity=movie&limit=8&term=${query}`;
    let body = null;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`iTunes returned ${response.status}`);
      }
      body = await response.json();
    } catch (error) {
      body = await itunesJsonpSearch(title);
    }
    const best = chooseItunesMovieMatch(title, Array.isArray(body.results) ? body.results : []);
    if (!best) return null;
    const image = best.artworkUrl100 ? upscaleItunesArtwork(best.artworkUrl100) : "";
    return {
      id: best.trackId,
      name: best.trackName,
      url: best.trackViewUrl || "",
      image: image ? { medium: image, original: image } : null,
      genres: best.primaryGenreName ? [best.primaryGenreName] : [],
      status: "",
      premiered: best.releaseDate || "",
      ended: "",
      summary: best.longDescription || best.shortDescription || "",
      score: best._matchScore || 0,
      provider: "Apple iTunes"
    };
  }

  function chooseItunesMovieMatch(title, results) {
    const wanted = normalizeTitle(title);
    let best = null;
    results.forEach(function (item) {
      const name = normalizeTitle(item.trackName || "");
      if (!name) return;
      let score = 0;
      if (name === wanted) score += 5;
      if (name.includes(wanted) || wanted.includes(name)) score += 2;
      if (item.artworkUrl100) score += 1;
      if (item.releaseDate) score += 0.25;
      item._matchScore = score;
      if (!best || score > best._matchScore) best = item;
    });
    if (!best || best._matchScore < 1) return null;
    return best;
  }

  function upscaleItunesArtwork(url) {
    return String(url).replace(/\/\d+x\d+bb\.(jpg|png|webp)$/i, "/600x900bb.$1");
  }

  function itunesJsonpSearch(title) {
    return new Promise(function (resolve, reject) {
      const callbackName = `tvTimeCapsuleItunes${Date.now()}${Math.floor(Math.random() * 10000)}`;
      const script = document.createElement("script");
      const cleanup = function () {
        delete window[callbackName];
        script.remove();
      };
      const timer = setTimeout(function () {
        cleanup();
        reject(new Error("iTunes lookup timed out"));
      }, 12000);

      window[callbackName] = function (data) {
        clearTimeout(timer);
        cleanup();
        resolve(data || { results: [] });
      };
      script.onerror = function () {
        clearTimeout(timer);
        cleanup();
        reject(new Error("iTunes lookup failed"));
      };
      script.src = `https://itunes.apple.com/search?media=movie&entity=movie&limit=8&term=${encodeURIComponent(searchableTitle(title))}&callback=${callbackName}`;
      document.head.appendChild(script);
    });
  }

  async function tmdbTvSearch(title) {
    const apiKey = getTmdbKey();
    if (!apiKey) return null;
    const url = `https://api.themoviedb.org/3/search/tv?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(searchableTitle(title))}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TMDb returned ${response.status}`);
    }
    const body = await response.json();
    const best = chooseTmdbMatch(title, Array.isArray(body.results) ? body.results : []);
    if (!best) return null;
    return {
      id: best.id,
      name: best.name || best.original_name,
      url: `https://www.themoviedb.org/tv/${best.id}`,
      image: best.poster_path ? {
        medium: `https://image.tmdb.org/t/p/w342${best.poster_path}`,
        original: `https://image.tmdb.org/t/p/original${best.poster_path}`
      } : null,
      genres: Array.isArray(best.genre_ids) ? best.genre_ids.map(function (id) { return TMDB_GENRES[id]; }).filter(Boolean) : [],
      status: "",
      premiered: best.first_air_date || "",
      ended: "",
      summary: best.overview || "",
      score: best._matchScore || 0,
      provider: "TMDb"
    };
  }

  async function tmdbMovieSearch(title) {
    const apiKey = getTmdbKey();
    if (!apiKey) return null;
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(searchableTitle(title))}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TMDb returned ${response.status}`);
    }
    const body = await response.json();
    const best = chooseTmdbMovieMatch(title, Array.isArray(body.results) ? body.results : []);
    if (!best) return null;
    return {
      id: best.id,
      name: best.title || best.original_title,
      url: `https://www.themoviedb.org/movie/${best.id}`,
      image: best.poster_path ? {
        medium: `https://image.tmdb.org/t/p/w342${best.poster_path}`,
        original: `https://image.tmdb.org/t/p/original${best.poster_path}`
      } : null,
      genres: [],
      status: "",
      premiered: best.release_date || "",
      ended: "",
      summary: best.overview || "",
      score: best._matchScore || 0,
      provider: "TMDb"
    };
  }

  async function tmdbMovieDetails(id) {
    const apiKey = getTmdbKey();
    if (!apiKey || !id) return {};
    const url = `https://api.themoviedb.org/3/movie/${encodeURIComponent(id)}?api_key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`TMDb returned ${response.status}`);
    }
    const body = await response.json();
    return {
      genres: Array.isArray(body.genres) ? body.genres.map(function (genre) { return genre.name; }).filter(Boolean) : [],
      runtimeSeconds: number(body.runtime) * 60,
      status: body.status || "",
      summary: body.overview || ""
    };
  }

  function chooseTmdbMatch(title, results) {
    const wanted = normalizeTitle(title);
    let best = null;
    results.forEach(function (item) {
      const name = normalizeTitle(item.name || item.original_name || "");
      if (!name) return;
      let score = Number(item.popularity || 0) / 100;
      if (name === wanted) score += 5;
      if (name.includes(wanted) || wanted.includes(name)) score += 2;
      if (item.poster_path) score += 1;
      item._matchScore = score;
      if (!best || score > best._matchScore) best = item;
    });
    return best;
  }

  function chooseTmdbMovieMatch(title, results) {
    const wanted = normalizeTitle(title);
    let best = null;
    results.forEach(function (item) {
      const name = normalizeTitle(item.title || item.original_title || "");
      if (!name) return;
      let score = Number(item.popularity || 0) / 100;
      if (name === wanted) score += 5;
      if (name.includes(wanted) || wanted.includes(name)) score += 2;
      if (item.poster_path) score += 1;
      if (item.release_date) score += 0.25;
      item._matchScore = score;
      if (!best || score > best._matchScore) best = item;
    });
    return best;
  }

  async function refreshPosterMetadata(options) {
    if (!state.archive) return;
    if (state.refreshInProgress) return;
    state.refreshInProgress = true;
    render();
    const force = Boolean(options && options.force);
    try {
      const kind = state.dashboardKind === "movies" ? "movies" : "shows";
      const collection = force
        ? (kind === "movies" ? state.archive.data.movies : state.archive.data.shows)
        : (kind === "movies" ? dashboardItems() : state.archive.data.shows);
      const metadataBucket = kind === "movies" ? state.archive.metadata.movies : state.archive.metadata.shows;
      const items = collection.filter(function (item) {
        const current = metadataBucket[item.metadataKey];
        return force || !hasPoster(current);
      }).sort(sortByTitle);
      if (!items.length) {
        showStatus("Posters checked", `Every ${kind === "movies" ? "movie" : "show"} already has a poster match.`, 100);
        setTimeout(hideStatus, 1400);
        return;
      }

      const refreshItems = items;
      let found = 0;
      let failed = 0;
      for (let i = 0; i < refreshItems.length; i += 1) {
        const item = refreshItems[i];
        const denominator = refreshItems.length;
        const remainingInFilter = Math.max(items.length - i - 1, 0);
        const scope = kind === "movies" ? `, ${remainingInFilter} unchecked in this filter` : "";
        const batchText = kind === "movies" ? ` batch ${Math.floor(i / MOVIE_REFRESH_BATCH_SIZE) + 1}` : "";
        showStatus("Refreshing posters", `${item.title} (${i + 1} of ${denominator}${scope})${batchText}`, Math.round((i / Math.max(denominator, 1)) * 100));
        try {
          const result = kind === "movies" ? await fetchBestMovieMetadata(item) : await fetchBestMetadata(item.title);
          if (result) {
            metadataBucket[item.metadataKey] = result;
            if (hasPoster(result)) found += 1;
          }
        } catch (error) {
          failed += 1;
          console.warn(error);
        }
        if (kind === "movies" && (i + 1) % MOVIE_REFRESH_BATCH_SIZE === 0) {
          state.archive.metadata.fetchedAt = new Date().toISOString();
          state.archive.summary = buildSummary(state.archive.data);
          finalizeArchive(state.archive);
          await rememberArchiveBestEffort(state.archive);
          render();
          await wait(1200);
        }
        if (i < refreshItems.length - 1) await wait(kind === "movies" ? 650 : 450);
      }
      state.archive.metadata.fetchedAt = new Date().toISOString();
      state.archive.metadata.matchSummary = {
        attempted: state.archive.data.shows.length,
        matched: metadataImageCount(state.archive, "shows"),
        remaining: missingPosterItems("shows").length
      };
      state.archive.summary = buildSummary(state.archive.data);
      finalizeArchive(state.archive);
      await rememberArchiveBestEffort(state.archive);
      render();
      const remaining = kind === "movies" ? missingPosterItems("movies").filter(function (item) {
        return state.dashboardLetter === "all" || titleBucket(item.title) === state.dashboardLetter;
      }).length : missingPosterItems("shows").length;
      const more = kind === "movies" && remaining ? ` ${remaining} still missing in this filter after lookup.` : "";
      const failureText = failed ? ` ${failed} lookups failed.` : "";
      showStatus("Poster refresh complete", `${found} ${kind === "movies" ? "movie" : "show"} posters were filled.${failureText}${more}`, 100);
      setTimeout(hideStatus, kind === "movies" ? 5000 : 1800);
    } finally {
      state.refreshInProgress = false;
      render();
    }
  }

  function chooseTvmazeMatch(title, results) {
    const wanted = normalizeTitle(title);
    let best = null;
    results.forEach(function (result) {
      const show = result.show;
      if (!show || !show.name) return;
      const name = normalizeTitle(show.name);
      let score = Number(result.score || 0);
      if (name === wanted) score += 5;
      if (name.includes(wanted) || wanted.includes(name)) score += 2;
      if (show.image) score += 1;
      if (Array.isArray(show.genres) && show.genres.length) score += 0.25;
      show._matchScore = score;
      if (!best || score > best._matchScore) best = show;
    });
    return best;
  }

  function finalizeArchive(archive) {
    if (!archive || !archive.data) return archive;
    archive.metadata = archive.metadata || {};
    archive.metadata.shows = archive.metadata.shows || {};
    archive.metadata.movies = archive.metadata.movies || {};
    archive.data.shows = dedupeShows(archive.data.shows || [], archive.metadata.shows);
    archive.data.movies = dedupeMovies(archive.data.movies || [], archive.metadata.movies);
    archive.data.watchHistory = dedupeWatchHistory(archive.data.watchHistory || []);
    archive.data.comments = dedupeComments(archive.data.comments || []);
    archive.data.reactions = dedupeReactions(archive.data.reactions || []);
    archive.data.ratings = dedupeRatings(archive.data.ratings || []);
    archive.data.characterVotes = dedupeCharacterVotes(archive.data.characterVotes || []);
    archive.data.timeframeStats = archive.data.timeframeStats || [];
    archive.data.statsCache = archive.data.statsCache || [];
    refreshMemoryCounts(archive.data);
    indexArchiveSearch(archive);
    archive.summary = buildSummary(archive.data);
    return archive;
  }

  function indexArchiveSearch(archive) {
    const metadata = archive.metadata || { shows: {}, movies: {} };
    (archive.data.shows || []).forEach(function (show) {
      const meta = metadata.shows && metadata.shows[show.metadataKey];
      show.searchText = searchableParts([
        show.title,
        "show",
        show.followed ? "followed" : "",
        show.favorited ? "favorite" : "",
        show.forLater ? "watch list for later" : "",
        show.archived ? "archived" : "",
        show.firstWatchedAt,
        show.lastWatchedAt,
        show.releaseDate,
        show.watchedEpisodes ? `${show.watchedEpisodes} watched episodes` : "",
        show.commentCount ? `${show.commentCount} comments` : "",
        show.reactionCount ? `${show.reactionCount} reactions` : "",
        show.ratingCount ? `${show.ratingCount} ratings` : "",
        show.characterVoteCount ? `${show.characterVoteCount} character votes` : "",
        meta && meta.name,
        meta && meta.provider,
        meta && Array.isArray(meta.genres) ? meta.genres.join(" ") : ""
      ]);
    });
    (archive.data.movies || []).forEach(function (movie) {
      const meta = metadata.movies && metadata.movies[movie.metadataKey];
      movie.searchText = searchableParts([
        movie.title,
        "movie",
        movie.followed ? "followed" : "",
        movie.forLater ? "watch list for later" : "",
        movie.archived ? "archived" : "",
        movie.firstWatchedAt,
        movie.lastWatchedAt,
        movie.releaseDate,
        movie.watchedCount ? `${movie.watchedCount} watched` : "",
        movie.commentCount ? `${movie.commentCount} comments` : "",
        movie.reactionCount ? `${movie.reactionCount} reactions` : "",
        movie.ratingCount ? `${movie.ratingCount} ratings` : "",
        meta && meta.name,
        meta && meta.provider,
        meta && Array.isArray(meta.genres) ? meta.genres.join(" ") : ""
      ]);
    });
    (archive.data.watchHistory || []).forEach(function (row) {
      row.searchText = searchableParts([
        row.title,
        row.type === "movie" ? "movie" : "show episode",
        row.seasonNumber ? `season ${row.seasonNumber}` : "",
        row.episodeNumber ? `episode ${row.episodeNumber}` : "",
        row.watchedAt,
        row.watchCount ? `${row.watchCount} watched` : ""
      ]);
    });
    (archive.data.comments || []).forEach(function (item) {
      item.searchText = searchableParts([
        item.title,
        item.type,
        item.text,
        item.createdAt,
        memoryContext(item),
        item.isSpoiler ? "spoiler" : "",
        item.likeCount ? `${item.likeCount} likes` : ""
      ]);
    });
    (archive.data.reactions || []).forEach(function (item) {
      item.searchText = searchableParts([
        item.title,
        item.type,
        reactionLabel(item.reactionId),
        item.createdAt,
        memoryContext(item),
        item.count ? `${item.count} reactions` : ""
      ]);
    });
    (archive.data.ratings || []).forEach(function (item) {
      item.searchText = searchableParts([
        item.title,
        item.type,
        ratingLabel(item.ratingId),
        item.createdAt,
        memoryContext(item)
      ]);
    });
    (archive.data.characterVotes || []).forEach(function (item) {
      item.searchText = searchableParts([
        item.title,
        "character vote",
        item.createdAt,
        memoryContext(item)
      ]);
    });
  }

  function dedupeShows(shows, metadata) {
    const merged = new Map();
    shows.forEach(function (show) {
      if (!show || !show.title) return;
      const key = canonicalTitleKey(show.title);
      const metadataKey = show.metadataKey || key;
      const existing = merged.get(key);
      if (!existing) {
        const next = Object.assign({}, show, {
          id: `show:${key}`,
          metadataKey: key,
          tvTimeIds: Array.isArray(show.tvTimeIds) ? show.tvTimeIds.slice() : []
        });
        if (show.tvTimeId && !next.tvTimeIds.includes(show.tvTimeId)) next.tvTimeIds.push(show.tvTimeId);
        merged.set(key, next);
      } else {
        existing.followed = existing.followed || Boolean(show.followed);
        existing.favorited = existing.favorited || Boolean(show.favorited);
        existing.archived = existing.archived || Boolean(show.archived);
        existing.watchedEpisodes = Math.max(number(existing.watchedEpisodes), number(show.watchedEpisodes));
        existing.runtimeSeconds += number(show.runtimeSeconds);
        existing.firstWatchedAt = earliest(existing.firstWatchedAt, show.firstWatchedAt);
        existing.lastWatchedAt = latest(existing.lastWatchedAt, show.lastWatchedAt);
        existing.ratingCount += number(show.ratingCount);
        existing.characterVoteCount += number(show.characterVoteCount);
        existing.reactionCount += number(show.reactionCount);
        existing.commentCount += number(show.commentCount);
        (show.tvTimeIds || []).forEach(function (id) {
          if (id && !existing.tvTimeIds.includes(id)) existing.tvTimeIds.push(id);
        });
        if (show.tvTimeId && !existing.tvTimeIds.includes(show.tvTimeId)) existing.tvTimeIds.push(show.tvTimeId);
      }

      const current = metadata[metadataKey];
      const chosen = metadata[key];
      if (current && (!chosen || (hasPoster(current) && !hasPoster(chosen)))) {
        metadata[key] = current;
      }
      if (metadataKey !== key) delete metadata[metadataKey];
    });
    return Array.from(merged.values()).sort(sortByTitle);
  }

  function dedupeMovies(movies, metadata) {
    const merged = new Map();
    movies.forEach(function (movie) {
      if (!movie || !movie.title) return;
      const key = canonicalTitleKey(movie.title);
      const previousKey = movie.metadataKey || key;
      if (metadata[previousKey] && previousKey !== key && !metadata[key]) {
        metadata[key] = metadata[previousKey];
        delete metadata[previousKey];
      }
      const existing = merged.get(key);
      if (!existing) {
        const next = Object.assign({}, movie, {
          id: `movie:${key}`,
          metadataKey: key,
          tvTimeIds: Array.isArray(movie.tvTimeIds) ? movie.tvTimeIds.slice() : []
        });
        if (movie.tvTimeId && !next.tvTimeIds.includes(movie.tvTimeId)) next.tvTimeIds.push(movie.tvTimeId);
        merged.set(key, next);
      } else {
        existing.watchedCount += number(movie.watchedCount);
        existing.runtimeSeconds += number(movie.runtimeSeconds);
        existing.firstWatchedAt = earliest(existing.firstWatchedAt, movie.firstWatchedAt);
        existing.lastWatchedAt = latest(existing.lastWatchedAt, movie.lastWatchedAt);
        existing.releaseDate = earliest(existing.releaseDate, movie.releaseDate);
        existing.followed = existing.followed || Boolean(movie.followed);
        existing.forLater = existing.forLater || Boolean(movie.forLater);
        existing.archived = existing.archived || Boolean(movie.archived);
        existing.followedAt = earliest(existing.followedAt, movie.followedAt);
        existing.forLaterAt = earliest(existing.forLaterAt, movie.forLaterAt);
        existing.ratingCount += number(movie.ratingCount);
        existing.characterVoteCount += number(movie.characterVoteCount);
        existing.reactionCount += number(movie.reactionCount);
        existing.commentCount += number(movie.commentCount);
        (movie.tvTimeIds || []).forEach(function (id) {
          if (id && !existing.tvTimeIds.includes(id)) existing.tvTimeIds.push(id);
        });
        if (movie.tvTimeId && !existing.tvTimeIds.includes(movie.tvTimeId)) existing.tvTimeIds.push(movie.tvTimeId);
      }
    });
    return Array.from(merged.values()).sort(sortByTitle);
  }

  function dedupeWatchHistory(records) {
    const seen = new Set();
    return records.filter(function (record) {
      if (!record || !record.title) return false;
      record.title = clean(record.title);
      record.showId = record.showId ? `show:${canonicalTitleKey(record.title)}` : record.showId;
      const key = [
        record.type,
        canonicalTitleKey(record.title),
        record.episodeId,
        record.seasonNumber,
        record.episodeNumber,
        record.watchedAt
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(function (a, b) {
      return String(b.watchedAt || "").localeCompare(String(a.watchedAt || ""));
    });
  }

  function dedupeComments(records) {
    const seen = new Set();
    return records.filter(function (record) {
      if (!record || !record.text || !record.title) return false;
      const type = record.type === "movie" ? "movie" : record.type === "episode" ? "episode" : "show";
      record.type = type;
      record.title = clean(record.title);
      record.showTitle = clean(record.showTitle);
      record.movieTitle = clean(record.movieTitle);
      record.showId = record.showTitle ? `show:${canonicalTitleKey(record.showTitle)}` : null;
      record.movieId = record.movieTitle ? `movie:${canonicalTitleKey(record.movieTitle)}` : null;
      record.text = clean(record.text);
      record.likeCount = number(record.likeCount);
      record.isSpoiler = Boolean(record.isSpoiler);
      const key = [
        record.sourceFile,
        record.id,
        type,
        canonicalTitleKey(record.title),
        record.seasonNumber,
        record.episodeNumber,
        record.createdAt,
        record.text
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(sortMemoryItems);
  }

  function dedupeReactions(records) {
    const seen = new Set();
    return records.filter(function (record) {
      if (!record || !record.reactionId || !record.title) return false;
      const type = record.type === "movie" ? "movie" : record.type === "episode" ? "episode" : "show";
      record.type = type;
      record.title = clean(record.title);
      record.showTitle = clean(record.showTitle);
      record.movieTitle = clean(record.movieTitle);
      record.showId = record.showTitle ? `show:${canonicalTitleKey(record.showTitle)}` : null;
      record.movieId = record.movieTitle ? `movie:${canonicalTitleKey(record.movieTitle)}` : null;
      record.reactionId = clean(record.reactionId);
      record.count = number(record.count) || 1;
      const key = [
        record.sourceFile,
        record.id,
        type,
        canonicalTitleKey(record.title),
        record.seasonNumber,
        record.episodeNumber,
        record.reactionId
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(sortMemoryItems);
  }

  function dedupeRatings(records) {
    const seen = new Set();
    return records.filter(function (record) {
      if (!record || !record.ratingId || !record.title) return false;
      const type = record.type === "movie" ? "movie" : "episode";
      record.type = type;
      record.title = clean(record.title);
      record.showTitle = clean(record.showTitle);
      record.movieTitle = clean(record.movieTitle);
      record.showId = record.showTitle ? `show:${canonicalTitleKey(record.showTitle)}` : null;
      record.movieId = record.movieTitle ? `movie:${canonicalTitleKey(record.movieTitle)}` : null;
      record.ratingId = clean(record.ratingId);
      record.ratingLabel = ratingLabel(record.ratingId);
      const key = [
        record.sourceFile,
        type,
        canonicalTitleKey(record.title),
        record.episodeId,
        record.seasonNumber,
        record.episodeNumber,
        record.ratingId
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(sortMemoryItems);
  }

  function dedupeCharacterVotes(records) {
    const seen = new Set();
    return records.filter(function (record) {
      if (!record || !record.title) return false;
      record.type = "episode";
      record.title = clean(record.title);
      record.showTitle = clean(record.showTitle || record.title);
      record.showId = `show:${canonicalTitleKey(record.showTitle)}`;
      const key = [
        canonicalTitleKey(record.showTitle),
        record.episodeId,
        record.characterId,
        record.seasonNumber,
        record.episodeNumber,
        record.createdAt
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(sortMemoryItems);
  }

  function refreshMemoryCounts(data) {
    (data.shows || []).forEach(function (show) {
      show.commentCount = 0;
      show.reactionCount = 0;
      show.ratingCount = 0;
      show.characterVoteCount = 0;
    });
    (data.movies || []).forEach(function (movie) {
      movie.commentCount = 0;
      movie.reactionCount = 0;
      movie.ratingCount = 0;
      movie.characterVoteCount = 0;
    });
    const shows = new Map((data.shows || []).map(function (show) {
      return [canonicalTitleKey(show.title), show];
    }));
    const movies = new Map((data.movies || []).map(function (movie) {
      return [canonicalTitleKey(movie.title), movie];
    }));
    (data.comments || []).forEach(function (item) {
      const target = item.type === "movie" ? movies.get(canonicalTitleKey(item.movieTitle || item.title)) : shows.get(canonicalTitleKey(item.showTitle || item.title));
      if (target) target.commentCount += 1;
    });
    (data.reactions || []).forEach(function (item) {
      const target = item.type === "movie" ? movies.get(canonicalTitleKey(item.movieTitle || item.title)) : shows.get(canonicalTitleKey(item.showTitle || item.title));
      if (target) target.reactionCount += number(item.count) || 1;
    });
    (data.ratings || []).forEach(function (item) {
      const target = item.type === "movie" ? movies.get(canonicalTitleKey(item.movieTitle || item.title)) : shows.get(canonicalTitleKey(item.showTitle || item.title));
      if (target) target.ratingCount += 1;
    });
    (data.characterVotes || []).forEach(function (item) {
      const target = shows.get(canonicalTitleKey(item.showTitle || item.title));
      if (target) target.characterVoteCount += 1;
    });
  }

  function render() {
    if (!state.archive) return;
    els.archiveTitle.textContent = "Your TV Time library";
    els.toolbar.hidden = state.route === "settings" || state.route === "stats";
    Object.keys(els.views).forEach(function (route) {
      els.views[route].hidden = route !== state.route;
    });
    document.querySelectorAll(".tab").forEach(function (tab) {
      const active = tab.dataset.route === state.route;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-current", active ? "page" : "false");
    });

    if (state.route === "dashboard") renderDashboard();
    if (state.route === "stats") renderStats();
    if (state.route === "history") renderHistory();
    if (state.route === "settings") renderSettings();
  }

  function renderDashboard() {
    const archive = state.archive;
    const summary = archive.summary;
    const activeItems = dashboardItems();
    const activeLabel = state.dashboardKind === "shows" ? "shows" : "movies";
    const totalItems = state.dashboardKind === "shows" ? archive.data.shows.length : archive.data.movies.length;
    const resultText = `${formatCount(activeItems.length)} of ${formatCount(totalItems)} ${activeLabel}`;
    const refreshDisabled = state.refreshInProgress ? " disabled aria-disabled=\"true\"" : "";
    els.views.dashboard.innerHTML = `
      <div class="grid stats-grid">
        ${stat("Shows", formatCount(summary.shows))}
        ${stat("Movies", formatCount(summary.movies))}
        ${stat("Watched items", formatCount(summary.watchRecords))}
        ${stat(formatWatchTimeDetail(summary.runtimeSeconds), formatWatchTimeHours(summary.runtimeSeconds))}
      </div>
      <div class="section-band">
        <div class="section-head">
          <div>
            <h2>${dashboardTitle()}</h2>
            <p>${resultText}, sorted alphabetically. ${state.dashboardKind === "shows" ? "Posters come from TVmaze when available." : "Movie posters use Cinemeta/Stremio first, then optional TMDb when a key is saved."}</p>
          </div>
          <div class="section-actions">
            <span class="pill">${metadataImageCount(archive, state.dashboardKind)} posters matched</span>
            <button id="refreshPostersButton" class="button" type="button"${refreshDisabled}>${state.refreshInProgress ? "Refreshing..." : `Refresh ${state.dashboardKind === "movies" ? "movie" : "show"} posters`}</button>
          </div>
        </div>
        <div class="filter-bar dashboard-filter">
          <div class="segmented" aria-label="Library type">
            ${dashboardKindChip("shows", "Shows")}
            ${dashboardKindChip("movies", "Movies")}
          </div>
          <div class="alphabet-row" aria-label="Alphabet filter">
            ${alphabetChips()}
          </div>
        </div>
        ${resultSummary("dashboard", activeItems.length, activeLabel)}
        ${posterGrid(activeItems, state.dashboardKind === "movies")}
      </div>
      <div class="section-band">
        <div class="section-head">
          <div>
            <h2>Import privacy report</h2>
            <p>${archive.importReport.importedFiles.length} files imported, ${archive.importReport.skippedFiles.length} files skipped.</p>
          </div>
        </div>
        <div class="pill-row">${archive.importReport.skippedFiles.slice(0, 12).map(function (item) {
          return `<span class="pill">${escapeHtml(item.file)}</span>`;
        }).join("")}</div>
      </div>
    `;
  }

  function renderStats() {
    const model = buildStatsModel(state.archive);
    const summary = model.summary;
    const current = state.statsKind === "movies" ? model.movies : model.shows;
    const refreshDisabled = state.statsRefreshInProgress ? " disabled aria-disabled=\"true\"" : "";
    els.views.stats.innerHTML = `
      <div class="stats-page">
        <div class="stats-overview">
          ${statsMetric("Combined watch time", formatWatchTimeHours(summary.runtimeSeconds), formatWatchTimeDetail(summary.runtimeSeconds), "teal")}
          ${statsMetric("TV watch time", formatWatchTimeHours(summary.tvRuntimeSeconds), `${formatWatchTimeDays(summary.tvRuntimeSeconds)} / ${summary.tvRuntimeSourceLabel}`, "pink")}
          ${statsMetric("Movie watch time", formatWatchTimeHours(summary.movieRuntimeSeconds), `${formatWatchTimeDays(summary.movieRuntimeSeconds)} / ${summary.movieRuntimeSourceLabel}`, "gold")}
          ${statsMetric("Watched items", formatCount(summary.watchRecords), `${formatCount(summary.episodeRecords)} episodes / ${formatCount(summary.movieRecords)} movies`, "blue")}
        </div>
        ${statsTimelineCard(model.timeline)}
        <section class="section-band stats-workspace">
          <div class="section-head">
            <div>
              <h2>${state.statsKind === "movies" ? "Movie stats" : "Show stats"}</h2>
              <p>${current.description}</p>
            </div>
            <div class="section-actions">
              <div class="segmented" aria-label="Stats type">
                ${statsKindChip("shows", "Shows")}
                ${statsKindChip("movies", "Movies")}
              </div>
              ${model.metadataReady ? confidencePill("Enhanced with provider metadata") : confidencePill("Needs metadata refresh", "warn")}
              <button id="refreshStatsMetadata" class="button" type="button"${refreshDisabled}>${state.statsRefreshInProgress ? "Refreshing..." : "Refresh stats metadata"}</button>
            </div>
          </div>
          <div class="stats-layout">
            <div class="stats-column">
              ${statsBigCard(current.runtimeTitle, formatWatchTimeHours(current.runtimeSeconds), `${formatWatchTimeDays(current.runtimeSeconds)} / ${current.runtimeSourceLabel}`, current.runtimeConfidence)}
              ${statsChartCard(current.countChartTitle, current.weeklyCounts, current.chartUnit, "From GDPR export")}
              ${statsRankCard(current.marathonTitle, current.marathons, current.marathonColumns, "From GDPR export")}
              ${statsRankCard(current.genreTitle, current.genres, ["Genre", current.kindLabel], current.hasGenres ? "Enhanced with provider metadata" : "Needs metadata refresh")}
              ${statsRankCard(current.networkTitle, current.networks, [current.networkColumn, current.kindLabel], current.hasNetworks ? "Enhanced with provider metadata" : "Needs metadata refresh")}
            </div>
            <div class="stats-column">
              ${statsBigCard(current.countTitle, formatCount(current.watchedCount), current.countCaption, "From GDPR export")}
              ${statsChartCard(current.runtimeChartTitle, current.weeklyRuntime, "hours", "From GDPR export")}
              ${statsRankCard(current.ratingsTitle, current.ratings, ["Title", "Top rating"], "From GDPR export")}
              ${state.statsKind === "shows" ? statsRankCard("Character votes by show", current.characterVotes, ["Show", "Votes"], "From GDPR export") : statsBigCard("Character votes", formatCount(current.characterVoteCount), `${formatCount(current.characterVoteTitles)} movies with character votes`, "From GDPR export")}
              ${statsCommunityCards(current)}
              ${statsFutureCards(current)}
            </div>
          </div>
        </section>
        <section class="section-band">
          <div class="section-head">
            <div>
              <h2>Badges</h2>
              <p>Badges imported from your GDPR export. Artwork is not included.</p>
            </div>
            ${confidencePill("From GDPR export")}
          </div>
          ${statsBadgeGrid(model.badges)}
        </section>
      </div>
    `;
  }

  function renderHistory() {
    const isWatchList = state.historyMode === "watchlist";
    const rows = filteredHistoryRecords();
    const groups = isWatchList ? filteredWatchListItems() : historyGroups(rows).filter(matchesQuery);
    if (!isWatchList && groups.length && !groups.some(function (group) { return group.key === state.selectedHistoryTitle; })) {
      state.selectedHistoryTitle = groups[0].key;
    }
    const title = isWatchList ? "Watch list" : "Watch history";
    const description = isWatchList
      ? `${groups.length} saved ${groups.length === 1 ? "item" : "items"} across shows and movies.`
      : `${rows.length} records across ${groups.length} shows and movies.`;
    els.views.history.innerHTML = `
      <div class="section-band">
        <div class="section-head">
          <div>
            <h2>${title}</h2>
            <p>${description}</p>
          </div>
        </div>
        <div class="filter-bar">
          <div class="segmented" aria-label="History mode">
            ${historyModeChip("watched", "Watched")}
            ${historyModeChip("watchlist", "Watch list")}
          </div>
          ${historyKindControls()}
          ${isWatchList ? "" : historyRangeControls()}
        </div>
        ${historyDateNotice()}
        ${resultSummary(isWatchList ? "watchlist" : "history", groups.length, isWatchList ? "watch-list items" : "titles")}
        ${isWatchList ? watchListTileGrid(groups) : historyTileGrid(groups)}
      </div>
    `;
  }

  function renderSettings() {
    const archive = state.archive;
    els.views.settings.innerHTML = `
      <div class="section-band">
        <div class="section-head">
          <div>
            <h2>Local library</h2>
            <p>Your TV Time data is saved in this browser. Import the GDPR ZIP again to rebuild it.</p>
          </div>
        </div>
        ${deleteLibraryControls()}
      </div>
      <div class="section-band">
        <div class="section-head">
          <div>
            <h2>Poster sources</h2>
            <p>Shows use TVmaze first. Movies use Cinemeta/Stremio first, with TMDb as the stronger optional source when you add a free API key.</p>
          </div>
        </div>
        <p><a href="https://www.tvmaze.com/" target="_blank" rel="noreferrer">Visit TVmaze</a></p>
        <label class="field-label" for="tmdbKeyInput">Optional TMDb API key</label>
        <div class="inline-form">
          <input id="tmdbKeyInput" class="search" type="password" value="${escapeAttr(getTmdbKey())}" placeholder="Paste a free TMDb API key">
          <button id="saveTmdbKey" class="button" type="button">Save key</button>
          <button id="refreshAllPosters" class="button" type="button">Refresh all posters</button>
        </div>
      </div>
      <details class="section-band collapsible-section">
        <summary class="section-head">
          <div>
            <h2>Review poster matches</h2>
            <p>${missingPosterItems(state.dashboardKind).length} ${state.dashboardKind} still need a poster or a better name match.</p>
          </div>
        </summary>
        ${metadataReviewList()}
      </details>
      <details class="section-band collapsible-section">
        <summary class="section-head">
          <div>
            <h2>Skipped files</h2>
            <p>These files were not copied into your archive.</p>
          </div>
        </summary>
        ${table(["File", "Reason"], archive.importReport.skippedFiles.map(function (row) {
          return [escapeHtml(row.file), escapeHtml(row.reason)];
        }))}
      </details>
    `;
  }

  function buildStatsModel(archive) {
    const data = archive.data || {};
    const metadata = archive.metadata || { shows: {}, movies: {} };
    const summary = buildSummary(data);
    const watchRows = data.watchHistory || [];
    const episodeRows = watchRows.filter(function (row) { return row.type !== "movie"; });
    const movieRows = watchRows.filter(function (row) { return row.type === "movie"; });
    const showItems = data.shows || [];
    const movieItems = data.movies || [];
    const showMetadata = metadata.shows || {};
    const movieMetadata = metadata.movies || {};
    const showMetaItems = showItems.map(function (item) { return showMetadata[item.metadataKey] || null; }).filter(Boolean);
    const movieMetaItems = movieItems.map(function (item) { return movieMetadata[item.metadataKey] || null; }).filter(Boolean);
    const showRemaining = remainingShowEpisodes(showItems, showMetadata, episodeRows);
    const movieRemaining = remainingMovieRuntime(movieItems, movieMetadata);

    return {
      summary,
      metadataReady: showMetaItems.some(hasStatsMetadata) || movieMetaItems.some(hasStatsMetadata),
      timeline: statsTimeline(data, summary),
      badges: data.badges || [],
      shows: statsSideModel({
        type: "shows",
        items: showItems,
        rows: episodeRows,
        runtimeSeconds: summary.tvRuntimeSeconds,
        runtimeSourceLabel: summary.tvRuntimeSourceLabel,
        runtimeConfidence: summary.tvRuntimeConfidence,
        metadata: showMetadata,
        comments: (data.comments || []).filter(function (item) { return item.type !== "movie"; }),
        ratings: (data.ratings || []).filter(function (item) { return item.type !== "movie"; }),
        characterVotes: data.characterVotes || [],
        remaining: showRemaining,
        watchedLabel: "episodes",
        kindLabel: "Shows",
        description: "Episode watches, show comments, reactions, ratings, marathons, genres, networks, and catch-up estimates.",
        runtimeTitle: "Time spent watching episodes",
        countTitle: "Total episodes watched",
        countChartTitle: "Episodes watched by week",
        runtimeChartTitle: "Episode hours by week",
        marathonTitle: "Biggest episode marathons",
        genreTitle: "Top show genres",
        networkTitle: "Top show networks",
        networkColumn: "Network",
        ratingsTitle: "Most rated shows"
      }),
      movies: statsSideModel({
        type: "movies",
        items: movieItems,
        rows: movieRows,
        runtimeSeconds: summary.movieRuntimeSeconds,
        runtimeSourceLabel: summary.movieRuntimeSourceLabel,
        runtimeConfidence: summary.movieRuntimeConfidence,
        metadata: movieMetadata,
        comments: (data.comments || []).filter(function (item) { return item.type === "movie"; }),
        ratings: (data.ratings || []).filter(function (item) { return item.type === "movie"; }),
        characterVotes: [],
        remaining: movieRemaining,
        watchedLabel: "movies",
        kindLabel: "Movies",
        description: "Movie watches, comments, ratings, genres, platforms, remaining watch-list time, and catch-up estimates.",
        runtimeTitle: "Time spent watching movies",
        countTitle: "Total movies watched",
        countChartTitle: "Movies watched by week",
        runtimeChartTitle: "Movie hours by week",
        marathonTitle: "Biggest movie marathons",
        genreTitle: "Top movie genres",
        networkTitle: "Top movie platforms",
        networkColumn: "Platform",
        ratingsTitle: "Most rated movies"
      })
    };
  }

  function statsSideModel(options) {
    const runtimeSeconds = number(options.runtimeSeconds) || sumBy(options.rows, "runtimeSeconds");
    const last7 = recentRows(options.rows, 7);
    const recent60 = recentRows(options.rows, 60);
    const weeklyCounts = weeklySeries(options.rows, function () { return 1; }, 12);
    const weeklyRuntime = weeklySeries(options.rows, function (row) { return number(row.runtimeSeconds) / 3600; }, 12);
    const metadataItems = options.items.map(function (item) {
      return {
        item,
        meta: options.metadata[item.metadataKey] || null
      };
    });
    const genres = rankedMetadataValues(metadataItems, "genres");
    const networks = rankedMetadataValues(metadataItems, options.type === "shows" ? "network" : "platform");
    const remaining = options.remaining || { count: 0, runtimeSeconds: 0, sourceCount: 0 };
    const pace = recent60.length / (60 / 7);
    const catchUpWeeks = pace > 0 ? remaining.count / pace : 0;
    const catchUpDate = catchUpWeeks > 0 ? addDays(new Date(), Math.ceil(catchUpWeeks * 7)) : null;
    const commentTitles = uniqueTitleCount(options.comments);
    const likes = options.comments.reduce(function (sum, item) {
      return sum + number(item.likeCount);
    }, 0);

    return {
      type: options.type,
      description: options.description,
      kindLabel: options.kindLabel,
      chartUnit: options.watchedLabel,
      runtimeTitle: options.runtimeTitle,
      countTitle: options.countTitle,
      countChartTitle: options.countChartTitle,
      runtimeChartTitle: options.runtimeChartTitle,
      marathonTitle: options.marathonTitle,
      marathonColumns: ["Title", options.type === "movies" ? "Watches" : "Episodes"],
      genreTitle: options.genreTitle,
      networkTitle: options.networkTitle,
      networkColumn: options.networkColumn,
      ratingsTitle: options.ratingsTitle,
      watchedCount: options.rows.length,
      runtimeSeconds,
      runtimeSourceLabel: options.runtimeSourceLabel || "Calculated from detailed logs",
      runtimeConfidence: options.runtimeConfidence || "Calculated from detailed logs",
      last7Count: last7.length,
      runtimeCaption: `${formatRuntime(sumBy(last7, "runtimeSeconds"))} in the last 7 days`,
      countCaption: `${formatCount(last7.length)} in the last 7 days`,
      weeklyCounts,
      weeklyRuntime,
      marathons: marathonRows(options.rows),
      genres,
      networks,
      hasGenres: genres.length > 0,
      hasNetworks: networks.length > 0,
      ratings: ratingRankRows(options.ratings),
      ratingCount: options.ratings.length,
      characterVotes: characterVoteRows(options.characterVotes),
      characterVoteCount: options.characterVotes.length,
      characterVoteTitles: uniqueTitleCount(options.characterVotes),
      commentCount: options.comments.length,
      commentTitles,
      earnedLikes: likes,
      likesPerComment: options.comments.length ? Math.round((likes / options.comments.length) * 10) / 10 : 0,
      remainingCount: remaining.count,
      remainingRuntimeSeconds: remaining.runtimeSeconds,
      remainingSourceCount: remaining.sourceCount,
      catchUpPace: pace,
      catchUpDate
    };
  }

  function statsKindChip(value, label) {
    const active = state.statsKind === value ? " is-active" : "";
    return `<button class="chip${active}" type="button" data-stats-kind="${escapeAttr(value)}" aria-pressed="${state.statsKind === value ? "true" : "false"}">${escapeHtml(label)}</button>`;
  }

  function statsMetric(label, value, caption, tone) {
    return `
      <article class="stats-metric stats-tone-${escapeAttr(tone)}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <em>${escapeHtml(caption)}</em>
      </article>
    `;
  }

  function statsBigCard(title, value, caption, confidence) {
    return `
      <article class="stats-card">
        <div class="stats-card-head">
          <h3>${escapeHtml(title)}</h3>
          ${confidencePill(confidence, confidence.indexOf("Needs") === 0 ? "warn" : "")}
        </div>
        <strong class="stats-big-value">${escapeHtml(value)}</strong>
        <p>${escapeHtml(caption)}</p>
      </article>
    `;
  }

  function statsChartCard(title, series, unit, confidence) {
    return `
      <article class="stats-card">
        <div class="stats-card-head">
          <h3>${escapeHtml(title)}</h3>
          ${confidencePill(confidence)}
        </div>
        ${barChart(series, unit)}
      </article>
    `;
  }

  function statsRankCard(title, rows, headers, confidence) {
    const warn = confidence.indexOf("Needs") === 0 ? "warn" : "";
    return `
      <article class="stats-card">
        <div class="stats-card-head">
          <h3>${escapeHtml(title)}</h3>
          ${confidencePill(confidence, warn)}
        </div>
        ${rankedList(headers, rows)}
      </article>
    `;
  }

  function statsCommunityCards(current) {
    return `
      <div class="stats-mini-grid">
        ${statsSmallCard("Comments", formatCount(current.commentCount), `Across ${formatCount(current.commentTitles)} ${current.type === "movies" ? "movies" : "shows"}`, "From GDPR export")}
        ${statsSmallCard("Earned likes", formatCount(current.earnedLikes), `${formatCount(current.likesPerComment)} likes per comment`, "From GDPR export")}
      </div>
    `;
  }

  function statsTimelineCard(timeline) {
    return `
      <section class="section-band stats-timeline-card">
        <div class="section-head">
          <div>
            <h2>Tracking timeline</h2>
            <p>Account history is shown separately from total watch-time duration.</p>
          </div>
          ${confidencePill("From GDPR export")}
        </div>
        <div class="stats-timeline-grid">
          ${timelineItem("TV Time account", timeline.accountCreatedAt ? formatDate(timeline.accountCreatedAt) : "Unavailable", "From user statistics")}
          ${timelineItem("First detailed log", timeline.firstLog ? formatDate(timeline.firstLog.watchedAt) : "Unavailable", timeline.firstLog ? watchLogLabel(timeline.firstLog) : "No dated watch log found")}
          ${timelineItem("Last tracked log", timeline.lastLog ? formatDate(timeline.lastLog.watchedAt) : "Unavailable", timeline.lastLog ? watchLogLabel(timeline.lastLog) : "No dated watch log found")}
        </div>
        ${timeline.hasAggregateBeforeDetails ? `<div class="notice compact-notice">Older activity may exist only as aggregate totals in the GDPR export, so the first detailed log is not necessarily your first ever TV Time watch.</div>` : ""}
      </section>
    `;
  }

  function timelineItem(label, value, caption) {
    return `
      <article class="stats-timeline-item">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        <p>${escapeHtml(caption)}</p>
      </article>
    `;
  }

  function statsFutureCards(current) {
    const remainingLabel = current.type === "movies" ? "Remaining movies" : "Remaining episodes";
    const unit = current.type === "movies" ? "movies/week" : "episodes/week";
    const date = current.catchUpDate ? isoDate(current.catchUpDate) : "Unavailable";
    const confidence = current.remainingSourceCount ? "Enhanced with provider metadata" : "Needs metadata refresh";
    return `
      <div class="stats-mini-grid">
        ${statsSmallCard(remainingLabel, formatCount(current.remainingCount), current.remainingSourceCount ? `${formatRuntime(current.remainingRuntimeSeconds)} left to watch` : "Provider episode/runtime data needed", confidence)}
        ${statsSmallCard("Catch-up pace", `${formatDecimal(current.catchUpPace)} ${unit}`, `Catch-up date: ${date}`, current.remainingSourceCount ? "Estimated from recent watch pace" : "Needs metadata refresh")}
      </div>
    `;
  }

  function statsSmallCard(title, value, caption, confidence) {
    return `
      <article class="stats-card stats-small-card">
        <div class="stats-card-head">
          <h3>${escapeHtml(title)}</h3>
          ${confidencePill(confidence, confidence.indexOf("Needs") === 0 ? "warn" : confidence.indexOf("Estimated") === 0 ? "estimate" : "")}
        </div>
        <strong class="stats-medium-value">${escapeHtml(value)}</strong>
        <p>${escapeHtml(caption)}</p>
      </article>
    `;
  }

  function confidencePill(label, tone) {
    const extra = tone ? ` confidence-${escapeAttr(tone)}` : "";
    return `<span class="confidence-pill${extra}">${escapeHtml(label)}</span>`;
  }

  function barChart(series, unit) {
    if (!series.length) return `<div class="empty-note">No dated records available.</div>`;
    const max = Math.max.apply(null, series.map(function (item) { return number(item.value); }));
    if (!max) return `<div class="empty-note">No activity in this range.</div>`;
    return `
      <div class="stats-bar-chart" role="img" aria-label="${escapeAttr(unit)} by week">
        ${series.map(function (item, index) {
          const height = Math.max(6, Math.round((number(item.value) / max) * 100));
          const active = index === series.length - 1 ? " is-current" : "";
          return `
            <div class="stats-bar-item${active}">
              <span>${escapeHtml(formatChartValue(item.value, unit))}</span>
              <i style="--bar-height: ${height}%"></i>
              <em>${escapeHtml(item.label)}</em>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function rankedList(headers, rows) {
    if (!rows.length) return `<div class="empty-note">No data available yet.</div>`;
    return `
      <div class="stats-ranked-list" role="table">
        <div class="stats-ranked-row stats-ranked-head" role="row">
          <span role="columnheader">${escapeHtml(headers[0])}</span>
          <span role="columnheader">${escapeHtml(headers[1])}</span>
        </div>
        ${rows.slice(0, 6).map(function (row) {
          return `
            <div class="stats-ranked-row" role="row">
              <strong role="cell">${escapeHtml(row.label)}</strong>
              <span role="cell">${escapeHtml(row.value)}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function statsBadgeGrid(badges) {
    const groups = badgeGroups(badges);
    if (!groups.length) return `<div class="empty-note">No badge data found in the imported files.</div>`;
    return `
      <div class="stats-badge-grid">
        ${groups.slice(0, 36).map(function (group) {
          const label = badgeLabel(group.badgeId);
          return `
            <div class="stats-badge-tile" title="${escapeAttr(clean(group.badgeId))}" aria-label="${escapeAttr(label.title)} badge${group.count > 1 ? `, earned ${group.count} times` : ""}">
              <span class="stats-badge-icon" aria-hidden="true">${badgeIconSvg()}</span>
              <strong>${escapeHtml(label.title)}</strong>
              <em>${escapeHtml(group.count > 1 ? `Earned ${formatCount(group.count)} times` : group.earnedAt ? `Earned ${formatDate(group.earnedAt)}` : "Imported badge")}</em>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function deleteLibraryControls() {
    if (!state.settingsConfirmDelete) {
      return `
        <div class="actions">
          <button class="button danger" id="forgetArchive" type="button">Delete local library</button>
        </div>
      `;
    }
    return `
      <div class="confirm-panel" role="group" aria-label="Confirm local library deletion">
        <div>
          <strong>Delete the saved local library?</strong>
          <p>This only clears this browser's TV Time Capsule copy. Your original GDPR ZIP is not changed.</p>
        </div>
        <div class="actions">
          <button class="button danger" id="confirmForgetArchive" type="button">Delete library</button>
          <button class="button" id="cancelForgetArchive" type="button">Keep library</button>
        </div>
      </div>
    `;
  }

  async function deleteLocalLibrary() {
    await forgetRememberedArchive();
    els.loadRememberedButton.hidden = true;
    state.archive = null;
    state.settingsConfirmDelete = false;
    els.appView.hidden = true;
    els.emptyState.hidden = false;
    document.body.classList.add("is-empty");
    showStatus("Local library deleted", "The saved TV Time Capsule copy was removed from this browser.", 100);
    setTimeout(hideStatus, 2400);
  }

  function saveTmdbKey() {
    const input = document.getElementById("tmdbKeyInput");
    const value = input ? input.value.trim() : "";
    if (value) localStorage.setItem(TMDB_KEY_STORAGE, value);
    if (!value) localStorage.removeItem(TMDB_KEY_STORAGE);
    showStatus(value ? "TMDb key saved" : "TMDb key removed", value ? "Poster refresh can now use TMDb as a fallback." : "Poster refresh will skip TMDb until a key is saved.", 100);
    setTimeout(hideStatus, 2200);
  }

  async function reviewPosterMatch(button) {
    const key = button.dataset.reviewSearch;
    const input = document.querySelector(`[data-review-input="${cssEscape(key)}"]`);
    const kind = state.dashboardKind;
    const collection = kind === "movies" ? state.archive.data.movies : state.archive.data.shows;
    const bucket = kind === "movies" ? state.archive.metadata.movies : state.archive.metadata.shows;
    const item = collection.find(function (entry) {
      return entry.metadataKey === key;
    });
    if (!item || !input) return;
    const query = input.value.trim() || item.title;
    button.disabled = true;
    showStatus("Reviewing match", `Searching posters for ${query}...`, 20);
    try {
      const result = kind === "movies" ? await fetchBestMovieMetadata(query) : await fetchBestMetadata(query);
      if (!result) {
        showStatus("No match", "No metadata result was found for that search.", 100);
        setTimeout(hideStatus, 1800);
        return;
      }
      bucket[key] = result;
      finalizeArchive(state.archive);
      await rememberArchiveBestEffort(state.archive);
      renderSettings();
      showStatus("Match saved", `${item.title} now uses ${result.provider}: ${result.name}.`, 100);
      setTimeout(hideStatus, 1800);
    } catch (error) {
      showStatus("Match failed", error.message || "The metadata search failed.", 100);
    } finally {
      button.disabled = false;
    }
  }

  function historyChip(value, label) {
    const active = state.historyRange === value ? " is-active" : "";
    return `<button class="chip${active}" type="button" data-history-range="${escapeAttr(value)}" aria-pressed="${state.historyRange === value ? "true" : "false"}">${escapeHtml(label)}</button>`;
  }

  function historyModeChip(value, label) {
    const active = state.historyMode === value ? " is-active" : "";
    return `<button class="chip${active}" type="button" data-history-mode="${escapeAttr(value)}" aria-pressed="${state.historyMode === value ? "true" : "false"}">${escapeHtml(label)}</button>`;
  }

  function historyRangeControls() {
    return `
      <div class="segmented" aria-label="History range">
        ${historyChip("all", "All")}
        ${historyChip("3m", "Last 3 months")}
        ${historyChip("6m", "Last 6 months")}
        ${historyChip("12m", "Last 12 months")}
        ${historyChip("custom", "Custom")}
      </div>
      <input id="historyStart" class="date-input" type="date" value="${escapeAttr(state.historyStart)}" ${state.historyRange === "custom" ? "" : "hidden"}>
      <input id="historyEnd" class="date-input" type="date" value="${escapeAttr(state.historyEnd)}" ${state.historyRange === "custom" ? "" : "hidden"}>
    `;
  }

  function dashboardKindChip(value, label) {
    const active = state.dashboardKind === value ? " is-active" : "";
    return `<button class="chip${active}" type="button" data-dashboard-kind="${escapeAttr(value)}" aria-pressed="${state.dashboardKind === value ? "true" : "false"}">${escapeHtml(label)}</button>`;
  }

  function historyKindControls() {
    if (!state.archive.data.movies.length) return "";
    return `
      <div class="segmented" aria-label="History type">
        ${historyKindChip("all", "All")}
        ${historyKindChip("shows", "Shows")}
        ${historyKindChip("movies", "Movies")}
      </div>
    `;
  }

  function historyKindChip(value, label) {
    const active = state.historyKind === value ? " is-active" : "";
    return `<button class="chip${active}" type="button" data-history-kind="${escapeAttr(value)}" aria-pressed="${state.historyKind === value ? "true" : "false"}">${escapeHtml(label)}</button>`;
  }

  function alphabetChips() {
    const letters = ["all", "#"].concat("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
    return letters.map(function (letter) {
      const label = letter === "all" ? "All" : letter;
      const active = state.dashboardLetter === letter ? " is-active" : "";
      return `<button class="letter-chip${active}" type="button" data-dashboard-letter="${escapeAttr(letter)}" aria-pressed="${state.dashboardLetter === letter ? "true" : "false"}">${escapeHtml(label)}</button>`;
    }).join("");
  }

  function dashboardTitle() {
    const kind = state.dashboardKind === "shows" ? "shows" : "movies";
    if (state.dashboardLetter === "all") return `All ${kind}`;
    return `${kind[0].toUpperCase()}${kind.slice(1)} starting with ${state.dashboardLetter}`;
  }

  function filteredHistoryRecords() {
    const records = state.archive.data.watchHistory.filter(function (row) {
      if (state.historyKind === "shows" && row.type === "movie") return false;
      if (state.historyKind === "movies" && row.type !== "movie") return false;
      return row.watchedAt;
    });
    if (state.historyRange === "all") return records;
    if (isInvalidCustomRange()) return [];

    const max = maxHistoryDate(records);
    if (!max) return records;
    let start = null;
    let end = max;
    if (state.historyRange === "3m") start = addMonths(max, -3);
    if (state.historyRange === "6m") start = addMonths(max, -6);
    if (state.historyRange === "12m") start = addMonths(max, -12);
    if (state.historyRange === "custom") {
      start = state.historyStart ? new Date(`${state.historyStart}T00:00:00`) : null;
      end = state.historyEnd ? new Date(`${state.historyEnd}T23:59:59`) : max;
    }

    return records.filter(function (row) {
      const date = parseDate(row.watchedAt);
      if (!date) return false;
      if (start && date < start) return false;
      return !(end && date > end);
    });
  }

  function isInvalidCustomRange() {
    if (state.historyRange !== "custom" || !state.historyStart || !state.historyEnd) return false;
    return new Date(`${state.historyStart}T00:00:00`) > new Date(`${state.historyEnd}T23:59:59`);
  }

  function historyDateNotice() {
    if (!isInvalidCustomRange()) return "";
    return `<div class="notice compact-notice">Start date must be before end date.</div>`;
  }

  function resultSummary(scope, total, label) {
    const hasQuery = Boolean(state.query);
    const filterParts = [];
    if (scope === "dashboard" && state.dashboardLetter !== "all") filterParts.push(`Letter ${state.dashboardLetter}`);
    if ((scope === "history" || scope === "watchlist") && state.historyKind !== "all") filterParts.push(state.historyKind === "shows" ? "Shows only" : "Movies only");
    if (scope === "history" && state.historyRange !== "all") filterParts.push(historyRangeLabel(state.historyRange));
    if (hasQuery) filterParts.push(`Search: "${state.query}"`);
    const filterText = filterParts.length ? filterParts.join(" / ") : "No extra filters";
    const resultText = `Showing ${formatCount(total)} ${total === 1 ? label.replace(/s$/, "") : label}.`;
    return `
      <div class="result-summary" aria-live="polite">
        <strong>${escapeHtml(resultText)}</strong>
        <span>${escapeHtml(total === 1 ? label.replace(/s$/, "") : label)} matched. ${escapeHtml(filterText)}</span>
      </div>
    `;
  }

  function historyRangeLabel(value) {
    if (value === "3m") return "Last 3 months";
    if (value === "6m") return "Last 6 months";
    if (value === "12m") return "Last 12 months";
    if (value === "custom") return "Custom dates";
    return "All dates";
  }

  function historyGroups(records) {
    const groups = new Map();
    records.forEach(function (row) {
      const title = row.title || "Unknown";
      const type = row.type === "movie" ? "movie" : "show";
      const key = `${type}:${canonicalTitleKey(title)}`;
      if (!groups.has(key)) {
        const item = titleItem(type, title);
        groups.set(key, {
          key,
          title,
          type,
          count: 0,
          runtimeSeconds: 0,
          lastWatchedAt: null,
          metadataKey: canonicalTitleKey(title),
          commentCount: item ? number(item.commentCount) : 0,
          reactionCount: item ? number(item.reactionCount) : 0,
          searchText: searchableParts([
            title,
            type === "movie" ? "movie" : "show",
            item && item.commentCount ? `${item.commentCount} comments` : "",
            item && item.reactionCount ? `${item.reactionCount} reactions` : ""
          ])
        });
      }
      const group = groups.get(key);
      group.count += 1;
      group.runtimeSeconds += number(row.runtimeSeconds);
      group.lastWatchedAt = latest(group.lastWatchedAt, row.watchedAt);
    });
    return Array.from(groups.values()).map(function (group) {
      group.searchText = searchableParts([group.searchText, group.lastWatchedAt, `${group.count} watched`]);
      return group;
    }).sort(sortByTitle);
  }

  function filteredWatchListItems() {
    return watchListItems().filter(function (item) {
      if (state.historyKind === "shows" && item.type !== "show") return false;
      if (state.historyKind === "movies" && item.type !== "movie") return false;
      return matchesQuery(item);
    });
  }

  function watchListItems() {
    const data = state.archive.data;
    const watchedByKey = historyGroups(data.watchHistory || []).reduce(function (map, group) {
      map[group.key] = group;
      return map;
    }, {});
    const shows = (data.shows || []).filter(function (show) {
      return show.forLater;
    }).map(function (show) {
      const key = `show:${canonicalTitleKey(show.title)}`;
      const watched = watchedByKey[key];
      return {
        key,
        type: "show",
        title: show.title,
        metadataKey: show.metadataKey || canonicalTitleKey(show.title),
        forLaterAt: show.forLaterAt || null,
        watchedSummary: watched ? `${watched.count} watched episodes` : "",
        searchText: searchableParts([show.title, "show watch list for later", show.forLaterAt, watched ? `${watched.count} watched episodes` : ""])
      };
    });
    const movies = (data.movies || []).filter(function (movie) {
      return movie.forLater;
    }).map(function (movie) {
      const key = `movie:${canonicalTitleKey(movie.title)}`;
      const watched = watchedByKey[key];
      return {
        key,
        type: "movie",
        title: movie.title,
        metadataKey: movie.metadataKey || canonicalTitleKey(movie.title),
        forLaterAt: movie.forLaterAt || null,
        watchedSummary: watched ? `Also watched ${watched.count} ${watched.count === 1 ? "time" : "times"}` : "",
        searchText: searchableParts([movie.title, "movie watch list for later", movie.forLaterAt, watched ? `${watched.count} watched` : ""])
      };
    });
    return shows.concat(movies).sort(sortByTitle);
  }

  function historyTileGrid(items) {
    if (!items.length) return `<div class="empty-note">No watched history for this date range.</div>`;
    return `<div class="poster-grid">${items.map(function (item) {
      const meta = item.type === "movie" ? state.archive.metadata.movies[item.metadataKey] : state.archive.metadata.shows[item.metadataKey];
      const image = meta && meta.image && (meta.image.medium || meta.image.original);
      const active = item.key === state.selectedHistoryTitle ? " is-selected" : "";
      const label = `Open ${item.title} ${item.type === "movie" ? "movie" : "show"} watch history`;
      return `
        <button class="poster-card poster-button${active}" type="button" data-history-title="${escapeAttr(item.title)}" data-history-key="${escapeAttr(item.key)}" aria-label="${escapeAttr(label)}">
          <div class="poster-art">${image ? `<img alt="" src="${escapeAttr(image)}">` : initials(item.title)}</div>
          <div class="poster-body">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${item.count} watched / last ${escapeHtml(formatDate(item.lastWatchedAt))}</p>
            ${memoryBadges(item)}
          </div>
        </button>
      `;
    }).join("")}</div>`;
  }

  function watchListTileGrid(items) {
    if (!items.length) return `<div class="empty-note">No watch-list items found.</div>`;
    return `<div class="poster-grid">${items.map(function (item) {
      const meta = item.type === "movie" ? state.archive.metadata.movies[item.metadataKey] : state.archive.metadata.shows[item.metadataKey];
      const image = meta && meta.image && (meta.image.medium || meta.image.original);
      const status = [item.type === "movie" ? "Movie" : "Show", item.forLaterAt ? `Added ${formatDate(item.forLaterAt)}` : ""].filter(Boolean).join(" / ");
      const label = `Open ${item.title} watch-list details`;
      return `
        <button class="poster-card poster-button" type="button" data-watchlist-key="${escapeAttr(item.key)}" aria-label="${escapeAttr(label)}">
          <div class="poster-art">${image ? `<img alt="" src="${escapeAttr(image)}">` : initials(item.title)}</div>
          <div class="poster-body">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${escapeHtml(status)}</p>
          </div>
        </button>
      `;
    }).join("")}</div>`;
  }

  function openHistoryDialog(groupKey) {
    openTitleDialog(groupKey, "watched", false);
  }

  function openTitleDialog(groupKey, activeTab, useAllHistory) {
    rememberDialogReturnFocus();
    const type = groupKey.split(":")[0] === "movie" ? "movie" : "show";
    const sourceRows = useAllHistory ? state.archive.data.watchHistory : filteredHistoryRecords();
    const rows = sourceRows
      .filter(function (row) { return `${row.type === "movie" ? "movie" : "show"}:${canonicalTitleKey(row.title)}` === groupKey; })
      .sort(function (a, b) { return String(b.watchedAt || "").localeCompare(String(a.watchedAt || "")); });
    const item = titleItemByKey(groupKey);
    const title = item ? item.title : rows[0] ? rows[0].title : "Unknown";
    const comments = titleComments(type, title);
    const reactions = titleReactions(type, title);
    const watchedSummary = rows.length ? `${rows.length} ${type === "movie" ? "watch records" : "watched episodes"}${type === "show" ? ` across ${seasonGroups(rows).length} seasons` : ""}` : "No watched records found for this title";
    const selectedTab = activeTab || "watched";
    els.historyDialogContent.innerHTML = `
      <div class="modal-head">
        <div>
          <p class="eyebrow">${type === "movie" ? "Movie history" : "Watched episodes"}</p>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(watchedSummary)}</p>
        </div>
        <button class="icon-button" type="button" aria-label="Close" data-close-history>&times;</button>
      </div>
      <div class="modal-tabs" role="tablist" aria-label="${escapeAttr(title)} details">
        ${modalTab("watched", "Watched", selectedTab, "watched-panel")}
        ${modalTab("comments", `Comments${comments.length ? ` (${comments.length})` : ""}`, selectedTab, "comments-panel")}
        ${modalTab("reactions", `Reactions${reactionTotal(reactions) ? ` (${reactionTotal(reactions)})` : ""}`, selectedTab, "reactions-panel")}
      </div>
      <div id="watched-panel" class="modal-panel" role="tabpanel" data-modal-panel="watched" ${selectedTab === "watched" ? "" : "hidden"}>
        ${rows.length ? type === "movie" ? movieHistoryModal(rows) : showHistoryModal(rows) : `<div class="empty-note">No watched records found for this title.</div>`}
      </div>
      <div id="comments-panel" class="modal-panel" role="tabpanel" data-modal-panel="comments" ${selectedTab === "comments" ? "" : "hidden"}>
        ${commentsModal(type, comments)}
      </div>
      <div id="reactions-panel" class="modal-panel" role="tabpanel" data-modal-panel="reactions" ${selectedTab === "reactions" ? "" : "hidden"}>
        ${reactionsModal(type, reactions)}
      </div>
    `;
    if (typeof els.historyDialog.showModal === "function") {
      els.historyDialog.showModal();
    } else {
      els.historyDialog.setAttribute("open", "");
    }
  }

  function modalTab(value, label, activeTab, panelId) {
    const active = value === activeTab ? " is-active" : "";
    return `<button id="${escapeAttr(value)}-tab" class="chip${active}" type="button" role="tab" data-modal-tab="${escapeAttr(value)}" aria-controls="${escapeAttr(panelId)}" aria-selected="${value === activeTab ? "true" : "false"}" tabindex="${value === activeTab ? "0" : "-1"}">${escapeHtml(label)}</button>`;
  }

  function activateModalTab(button) {
    const tab = button.dataset.modalTab;
    els.historyDialogContent.querySelectorAll("[data-modal-tab]").forEach(function (node) {
      const active = node === button;
      node.classList.toggle("is-active", active);
      node.setAttribute("aria-selected", active ? "true" : "false");
      node.tabIndex = active ? 0 : -1;
    });
    els.historyDialogContent.querySelectorAll("[data-modal-panel]").forEach(function (panel) {
      panel.hidden = panel.dataset.modalPanel !== tab;
    });
  }

  function closeHistoryDialog() {
    if (els.historyDialog.open && typeof els.historyDialog.close === "function") {
      els.historyDialog.close();
    } else {
      els.historyDialog.removeAttribute("open");
      restoreDialogFocus();
    }
  }

  function openWatchListDialog(itemKey) {
    rememberDialogReturnFocus();
    const item = watchListItems().find(function (entry) {
      return entry.key === itemKey;
    });
    if (!item) return;
    const meta = item.type === "movie" ? state.archive.metadata.movies[item.metadataKey] : state.archive.metadata.shows[item.metadataKey];
    const image = meta && meta.image && (meta.image.medium || meta.image.original);
    const added = item.forLaterAt ? `<p>Added for later ${escapeHtml(formatDate(item.forLaterAt))}</p>` : "";
    const watched = item.watchedSummary ? `<p>${escapeHtml(item.watchedSummary)}</p>` : "";
    els.historyDialogContent.innerHTML = `
      <div class="modal-head">
        <div>
          <p class="eyebrow">${item.type === "movie" ? "Movie watch list" : "Show watch list"}</p>
          <h2>${escapeHtml(item.title)}</h2>
          <p>On watch list</p>
        </div>
        <button class="icon-button" type="button" aria-label="Close" data-close-history>&times;</button>
      </div>
      <div class="watchlist-detail">
        <div class="poster-art">${image ? `<img alt="" src="${escapeAttr(image)}">` : initials(item.title)}</div>
        <div>
          <span class="pill">${item.type === "movie" ? "Movie" : "Show"}</span>
          <h3>On watch list</h3>
          ${added}
          ${watched}
        </div>
      </div>
    `;
    if (typeof els.historyDialog.showModal === "function") {
      els.historyDialog.showModal();
    } else {
      els.historyDialog.setAttribute("open", "");
    }
  }

  function openExportHelpDialog() {
    rememberDialogReturnFocus();
    if (typeof els.exportHelpDialog.showModal === "function") {
      els.exportHelpDialog.showModal();
    } else {
      els.exportHelpDialog.setAttribute("open", "");
    }
  }

  function closeExportHelpDialog() {
    if (els.exportHelpDialog.open && typeof els.exportHelpDialog.close === "function") {
      els.exportHelpDialog.close();
    } else {
      els.exportHelpDialog.removeAttribute("open");
      restoreDialogFocus();
    }
  }

  function rememberDialogReturnFocus() {
    const active = document.activeElement;
    state.dialogReturnFocus = active && typeof active.focus === "function" ? active : null;
  }

  function restoreDialogFocus() {
    if (state.dialogReturnFocus && document.contains(state.dialogReturnFocus)) {
      state.dialogReturnFocus.focus({ preventScroll: true });
    }
    state.dialogReturnFocus = null;
  }

  function showHistoryModal(rows) {
    return `<div class="season-stack">${seasonGroups(rows).map(function (season) {
      return `
        <section class="season-block">
          <div class="season-head">
            <h3>${season.label}</h3>
            <span class="pill">${season.rows.length} watched</span>
          </div>
          <div class="episode-list">
            ${season.rows.map(historyEpisodeRow).join("")}
          </div>
        </section>
      `;
    }).join("")}</div>`;
  }

  function movieHistoryModal(rows) {
    return `
      <div class="episode-list episode-list-compact">
        ${rows.map(function (row) {
          return `
            <div class="episode-row">
              <span>${escapeHtml(formatDate(row.watchedAt))}</span>
              <strong>Watched movie</strong>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function seasonGroups(rows) {
    const groups = new Map();
    rows.forEach(function (row) {
      const seasonNumber = clean(row.seasonNumber) || "?";
      const key = seasonNumber.padStart(4, "0");
      if (!groups.has(key)) {
        groups.set(key, {
          label: seasonNumber === "0" ? "Specials" : `Season ${seasonNumber}`,
          rows: []
        });
      }
      groups.get(key).rows.push(row);
    });
    return Array.from(groups.values()).map(function (group) {
      group.rows.sort(function (a, b) {
        return number(a.episodeNumber) - number(b.episodeNumber) || String(a.watchedAt || "").localeCompare(String(b.watchedAt || ""));
      });
      return group;
    });
  }

  function historyEpisodeRow(row) {
    const episode = row.episodeNumber ? `Episode ${escapeHtml(row.episodeNumber)}` : "Episode";
    return `
      <div class="episode-row">
        <span>${escapeHtml(formatDate(row.watchedAt))}</span>
        <strong>${episode}</strong>
      </div>
    `;
  }

  function commentsModal(type, items) {
    if (!items.length) return `<div class="empty-note">No comments found for this title.</div>`;
    return `<div class="memory-list">${items.map(function (item) {
      return `
        <article class="memory-card">
          <div class="memory-meta">
            <span>${escapeHtml(memoryContext(item))}</span>
            ${item.createdAt ? `<span>${escapeHtml(formatDate(item.createdAt))}</span>` : ""}
            ${item.isSpoiler ? `<span class="pill spoiler-pill">Spoiler</span>` : ""}
          </div>
          <blockquote>${escapeHtml(item.text)}</blockquote>
          ${item.likeCount ? `<p>${item.likeCount} ${item.likeCount === 1 ? "like" : "likes"}</p>` : ""}
        </article>
      `;
    }).join("")}</div>`;
  }

  function reactionsModal(type, items) {
    if (!items.length) return `<div class="empty-note">No reactions found for this title.</div>`;
    const groups = reactionGroups(items);
    return `<div class="season-stack memory-stack">${groups.map(function (group) {
      return `
        <section class="season-block">
          <div class="season-head">
            <h3>${escapeHtml(group.label)}</h3>
            <span class="pill">${reactionTotal(group.items)} reactions</span>
          </div>
          <div class="reaction-chip-row">
            ${group.items.map(function (item) {
              const count = number(item.count) || 1;
              return `<span class="reaction-chip">${escapeHtml(reactionLabel(item.reactionId))}${count > 1 ? ` x${count}` : ""}</span>`;
            }).join("")}
          </div>
        </section>
      `;
    }).join("")}</div>`;
  }

  function reactionGroups(items) {
    const groups = new Map();
    items.forEach(function (item) {
      const label = memoryContext(item);
      const key = [item.type, item.seasonNumber, item.episodeNumber, label].join("|");
      if (!groups.has(key)) groups.set(key, { label, items: [] });
      groups.get(key).items.push(item);
    });
    return Array.from(groups.values()).sort(function (a, b) {
      return a.label.localeCompare(b.label, undefined, { numeric: true });
    });
  }

  function memoryContext(item) {
    if (item.type === "movie") return "Movie";
    if (item.type === "episode") {
      const season = clean(item.seasonNumber);
      const episode = clean(item.episodeNumber);
      if (season && episode) return `Season ${season} / Episode ${episode}`;
      if (episode) return `Episode ${episode}`;
    }
    return "Show";
  }

  function titleComments(type, title) {
    const key = canonicalTitleKey(title);
    return (state.archive.data.comments || []).filter(function (item) {
      if (type === "movie") return item.type === "movie" && canonicalTitleKey(item.movieTitle || item.title) === key;
      return item.type !== "movie" && canonicalTitleKey(item.showTitle || item.title) === key;
    }).sort(sortMemoryItems);
  }

  function titleReactions(type, title) {
    const key = canonicalTitleKey(title);
    return (state.archive.data.reactions || []).filter(function (item) {
      if (type === "movie") return item.type === "movie" && canonicalTitleKey(item.movieTitle || item.title) === key;
      return item.type !== "movie" && canonicalTitleKey(item.showTitle || item.title) === key;
    }).sort(sortMemoryItems);
  }

  function reactionTotal(items) {
    return items.reduce(function (sum, item) {
      return sum + (number(item.count) || 1);
    }, 0);
  }

  function reactionLabel(reactionId) {
    const id = clean(reactionId);
    const label = REACTION_LABELS[id];
    if (label) return `${label} (${REACTION_EMOJIS[label] || "emoji"})`;
    return `Unknown TV Time reaction (ID ${id})`;
  }

  function ratingLabel(ratingId) {
    const id = clean(ratingId);
    return RATING_LABELS[id] || `Rating ID ${id}`;
  }

  function titleItem(type, title) {
    if (!state.archive || !state.archive.data) return null;
    const key = canonicalTitleKey(title);
    const items = type === "movie" ? state.archive.data.movies : state.archive.data.shows;
    return (items || []).find(function (item) {
      return canonicalTitleKey(item.title) === key;
    }) || null;
  }

  function titleItemByKey(groupKey) {
    const parts = clean(groupKey).split(":");
    const type = parts[0] === "movie" ? "movie" : "show";
    const key = parts.slice(1).join(":");
    if (!state.archive || !state.archive.data) return null;
    const items = type === "movie" ? state.archive.data.movies : state.archive.data.shows;
    return (items || []).find(function (item) {
      return canonicalTitleKey(item.title) === key;
    }) || null;
  }

  function memoryBadges(item) {
    const badges = [];
    if (number(item.commentCount)) badges.push(`${number(item.commentCount)} ${number(item.commentCount) === 1 ? "comment" : "comments"}`);
    if (number(item.reactionCount)) badges.push(`${number(item.reactionCount)} ${number(item.reactionCount) === 1 ? "reaction" : "reactions"}`);
    if (!badges.length) return "";
    return `<div class="memory-badges">${badges.map(function (label) {
      return `<span>${escapeHtml(label)}</span>`;
    }).join("")}</div>`;
  }

  function metadataReviewList() {
    const kind = state.dashboardKind;
    const items = missingPosterItems(kind).slice(0, 80);
    const bucket = kind === "movies" ? state.archive.metadata.movies : state.archive.metadata.shows;
    if (!items.length) return `<div class="empty-note">All ${kind} have poster images.</div>`;
    return `<div class="review-list">${items.map(function (item) {
      const current = bucket[item.metadataKey];
      return `
        <div class="review-row">
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <span>${current ? `Current match: ${escapeHtml(current.name || "Unknown")} (${escapeHtml(current.provider || "metadata")})` : "No poster match yet"}</span>
          </div>
          <input class="date-input" data-review-input="${escapeAttr(item.metadataKey)}" type="text" value="${escapeAttr(searchableTitle(item.title))}">
          <button class="button" type="button" data-review-search="${escapeAttr(item.metadataKey)}">Search</button>
        </div>
      `;
    }).join("")}</div>`;
  }

  function posterGrid(items, isMovie) {
    if (!items.length) return `<div class="empty-note">No matching items.</div>`;
    return `<div class="poster-grid">${items.map(function (item) {
      const meta = isMovie ? state.archive.metadata.movies[item.metadataKey] : state.archive.metadata.shows[item.metadataKey];
      const image = meta && meta.image && (meta.image.medium || meta.image.original);
      return `
        <article class="poster-card">
          <div class="poster-art">${image ? `<img alt="" src="${escapeAttr(image)}">` : initials(item.title)}</div>
          <div class="poster-body">
            <h3>${escapeHtml(item.title)}</h3>
          </div>
        </article>
      `;
    }).join("")}</div>`;
  }

  function table(headers, rows) {
    if (!rows.length) return `<div class="empty-note">No records to show.</div>`;
    return `
      <div class="table-wrap">
        <table>
          <thead><tr>${headers.map(function (h) { return `<th>${escapeHtml(h)}</th>`; }).join("")}</tr></thead>
          <tbody>${rows.map(function (cells) {
            return `<tr>${cells.map(function (cell) { return `<td>${cell}</td>`; }).join("")}</tr>`;
          }).join("")}</tbody>
        </table>
      </div>
    `;
  }

  function stat(label, value) {
    return `<div class="stat"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span></div>`;
  }

  function buildSummary(data) {
    const episodeRecords = data.watchHistory.filter(function (row) {
      return row.type !== "movie";
    });
    const movieRecords = data.watchHistory.filter(function (row) {
      return row.type === "movie";
    });
    const detailedTvRuntimeSeconds = episodeRecords.reduce(function (sum, row) {
      return sum + number(row.runtimeSeconds);
    }, 0);
    const detailedMovieRuntimeSeconds = movieRecords.reduce(function (sum, row) {
      return sum + number(row.runtimeSeconds);
    }, 0);
    const aggregateTvRuntimeSeconds = number(data.stats && data.stats.total_series_runtime);
    const aggregateMovieRuntimeSeconds = number(data.stats && data.stats.total_movies_runtime);
    const tvRuntimeSeconds = aggregateTvRuntimeSeconds || detailedTvRuntimeSeconds;
    const movieRuntimeSeconds = aggregateMovieRuntimeSeconds || detailedMovieRuntimeSeconds;
    const runtimeSeconds = tvRuntimeSeconds + movieRuntimeSeconds;
    const firstLog = firstWatchLog(data.watchHistory || []);
    const lastLog = lastWatchLog(data.watchHistory || []);
    return {
      shows: data.shows.length,
      movies: data.movies.length,
      watchRecords: episodeRecords.length + movieRecords.length,
      episodeRecords: episodeRecords.length,
      movieRecords: movieRecords.length,
      badges: data.badges.length,
      runtimeSeconds,
      tvRuntimeSeconds,
      movieRuntimeSeconds,
      detailedTvRuntimeSeconds,
      detailedMovieRuntimeSeconds,
      tvRuntimeSource: aggregateTvRuntimeSeconds ? "aggregate" : "detailed",
      movieRuntimeSource: aggregateMovieRuntimeSeconds ? "aggregate" : "detailed",
      tvRuntimeSourceLabel: aggregateTvRuntimeSeconds ? "From TV Time aggregate" : "Calculated from detailed logs",
      movieRuntimeSourceLabel: aggregateMovieRuntimeSeconds ? "From TV Time aggregate" : "Calculated from detailed logs",
      tvRuntimeConfidence: aggregateTvRuntimeSeconds ? "From TV Time aggregate" : "Calculated from detailed logs",
      movieRuntimeConfidence: aggregateMovieRuntimeSeconds ? "From TV Time aggregate" : "Calculated from detailed logs",
      firstTrackedAt: firstLog ? firstLog.watchedAt : "",
      lastTrackedAt: lastLog ? lastLog.watchedAt : ""
    };
  }

  function statsTimeline(data, summary) {
    const firstLog = firstWatchLog(data.watchHistory || []);
    const lastLog = lastWatchLog(data.watchHistory || []);
    return {
      accountCreatedAt: data.stats && data.stats.created_at,
      firstLog,
      lastLog,
      hasAggregateBeforeDetails: Boolean((summary.tvRuntimeSource === "aggregate" || summary.movieRuntimeSource === "aggregate") && firstLog)
    };
  }

  async function refreshStatsMetadata() {
    if (!state.archive || state.statsRefreshInProgress) return;
    state.statsRefreshInProgress = true;
    render();
    const showItems = (state.archive.data.shows || []).filter(function (item) {
      const meta = state.archive.metadata.shows[item.metadataKey] || {};
      return !number(meta.episodeCount);
    }).slice(0, STATS_METADATA_BATCH_SIZE);
    const movieItems = (state.archive.data.movies || []).filter(function (item) {
      const meta = state.archive.metadata.movies[item.metadataKey] || {};
      return !(Array.isArray(meta.genres) && meta.genres.length) && !number(meta.runtimeSeconds);
    }).slice(0, STATS_METADATA_BATCH_SIZE);
    const items = showItems.map(function (item) {
      return { kind: "shows", item };
    }).concat(movieItems.map(function (item) {
      return { kind: "movies", item };
    }));
    if (!items.length) {
      showStatus("Stats metadata checked", "All currently known stats metadata is already cached.", 100);
      state.statsRefreshInProgress = false;
      render();
      setTimeout(hideStatus, 1600);
      return;
    }
    let updated = 0;
    try {
      for (let i = 0; i < items.length; i += 1) {
        const entry = items[i];
        showStatus("Refreshing stats metadata", `${entry.item.title} (${i + 1} of ${items.length})`, Math.round((i / Math.max(items.length, 1)) * 100));
        try {
          const result = await fetchStatsMetadata(entry.item, entry.kind);
          if (result) {
            state.archive.metadata[entry.kind][entry.item.metadataKey] = result;
            updated += 1;
          }
        } catch (error) {
          console.warn("Stats metadata lookup failed.", error);
        }
        if (i < items.length - 1) await wait(entry.kind === "movies" ? 650 : 450);
      }
      state.archive.metadata.fetchedAt = new Date().toISOString();
      finalizeArchive(state.archive);
      await rememberArchiveBestEffort(state.archive);
      showStatus("Stats metadata updated", `${updated} titles were enhanced. Run again to continue through the library.`, 100);
      setTimeout(hideStatus, 2400);
    } finally {
      state.statsRefreshInProgress = false;
      render();
    }
  }

  function sumBy(items, field) {
    return (items || []).reduce(function (sum, item) {
      return sum + number(item[field]);
    }, 0);
  }

  function recentRows(rows, days) {
    const max = maxHistoryDate(rows);
    if (!max) return [];
    const start = addDays(max, -days);
    return rows.filter(function (row) {
      const date = parseDate(row.watchedAt || row.createdAt);
      return date && date >= start && date <= max;
    });
  }

  function weeklySeries(rows, valueFn, weeks) {
    const max = maxHistoryDate(rows) || new Date();
    const start = startOfWeek(addDays(max, -7 * (weeks - 1)));
    const buckets = [];
    for (let i = 0; i < weeks; i += 1) {
      const date = addDays(start, i * 7);
      buckets.push({
        key: weekKey(date),
        label: shortDateLabel(date),
        value: 0
      });
    }
    rows.forEach(function (row) {
      const date = parseDate(row.watchedAt || row.createdAt);
      if (!date) return;
      const key = weekKey(startOfWeek(date));
      const bucket = buckets.find(function (item) { return item.key === key; });
      if (bucket) bucket.value += number(valueFn(row));
    });
    return buckets;
  }

  function marathonRows(rows) {
    const groups = new Map();
    rows.forEach(function (row) {
      const date = row.watchedAt ? String(row.watchedAt).slice(0, 10) : "";
      if (!date) return;
      const key = `${date}:${canonicalTitleKey(row.title)}`;
      if (!groups.has(key)) {
        groups.set(key, {
          label: row.title,
          count: 0,
          runtimeSeconds: 0,
          date
        });
      }
      const group = groups.get(key);
      group.count += 1;
      group.runtimeSeconds += number(row.runtimeSeconds);
    });
    return Array.from(groups.values()).sort(function (a, b) {
      return b.count - a.count || b.runtimeSeconds - a.runtimeSeconds;
    }).slice(0, 6).map(function (group) {
      return {
        label: group.label,
        value: `${formatCount(group.count)} / ${formatRuntime(group.runtimeSeconds)}`
      };
    });
  }

  function ratingRankRows(ratings) {
    const groups = new Map();
    ratings.forEach(function (item) {
      const key = canonicalTitleKey(item.title);
      if (!groups.has(key)) groups.set(key, { label: item.title, total: 0, ratings: {} });
      const group = groups.get(key);
      group.total += 1;
      const label = ratingLabel(item.ratingId);
      group.ratings[label] = (group.ratings[label] || 0) + 1;
    });
    return Array.from(groups.values()).sort(function (a, b) {
      return b.total - a.total || a.label.localeCompare(b.label);
    }).slice(0, 6).map(function (group) {
      const top = Object.entries(group.ratings).sort(function (a, b) { return b[1] - a[1]; })[0];
      return {
        label: group.label,
        value: top ? `${top[0]} (x${formatCount(top[1])})` : formatCount(group.total)
      };
    });
  }

  function characterVoteRows(votes) {
    const groups = new Map();
    votes.forEach(function (item) {
      const key = canonicalTitleKey(item.showTitle || item.title);
      if (!groups.has(key)) groups.set(key, { label: item.showTitle || item.title, count: 0 });
      groups.get(key).count += 1;
    });
    return Array.from(groups.values()).sort(function (a, b) {
      return b.count - a.count || a.label.localeCompare(b.label);
    }).slice(0, 6).map(function (group) {
      return { label: group.label, value: formatCount(group.count) };
    });
  }

  function rankedMetadataValues(items, kind) {
    const counts = new Map();
    items.forEach(function (entry) {
      const meta = entry.meta || {};
      let values = [];
      if (kind === "genres") values = Array.isArray(meta.genres) ? meta.genres : [];
      if (kind === "network") values = [meta.networkName || meta.webChannelName || meta.network || ""];
      if (kind === "platform") values = Array.isArray(meta.platforms) ? meta.platforms : [meta.provider || ""];
      values.filter(Boolean).forEach(function (value) {
        const label = clean(value);
        counts.set(label, (counts.get(label) || 0) + 1);
      });
    });
    return Array.from(counts.entries()).sort(function (a, b) {
      return b[1] - a[1] || a[0].localeCompare(b[0]);
    }).slice(0, 6).map(function (entry) {
      return { label: entry[0], value: formatCount(entry[1]) };
    });
  }

  function remainingShowEpisodes(shows, metadata, rows) {
    const watchedByShow = rows.reduce(function (map, row) {
      const key = canonicalTitleKey(row.title);
      map[key] = (map[key] || 0) + 1;
      return map;
    }, {});
    let count = 0;
    let runtimeSeconds = 0;
    let sourceCount = 0;
    shows.forEach(function (show) {
      const meta = metadata[show.metadataKey] || {};
      const total = number(meta.episodeCount);
      if (!total) return;
      const watched = watchedByShow[canonicalTitleKey(show.title)] || number(show.watchedEpisodes);
      const remaining = Math.max(0, total - watched);
      const runtime = number(meta.averageRuntime) ? number(meta.averageRuntime) * 60 : 0;
      count += remaining;
      runtimeSeconds += remaining * runtime;
      sourceCount += 1;
    });
    return { count, runtimeSeconds, sourceCount };
  }

  function remainingMovieRuntime(movies, metadata) {
    let count = 0;
    let runtimeSeconds = 0;
    let sourceCount = 0;
    movies.forEach(function (movie) {
      if (!movie.forLater) return;
      count += 1;
      const meta = metadata[movie.metadataKey] || {};
      const runtime = number(meta.runtimeSeconds) || number(movie.runtimeSeconds);
      if (runtime) {
        runtimeSeconds += runtime;
        sourceCount += 1;
      }
    });
    return { count, runtimeSeconds, sourceCount };
  }

  function hasStatsMetadata(metadata) {
    if (!metadata) return false;
    return hasPoster(metadata)
      || (Array.isArray(metadata.genres) && metadata.genres.length > 0)
      || number(metadata.episodeCount) > 0
      || number(metadata.runtimeSeconds) > 0
      || Boolean(metadata.networkName || metadata.webChannelName || metadata.provider);
  }

  function uniqueTitleCount(items) {
    const keys = new Set();
    (items || []).forEach(function (item) {
      if (item.title) keys.add(canonicalTitleKey(item.title));
    });
    return keys.size;
  }

  function formatDurationParts(seconds) {
    const total = number(seconds);
    const months = Math.floor(total / (86400 * 30));
    const days = Math.floor((total % (86400 * 30)) / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    if (months) return `${formatCount(months)}mo ${formatCount(days)}d ${formatCount(hours)}h`;
    if (days) return `${formatCount(days)}d ${formatCount(hours)}h`;
    return `${formatCount(Math.floor(total / 3600))}h`;
  }

  function formatChartValue(value, unit) {
    if (unit === "hours") return formatDecimal(value);
    return formatCount(Math.round(number(value)));
  }

  function formatDecimal(value) {
    const rounded = Math.round(number(value) * 10) / 10;
    return rounded.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function firstWatchLog(rows) {
    return (rows || []).filter(function (row) {
      return row.watchedAt;
    }).sort(function (a, b) {
      return String(a.watchedAt || "").localeCompare(String(b.watchedAt || ""));
    })[0] || null;
  }

  function lastWatchLog(rows) {
    return (rows || []).filter(function (row) {
      return row.watchedAt;
    }).sort(function (a, b) {
      return String(b.watchedAt || "").localeCompare(String(a.watchedAt || ""));
    })[0] || null;
  }

  function watchLogLabel(row) {
    if (!row) return "";
    if (row.type === "movie") return `${row.title} / movie`;
    const context = memoryContext({
      type: "episode",
      seasonNumber: row.seasonNumber,
      episodeNumber: row.episodeNumber
    });
    return `${row.title} / ${context}`;
  }

  function badgeGroups(badges) {
    const groups = new Map();
    (badges || []).forEach(function (badge) {
      const key = clean(badge.badgeId) || "unknown";
      if (!groups.has(key)) {
        groups.set(key, {
          badgeId: key,
          count: 0,
          earnedAt: badge.createdAt || badge.updatedAt || ""
        });
      }
      const group = groups.get(key);
      group.count += 1;
      group.earnedAt = earliest(group.earnedAt, badge.createdAt || badge.updatedAt || "");
    });
    return Array.from(groups.values()).sort(function (a, b) {
      return badgeLabel(a.badgeId).title.localeCompare(badgeLabel(b.badgeId).title) || String(a.earnedAt || "").localeCompare(String(b.earnedAt || ""));
    });
  }

  function badgeLabel(badgeId) {
    const raw = clean(badgeId);
    const withoutIds = raw
      .replace(/^\d+[_\s-]*/, "")
      .replace(/\b\d{3,}\b/g, "")
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const lower = withoutIds.toLowerCase();
    let title = "";
    if (lower.includes("quick watcher")) title = "Quick watcher";
    if (lower.includes("marathoner")) title = "Marathoner";
    if (lower.includes("watcher") && !title) title = "Watcher";
    if (lower.includes("comment")) title = "Comment badge";
    if (lower.includes("rating") || lower.includes("vote")) title = "Vote badge";
    if (lower.includes("movie")) title = "Movie badge";
    if (lower.includes("episode")) title = "Episode badge";
    if (!title && withoutIds) {
      title = withoutIds.replace(/\b\w/g, function (letter) {
        return letter.toUpperCase();
      }).split(" ").slice(0, 3).join(" ");
    }
    return {
      title: title || "Imported badge"
    };
  }

  function badgeIconSvg() {
    return `
      <svg viewBox="0 0 48 48" focusable="false" aria-hidden="true">
        <path d="M24 4 38 10v12c0 10-5.8 17.2-14 22C15.8 39.2 10 32 10 22V10l14-6Z"></path>
        <path d="m17 24 5 5 10-12"></path>
      </svg>
    `;
  }

  function startOfWeek(date) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const day = next.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    next.setDate(next.getDate() + diff);
    return next;
  }

  function weekKey(date) {
    return isoDate(date);
  }

  function shortDateLabel(date) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function addDays(date, days) {
    const next = new Date(date.getTime());
    next.setDate(next.getDate() + days);
    return next;
  }

  function isoDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function filteredShows() {
    return state.archive.data.shows.filter(matchesQuery).sort(sortByTitle);
  }

  function filteredMovies() {
    return state.archive.data.movies.filter(matchesQuery).sort(sortByTitle);
  }

  function dashboardItems() {
    const items = state.dashboardKind === "shows" ? filteredShows() : filteredMovies();
    if (state.dashboardLetter === "all") return items;
    return items.filter(function (item) {
      return titleBucket(item.title) === state.dashboardLetter;
    });
  }

  function titleBucket(title) {
    const first = clean(title).charAt(0).toUpperCase();
    return /^[A-Z]$/.test(first) ? first : "#";
  }

  function matchesQuery(item) {
    if (!state.query) return true;
    return String(item.searchText || searchableParts([item.title, item.type])).includes(state.query);
  }

  function searchableParts(parts) {
    return parts.filter(Boolean).map(function (part) {
      return clean(part).toLowerCase();
    }).join(" ");
  }

  function setRoute(route) {
    if (!els.views[route]) route = "dashboard";
    state.route = route;
    render();
  }

  function showApp() {
    document.body.classList.remove("is-empty");
    els.emptyState.hidden = true;
    els.appView.hidden = false;
    els.loadRememberedButton.hidden = true;
  }

  function showStatus(title, text, value) {
    els.statusPanel.hidden = false;
    els.statusTitle.textContent = title;
    els.statusText.textContent = text;
    els.statusProgress.value = Math.max(0, Math.min(100, value || 0));
  }

  function hideStatus() {
    els.statusPanel.hidden = true;
  }

  async function loadRememberedArchive() {
    const archive = await getRememberedArchive();
    if (!archive) return;
    if (number(archive.schemaVersion) < ARCHIVE_SCHEMA_VERSION) {
      await forgetRememberedArchive();
      els.loadRememberedButton.hidden = true;
      els.appView.hidden = true;
      els.emptyState.hidden = false;
      document.body.classList.add("is-empty");
      showStatus("Reimport needed", "The local library was created with an older importer. Choose your GDPR ZIP again to add ratings, character votes, badges, and stats cache data.", 100);
      return;
    }
    state.archive = finalizeArchive(archive);
    await rememberArchiveBestEffort(state.archive);
    showApp();
    setRoute("dashboard");
    render();
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = function () {
        request.result.createObjectStore(DB_STORE);
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  async function saveRememberedArchive(archive) {
    finalizeArchive(archive);
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put(archive, REMEMBERED_KEY);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
  }

  async function rememberArchiveBestEffort(archive) {
    try {
      await saveRememberedArchive(archive);
      els.loadRememberedButton.hidden = false;
    } catch (error) {
      console.warn("Browser archive cache was not saved.", error);
      if (archive.importReport && archive.importReport.notes) {
        archive.importReport.notes.push("Browser storage was unavailable. Import the GDPR ZIP again next time.");
      }
    }
  }

  async function getRememberedArchive() {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(DB_STORE, "readonly");
      const request = tx.objectStore(DB_STORE).get(REMEMBERED_KEY);
      request.onsuccess = function () { resolve(request.result || null); };
      request.onerror = function () { reject(request.error); };
    });
  }

  async function hasRememberedArchive() {
    try {
      return Boolean(await getRememberedArchive());
    } catch (error) {
      return false;
    }
  }

  async function forgetRememberedArchive() {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).delete(REMEMBERED_KEY);
      tx.oncomplete = resolve;
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function basename(path) {
    return String(path).split("/").pop();
  }

  function clean(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function truthy(value) {
    const normalized = clean(value).toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }

  function slug(value) {
    return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function earliest(current, next) {
    if (!next) return current || null;
    if (!current) return next;
    return String(next) < String(current) ? next : current;
  }

  function latest(current, next) {
    if (!next) return current || null;
    if (!current) return next;
    return String(next) > String(current) ? next : current;
  }

  function yearFromDate(value) {
    const match = clean(value).match(/\b(19|20)\d{2}\b/);
    return match ? match[0] : "";
  }

  function sortByTitle(a, b) {
    return a.title.localeCompare(b.title);
  }

  function sortMemoryItems(a, b) {
    const dateCompare = String(b.createdAt || b.updatedAt || "").localeCompare(String(a.createdAt || a.updatedAt || ""));
    if (dateCompare) return dateCompare;
    const titleCompare = String(a.title || "").localeCompare(String(b.title || ""));
    if (titleCompare) return titleCompare;
    return number(a.episodeNumber) - number(b.episodeNumber);
  }

  function pick(row, keys) {
    return keys.reduce(function (out, key) {
      if (row[key] !== undefined) out[key] = clean(row[key]);
      return out;
    }, {});
  }

  function parseVoteValue(voteKey) {
    const parts = clean(voteKey).split("-");
    return parts.length ? parts[parts.length - 1] : "";
  }

  function searchableTitle(title) {
    return clean(title)
      .replace(/\s+\(\d{4}\)$/, "")
      .replace(/\s+ \- .+$/, "")
      .trim();
  }

  function normalizeTitle(title) {
    return searchableTitle(title)
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/^the\s+/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function canonicalTitleKey(title) {
    return normalizeTitle(title).replace(/\s+/g, "-") || slug(title);
  }

  function hasPoster(metadata) {
    return Boolean(metadata && metadata.image && (metadata.image.medium || metadata.image.original));
  }

  function metadataImageCount(archive, kind) {
    if (!archive || !archive.metadata) return 0;
    const bucket = kind === "movies" ? archive.metadata.movies : archive.metadata.shows;
    return Object.values(bucket || {}).filter(hasPoster).length;
  }

  function missingPosterItems(kind) {
    if (!state.archive) return [];
    const items = kind === "movies" ? state.archive.data.movies : state.archive.data.shows;
    const bucket = kind === "movies" ? state.archive.metadata.movies : state.archive.metadata.shows;
    return items.filter(function (item) {
      const metadata = bucket[item.metadataKey];
      return !hasPoster(metadata) || number(metadata.score) < 1;
    }).sort(sortByTitle);
  }

  function getTmdbKey() {
    try {
      return localStorage.getItem(TMDB_KEY_STORAGE) || "";
    } catch (error) {
      return "";
    }
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function stripHtml(value) {
    const div = document.createElement("div");
    div.innerHTML = value;
    return div.textContent || div.innerText || "";
  }

  function initials(title) {
    const parts = clean(title).split(/\s+/).filter(Boolean).slice(0, 2);
    return escapeHtml(parts.map(function (part) { return part[0]; }).join("").toUpperCase() || "?");
  }

  function escapeHtml(value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function formatDate(value) {
    if (!value) return "";
    const date = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function parseDate(value) {
    if (!value) return null;
    const date = new Date(String(value).replace(" ", "T"));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function maxHistoryDate(records) {
    return records.reduce(function (max, row) {
      const date = parseDate(row.watchedAt);
      if (!date) return max;
      return !max || date > max ? date : max;
    }, null);
  }

  function addMonths(date, months) {
    const next = new Date(date.getTime());
    next.setMonth(next.getMonth() + months);
    return next;
  }

  function formatRuntime(seconds) {
    const total = number(seconds);
    if (!total) return "0h";
    const hours = Math.floor(total / 3600);
    const minutes = Math.round((total % 3600) / 60);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  function formatCount(value) {
    return number(value).toLocaleString();
  }

  function formatWatchTimeHours(seconds) {
    const hours = Math.floor(number(seconds) / 3600);
    return `${hours.toLocaleString()} hours`;
  }

  function formatWatchTimeDays(seconds) {
    const days = Math.floor(number(seconds) / 86400);
    return `${days.toLocaleString()} ${days === 1 ? "day" : "days"} watched`;
  }

  function formatWatchTimeDetail(seconds) {
    const totalDays = Math.floor(number(seconds) / 86400);
    const years = Math.floor(totalDays / 365);
    const days = totalDays % 365;
    if (!years && !days) return "Time watched";
    const parts = [];
    if (years) parts.push(`${years.toLocaleString()} ${years === 1 ? "year" : "years"}`);
    if (days) parts.push(`${days.toLocaleString()} ${days === 1 ? "day" : "days"}`);
    return `${parts.join(", ")} watched`;
  }

  function wait(ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  }
}());
