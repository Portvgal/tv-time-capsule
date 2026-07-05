# TV Time Capsule

TV Time Capsule is a private, no-install viewer for TV Time GDPR exports.

Open the app in your browser, choose your TV Time GDPR ZIP, and browse your
shows, movies, watch history, posters, and watch-later items locally. The app
does not upload your TV Time export.

## Screenshots

### Dashboard

![TV Time Capsule dashboard view](app/assets/screenshot-dashboard.png)

### History

![TV Time Capsule history view](app/assets/screenshot-history.png)

## Back Up Your TV Time Data First

Before trying any replacement app or migration path, export your TV Time data.
Request it as early as possible because exports can take time when the service is
busy.

TV Time Capsule is built for the official TV Time GDPR ZIP export. Start here:

[https://gdpr.tvtime.com/gdpr/self-service](https://gdpr.tvtime.com/gdpr/self-service)

1. Open the TV Time GDPR Data Export page.
2. Sign in with your TV Time email and password.
3. If you do not know your password, use the reset-password option on that page.
4. Request your personal data export.
5. Wait for TV Time to prepare the export.
6. Download the GDPR ZIP file when it is available.
7. Keep the ZIP file somewhere safe.

Do not unzip or edit the export before using TV Time Capsule. The app expects the
original `.zip` file.

## Alternative Export Options

If the official GDPR export is slow or unavailable, browser-based exporters may
help you save an extra copy of your TV Time data. These are useful backups, but
TV Time Capsule currently imports the official GDPR ZIP format.

- [TV Time Data Extractor](https://chromewebstore.google.com/detail/tv-time-data-extractor/jmpoblamjmpbhnggdihhcoejomkpkgpp)
  creates a simple CSV export locally in your browser.
- [TV Time Out by Refract](https://chromewebstore.google.com/detail/tv-time-out-by-refract/pmejpdpjbkjklfceogdkolmgclldogbi?hl=en)
  creates export files and an HTML archive of your profile. For smaller accounts,
  that HTML archive can make manual migration easier.

Use these as additional backups, not as a replacement for requesting the official
GDPR export.

## Use TV Time Capsule

1. Download this repository as a ZIP.
2. Unzip the repository.
3. Open `TVTimeCapsule.html` in your browser.
4. Choose your TV Time GDPR ZIP file.
5. Wait for the import to finish.
6. Use the Dashboard, History, and Settings views.

After import, TV Time Capsule saves a cleaned local library in your browser. The
next time you open `TVTimeCapsule.html`, it should open automatically.

If your browser storage is cleared, or the app asks for a reimport after an
update, choose the original TV Time GDPR ZIP again.

## What You Can Browse

- TV shows and movies from your export
- watched episodes and watched movies
- watch-later items where TV Time included them
- show/movie posters where metadata providers have a match
- history grouped by show/movie and date range
- watched show episodes grouped by season
- comments and reaction memories where TV Time included them in the export

## Update Warning: Comments and Reactions

TV Time Capsule now imports safe comment and reaction files from the official
GDPR ZIP when they are present. These memories stay local in your browser and
are shown from the History view, not from the Dashboard library grid.

Comments may include spoilers, old personal notes, or community text that TV
Time included in your export. Reactions are mapped from TV Time reaction IDs
where known, and unknown reaction IDs are shown plainly instead of guessed.

This improves browsing your archive, but it is not a full community migration:
likes, discussion context, GIFs, translations, and complete social threads may
still be missing or incomplete depending on what TV Time exported.

## What You Cannot Fully Migrate

Some TV Time memories may not be portable into another app, depending on what TV
Time includes in the export and what other apps support importing.

Community and social data is especially limited:

- GIF reactions
- episode discussions
- likes
- community interactions

TV Time Capsule focuses on preserving the private viewing library and watch
history that can be safely parsed from your export.

## What Stays Private

The app runs in your browser. Your GDPR ZIP is not uploaded by this app.

The generated local library intentionally excludes sensitive files such as:

- access and refresh tokens
- login/auth data and password hashes
- IP address history
- device tokens and device identifiers
- ad identifiers
- user agent and session records
- Facebook/social identity exports

The app shows a skipped-file report after import.

## Metadata and Images

TV Time exports do not include poster images. TV Time Capsule uses TVmaze to
look up show posters and Cinemeta/Stremio to look up movie posters when an
internet connection is available.

The Dashboard includes poster refresh buttons for retrying missing images. Movie
poster refreshes run in small batches and continue through the current filter.

For better fallback coverage, Settings supports an optional free TMDb API key.
When a show has no TVmaze poster, or when movie posters need a stronger source,
TV Time Capsule can try TMDb as a backup image source.

Metadata/image attribution:

- show metadata and images can come from [TVmaze](https://www.tvmaze.com/)
- movie posters can come from Cinemeta/Stremio
- optional fallback images can come from [TMDb](https://www.themoviedb.org/)

## Local Browser Data

TV Time Capsule uses browser storage so non-technical users do not need to manage
extra archive files.

Keep your original TV Time GDPR ZIP backed up. It is the source file used to
rebuild the local library if browser storage is cleared or the app changes its
import format.

## Development

This is a static browser app. There is no build step for users.

Project structure:

```text
TVTimeCapsule.html
app/
  assets/
  css/
  js/
  vendor/
```

Vendored browser libraries:

- JSZip for reading GDPR ZIP files
- PapaParse for parsing CSV files

## Current Limitations

- Poster image binaries are not embedded in the local library. The app stores
  safe metadata and image URLs.
- Full unwatched episode lists require provider metadata and are not complete in
  v1. The History modal currently shows watched episodes from the TV Time export.
- If metadata providers are offline or cannot match a title, the app shows a
  clean placeholder.
