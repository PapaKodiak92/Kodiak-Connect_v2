# Kodiak Connect Website VPS Deployment

Production deployment is VPS-first.

The live repo path is expected to be `/opt/kodiak-connect`.

The public website files are in `website/` and can be copied to a static web root such as `/var/www/kodiak-connect-site`.

The root domain should serve the website:

- `kodiak-connect.com` -> public website
- `www.kodiak-connect.com` -> public website or redirect

Service subdomains should remain separate:

- `api.kodiak-connect.com` -> API service
- `auth.kodiak-connect.com` -> auth service
- `matrix.kodiak-connect.com` -> Matrix service
- `updates.kodiak-connect.com` -> update files and manifests

Keep any existing Matrix `.well-known` routes on the root domain. Do not remove working TLS, redirects, API, auth, Matrix, or updater Nginx blocks.

The app build should remain separate from the public website. The browser app can later move to `app.kodiak-connect.com`.
