# TV Time Capsule

TV Time Capsule is a private, no-install viewer for TV Time GDPR exports.

Open the app in your browser, choose your TV Time GDPR ZIP, and browse your
shows, movies, watch history, posters, and watch-later items locally. The app
does not upload your TV Time export.

## Get Your TV Time GDPR Data

Before using TV Time Capsule, request and download your TV Time data export from
TV Time's GDPR self-service page:

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
