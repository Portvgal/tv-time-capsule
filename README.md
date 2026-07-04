# TV Time Capsule

TV Time Capsule is a private, no-install viewer for TV Time GDPR exports.

Open the app in your browser, choose your TV Time GDPR ZIP, and browse your
shows, movies, watch history, posters, and watch-later items locally. The app
does not upload your TV Time export.

## Get Your TV Time GDPR Data

Before using TV Time Capsule, request and download your TV Time data export.

1. Open TV Time while your account is still available.
2. Go to the account, settings, help, privacy, or support area.
3. Look for an option such as **Download my data**, **Export my data**,
   **Privacy request**, **GDPR request**, or **Request my personal data**.
4. If there is no self-service button, contact TV Time support and ask for a
   GDPR/data export of your account.
5. Wait for TV Time to prepare the export. They may email you a download link or
   make the ZIP available in the app/account area.
6. Download the ZIP file and keep it somewhere safe.

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
