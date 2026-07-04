(function () {
  "use strict";

  const ARCHIVE_SCHEMA_VERSION = 2;
  const DB_NAME = "tv-time-capsule";
  const DB_STORE = "archives";
  const REMEMBERED_KEY = "remembered";
  const TMDB_KEY_STORAGE = "tv-time-capsule-tmdb-key";
  const MOVIE_REFRESH_BATCH_SIZE = 12;

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
    "user_show_special_status.csv"
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
    historyKind: "all",
    historyRange: "all",
    historyStart: "",
    historyEnd: "",
    selectedHistoryTitle: ""
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
      history: document.getElementById("historyView"),
      settings: document.getElementById("settingsView")
    }
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    els.zipInput.addEventListener("change", handleZipInput);
    els.searchInput.addEventListener("input", function (event) {
      state.query = event.target.value.trim().toLowerCase();
      render();
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

  async function handleZipInput(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;

    try {
      showStatus("Reading ZIP", "Opening your TV Time GDPR export...", 2);
      const archive = await importGdprZip(file);
      state.archive = archive;
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
    const badges = [];
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

    const sortedHistory = watchHistory.sort(function (a, b) {
      return String(b.watchedAt || "").localeCompare(String(a.watchedAt || ""));
    });

    return {
      shows: Array.from(shows.values()).sort(sortByTitle),
      movies: Array.from(movies.values()).sort(sortByTitle),
      watchHistory: sortedHistory,
      ratings: [],
      reactions: [],
      comments: [],
      badges,
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
      genres: [],
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
      genres: [],
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
    const force = Boolean(options && options.force);
    const kind = state.dashboardKind === "movies" ? "movies" : "shows";
    const collection = kind === "movies" ? dashboardItems() : state.archive.data.shows;
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
    await rememberArchiveBestEffort(state.archive);
    render();
    const remaining = kind === "movies" ? missingPosterItems("movies").filter(function (item) {
      return state.dashboardLetter === "all" || titleBucket(item.title) === state.dashboardLetter;
    }).length : missingPosterItems("shows").length;
    const more = kind === "movies" && remaining ? ` ${remaining} still missing in this filter after lookup.` : "";
    const failureText = failed ? ` ${failed} lookups failed.` : "";
    showStatus("Poster refresh complete", `${found} ${kind === "movies" ? "movie" : "show"} posters were filled.${failureText}${more}`, 100);
    setTimeout(hideStatus, kind === "movies" ? 5000 : 1800);
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
    archive.data.ratings = [];
    archive.data.reactions = [];
    archive.data.comments = [];
    archive.summary = buildSummary(archive.data);
    return archive;
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

  function render() {
    if (!state.archive) return;
    els.archiveTitle.textContent = "Your TV Time library";
    els.toolbar.hidden = state.route === "settings";
    Object.keys(els.views).forEach(function (route) {
      els.views[route].hidden = route !== state.route;
    });
    document.querySelectorAll(".tab").forEach(function (tab) {
      tab.classList.toggle("is-active", tab.dataset.route === state.route);
    });

    if (state.route === "dashboard") renderDashboard();
    if (state.route === "history") renderHistory();
    if (state.route === "settings") renderSettings();
  }

  function renderDashboard() {
    const archive = state.archive;
    const summary = archive.summary;
    const activeItems = dashboardItems();
    const activeLabel = state.dashboardKind === "shows" ? "shows" : "movies";
    els.views.dashboard.innerHTML = `
      <div class="grid stats-grid">
        ${stat("Shows", summary.shows)}
        ${stat("Movies", summary.movies)}
        ${stat("Watched items", summary.watchRecords)}
        ${stat(formatWatchTimeDetail(summary.runtimeSeconds), formatWatchTimeHours(summary.runtimeSeconds))}
      </div>
      <div class="section-band">
        <div class="section-head">
          <div>
            <h2>${dashboardTitle()}</h2>
            <p>${activeItems.length} ${activeLabel}, sorted alphabetically. ${state.dashboardKind === "shows" ? "Posters come from TVmaze when available." : "Movie posters use Cinemeta/Stremio first, then optional TMDb when a key is saved."}</p>
          </div>
          <div class="section-actions">
            <span class="pill">${metadataImageCount(archive, state.dashboardKind)} posters matched</span>
            <button id="refreshPostersButton" class="button" type="button">Refresh ${state.dashboardKind === "movies" ? "movie" : "show"} posters</button>
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
    document.getElementById("refreshPostersButton").addEventListener("click", function () {
      refreshPosterMetadata({ force: false });
    });
    bindDashboardFilters();
  }

  function renderHistory() {
    const rows = filteredHistoryRecords();
    const groups = historyGroups(rows).filter(matchesQuery);
    if (groups.length && !groups.some(function (group) { return group.key === state.selectedHistoryTitle; })) {
      state.selectedHistoryTitle = groups[0].key;
    }
    els.views.history.innerHTML = `
      <div class="section-band">
        <div class="section-head">
          <div>
            <h2>Watch history</h2>
            <p>${rows.length} records across ${groups.length} shows and movies.</p>
          </div>
        </div>
        <div class="filter-bar">
          ${historyKindControls()}
          <div class="segmented" aria-label="History range">
            ${historyChip("all", "All")}
            ${historyChip("3m", "Last 3 months")}
            ${historyChip("6m", "Last 6 months")}
            ${historyChip("12m", "Last 12 months")}
            ${historyChip("custom", "Custom")}
          </div>
          <input id="historyStart" class="date-input" type="date" value="${escapeAttr(state.historyStart)}" ${state.historyRange === "custom" ? "" : "hidden"}>
          <input id="historyEnd" class="date-input" type="date" value="${escapeAttr(state.historyEnd)}" ${state.historyRange === "custom" ? "" : "hidden"}>
        </div>
        ${historyTileGrid(groups)}
      </div>
    `;
    bindHistoryControls();
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
        <div class="actions">
          <button class="button primary" id="forgetArchive" type="button">Delete local library</button>
        </div>
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
    document.getElementById("forgetArchive").addEventListener("click", async function () {
      await forgetRememberedArchive();
      els.loadRememberedButton.hidden = true;
      state.archive = null;
      els.appView.hidden = true;
      els.emptyState.hidden = false;
      document.body.classList.add("is-empty");
      alert("The local TV Time Capsule library has been deleted from this browser.");
    });
    document.getElementById("saveTmdbKey").addEventListener("click", function () {
      const value = document.getElementById("tmdbKeyInput").value.trim();
      if (value) localStorage.setItem(TMDB_KEY_STORAGE, value);
      if (!value) localStorage.removeItem(TMDB_KEY_STORAGE);
      alert(value ? "TMDb key saved for this browser." : "TMDb key removed.");
    });
    document.getElementById("refreshAllPosters").addEventListener("click", function () {
      refreshPosterMetadata({ force: true });
    });
    bindMetadataReviewControls();
  }

  function historyChip(value, label) {
    const active = state.historyRange === value ? " is-active" : "";
    return `<button class="chip${active}" type="button" data-history-range="${escapeAttr(value)}">${escapeHtml(label)}</button>`;
  }

  function dashboardKindChip(value, label) {
    const active = state.dashboardKind === value ? " is-active" : "";
    return `<button class="chip${active}" type="button" data-dashboard-kind="${escapeAttr(value)}">${escapeHtml(label)}</button>`;
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
    return `<button class="chip${active}" type="button" data-history-kind="${escapeAttr(value)}">${escapeHtml(label)}</button>`;
  }

  function alphabetChips() {
    const letters = ["all", "#"].concat("ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""));
    return letters.map(function (letter) {
      const label = letter === "all" ? "All" : letter;
      const active = state.dashboardLetter === letter ? " is-active" : "";
      return `<button class="letter-chip${active}" type="button" data-dashboard-letter="${escapeAttr(letter)}">${escapeHtml(label)}</button>`;
    }).join("");
  }

  function bindDashboardFilters() {
    document.querySelectorAll("[data-dashboard-kind]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.dashboardKind = button.dataset.dashboardKind;
        state.dashboardLetter = "all";
        renderDashboard();
      });
    });
    document.querySelectorAll("[data-dashboard-letter]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.dashboardLetter = button.dataset.dashboardLetter;
        renderDashboard();
      });
    });
  }

  function dashboardTitle() {
    const kind = state.dashboardKind === "shows" ? "shows" : "movies";
    if (state.dashboardLetter === "all") return `All ${kind}`;
    return `${kind[0].toUpperCase()}${kind.slice(1)} starting with ${state.dashboardLetter}`;
  }

  function bindHistoryControls() {
    document.querySelectorAll("[data-history-kind]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.historyKind = button.dataset.historyKind;
        state.selectedHistoryTitle = "";
        renderHistory();
      });
    });
    document.querySelectorAll("[data-history-range]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.historyRange = button.dataset.historyRange;
        state.selectedHistoryTitle = "";
        renderHistory();
      });
    });
    const start = document.getElementById("historyStart");
    const end = document.getElementById("historyEnd");
    if (start) {
      start.addEventListener("change", function () {
        state.historyStart = start.value;
        state.selectedHistoryTitle = "";
        renderHistory();
      });
    }
    if (end) {
      end.addEventListener("change", function () {
        state.historyEnd = end.value;
        state.selectedHistoryTitle = "";
        renderHistory();
      });
    }
    document.querySelectorAll("[data-history-title]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.selectedHistoryTitle = button.dataset.historyKey;
        openHistoryDialog(state.selectedHistoryTitle);
      });
    });
  }

  function filteredHistoryRecords() {
    const records = state.archive.data.watchHistory.filter(function (row) {
      if (state.historyKind === "shows" && row.type === "movie") return false;
      if (state.historyKind === "movies" && row.type !== "movie") return false;
      return row.watchedAt;
    });
    if (state.historyRange === "all") return records;

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

  function historyGroups(records) {
    const groups = new Map();
    records.forEach(function (row) {
      const title = row.title || "Unknown";
      const type = row.type === "movie" ? "movie" : "show";
      const key = `${type}:${canonicalTitleKey(title)}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          title,
          type,
          count: 0,
          runtimeSeconds: 0,
          lastWatchedAt: null,
          metadataKey: canonicalTitleKey(title)
        });
      }
      const group = groups.get(key);
      group.count += 1;
      group.runtimeSeconds += number(row.runtimeSeconds);
      group.lastWatchedAt = latest(group.lastWatchedAt, row.watchedAt);
    });
    return Array.from(groups.values()).sort(sortByTitle);
  }

  function historyTileGrid(items) {
    if (!items.length) return `<div class="empty-note">No history for this date range.</div>`;
    return `<div class="poster-grid">${items.map(function (item) {
      const meta = item.type === "movie" ? state.archive.metadata.movies[item.metadataKey] : state.archive.metadata.shows[item.metadataKey];
      const image = meta && meta.image && (meta.image.medium || meta.image.original);
      const active = item.key === state.selectedHistoryTitle ? " is-selected" : "";
      return `
        <button class="poster-card poster-button${active}" type="button" data-history-title="${escapeAttr(item.title)}" data-history-key="${escapeAttr(item.key)}">
          <div class="poster-art">${image ? `<img alt="" src="${escapeAttr(image)}">` : initials(item.title)}</div>
          <div class="poster-body">
            <h3>${escapeHtml(item.title)}</h3>
            <p>${item.count} watched / last ${escapeHtml(formatDate(item.lastWatchedAt))}</p>
          </div>
        </button>
      `;
    }).join("")}</div>`;
  }

  function openHistoryDialog(groupKey) {
    const rows = filteredHistoryRecords()
      .filter(function (row) { return `${row.type === "movie" ? "movie" : "show"}:${canonicalTitleKey(row.title)}` === groupKey; })
      .sort(function (a, b) { return String(b.watchedAt || "").localeCompare(String(a.watchedAt || "")); });
    if (!rows.length) return;
    const title = rows[0].title || "Unknown";
    const type = rows.some(function (row) { return row.type === "movie"; }) ? "movie" : "show";
    els.historyDialogContent.innerHTML = `
      <div class="modal-head">
        <div>
          <p class="eyebrow">${type === "movie" ? "Movie history" : "Watched episodes"}</p>
          <h2>${escapeHtml(title)}</h2>
          <p>${rows.length} ${type === "movie" ? "watch records" : "watched episodes"}${type === "show" ? ` across ${seasonGroups(rows).length} seasons` : ""}</p>
        </div>
        <button class="icon-button" type="button" aria-label="Close" data-close-history>&times;</button>
      </div>
      ${type === "movie" ? movieHistoryModal(rows) : showHistoryModal(rows)}
    `;
    els.historyDialogContent.querySelector("[data-close-history]").addEventListener("click", closeHistoryDialog);
    if (typeof els.historyDialog.showModal === "function") {
      els.historyDialog.showModal();
    } else {
      els.historyDialog.setAttribute("open", "");
    }
  }

  function closeHistoryDialog() {
    if (els.historyDialog.open && typeof els.historyDialog.close === "function") {
      els.historyDialog.close();
    } else {
      els.historyDialog.removeAttribute("open");
    }
  }

  function openExportHelpDialog() {
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
    }
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

  function bindMetadataReviewControls() {
    document.querySelectorAll("[data-review-search]").forEach(function (button) {
      button.addEventListener("click", async function () {
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
        showStatus("Reviewing match", `Searching posters for ${query}...`, 20);
        try {
          const result = kind === "movies" ? await fetchBestMovieMetadata(query) : await fetchBestMetadata(query);
          if (!result) {
            showStatus("No match", "No metadata result was found for that search.", 100);
            setTimeout(hideStatus, 1600);
            return;
          }
          bucket[key] = result;
          await rememberArchiveBestEffort(state.archive);
          renderSettings();
          showStatus("Match saved", `${item.title} now uses ${result.provider}: ${result.name}.`, 100);
          setTimeout(hideStatus, 1600);
        } catch (error) {
          showStatus("Match failed", error.message || "The metadata search failed.", 100);
        }
      });
    });
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
    const runtimeSeconds = data.watchHistory.reduce(function (sum, row) {
      return sum + number(row.runtimeSeconds);
    }, 0);
    return {
      shows: data.shows.length,
      movies: data.movies.length,
      watchRecords: data.watchHistory.length,
      badges: data.badges.length,
      runtimeSeconds
    };
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
    return JSON.stringify(item).toLowerCase().includes(state.query);
  }

  function setRoute(route) {
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
      showStatus("Reimport needed", "The local library was created with an older importer. Choose your GDPR ZIP again to remap watch history and watch-later items correctly.", 100);
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

  function formatWatchTimeHours(seconds) {
    const hours = Math.floor(number(seconds) / 3600);
    return `${hours.toLocaleString()} hours`;
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
